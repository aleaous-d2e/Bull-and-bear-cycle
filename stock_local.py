# -*- coding: utf-8 -*-
import os
import json
import math
import datetime

# 你下载的数据文件，请将 jQueryxxx.txt 重命名为这个
INPUT_FILE = "avg_price_data.txt"
JS_FILE = "market_data.js"


def safe_round(v, n=4):
    """安全转换数字"""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return round(f, n)


def load_market_data():
    if not os.path.exists(JS_FILE):
        return {"ashare": {}, "bse": {}, "meta": {}, "annual": [], "gdp_annual": {}}
    with open(JS_FILE, "r", encoding="utf-8") as f:
        content = f.read()
    start = content.find("{")
    end = content.rfind("}")
    if start < 0 or end < 0:
        raise ValueError("无法在 JS 文件中定位 JSON 数据")
    return json.loads(content[start:end + 1])


def save_market_data(data):
    if isinstance(data.get("ashare"), dict):
        data["ashare"] = dict(sorted(data["ashare"].items(), key=lambda kv: kv[0], reverse=True))
    if isinstance(data.get("bse"), dict):
        data["bse"] = dict(sorted(data["bse"].items(), key=lambda kv: kv[0], reverse=True))

    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    out = "window.MARKET_DATA = " + payload + ";"

    tmp = JS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(out)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, JS_FILE)
    print(f"[成功] 已保存更新至 {JS_FILE}")


def main():
    if not os.path.exists(INPUT_FILE):
        print(f"[错误] 找不到文件: {INPUT_FILE}，请重命名或修改脚本中的 INPUT_FILE")
        return

    # 1. 读取并剥离 JSONP
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        text = f.read()

    s_idx = text.find('(')
    e_idx = text.rfind(')')
    if s_idx == -1 or e_idx == -1:
        print("[错误] 文件格式不是标准的 JSONP 格式（缺少括号）")
        return

    json_str = text[s_idx + 1: e_idx]
    try:
        raw_data = json.loads(json_str)
    except Exception as e:
        print(f"[错误] 解析 JSON 失败: {e}")
        return

    klines = raw_data.get("data", {}).get("klines", [])
    if not klines:
        print("[错误] 未找到 K 线数据 (klines)")
        return

    # 2. 解析 K 线：日期,开盘,收盘,最高,最低,...
    parsed_records = []
    for line in klines:
        parts = line.split(",")
        if len(parts) < 5:
            continue

        date_str = parts[0]
        o = safe_round(parts[1])
        c = safe_round(parts[2])
        h = safe_round(parts[3])
        l = safe_round(parts[4])

        parsed_records.append({
            "date": date_str,
            "open": o,
            "close": c,
            "high": h,
            "low": l,
            "price": c  # 将收盘价作为平均价 price
        })

    if not parsed_records:
        print("[错误] 解析后没有有效的 OHLC 数据")
        return

    # 3. 过滤近一个月的数据
    latest_date_str = max(r["date"] for r in parsed_records)
    latest_date = datetime.datetime.strptime(latest_date_str, "%Y-%m-%d").date()
    one_month_ago = latest_date - datetime.timedelta(days=30)

    recent_records = [
        r for r in parsed_records
        if datetime.datetime.strptime(r["date"], "%Y-%m-%d").date() >= one_month_ago
    ]
    print(f"[信息] 提取近一个月数据: {one_month_ago} 至 {latest_date_str}，共 {len(recent_records)} 条")

    # 4. 合并更新数据
    data = load_market_data()
    ashare = data.setdefault("ashare", {})

    update_count = 0
    new_count = 0

    for r in recent_records:
        d = r["date"]

        if d not in ashare:
            # 如果没有该日期的记录，新建一个基础记录
            ashare[d] = {
                "ashare_total": None,
                "sse_mv": None,
                "szse_mv": None,
                "cnt": 0
            }
            new_count += 1
        else:
            update_count += 1

        # 覆盖更新 OHLC 和 price
        ashare[d]["open"] = r["open"]
        ashare[d]["high"] = r["high"]
        ashare[d]["low"] = r["low"]
        ashare[d]["close"] = r["close"]
        ashare[d]["price"] = r["price"]

    # 5. 更新时间戳并保存
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    meta = data.setdefault("meta", {})
    meta["avg_price_updated_at"] = now_str
    meta["avg_price_fields"] = ["open", "high", "low", "close", "price"]

    save_market_data(data)
    print(f"[完成] 补充新日期 {new_count} 条，覆盖更新已有日期 {update_count} 条。")


if __name__ == "__main__":
    main()