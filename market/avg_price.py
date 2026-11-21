# -*- coding: utf-8 -*-
"""
A股全市场总市值 + 平均股价 —— 单日模式，写入 market_data.js
=========================================================
功能:
  - 今天是否交易日由总调度（common/central_control.py）统一判断，本脚本不再自己判断：
        - 不是交易日（周末/节假日）-> 调度根本不会调用本脚本
        - 是交易日                -> 取当天数据（调度放在 22:00 之后跑，收盘数据已发布）
  - 沪深：api.finance_valuation 拉目标日期总市值（沪 / 深 / 合计）
  - 北交所：只请求一次，提取目标日期总市值（不做全量缓存）
  - 平均股价：api.daily 拉目标日全市场平均收盘价（close > 0 且 vol > 0）
  - 把结果合并进 market_data.js（同日期自动更新）
  - market_data.js 中 ashare 按日期降序排列（最新在前）
  - 定时任务：每个交易日 22:00 之后触发 common/central_control.py，交易日判断由调度负责
=========================================================

公共部分（交易日历、market_data.js 读写、退避重试）已抽到 common 包（common/__init__.py）。
"""

import re
import os
import json
import sys
import datetime
import requests
import traceback

from zzshare.client import DataApi

# 直接跑 market/avg_price.py 时，sys.path[0] 只有 market/，项目根不在里面，
# 于是 import common 找不到项目根下的 common/ 包（IDE 里靠 PYTHONPATH 才碰巧能找到）。
# 这里显式把项目根插到最前面，不依赖 IDE 配置、也不依赖从哪个目录启动。
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import common

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

# ==================== 交易日历 ====================
# 日历的加载与缓存全在 common 包（common/__init__.py），与 etf_share.py、top_base.py 共用同一份缓存。
# 原来这里还有 get_trade_dates / is_trade_date 两个只做转发的空壳，随着交易日判断上移到
# 调度、以及 T-1 改成当天，都已经没有调用者，删掉；需要时直接调 common.xxx。


# 【改动】原来这里有个 get_prev_trade_date()，取严格早于今天的交易日。
# 现在调度挪到 22:00 之后跑，当天数据已经发布，直接以当天为目标日，这个函数不再需要。


# ==================== 北交所：只取目标日期总市值 ====================
def get_bse_mv(trade_date):
    """北交所目标日期总市值（亿元），只挑出目标日期那一条，不做本地缓存"""
    target_compact = trade_date.replace("-", "")

    def _fetch():
        r = requests.post(BSE_URL, data={"date": ""}, headers=BSE_HEADERS, timeout=30)
        m = re.search(r"null\((\[.*\])\)", r.text, re.DOTALL)
        if not m:
            raise ValueError("返回格式异常")

        for item in json.loads(m.group(1)):
            if (item.get("xxzrlx") == "2"
                    and str(item.get("rq", "")) == target_compact
                    and "zsz" in item):
                return float(item["zsz"]) / 1e8
        return None  # 接口通了但目标日期没有数据

    mv = common.with_retry(_fetch, times=BSE_RETRY_TIMES, label="北交所")

    if mv is None:
        print(f"[北交所] 未找到 {trade_date} 的数据")
        return None

    print(f"[北交所] {trade_date} 总市值 {mv:.1f} 亿")
    return mv


# ==================== 沪深：单日拉取 + 指数退避 ====================
def get_ashare_total_mv(date_str, retries=2):
    """带指数退避重试的沪深全市场总市值获取"""

    def _fetch():
        df = api.finance_valuation(date_str.replace("-", ""))
        if df is None or df.empty:
            return None

        code = df["code"].astype(str)
        sse_mv = float(df.loc[code.str.endswith((".SH", ".KSH")), "market_cap"].sum())
        szse_mv = float(df.loc[code.str.endswith((".SZ", ".GEM")), "market_cap"].sum())
        total = float(df["market_cap"].sum())

        return total, sse_mv, szse_mv

    result = common.with_retry(_fetch, times=retries, label=f"zzshare {date_str}")
    return result if result else (None, None, None)


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
# 解析与落盘（含 .tmp + os.replace 的原子写）统一在 common 包，这里只保留业务约定：
# 缺文件时的空结构、ashare 按日期降序。
def load_market_data():
    return common.read_js_json(
        MARKET_DATA_JS,
        default={"ashare": {}, "meta": {}, "annual": [], "gdp_annual": {}},
    )


def save_market_data(data):
    # 按日期降序（最新在前）
    if isinstance(data.get("ashare"), dict):
        data["ashare"] = dict(sorted(data["ashare"].items(),
                                     key=lambda kv: kv[0], reverse=True))

    common.write_js_json(MARKET_DATA_JS, "MARKET_DATA", data, newline=False)


# ==================== 单日任务 ====================
def run_once():
    # ---------- 交易日判断已上移到总调度（common/central_control.py） ----------
    # 原来这里先判断今天是否交易日、不是就直接 return；现在由调度统一判，
    # 只有交易日才会调用本脚本，这里不再重复请求交易日历。
    # 单独手动跑也不会误写：非交易日跑只是把最近那个交易日重抓一遍，结果幂等。

    # ---------- 目标日 = 当天 ----------
    # 22:00 之后当天收盘的总市值、均价都已发布，不再往前取 T-1。
    today_str = datetime.date.today().strftime("%Y-%m-%d")
    target_date = today_str

    print(f"\n{'=' * 60}")
    print(f"目标交易日: {target_date}")
    print(f"{'=' * 60}")

    # ---------- 读取现有数据并计算需要补齐的真实交易日 ----------
    data = load_market_data()
    existing_dates = list(data.get("ashare", {}))

    # 无论是否补缺，当天必须是最新的
    dates_to_fetch = {target_date}

    # 【修复逻辑】只要库中发现 is_mock=True 的模拟数据，就加入重跑队列强制重试
    for d, record in data.get("ashare", {}).items():
        if record.get("is_mock") is True:
            dates_to_fetch.add(d)

    dates_to_fetch = sorted(dates_to_fetch)
    print(f"[执行] 本次需要抓取或重试的交易日列表: {dates_to_fetch}")

    # 遍历执行抓取
    for date_str in dates_to_fetch:
        print(f"\n--- 开始处理 {date_str} ---")

        # ---------- 沪深 ----------
        ashare_total, sse_mv, szse_mv = get_ashare_total_mv(date_str)
        a_str = f"{ashare_total}" if ashare_total is not None else "None"
        print(f"[沪深] 合计 {a_str} | 沪 {sse_mv} | 深 {szse_mv} ")

        # ---------- 北交所（只取目标日期） ----------
        bse_mv = get_bse_mv(date_str)

        # ---------- 平均股价 ----------
        avg_close = get_avg_close(date_str)
        print(f"[平均股价] 平均收盘价 {avg_close:.2f} 元" if avg_close is not None
              else "[平均股价] 无数据")

        # ---------- 【修复逻辑】精细化容错处理 ----------
        if ashare_total is None or ashare_total <= 0 or avg_close is None or avg_close <= 0:
            print(f"⚠️ [警告] {date_str} 数据存在缺失，启用推断兜底...")

            existing_keys = sorted([k for k in data.get("ashare", {}).keys() if k < date_str])

            # 情况 1：均价抓到了，总市值没抓到
            if avg_close is not None and avg_close > 0 and len(existing_keys) >= 1:
                last_day = existing_keys[-1]
                last_record = data["ashare"][last_day]

                # 用真实的今日均价与昨日均价计算涨跌幅
                price_chg = (avg_close / last_record["price"]) - 1
                price_chg = max(-0.15, min(0.15, price_chg))  # 限制极端情况

                # 推算今天的三所合计总市值
                mv_mock = round(last_record["ashare_total"] * (1 + price_chg))

                v_mock = round(avg_close, 2)
                record = {
                    "ashare_total": mv_mock,
                    "price": v_mock, "open": v_mock, "high": v_mock, "low": v_mock, "close": v_mock,
                    "is_mock": True
                }
                data.setdefault("ashare", {})[date_str] = record
                print(f"⚠️ [兜底] 均价抓取成功({v_mock}元)，据此推算总市值：{mv_mock}")
                continue

            # 情况 2：均价和总市值都没抓到，才使用前两日差分推算
            elif len(existing_keys) >= 2:
                last_day = existing_keys[-1]
                prev_day = existing_keys[-2]

                last_record = data["ashare"][last_day]
                prev_record = data["ashare"][prev_day]

                price_diff = last_record["price"] - prev_record["price"]
                mv_diff = last_record["ashare_total"] - prev_record["ashare_total"]

                v_mock = round(last_record["price"] + price_diff, 2)
                mv_mock = round(last_record["ashare_total"] + mv_diff)

                if v_mock <= 0: v_mock = last_record["price"]
                if mv_mock <= 0: mv_mock = last_record["ashare_total"]

                record = {
                    "ashare_total": mv_mock,
                    "price": v_mock, "open": v_mock, "high": v_mock, "low": v_mock, "close": v_mock,
                    "is_mock": True
                }
                data.setdefault("ashare", {})[date_str] = record
                print(f"⚠️ [兜底] 均价与总市值均缺失，按历史差分推算：{v_mock}")
                continue

            elif len(existing_keys) == 1:
                last_record = data["ashare"][existing_keys[-1]]
                record = last_record.copy()
                record["is_mock"] = True
                data.setdefault("ashare", {})[date_str] = record
                print(f"⚠️ [兜底] 历史数据不足，直接沿用 {existing_keys[-1]} 的数据模拟 {date_str}")
                continue
            else:
                print(f"❌ [错误] 找不到历史数据做兜底，跳过 {date_str}。")
                continue

        # ---------- 组装记录（如果抓取成功，直接覆盖掉之前的 is_mock 假数据） ----------
        total_mv = ashare_total + (bse_mv or 0.0)
        record = {
            "ashare_total": round(total_mv),
        }

        v = round(avg_close, 2)
        record.update(price=v, open=v, high=v, low=v, close=v)

        data.setdefault("ashare", {})[date_str] = record

        b_str = f"{bse_mv:.2f}" if bse_mv is not None else "None"
        print(f"✅ [{date_str}] 已获取真实数据: 沪深 {a_str} | 北交所 {b_str} | 合计 {total_mv}")

    # ---------- 统一写入文件 ----------
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    meta = data.setdefault("meta", {})
    meta["generated_at"] = now
    meta["avg_price_updated_at"] = now
    meta["version"] = 3
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
        traceback.print_exc()
        exit(1)


if __name__ == "__main__":
    main()