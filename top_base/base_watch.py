# -*- coding: utf-8 -*-
"""
base_watch.py —— 整合破净数据、五大指数月K线与两融余额更新

【整体架构说明】（非常重要，请看这里）：
本脚本包含三个完全独立的数据模块，请不要混淆：
  1. 每日破净模块（写入 window.RAW_DATA）：每天执行，获取全A股破净数据。
  2. 每月指数模块（写入 window.INDEX_DATA）：每月首个交易日执行，获取五大指数的月K线。
  3. 每日两融模块（写入 window.MARGIN_DATA，独立文件 two_melt_data.js）：每天执行，
     增量更新沪深北两融余额合计，供两融出清信号使用。

运行：python base_watch.py
前置：pip install akshare pandas requests

交易日历、JS 解析等公共部分见 common 包（common/__init__.py）；本脚本特有的“头部读取 + 字符头插”
和“正则替换 INDEX_DATA 以保住几十 MB 的 RAW_DATA”仍留在本文件。
"""

import datetime
import json
import os
import re
import sys
from datetime import date, timedelta

import akshare as ak
import pandas as pd
import requests

# 直接跑 top_base/base_watch.py 时，sys.path[0] 只有 top_base/，项目根不在里面，
# 于是 import common 找不到项目根下的 common/ 包（IDE 里靠 PYTHONPATH 才碰巧能找到）。
# 这里显式把项目根插到最前面，不依赖 IDE 配置、也不依赖从哪个目录启动。
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import common

# ============================================================
# 全局常量配置
# ============================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "base_watch_data.js")

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

# 【仅用于模块 3：每日两融】
MARGIN_DATA_FILE = os.path.join(BASE_DIR, "two_melt_data.js")
MARGIN_VAR = "MARGIN_DATA"
EM_API = "https://datacenter-web.eastmoney.com/api/data/v1/get"
EM_HEADERS = {"User-Agent": "Mozilla/5.0", "Referer": "https://data.eastmoney.com/rzrq/"}
YI = 1e8    # 元 → 亿元
WAN = 1e4   # 万元 → 亿元
MARGIN_FIELDS = ["date", "两融余额"]
SZSE_RETRY = 3   # 深交所接口偶发超时，固定重试 3 次

# ============================================================
# 通用工具函数（供两个模块共同调用）
# ============================================================
# 日历的缓存（原来这里是本文件自己的 _TRADE_DATES 全局）已下沉到 common 包，
# 与 avg_price.py、etf_share.py 共用同一份缓存。


# 原来这里还有 get_trade_dates()（转发 common.get_trade_dates_all）和 is_trading_day()，
# 一个没人调用、一个随“非交易日闸门上移到调度”失去调用者，已删除；需要时直接调 common.xxx。


def is_first_trading_day_of_month() -> bool:
    """
    【通用】判断今天是不是本月的第一个交易日。
    用于触发模块 2（指数月K线更新）。
    """
    return common.is_first_trading_day_of_month(day_from=1)


def load_existing_index_data() -> dict:
    """
    【通用】从现存的 js 文件中提取并解析 window.INDEX_DATA。
    用于模块 2 的增量判断，如果文件不存在或解析失败返回空字典。

    注意：DATA_FILE 里 RAW_DATA 在前、INDEX_DATA 在后，所以必须按变量名定位，
    不能用“第一个 { 到最后一个 }”（那样会把 RAW_DATA 也吞进来）。
    """
    try:
        return common.read_js_json(DATA_FILE, var_name="INDEX_DATA", default={}) or {}
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
    df = ak.index_zh_daily_tx(symbol="sh000001", start_date=ymd, end_date=ymd)
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
        df = ak.index_zh_daily_tx(symbol=symbol, start_date=start_date, end_date=end_date)
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
    # （这正是不能直接用整文件重写的原因，序列化方式统一用 common.dump_js）
    js_content = common.dump_js("INDEX_DATA", existing_data, indent=2)

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
# 模块 3：每日两融余额更新（专门负责 window.MARGIN_DATA，独立 two_melt_data.js）
# ============================================================
def margin_resolve_js():
    """定位两融数据文件：优先 two_melt_data.js，找不到就取同目录里第一个含 MARGIN_DATA 的 js。"""
    exact = MARGIN_DATA_FILE
    if os.path.exists(exact):
        return exact
    found = []
    for name in sorted(os.listdir(BASE_DIR)):
        if not name.endswith(".js"):
            continue
        with open(os.path.join(BASE_DIR, name), encoding="utf-8") as f:
            head = f.read(400)
        if MARGIN_VAR in head or "MARGIN_META" in head:
            found.append(name)
    if found:
        print(f"未找到 {os.path.basename(MARGIN_DATA_FILE)}，改用同目录的 {found[0]}")
        return os.path.join(BASE_DIR, found[0])
    raise SystemExit(f"{BASE_DIR} 下没有任何含 {MARGIN_VAR} 的 js 文件，"
                     f"现有 js：{[n for n in os.listdir(BASE_DIR) if n.endswith('.js')]}")


def margin_peek_meta(path):
    """只读文件头部取 end 与列定义，避免为了判断是否最新而通读整个 js。

    老文件的 fields 里还有「上证收盘」或「融资买入额」，说明列没裁，需要重写一次。
    """
    if not os.path.exists(path):
        return None, True
    with open(path, encoding="utf-8") as f:
        head = f.read(1200)
    m = re.search(r'"end"\s*:\s*"(\d{4}-\d{2}-\d{2})"', head)
    stale = ('"上证收盘"' in head) or ('"融资买入额"' in head)
    return (m.group(1) if m else None), stale


def margin_normalize(payload):
    """rows 统一成两列：日期降序（最新在前）、两融余额 2 位小数、meta 同步。

    老文件若是 6/7/8 列，这里顺手裁成两列。
    """
    rows = payload["rows"]
    for r in rows:
        if len(r) >= 7:                 # 六指标（含或不含指数）
            r[:] = [r[0], r[4]]
        elif len(r) == 3:               # 上一版的三列
            r[:] = [r[0], r[1]]
        elif len(r) < 2:
            r += [None] * (2 - len(r))
    rows.sort(key=lambda r: r[0], reverse=True)
    for r in rows:
        if r[1] is not None:
            r[1] = round(float(r[1]), 2)
    meta = payload.get("meta", {})
    meta.update({
        "start": rows[-1][0],
        "end": rows[0][0],
        "count": len(rows),
        "fields": MARGIN_FIELDS,
        "unit": {"两融余额": "亿元"},
        "note": "rows 按日期降序（最新在前）；两融余额单位亿元，保留 2 位小数",
        "built_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
    })
    for k in ("missing_turnover", "missing_index"):
        meta.pop(k, None)
    payload["meta"] = meta
    return payload


def sse_margin(date):
    """上交所两融 → (融资余额, 融资买入额, 融券余额, 两融余额)，亿元。"""
    df = common.with_retry(lambda: ak.stock_margin_sse(start_date=date.replace("-", ""),
                                                      end_date=date.replace("-", "")),
                           times=2, label=f"上交所两融 {date}")
    if df is None or df.empty:
        return None
    row = df.iloc[0]
    return (float(row["融资余额"]) / YI, float(row["融资买入额"]) / YI,
            float(row["融券余量金额"]) / YI, float(row["融资融券余额"]) / YI)


def szse_margin(date):
    """深交所两融 → (融资余额, 融资买入额, 融券余额, 两融余额)，亿元。

    直接调深交所 ShowReport 接口，不经过 akshare。
    原因：akshare 的 stock_margin_szse 在“当日无数据”时会用空 DataFrame 去赋 6 个列名，
    触发 `Length mismatch: Expected axis has 0 elements, new values have 6 elements`，
    然后被重试三次、刷一屏报错。这里空数据直接返回 None，交给东财兜底或跳过。
    """
    url = "https://www.szse.cn/api/report/ShowReport/data"
    params = {
        "SHOWTYPE": "JSON",
        "CATALOGID": "1837_xxpl",
        "txtDate": date,  # 接口接受 YYYY-MM-DD
        "tab1PAGENO": "1",
        "random": "0.7425245522795993",
    }
    headers = {
        "Referer": "https://www.szse.cn/disclosure/margin/object/index.html",
        "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                       "AppleWebKit/537.36 (KHTML, like Gecko) "
                       "Chrome/120.0 Safari/537.36"),
    }

    def fetch():
        resp = requests.get(url, params=params, headers=headers, timeout=20)
        resp.raise_for_status()
        payload = resp.json()
        block = payload[0] if isinstance(payload, list) and payload else payload
        data = (block or {}).get("data") or []
        if not data:
            return None

        row = data[0]  # {"jrrzmr":融资买入额,"jrrzye":融资余额,...,"jrrzrjye":两融余额}

        def val(*keys):
            for key in keys:
                raw = row.get(key)
                if raw not in (None, "", "-"):
                    return float(str(raw).replace(",", ""))
            return None

        buy = val("jrrzmr")
        balance = val("jrrzye")
        short_balance = val("jrrjye")
        total = val("jrrzrjye")
        if None in (buy, balance, short_balance, total):
            return None

        def yi(v):
            return v / YI if v > 1e6 else v  # 兼容个别版本给“元”

        return (yi(balance), yi(buy), yi(short_balance), yi(total))

    return common.with_retry(fetch, times=SZSE_RETRY, label=f"深交所两融 {date}")


def bse_margin(date):
    """北交所两融（万元）→ (融资余额, 融资买入额, 融券余额, 两融余额)，亿元。"""
    df = common.with_retry(lambda: ak.stock_margin_bse(date=date.replace("-", "")),
                           times=2, label=f"北交所两融 {date}")
    if df is None or df.empty:
        return None
    row = df.iloc[-1]
    return (float(row["融资余额"]) / WAN, float(row["融资买入额"]) / WAN,
            float(row["融券余额"]) / WAN, float(row["融资融券余额"]) / WAN)


def em_snapshot(date):
    """东财单日快照（兜底）：一次拿三市两融余额。"""
    params = {"reportName": "RPTA_RZRQ_LSDB", "columns": "ALL", "source": "WEB",
              "pageNumber": 1, "pageSize": 1, "filter": f"(DIM_DATE='{date}')"}
    resp = requests.get(EM_API, params=params, headers=EM_HEADERS, timeout=30)
    data = (resp.json().get("result") or {}).get("data") or []
    if not data:
        return None
    raw = data[0]

    def yi(key):
        try:
            return float(raw[key]) / YI
        except (TypeError, ValueError, KeyError):
            return None

    return {"沪": yi("H_RZRQYE"), "深": yi("S_RZRQYE"), "北": yi("B_RZRQYE")}


def _margin_usable(m):
    """某个市场的数据是否可用：四项齐全、两融余额为正。"""
    return (m is not None and len(m) >= 4
            and m[3] is not None and m[3] > 0)


def build_margin_row(date):
    """组装 [日期, 两融余额]。沪深两融的「两融余额」相加，北交所能取到也加上。"""
    sse_m = sse_margin(date)
    szse_m = szse_margin(date)
    bse_m = bse_margin(date)

    snap = None
    if not _margin_usable(sse_m) or not _margin_usable(szse_m):
        snap = em_snapshot(date)
    if snap:
        if not _margin_usable(sse_m) and snap["沪"]:
            sse_m = (None, None, None, snap["沪"])
        if not _margin_usable(szse_m) and snap["深"]:
            szse_m = (None, None, None, snap["深"])

    # 沪深都拿到才算完整的一天；缺一边时兜底可能给 None，这里挡掉
    if not _margin_usable(sse_m) and not _margin_usable(szse_m):
        raise RuntimeError(f"{date} 沪深两融均未更新，跳过不写")
    if not _margin_usable(szse_m):
        raise RuntimeError(f"{date} 深交所两融未更新，跳过不写")
    if not _margin_usable(sse_m):
        raise RuntimeError(f"{date} 上交所两融未更新，跳过不写")

    total = sse_m[3] + szse_m[3]
    if bse_m is not None and bse_m[3] and bse_m[3] > 0:
        total += bse_m[3]
    return [date, round(total, 2)]


def update_margin_data():
    """【模块 3 主入口】两融余额 T-1 增量更新，只维护独立的 two_melt_data.js。"""
    print("\n--- 开始更新每日两融余额 (MARGIN_DATA) ---")
    js = margin_resolve_js()
    target = common.last_trade_date().isoformat()   # 严格早于今天 = T-1
    end, stale = margin_peek_meta(js)
    print(f"  js 里 end={end}，T-1 交易日={target}")

    if end == target and not stale:                 # 已最新且列已裁好：不读全量
        print("  已是最新，跳过拉取")
        return

    payload = common.read_js_json(js, MARGIN_VAR, default=None)
    if payload is None or "rows" not in payload:
        raise SystemExit(f"{os.path.basename(js)} 结构不对：需要 window.{MARGIN_VAR} = {{\"meta\":..., \"rows\":[...]}}")

    rows_all = payload["rows"]
    last = rows_all[0][0]                           # 日期降序，第一行即最新

    pending = [d.isoformat() for d in common.get_trade_dates(last, target) if d.isoformat() > last]
    print(f"  缺口 {len(pending)} 个交易日：{pending[0]} ~ {pending[-1]}" if pending else "  无缺口")

    index = {r[0]: i for i, r in enumerate(rows_all)}
    for date_str in pending:
        try:
            row = build_margin_row(date_str)
        except Exception as exc:
            print(f"  {date_str} 跳过：{type(exc).__name__} {exc}")
            continue
        if date_str in index:
            rows_all[index[date_str]] = row
        else:
            rows_all.append(row)
        print(f"  {date_str}：两融 {row[1]} 亿")

    margin_normalize(payload)
    common.write_js_json(js, MARGIN_VAR, payload, indent=None, newline=True, atomic=True)
    print(f"  ✅ 已更新 {js}：{payload['meta']['count']} 行，最新 {payload['meta']['end']}")


# ============================================================
# 主流程调度器
# ============================================================
def main():
    """
    【总调度中心】
    1. 交易日判断由 common/central_control.py 负责：非交易日它不会调用本脚本。
    2. 每天执行：更新破净数据（模块 1）。
    3. 月度任务（更新指数月线，模块 2）由调度下发的 AMC_MONTHLY 决定：
       本月首个交易日，或节假日前最后一个交易日。
    """
    today = date.today()

    # 全局闸门（非交易日跳过）已上移到 common/central_control.py，这里不再重复判断

    # 每日必修课：更新破净数据
    try:
        update_daily_data()
    except Exception as e:
        print(f"❌ 每日破净数据更新失败: {e}")

    # 每日必修课：更新两融余额（独立 two_melt_data.js）
    try:
        update_margin_data()
    except Exception as e:
        print(f"❌ 每日两融余额更新失败: {e}")

    # 每月月初大考：更新指数月K线。
    # 调度传了 AMC_MONTHLY 就按调度的结论；没传（手动单独跑本脚本）才自己判一次，
    # 否则单跑时月度任务永远不会触发。
    flag = os.environ.get("AMC_MONTHLY")
    monthly = is_first_trading_day_of_month() if flag is None else (flag == "1")
    if monthly:
        try:
            update_monthly_data()
        except Exception as e:
            print(f"❌ 月度指数数据更新失败: {e}")
    else:
        print(f"\n[{today}] 非月度更新日（由调度判断），跳过月K线更新。")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"运行致命错误：{e}", file=sys.stderr)
        sys.exit(1)