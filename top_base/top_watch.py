# -*- coding: utf-8 -*-
"""
top_watch.py —— 牛顶监测统一取数与派生脚本（合并原 fetch_flow.py 与 build_derived.py）。

包含两个模块：
  1. 增量资金（window.FLOW_DATA）：M1 同比、月开户、四轮顶部资金转向参照。
     月度闸门（AMC_MONTHLY=1 或 --fetch）才联网抓 akshare；非月度只保留已有历史、
     用内置种子补缺，不清空接口历史。开户接口仅更新到 2023-08，2025-01 起为人工复核种子。
  2. 均价派生（window.DERIVED_DATA）：读 market/market_data.js 日频均价，
     聚合月线 OHLC，派生 MA6 / MA12 / BIAS12 / 滚动 75% 门槛阶梯 / 六轮均价顶；本模块不联网。
     【修复】这里原来指向 market/data/market_data.js（多了一层 data/），实际文件在 market/ 下，
     路径错了就 SystemExit，等于这一页永远不更新。

两份数据统一写入同目录 top_watch_data.js。
公共工具（交易日历 / JS 读写 / 退避重试）见 common 包。
"""
import datetime
import os
import re
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(BASE_DIR)
sys.path.insert(0, ROOT_DIR)
import common  # noqa: E402

DATA_FILE = os.path.join(BASE_DIR, "top_watch_data.js")
# 【修复】原来写的是 market/data/market_data.js —— 仓库里并没有 market/data/ 这一层，
# 真实文件是 market/market_data.js。路径错了的后果是 build_derived() 读不到 ashare，
# 直接 SystemExit，脚本一跑就失败，于是也一直没人把它放进调度表（top_watch_data.js 长期停在旧日期）。
MARKET_JS = os.path.join(ROOT_DIR, "market", "market_data.js")
# 兼容旧路径：万一以后有人把文件挪回 market/data/，这里还能兜住一次
LEGACY_MARKET_JS = os.path.join(ROOT_DIR, "market", "data", "market_data.js")

# ---- 种子：接口缺口月份的人工复核值（只比转向时点，绝对值口径见页面备注） ----
# M1 同比 %，2024-01 起（实抓成功的月份会被覆盖）
SEED_M1 = {
    "2024-01": 3.3, "2024-02": 2.6, "2024-03": 2.3, "2024-04": 0.6,
    "2024-05": -0.8, "2024-06": -1.7, "2024-07": -2.6, "2024-08": -3.0,
    "2024-09": -3.3, "2024-10": -2.3, "2024-11": -0.7, "2024-12": 1.2,
    "2025-01": 0.4, "2025-02": 0.1, "2025-03": 1.6, "2025-04": 1.5,
    "2025-05": 2.3, "2025-06": 4.6, "2025-07": 5.6, "2025-08": 6.0,
    "2025-09": 7.2, "2025-10": 6.2, "2025-11": 4.9, "2025-12": 3.8,
    "2026-01": 4.9, "2026-02": 5.9, "2026-03": 5.1, "2026-04": 5.0,
    "2026-05": 5.5, "2026-06": 4.0, "2026-07": 4.0, "2026-08": 4.1,
    "2026-09": 3.2, "2026-10": 4.4,
}

# 月开户（万户），2025-01 起（接口仅更新到 2023-08，此后为人工复核值）
# 口径：后续统一采用沪市 A 股新开户；2007 新增开户数、2015 新增 A 股账户两套旧口径不再更新。
SEED_ACCOUNTS = {
    "2025-01": 157.00, "2025-02": 283.59, "2025-03": 306.55, "2025-04": 192.44,
    "2025-05": 155.56, "2025-06": 164.64, "2025-07": 196.36, "2025-08": 265.03,
    "2025-09": 293.72, "2025-10": 230.99, "2025-11": 238.14, "2025-12": 259.67,
    "2026-01": 491.58, "2026-02": 252.30, "2026-03": 460.14, "2026-04": 249.13,
    "2026-05": 276.53, "2026-06": 286.46, "2026-07": 265.54, "2026-08": 239.73,
    "2026-09": 191.19, "2026-10": 150.06,
}

# 四轮顶部参照（顶月对齐均价顶；2007/2015 资金值为种子，其余由序列回推）
REF_TOPS = [
    {"top": "2007-10", "m1_peak": "2007-08", "m1_value": 22.8, "m1_lead": 2,
     "acc_peak": None, "acc_value": 892, "acc_lead": 2, "m1_status": "seed", "acc_status": "seed"},
    {"top": "2015-06", "m1_peak": None, "m1_value": None, "m1_lead": None,
     "m1_note": "6月 4.3% 仍上行", "acc_peak": None, "acc_value": 1295, "acc_lead": 2,
     "m1_status": "fail", "acc_status": "seed"},
    {"top": "2021-12", "m1_peak": None, "m1_value": None, "m1_lead": None,
     "acc_peak": None, "acc_value": None, "acc_lead": None, "m1_status": "series", "acc_status": "series"},
    {"top": "2026-05", "m1_peak": None, "m1_value": None, "m1_lead": None,
     "acc_peak": None, "acc_value": None, "acc_lead": None, "m1_status": "series", "acc_status": "series"},
]

WINDOW_MONTHS = 18  # 顶部往前回看的资金局部峰值窗口

# 六轮均价顶（顶月为历史复盘标定；价位由月线实测，脚本不写死价格）
PEAK_MONTHS = ["2007-10", "2010-12", "2011-03", "2015-06", "2021-12", "2026-05"]
BIAS_GATE = 8.0  # BIAS12 顶部闸门（%）


# ============================================================
# 模块 1：增量资金（M1 / 月开户）
# ============================================================
def ym_index(ym):
    y, m = ym.split("-")
    return int(y) * 12 + int(m)


def parse_cn_month(s):
    mm = re.match(r"(\d{4})\s*年\s*(\d{1,2})", str(s))
    return f"{mm.group(1)}-{int(mm.group(2)):02}" if mm else None


def _month_map(fetch_df, key_col, val_col, label, digits, key=None):
    """把“月度接口”的 DataFrame 收成 {月份: 数值}。

    M1 同比、新增开户数原来各抄一份同样的循环，只剩“列名 / 取月方式 / 小数位”不同，
    合到这里：key 为 None 时按 parse_cn_month 解析中文月份，否则用 key(r) 自己取。
    """
    out = {}

    def _go():
        df = fetch_df()
        for _, r in df.iterrows():
            ym = parse_cn_month(r[key_col]) if key is None else key(r)
            v = r[val_col]
            if ym and v == v:          # v == v 用来挡 NaN
                out[ym] = round(float(v), digits)
        return True

    common.with_retry(_go, times=2, delay=1.0, label=label)
    return out


def fetch_m1():
    import akshare as ak
    return _month_map(ak.macro_china_money_supply_em, "月份", "货币(M1)-同比增长", "M1", 1)


def fetch_accounts():
    import akshare as ak
    return _month_map(ak.stock_account_statistics_em, "数据日期", "新增投资者-数量", "开户", 2,
                      key=lambda r: str(r["数据日期"])[:7])


def local_peak(series, top, window=WINDOW_MONTHS):
    """返回顶部前 window 个月内的局部峰值 (月份, 数值, 领先月数)；无数据返回 None。"""
    ti = ym_index(top)
    best_ym, best_v = None, None
    for ym, v in series.items():
        delta = ti - ym_index(ym)
        if 0 <= delta <= window and v is not None and (best_v is None or v > best_v):
            best_ym, best_v = ym, v
    if best_ym is None:
        return None
    return {"peak": best_ym, "value": round(float(best_v), 2), "lead": ti - ym_index(best_ym)}


def build_flow(monthly):
    m1, accounts = {}, {}

    if monthly:
        m1 = fetch_m1()
        accounts = fetch_accounts()
    else:
        # 非月度闸门：保留已有历史序列，只用种子补缺，不丢接口历史
        prev = common.read_js_json(DATA_FILE, "FLOW_DATA", default={})
        m1 = dict(prev.get("m1", {}))
        accounts = dict(prev.get("accounts", {}))

    # 种子只补缺口，不覆盖实抓月份
    for k, v in SEED_M1.items():
        m1.setdefault(k, v)
    for k, v in SEED_ACCOUNTS.items():
        accounts.setdefault(k, v)

    rounds_ref = []
    for row in REF_TOPS:
        row = dict(row)
        if row["m1_status"] == "series":
            pk = local_peak(m1, row["top"])
            if pk:
                row["m1_peak"], row["m1_value"], row["m1_lead"] = pk["peak"], pk["value"], pk["lead"]
        if row["acc_status"] == "series":
            pk = local_peak(accounts, row["top"])
            if pk:
                row["acc_peak"], row["acc_value"], row["acc_lead"] = pk["peak"], pk["value"], pk["lead"]
        rounds_ref.append(row)

    return {
        "generated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "m1": dict(sorted(m1.items())),
        "accounts": dict(sorted(accounts.items())),
        "rounds_ref": rounds_ref,
    }


# ============================================================
# 模块 2：均价月线与派生指标（不联网）
# ============================================================
def monthly_ohlc(ashare):
    """日频 -> 月线：open=首交易日开盘，close=末交易日收盘，high/low=月内极值。"""
    months = {}
    for date, row in sorted(ashare.items()):
        # 【修复】跳过 is_mock 的推算值：那种行是当日源数据没发布时的兜底假数据，
        # 混进月线会把月收盘价带偏（11-26 那条假数据曾让月收盘变成 19.26）。
        if row.get("is_mock") is True:
            continue
        ym = date[:7]
        price = row.get("price")
        m = months.setdefault(ym, {
            "open": None, "high": -1e9, "low": 1e9, "close": None, "date": date,
        })
        if m["open"] is None:
            m["open"] = row.get("open", price)
        m["high"] = max(m["high"], row.get("high", price))
        m["low"] = min(m["low"], row.get("low", price))
        m["close"] = row.get("close", price)  # 最后一个交易日覆盖
        m["date"] = date
    out = []
    for ym in sorted(months):
        m = months[ym]
        out.append({
            "month": ym,
            "open": round(m["open"], 4),
            "high": round(m["high"], 4),
            "low": round(m["low"], 4),
            "close": round(m["close"], 4),
        })
    return out


def sma(values, n):
    res = []
    for i in range(len(values)):
        if i < n - 1:
            res.append(None)
        else:
            res.append(round(sum(values[i - n + 1:i + 1]) / n, 4))
    return res


def build_derived():
    # 【修复】优先读 market/market_data.js，读不到再退回旧的 market/data/ 路径
    market_js = MARKET_JS if os.path.exists(MARKET_JS) else LEGACY_MARKET_JS
    market = common.read_js_json(market_js, "MARKET_DATA", default={})
    ashare = market.get("ashare", {})
    if not ashare:
        raise SystemExit("market_data.js 缺少 ashare 日频数据")

    months = monthly_ohlc(ashare)
    closes = [m["close"] for m in months]
    ma6 = sma(closes, 6)
    ma12 = sma(closes, 12)
    for i, m in enumerate(months):
        m["ma6"] = ma6[i]
        m["ma12"] = ma12[i]
        m["bias12"] = None if ma12[i] is None else round((m["close"] - ma12[i]) / ma12[i] * 100, 2)

    idx = {m["month"]: i for i, m in enumerate(months)}

    # 六轮顶：实测月线值；lag = 顶后首次月收盘跌破 MA6 的月数
    rounds, peaks = [], []
    for pm in PEAK_MONTHS:
        if pm not in idx:
            continue
        i = idx[pm]
        m = months[i]
        lag = None
        for j in range(i + 1, len(months)):
            if months[j]["ma6"] is not None and months[j]["close"] < months[j]["ma6"]:
                lag = j - i
                break
        rounds.append({
            "round": pm[:4], "month": pm,
            "open": m["open"], "high": m["high"], "low": m["low"], "close": m["close"],
            "bias12": m["bias12"], "lag": lag,
        })
        peaks.append({"tag": pm[:4], "month": pm, "high": m["high"], "close": m["close"]})

    # 75% 门槛阶梯：上一轮顶（月内最高）×0.75，顶与顶之间保持不变
    gate = [None] * len(months)
    pk_idx = [idx[p["month"]] for p in peaks]
    for j in range(1, len(peaks)):
        g = round(peaks[j - 1]["high"] * 0.75, 2)
        for k in range(pk_idx[j - 1], pk_idx[j]):
            gate[k] = g

    cur = months[-1]
    prev_high = peaks[-1]["high"]
    gate_now = round(prev_high * 0.75, 2)
    # 连续处于 MA6 下方的月数（末月起向前数，ma6 为空的月份不计）
    below = 0
    for m in reversed(months):
        if m["ma6"] is None:
            continue
        if m["close"] < m["ma6"]:
            below += 1
        else:
            break
    current = {
        "month": cur["month"],
        "close": cur["close"],
        "ma6": cur["ma6"],
        "ma12": cur["ma12"],
        "bias12": cur["bias12"],
        "above_ma6": bool(cur["ma6"] is not None and cur["close"] >= cur["ma6"]),
        "months_below_ma6": below,
        "gate": gate_now,
        "prev_top_high": prev_high,
        "gate_pct": round(cur["close"] / gate_now * 100, 1) if gate_now else None,
        "vs_prev_top": round((cur["close"] / prev_high - 1) * 100, 1),
        "months_since_top": len(months) - 1 - pk_idx[-1],
    }

    return {
        "generated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "bias_gate": BIAS_GATE,
        "months": months,
        "peaks": peaks,
        "rounds": rounds,
        "gate": gate,
        "current": current,
    }


def write_merged(flow_payload, derived_payload):
    """合并写入 top_watch_data.js：FLOW_DATA 在前、DERIVED_DATA 在后，原子替换。"""
    content = (
        common.dump_js("FLOW_DATA", flow_payload) + "\n\n"
        + common.dump_js("DERIVED_DATA", derived_payload) + "\n"
    )
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, DATA_FILE)


def main():
    monthly = os.environ.get("AMC_MONTHLY") == "1" or "--fetch" in sys.argv

    flow_payload = build_flow(monthly)
    derived_payload = build_derived()
    write_merged(flow_payload, derived_payload)

    print(f"[top_watch] M1 {len(flow_payload['m1'])} 个月 / 开户 {len(flow_payload['accounts'])} 个月 / "
          f"月线 {len(derived_payload['months'])} 个月 -> {DATA_FILE}")


if __name__ == "__main__":
    main()
