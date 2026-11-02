/* =========================================================
   top_base.js —— 市场顶底部研究（本页图表逻辑）
   包含两个独立图表：
     1. 破净比例与大盘指数（ECharts）
     2. 指数月线（ECharts 重构版）
   依赖：
     - top_base_data.js       → window.RAW_DATA / window.INDEX_DATA
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

      legend: {
        top: 8,
        right: 24,
        textStyle: { color: t.text },
        data: ['破净比例', '大盘指数']
      },

      grid: { left: 64, right: 72, top: 80, bottom: 92 },

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
    { key: 'low',  name: '国运支撑', color: '#38bdf8', anchors: ['2024-09', '2026-10'], pick: 'low' }
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
    if (pct < 0) {
      dropInfoEl.innerHTML = `距低估定投还需下跌 <b class="text-down">${pct.toFixed(2)}%</b>`;
    } else {
      dropInfoEl.innerHTML = `已跌破低估定投 <b class="text-down">+${pct.toFixed(2)}%</b>`;
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
          const [open, close, low, high] = p.data.slice(1); // data[0] 是 index，后续是 OHLC
          const color = close >= open ? '#ef4444' : '#22c55e';
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
          return isNaN(value.min) ? 0 : Math.floor(value.min * 0.70);
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
          borderColor: 'transparent',
          backgroundColor: 'transparent',
          fillerColor: 'rgba(56, 189, 248, 0.15)',
          handleStyle: { color: '#38bdf8' },
          textStyle: { color: t.text }
        }
      ],
      series: [
        {
          name: 'K线',
          type: 'candlestick',
          data: candleData,
          itemStyle: {
            color: '#ef4444', // 阳线红
            color0: '#22c55e', // 阴线绿
            borderColor: '#ef4444',
            borderColor0: '#22c55e'
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