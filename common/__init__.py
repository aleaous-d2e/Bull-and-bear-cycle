# -*- coding: utf-8 -*-
"""
common（包入口）—— avg_price.py / etf_share.py / base_watch.py / top_watch.py / central_control.py
以及本地月度脚本 market/stock_local.py（不入库，见 .gitignore）共用的小工具

【布局】项目根目录下 common/ 是「包」，公共代码就直接写在本文件里。
各子项目（market/、etf/、top_base/）的脚本写 `import common` 拿到的就是它，
因此原先那份 common/common.py 不需要再存在 —— 两处都留会变成两份实现，
改了这份忘了那份，比不抽更麻烦。

只放几个脚本里**重复出现**的东西，就三块：
  1. 交易日历（AkShare 新浪日历，进程内只请求一次）
  2. `window.XXX = {...};` 形式 JS 数据文件的读 / 写
  3. 指数退避重试

对外只暴露这些函数，够用的同时不留“以后可能有用”的接口：
  get_trade_dates / is_trading_day / last_trade_date / data_target_date /
  next_trade_date / holiday_eve / is_first_trading_day_of_month /
  dump_js / read_js_json / write_js_json / with_retry
（_trade_dates_all 只在模块内部用，属于实现细节。
 market/stock_local.py 只用到 read_js_json / write_js_json，已按它的上传版本核对过，
 所以删掉的公共名不会影响这个线下脚本。）

业务逻辑（抓什么、算什么都留在各自脚本里），这里不做任何封装抽象。
"""

import datetime
import json
import os
import time

# ============================================================
# 1. 交易日历
# ============================================================
_TRADE_DATES = None  # 进程内缓存，避免每个脚本各请求一遍、同一脚本请求好几遍


def _as_date(v):
    """把 date / Timestamp / 'YYYY-MM-DD' / 'YYYYMMDD' 统一成 datetime.date。"""
    if isinstance(v, datetime.datetime):
        return v.date()
    if isinstance(v, datetime.date):
        return v
    s = str(v).strip()
    if len(s) == 8 and s.isdigit():
        s = f"{s[:4]}-{s[4:6]}-{s[6:]}"
    return datetime.date.fromisoformat(s)


def _trade_dates_all():
    """全量历史交易日（list[date]，已排序）。进程内只请求一次 API。

    仅本模块内部使用（外部统一走 get_trade_dates / last_trade_date 等语义化函数），
    所以刻意不暴露成公共接口。
    """
    global _TRADE_DATES
    if _TRADE_DATES is None:
        # 延迟导入：只想读写 json 的调用方不该被迫依赖 akshare
        import akshare as ak
        import pandas as pd

        df = ak.calendar_trade_date_hist_sina()
        col = "trade_date" if "trade_date" in df.columns else df.columns[0]
        _TRADE_DATES = sorted(set(pd.to_datetime(df[col]).dt.date))
    return _TRADE_DATES


def get_trade_dates(start, end):
    """【通用】返回 [start, end] 闭区间内的真实交易日（list[date]）。"""
    s, e = _as_date(start), _as_date(end)
    return [d for d in _trade_dates_all() if s <= d <= e]


def is_trading_day(d=None):
    """【通用】判断某日是否真实交易日（含法定节假日判断），默认今天。"""
    return _as_date(d or datetime.date.today()) in set(_trade_dates_all())


def last_trade_date(before=None):
    """【通用】严格早于 before（默认今天）的最近一个交易日。

    两个交易所的份额数据都是 T+1 才定稿，所以取“严格早于今天”，不是“≤今天”。
    """
    b = _as_date(before or datetime.date.today())
    past = [d for d in _trade_dates_all() if d < b]
    return past[-1] if past else b


def data_target_date(evening_hour=21):
    """【方案A】统一「T+1 早上跑批」后，明确这一次该取哪个交易日的数据。

    - 今天本身是交易日、且已经过了 evening_hour（默认 21 点，收盘后数据已发布）→ 取今天；
    - 其他情况（早上跑批、周末/节假日跑）→ 取「严格早于今天的最近一个交易日」。

    这样早上 08:06 跑拿到的是上一交易日（T 日）的完整数据；
    晚上 21 点后手动补跑，则能直接更新当天，不会被"早跑"规则误伤。
    """
    now = datetime.datetime.now()
    if is_trading_day(now.date()) and now.hour >= evening_hour:
        return now.date()
    return last_trade_date()


def next_trade_date(after=None):
    """【通用】严格晚于 after（默认今天）的最近一个交易日；日历到头了返回 None。"""
    a = _as_date(after or datetime.date.today())
    for d in _trade_dates_all():
        if d > a:
            return d
    return None


def holiday_eve(today=None):
    """【通用】今天是否「节假日前最后一个交易日」。

    今天必须是交易日，且今天与下一个交易日之间夹着“本该开市却休市”的工作日：
      周五 → 周一：中间只有周六日          → 不算（只是周末，周一照常跑）
      09-30 → 10-09：中间夹着 10-01~10-08 → 算（节前最后一天，把月度数据一起更到最新）
    只按天数差判会把每个周五都误判成节前，所以这里逐个看中间的日子。
    """
    t = _as_date(today or datetime.date.today())
    if t not in set(_trade_dates_all()):
        return False
    nxt = next_trade_date(t)
    if nxt is None:
        return False
    gap = [t + datetime.timedelta(days=n) for n in range(1, (nxt - t).days)]
    return any(d.weekday() < 5 for d in gap)   # 0~4 = 周一~周五


def is_first_trading_day_of_month(day_from=1, today=None):
    """【通用】今天是否本月的第一个交易日（day_from 可要求从某号起算）。

    day_from=1 → 每月的首个交易日（base_watch.py 的月 K 更新闸门）；
    day_from=2 → 每月 2 号及以后的首个交易日（etf_share.py 的池审查日）。
    """
    t = _as_date(today or datetime.date.today())
    if t.day < day_from:
        return False
    month_dates = [d for d in _trade_dates_all()
                   if d.year == t.year and d.month == t.month and d.day >= day_from]
    return bool(month_dates) and month_dates[0] == t


# ============================================================
# 2. JS 数据文件读写（统一处理 `window.XXX = {...};`）
# ============================================================
def dump_js(var_name, data, indent=None):
    """把数据序列化成 `window.XXX = {...};` 的字符串。

    indent=None → 紧凑单行（market_data.js 的历史做法）；
    indent=2    → 带缩进、可读（ETF / INDEX_DATA 的做法）。
    """
    if indent:
        body = json.dumps(data, ensure_ascii=False, indent=indent)
    else:
        body = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return "window." + var_name + " = " + body + ";"


def _slice_json_object(text, start):
    """【修复】从 start 处的 '{' 起，按括号配平截出一个完整 JSON 对象。

    原来 read_js_json 用 text.rfind('}') 一路截到文件最后一个 '}'：
    只要文件里有第二个变量（例如 top_watch_data.js 里 FLOW_DATA 后面还跟着 DERIVED_DATA），
    就会把后面的对象一起吞进来，json.loads 报 "Extra data"。
    这里改成扫描配平（跳过字符串内部的括号），保证只取当前这个对象。
    """
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start:i + 1]
    raise ValueError("无法在文件中找到配平的 JSON 对象")


def read_js_json(path, var_name=None, default=None):
    """读取 `window.XXX = {...};` 格式文件并解析出 JSON。

    - 文件不存在 / 找不到变量 → 返回 default
    - 文件存在但 JSON 解析失败 → 抛异常（让调用方自己决定是告警还是中止，
      避免“解析失败却当作空数据，把原文件覆盖掉”的事故）

    var_name=None 时按“第一个 { 到最后一个 }”截取（market_data.js 那种整文件即 JSON 的写法）；
    指定 var_name 时从该变量后面开始截取（base_watch_data.js 里 RAW_DATA 在前、INDEX_DATA 在后的写法）。
    """
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()

    if var_name:
        anchor = text.find("window." + var_name)
        if anchor < 0:
            return default
        start = text.find("{", anchor)
    else:
        start = text.find("{")

    if start < 0:
        raise ValueError(f"无法在 {path} 中定位 JSON")
    # 【修复】按括号配平截取当前对象，避免把文件里后面的第二个变量也吞进来
    return json.loads(_slice_json_object(text, start))


def write_js_json(path, var_name, data, indent=None, newline=True):
    """把数据写成 `window.XXX = {...};`。

    一律先写 .tmp 再 os.replace，避免中途失败留下半个坏文件。四个调用方
    （avg_price / base_watch / etf_share / stock_local）都只走这一种写法，
    所以不留 atomic 开关。
    """
    content = dump_js(var_name, data, indent=indent) + ("\n" if newline else "")

    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


# ============================================================
# 3. 指数退避重试
# ============================================================
def with_retry(fn, times=2, delay=1.0, label=""):
    """【通用】执行 fn()，失败按 1s、2s、4s… 指数退避重试；全部失败返回 None（不抛异常）。

    需要“3 次 × 10 秒”这种固定节奏的（ETF 份额抓取）不走这里，
    在 etf_share.py 里用 retry_fixed()，两种节奏各管各的、互不改对方。
    """
    for i in range(times):
        try:
            return fn()
        except Exception as e:
            wait = delay * (2 ** i)
            print(f"  [{label}] 第 {i + 1}/{times} 次失败: {e}，{wait}s 后重试")
            if i < times - 1:
                time.sleep(wait)
    print(f"  [{label}] 全部重试失败，返回 None")
    return None
