# -*- coding: utf-8 -*-
"""
A股全市场总市值（沪深 zzshare + 北交所官网）—— 单日模式
=========================================================
功能:
  - 自动定位最近一个交易日（昨天，若是周末/节假日往前找）
  - 北交所：一次拉全量后本地缓存，取目标日期
  - 沪深：拉目标日期，带指数退避重试，本地缓存
  - 结果追加到 a_share_total_mv.csv（同日期自动去重）
  - 定时任务：每天 08:00 执行（默认不开启，见文件末尾）
=========================================================
"""

import re
import os
import json
import time
import datetime
import requests
import pandas as pd
from zzshare.client import DataApi

# ==================== 配置 ====================
OUTPUT_CSV   = "a_share_total_mv.csv"
CACHE_ASHARE = "cache_ashare.json"
CACHE_BSE    = "cache_bse.json"

ZZSHARE_TOKEN = ""
SLEEP_EACH    = 0.3

BSE_OPEN_DATE = "2021-11-15"

# 重试配置（沪深2 次，北交所 2 次）
BSE_RETRY_TIMES    = 1
ASHARE_RETRY_TIMES = 2

BSE_URL = "https://www.bse.cn/marketStatController/dailyReport.do"
BSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://www.bse.cn/static/statisticdata.html",
    "Origin": "https://www.bse.cn",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
}

api = DataApi(token=ZZSHARE_TOKEN) if ZZSHARE_TOKEN else DataApi()


# ==================== 缓存工具 ====================
def load_cache(path):
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[缓存] 读取 {path} 失败: {e}")
    return {}


def save_cache(path, data):
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, path)
    except Exception as e:
        print(f"[缓存] 写入 {path} 失败: {e}")


# ==================== 交易日历 ====================
def get_trade_dates(start_date, end_date):
    """用上证指数日线拿真实交易日列表"""
    start_compact = start_date.replace("-", "")
    end_compact   = end_date.replace("-", "")

    for code in ["000001.SH", "sh000001", "000001"]:
        try:
            df = api.daily(ts_code=code,
                           start_date=start_compact,
                           end_date=end_compact)
            if df is not None and not df.empty and "trade_date" in df.columns:
                dates = sorted(df["trade_date"].astype(str).unique())
                return [f"{d[:4]}-{d[4:6]}-{d[6:]}" for d in dates]
        except Exception:
            continue

    print("[警告] 无法获取交易日历，退回简单工作日")
    return [d.strftime("%Y-%m-%d")
            for d in pd.bdate_range(start=start_date, end=end_date)]


def get_last_trade_date():
    """
    定位"昨天"对应的最近一个交易日：
      - 昨天是交易日 -> 返回昨天
      - 昨天是周末/节假日 -> 往前找最近一个交易日
    """
    today = datetime.date.today()
    start = (today - datetime.timedelta(days=10)).strftime("%Y-%m-%d")
    end   = today.strftime("%Y-%m-%d")

    dates = get_trade_dates(start, end)
    if not dates:
        return None

    yesterday = (today - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    candidates = [d for d in dates if d <= yesterday]
    return candidates[-1] if candidates else None


# ==================== 北交所：全量拉取（用于缓存） ====================
def fetch_bse_all():
    """带指数退避重试的全量拉取；过滤 BSE_OPEN_DATE 之前的记录"""
    print("[北交所] 拉取全量数据 ...")
    bse_open_compact = BSE_OPEN_DATE.replace("-", "")

    for i in range(BSE_RETRY_TIMES):
        try:
            r = requests.post(BSE_URL, data={"date": ""},
                              headers=BSE_HEADERS, timeout=30)
            m = re.search(r"null\((\[.*\])\)", r.text, re.DOTALL)
            if not m:
                raise ValueError("返回格式异常")

            data = json.loads(m.group(1))
            result = {}
            for item in data:
                if item.get("xxzrlx") != "2" or "zsz" not in item or not item.get("rq"):
                    continue
                rq = str(item["rq"])
                if rq < bse_open_compact:
                    continue
                result[rq] = float(item["zsz"]) / 1e8

            print(f"[北交所] 共获取 {len(result)} 个交易日")
            return result

        except Exception as e:
            wait = 2 ** i
            print(f"[北交所] 第 {i+1}/{BSE_RETRY_TIMES} 次失败: {e}，{wait}s 后重试")
            if i < BSE_RETRY_TIMES - 1:
                time.sleep(wait)

    print("[北交所] 全部重试失败，返回空")
    return {}


# ==================== 沪深：单日拉取 + 指数退避 ====================
def get_ashare_total_mv(date_str, retries=ASHARE_RETRY_TIMES):
    """带指数退避重试的沪深全市场总市值获取"""
    for i in range(retries):
        try:
            df = api.finance_valuation(date_str)
            if df is None or df.empty:
                return None, None, None, 0

            code = df["code"].astype(str)
            sse_mask  = code.str.endswith((".SH", ".KSH"))
            szse_mask = code.str.endswith((".SZ", ".GEM"))

            sse_mv  = float(df.loc[sse_mask,  "market_cap"].sum())
            szse_mv = float(df.loc[szse_mask, "market_cap"].sum())
            total   = float(df["market_cap"].sum())

            return total, sse_mv, szse_mv, len(df)

        except Exception as e:
            wait = 2 ** i
            print(f"  [zzshare {date_str}] 第 {i+1}/{retries} 次失败: {e}，{wait}s 后重试")
            if i < retries - 1:
                time.sleep(wait)

    return None, None, None, 0


# ==================== 单日任务 ====================
def run_once():
    """拉取最近一个交易日的数据，追加到 CSV"""
    target_date = get_last_trade_date()
    if target_date is None:
        print("[跳过] 无法确定目标交易日")
        return

    print(f"\n{'='*60}")
    print(f"目标交易日: {target_date}")
    print(f"{'='*60}")

    # ---------- 北交所 ----------
    bse_cache = load_cache(CACHE_BSE)
    if not bse_cache:
        bse_cache = fetch_bse_all()
        save_cache(CACHE_BSE, bse_cache)
    else:
        print("[北交所] 使用本地缓存")
    bse_mv = bse_cache.get(target_date.replace("-", ""))

    # ---------- 沪深 ----------
    ashare_cache = load_cache(CACHE_ASHARE)
    if target_date in ashare_cache:
        c = ashare_cache[target_date]
        ashare_total = c.get("ashare_total")
        sse_mv       = c.get("sse_mv")
        szse_mv      = c.get("szse_mv")
        cnt          = c.get("cnt", 0)
        tag = "缓存"
    else:
        ashare_total, sse_mv, szse_mv, cnt = get_ashare_total_mv(target_date)
        tag = "新拉"
        if ashare_total is not None:
            ashare_cache[target_date] = {
                "ashare_total": ashare_total,
                "sse_mv": sse_mv,
                "szse_mv": szse_mv,
                "cnt": cnt,
            }
            save_cache(CACHE_ASHARE, ashare_cache)

    # ---------- 汇总 ----------
    record = {
        "date": target_date,
        "sse_mv_yi":  round(sse_mv,  2) if sse_mv  is not None else None,
        "szse_mv_yi": round(szse_mv, 2) if szse_mv is not None else None,
        "bse_mv_yi":  round(bse_mv,  2) if bse_mv  is not None else None,
        "stock_count": cnt,
    }

    if ashare_total is not None and bse_mv is not None:
        record["total_mv_yi"] = round(ashare_total + bse_mv, 2)
    elif ashare_total is not None:
        record["total_mv_yi"] = round(ashare_total, 2)
    else:
        record["total_mv_yi"] = None

    a_str = f"{ashare_total:.2f}" if ashare_total is not None else "None"
    b_str = f"{bse_mv:.2f}" if bse_mv is not None else "None"
    t_str = f"{record['total_mv_yi']:.2f}" if record["total_mv_yi"] is not None else "None"
    print(f"[{target_date}] ({tag})  沪深 {a_str} | 北交所 {b_str} | 合计 {t_str}")

    # ---------- 追加 CSV（同日期去重） ----------
    df_new = pd.DataFrame([record])
    if os.path.exists(OUTPUT_CSV):
        df_old = pd.read_csv(OUTPUT_CSV)
        df_old = df_old[df_old["date"] != target_date]      # 去掉旧记录，避免重复
        df_out = pd.concat([df_old, df_new], ignore_index=True)
    else:
        df_out = df_new

    df_out = df_out.sort_values("date").reset_index(drop=True)
    df_out.to_csv(OUTPUT_CSV, index=False, encoding="utf-8-sig")
    print(f"[输出] 已写入 {OUTPUT_CSV}（共 {len(df_out)} 行）")


# ==================== 主流程 ====================
def main():
    try:
        run_once()
    except KeyboardInterrupt:
        print("\n!!! 用户中断")
    except Exception as e:
        print(f"\n!!! 执行异常: {e}")


if __name__ == "__main__":
    main()


# ==================== 定时任务（默认不开启，需要时取消注释） ====================
# 依赖: pip install schedule
#
# import schedule
#
# def scheduled_job():
#     print(f"\n[{datetime.datetime.now()}] 定时任务触发")
#     try:
#         run_once()
#     except Exception as e:
#         print(f"定时任务执行失败: {e}")
#
# schedule.every().day.at("08:00").do(scheduled_job)
#
# if __name__ == "__main__":
#     print("定时任务已启动，每天 08:00 执行")
#     schedule.run_pending()  # 立即检查一次
#     while True:
#         schedule.run_pending()
#         time.sleep(30)