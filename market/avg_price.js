/* ============================================================
   0. 引用 common.js 提供的全局工具
   ============================================================ */
const $            = window.$;
const getChartTheme = window.getChartTheme;
const debounce      = window.debounce;

function setDelta(el, text, pct) {
  el.textContent = text + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
  el.className = 'kpi-delta ' + (pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat');
}

/* ============================================================
   1. GDP 年度数据（亿元）—— 从 market_data.js 读取
   ============================================================ */
const GDP_ANNUAL = (window.MARKET_DATA && window.MARKET_DATA.gdp_annual) || {};

function resolveLatestGDPYear() {
  const currentYear = new Date().getFullYear();
  const lastYear = currentYear - 1;
  if (GDP_ANNUAL[lastYear] != null) return lastYear;
  const years = Object.keys(GDP_ANNUAL).map(Number);
  return Math.max.apply(null, years);
}
const GDP_LATEST_YEAR = resolveLatestGDPYear();
const GDP_FALLBACK = GDP_ANNUAL[GDP_LATEST_YEAR];

/* ============================================================
   1.1 GDP 年度增速 & 当年 GDP 推算
   ============================================================ */
function buildGDPGrowth() {
  const years = Object.keys(GDP_ANNUAL).map(Number).sort((a, b) => a - b);
  const growth = {};
  for (let i = 1; i < years.length; i++) {
    growth[years[i]] = GDP_ANNUAL[years[i]] / GDP_ANNUAL[years[i - 1]] - 1;
  }
  return { years, growth };
}

function estimateCurrentYearGDP() {
  const { years, growth } = buildGDPGrowth();
  const lastYear = years[years.length - 1];
  const currentYear = new Date().getFullYear();

  if (GDP_ANNUAL[currentYear] != null) {
    return {
      year: currentYear,
      value: GDP_ANNUAL[currentYear],
      growth: growth[currentYear] != null ? growth[currentYear] : null,
      isEstimate: false,
      lastYear: lastYear
    };
  }

  const recentYears = years.slice(-3);
  const recentGrowths = recentYears.map(y => growth[y]).filter(v => v != null);
  const baseGrowth = recentGrowths.length ? recentGrowths.reduce((a, b) => a + b, 0) / recentGrowths.length : 0.05;

  const month = new Date().getMonth() + 1;
  const quarter = Math.ceil(month / 3);
  const quarterFactor = [1.00, 0.98, 0.96, 0.94][quarter - 1];
  const estGrowth = baseGrowth * quarterFactor;

  let value = GDP_ANNUAL[lastYear];
  for (let y = lastYear + 1; y <= currentYear; y++) {
    value = value * (1 + estGrowth);
  }

  return {
    year: currentYear, value: value, growth: estGrowth, baseGrowth: baseGrowth,
    quarter: quarter, isEstimate: true, lastYear: lastYear
  };
}

const GDP_CURRENT = estimateCurrentYearGDP();
const GDP_EFFECTIVE = Object.assign({}, GDP_ANNUAL);
if (GDP_ANNUAL[GDP_CURRENT.year] == null) {
  GDP_EFFECTIVE[GDP_CURRENT.year] = GDP_CURRENT.value;
}

/* ============================================================
   2. 估值分级
   ============================================================ */
const LEVELS = [
  { min: 1.000,      level: '疯狂',   action: '清仓', cls: 'lv-red' },
  { min: 0.890,      level: '危险',   action: '半仓', cls: 'lv-orange' },
  { min: 0.799,      level: '偏高',   action: '减仓', cls: 'lv-yellow' },
  { min: 0.590,      level: '合理',   action: '持有', cls: 'lv-light-blue' },
  { min: 0.500,      level: '低估',   action: '买入', cls: 'lv-green' },
  { min: -Infinity,  level: '超低估', action: '定投', cls: 'lv-deep-green' }
];
function valuation(r) {
  for (const l of LEVELS) if (r >= l.min) return l;
  return LEVELS[LEVELS.length - 1];
}

/* ============================================================
   3. 数据构建 & 聚合
   ============================================================ */
function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function buildSeries(ashare) {
  const out = [];
  for (const date in ashare) {
    const r = ashare[date];
    if (!r || typeof r.ashare_total !== 'number') continue;
    const y = +date.slice(0, 4);
    const gdp = GDP_EFFECTIVE[y] || GDP_FALLBACK;
    const price = r.price != null ? Number(r.price) : null;
    const o = num(r.open, price), h = num(r.high, price), l = num(r.low, price), c = num(r.close, price);

    out.push({ date, mv: r.ashare_total, gdp, price, open: o, high: h, low: l, close: c, ratio: r.ashare_total / gdp });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

function aggregateSeries(daily, gran) {
  if (gran === 'day') return daily;
  const groups = new Map();
  for (const r of daily) {
    let key;
    if (gran === 'month') key = r.date.slice(0, 7);
    else if (gran === 'week') {
      const d = new Date(r.date + 'T00:00:00');
      const day = d.getDay(), diff = day === 0 ? -6 : 1 - day;
      d.setDate(d.getDate() + diff);
      key = d.toISOString().slice(0, 10);
    }
    groups.set(key, r);
  }
  const arr = Array.from(groups.values());
  arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return arr;
}

/* ============================================================
   4. 状态 & 变量
   ============================================================ */
let chart = null, seriesIndex = new Map(), dailySeries = [];
const seriesCache = { week: null, month: null };
let currentGran = 'day';
let priceChart = null, priceAgg = null;
const trendVisible = { high: true, low: true, mix: true };
const TREND_NAME = { high: '高位风险', low: '国运支撑', mix: '低估定投' };
const RANGE_MONTHS = { day: { mobile: 1, desktop: 6 }, week: { mobile: 6, desktop: 24 }, month: { mobile: 24, desktop: 36 } };

function getDisplaySeries() {
  if (currentGran === 'day') return dailySeries;
  if (!seriesCache[currentGran]) seriesCache[currentGran] = aggregateSeries(dailySeries, currentGran);
  return seriesCache[currentGran];
}

/* ============================================================
   5. KPI 渲染 & 动态插入提示栏
   ============================================================ */
function renderKPI() {
  const last = dailySeries[dailySeries.length - 1];
  const prev = dailySeries[dailySeries.length - 2] || last;

  $('kpi-mv-date').textContent = 'T-1日：' + last.date;
  $('kpi-mv').innerHTML = (last.mv / 10000).toFixed(2) + '<small>万亿</small>';

  const chg = (last.mv / prev.mv - 1) * 100;
  setDelta($('kpi-mv-d'), '较T-2日 ', chg);

  const yearNow = GDP_LATEST_YEAR, yearBase = yearNow - 1;
  $('kpi-gdp-label').textContent = 'GDP（' + yearNow + '）';
  const gdpVal = GDP_ANNUAL[yearNow];
  $('kpi-gdp').innerHTML = (gdpVal / 10000).toFixed(2) + '<small>万亿</small>';

  const yoyEl = $('kpi-gdp-yoy');
  const gdpBase = GDP_ANNUAL[yearBase];
  if (gdpBase) setDelta(yoyEl, '同比 ' + yearBase + '年 ', (gdpVal / gdpBase - 1) * 100);
  else { yoyEl.textContent = '—'; yoyEl.className = 'kpi-delta flat'; }

  $('kpi-ratio-label').textContent = '市值 / GDP（' + (GDP_CURRENT.isEstimate ? GDP_CURRENT.year + 'E' : GDP_CURRENT.year + '年') + '）';
  $('kpi-ratio').textContent = last.ratio.toFixed(3);

  const v = valuation(last.ratio);
  const rd = $('kpi-ratio-d');
  rd.textContent = v.level + ' · ' + v.action;
  const isRisk = (v.level === '疯狂' || v.level === '危险' || v.level === '偏高');
  rd.className = 'kpi-delta ' + (isRisk ? 'up' : 'down');

  const gdpNoteEl = $('gdp-note');
  if (gdpNoteEl) {
    const pct = GDP_CURRENT.growth != null ? (GDP_CURRENT.growth * 100).toFixed(2) : '—';
    const sign = (GDP_CURRENT.growth != null && GDP_CURRENT.growth >= 0) ? '+' : '';
    gdpNoteEl.textContent = `GDP ${(GDP_CURRENT.value / 10000).toFixed(2)}万亿 ${sign}${pct}%${GDP_CURRENT.isEstimate ? '（Q' + GDP_CURRENT.quarter + '推算）' : ''}`;
  }
}

function insertNoteBar() {
  const priceCard = document.getElementById('chart-price');
  if (!priceCard) return;

  let noteBar = document.querySelector('.note-bar');
  if (!noteBar) {
    noteBar = document.createElement('div');
    noteBar.className = 'note-bar';
    noteBar.innerHTML = `
      <div style="line-height:1.9;">
        总市值 = 上交所 + 深交所 + 北交所<span class="bse-note">（北交所市值自2021-11-15开市并纳入统计）</span><br>
        <span id="gdp-note"></span><br>
        T日平均股价计算：所有T日有交易股票收盘价汇总 / 所有T日交易股票数量
      </div>
    `;
    const card = priceCard.closest('.card');
    if (card && card.parentNode) {
      card.parentNode.insertBefore(noteBar, card.nextSibling);
    }
  }
}

function shiftMonths(dateStr, months) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() - months);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* ============================================================
   6. 主图
   ============================================================ */
function getValuationMarks(theme) {
  return [
    { y: 0.890, label: '0.890 危险', color: theme.isLight ? '#f97316' : '#fb923c' },
    { y: 0.799, label: '0.799 偏高', color: theme.isLight ? '#eab308' : '#facc15' },
    { y: 0.590, label: '0.590 低估', color: theme.isLight ? '#3b82f6' : '#38bdf8' }
  ].map(m => ({
    yAxis: m.y,
    lineStyle: { color: m.color, type: 'dashed', width: 1 },
    label: { formatter: m.label, color: m.color, fontWeight: 600 }
  }));
}

function buildDataZoom(range, isMobile, bottom, theme) {
  const base = {
    height: isMobile ? 14 : 18, bottom: bottom,
    borderColor: theme.zoomBorder, fillerColor: theme.zoomFill,
    handleStyle: { color: theme.zoomHandle },
    textStyle: { fontSize: isMobile ? 9 : 11, color: theme.zoomText },
    dataBackground: { lineStyle: { color: theme.axis }, areaStyle: { color: theme.grid } }
  };
  return [
    Object.assign({ type: 'inside' }, range),
    Object.assign({ type: 'slider' }, base, range)
  ];
}

function renderChart() {
  const series = getDisplaySeries();
  seriesIndex = new Map(series.map(s => [s.date, s]));
  const theme = getChartTheme();
  const isMobile = window.innerWidth <= 720;

  const endDate = series[series.length - 1].date;
  const startIndex = Math.max(0, series.findIndex(s => s.date >= shiftMonths(endDate, RANGE_MONTHS[currentGran][isMobile ? 'mobile' : 'desktop'])));
  const startPercent = (startIndex / series.length) * 100;

  if (!chart) chart = echarts.init($('chart-main'));

  chart.setOption({
    backgroundColor: 'transparent',
    grid: isMobile ? { left: 34, right: 34, top: 40, bottom: 60 } : { left: 45, right: 45, top: 50, bottom: 70 },
    legend: {
      top: 0, left: 'center', itemGap: isMobile ? 12 : 30, itemWidth: isMobile ? 14 : 24, itemHeight: isMobile ? 8 : 12,
      data: ['市值/GDP', '平均股价(元)'], textStyle: { color: theme.legend || theme.text, fontSize: isMobile ? 11 : 12 }
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', label: { backgroundColor: theme.crossLabelBg, color: theme.crossLabelText }, crossStyle: { color: theme.crossLine }, lineStyle: { color: theme.crossLine } },
      confine: true, backgroundColor: theme.tooltipBg, borderColor: theme.tooltipBorder, borderWidth: 1, textStyle: { color: theme.tooltipText },
      extraCssText: 'box-shadow: 0 4px 12px rgba(0,0,0,.1); border-radius: 6px;',
      formatter: params => {
        const d = params[0].axisValue, r = seriesIndex.get(d);
        if (!r) return '';
        const v = valuation(r.ratio);
        let html = `<div style="font-weight:600;margin-bottom:4px;font-size:13px;">${d}</div>`;
        html += `<div style="font-size:12px;color:${theme.lineBlue};">市值/GDP：${r.ratio.toFixed(3)}</div>`;
        if (r.price != null) html += `<div style="font-size:12px;color:${theme.lineYellow};">平均股价：${r.price.toFixed(2)} 元</div>`;
        else html += `<div style="font-size:12px;color:${theme.text};">平均股价：暂无数据</div>`;
        html += `<div style="font-size:12px;margin-top:4px;"><b>${v.level} · ${v.action}</b></div>`;
        return html;
      }
    },
    xAxis: {
      type: 'category', data: series.map(s => s.date),
      axisLine: { lineStyle: { color: theme.axis } },
      axisLabel: { color: theme.text, fontSize: isMobile ? 10 : 11, interval: 'auto', hideOverlap: true }
    },
    yAxis: [
      {
        type: 'value', name: isMobile ? '' : '市值/GDP', nameTextStyle: { color: theme.lineBlue, fontSize: 12 }, nameGap: 25,
        position: 'left', min: 0.1, max: 1.5, axisLine: { show: false }, axisTick: { show: false },
        splitLine: { lineStyle: { color: theme.grid } }, axisLabel: { color: theme.lineBlue, fontSize: isMobile ? 10 : 11 }
      },
      {
        type: 'value', name: isMobile ? '' : '价格(元)', nameTextStyle: { color: theme.lineYellow, fontSize: 12 },
        position: 'right', min: 4, max: 36, axisLine: { show: false }, axisTick: { show: false },
        splitLine: { show: false }, axisLabel: { color: theme.lineYellow, fontSize: isMobile ? 10 : 11 }
      }
    ],
    dataZoom: buildDataZoom({ start: startPercent, end: 100 }, isMobile, isMobile ? 4 : 12, theme),
    series: [
      {
        name: '市值/GDP', type: 'line', yAxisIndex: 0, data: series.map(s => +s.ratio.toFixed(4)),
        smooth: true, symbol: 'none', sampling: 'lttb', lineStyle: { width: isMobile ? 1.5 : 2, color: theme.lineBlue },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: theme.isLight ? 'rgba(37,99,235,.15)' : 'rgba(56,189,248,.25)' }, { offset: 1, color: 'rgba(0,0,0,0)' }]) },
        markLine: { silent: true, symbol: 'none', label: { position: 'insideEndTop', fontSize: isMobile ? 9 : 11 }, data: getValuationMarks(theme) }
      },
      {
        name: '平均股价(元)', type: 'line', yAxisIndex: 1, data: series.map(s => s.price),
        smooth: true, symbol: 'none', sampling: 'lttb', lineStyle: { width: isMobile ? 1.2 : 1.6, color: theme.lineYellow }
      }
    ]
  }, true);
}

/* ============================================================
   6.1 平均股价 K 线
   ============================================================ */
function weekKeyOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00'); const day = d.getDay(); const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function aggregateOHLC(daily, gran) {
  const groups = new Map();
  for (const r of daily) {
    const key = gran === 'month' ? r.date.slice(0, 7) : weekKeyOf(r.date);
    if (r.open == null || r.high == null || r.low == null || r.close == null) continue;
    const g = groups.get(key);
    if (!g) groups.set(key, { key, open: r.open, high: r.high, low: r.low, close: r.close });
    else {
      if (r.high > g.high) g.high = r.high;
      if (r.low < g.low) g.low = r.low;
      g.close = r.close;
    }
  }
  return Array.from(groups.values()).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

const TREND_HIGH_KEYS = ['2008-02', '2015-12', '2021-12'].map(key => ({ key, pick: 'high' }));
const TREND_LOW_KEYS  = ['2008-11', '2019-01', '2024-02'].map(key => ({ key, pick: 'low'  }));
const TREND_MIX_KEYS  = [{ key: '2005-09', pick: 'high' }, { key: '2012-12', pick: 'low' }];

function buildExtendedTrend(agg, anchors) {
  const keyToIdx = new Map(); agg.forEach((g, i) => keyToIdx.set(g.key, i));
  const pts = [];
  for (const a of anchors) { const idx = keyToIdx.get(a.key); if (idx != null) pts.push({ x: idx, y: agg[idx][a.pick] }); }
  if (pts.length < 2) return null;

  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const p of pts) { sx += p.x; sy += p.y; sxy += p.x * p.y; sxx += p.x * p.x; }
  const denom = pts.length * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return null;

  const slope = (pts.length * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / pts.length;
  const out = new Array(agg.length).fill(null);
  for (let i = pts[0].x; i < agg.length; i++) out[i] = +(slope * i + intercept).toFixed(3);
  return out;
}

function trendSeries(name, data, color, dashed) {
  const lineStyle = { color: color, width: 1.8 }; if (dashed) lineStyle.type = 'dashed';
  return { name, type: 'line', data, connectNulls: true, symbol: 'none', showSymbol: false, smooth: false, lineStyle, z: 5 };
}

function renderPriceChart() {
  if (!dailySeries.length) return;
  if (!priceAgg) priceAgg = aggregateOHLC(dailySeries, 'month');
  const agg = priceAgg; if (!agg.length) return;

  const theme = getChartTheme(); const isMobile = window.innerWidth <= 720;
  const total = agg.length; const visible = Math.min(isMobile ? 60 : 72, total); const startIndex = Math.max(0, total - visible);

  if (!priceChart) priceChart = echarts.init($('chart-price'));

  const seriesArr = [{
    name: '平均股价', type: 'candlestick', data: agg.map(g => [g.open, g.close, g.low, g.high]),
    barMaxWidth: 6, itemStyle: { color: theme.lineRed, color0: theme.lineGreen, borderColor: theme.lineRed, borderColor0: theme.lineGreen }
  }];

  if (trendVisible.high) seriesArr.push(trendSeries(TREND_NAME.high, buildExtendedTrend(agg, TREND_HIGH_KEYS), theme.lineRed));
  if (trendVisible.low)  seriesArr.push(trendSeries(TREND_NAME.low,  buildExtendedTrend(agg, TREND_LOW_KEYS),  theme.lineBlue));
  if (trendVisible.mix)  seriesArr.push(trendSeries(TREND_NAME.mix,  buildExtendedTrend(agg, TREND_MIX_KEYS),  theme.linePurple, true));

  priceChart.setOption({
    backgroundColor: 'transparent', legend: { show: false },
    grid: isMobile ? { left: 8, right: 12, top: 20, bottom: 46, containLabel: true } : { left: 22, right: 30, top: 26, bottom: 62, containLabel: true },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'cross', label: { backgroundColor: theme.crossLabelBg, color: theme.crossLabelText }, crossStyle: { color: theme.crossLine }, lineStyle: { color: theme.crossLine } },
      confine: true, backgroundColor: theme.tooltipBg, borderColor: theme.tooltipBorder, borderWidth: 1, textStyle: { color: theme.tooltipText },
      extraCssText: 'box-shadow: 0 4px 12px rgba(0,0,0,.1); border-radius: 6px;',
      formatter: params => {
        if (!params || !params.length) return '';
        const idx = params[0].dataIndex; const g = agg[idx]; if (!g) return '';
        const prev = idx > 0 ? agg[idx - 1] : null; const chg = prev ? (g.close / prev.close - 1) * 100 : null;
        const upCls = g.close >= g.open;
        let html = `<div style="font-weight:600;margin-bottom:4px;font-size:13px;">${g.key}</div><div style="font-size:12px;line-height:1.75;">`;
        html += `<div>开盘：<b>${g.open.toFixed(2)}</b></div><div>最高：<b>${g.high.toFixed(2)}</b></div><div>最低：<b>${g.low.toFixed(2)}</b></div>`;
        html += `<div>收盘：<b style="color:${upCls ? theme.lineRed : theme.lineGreen}">${g.close.toFixed(2)}</b></div>`;
        if (chg != null) html += `<div>涨跌幅：<b style="color:${chg >= 0 ? theme.lineRed : theme.lineGreen}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</b></div>`;
        return html + '</div>';
      }
    },
    xAxis: { type: 'category', data: agg.map(g => g.key), boundaryGap: true, axisLine: { lineStyle: { color: theme.axis } }, axisTick: { show: false }, axisLabel: { color: theme.text, fontSize: isMobile ? 10 : 11, interval: 'auto', hideOverlap: true } },
    yAxis: { scale: true, axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: theme.grid } }, axisLabel: { color: theme.text, fontSize: isMobile ? 10 : 11 } },
    dataZoom: buildDataZoom({ startValue: startIndex, endValue: total - 1 }, isMobile, isMobile ? 4 : 10, theme),
    series: seriesArr
  }, true);
}

/* ============================================================
   7. 表格
   ============================================================ */
function renderTable() {
  const series = getDisplaySeries(); const tbody = $('tbody'); const rows = [];
  const n = series.length; const isMobile = window.innerWidth <= 720;
  const rowCount = isMobile ? 5 : (currentGran === 'month' ? 12 : 10);

  for (let i = n - 1; i >= Math.max(0, n - rowCount); i--) {
    const r = series[i]; const p = series[i - 1];
    const chg = p ? (r.mv / p.mv - 1) * 100 : 0; const v = valuation(r.ratio);
    rows.push(`<tr>
      <td>${isMobile ? r.date.slice(5) : r.date}</td>
      <td class="num">${(r.mv / 10000).toFixed(2)}</td>
      <td class="num">${r.ratio.toFixed(3)}</td>
      <td class="num ${chg >= 0 ? 'up' : 'down'}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</td>
      <td><span class="tag ${v.cls}">${v.level}</span></td>
      <td>${v.action}</td>
    </tr>`);
  }
  tbody.innerHTML = rows.join('');
}

function showError(err) {
  $('chart-main').innerHTML = `<div class="err"><div>未找到 market_data.js 或其中数据为空</div><div style="color:#dc2626;font-size:11px;white-space:pre-wrap;background:#fef2f2;padding:10px;border-radius:8px;">${err.message}</div></div>`;
  console.error(err);
}

/* ============================================================
   8. 启动 & 交互
   ============================================================ */
window.addEventListener('themeChanged', () => { if (chart) renderChart(); if (priceChart) renderPriceChart(); });

(function main() {
  const data = window.MARKET_DATA;
  if (!data || !data.ashare) { showError(new Error('market_data.js 缺失或为空')); return; }

  dailySeries = buildSeries(data.ashare);
  if (!dailySeries.length) { showError(new Error('无有效数据')); return; }

  insertNoteBar();

  renderKPI();
  renderChart();
  renderPriceChart();
  renderTable();

  $('granSwitch').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn || btn.classList.contains('active')) return;
    document.querySelectorAll('#granSwitch button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); currentGran = btn.dataset.gran; renderChart(); renderTable();
  });

  [['trendBtnHigh', 'high'], ['trendBtnLow', 'low'], ['trendBtnMix', 'mix']].forEach(([id, key]) => {
    $(id).addEventListener('click', function () {
      trendVisible[key] = !trendVisible[key];
      this.classList.toggle('active', trendVisible[key]);
      renderPriceChart();
    });
  });

  window.addEventListener('resize', debounce(() => {
    if (!chart) return;
    const nowMobile = window.innerWidth <= 720;
    const wasMobile = chart.getOption().grid[0].top === 40;
    if (nowMobile !== wasMobile) {
      chart.dispose(); chart = null; if (priceChart) { priceChart.dispose(); priceChart = null; }
      renderChart(); renderPriceChart(); renderTable();
    } else {
      chart.resize(); if (priceChart) priceChart.resize();
    }
  }, 250));
})();