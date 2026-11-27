# common/central_control.py
"""总调度：所有“要不要跑”的判断都集中在这里，子脚本只管抓数和落盘，不再自己请求交易日历判断。

运行时间：**T+1 早上 08:06**（cron-job.org 触发），这一次取的是「上一交易日（T 日）」的完整数据。
各脚本用 common.data_target_date() 自己定目标日，所以晚上手工补跑也会自动切回当天；
两融余额由交易所 T+1 才公布，天然只到 T-1，次日那一跑自动补齐，不用单独排期。

判断顺序：
  1. 今天不是交易日（周末 / 法定节假日）→ **一个子脚本都不跑**。
     节前最后一个交易日晚上已经把当天数据更完了，假期里没有新数据可抓。
  2. 今天交易日 → 跑日常任务；
  3. 月度任务（top_base 的指数月K）只在两种情况跑：
       - 本月首个交易日
       - 节假日前最后一个交易日（今晚之后休市，趁这次把月度数据一起更到最新）
  4. etf 的 ETF 池审查单独一个标志：它原本是「每月 2 号及以后首个交易日」
     （份额 T+1 才定稿，1 号跑拿不到上月最后一天的定稿数据），所以不能跟第 3 条合并；
     同样叠加「节假日前最后一个交易日」。

所有日历判断都复用 common 包（common/__init__.py）：
is_trading_day / holiday_eve / is_first_trading_day_of_month / next_trade_date，
本文件不再自己算日期。

判定结果通过环境变量下发：AMC_TODAY / AMC_MONTHLY / AMC_REVIEW，
子脚本读这些标志决定跑不跑月度部分。

节假日想复盘时手工跑一次：python central_control.py --force
（按缺口把最近一个交易日的数据补齐）
"""
import datetime
import os
import subprocess
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(BASE_DIR)

# 和子脚本一致：把项目根插到最前，这样 common/ 能被当成包导入（common/__init__.py）。
# 本文件自身就在 common/ 目录里，直接 import common 会找不到（sys.path[0] 是 common/ 自己）。
sys.path.insert(0, ROOT_DIR)
import common  # noqa: E402

# (子目录, 脚本, 日志步骤名)；子目录为空表示直接在项目根下跑
TASKS = [
    ("market", "avg_price.py", "1. market：沪深总市值与平均股价（当天）"),
    ("etf", "etf_share.py", "2. etf：ETF 份额增量（含池审查）"),
    ("top_base", "base_watch.py", "3. top_base：破净比例 + 两融余额（每日）+ 指数月线（月度）"),
    # 【修复】牛顶监测的 top_watch.py 原来根本没进这张任务表：
    # 它内部读 market/market_data.js 生成 DERIVED_DATA（均价月线 / MA6 / 门槛），
    # 同时维护 FLOW_DATA（M1 / 开户），不跑它这一页数据就永远停在旧日期。
    # 月度闸门（AMC_MONTHLY）由它自己判断：非月度日只本地派生，不联网抓 M1 / 开户。
    ("top_base", "top_watch.py", "4. top_base：牛顶监测（均价月线派生 + 增量资金）"),
]


def decide(today):
    """算出今天该跑什么。返回 (是否交易日, 跑月度?, 跑池审查?, 下个交易日, 说明)。

    日历判断全部走 common：非交易日必然 monthly/review 都是 False，
    因为 common.is_first_trading_day_of_month 对非交易日返回 False、holiday_eve 也会先挡掉。
    """
    trading = common.is_trading_day(today)
    nxt = common.next_trade_date(today)
    eve = common.holiday_eve(today)
    month_first = common.is_first_trading_day_of_month(1, today)
    review_day = common.is_first_trading_day_of_month(2, today)

    monthly = month_first or eve
    review = review_day or eve

    if trading:
        state = "交易日"
    elif today.weekday() >= 5:               # 5=周六 6=周日
        state = "周末"
    else:
        state = "法定节假日"

    why = (f"{state}｜交易日={trading}｜月初首个交易日={month_first}｜"
           f"节前最后交易日={eve}（下个交易日 {nxt}）→ 月度={'跑' if monthly else '不跑'}"
           f"／池审查={'跑' if review else '不跑'}")
    return trading, monthly, review, nxt, why


def run_script(folder, script_name, env):
    """跑一个子脚本，返回是否成功。失败原因打到日志里，别静默吞掉。"""
    target_dir = os.path.join(ROOT_DIR, folder) if folder else ROOT_DIR
    if not os.path.exists(os.path.join(target_dir, script_name)):
        print(f"   [跳过] 找不到 {os.path.join(target_dir, script_name)}")
        return False
    try:
        result = subprocess.run([sys.executable, script_name], cwd=target_dir, env=env)
    except Exception as exc:
        print(f"   [失败] {script_name}：{type(exc).__name__} {exc}")
        return False
    if result.returncode != 0:
        print(f"   [失败] {script_name} 退出码 {result.returncode}")
        return False
    return True


def main():
    force = ("--force" in sys.argv) or ("-f" in sys.argv)
    today = datetime.date.today()
    trading, monthly, review, nxt, why = decide(today)
    print(f"[调度] {today}：{why}")

    # 非交易日（周末 + 法定节假日）默认一个脚本都不跑
    if not trading and not force:
        print(f"[调度] 非交易日（周末/节假日），全部任务跳过；"
              f"下一个交易日 {nxt} 会自动把缺的补上。"
              f"节假日想复盘就手工跑一次，加 --force")
        return 0
    if not trading:
        print(f"[调度] 非交易日，但你加了 --force → 手工复盘运行，"
              f"按缺口把最近一个交易日（{common.last_trade_date(today)}）的数据补齐")

    # 判定结果下发给子脚本：它们只读这些标志，不再自己判断
    # 【方案A】跑批统一在「T+1 早上 08:06」触发，所以这一跑要取的是「上一交易日（T 日）」：
    # 早上跑时今天的收盘数据还不存在，各脚本统一用 common.data_target_date() 取这个日期，
    # AMC_TODAY 只表示"跑批当天"（T+1），不再当作数据日期使用。
    env = os.environ.copy()
    env["AMC_TODAY"] = today.isoformat()
    env["AMC_MONTHLY"] = "1" if monthly else "0"
    env["AMC_REVIEW"] = "1" if review else "0"

    failed = []
    for folder, script, label in TASKS:
        print(f"\n[开始] {label}")
        if not run_script(folder, script, env):
            failed.append(script)

    if failed:
        print(f"\n[结束] {len(TASKS) - len(failed)}/{len(TASKS)} 成功，失败：{', '.join(failed)}")
        return 1  # 只要有一个错，最后标记为失败
    print(f"\n[结束] {len(TASKS)}/{len(TASKS)} 全部成功")
    return 0


if __name__ == "__main__":
    sys.exit(main())
