# common/central_control.py
"""总调度：所有“要不要跑”的判断都集中在这里，子脚本只管抓数和落盘，不再自己请求交易日历判断。

运行时间：**每个交易日 22:00 之后**（收盘、且当日两融/份额类数据发布之后再跑）。
因为跑在收盘后，当天数据当天就能落库，不再靠 T-1 往回倒一天，假期里也不会缺数据。

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
    ("top_base", "top_base.py", "3. top_base：破净比例（每日）+ 指数月线（月度）"),
    ("two_melt", "two_melt.py", "4. two_melt：沪深北两融余额合计（当天）"),
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
