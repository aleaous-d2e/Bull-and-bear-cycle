/* ============================================================
   0. 引用公共工具 + 本地兜底 (防止 common.js 版本过旧导致白屏)
   ============================================================ */
const $ = window.$ || (id => document.getElementById(id));
const debounce = window.debounce || ((fn, wait = 250) => {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
});
const getChartTheme = window.getChartTheme || (() => {
  const isLight = document.body.classList.contains('theme-light');
  return {
    isLight, text: isLight ? '#6b7280' : '#8ba0bd', grid: isLight ? '#f3f4f6' : 'rgba(139,160,189,0.08)',
    axis: isLight ? '#e5e7eb' : 'rgba(139,160,189,0.2)', tooltipBg: isLight ? '#ffffff' : 'rgba(17, 28, 48, 0.96)',
    tooltipBorder: isLight ? '#e5e7eb' : '#22314d', tooltipText: isLight ? '#1f2937' : '#e6edf7',
    crossLine: isLight ? '#d1d5db' : 'rgba(139,160,189,0.4)', crossLabelBg: isLight ? '#9ca3af' : '#22314d',
    crossLabelText: '#ffffff', zoomBorder: isLight ? '#e5e7eb' : '#22314d', zoomFill: isLight ? 'rgba(37,99,235,.08)' : 'rgba(56,189,248,.15)',
    zoomText: isLight ? '#6b7280' : '#8ba0bd', zoomHandle: isLight ? '#2563eb' : '#38bdf8', lineBlue: isLight ? '#2563eb' : '#38bdf8',
    lineYellow: isLight ? '#f59e0b' : '#fbbf24', lineRed: isLight ? '#ef4444' : '#f87171', lineGreen: isLight ? '#10b981' : '#34d399',
    linePurple: isLight ? '#8b5cf6' : '#c084fc'
  };
});
const shiftMonths = window.shiftMonths || ((dateStr, months) => {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() - months);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
});
const getWeekKey = window.getWeekKey || ((dateStr) => {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay() || 7;
  const monday = new Date(d);
  monday.setDate(d.getDate() - day + 1);
  return monday.getFullYear() + '-' + String(monday.getMonth() + 1).padStart(2, '0') + '-' + String(monday.getDate()).padStart(2, '0');
});
const aggregateOHLC = window.aggregateOHLC || ((daily, gran) => {
  const groups = new Map();
  for (const r of daily) {
    if (r.open == null || r.high == null || r.low == null || r.close == null) continue;
    const key = gran === 'month' ? r.date.slice(0, 7) : getWeekKey(r.date);
    const g = groups.get(key);
    if (!g) groups.set(key, { key, open: r.open, high: r.high, low: r.low, close: r.close });
    else {
      if (r.high > g.high) g.high = r.high;
      if (r.low < g.low) g.low = r.low;
      g.close = r.close;
    }
  }
  return Array.from(groups.values()).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
});
const buildDataZoom = window.buildDataZoom || ((range, isMobile, bottom, theme) => {
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
});
const fitTrend = window.fitTrend || ((points) => {
  if (!points || points.length < 2) return null;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const p of points) { sx += p.x; sy += p.y; sxy += p.x * p.y; sxx += p.x * p.x; }
  const n = points.length;
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return (x) => slope * x + intercept;
});
const buildAxisTooltip = window.buildAxisTooltip || ((theme, formatter) => ({
  trigger: 'axis',
  axisPointer: { type: 'cross', label: { backgroundColor: theme.crossLabelBg, color: theme.crossLabelText }, crossStyle: { color: theme.crossLine }, lineStyle: { color: theme.crossLine } },
  confine: true, backgroundColor: theme.tooltipBg, borderColor: theme.tooltipBorder, borderWidth: 1, textStyle: { color: theme.tooltipText },
  extraCssText: 'box-shadow: 0 4px 12px rgba(0,0,0,.1); border-radius: 6px;',
  formatter
}));
const formatCandlestickTooltip = window.formatCandlestickTooltip || ((theme, params, getDataFn) => {
  if (!params || !params.length) return '';
  const p = params.find(item => item.seriesType === 'candlestick');
  if (!p) return '';
  const d = getDataFn(p.dataIndex);
  if (!d) return '';
  const upCls = d.close >= d.open;
  const color = upCls ? theme.lineRed : theme.lineGreen;
  let html = `<div style="font-weight:600;margin-bottom:4px;font-size:13px;">${d.date}</div><div style="font-size:12px;line-height:1.75;">`;
  html += `<div>开盘：<b>${d.open.toFixed(2)}</b></div>`;
  html += `<div>最高：<b>${d.high.toFixed(2)}</b></div>`;
  html += `<div>最低：<b>${d.low.toFixed(2)}</b></div>`;
  html += `<div>收盘：<b style="color:${color}">${d.close.toFixed(2)}</b></div>`;
  if (d.prevClose != null) {
    const chg = (d.close / d.prevClose - 1) * 100;
    html += `<div>涨跌幅：<b style="color:${chg >= 0 ? theme.lineRed : theme.lineGreen}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</b></div>`;
  }
  return html + '</div>';
});

// 设置 KPI 变化文本：pct == null 时显示占位符（统一处理无基准数据的情况）
function setDelta(el, text, pct) {
  if (pct == null) {
    el.textContent = '—';
    el.className = 'kpi-delta flat';
    return;
  }
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
  // Number(null) === 0，旧写法会把缺失的 OHLC 当成 0，画出一根假 K 线
  if (v === null || v === undefined || v === '') return fallback;
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

    // 透传 is_mock 标记
    out.push({
      date, mv: r.ashare_total, gdp, price,
      open: o, high: h, low: l, close: c,
      ratio: r.ashare_total / gdp,
      is_mock: r.is_mock === true
    });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

// 按周期分组，保留每组最后一条记录（含 mv/gdp/price/ratio 等完整字段）
function aggregateSeries(daily, gran) {
  if (gran === 'day') return daily;
  const groups = new Map();
  for (const r of daily) {
    let key;
    if (gran === 'month') key = r.date.slice(0, 7);
    else if (gran === 'week') key = getWeekKey(r.date);
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
// 【修复】末尾被剪掉的模拟值（当日源数据尚未发布时由 fallback 生成），只用于提示，不参与 KPI/图表
let mockTail = [];
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

  // 【修复】调度已改成「交易日当晚更新当日数据」，落库的最新一条就是 T 日；
  // 只有数据滞后（例如源站未发布）时才回退成 T-1 日，标签跟着数据日期走，不再写死 T-1/T-2。
  const todayStr = (() => {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  })();
  const isToday = last.date === todayStr;
  $('kpi-mv-date').textContent = (isToday ? 'T日：' : 'T-1日：') + last.date;
  $('kpi-mv').innerHTML = (last.mv / 10000).toFixed(2) + '<small>万亿</small>';

  const chg = (last.mv / prev.mv - 1) * 100;
  setDelta($('kpi-mv-d'), (isToday ? '较T-1日 ' : '较T-2日 '), chg);

  const yearNow = GDP_LATEST_YEAR, yearBase = yearNow - 1;
  $('kpi-gdp-label').textContent = 'GDP（' + yearNow + '）';
  const gdpVal = GDP_ANNUAL[yearNow];
  $('kpi-gdp').innerHTML = Number.isFinite(gdpVal)
    ? (gdpVal / 10000).toFixed(2) + '<small>万亿</small>'
    : '—';

  const gdpBase = GDP_ANNUAL[yearBase];
  setDelta($('kpi-gdp-yoy'), '同比 ' + yearBase + '年 ', (gdpVal && gdpBase) ? (gdpVal / gdpBase - 1) * 100 : null);

  $('kpi-ratio-label').textContent = '市值 / GDP（' + (GDP_CURRENT.isEstimate ? GDP_CURRENT.year + 'E' : GDP_CURRENT.year + '年') + '）';
  $('kpi-ratio').textContent = Number.isFinite(last.ratio) ? last.ratio.toFixed(3) : '—';

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

  // 动态检测最近是否有模拟数据
  const hasMock = dailySeries.some(s => s.is_mock);
  if (hasMock) {
    const warnEl = document.getElementById('mock-warning');
    if (!warnEl) {
      const warn = document.createElement('div');
      warn.id = 'mock-warning';
      warn.style.cssText = 'color: #d97706; margin-top: 8px; font-weight: 500; background: rgba(245,158,11,.1); padding: 4px 8px; border-radius: 4px; display: inline-block; border: 1px solid rgba(245,158,11,.3);';
      warn.innerHTML = '⚠️ 提示：图表中部分日期因接口延迟采用了历史等差推算的模拟值（悬停可见“模拟值”标签），待源数据恢复后将自动覆盖。';
      noteBar.appendChild(warn);
    }
  }

  // 【修复】末尾模拟值被剪掉时，明确写出页面截至哪一天，避免把推算值当成当天真实数据
  if (mockTail.length) {
    const tailEl = document.getElementById('mock-tail-warning');
    if (!tailEl) {
      const warn = document.createElement('div');
      warn.id = 'mock-tail-warning';
      warn.style.cssText = 'color: #b45309; margin-top: 8px; font-weight: 500; background: rgba(245,158,11,.1); padding: 4px 8px; border-radius: 4px; display: inline-block; border: 1px solid rgba(245,158,11,.3);';
      const lastMock = mockTail[mockTail.length - 1].date;
      const lastReal = dailySeries[dailySeries.length - 1].date;
      warn.textContent = '⚠️ ' + lastMock + ' 的源数据尚未发布，页面暂以 ' + lastReal + ' 为准，数据补齐后自动更新。';
      noteBar.appendChild(warn);
    }
  }
}

/* ============================================================
   6. 主图
   ============================================================ */
function getValuationMarks(theme) {
  const isMobile = window.innerWidth <= 720;
  // 【修复】三条阈值线原本都挤在右侧同一位置（insideEndTop），
  // 标签互相压住、还被平均股价折线穿过看不清。
  // 现在：危险在上方、偏高在下方、低估在上方，右侧同一端上下错开；
  // 标签加底色 + markLine 抬高 z（见 renderChart），压在折线之上不糊字。
  const chip = {
    backgroundColor: theme.isLight ? 'rgba(255,255,255,.94)' : 'rgba(11,18,32,.9)',
    padding: isMobile ? [0, 3] : [1, 4],
    borderRadius: 3,
    fontSize: isMobile ? 9 : 10,
    fontWeight: 600,
  };
  return [
    { y: 0.890, label: '0.890 危险', color: theme.isLight ? '#f97316' : '#fb923c', position: 'insideEndTop' },
    // 0.799 这条阈值在像素上和「价格=20 元」重合，右端放标签必然被平均股价折线压住，
    // 所以单独挪到左端起点，并左对齐，避免压到左侧 Y 轴刻度文字。
    { y: 0.799, label: '0.799 偏高', color: theme.isLight ? '#eab308' : '#facc15', position: 'insideStartTop', align: 'left', hideLabelOnMobile: true },
    { y: 0.590, label: '0.590 低估', color: theme.isLight ? '#3b82f6' : '#38bdf8', position: 'insideEndTop' }
  ].map(m => {
    const label = Object.assign({}, chip, {
      formatter: m.label,
      color: m.color,
      position: m.position,
      distance: 6,
    });
    if (m.align) label.align = m.align;   // 只有 0.799 需要显式左对齐，其余沿用默认
    // 手机窄屏下左侧 Y 轴刻度（0.9 / 0.6）离图内很近，0.799 的标签会压到刻度文字，
    // 所以窄屏只保留同名虚线、不显示文字标签，数值仍可在 tooltip 里看到。
    if (isMobile && m.hideLabelOnMobile) label.show = false;
    return {
      yAxis: m.y,
      lineStyle: { color: m.color, type: 'dashed', width: 1 },
      label,
    };
  });
}

function renderChart() {
  const series = getDisplaySeries();
  seriesIndex = new Map(series.map(s => [s.date, s]));
  const theme = getChartTheme();
  const isMobile = window.innerWidth <= 720;

  const endDate = series[series.length - 1].date;
  const startIndex = Math.max(0, series.findIndex(s => s.date >= shiftMonths(endDate, RANGE_MONTHS[currentGran][isMobile ? 'mobile' : 'desktop'])));
  const startPercent = series.length > 1 ? (startIndex / (series.length - 1)) * 100 : 0;

  if (!chart) chart = echarts.init($('chart-main'));

  chart.setOption({
    backgroundColor: 'transparent',
    grid: isMobile ? { left: 34, right: 34, top: 40, bottom: 60 } : { left: 45, right: 45, top: 50, bottom: 70 },
    legend: {
      top: 0, left: 'center', itemGap: isMobile ? 12 : 30, itemWidth: isMobile ? 14 : 24, itemHeight: isMobile ? 8 : 12,
      data: ['市值/GDP', '平均股价(元)'], textStyle: { color: theme.legend || theme.text, fontSize: isMobile ? 11 : 12 }
    },
    // 统一 tooltip（带兜底防御）
    tooltip: buildAxisTooltip(theme, params => {
      if (!params || !params.length) return '';
      const d = params[0].axisValue, r = seriesIndex.get(d);
      if (!r) return '';
      const v = valuation(r.ratio);

      // 如果是模拟值，加一个醒目的红框标签
      const mockTag = r.is_mock ? '<span style="color:#ef4444;font-size:10px;border:1px solid #ef4444;padding:0 4px;border-radius:4px;margin-left:4px;">模拟值</span>' : '';

      let html = `<div style="font-weight:600;margin-bottom:4px;font-size:13px;">${d} ${mockTag}</div>`;
      html += `<div style="font-size:12px;color:${theme.lineBlue};">市值/GDP：${r.ratio.toFixed(3)}</div>`;
      if (r.price != null) html += `<div style="font-size:12px;color:${theme.lineYellow};">平均股价：${r.price.toFixed(2)} 元</div>`;
      else html += `<div style="font-size:12px;color:${theme.text};">平均股价：暂无数据</div>`;
      html += `<div style="font-size:12px;margin-top:4px;"><b>${v.level} · ${v.action}</b></div>`;
      return html;
    }),
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
        markLine: { silent: true, symbol: 'none', z: 10, label: { fontSize: isMobile ? 9 : 10 }, data: getValuationMarks(theme) }
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
const TREND_HIGH_KEYS = ['2008-02', '2015-12', '2021-12'].map(key => ({ key, pick: 'high' }));
const TREND_LOW_KEYS  = ['2008-11', '2019-01', '2024-02'].map(key => ({ key, pick: 'low'  }));
const TREND_MIX_KEYS  = [{ key: '2005-09', pick: 'high' }, { key: '2012-12', pick: 'low' }];

// 用 fitTrend 拟合趋势：仅返回从首锚点起每期的预测值（前置 null 保持对齐）
function buildExtendedTrend(agg, anchors) {
  const keyToIdx = new Map(); agg.forEach((g, i) => keyToIdx.set(g.key, i));
  const pts = [];
  for (const a of anchors) { const idx = keyToIdx.get(a.key); if (idx != null) pts.push({ x: idx, y: agg[idx][a.pick] }); }
  const predict = fitTrend(pts);
  if (!predict) return null;
  const out = new Array(agg.length).fill(null);
  for (let i = pts[0].x; i < agg.length; i++) out[i] = +predict(i).toFixed(3);
  return out;
}

function trendSeries(name, data, color, dashed) {
  const lineStyle = { color: color, width: 1.8 }; if (dashed) lineStyle.type = 'dashed';
  return { name, type: 'line', data, connectNulls: true, symbol: 'none', showSymbol: false, smooth: false, lineStyle, z: 5 };
}

function renderPriceChart() {
  if (!dailySeries.length) return;
  if (!priceAgg) priceAgg = aggregateOHLC(dailySeries, 'month');
  if (!priceAgg.length) return;
  const agg = priceAgg;

  const theme = getChartTheme(); const isMobile = window.innerWidth <= 720;
  const total = agg.length; const visible = Math.min(isMobile ? 60 : 72, total); const startIndex = Math.max(0, total - visible);

  if (!priceChart) priceChart = echarts.init($('chart-price'));

  const seriesArr = [{
    name: '平均股价', type: 'candlestick', data: agg.map(g => [g.open, g.close, g.low, g.high]),
    barMaxWidth: 6, itemStyle: { color: theme.lineRed, color0: theme.lineGreen, borderColor: theme.lineRed, borderColor0: theme.lineGreen }
  }];

  if (trendVisible.high) {
    const d = buildExtendedTrend(agg, TREND_HIGH_KEYS);
    if (d) seriesArr.push(trendSeries(TREND_NAME.high, d, theme.lineRed));
  }
  if (trendVisible.low) {
    const d = buildExtendedTrend(agg, TREND_LOW_KEYS);
    if (d) seriesArr.push(trendSeries(TREND_NAME.low, d, theme.lineBlue));
  }
  if (trendVisible.mix) {
    const d = buildExtendedTrend(agg, TREND_MIX_KEYS);
    if (d) seriesArr.push(trendSeries(TREND_NAME.mix, d, theme.linePurple, true));
  }

  priceChart.setOption({
    backgroundColor: 'transparent', legend: { show: false },
    grid: isMobile ? { left: 8, right: 12, top: 20, bottom: 46, containLabel: true } : { left: 22, right: 30, top: 26, bottom: 62, containLabel: true },
    // ★ 统一调用公共 K线排版工具（带兜底防御）
    tooltip: buildAxisTooltip(theme, params => {
      return formatCandlestickTooltip(theme, params, (idx) => {
        const g = agg[idx];
        if (!g) return null;
        const prev = idx > 0 ? agg[idx - 1] : null;
        return {
          date: g.key,
          open: g.open,
          high: g.high,
          low: g.low,
          close: g.close,
          prevClose: prev ? prev.close : null
        };
      });
    }),
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
  // 【修复】数据末尾如果是 is_mock 的推算值（例如当天收盘数据还没发布），
  // 之前的做法会把它当成「T 日」写进 KPI 和图线，看起来像当天暴跌。
  // 现在把末尾连续的模拟值剪掉，KPI/图表只画真实数据，并在提示栏说明截至哪一天。
  mockTail = [];
  while (dailySeries.length && dailySeries[dailySeries.length - 1].is_mock) {
    mockTail.unshift(dailySeries.pop());
  }
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

  let lastIsMobile = window.innerWidth <= 720;

  window.addEventListener('resize', debounce(() => {
    if (!chart) return;
    const nowMobile = window.innerWidth <= 720;
    if (nowMobile !== lastIsMobile) {
      lastIsMobile = nowMobile;
      chart.dispose(); chart = null;
      if (priceChart) { priceChart.dispose(); priceChart = null; }
      renderChart(); renderPriceChart(); renderTable();
    } else {
      chart.resize();
      if (priceChart) priceChart.resize();
    }
  }, 250));
})();

/* ============================================================
   9. 平均股价推演（原 wave_interpretate.js 并入）
   双轨参数、27 个月 A/B/C 推演路径；复用 common.js 公共工具。
   推演图独占 DOM id：chart-forecast（与上面均价 K 线 chart-price 区分）。
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 双轨参数：单一数据源 ---------- */
  var TRACK_UP  = { startYM: '2005-06', startPrice: 5.137, slope: 0.0465 };
  var TRACK_LOW = { startYM: '2005-07', startPrice: 4.229, slope: 0.0435 };

  /* 提取截图里的经典红绿配色 */
  var CUSTOM_RED = '#f5222d';   // 鲜艳的红（阳线 / 下轨）
  var CUSTOM_GREEN = '#00b050'; // 经典的绿（阴线）

  var chartDom = document.getElementById('chart-forecast');
  var mockNotice = document.getElementById('mockNotice');
  var myChart = null;

  /* ---------- 小工具 ---------- */
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function toNum(v) {
    if (v == null || v === '') return null;
    var n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : null;
  }
  function fmt2(v) { var n = toNum(v); return n == null ? '—' : n.toFixed(2); }
  /* 月份 ↔ 月序号：直接用 common.js 的 ymToIndex / indexToYM，这里保留原变量名减少改动 */
  var ymIndex = window.ymToIndex;
  var ymFromIndex = window.indexToYM;
  function alpha(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function trackAt(t, idx) {
    return t.startPrice + t.slope * (idx - ymIndex(t.startYM));
  }

  /* ---------- 1. 数据准备：复用 aggregateOHLC + sortByDate ---------- */
  function normalizeRow(it) {
    var price = toNum(it.price), open = toNum(it.open),
        close = toNum(it.close), low = toNum(it.low), high = toNum(it.high);
    if (open == null)  open  = price != null ? price : close;
    if (close == null) close = price != null ? price : open;
    if (open == null || close == null) return null;
    if (low == null)   low  = Math.min(open, close);
    if (high == null)  high = Math.max(open, close);
    return { date: it.date, open: open, close: close, low: low, high: high };
  }

  // 固定随机种子：没有真实数据时也能得到稳定、可复现的占位曲线
  function makeRng(seed) {
    var s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }

  function buildMockData() {
    var out = [], cur = new Date(2005, 0, 1), end = new Date(2026, 10, 1),
        prev = null, i = 0, rnd = makeRng(20050601);
    while (cur <= end) {
      var t = i / 12;
      var wave = 5 * Math.sin((t - 0.5) / 2.2) + 2.2 * Math.sin((t - 1) / 0.9) + 0.9 * Math.sin(t / 0.35);
      var target = Math.max(3.2, 7 + 0.3 * t + wave);
      var close = Math.max(3, +(target + (rnd() - 0.5) * 0.6).toFixed(2));
      var open = prev == null ? close : Math.max(3, +(prev + (rnd() - 0.5) * 0.5).toFixed(2));
      var high = +(Math.max(open, close) + rnd() * 0.8).toFixed(2);
      var low  = +(Math.min(open, close) - rnd() * 0.8).toFixed(2);
      out.push({ date: cur.getFullYear() + '-' + pad2(cur.getMonth() + 1) + '-01', open: open, close: close, low: low, high: high });
      prev = close; i++; cur.setMonth(cur.getMonth() + 1);
    }
    return out;
  }

  var USED_MOCK = false;

  function getRawData() {
    USED_MOCK = false;
    var ashare = window.MARKET_DATA && window.MARKET_DATA.ashare;
    if (ashare && typeof ashare === 'object') {
      var list = Object.keys(ashare).map(function (k) {
        return Object.assign({ date: k }, ashare[k] || {});
      }).filter(function (it) {
        return it && /^\d{4}-\d{2}-\d{2}$/.test(it.date);
      }).map(normalizeRow).filter(Boolean);
      if (list.length) return window.sortByDate(list);
    }
    USED_MOCK = true;
    return buildMockData();
  }

  /* ---------- 2. 波浪推演：显式价格路径表 ----------
     A 浪末段 2 + B 浪 1 + C 浪 24（4/2/7/3/4/1/3）= 27 个月，终点 2029-02。
     每月给定收盘价与影线极值，开盘价 = 上月收盘，天然连续、无跳空；
     不再用“百分比 × 全局缩放系数”去二分硬凑终点，也不再被下轨截断改写出假阳线。 */
  var FORECAST_PLAN = [
    // A 浪末段：2026-12 ~ 2027-01（2 个月）
    { tag: 'A 浪末段', close: 21.45, high: 22.55, low: 21.20 },
    { tag: 'A 浪末段', close: 20.77, high: 21.70, low: 20.40 },
    // B 浪：2027-02（1 个月，大阳线）
    { tag: 'B 浪', close: 24.30, high: 24.95, low: 20.60 },
    // C1 初跌：2027-03 ~ 2027-06（4 个月）
    { tag: 'C1 初跌', close: 23.40, high: 24.60, low: 23.10 },
    { tag: 'C1 初跌', close: 22.30, high: 23.75, low: 22.00 },
    { tag: 'C1 初跌', close: 21.50, high: 22.55, low: 21.20 },
    { tag: 'C1 初跌', close: 20.90, high: 21.75, low: 20.55 },
    // C2 反弹：2027-07 ~ 2027-08（2 个月）
    { tag: 'C2 反弹', close: 21.60, high: 21.85, low: 20.65 },
    { tag: 'C2 反弹', close: 22.60, high: 22.90, low: 21.45 },
    // C3 主跌：2027-09 ~ 2028-03（7 个月）
    { tag: 'C3 主跌', close: 21.70, high: 22.85, low: 21.55 },
    { tag: 'C3 主跌', close: 20.80, high: 21.95, low: 20.50 },
    { tag: 'C3 主跌', close: 20.10, high: 21.05, low: 19.85 },
    { tag: 'C3 主跌', close: 19.40, high: 20.30, low: 19.15 },
    { tag: 'C3 主跌', close: 18.80, high: 19.65, low: 18.55 },
    { tag: 'C3 主跌', close: 18.20, high: 19.00, low: 17.95 },
    { tag: 'C3 主跌', close: 17.60, high: 18.45, low: 17.35 },
    // C4 复杂反弹：2028-04 ~ 2028-06（3 个月）
    { tag: 'C4 反弹', close: 18.20, high: 18.45, low: 17.40 },
    { tag: 'C4 反弹', close: 18.70, high: 18.95, low: 18.00 },
    { tag: 'C4 反弹', close: 19.00, high: 19.30, low: 18.50 },
    // C5 末跌：2028-07 ~ 2028-10（4 个月）
    { tag: 'C5 末跌', close: 18.30, high: 19.25, low: 18.05 },
    { tag: 'C5 末跌', close: 17.70, high: 18.55, low: 17.45 },
    { tag: 'C5 末跌', close: 17.20, high: 17.95, low: 16.95 },
    { tag: 'C5 末跌', close: 16.85, high: 17.45, low: 16.60 },
    // C6 反抽：2028-11（1 个月）
    { tag: 'C6 反抽', close: 17.45, high: 17.70, low: 16.60 },
    // C7 衰竭触底：2028-12 ~ 2029-02（3 个月），末月收盘 = 下轨值
    { tag: 'C7 衰竭', close: 17.10, high: 17.75, low: 16.85 },
    { tag: 'C7 衰竭', close: 16.80, high: 17.35, low: 16.55 },
    { tag: 'C7 衰竭', close: null,  high: 17.05, low: 16.30 }
  ];

  function buildForecastKData(startYM, lastClose) {
    if (!isFinite(lastClose) || lastClose <= 0) lastClose = 22.30;

    var startIdx = ymIndex(startYM);
    var endIdx = startIdx + FORECAST_PLAN.length - 1;
    var targetEndPrice = +trackAt(TRACK_LOW, endIdx).toFixed(2);   // 末月精准收在下轨

    var k = {}, tag = {}, prevClose = lastClose;
    for (var i = 0; i < FORECAST_PLAN.length; i++) {
      var idx = startIdx + i, ym = ymFromIndex(idx), p = FORECAST_PLAN[i];
      var open  = prevClose;
      var close = (p.close == null) ? targetEndPrice : p.close;
      var high  = Math.max(p.high, open, close);
      var low   = Math.min(p.low, open, close);

      k[ym]   = [+open.toFixed(2), +close.toFixed(2), +low.toFixed(2), +high.toFixed(2)];
      tag[ym] = p.tag;
      prevClose = close;
    }
    return { k: k, tag: tag, endYM: ymFromIndex(endIdx), target: targetEndPrice };
  }

  /* ---------- 3. 渲染 ---------- */
  function render() {
    if (!chartDom) return;
    var theme = window.getChartTheme();
    var isMobile = window.innerWidth <= 768;

    var rawData = getRawData();
    if (mockNotice) mockNotice.style.display = USED_MOCK ? 'block' : 'none';

    var monthly = window.aggregateOHLC(rawData, 'month');
    var realObj = {};
    monthly.forEach(function (m) { realObj[m.key] = m; });

    var lastRealYM  = monthly.length ? monthly[monthly.length - 1].key : '2026-11';
    var forecastStartYM = ymFromIndex(ymIndex(lastRealYM) + 1);
    var lastRealClose = realObj[lastRealYM] ? realObj[lastRealYM].close : 22.30;

    var fc = buildForecastKData(forecastStartYM, lastRealClose);
    var forecastObj = fc.k, forecastTag = fc.tag;

    // 月份轴
    var allMonths = [];
    for (var ii = ymIndex('2005-01'); ii <= ymIndex(fc.endYM); ii++) {
      allMonths.push(ymFromIndex(ii));
    }

    // 序列
    var startForecastIdx = ymIndex(forecastStartYM);
    // 默认视窗显示最近 10 年，避免 20 年数据挤在一屏里看不清
    var zoomStart = allMonths.length > 1
      ? Math.max(0, (1 - 120 / (allMonths.length - 1)) * 100)
      : 0;
    var realSeries = [], forecastSeries = [];
    allMonths.forEach(function (ym) {
      if (ymIndex(ym) < startForecastIdx && realObj[ym]) {
        var v = realObj[ym];
        realSeries.push([v.open, v.close, v.low, v.high]);
      } else { realSeries.push('-'); }

      if (forecastObj[ym]) {
        var f = forecastObj[ym];
        forecastSeries.push([f[0], f[1], f[2], f[3]]);
      } else { forecastSeries.push('-'); }
    });

    // 轨道线
    var endRealIdx = ymIndex(lastRealYM), endForecastIdx = ymIndex(fc.endYM);
    var A_Up_Solid = [], A_Low_Solid = [], A_Up_Ext = [], A_Low_Ext = [];
    allMonths.forEach(function (ym) {
      var idx = ymIndex(ym);
      A_Up_Solid.push((idx >= ymIndex(TRACK_UP.startYM) && idx <= endRealIdx) ? +trackAt(TRACK_UP, idx).toFixed(2) : null);
      A_Low_Solid.push((idx >= ymIndex(TRACK_LOW.startYM) && idx <= endRealIdx) ? +trackAt(TRACK_LOW, idx).toFixed(2) : null);

      if (idx >= endRealIdx && idx <= endForecastIdx) {
        A_Up_Ext.push(+trackAt(TRACK_UP, idx).toFixed(2));
        A_Low_Ext.push(+trackAt(TRACK_LOW, idx).toFixed(2));
      } else {
        A_Up_Ext.push(null); A_Low_Ext.push(null);
      }
    });

    // 锚点圆点：数值由轨道公式反算，保证点必然在线上
    var upAnchors  = ['2005-06', '2012-11', '2019-08', '2024-06'];
    var lowAnchors = ['2005-07', '2008-11', '2019-02', '2024-02'];
    var Up_Scatter = upAnchors.map(function (ym) {
      return { value: [ym, +trackAt(TRACK_UP, ymIndex(ym)).toFixed(2)] };
    });
    var Low_Scatter = lowAnchors.map(function (ym) {
      return { value: [ym, +trackAt(TRACK_LOW, ymIndex(ym)).toFixed(2)] };
    });

    /* Y 轴：沿用 3~38 的经典区间，仅在数据超出时才扩展，避免固定值把新数据裁掉 */
    var yLo = Infinity, yHi = -Infinity;
    monthly.forEach(function (m) {
      if (isFinite(m.low))  yLo = Math.min(yLo, m.low);
      if (isFinite(m.high)) yHi = Math.max(yHi, m.high);
    });
    for (var q = 0; q < FORECAST_PLAN.length; q++) {
      var pk = forecastObj[ymFromIndex(startForecastIdx + q)];
      if (!pk) continue;
      yLo = Math.min(yLo, pk[2]); yHi = Math.max(yHi, pk[3]);
    }
    yLo = Math.min(yLo, trackAt(TRACK_LOW, endForecastIdx));
    yHi = Math.max(yHi, trackAt(TRACK_UP, endForecastIdx));
    if (!isFinite(yLo) || !isFinite(yHi)) { yLo = 3; yHi = 38; }
    var yMin = Math.min(3, Math.floor(yLo - 1));
    var yMax = Math.max(38, Math.ceil(yHi + 2));

    // Tooltip
    function tooltipFormatter(params) {
      if (!params || !params.length) return '';
      var ym = params[0].axisValue;
      var idx = ymIndex(ym);
      var res = '<div style="font-weight:600;margin-bottom:6px;font-size:13px;">' + ym + '</div>';
      res += '<div style="font-size:12px;line-height:1.75;">';

      if (realObj[ym]) {
        var v = realObj[ym];
        var c1 = Number(v.close) > Number(v.open) ? CUSTOM_RED : CUSTOM_GREEN;
        res += '<div style="color:' + c1 + ';font-weight:600;margin-bottom:2px;">历史K线</div>';
        res += '<div>开 ' + fmt2(v.open) + ' 高 ' + fmt2(v.high) + ' 低 ' + fmt2(v.low) + ' 收 <b style="color:' + c1 + '">' + fmt2(v.close) + '</b></div>';
      }
      if (forecastObj[ym]) {
        var f = forecastObj[ym];
        var c2 = Number(f[1]) > Number(f[0]) ? CUSTOM_RED : CUSTOM_GREEN;
        res += '<div style="color:' + c2 + ';font-weight:600;margin:4px 0 2px;">推演K线 · ' + (forecastTag[ym] || '') + '</div>';
        res += '<div>开 ' + fmt2(f[0]) + ' 高 ' + fmt2(f[3]) + ' 低 ' + fmt2(f[2]) + ' 收 <b style="color:' + c2 + '">' + fmt2(f[1]) + '</b></div>';
        res += '<div style="font-size:11px;opacity:.65;margin-top:2px;">※ 结构推演，非真实数据</div>';
      }
      if (idx >= ymIndex(TRACK_UP.startYM)) {
        res += '<div style="margin-top:4px;color:' + theme.lineBlue + ';">上轨 ' + fmt2(trackAt(TRACK_UP, idx)) + '</div>';
      }
      if (idx >= ymIndex(TRACK_LOW.startYM)) {
        res += '<div style="color:' + CUSTOM_RED + ';">下轨 ' + fmt2(trackAt(TRACK_LOW, idx)) + '</div>';
      }
      return res + '</div>';
    }

    var option = {
      backgroundColor: 'transparent',
      tooltip: window.buildAxisTooltip(theme, tooltipFormatter),
      grid: { left: '2%', right: '3%', bottom: '12%', top: '8%', containLabel: true },
      xAxis: {
        type: 'category',
        data: allMonths,
        boundaryGap: true,
        splitLine: { show: false },
        axisLabel: {
          formatter: function (v) { return String(v).slice(0, 4); },
          // 只在每年 1 月的刻度出年份，避免 interval:auto 产生“2005 2005 2006”重复标签
          interval: function (i, v) { return String(v).slice(5) === '01'; },
          hideOverlap: true,
          color: theme.text
        },
        axisLine: { lineStyle: { color: theme.axis } },
        axisTick: { show: false }
      },
      yAxis: {
        type: 'value', min: yMin, max: yMax,
        splitLine: { lineStyle: { type: 'dashed', color: theme.grid } },
        axisLabel: { color: theme.text },
        axisLine: { show: false }, axisTick: { show: false }
      },
      dataZoom: window.buildDataZoom(
        { xAxisIndex: 0, start: zoomStart, end: 100, minValueSpan: 3 },
        isMobile, isMobile ? 5 : 10, theme
      ),
      series: [
        {
          name: '历史K线', type: 'candlestick', data: realSeries, barMaxWidth: 10,
          itemStyle: {
            color: CUSTOM_RED,   color0: CUSTOM_GREEN, // 阳线红，阴线绿
            borderColor: CUSTOM_RED, borderColor0: CUSTOM_GREEN
          }
        },
        {
          name: '推演K线', type: 'candlestick', data: forecastSeries, barMaxWidth: 10,
          itemStyle: {
            color:  alpha(CUSTOM_RED, 0.35),
            color0: alpha(CUSTOM_GREEN, 0.35),
            borderColor: CUSTOM_RED, borderColor0: CUSTOM_GREEN, borderWidth: 1
          }
        },
        { name: '上轨实线', type: 'line', data: A_Up_Solid,  showSymbol: false, lineStyle: { color: theme.lineBlue, width: 2 }, z: 3 },
        { name: '下轨实线', type: 'line', data: A_Low_Solid, showSymbol: false, lineStyle: { color: CUSTOM_RED,  width: 2 }, z: 3 },
        { name: '上轨延伸', type: 'line', data: A_Up_Ext,    showSymbol: false, lineStyle: { color: theme.lineBlue, width: 2, type: 'dashed', opacity: .6 }, tooltip: { show: false }, z: 2 },
        { name: '下轨延伸', type: 'line', data: A_Low_Ext,   showSymbol: false, lineStyle: { color: CUSTOM_RED,  width: 2, type: 'dashed', opacity: .6 }, tooltip: { show: false }, z: 2 },
        { name: '上轨锚点', type: 'scatter', data: Up_Scatter,  symbol: 'circle', symbolSize: 7,
          itemStyle: { color: theme.lineBlue, borderColor: '#fff', borderWidth: 2 }, tooltip: { show: false }, z: 5 },
        { name: '下轨锚点', type: 'scatter', data: Low_Scatter, symbol: 'circle', symbolSize: 7,
          itemStyle: { color: CUSTOM_RED,  borderColor: '#fff', borderWidth: 2 }, tooltip: { show: false }, z: 5 }
      ]
    };

    if (!myChart) myChart = echarts.init(chartDom);
    myChart.setOption(option, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
  window.addEventListener('themeChanged', render);
  window.addEventListener('resize', window.debounce(function () {
    if (myChart) myChart.resize();
  }, 200));
})();
