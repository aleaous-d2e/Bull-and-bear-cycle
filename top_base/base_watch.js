/* =========================================================
   base_watch.js —— 熊底监测（本页图表逻辑）
   包含两个独立图表：
     1. 破净比例与大盘指数（ECharts）
     2. 指数月线（ECharts 重构版）
   依赖：
     - base_watch_data.js       → window.RAW_DATA / window.INDEX_DATA
     - ECharts 5.x           → window.echarts
     - common.js             → window.getChartTheme() / themeChanged 事件
                             + window.formatDate / getWeekKey / getCssVar
                             + window.nearestOnOrAfter / nearestOnOrBefore
                             + window.buildAxisTooltip / window.fitTrend
   ========================================================= */

/* =========================================================
   第一部分：破净比例与大盘指数（ECharts）
   ========================================================= */
(function () {
  'use strict';

  const chartEl = document.getElementById('peChart');
  if (!chartEl) return;

  let chart = null;
  let currentPeriod = 'day'; // day | week | month

  /* ---------- 工具：直接复用 common.js 提供的公共工具 ---------- */
  const {
    formatDate, getWeekKey, getCssVar,
    nearestOnOrAfter, nearestOnOrBefore,
    buildAxisTooltip,
  } = window;

  /* ---------- 数据聚合 ----------
     返回 [日期, 破净比例, 大盘指数] */
  function aggregate(RAW, period) {
    if (period === 'day') {
      return RAW.map(r => [r[0], Number(r[4]), Number(r[3])]);
    }
    const groups = new Map();
    RAW.forEach(r => {
      const date = r[0];
      const key = period === 'month' ? date.slice(0, 7) : getWeekKey(date);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });
    const result = [];
    groups.forEach(items => {
      const ratio = items.reduce((s, r) => s + Number(r[4]), 0) / items.length;
      const close = items[items.length - 1][3];
      const lastDate = items[items.length - 1][0];
      result.push([lastDate, Number(ratio.toFixed(2)), Number(close)]);
    });
    result.sort((a, b) => a[0].localeCompare(b[0]));
    return result;
  }

  /* ---------- 默认视窗：日→近3年，周→近5年，月→全部 ---------- */
  function calcZoom(data, period) {
    if (!data.length) return { start: 0, end: 100 };
    if (period === 'month') return { start: 0, end: 100 };

    const yearsBack = period === 'week' ? 5 : 3;

    const last = new Date(data[data.length - 1][0] + 'T00:00:00');
    const fromDate = new Date(last);
    fromDate.setFullYear(fromDate.getFullYear() - yearsBack);

    let idx = data.findIndex(r => new Date(r[0] + 'T00:00:00') >= fromDate);
    if (idx < 0) idx = 0;

    const start = data.length > 1 ? (idx / (data.length - 1)) * 100 : 0;
    return { start: Math.max(0, start), end: 100 };
  }

  /* ---------- 底部区间标注 ----------
     “当前”区间动态跟随数据最后一天：
     end = 数据最后日期，start = 最后日期往前推 5 个月 */
  function buildMarkAreas(dates) {
    if (!dates.length) return [];
    const lastDate = dates[dates.length - 1];
    const lastD = new Date(lastDate + 'T00:00:00');
    const curStartD = new Date(lastD);
    curStartD.setMonth(curStartD.getMonth() - 5);
    const curStart = formatDate(curStartD);

    const ranges = [
      { name: '05底', start: '2005-06-01', end: '2005-12-30' },
      { name: '08底', start: '2008-10-06', end: '2008-12-31' },
      { name: '13底', start: '2012-11-01', end: '2013-07-31' },
      { name: '16底', start: '2016-01-04', end: '2016-03-31' },
      { name: '18底', start: '2018-10-08', end: '2019-01-31' },
      { name: '24底', start: '2024-01-02', end: '2024-09-30' },
      { name: '当前', start: curStart, end: lastDate }
    ];
    return ranges
      .map(r => {
        const s = nearestOnOrAfter(dates, r.start);
        const e = nearestOnOrBefore(dates, r.end);
        if (!s || !e || s > e) return null;
        return [{ name: r.name, xAxis: s }, { xAxis: e }];
      })
      .filter(Boolean);
  }

  /* ---------- 重大事件竖线（颜色由 CSS 变量注入） ---------- */
  function buildEventLines(dates, colors) {
    const events = [
      { date: '2007-10-16', label: '6124 07顶', type: 'top' },
      { date: '2015-06-12', label: '5166 15顶', type: 'top' },
      { date: '2018-01-17', label: '3446 18顶', type: 'top' },
      { date: '2021-09-10', label: '3705 21顶', type: 'top' },
      { date: '2025-04-07', label: '3047 关税冲击', type: 'shock' },
      { date: '2026-05-13', label: '4243 26顶', type: 'top' }
    ];
    return events
      .map(e => {
        const d = nearestOnOrAfter(dates, e.date);
        if (!d) return null;
        const isTop = e.type === 'top';
        return {
          xAxis: d,
          name: e.label,
          lineStyle: {
            color: isTop ? colors.topLine : colors.shockLine,
            type: 'dashed',
            width: 1
          },
          label: {
            show: true,
            color: isTop ? colors.topText : colors.shockText,
            fontSize: 10,
            fontWeight: 600,
            formatter: e.label,
            position: 'insideEndTop',
            distance: 4,
            rotate: 0,
            backgroundColor: colors.labelBg,
            padding: [3, 6],
            borderRadius: 3
          }
        };
      })
      .filter(Boolean);
  }

  /* ---------- 构建 option ---------- */
  function buildOption(data, period) {
    const dates = data.map(r => r[0]);
    const ratio = data.map(r => r[1]);
    const close = data.map(r => r[2]);

    const t = window.getChartTheme();

    const colorOrange = getCssVar('--chart-orange', t.lineYellow);
    const colorBlue   = getCssVar('--chart-blue',   t.lineBlue);
    const panelBg     = getCssVar('--panel',        t.tooltipBg);

    /* 事件标注颜色（CSS 变量随主题切换） */
    const eventColors = {
      topText:   getCssVar('--event-top',        '#f87171'),
      shockText: getCssVar('--event-shock',      '#fbbf24'),
      topLine:   getCssVar('--event-top-line',   'rgba(248,113,113,0.55)'),
      shockLine: getCssVar('--event-shock-line', 'rgba(251,191,36,0.55)'),
      labelBg:   getCssVar('--event-label-bg',   'rgba(15,23,42,0.72)')
    };

    /* 底部灰块：底色 + 边框 */
    const markAreaBg     = getCssVar('--mark-area-bg',     'rgba(148,163,184,0.18)');
    const markAreaBorder = getCssVar('--mark-area-border', 'rgba(148,163,184,0.35)');

    const labelFormatter = period === 'month'
      ? v => v.slice(0, 7)
      : v => v.slice(5);

    const minValueSpan = period === 'month' ? 6 : period === 'week' ? 12 : 20;
    const zoom = calcZoom(data, period);
    const markAreas = buildMarkAreas(dates);
    const eventLines = buildEventLines(dates, eventColors);

    return {
      backgroundColor: 'transparent',
      animationDuration: 500,
      animationEasing: 'cubicOut',

      // 统一 tooltip（只传不同 formatter）
      tooltip: buildAxisTooltip(t, params => {
        if (!params || !params.length) return '';
        const r = data[params[0].dataIndex];
        if (!r) return '';
        return `<b>${r[0]}</b><br/>`
             + `破净比例：${r[1]}%<br/>`
             + `大盘指数：${r[2]}`;
      }),

      // 图例已由 HTML 的 .chart-legend 提供，这里关闭 ECharts 自带图例，避免重复
      legend: { show: false },

      grid: { left: 64, right: 72, top: 56, bottom: 92 },

      xAxis: {
        type: 'category',
        data: dates,
        boundaryGap: false,
        axisLine: { lineStyle: { color: t.axis } },
        axisLabel: { color: t.text, formatter: labelFormatter },
        axisTick: { show: false }
      },

      yAxis: [
        {
          type: 'value',
          name: '破净比例',
          scale: true,
          nameTextStyle: { color: t.text },
          axisLabel: { color: t.text, formatter: '{value}%' },
          splitLine: { lineStyle: { color: t.grid } }
        },
        {
          type: 'value',
          name: '指数',
          scale: true,
          nameTextStyle: { color: t.text },
          axisLabel: { color: t.text },
          splitLine: { show: false }
        }
      ],

      dataZoom: [
        { type: 'inside', start: zoom.start, end: zoom.end, minValueSpan },
        {
          type: 'slider',
          bottom: 24,
          height: 22,
          start: zoom.start,
          end: zoom.end,
          borderColor: t.zoomBorder,
          backgroundColor: panelBg,
          fillerColor: t.zoomFill,
          handleStyle: { color: t.zoomHandle },
          textStyle: { color: t.zoomText }
        }
      ],

      series: [
        {
          name: '破净比例',
          type: 'line',
          data: ratio,
          yAxisIndex: 0,
          showSymbol: false,
          sampling: 'lttb',
          lineStyle: { width: 1.6, color: colorOrange },
          itemStyle: { color: colorOrange },
          areaStyle: { opacity: 0.12, color: colorOrange },

          /* 底部区间标注：“当前”区间跟随数据最后日期动态生成 */
          markArea: {
            silent: true,
            itemStyle: {
              color: markAreaBg,
              borderColor: markAreaBorder,
              borderWidth: 1
            },
            label: {
              color: t.text,
              fontSize: 10,
              position: 'insideTop',
              distance: 4
            },
            data: markAreas
          },

          /* 事件竖线：每条自带 lineStyle/label，双色 + 横条 */
          markLine: {
            silent: true,
            symbol: 'none',
            data: eventLines
          }
        },
        {
          name: '大盘指数',
          type: 'line',
          data: close,
          yAxisIndex: 1,
          showSymbol: false,
          sampling: 'lttb',
          lineStyle: { width: 1.4, color: colorBlue },
          itemStyle: { color: colorBlue }
        }
      ]
    };
  }

  /* ---------- 渲染 ---------- */
  function render() {
    if (!chart) return;
    const raw = (window.RAW_DATA || []).slice();
    if (!raw.length) return;
    // 首条日期 > 末条日期 ⇒ 降序，需要反转；否则视为已是升序
    const isDesc = raw[0][0] > raw[raw.length - 1][0];
    const RAW = isDesc ? raw.reverse() : raw;
    const data = aggregate(RAW, currentPeriod);
    chart.setOption(buildOption(data, currentPeriod), true);
  }

  /* ---------- 初始化 ---------- */
  function init() {
    if (!window.echarts) return;
    if (!window.RAW_DATA || !window.RAW_DATA.length) {
      console.warn('[base_pe] RAW_DATA 为空，跳过渲染');
      return;
    }
    chart = echarts.init(chartEl, null, { renderer: 'canvas' });
    render();

    const tabs = document.getElementById('periodTabs');
    if (tabs) {
      tabs.addEventListener('click', e => {
        const btn = e.target.closest('.period-btn');
        if (!btn) return;
        const p = btn.dataset.period;
        if (!p || p === currentPeriod) return;
        currentPeriod = p;
        tabs.querySelectorAll('.period-btn').forEach(b => {
          b.classList.toggle('active', b === btn);
        });
        render();
      });
    }
  }

  /* ---------- 主题切换后重绘 ---------- */
  function rebuild() {
    if (!chart) return;
    render();
    chart.resize();
  }

  window.addEventListener('themeChanged', () => {
    requestAnimationFrame(rebuild);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  /* ---------- 尺寸自适应 ---------- */
  window.addEventListener('resize', () => {
    if (chart) chart.resize();
  });

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => {
      if (chart) chart.resize();
    });
    ro.observe(chartEl);
  }

})();


/* =========================================================
   第二部分：指数月线（ECharts 重构版，样式与 avg_price 统一）
   ========================================================= */

/* 各指数的趋势线配置 */
const INDEX_TRENDS = {
   '上证': [
    { key: 'low',  name: '国运支撑', color: '#38bdf8', anchors: ['2008-10', '2024-02'], pick: 'low' },
    { key: 'mix',  name: '低估定投', color: '#a78bfa', anchors: ['2008-09', '2019-01'], pick: 'low' },
    { key: 'high', name: '高风险',   color: '#ef4444', anchors: ['2007-09', '2026-02'], pick: 'high' }
  ],
  '深证': [
    { key: 'low',  name: '国运支撑', color: '#38bdf8', anchors: ['2008-10', '2019-01'], pick: 'low' },
    { key: 'mix',  name: '低估定投', color: '#a78bfa', anchors: ['2008-09', '2014-03'], pick: 'low' },
    { key: 'high', name: '高风险',   color: '#ef4444', anchors: ['2008-03', '2021-02', '2026-06'], pick: 'high' }
  ],
  '创业板': [
    { key: 'low',  name: '国运支撑', color: '#38bdf8', anchors: ['2012-12', '2024-02', '2024-09'], pick: 'low' },
    { key: 'mix',  name: '低估定投', color: '#a78bfa', anchors: ['2012-01', '2018-10', '2024-01'], pick: 'low' },
    { key: 'high', name: '高风险',   color: '#ef4444', anchors: ['2015-05', '2021-07'], pick: 'high' }
  ],
  '科创50': [
    { key: 'low',  name: '国运支撑', color: '#38bdf8', anchors: ['2024-09', '2026-11'], pick: 'low' },
    { key: 'mix',  name: '低估定投', color: '#a78bfa', anchors: ['2022-04', '2023-08'], pick: 'low' },
  ]
};

(function () {
  'use strict';

  const chartEl = document.getElementById('monthChart');
  if (!chartEl) return;

  const DATA = window.INDEX_DATA || {};
  const names = Object.keys(DATA);
  if (!names.length) return;

  const switchEl   = document.getElementById('indexSwitch');
  const dropInfoEl = document.getElementById('dropInfo');
  const btnLow     = document.getElementById('btnLow');
  const btnMix     = document.getElementById('btnMix');
  const btnHigh    = document.getElementById('btnHigh');

  const trendVisible = { low: true, mix: true, high: true };
  let currentName = names[0];
  let currentRows = [];
  let currentTrendsCfg = [];
  let chart = null;

  /* ---------- 拟合趋势线（用 common.js 的 fitTrend，输出为 ECharts 所需的 [日期, 数值]） ---------- */
  function buildTrendLine(rows, cfg) {
    if (!cfg || !cfg.anchors || cfg.anchors.length < 2) return [];
    const col = cfg.pick === 'high' ? 2 : cfg.pick === 'close' ? 4 : 3;
    const monthToIdx = new Map();
    rows.forEach((r, i) => {
      const m = r[0].slice(0, 7);
      if (!monthToIdx.has(m)) monthToIdx.set(m, i);
    });

    const pts = [];
    for (const m of cfg.anchors) {
      const idx = monthToIdx.get(m);
      if (idx != null) pts.push({ x: idx, y: rows[idx][col] });
    }

    const predict = window.fitTrend(pts);
    if (!predict) return [];

    const out = [];
    // 为了在 ECharts 中线条不从 x=0 开始连，未到达锚点的日期填 null
    for (let i = 0; i < rows.length; i++) {
      if (i < pts[0].x) {
        out.push([rows[i][0], null]);
      } else {
        out.push([rows[i][0], +predict(i).toFixed(2)]);
      }
    }
    return out;
  }

  /* ---------- 更新提示框 ---------- */
  function updateDropInfo() {
    if (!trendVisible.mix || !currentRows.length) {
      dropInfoEl.classList.add('hide');
      return;
    }
    const mixCfg = currentTrendsCfg.find(c => c.key === 'mix');
    if (!mixCfg) { dropInfoEl.classList.add('hide'); return; }

    const mixData = buildTrendLine(currentRows, mixCfg);
    if (mixData.length === 0) { dropInfoEl.classList.add('hide'); return; }

    const latestMixValue = mixData[mixData.length - 1][1];
    if (latestMixValue === null) { dropInfoEl.classList.add('hide'); return; }

    const latestClose = currentRows[currentRows.length - 1][4];
    const pct = (latestMixValue - latestClose) / latestClose * 100;

    dropInfoEl.classList.remove('hide');
    const abs = Math.abs(pct).toFixed(2);
    if (pct < 0) {
      dropInfoEl.innerHTML = `距低估定投还需下跌 <b class="text-down">${abs}%</b>`;
    } else {
      dropInfoEl.innerHTML = `已跌破低估定投线 <b class="text-down">${abs}%</b>`;
    }
  }

  /* ---------- 按钮交互 ---------- */
  [['low', btnLow], ['mix', btnMix], ['high', btnHigh]].forEach(([key, btn]) => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      trendVisible[key] = !trendVisible[key];
      btn.classList.toggle('active', trendVisible[key]);
      renderChart();
      if (key === 'mix') updateDropInfo();
    });
  });

  function updateButtonsState() {
    [['low', btnLow], ['mix', btnMix], ['high', btnHigh]].forEach(([key, btn]) => {
      if (!btn) return;
      const hasThisLine = currentTrendsCfg.some(c => c.key === key);
      btn.disabled = !hasThisLine;
      btn.classList.toggle('active', hasThisLine && trendVisible[key]);
    });
  }

  /* ---------- 渲染 ECharts ---------- */
  function renderChart() {
    const item = DATA[currentName];
    if (!item) return;

    currentRows = item.data;
    currentTrendsCfg = INDEX_TRENDS[currentName] || [];

    const dates = currentRows.map(r => r[0]);
    // ECharts K线数据格式：[开盘, 收盘, 最低, 最高]
    const candleData = currentRows.map(r => [r[1], r[4], r[3], r[2]]);

    const t = window.getChartTheme();

    // 构造趋势线的 series（一次性判断 data 是否需要传入，避免重复声明）
    const trendSeries = [];
    currentTrendsCfg.forEach(cfg => {
      const trendData = buildTrendLine(currentRows, cfg);
      if (trendData.length > 0) {
        trendSeries.push({
          name: cfg.name,
          type: 'line',
          data: trendVisible[cfg.key] ? trendData : [],
          smooth: false,
          symbol: 'none',
          lineStyle: {
            color: cfg.color,
            width: 1.5,
            type: cfg.key === 'mix' ? 'dashed' : 'solid'
          }
        });
      }
    });

    // 默认缩放范围（显示最近 10 年，且左侧留出空余）
    const defaultStart = Math.max(0, 100 - (120 / dates.length) * 100);

    const option = {
      backgroundColor: 'transparent',
      animation: false,

      // 统一 tooltip（只传不同 formatter）
      tooltip: window.buildAxisTooltip(t, function (params) {
        let res = `<b>${params[0].axisValue}</b><br/>`;
        const p = params.find(p => p.seriesType === 'candlestick');
        if (p) {
          // ECharts 5 的 candlestick params.data 就是 [开, 收, 低, 高]，
          // 旧代码多切了一位，导致开盘=收盘、最低=最高、最高=undefined
          const raw = Array.isArray(p.data) ? p.data : [];
          const [open, close, low, high] = raw.length >= 4 ? raw.slice(-4) : raw;
          const color = close >= open ? t.lineRed : t.lineGreen;
          res += `开盘: ${open}<br/>收盘: <span style="color:${color}">${close}</span><br/>`;
          res += `最低: ${low}<br/>最高: ${high}`;
        }
        return res;
      }),

      grid: { left: 60, right: 30, top: 30, bottom: 60 }, // 这里控制左右留白，right:30 足以防遮挡
      xAxis: {
        type: 'category',
        data: dates,
        boundaryGap: true, // K线图必须为 true
        axisLine: { lineStyle: { color: t.axis } },
        axisLabel: {
          color: t.text,
          fontSize: 12,
          // 统一格式为 YY-MM，格式固定且宽度一致
          formatter: (val) => {
            if (!val || typeof val !== 'string') return '';
            const parts = val.split('-');
            if (parts.length < 2) return val;
            return `${parts[0].slice(2)}-${parts[1]}`;
          }
        },
        axisTick: { show: false }
      },
      yAxis: {
        type: 'value',
        // 关键：Y 轴最小值 = 当前可见最低数据 × 95%（即最多往下 5%）
        // 使用 Math.floor 取整，避免小数刻度导致渲染重叠（修复左下角重叠）
        min: function (value) {
          return isNaN(value.min) ? 0 : Math.floor(value.min * 0.95);
        },
        // 隐藏最底部的刻度标签，防止与 X 轴第一个标签重叠
        axisLabel: {
          color: t.text,
          showMinLabel: false
        },
        splitLine: { lineStyle: { color: t.grid } },
        axisLine: { show: true, lineStyle: { color: t.axis } }
      },
      dataZoom: [
        { type: 'inside', start: defaultStart, end: 100, minValueSpan: 12 },
        {
          type: 'slider',
          bottom: 16,
          height: 20,
          start: defaultStart,
          end: 100,
          borderColor: t.zoomBorder,
          backgroundColor: 'transparent',
          fillerColor: t.zoomFill,
          handleStyle: { color: t.zoomHandle },
          textStyle: { color: t.text }
        }
      ],
      series: [
        {
          name: 'K线',
          type: 'candlestick',
          data: candleData,
          itemStyle: {
            color: t.lineRed, // 阳线红
            color0: t.lineGreen, // 阴线绿
            borderColor: t.lineRed,
            borderColor0: t.lineGreen
          }
        },
        ...trendSeries
      ]
    };

    if (!chart) {
      chart = echarts.init(chartEl, null, { renderer: 'canvas' });
    }
    chart.setOption(option, true);

    updateButtonsState();
    updateDropInfo();
  }

  /* ---------- 指数切换按钮生成 ---------- */
  names.forEach(name => {
    const btn = document.createElement('button');
    btn.textContent = name;
    btn.dataset.name = name;
    if (name === currentName) btn.classList.add('active');
    btn.addEventListener('click', () => {
      if (name === currentName) return;
      currentName = name;
      switchEl.querySelectorAll('button').forEach(b => {
        b.classList.toggle('active', b.dataset.name === name);
      });
      renderChart();
    });
    switchEl.appendChild(btn);
  });

  /* ---------- 主题与尺寸自适应 ---------- */
  window.addEventListener('themeChanged', () => {
    requestAnimationFrame(() => renderChart());
  });

  window.addEventListener('resize', () => {
    if (chart) chart.resize();
  });

  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      if (chart) chart.resize();
    }).observe(chartEl);
  }

  // 初始渲染
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderChart, { once: true });
  } else {
    renderChart();
  }
})();


/* =========================================================
   第三部分：两融出清信号（原 two_melt.html 内联脚本并入）
   数据仍读独立的 two_melt_data.js（window.MARGIN_DATA）与
   ../market/market_data.js（window.MARKET_DATA），变量互不合并。
   ========================================================= */
(function () {
  'use strict';

  const fmt = (v, n = 2) => (v === null || v === undefined) ? '—' : v.toLocaleString('zh-CN', { minimumFractionDigits: n, maximumFractionDigits: n });

  let S = null, chart = null, years = 1;

  function rollingMin(arr, w) {
    const out = new Array(arr.length).fill(null);
    for (let i = 0; i < arr.length; i++) {
      let m = null;
      for (let k = Math.max(0, i - w + 1); k <= i; k++) {
        const v = arr[k];
        if (v !== null && v !== undefined && (m === null || v < m)) m = v;
      }
      out[i] = m;
    }
    return out;
  }

  function build() {
    const A = window.MARKET_DATA && window.MARKET_DATA.ashare;
    const M = window.MARGIN_DATA;
    if (!A || !M || !Array.isArray(M.rows)) return false;

    const asc = M.rows.slice().reverse()
      .filter(r => A[r[0]] && A[r[0]].price)
      .map(r => [r[0], r[1], A[r[0]].price]);

    const n = asc.length;
    if (n < 2) return false;
    const dates = asc.map(r => r[0]);
    const bal = asc.map(r => r[1]);
    const pr = asc.map(r => r[2]);
    const minB = rollingMin(bal, 250);
    const minP = rollingMin(pr, 250);

    const raw = [];
    for (let i = 260; i < n; i++) {
      if (bal[i] === null || pr[i] === null || minB[i] === null || minP[i] === null) continue;
      if (bal[i] <= minB[i] * 1.0001 && pr[i] > minP[i] * 1.02) raw.push(i);
    }
    const ev = [];
    for (const i of raw) { if (!ev.length || i - ev[ev.length - 1] >= 20) ev.push(i); }

    const meta = M.meta || {}, pm = window.MARKET_DATA.meta || {};

    // 关键修复：
    // 1) 日期不能用 market_data 的“生成时间” avg_price_updated_at，它常常是次日凌晨生成、但数据仍是前一交易日；
    // 2) 平均股价也不能只取“两融和行情都有”的交集日期，否则两融没更新时会把股价一起拖回旧日期。
    const mktDates = Object.keys(A).filter(d => A[d] && Number.isFinite(Number(A[d].price))).sort();
    const lastMktDate = mktDates.length ? mktDates[mktDates.length - 1] : '';
    const lastMktPrice = lastMktDate ? Number(A[lastMktDate].price) : NaN;
    const price250 = mktDates.slice(-250).map(d => Number(A[d].price));
    const minPrice250 = price250.length ? Math.min(...price250) : NaN;

    const marginLatest = M.rows[0] || [];
    const lastMarginDate = marginLatest[0] || meta.end || asc[n - 1][0];
    const lastMarginBal = Number.isFinite(Number(marginLatest[1])) ? Number(marginLatest[1]) : bal[n - 1];
    const margin250 = M.rows.slice(0, 250).map(r => Number(r[1])).filter(Number.isFinite);
    const minMargin250 = margin250.length ? Math.min(...margin250) : minB[n - 1];

    S = { asc, n, dates, bal, pr, minB, minP, ev, last: n - 1, meta, pm,
      dm: lastMarginDate,
      dp: lastMktDate || asc[n - 1][0],
      lastBal: lastMarginBal,
      lastPrice: lastMktPrice,
      minBal250: minMargin250,
      minPrice250: minPrice250 };
    return true;
  }

  function deviations() {
    const { asc, ev, minP } = S;
    return ev.map(i => ({ d: asc[i][0], off: asc[i][2] / minP[i] - 1 }));
  }

  function footText(full) {
    const arr = deviations();
    if (!arr.length) return '暂无历史触发记录';
    const wide = arr.filter(x => x.off > 0.15);
    const near = arr.filter(x => x.off <= 0.15);
    if (!wide.length) {
      const mx = Math.max(...arr.map(x => x.off)) * 100;
      return `贴低点触发，距低点都在 ${mx.toFixed(1)}% 以内`;
    }
    const m = wide.reduce((a, b) => a.off > b.off ? a : b);
    if (!full) return `${near.length} 次贴低点，${wide.length} 次离低点 15% 以上`;
    return `${m.d} 那次触发时股价已高出低点 ${(m.off * 100).toFixed(1)}%，属反弹中途而非底部，是偏离最大的一次。`;
  }

  function rgba(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function kpis() {
    const { ev, lastBal, lastPrice, minBal250, minPrice250 } = S;
    const bLow = Math.abs(lastBal - minBal250) < 0.011;
    const pLow = Math.abs(lastPrice - minPrice250) < 0.011;
    const gap = (lastPrice / minPrice250 - 1) * 100;
    const on = bLow && gap > 2;

    const T = window.getChartTheme();
    const pill = (txt, color) => txt
      ? `<span class="pill" style="background:${rgba(color, .12)};color:${color}">${txt}</span> `
      : '';

    const row = (k, date, val, u, d, tagColor, tag) => `<div class="card kpi">
      <div class="k"><span>${k}</span><span class="date">${date || ''}</span></div>
      <div class="v num">${val}<small>${u}</small></div>
      <div class="d">${pill(tag, tagColor)}${d}</div></div>`;

    document.getElementById('kpis').innerHTML = [
      row('两融余额', S.dm, fmt(lastBal, 0), '亿',
        bLow ? `就在 250 日最低 ${fmt(minBal250, 0)}` : `距 250 日最低 +${((lastBal / minBal250 - 1) * 100).toFixed(1)}%`,
        T.lineRed, bLow && !pLow ? '新低' : ''),
      row('平均股价', S.dp, fmt(lastPrice, 2), '元',
        pLow ? `也在 250 日最低 ${fmt(minPrice250, 2)}` : `已高出 250 日最低 ${gap.toFixed(1)}%`,
        pLow ? T.text : T.lineGreen, pLow ? '新低' : '未新低'),
      row('出清信号', S.dm, on ? '成立' : '未成立', '',
        bLow ? (pLow ? '两边同步新低，还没到分叉' : '股价已止跌，等两融再破一次低') : '两融未创新低',
        on ? T.lineGreen : '', on ? '可观察' : ''),
      row('历史触发', '2010-11 起', `${ev.length}`, '次', footText(false), '', '')
    ].join('');

    document.getElementById('tb-end').textContent = '至 ' + S.dm;

    const subEl = document.getElementById('sub');
    if (subEl) subEl.textContent = on
      ? '当前：两融在创 250 日新低，平均股价已不再新低 —— 信号成立'
      : '破净比例、指数通道与两融出清 —— 多信号交叉确认市场位置';
  }

  function events() {
    const { asc, ev, minP } = S;
    document.getElementById('tbody').innerHTML = ev.map(i => {
      const off = asc[i][2] / minP[i] - 1;
      return `<tr><td>${asc[i][0]}</td>
       <td class="r num">${fmt(asc[i][1], 0)}</td>
       <td class="r num">${fmt(asc[i][2], 2)}</td>
       <td class="r num ${off >= 0 ? 'text-up' : 'text-down'}">${off >= 0 ? '+' : ''}${(off * 100).toFixed(1)}%</td></tr>`;
    }).join('');
  }

  function visible() {
    if (!years) return S.asc;
    const start = new Date(S.asc[S.last][0]);
    start.setFullYear(start.getFullYear() - years);
    return S.asc.filter(r => new Date(r[0]) >= start);
  }

  function draw() {
    const T = window.getChartTheme();
    const { ev } = S;
    const rows = visible();
    const dates = rows.map(r => r[0]), b = rows.map(r => r[1]), p = rows.map(r => r[2]);
    const shown = new Set(dates);
    const pts = [];
    for (const i of ev) {
      if (shown.has(S.asc[i][0])) pts.push({ coord: [S.asc[i][0], S.asc[i][1]] });
    }

    const text = { color: T.text, fontFamily: '-apple-system,"PingFang SC","Microsoft YaHei",sans-serif', fontSize: 12 };

    chart.setOption({
      backgroundColor: 'transparent',
      animation: false,
      grid: { left: 8, right: 8, top: 44, bottom: 26, containLabel: true },
      legend: { data: ['两融余额（左轴·万亿）', '平均股价（右轴·元）'], top: 2, left: 0,
        itemWidth: 16, itemHeight: 8, itemGap: 18, textStyle: { ...text, color: T.text, fontSize: 12 } },
      tooltip: window.buildAxisTooltip(T, q => {
        const i = dates.indexOf(q[0].axisValue);
        return `<div style="font-weight:600;margin-bottom:4px">${q[0].axisValue}</div>
          两融 ${fmt(b[i], 0)} 亿<br>平均股价 ${fmt(p[i], 2)} 元`;
      }),
      xAxis: { type: 'category', data: dates, boundaryGap: false,
        axisLine: { lineStyle: { color: T.axis } }, axisTick: { show: false },
        axisLabel: { ...text, color: T.text, hideOverlap: true } },
      yAxis: [
        { type: 'value', position: 'left', scale: true,
          axisLine: { show: false }, axisTick: { show: false },
          splitLine: { lineStyle: { color: T.grid } },
          axisLabel: { ...text, color: T.text, formatter: v => (v / 10000).toFixed(1) + ' 万亿' } },
        { type: 'value', position: 'right', scale: true,
          axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
          axisLabel: { ...text, color: T.text } }
      ],
      series: [
        { name: '两融余额（左轴·万亿）', type: 'line', data: b, showSymbol: false, yAxisIndex: 0,
          lineStyle: { color: T.lineBlue, width: 1.4 },
          areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: T.zoomFill }, { offset: 1, color: 'transparent' }] } },
          markPoint: { silent: true, symbol: 'circle', symbolSize: 7, label: { show: false },
            itemStyle: { color: T.lineRed, opacity: .92 }, data: pts } },
        { name: '平均股价（右轴·元）', type: 'line', data: p, showSymbol: false, yAxisIndex: 1,
          lineStyle: { color: T.lineYellow, width: 1.4 } }
      ]
    }, true);
  }

  function render() {
    const ok = build();
    document.getElementById('app').style.display = ok ? '' : 'none';
    document.getElementById('empty').style.display = ok ? 'none' : '';
    if (!ok) return;
    kpis(); events();
    document.getElementById('foot-note').textContent = footText(true);
    if (window.echarts) {
      if (!chart) {
        chart = echarts.init(document.getElementById('chart'));
        window.addEventListener('resize', () => chart && chart.resize());
      }
      draw();
    }
  }

  const rangeEl = document.getElementById('range');
  if (rangeEl) {
    rangeEl.addEventListener('click', e => {
      const btn = e.target.closest('button'); if (!btn) return;
      years = Number(btn.dataset.y);
      [...e.currentTarget.children].forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      if (chart) draw();
    });
  }

  /* common.js 切换主题后会派发 themeChanged，图表与表格配色跟着换 */
  window.addEventListener('themeChanged', () => {
    if (!chart) return;
    draw();
    events();
    kpis();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render, { once: true });
  } else {
    render();
  }
})();