#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""两融余额的 T-1 增量更新（只维护同目录的 two_melt_data.js）。

只保留信号用得到的列：日期、两融余额。若需要别的字段，请到对应脚本取。
请求次数由「js 里的 end」与「实际 T-1 交易日」的差额决定：一致时只读文件头部即返回。
"""
import datetime
import os
import re
import subprocess
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
JS_NAME = "two_melt_data.js"     # 数据文件名；改名只需改这里，找不到会自动扫同目录 js
VAR_NAME = "MARGIN_DATA"

# 复用 ../common/common.py（交易日历、window 格式 JS 读写、退避重试）
sys.path.append(os.path.join(os.path.dirname(BASE_DIR), "common"))
import common  # noqa: E402

import requests  # noqa: E402

EM_API = "https://datacenter-web.eastmoney.com/api/data/v1/get"
EM_HEADERS = {"User-Agent": "Mozilla/5.0", "Referer": "https://data.eastmoney.com/rzrq/"}
YI = 1e8    # 元 → 亿元
WAN = 1e4   # 万元 → 亿元

# 数据列顺序：与 js 中 rows 的每个数组一一对应
FIELDS = ["date", "两融余额"]

SZSE_RETRY = 3   # 深交所接口偶发超时，固定重试 3 次


# ---------------------------------------------------------------- js 读写

def resolve_js():
    """定位数据文件：优先 JS_NAME，找不到就取同目录里第一个含 MARGIN_DATA 的 js。"""
    exact = os.path.join(BASE_DIR, JS_NAME)
    if os.path.exists(exact):
        return exact
    found = []
    for name in sorted(os.listdir(BASE_DIR)):
        if not name.endswith(".js"):
            continue
        with open(os.path.join(BASE_DIR, name), encoding="utf-8") as f:
            head = f.read(400)
        if VAR_NAME in head or "MARGIN_META" in head:
            found.append(name)
    if found:
        print(f"未找到 {JS_NAME}，改用同目录的 {found[0]}")
        return os.path.join(BASE_DIR, found[0])
    raise SystemExit(f"{BASE_DIR} 下没有任何含 {VAR_NAME} 的 js 文件，"
                     f"现有 js：{[n for n in os.listdir(BASE_DIR) if n.endswith('.js')]}")


def peek_meta(path):
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


def load_js(path):
    """读 window.MARGIN_DATA 结构；不存在返回 None。"""
    return common.read_js_json(path, VAR_NAME, default=None)


def save_js(payload, path):
    """写回 window.MARGIN_DATA（紧凑单行 + 原子替换，由 common 负责）。"""
    common.write_js_json(path, VAR_NAME, payload, indent=None, newline=True, atomic=True)


def normalize(payload):
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
        "fields": FIELDS,
        "unit": {"两融余额": "亿元"},
        "note": "rows 按日期降序（最新在前）；两融余额单位亿元，保留 2 位小数",
        "built_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
    })
    for k in ("missing_turnover", "missing_index"):
        meta.pop(k, None)
    payload["meta"] = meta
    return payload


# ---------------------------------------------------------------- 两融取数

def sse_margin(date):
    """上交所两融 → (融资余额, 融资买入额, 融券余额, 两融余额)，亿元。"""
    import akshare as ak

    df = common.with_retry(lambda: ak.stock_margin_sse(start_date=date.replace("-", ""),
                                                      end_date=date.replace("-", "")),
                           times=2, label=f"上交所两融 {date}")
    if df is None or df.empty:
        return None
    row = df.iloc[0]
    return (float(row["融资余额"]) / YI, float(row["融资买入额"]) / YI,
            float(row["融券余量金额"]) / YI, float(row["融资融券余额"]) / YI)


def szse_margin(date):
    """深交所两融 → (融资余额, 融资买入额, 融券余额, 两融余额)，亿元。"""
    import akshare as ak

    df = common.with_retry(lambda: ak.stock_margin_szse(date=date.replace("-", "")),
                           times=SZSE_RETRY, label=f"深交所两融 {date}")
    if df is None or df.empty:
        return None
    row = df[df.iloc[:, 0].astype(str).str.contains("合计|总计", na=False)]
    row = row.iloc[0] if len(row) else df.iloc[0]

    vals = []
    for names in (("融资余额",), ("融资买入额", "融资买入金额"),
                  ("融券余额", "融券余量金额"), ("融资融券余额",)):
        found = None
        for name in names:
            for col in df.columns:
                if name in str(col):
                    v = row[col]
                    if v == v:  # 非 NaN
                        found = float(v)
                        break
            if found is not None:
                break
        if found is None:
            return None
        # 深交所该表单位是亿元（个别版本给元），按量级判断，避免差 1e8 倍
        vals.append(found / YI if found > 1e6 else found)
    return tuple(vals)


def bse_margin(date):
    """北交所两融（万元）→ (融资余额, 融资买入额, 融券余额, 两融余额)，亿元。"""
    import akshare as ak

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


# ---------------------------------------------------------------- 组装一行

def _usable(m):
    """某个市场的数据是否可用：四项齐全、两融余额为正。"""
    return (m is not None and len(m) >= 4
            and m[3] is not None and m[3] > 0)


def build_row(date):
    """组装 [日期, 两融余额]。沪深两融的「两融余额」相加，北交所能取到也加上。"""
    sse_m = sse_margin(date)
    szse_m = szse_margin(date)
    bse_m = bse_margin(date)

    snap = None
    if not _usable(sse_m) or not _usable(szse_m):
        snap = em_snapshot(date)
    if snap:
        if not _usable(sse_m) and snap["沪"]:
            sse_m = (None, None, None, snap["沪"])
        if not _usable(szse_m) and snap["深"]:
            szse_m = (None, None, None, snap["深"])

    # 沪深都拿到才算完整的一天；深交所当日未发布时兜底可能给 None，这里挡掉
    if not _usable(sse_m) or not _usable(szse_m):
        raise RuntimeError(f"{date} 沪深两融未发布（沪 {sse_m} 深 {szse_m}），跳过不写")

    total = sse_m[3] + szse_m[3]
    if bse_m is not None and bse_m[3] and bse_m[3] > 0:
        total += bse_m[3]
    return [date, round(total, 2)]


# ---------------------------------------------------------------- 主流程

def main():
    # 同目录有 build_nav.py 就顺手刷新侧边栏导航（新增 html 后跑本脚本即生效）
    for cand in (os.path.join(os.path.dirname(BASE_DIR), "common", "build_nav.py"),
                 os.path.join(BASE_DIR, "common", "build_nav.py"),
                 os.path.join(os.path.dirname(BASE_DIR), "build_nav.py")):
        if os.path.isfile(cand):
            try:
                subprocess.run([sys.executable, cand],
                               cwd=os.path.dirname(os.path.dirname(cand)),
                               check=False, timeout=20)
            except Exception as exc:
                print(f"nav.js 未更新：{exc}")
            break

    js = resolve_js()
    target = common.last_trade_date().isoformat()   # 严格早于今天 = T-1
    end, stale = peek_meta(js)
    print(f"js 里 end={end}，T-1 交易日={target}")

    if end == target and not stale:                 # 已最新且列已裁好：不读全量
        print("已是最新，跳过拉取")
        return

    payload = load_js(js)
    if payload is None or "rows" not in payload:
        raise SystemExit(f"{os.path.basename(js)} 结构不对：需要 window.{VAR_NAME} = {{\"meta\":..., \"rows\":[...]}}")

    rows_all = payload["rows"]
    last = rows_all[0][0]                           # 日期降序，第一行即最新

    pending = [d.isoformat() for d in common.get_trade_dates(last, target) if d.isoformat() > last]
    print(f"缺口 {len(pending)} 个交易日：{pending[0]} ~ {pending[-1]}" if pending else "无缺口")

    index = {r[0]: i for i, r in enumerate(rows_all)}
    for date in pending:
        try:
            row = build_row(date)
        except Exception as exc:
            print(f"  {date} 跳过：{type(exc).__name__} {exc}")
            continue
        if date in index:
            rows_all[index[date]] = row
        else:
            rows_all.append(row)
        print(f"  {date}：两融 {row[1]} 亿")

    normalize(payload)
    save_js(payload, js)
    print(f"已更新 {js}：{payload['meta']['count']} 行，最新 {payload['meta']['end']}")


if __name__ == "__main__":
    main()
