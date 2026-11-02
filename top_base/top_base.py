# -*- coding: utf-8 -*-
"""
top_base.py —— 整合破净数据与五大指数月K线更新（统一写入 top_base_data.js）

【整体架构说明】（非常重要，请看这里）：
本脚本包含两个完全独立的数据模块，请不要混淆：
  1. 每日破净模块（写入 window.RAW_DATA）：每天执行，获取全A股破净数据。
  2. 每月指数模块（写入 window.INDEX_DATA）：每月首个交易日执行，获取五大指数的月K线。

运行：python top_base.py
前置：pip install akshare pandas
"""

import json
import os
import re
import sys
from datetime import date, timedelta

import akshare as ak
import pandas as pd

# ============================================================
# 全局常量配置
# ============================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "top_base_data.js")

HEAD_BYTES = 8192  # 头插读取的字节数，足够覆盖前几条记录
HEAD_ROWS = 7  # 只解析前 7 条用于去重判断

# 【仅用于模块 2：每月指数】
INDICES = {
    "sh000001": "上证指数",
    "sz399001": "深证成指",
    "sz399006": "创业板指",
    "sh000688": "科创50",
    "bj899050": "北证50"
}
DEFAULT_START_DATE = "20050101"  # 指数首次全量拉取时的起点

# ============================================================
# 通用工具函数（供两个模块共同调用）
# ============================================================
_TRADE_DATES = None


def get_trade_dates():
    """
    【通用】获取历史所有交易日（带进程内缓存，只请求一次 API）。
    """
    global _TRADE_DATES
    if _TRADE_DATES is None:
        df = ak.tool_trade_date_hist_sina()
        _TRADE_DATES = pd.to_datetime(df["trade_date"]).dt.date.tolist()
    return _TRADE_DATES


def is_trading_day(d: date) -> bool:
    """
    【通用】判断今天是不是真实的交易日（周末、法定节假日返回 False）。
    """
    return d in get_trade_dates()


def is_first_trading_day_of_month() -> bool:
    """
    【通用】判断今天是不是本月的第一个交易日。
    用于触发模块 2（指数月K线更新）。
    """
    today = date.today()
    dates = get_trade_dates()
    month_dates = [d for d in dates if d.year == today.year and d.month == today.month]
    return bool(month_dates) and month_dates[0] == today


def load_existing_index_data() -> dict:
    """
    【通用】从现存的 js 文件中提取并解析 window.INDEX_DATA。
    用于模块 2 的增量判断，如果文件不存在或解析失败返回空字典。
    """
    if not os.path.exists(DATA_FILE):
        return {}
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        text = f.read()

    match = re.search(r'window\.INDEX_DATA\s*=\s*(\{.*?\});', text, flags=re.DOTALL)
    if not match:
        return {}
    try:
        return json.loads(match.group(1))
    except Exception:
        return {}


# ============================================================
# 模块 1：每日破净数据更新（专门负责 window.RAW_DATA）
# ============================================================
def read_head_rows(n=HEAD_ROWS):
    """
    【模块 1】只读取文件头部前 N 条记录，用于判断今天是否已经插入过。
    这种只读头部的方式避免了每次加载几十 MB 的整个文件，极其高效。
    """
    if not os.path.exists(DATA_FILE):
        return []
    with open(DATA_FILE, encoding="utf-8") as f:
        head = f.read(HEAD_BYTES)

    try:
        anchor = head.index("window.RAW_DATA")
        pos = head.index("[", anchor) + 1
    except ValueError:
        return []

    rows = []
    while len(rows) < n:
        while pos < len(head) and head[pos] in " \t\r\n,":
            pos += 1
        if pos >= len(head) or head[pos] == "]":
            break
        if head[pos] != "[":
            break
        end = head.index("]", pos) + 1
        rows.append(json.loads(head[pos:end]))
        pos = end
    return rows


def fetch_below_net_latest():
    """
    【模块 1】调用 AkShare 接口，获取【全A股】的最新破净数据。
    注意：这里是全市场统计接口，所以请求较重，每天只执行一次。
    返回：日期、破净数、总股票数、破净比例。
    """
    df = ak.stock_a_below_net_asset_statistics(symbol="全部A股")
    if df is None or df.empty:
        raise RuntimeError("AKShare 破净接口返回空数据")
    df = df.sort_values("date")
    latest = df.iloc[-1]
    return {
        "date": str(latest["date"]),
        "below": int(latest["below_net_asset"]),
        "total": int(latest["total_company"]),
        "ratio": float(latest["below_net_asset_ratio"]),
    }


def fetch_index_close(date_str):
    """
    【模块 1】单独拉取上证指数某一天的收盘价。
    作用：仅仅为了拼装进 RAW_DATA 数组里（破净数据需要附带当天指数点位）。
    与后面的“月K线”毫无关系。
    """
    ymd = date_str.replace("-", "")
    df = ak.stock_zh_index_daily_tx(symbol="sh000001", start_date=ymd, end_date=ymd)
    if df is None or df.empty:
        raise RuntimeError(f"腾讯源未返回 {date_str} 的指数数据")
    close_col = "close" if "close" in df.columns else "收盘"
    return float(df.iloc[-1][close_col])


def prepend_row(row):
    """
    【模块 1】字符串层面的“头插”操作。
    直接将新一行的字符串拼接到 window.RAW_DATA = [ 之后，
    完全不动文件后面的内容，速度极快，绝对不会破坏 INDEX_DATA。
    """
    if not os.path.exists(DATA_FILE):
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            f.write("window.RAW_DATA = [];\n")

    with open(DATA_FILE, encoding="utf-8") as f:
        text = f.read()

    anchor = text.index("window.RAW_DATA")
    pos = text.index("[", anchor) + 1

    row_str = f'["{row[0]}",{row[1]},{row[2]},{row[3]},{row[4]}]'
    rest = text[pos:].lstrip()
    sep = "" if rest.startswith("]") else ","

    with open(DATA_FILE, "w", encoding="utf-8") as f:
        f.write(text[:pos] + row_str + sep + text[pos:])


def update_daily_data():
    """
    【模块 1 主入口】每日破净数据的组装逻辑。
    1. 获取最新的破净数据（全A股）。
    2. 去重检查：如果文件头部已经有这个日期，直接退出。
    3. 请求当天上证指数收盘价。
    4. 拼装成新行，头插进 window.RAW_DATA。
    """
    print("\n--- 开始更新每日破净数据 (RAW_DATA) ---")
    head_rows = read_head_rows(HEAD_ROWS)
    head_dates = [r[0] for r in head_rows] if head_rows else []

    api_data = fetch_below_net_latest()
    print(f"  API 最新破净日期：{api_data['date']}")

    # 去重判断：如果最新日期已经在前 7 条里，说明今天已经更新过了
    if api_data["date"] in head_dates:
        print(f"  {api_data['date']} 已存在，无需更新。")
        return

    # 获取当天的上证指数收盘价
    close = fetch_index_close(api_data["date"])
    new_row = [
        api_data["date"],
        api_data["below"],
        api_data["total"],
        close,
        round(api_data["ratio"] * 100, 2),
    ]
    print(f"  新增行：{new_row}")
    prepend_row(new_row)
    print(f"  ✅ 已头插并写回 {DATA_FILE}")


# ============================================================
# 模块 2：每月指数月K线更新（专门负责 window.INDEX_DATA）
# ============================================================
def daily_from_tx(symbol: str, start_date: str, end_date: str):
    """
    【模块 2】腾讯源获取单个指数的日线数据（支持指定起止日期）。
    优点：速度极快，只返回请求的区间，不占用多余内存。
    """
    try:
        df = ak.stock_zh_index_daily_tx(symbol=symbol, start_date=start_date, end_date=end_date)
        if df is None or df.empty: return None
        df = df.copy()
        df["date"] = pd.to_datetime(df["date"])
        return df.set_index("date").sort_index()
    except Exception as e:
        print(f"    [腾讯] 获取失败: {e}")
        return None


def daily_from_sina(symbol: str, start_date: str, end_date: str):
    """
    【模块 2】新浪源获取单个指数的日线数据（作为腾讯失败时的兜底）。
    特点：新浪接口通常返回全量数据，因此在本地根据起止日期进行切片过滤。
    """
    try:
        df = ak.stock_zh_index_daily(symbol=symbol)
        if df is None or df.empty: return None
        df = df.copy()
        df["date"] = pd.to_datetime(df["date"])
        df = df.set_index("date").sort_index()
        return df.loc[(df.index >= pd.to_datetime(start_date)) & (df.index <= pd.to_datetime(end_date))]
    except Exception as e:
        print(f"    [新浪] 获取失败: {e}")
        return None


def resample_monthly(df: pd.DataFrame) -> list:
    """
    【模块 2】将日线数据按自然月重采样为月线。
    聚合规则：开盘取月初、最高取月内最大、最低取月内最小、收盘取月末。
    """
    monthly = df.resample(pd.offsets.MonthEnd()).agg({
        "open": "first", "high": "max", "low": "min", "close": "last",
    }).dropna()
    return [
        [dt.strftime("%Y-%m-%d"), float(r["open"]), float(r["high"]), float(r["low"]), float(r["close"])]
        for dt, r in monthly.iterrows()
    ]


def merge_monthly_data(old_data: list, new_data: list) -> list:
    """
    【模块 2】合并旧月线与新月线数据。
    使用字典以日期为主键进行覆盖（新抓取的数据优先级更高），最后按时间升序输出。
    """
    if not old_data and not new_data: return []
    if not old_data: return new_data
    if not new_data: return old_data

    merged_dict = {row[0]: row for row in old_data}
    for row in new_data:
        merged_dict[row[0]] = row

    return [merged_dict[k] for k in sorted(merged_dict.keys())]


def update_monthly_data():
    """
    【模块 2 主入口】每月指数月K线的增量更新逻辑。
    1. 解析文件里已有的数据，检查每个指数最后一条记录的月份。
    2. 如果数据已经覆盖到上个月，直接跳过，0网络请求。
    3. 如果有缺失，只从缺失日期的半个月前开始增量拉取，然后合并。
    4. 最后统一用正则覆盖 window.INDEX_DATA，不破坏前面的 RAW_DATA。
    """
    print("\n--- 开始增量更新指数月K线 (INDEX_DATA) ---")
    today_str = date.today().strftime("%Y%m%d")

    # 读取现存的 INDEX_DATA
    existing_data = load_existing_index_data()
    updated = False

    for symbol, name in INDICES.items():
        old_entry = existing_data.get(name, {})
        old_rows = old_entry.get("data", [])

        # 增量判断逻辑
        if old_rows:
            last_date_str = old_rows[-1][0]
            last_date = pd.to_datetime(last_date_str)

            # 判断是否已经包含上个月的数据（说明当前不需要更新了）
            current_month = pd.to_datetime(date.today()).replace(day=1)
            last_month = current_month - pd.Timedelta(days=1)

            if last_date >= last_month:
                print(f"  {name}: 已是最新 ({last_date_str})，跳过。")
                continue

            # 设定增量拉取的起点（提前 15 天，确保上个月的月线能被完整抓到）
            fetch_start = (last_date - pd.Timedelta(days=15)).strftime("%Y%m%d")
            print(f"  {name}: 发现缺失，从 {fetch_start} 开始增量拉取...")
        else:
            # 如果没有历史数据，拉取全量
            fetch_start = DEFAULT_START_DATE
            print(f"  {name}: 无历史数据，从 {fetch_start} 全量拉取...")

        # 走腾讯接口优先，失败换新浪
        df = daily_from_tx(symbol, fetch_start, today_str)
        source = "腾讯"
        if df is None or df.empty:
            df = daily_from_sina(symbol, fetch_start, today_str)
            source = "新浪"

        if df is None or df.empty:
            print(f"    ❌ {name} 获取失败或近期无数据，跳过。")
            continue

        # 转月线并合并
        new_rows = resample_monthly(df)
        if not new_rows:
            continue

        merged_rows = merge_monthly_data(old_rows, new_rows)
        existing_data[name] = {"code": symbol, "source": source, "data": merged_rows}
        print(f"    ✅ {name}: 新增 {len(new_rows)} 条，合并后共 {len(merged_rows)} 条月线。")
        updated = True

    if not updated:
        print("  所有指数均已是最新，无需重写文件。")
        return

    # 保存：利用正则精准替换 INDEX_DATA，保留前面几十 MB 的 RAW_DATA
    js_content = "window.INDEX_DATA = " + json.dumps(existing_data, ensure_ascii=False, indent=2) + ";"

    with open(DATA_FILE, "r", encoding="utf-8") as f:
        text = f.read()

    if "window.INDEX_DATA" in text:
        text = re.sub(r'window\.INDEX_DATA\s*=\s*\{.*?\};\s*$', js_content + "\n", text, flags=re.DOTALL)
    else:
        text = text.rstrip() + "\n\n" + js_content + "\n"

    with open(DATA_FILE, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"  ✅ 已保存更新后的 INDEX_DATA 至 {DATA_FILE}")


# ============================================================
# 主流程调度器
# ============================================================
def main():
    """
    【总调度中心】
    1. 非交易日直接下班。
    2. 每天执行：更新破净数据（模块 1）。
    3. 每月首个交易日：执行更新指数月线（模块 2）。
    """
    today = date.today()

    # 全局闸门：非交易日跳过
    if not is_trading_day(today):
        print(f"[{today}] 非交易日，跳过所有任务。")
        return

    # 每日必修课：更新破净数据
    try:
        update_daily_data()
    except Exception as e:
        print(f"❌ 每日破净数据更新失败: {e}")

    # 每月月初大考：更新指数月K线
    if is_first_trading_day_of_month():
        try:
            update_monthly_data()
        except Exception as e:
            print(f"❌ 月度指数数据更新失败: {e}")
    else:
        print("\n今天不是本月首个交易日，跳过月K线更新。")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"运行致命错误：{e}", file=sys.stderr)
        sys.exit(1)