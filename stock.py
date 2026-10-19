# -*- coding: utf-8 -*-
"""
A股全市场总市值 + 平均股价 —— 单日模式，写入 market_data.js
=========================================================
功能:
  - 最高优先级：先判断今天是否交易日
        - 今天不是交易日（周末/节假日）-> 立即结束脚本，不做任何文件读写
        - 今天是交易日                ->git 取 T-1 交易日数据
  - 沪深：api.finance_valuation 拉目标日期总市值（沪 / 深 / 合计 / 只数）
  - 北交所：只请求一次，提取目标日期总市值（不做全量缓存）
  - 平均股价：api.daily 拉目标日全市场平均收盘价（close > 0 且 vol > 0）
  - 把结果合并进 market_data.js（同日期自动更新）
  - market_data.js 中 ashare / bse 按日期降序排列（最新在前）
  - 定时任务：每天 08:00 触发，内部判断今天是否交易日，非交易日直接结束
=========================================================
"""

import re
import os
import sys
import json
import time
import datetime
import requests
import pandas as pd
import akshare as ak
from zzshare.client import DataApi

# ==================== 配置 ====================
MARKET_DATA_JS = "market_data.js"

# 优先从环境变量读取 Token（适配 GitHub Actions），如果没有则留空
ZZSHARE_TOKEN = os.getenv("ZZSHARE_TOKEN", "")
BSE_RETRY_TIMES = 2

BSE_URL = "https://www.bse.cn/marketStatController/dailyReport.do"
BSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://www.bse.cn/static/statisticdata.html",
    "Origin": "https://www.bse.cn",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
}

api = DataApi(token=ZZSHARE_TOKEN) if ZZSHARE_TOKEN else DataApi()

# ==================== 交易日历（AkShare 新浪交易日历） ====================
_TRADE_DATES = None


def _load_trade_dates():
    """全量日历，进程内只请求一次。"""
    global _TRADE_DATES
    if _TRADE_DATES is None:
        df = ak.tool_trade_date_hist_sina()
        _TRADE_DATES = pd.to_datetime(df["trade_date"]).sort_values().reset_index(drop=True)
    return _TRADE_DATES


def get_trade_dates(start_date, end_date):
    """返回区间内的真实交易日列表"""
    dates = _load_trade_dates()
    s, e = pd.Timestamp(start_date), pd.Timestamp(end_date)
    return dates[(dates >= s) & (dates <= e)].dt.strftime("%Y-%m-%d").tolist()


def is_trade_date(date_str):
    """判断某日是否交易日"""
    return pd.Timestamp(date_str) in _load_trade_dates().values


def get_prev_trade_date():
    """返回上一个交易日（调用前应已确认今天是交易日）"""
    dates = _load_trade_dates()
    today = pd.Timestamp.today().normalize()
    return dates[dates < today].max().strftime("%Y-%m-%d")


# ==================== 北交所：只取目标日期总市值 ====================
def get_bse_mv(trade_date):
    """北交所目标日期总市值（亿元），只挑出目标日期那一条，不做本地缓存"""
    target_compact = trade_date.replace("-", "")

    for i in range(BSE_RETRY_TIMES):
        try:
            r = requests.post(BSE_URL, data={"date": ""}, headers=BSE_HEADERS, timeout=30)
            m = re.search(r"null\((\[.*\])\)", r.text, re.DOTALL)
            if not m:
                raise ValueError("返回格式异常")

            for item in json.loads(m.group(1)):
                if (item.get("xxzrlx") == "2"
                        and str(item.get("rq", "")) == target_compact
                        and "zsz" in item):
                    mv = float(item["zsz"]) / 1e8
                    print(f"[北交所] {trade_date} 总市值 {mv:.4f} 亿")
                    return mv

            print(f"[北交所] 未找到 {trade_date} 的数据")
            return None

        except Exception as e:
            wait = 2 ** i
            print(f"[北交所] 第 {i + 1}/{BSE_RETRY_TIMES} 次失败: {e}，{wait}s 后重试")
            if i < BSE_RETRY_TIMES - 1:
                time.sleep(wait)

    print("[北交所] 全部重试失败，返回 None")
    return None


# ==================== 沪深：单日拉取 + 指数退避 ====================
def get_ashare_total_mv(date_str, retries=2):
    """带指数退避重试的沪深全市场总市值获取"""
    for i in range(retries):
        try:
            df = api.finance_valuation(date_str.replace("-", ""))
            if df is None or df.empty:
                return None, None, None, 0

            code = df["code"].astype(str)
            sse_mv = float(df.loc[code.str.endswith((".SH", ".KSH")), "market_cap"].sum())
            szse_mv = float(df.loc[code.str.endswith((".SZ", ".GEM")), "market_cap"].sum())
            total = float(df["market_cap"].sum())

            return total, sse_mv, szse_mv, len(df)

        except Exception as e:
            wait = 2 ** i
            print(f"  [zzshare {date_str}] 第 {i + 1}/{retries} 次失败: {e}，{wait}s 后重试")
            if i < retries - 1:
                time.sleep(wait)

    return None, None, None, 0


# ==================== 平均股价：单日平均收盘价 ====================
def get_avg_close(trade_date):
    """获取指定交易日全市场平均收盘价（close > 0 且 vol > 0）"""
    try:
        df = api.daily(trade_date=trade_date.replace("-", ""), offset=0, limit=6000)
    except Exception as e:
        print(f"  [平均股价] 获取失败: {e}")
        return None

    if df is None or len(df) == 0:
        return None

    missing = [c for c in ("close", "vol") if c not in df.columns]
    if missing:
        print(f"  [平均股价] 缺字段: {missing}")
        return None

    traded = df[(df["close"] > 0) & (df["vol"] > 0)]
    return float(traded["close"].mean()) if len(traded) else None


# ==================== market_data.js 读写 ====================
def load_market_data():
    if not os.path.exists(MARKET_DATA_JS):
        return {"ashare": {}, "bse": {}, "meta": {},
                "annual": [], "gdp_annual": {}}

    with open(MARKET_DATA_JS, "r", encoding="utf-8") as f:
        content = f.read()

    start = content.find("{")
    end = content.rfind("}")
    if start < 0 or end < 0:
        raise ValueError("无法定位 market_data.js 中的 JSON")

    return json.loads(content[start:end + 1])


def save_market_data(data):
    # 按日期降序（最新在前）
    for key in ("ashare", "bse"):
        if isinstance(data.get(key), dict):
            data[key] = dict(sorted(data[key].items(),
                                     key=lambda kv: kv[0], reverse=True))

    out = "window.MARKET_DATA = " + json.dumps(
        data, ensure_ascii=False, separators=(",", ":")) + ";"

    tmp = MARKET_DATA_JS + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(out)
    os.replace(tmp, MARKET_DATA_JS)


# ==================== 单日任务 ====================
def run_once():
    # ---------- 最高优先级：判断今天是否交易日 ----------
    # 一旦不是交易日，立即结束脚本，不读写任何文件、不调用后续接口
    today_str = datetime.date.today().strftime("%Y-%m-%d")
    if not is_trade_date(today_str):
        print(f"[结束] 今天 {today_str} 不是交易日，跳过（不修改任何文件）")
        return

    # ---------- 定位 T-1 交易日 ----------
    target_date = get_prev_trade_date()
    if target_date is None:
        raise ValueError("[错误] 无法确定上一个交易日，终止执行")

    print(f"\n{'=' * 60}")
    print(f"目标交易日 (T-1): {target_date}")
    print(f"{'=' * 60}")

    # ---------- 读取现有数据并计算需要补齐的真实交易日 ----------
    data = load_market_data()
    existing_dates = list(data.get("ashare", {}))

    # 无论是否补缺，T-1当天必须是最新的
    dates_to_fetch = {target_date}

    if existing_dates:
        latest_date = max(existing_dates)
        # 如果库里存的最新数据，比 T-1 还要老，说明中间漏掉了真实交易日
        if latest_date < target_date:
            print(f"[检查] 库中最新为 {latest_date}，落后于 T-1 ({target_date})，准备补全中间缺失的交易日")
            # 获取两个日期之间的所有真实交易日
            dates_to_fetch.update(
                d for d in get_trade_dates(latest_date, target_date)
                if d not in existing_dates
            )

    dates_to_fetch = sorted(dates_to_fetch)
    print(f"[执行] 本次需要抓取的交易日列表: {dates_to_fetch}")

    # 遍历执行抓取（通常只有1天，只有在断档恢复时才会有多天）
    for date_str in dates_to_fetch:
        print(f"\n--- 开始处理 {date_str} ---")

        # ---------- 沪深 ----------
        ashare_total, sse_mv, szse_mv, cnt = get_ashare_total_mv(date_str)
        a_str = f"{ashare_total:.2f}" if ashare_total is not None else "None"
        print(f"[沪深] 合计 {a_str} | 沪 {sse_mv} | 深 {szse_mv} | {cnt} 只")

        # ---------- 北交所（只取目标日期） ----------
        bse_mv = get_bse_mv(date_str)

        # ---------- 平均股价 ----------
        avg_close = get_avg_close(date_str)
        print(f"[平均股价] 平均收盘价 {avg_close:.4f} 元" if avg_close is not None
              else "[平均股价] 无数据")

        # ---------- 【严格校验】如果核心数据抓不到，立刻报错，防止脏数据覆盖 ----------
        if ashare_total is None or ashare_total <= 0:
            raise ValueError(f"[错误] {date_str} 沪深总市值获取失败，终止写入！")
        if avg_close is None or avg_close <= 0:
            raise ValueError(f"[错误] {date_str} 平均股价获取失败，终止写入！")

        # ---------- 组装记录 ----------
        record = {
            "ashare_total": round(ashare_total, 4),
            "sse_mv": round(sse_mv, 4) if sse_mv is not None else None,
            "szse_mv": round(szse_mv, 4) if szse_mv is not None else None,
            "cnt": cnt,
        }

        # 只取平均收盘价，open/high/low/close/price 统一写该值
        v = round(avg_close, 4)
        record.update(price=v, open=v, high=v, low=v, close=v)

        # ---------- 合并进内存数据 ----------
        data.setdefault("ashare", {})[date_str] = record
        if bse_mv is not None:
            data.setdefault("bse", {})[date_str.replace("-", "")] = round(bse_mv, 4)

        b_str = f"{bse_mv:.2f}" if bse_mv is not None else "None"
        t_str = (f"{ashare_total + bse_mv:.2f}"
                 if bse_mv is not None else f"{ashare_total:.2f}")
        print(f"[{date_str}] 沪深 {a_str} | 北交所 {b_str} | 合计 {t_str}")

    # ---------- 统一写入文件 ----------
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    meta = data.setdefault("meta", {})
    meta["generated_at"] = now
    meta["avg_price_updated_at"] = now
    meta["version"] = 2
    meta["avg_price_fields"] = ["open", "high", "low", "close", "price"]

    save_market_data(data)
    print(f"\n[输出] 已更新 {MARKET_DATA_JS}（共 {len(data['ashare'])} 个沪深交易日）")


# ==================== 主流程 ====================
def main():
    try:
        run_once()
    except KeyboardInterrupt:
        print("\n!!! 用户中断")
        sys.exit(1)
    except Exception as e:
        print(f"\n!!! 执行异常: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()

