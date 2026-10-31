# -*- coding: utf-8 -*-
"""
ETF 份额数据流水线
======================================================
合并ETF每日份额增量抓取与 ETF 池审查为单一脚本。

    【阶段 1】ETF池审查
        抓取沪深快照 → 分类过滤 → 组内截断 → 成交额过滤 → 直接产出行业主题列表
        每月 2 号（非交易日顺延至下一交易日）执行。

    【阶段 2】份额增量更新
        读取旧数据 → 计算缺失日期 → 批量补抓 → 输出宽基/行业主题两个 JS
        每个交易日执行。

输出文件：
    - etf_share_data_broad.js      # 宽基份额数据 window.__ETF_SHARE_BROAD__
    - etf_share_data_sector.js     # 行业主题份额数据 window.__ETF_SHARE_SECTOR__

代码来源：宽基内置 + 阶段 1 审查筛出的行业主题。
meta 格式：{ "159516": {"name": "半导体设备ETF国泰"}, ... }
          宽基名称请在 etf_share_data_broad.js 中手动维护，脚本读取旧文件时原样保留。
"""
import akshare as ak
import pandas as pd
import requests
import json
import os
import time
from datetime import date, timedelta

# ============================================================
# 配置
# ============================================================
# 宽基 ETF（内置代码，名称请在 etf_share_data_broad.js 的 meta 中维护）
BROAD_BASE_CODES = [
    "510300", "588000", "588080", "159915", "159949", "510310",
    "510050", "512100", "159952", "563300", "510500",
]

# 新上市 ETF 待观察列表：只抓当日份额，不抓历史。
# 人工确认有追踪价值后，从这里删掉，加到 HTML 的正式分组里。
# 确认不追踪时，也从这里删掉，下次运行会自动清除其残留数据。
# 5 开头和 1 开头都支持，走同一批量抓取函数。
WATCH_CODES = [
    # "159227",   # 示例
]

# 输出文件
BROAD_JS = "etf_share_data_broad.js"
SECTOR_JS = "etf_share_data_sector.js"

# 日期范围：END_DATE 取今天，避免未来日期进入交易日造成无效请求
END_DATE = date.today()
# 宽基查询近 6 年，行业主题获取近 3 年
BROAD_START_DATE = date(END_DATE.year - 6, END_DATE.month, END_DATE.day)
SECTOR_START_DATE = date(END_DATE.year - 3, END_DATE.month, END_DATE.day)

# 自行限速防IP被封
SLEEP_PER_REQUEST = 0.15         # 上交所单日份额接口
SLEEP_PER_NAME_REQUEST = 0.1     # 上交所扩位简称批量接口

# ============================================================
# ETF池审查配置
# ============================================================
# 排除池：在分类前砍掉非目标类型，减少后续工作量
EXCLUDE_KEYWORDS = "货币|债|现金流|增强|主动|短融"

# 份额门槛：低于 10亿份的迷你基金直接淘汰
MIN_SHARES_YI = 10.0

# 份额阈值（亿份）：只有低于该值的才需要查成交额
TURNOVER_CHECK_SHARES_YI = 100.0

# 成交额门槛（亿元）：截断后的标的，成交额低于该值则剔除
MIN_TURNOVER_YI = 1.0

# 目前只自动追踪行业主题类，宽基排除
REMOVE_BROAD_CATEGORIES = {"宽基"}


# ============================================================
# 通用工具
# ============================================================

def is_today_trading_day() -> bool:
    """判断今天是否为真实交易日。"""
    today = date.today()
    df = ak.tool_trade_date_hist_sina()
    s = set(pd.to_datetime(df["trade_date"]).dt.date)
    return today in s

def normalize_code(v) -> str | None:
    """把输入统一成 6 位数字代码，无效返回 None。"""
    if v is None:
        return None
    s = str(v).strip()
    return s if s.isdigit() and len(s) == 6 else None


def exchange_of(code: str) -> str:
    """5 开头 → SSE，1 开头 → SZSE；其余抛错。"""
    if code.startswith("5"):
        return "SSE"
    if code.startswith("1"):
        return "SZSE"
    raise ValueError(f"无法根据代码 {code} 判断交易所，请检查输入。")


def get_trade_dates(start: date, end: date) -> list[date]:
    """获取 [start, end] 区间内的真实交易日。"""
    df = ak.tool_trade_date_hist_sina()
    col = "trade_date" if "trade_date" in df.columns else df.columns[0]
    s = pd.to_datetime(df[col]).dt.date
    return sorted(d for d in s.unique() if start <= d <= end)


def last_trade_date() -> date:
    """最近一个份额数据已定稿的交易日（T-1 语义）。
    两个交易所的份额数据都是 T+1 才定稿，所以取严格早于今天的最近交易日。
    """
    today = date.today()
    df = ak.tool_trade_date_hist_sina()
    s = pd.to_datetime(df["trade_date"]).dt.date
    past = sorted(d for d in s.unique() if d < today)
    return past[-1] if past else today


def is_review_day() -> bool:
    """判断今天是否应该跑ETF池审查：本月 2 号或之后第一个交易日。"""
    today = date.today()
    if today.day < 2:
        return False
    trade_days = get_trade_dates(today.replace(day=1), today)
    candidates = [d for d in trade_days if d.day >= 2]
    return bool(candidates) and candidates[0] == today


# ============================================================
# 阶段 1：ETF池审查逻辑
# ============================================================
# 核心逻辑：行业主题优先，宽基垫底。
# 列表顺序决定了匹配优先级，越靠前越先匹配。
# 必须严格遵守“防截胡”原则：越精细的规则必须越靠前。
THEME_RULES = [
    # 【一、极易被截胡的规则必须排在前面】
    # 否则 "新能源" 会被后面的 "能源" 抢走，
    ("新能源", ["新能源", "光伏", "电池", "锂电", "碳中和", "绿电", "绿色电力"]),
    ("创新药", ["创新药"]),  # 必须在 医药医疗 之前
    ("稀土/有色", ["有色", "稀土", "金属", "矿业"]),  # 必须在 资源 之前

    # 【二、细分行业与主题】
    # 传统金融与周期
    ("红利/价值/成长", ["红利", "股息", "价值", "成长"]),

    ("跨境/海外",
     ["东南亚", "德国", "法国", "巴西", "沙特", "亚太", "日", "纳指", "纳斯达克",
      "标普", "道琼斯", "美国50", "恒生", "港股", "中概", "香港", "H股"]),
    ("电力", ["电力"]),
    ("电网设备", ["电网设备"]),
    ("汽车", ["汽车"]),
    ("黄金", ["黄金", "上海金", "金ETF", "黄金股"]),
    ("证券/保险", ["证券", "券商", "金融", "保险"]),
    ("银行", ["银行"]),
    ("油气", ["石油", "石化", "油气"]),
    ("煤炭/钢铁/化工", ["煤炭", "钢铁", "化工", "建材"]),
    # 新材料单独成类，必须在“科创综指”之前匹配，
    # 否则 “科创新材料ETF” 会被 “科创综指” 截胡并当作宽基误删
    ("新材料", ["新材料"]),
    ("房地产/基建", ["房地产", "地产", "基建"]),

    # 科技与泛科技
    ("人工智能", ["人工智能", "AI", "智能"]),
    ("机器人", ["机器人"]),
    ("半导体/芯片", ["半导体", "芯片", "集成电路", "机床", "机械", "工业母机", "工程"]),
    ("电子/TMT", ["电子", "TMT", "信息技术"]),

    # 医药与农业
    ("医药医疗", ["医药", "医疗", "生物", "疫苗", "CXO", "中药"]),
    ("农牧渔", ["养殖", "农牧", "农业", "豆粕"]),

    # TMT细分
    ("软件/计算机", ["软件", "计算机", "信创"]),
    ("云计算/大数据", ["云计算", "大数据", "数字经济"]),
    ("通信/5G", ["通信", "5G", "电信"]),
    ("传媒/游戏/教育", ["传媒", "游戏", "教育", "影视"]),

    # 弱周期
    ("军工", ["军工", "国防", "航天", "航空", "卫星", "船舶"]),
    ("消费", ["消费", "食品", "饮料", "酒", "家电", "旅游", "粮食"]),
    ("央企/国企", ["央企", "国企"]),
    ("环保/保护", ["环保", "保护"]),
    ("资源", ["资源"]),

    # 【三、宽基】（全部会在步骤 4 整体剔除）
    # 这些关键词的作用是把宽基准确识别出来，避免它们落入“其他”而躲过剔除。
    # 因为最终会被 REMOVE_BROAD_CATEGORIES 整体删除。
    # 注意：必须放在所有行业/主题规则之后，防止 “创业板人工智能” 这类行业主题
    #       被 “创业板” 截胡（行业规则在前，会先命中）。
    ("宽基", [
        # 细分宽基
        "科创100", "科创板100", "科创200", "科创板200",
        "科创50", "科创板50", "科创综指",
        "创业板50", "创50", "双创", "科创创业",
        # 全市场宽基
        "创业板", "创业大盘", "上证50", "沪深300", "中证300",
        "中证500", "中证1000", "中证2000", "中证800",
        "A500", "A50", "A100", "沪港深",
        "上证指数", "上证180", "深证100", "深成",
    ]),
]


def fetch_sse_snapshot():
    """
    获取上交所全量份额快照（合并扩位简称）。
    由于 akshare 返回的是截断短名（如“科200GT”），所以直接请求官方接口。
    1. 先获取全量份额表。
    2. 再获取对应的扩位简称（如“科创芯片设计ETF广发”）。
    3. 根据“基金代码”将两者合并。

    注意：该接口返回的是最新快照，不接受日期参数。
    TOT_VOL 字段单位是“万份”，除以 10000 换算为“亿份”。
    """
    headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://www.sse.com.cn/"}

    # 1. 请求官方份额接口
    params_share = {"sqlId": "COMMON_SSE_ZQPZ_ETFZL_XXPL_ETFGM_SEARCH_L",
                    "isPagination": "true", "pageHelp.pageSize": "5000"}
    resp = requests.get("https://query.sse.com.cn/commonQuery.do",
                        params=params_share, headers=headers)
    df_share = pd.DataFrame(resp.json().get("result", []))
    df_share = df_share[["SEC_CODE", "TOT_VOL"]].rename(
        columns={"SEC_CODE": "基金代码", "TOT_VOL": "份额_原始"})

    # 2. 请求官方扩位简称接口（由于代码过多，每 100 只基金打包请求一次）
    codes = df_share["基金代码"].tolist()
    names_data = []
    for i in range(0, len(codes), 100):
        cb = f"jsonpCallback{int(time.time())}"  # 伪造 JSONP 回调名防止被拦截
        params_name = {"jsonCallBack": cb, "secCodes": ",".join(codes[i:i + 100])}
        text = requests.get("https://query.sse.com.cn/security/stock/queryExpandName.do",
                            params=params_name, headers=headers).text.strip()
        if text.startswith(cb):
            text = text[text.find("(") + 1: text.rfind(")")]
        names_data.extend(json.loads(text).get("result", []))
        time.sleep(SLEEP_PER_NAME_REQUEST)

    df_name = pd.DataFrame(names_data, columns=["基金代码", "场内简称"])

    # 3. 将份额表和简称表通过“基金代码”进行左连接拼接
    df = pd.merge(df_share, df_name, on="基金代码", how="left")
    # 4. 单位换算：上交所原始数据是“万份”，除以 10000 换算为“亿份”
    df["份额_亿份"] = pd.to_numeric(df["份额_原始"], errors="coerce") / 10000
    return df[["基金代码", "场内简称", "份额_亿份"]]


def fetch_szse_snapshot(snapshot_date: date):
    """
    获取深交所指定交易日的全量份额快照。
    snapshot_date 传 T-1 交易日，因为深交所 T 日份额数据 T+1 才定稿。
    原始单位是“份”，除以 1e8 换算为“亿份”。
    """
    date_str = snapshot_date.strftime("%Y%m%d")
    df = ak.fund_scale_daily_szse(start_date=date_str, end_date=date_str, symbol="ETF")
    df = df.rename(columns={"基金简称": "场内简称", "基金份额": "份额_原始"})
    df["份额_亿份"] = pd.to_numeric(df["份额_原始"], errors="coerce") / 1e8
    return df[["基金代码", "场内简称", "份额_亿份"]]


def filter_by_turnover(df):
    """
    对份额 < TURNOVER_CHECK_SHARES_YI 亿份的基金，查询成交额，
    剔除成交额 < MIN_TURNOVER_YI 亿元的标的。
    数据源：akshare 新浪接口（fund_etf_category_sina）。
    接口失败或匹配率过低时，明确告警并放弃过滤。
    """
    need_check = df[df["份额_亿份"] < TURNOVER_CHECK_SHARES_YI].copy()
    skip_check = df[df["份额_亿份"] >= TURNOVER_CHECK_SHARES_YI].copy()

    if need_check.empty:
        print("   无需检查成交额（所有标的份额均 >= 100亿）")
        return df

    print(f"   需检查成交额的标的数：{len(need_check)}")
    need_check["基金代码"] = need_check["基金代码"].astype(str).str.strip()

    # 新浪返回列通常为：代码, 名称, 最新价, 涨跌额, 涨跌幅, 买入, 卖出, 昨收,
    # 今开, 最高, 最低, 成交量, 成交额
    # 代码列可能带 sh/sz 前缀，需要截掉后 6 位
    try:
        sina_df = ak.fund_etf_category_sina(symbol="ETF基金")
        sina_df["代码"] = sina_df["代码"].astype(str).str.strip().str[-6:]
        turnover_map = (sina_df[["代码", "成交额"]]
                        .drop_duplicates("代码")
                        .rename(columns={"代码": "基金代码", "成交额": "成交额_原始"}))
        print(f"   新浪接口成功，返回 {len(turnover_map)} 条")
    except Exception as e:
        print(f"   [警告] 新浪接口失败：{type(e).__name__}: {e}，"
              f"本次成交额过滤未生效！低流动性标的可能混入结果，请检查网络后重跑。")
        return df

    # ---------- 合并与匹配率保护 ----------
    need_check = need_check.merge(turnover_map, on="基金代码", how="left")

    match_rate = need_check["成交额_原始"].notna().mean()
    if match_rate < 0.5:
        print(f"   [警告] 成交额匹配率仅 {match_rate:.0%}，"
              f"代码格式可能不匹配，放弃成交额过滤")
        return df

    # ---------- 单位归一化 ----------
    # 新浪接口的成交额通常是「万元」。
    # 保险做法：先按「元」处理，如果整体中位数明显偏小（< 1e4），再按「万元」换算。
    vals = pd.to_numeric(need_check["成交额_原始"], errors="coerce")
    if vals.median() < 1e4:  # 若中位数 < 1万元，说明单位可能是「万元」
        need_check["成交额_亿元"] = vals / 1e4  # 万元 → 亿元
        print("   [单位] 成交额按「万元」口径换算为亿元")
    else:
        need_check["成交额_亿元"] = vals / 1e8  # 元 → 亿元
        print("   [单位] 成交额按「元」口径换算为亿元")

    before = len(need_check)
    need_check = need_check[need_check["成交额_亿元"] >= MIN_TURNOVER_YI].copy()
    after = len(need_check)
    print(f"   成交额过滤：{before} 条 → {after} 条"
          f"（剔除 {before - after} 条成交额不足 {MIN_TURNOVER_YI} 亿的标的）")

    return pd.concat(
        [skip_check, need_check.drop(columns=["成交额_原始", "成交额_亿元"])],
        ignore_index=True,
    )


def classify(name):
    """接收单只基金的简称，返回其所属分类。"""
    name_upper = str(name).upper()  # 转大写，防止漏掉 "AI"、"5G" 等大小写问题
    # 遍历预先排好序的 THEME_RULES（精细行业在前，宽基在后）
    for theme, kws in THEME_RULES:
        if any(kw in name_upper for kw in kws):
            return theme
    # 关键优化：如果没匹配上，不要保留原名，统一归为“其他”
    # 否则每个没匹配上的都会变成独立组，各自占 1 个名额，导致筛选完全失效
    return "其他"


def run_review(snapshot_date: date) -> dict[str, str]:
    """阶段 1：审查 ETF 池，返回筛出的行业主题 {code: name} 映射。"""
    print("=" * 60)
    print(f"阶段 1：审查 ETF 池（快照日 {snapshot_date}）")
    print("=" * 60)

    # 【步骤 1】：抓取并合并沪深数据
    print("1. 抓取并合并沪深数据...")
    df = pd.concat([fetch_sse_snapshot(), fetch_szse_snapshot(snapshot_date)],
                   ignore_index=True)
    # 确保基金代码干净无空格
    df["基金代码"] = df["基金代码"].astype(str).str.strip()
    # 丢弃简称为空的行，避免后续分类误判
    df = df.dropna(subset=["场内简称"]).copy()

    # 【步骤 2】：一键过滤（先把垃圾和规模小的踢掉）
    print(f"2. 基础过滤（剔除干扰词 + 份额 > {MIN_SHARES_YI}亿）...")
    # 条件 A：不包含 货币/债/短融 等字眼
    # 条件 B：份额 > MIN_SHARES_YI 亿
    mask = ~df["场内简称"].str.contains(EXCLUDE_KEYWORDS, na=False) & (df["份额_亿份"] > MIN_SHARES_YI)
    df = df[mask].copy()

    # 【步骤 3】：行业分类
    print("3. 进行行业分类...")
    df["跟踪指数"] = df["场内简称"].apply(classify)

    # 【步骤 4】：剔除宽基类基金
    print(f"4. 剔除宽基类基金（共 {len(REMOVE_BROAD_CATEGORIES)} 个分类）...")
    before = len(df)
    df = df[~df["跟踪指数"].isin(REMOVE_BROAD_CATEGORIES)].copy()
    after = len(df)
    print(f"   剔除 {before - after} 条宽基标的，剩余 {after} 条")

    # 【步骤 5】：组内截断（宽基已在步骤 4 剔除，各组统一取前 1）
    print("5. 组内截断（宽基已剔除，各组统一取前1）...")
    # 计算每只基金在其分类内按份额降序的排名（method="first" 保证同份额也有唯一排名）
    df["组内排名"] = df.groupby("跟踪指数")["份额_亿份"].rank(method="first", ascending=False)
    # 保留每组第 1 名
    df = df[df["组内排名"] <= 1].copy()
    print(f"   截断后剩余 {len(df)} 条（每组 1 只）")

    # 【步骤 6】：成交额过滤（仅对截断后的标的，份额 < 100亿的查成交额）
    print("6. 成交额过滤（截断后标的，份额 < 100亿的查成交额，剔除 < 1亿的）...")
    themes_before = set(df["跟踪指数"])
    df = filter_by_turnover(df)
    themes_after = set(df["跟踪指数"])
    # 提示因成交额不足被剔除后空缺的分类
    dropped_themes = themes_before - themes_after
    if dropped_themes:
        print(f"   因成交额不足被剔除后空缺的分类（{len(dropped_themes)} 个）：{sorted(dropped_themes)}")

    # 【步骤 7】：整理并直接返回（供阶段 2 使用，不再落盘 CSV）
    print("7. 整理筛选结果...")
    # 按分类、份额排序，保证输出顺序稳定
    df = df.sort_values(by=["跟踪指数", "份额_亿份"], ascending=[True, False])

    result: dict[str, str] = {}
    for _, row in df.iterrows():
        nc = normalize_code(row["基金代码"])
        if nc:
            result[nc] = str(row["场内简称"]).strip()
    print(f"完成！筛出 {len(result)} 只行业主题 ETF。\n")
    return result


# ============================================================
# 阶段 2：历史份额增量更新
# ============================================================
def gather_codes(sector_map: dict[str, str]) -> dict[str, str]:
    """合并宽基 + 行业主题，返回 {code: name}，去重保序。

    名称优先级：sector_map 名称 > 空字符串（宽基名称由用户在 js 中维护）。
    """
    ordered: dict[str, str] = {}

    # 先铺内置宽基（名称留空，由 js 维护）
    for c in BROAD_BASE_CODES:
        nc = normalize_code(c)
        if not nc or nc in ordered:
            continue
        try:
            exchange_of(nc)
            ordered[nc] = ""
        except ValueError:
            print(f"跳过无法识别的交易所代码：{nc}")

    # 再叠加行业主题；若 sector_map 提供了名称则覆盖空名
    for nc, nm in sector_map.items():
        nc = normalize_code(nc)
        if not nc:
            continue
        try:
            exchange_of(nc)
        except ValueError:
            print(f"跳过无法识别的交易所代码：{nc}")
            continue
        if nc not in ordered or nm:
            ordered[nc] = nm

    return ordered


def split_broad_sector(codes: list[str]) -> tuple[list[str], list[str]]:
    """把代码列表拆成 (宽基, 行业主题)。"""
    broad_set = {normalize_code(c) for c in BROAD_BASE_CODES} - {None}
    broad = [c for c in codes if c in broad_set]
    sector = [c for c in codes if c not in broad_set]
    return broad, sector


def load_existing_js(path: str) -> dict:
    """读取已有 JS 文件（window.xxx = {...}; 格式），返回 {meta, series}。"""
    if not os.path.exists(path):
        print(f"未发现已有文件 {path}，将全量抓取。")
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
        start_idx = text.find("{")
        end_idx = text.rfind("}")
        if start_idx == -1 or end_idx == -1:
            raise ValueError("未找到 JSON 主体")
        data = json.loads(text[start_idx:end_idx + 1])
        print(f"已读取已有文件 {path}，包含 {len(data.get('series', {}))} 只基金。")
        return data
    except Exception as e:
        print(f"读取已有文件失败（{e}），将全量抓取。")
        return {}


def merge_series(existing_pts: list, new_pts: list) -> list:
    """合并旧数据和新抓取的数据，按日期去重，保留 2 位小数。"""
    merged: dict[str, dict] = {}
    # 旧数据在前、新数据在后：同日以新抓取为准
    for p in existing_pts + new_pts:
        d, v = p.get("date"), p.get("shares_yi")
        if not d or v is None or pd.isna(v):
            continue
        merged[d] = {"date": d, "shares_yi": round(float(v), 2)}
    return [merged[k] for k in sorted(merged)]


def compute_missing(existing_pts: list, all_dates: list[str]) -> set[str]:
    """计算缺失日期：没数据 → 全量；有数据 → 只补最后已有日期之后。"""
    have = {p["date"] for p in existing_pts if p.get("date")}
    if not have:
        return set(all_dates)
    last = max(have)
    return {d for d in all_dates if d > last}


def fetch_sse_batch(code_dates: dict[str, set[str]]) -> dict[str, list[dict]]:
    """SSE：每个缺失交易日只请求一次，服务当天所有缺失的 SSE 代码。"""
    results: dict[str, list[dict]] = {c: [] for c in code_dates}
    all_dates = sorted({d for s in code_dates.values() for d in s})
    if not all_dates:
        return results

    for d_str in all_dates:
        try:
            df = ak.fund_etf_scale_sse(date=d_str.replace("-", ""))
        except Exception:
            df = None
        if df is not None and not df.empty and "基金代码" in df.columns:
            sub = df.copy()
            sub["_code"] = sub["基金代码"].astype(str).str.strip().str.zfill(6)
            for c, dates in code_dates.items():
                if d_str not in dates:
                    continue
                hit = sub[sub["_code"] == c]
                if hit.empty:
                    continue
                shares = pd.to_numeric(hit.iloc[0]["基金份额"], errors="coerce")
                if pd.notna(shares):
                    results[c].append({
                        "date": d_str,
                        "shares_yi": round(float(shares) / 1e8, 2),
                    })
        time.sleep(SLEEP_PER_REQUEST)
    return results


def fetch_szse_batch(code_dates: dict[str, set[str]]) -> dict[str, list[dict]]:
    """SZSE：一次性拉取合并日期范围的全市场数据，再按代码切片。
    深交所接口单次最多 6 个月，按 180 天分段。
    """
    results: dict[str, list[dict]] = {c: [] for c in code_dates}
    all_dates = sorted({d for s in code_dates.values() for d in s})
    if not all_dates:
        return results

    start_d = pd.to_datetime(all_dates[0]).date()
    end_d = pd.to_datetime(all_dates[-1]).date()

    frames = []
    cursor = start_d
    while cursor <= end_d:
        seg_end = min(cursor + timedelta(days=180), end_d)
        try:
            df = ak.fund_scale_daily_szse(
                start_date=cursor.strftime("%Y%m%d"),
                end_date=seg_end.strftime("%Y%m%d"),
                symbol="ETF",
            )
            if df is not None and not df.empty:
                frames.append(df)
        except Exception:
            pass
        cursor = seg_end + timedelta(days=1)

    if not frames:
        return results

    df = pd.concat(frames, ignore_index=True)
    code_col = "基金代码" if "基金代码" in df.columns else "代码"
    df["_code"] = df[code_col].astype(str).str.strip().str.zfill(6)
    date_col = next((c for c in ("日期", "date", "净值日期") if c in df.columns), None)
    if date_col is None:
        raise RuntimeError("深交所区间结果未找到日期列。")
    df["_date"] = pd.to_datetime(df[date_col]).dt.strftime("%Y-%m-%d")

    for c, dates in code_dates.items():
        sub = df[(df["_code"] == c) & (df["_date"].isin(dates))].copy()
        if sub.empty:
            continue
        sub["shares_yi"] = (pd.to_numeric(sub["基金份额"], errors="coerce") / 1e8).round(2)
        sub = sub.dropna(subset=["shares_yi"]).drop_duplicates("_date")
        for _, r in sub.iterrows():
            results[c].append({"date": r["_date"], "shares_yi": float(r["shares_yi"])})
    return results


def save_js(path: str, var_name: str, payload: dict):
    """把 payload 写为 window.<var_name> = {...}; 形式。"""
    content = f"window.{var_name} = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n"
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"已写入 {path}")


def run_update(snapshot_date: date, sector_map: dict[str, str] | None = None):
    """阶段 2：历史份额增量更新，输出宽基 / 行业主题两个 JS 文件。

    sector_map：审查日由 run_review 直接传入；非审查日传 None 时，
    从已有 SECTOR_JS 的 meta 恢复行业主题代码（等价于上次审查结果）。
    """
    print("=" * 60)
    print("阶段 2：历史份额增量更新")
    print("=" * 60)

    # 读旧文件（两个），把 meta / series 合并到一起处理
    existing_broad = load_existing_js(BROAD_JS)
    existing_sector = load_existing_js(SECTOR_JS)
    old_meta = {**(existing_broad.get("meta") or {}), **(existing_sector.get("meta") or {})}
    series = {**(existing_broad.get("series") or {}), **(existing_sector.get("series") or {})}

    # 非审查日：从已有 SECTOR_JS 的 meta 恢复行业主题代码（排除待观察代码，
    # 否则 watch 代码会被当成正式代码做全量历史补齐，违反“只抓当日”的设计）
    if sector_map is None:
        sector_map = {}
        watch_set = {nc for nc in (normalize_code(c) for c in WATCH_CODES) if nc}
        for nc, entry in (existing_sector.get("meta") or {}).items():
            if nc in watch_set:
                continue
            name = str(entry.get("name") or "") if isinstance(entry, dict) else ""
            sector_map[nc] = name

    name_map = gather_codes(sector_map)
    target_codes = list(name_map.keys())
    print(f"\n共 {len(target_codes)} 只正式 ETF。")
    print(f"待观察 ETF：{WATCH_CODES or '（无）'}")

    # 获取两套交易日历（宽基 6 年，行业主题 3 年）
    broad_trade_dates = get_trade_dates(BROAD_START_DATE, END_DATE)
    sector_trade_dates = get_trade_dates(SECTOR_START_DATE, END_DATE)
    print(f"宽基交易日历：{BROAD_START_DATE} ~ {END_DATE} 共 {len(broad_trade_dates)} 个真实交易日。")
    print(f"行业主题交易日历：{SECTOR_START_DATE} ~ {END_DATE} 共 {len(sector_trade_dates)} 个真实交易日。")

    all_dates_broad = [d.strftime("%Y-%m-%d") for d in broad_trade_dates]
    all_dates_sector = [d.strftime("%Y-%m-%d") for d in sector_trade_dates]

    # 重建 meta（只保留本次目标代码；宽基名称保留旧值，行业主题用审查名称）
    meta: dict[str, dict] = {}
    for code in target_codes:
        old_entry = old_meta.get(code) or {}
        old_name = str(old_entry.get("name") or "") if isinstance(old_entry, dict) else ""
        # 名称优先级：审查名称 > 旧 js 名称 > 空
        meta[code] = {"name": name_map.get(code) or old_name or ""}
        series.setdefault(code, [])

    # 待观察代码：保留 meta 和 series（用于画曲线），但不参与历史补齐
    watch_codes_clean = [nc for nc in (normalize_code(c) for c in WATCH_CODES) if nc]
    for nc in watch_codes_clean:
        old_entry = old_meta.get(nc) or {}
        old_name = str(old_entry.get("name") or "") if isinstance(old_entry, dict) else ""
        meta[nc] = {"name": old_name or nc}
        series.setdefault(nc, [])

    # 拆分宽基和行业主题代码
    broad_codes, sector_codes = split_broad_sector(target_codes)

    # ---- 计算缺失日期 ----
    sse_missing: dict[str, set[str]] = {}
    szse_missing: dict[str, set[str]] = {}

    # 待观察代码：只抓 SNAPSHOT_DATE 当天，永不进入 compute_missing
    watch_date = snapshot_date.strftime("%Y-%m-%d")
    for nc in watch_codes_clean:
        have = {p["date"] for p in series[nc] if p.get("date")}
        if watch_date in have:
            continue
        if exchange_of(nc) == "SSE":
            sse_missing.setdefault(nc, set()).add(watch_date)
        else:
            szse_missing.setdefault(nc, set()).add(watch_date)
        print(f"{nc}（待观察）：只抓 {watch_date} 一个点。")

    # 正式代码：增量补齐（宽基用 6 年日历，行业主题用 3 年日历）
    for code in target_codes:
        existing_pts = series.get(code, [])
        dates_to_check = all_dates_broad if code in broad_codes else all_dates_sector
        miss = compute_missing(existing_pts, dates_to_check)
        print(f"{code}：已有 {len(existing_pts)} 个点，缺失 {len(miss)} 个交易日。")
        if not miss:
            continue
        if exchange_of(code) == "SSE":
            sse_missing[code] = miss
        else:
            szse_missing[code] = miss

    # ---- 深交所优先 ----
    if szse_missing:
        print(f"\n[深交所] 批量抓取 {len(szse_missing)} 只代码……")
        for code, pts in fetch_szse_batch(szse_missing).items():
            series[code] = merge_series(series.get(code, []), pts)
            print(f"  {code}：本次新增 {len(pts)} 个点，合并后 {len(series[code])} 个。")

    # ---- 上交所 ----
    if sse_missing:
        print(f"\n[上交所] 批量抓取 {len(sse_missing)} 只代码……")
        for code, pts in fetch_sse_batch(sse_missing).items():
            series[code] = merge_series(series.get(code, []), pts)
            print(f"  {code}：本次新增 {len(pts)} 个点，合并后 {len(series[code])} 个。")

    # ---- 清理孤儿数据（既不在正式列表，也不在 watch 列表）----
    keep = set(target_codes) | set(watch_codes_clean)
    for code in list(series.keys()):
        if code not in keep:
            print(f"  清除孤儿数据：{code}")
            del series[code]
            meta.pop(code, None)

    # ---- 拆分落盘 ----
    # watch 代码归入行业主题文件（对应 HTML 里放在 sector 最顶端的 "待观察" 分组）
    sector_all = list(dict.fromkeys(sector_codes + watch_codes_clean))

    save_js(BROAD_JS, "__ETF_SHARE_BROAD__", {
        "meta": {c: meta[c] for c in broad_codes},
        "series": {c: series[c] for c in broad_codes},
    })
    save_js(SECTOR_JS, "__ETF_SHARE_SECTOR__", {
        "meta": {c: meta[c] for c in sector_all},
        "series": {c: series[c] for c in sector_all},
    })
    print(f"\n完成！宽基 {len(broad_codes)} 只，行业主题 {len(sector_codes)} 只，"
          f"待观察 {len(watch_codes_clean)} 只。")


# ============================================================
# 主流程
# ============================================================
def main():

    if not is_today_trading_day():
        print(f"{date.today()} 非交易日，跳过。")
        return
    # 两个交易所的份额数据都是 T+1 定稿，统一取最近一个已定稿交易日
    snapshot_date = last_trade_date()
    print(f"快照日（T-1）：{snapshot_date}")

    # 池审查：每月 2 号（非交易日顺延至下一交易日）
    # 审查日直接将筛出的行业主题列表传给阶段 2，不再经过 CSV 中转。
    # 审查失败时不再中断流程：sector_map 保持 None，
    # 由 run_update 自动从 SECTOR_JS 的 meta 恢复上次审查结果继续增量更新。
    sector_map = None
    if is_review_day():
        try:
            sector_map = run_review(snapshot_date)
        except Exception as e:
            print(f"[警告] 审查失败：{type(e).__name__}: {e}，本次沿用上次结果继续增量更新。")

    # 历史份额增量：每天都会调用，内部通过 compute_missing 自动跳过无缺失的日期
    # 非交易日运行或重复运行时，不会发起任何网络请求
    run_update(snapshot_date, sector_map)


if __name__ == "__main__":
    main()