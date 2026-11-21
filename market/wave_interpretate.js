/* ============================================================
   wave_interpretate.js —— “平均股价（月线）· 全量数据与 ABC 推演”页面的脚本
   原先是 wave_interpretate.html 里的内联 <script>，现抽出为独立文件，
   便于与 avg_price.js / top_base.js 一样按页面单独维护、单独改动。

   依赖（按 HTML 中的加载顺序）：market_data.js → ../common/common.js → 本文件
   公共能力（getChartTheme / aggregateOHLC / sortByDate / buildAxisTooltip /
   buildDataZoom / ymToIndex / indexToYM / debounce）全部来自 common.js，
   本文件只保留这个页面独有的双轨参数、推演价格路径与渲染逻辑。
   ============================================================ */

(function () {
  'use strict';

  /* ---------- 双轨参数：单一数据源 ---------- */
  var TRACK_UP  = { startYM: '2005-06', startPrice: 5.137, slope: 0.0465 };
  var TRACK_LOW = { startYM: '2005-07', startPrice: 4.229, slope: 0.0435 };

  /* 提取截图里的经典红绿配色 */
  var CUSTOM_RED = '#f5222d';   // 鲜艳的红（阳线 / 下轨）
  var CUSTOM_GREEN = '#00b050'; // 经典的绿（阴线）

  var chartDom = document.getElementById('chart-price');
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
    var theme = window.getChartTheme();
    var isMobile = window.innerWidth <= 768;

    var rawData = getRawData();
    mockNotice.style.display = USED_MOCK ? 'block' : 'none';

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
