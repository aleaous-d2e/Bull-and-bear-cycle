/* ================= 合并宽基 + 行业数据 ================= */
window.__ETF_SHARE_DATA__ = {
  meta:   { ...(window.__ETF_SHARE_BROAD__?.meta   || {}),
            ...(window.__ETF_SHARE_SECTOR__?.meta  || {}) },
  series: { ...(window.__ETF_SHARE_BROAD__?.series || {}),
            ...(window.__ETF_SHARE_SECTOR__?.series || {}) },
};

/* ================= 分组定义 ================= */
window.__ETF_GROUPS__ = [
  { "name": "科创板50",         "codes": ["588080","588000"],           "category": "broad" },
  { "name": "沪深300/上证50",  "codes": ["510300", "510310"], "category": "broad" },
  { "name": "创业板/上证50",           "codes": ["159915", "159952","159949","510050"], "category": "broad" },
  { "name": "中证系列",          "codes": ["510500","512100","563300"],"category": "broad" },
  { "name": "🆕 待观察", "codes": [], "category": "sector" },
  { "name": "AI硬件", "codes": ["159516","515880"], "category": "sector" },
  { "name": "AI应用",       "codes": ["159852","159869","513330"], "category": "sector" },
  { "name": "机器人/AI/军工龙头",     "codes": ["562500","159819","512710"], "category": "sector" },
  { "name": "医疗/创新药",     "codes": ["159992","512170"], "category": "sector" },
  { "name": "电相关",       "codes": ["159611","159326","159755","159870"], "category": "sector" },
  { "name": "消费",   "codes": ["159865","159732","512690"], "category": "sector" },
  { "name": "有色金属/黄金",   "codes": ["512400","518880"], "category": "sector" },
  { "name": "券商/银行/红利低波",       "codes": ["512000","512800","512890"], "category": "sector" },
];

/* ================= 主逻辑 ================= */
(function () {
  "use strict";

  // ★ 优先使用 common.js 提供的公共工具，若未加载则使用本地兜底定义
  const fmt = window.formatNumber || ((n, d = 2) =>
    Number(n).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d })
  );
  const sortByDate = window.sortByDate || ((arr) =>
    arr.slice().sort((a, b) => a.date.localeCompare(b.date))
  );

  const DATA = window.__ETF_SHARE_DATA__;
  const gridEl = document.getElementById("charts-grid");

  if (!DATA || !DATA.series || !Object.keys(DATA.series).length) {
    gridEl.outerHTML = '<div class="empty">未找到数据文件，或数据为空。</div>';
    return;
  }

  const GROUPS = window.__ETF_GROUPS__ || [];
  if (!GROUPS.length) {
    gridEl.outerHTML = '<div class="empty">HTML 中未配置 __ETF_GROUPS__ 分组信息。</div>';
    return;
  }

  const SPLIT_EVENTS = {
    "510300": [{ date: "2021-02-24", ratio: "1:3", type: "split" }],
    "588000": [{ date: "2020-11-09", ratio: "1:0.6945", type: "merge" }],
    "588080": [{ date: "2020-11-09", ratio: "1:0.7006", type: "merge" }],
    "510310": [{ date: "2024-09-20", ratio: "1:0.4998", type: "merge" }],
    "510500": [{ date: "2022-08-26", ratio: "1:1.1454", type: "split" }],
    "512170": [{ date: "2021-02-24", ratio: "1:3", type: "split" }],
    "512710": [{ date: "2021-03-19", ratio: "1:2", type: "split" }],
    "512690": [{ date: "2021-05-14", ratio: "1:2", type: "split" }],
    "512890": [{ date: "2021-10-22", ratio: "1:2", type: "split" }],
    "512800": [{ date: "2025-07-04", ratio: "1:2", type: "split" }],
    "512000": [{ date: "2025-08-01", ratio: "1:2", type: "split" }],
    "159516": [{ date: "2026-07-09", ratio: "1:2", type: "split" }],
    "515880": [
      { date: "2026-02-03", ratio: "1:3", type: "split" },
      { date: "2026-07-03", ratio: "1:2", type: "split" },
    ],
  };

  const NAME_MAP = {};
  if (DATA.meta) {
    for (const code in DATA.meta) {
      if (DATA.meta[code] && DATA.meta[code].name) {
        NAME_MAP[code] = DATA.meta[code].name;
      }
    }
  }

  const PALETTE = [
    "#38bdf8", "#fbbf24", "#34d399", "#fb7185",
    "#c084fc", "#fb923c", "#a3e635", "#22d3ee",
    "#f472b6", "#2dd4bf", "#facc15", "#818cf8",
  ];

  const CODE_COLOR = (function () {
    const m = {};
    let i = 0;
    GROUPS.forEach((g) => {
      g.codes.forEach((c) => {
        if (m[c] === undefined) m[c] = PALETTE[i++ % PALETTE.length];
      });
    });
    return m;
  })();

  const CODE_CATEGORY = (function () {
    const m = {};
    GROUPS.forEach((g) => {
      const cat = g.category || "broad";
      (g.codes || []).forEach((c) => { m[c] = cat; });
    });
    return m;
  })();

  function buildColorMap(group) {
    const m = {};
    group.codes.forEach((c) => { m[c] = CODE_COLOR[c] || PALETTE[0]; });
    return m;
  }

  const shortName = (code) => (NAME_MAP[code] || code).replace("ETF", "");

  const groupHasData = (g) =>
    Array.isArray(g.codes) &&
    g.codes.length > 0 &&
    g.codes.some((c) => (DATA.series[c] || []).length > 0);

  function buildTabs(group) {
    if (group.codes.length > 1) {
      return [
        { label: "全部", codes: group.codes.slice() },
        ...group.codes.map(c => ({ label: shortName(c), codes: [c] }))
      ];
    }
    return null;
  }

  function toTimeStr(t) {
    if (!t) return null;
    if (typeof t === 'string') return t;
    if (typeof t === 'number') return new Date(t * 1000).toISOString().slice(0, 10);
    if (typeof t === 'object' && t.year !== undefined) {
      return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
    }
    return null;
  }

  const rangeBtns    = Array.from(document.querySelectorAll(".range-btn"));
  const modeBtns     = Array.from(document.querySelectorAll(".mode-btn"));
  const categoryBtns = Array.from(document.querySelectorAll(".category-btn"));

  let currentMode = "abs";
  let currentCategory = "broad";
  let chartInstances = [];
  let isSyncingTime = false;
  let isSyncingCrosshair = false;
  let currentRangeMonths = 6;

  // 排行榜排序状态：默认按近三月排序
  let currentSortKey = "changeQuarter";
  let currentSortOrder = "desc";      // 默认降序

  let allRealDates = [];
  GROUPS.forEach(g => g.codes.forEach(c => {
    if (DATA.series[c]) DATA.series[c].forEach(p => allRealDates.push(p.date));
  }));
  allRealDates = [...new Set(allRealDates)].sort();

  function renderAnnouncementBoard(category) {
    const board = document.getElementById("announcement-board");
    if (!board) return;

    const rows = [];
    Object.entries(SPLIT_EVENTS).forEach(([code, events]) => {
      if (CODE_CATEGORY[code] !== category) return;

      const pts = sortByDate(DATA.series[code] || []);
      const firstDate = pts.length ? pts[0].date : null;
      const lastDate = pts.length ? pts[pts.length - 1].date : null;

      events.forEach((ev) => {
        const outOfRange =
          !pts.length ||
          !firstDate ||
          ev.date < firstDate ||
          (lastDate && ev.date > lastDate);
        if (outOfRange) {
          rows.push({ ...ev, code, name: NAME_MAP[code] || code });
        }
      });
    });

    if (!rows.length) {
      board.style.display = "none";
      return;
    }

    rows.sort((a, b) => a.date.localeCompare(b.date));
    const typeLabel = (ev) => ev.type === "split" ? "拆分" : "合并";
    const catLabel = category === "sector" ? "行业" : "宽基";

    board.innerHTML = `
      <div class="ab-title">
        历史拆分 / 合并
        <span class="ab-sub">（${catLabel} · 早于现有数据，直接公示）</span>
      </div>
      <table>
        <thead>
          <tr><th>日期</th><th>代码</th><th>名称</th><th>类型</th><th>比例</th></tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td>${r.date}</td><td>${r.code}</td><td>${r.name}</td>
              <td><span class="ab-tag ${r.type}">${typeLabel(r)}</span></td><td>${r.ratio}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    `;
    board.style.display = "block";
  }

  // === 份额排行榜：新增近三月，计算方式改为绝对差值（亿份） ===
  function renderLeaderboard(category) {
    const board = document.getElementById("leaderboard-board");
    if (!board) return;

    const codesInCategory = new Set();
    GROUPS.forEach(g => {
      if ((g.category || "broad") === category) {
        g.codes.forEach(c => codesInCategory.add(c));
      }
    });

    const items = [];
    codesInCategory.forEach(code => {
      const pts = DATA.series[code] || [];
      if (pts.length > 0) {
        const lastPt = pts[pts.length - 1];

        // 封装获取过去 N 天最接近数据点的函数
        const getPastPt = (days) => {
          const lastDate = new Date(lastPt.date);
          const targetDate = new Date(lastDate);
          targetDate.setDate(targetDate.getDate() - days);
          let pastPt = pts[0];
          for (let i = pts.length - 1; i >= 0; i--) {
            if (new Date(pts[i].date) <= targetDate) {
              pastPt = pts[i];
              break;
            }
          }
          return pastPt;
        };

        // 近一周 (7天)
        const pastPtWeek = getPastPt(7);
        const changeWeek = pastPtWeek ? (lastPt.shares_yi - pastPtWeek.shares_yi) : 0;

        // 近一月 (30天)
        const pastPtMonth = getPastPt(30);
        const changeMonth = pastPtMonth ? (lastPt.shares_yi - pastPtMonth.shares_yi) : 0;

        // 近三月 (90天)
        const pastPtQuarter = getPastPt(90);
        const changeQuarter = pastPtQuarter ? (lastPt.shares_yi - pastPtQuarter.shares_yi) : 0;

        items.push({
          code: code,
          name: NAME_MAP[code] || code,
          value: lastPt.shares_yi,
          changeWeek: changeWeek,
          changeMonth: changeMonth,
          changeQuarter: changeQuarter
        });
      }
    });

    if (!items.length) {
      board.style.display = "none";
      return;
    }

    // 排序逻辑
    items.sort((a, b) => {
      let valA = a[currentSortKey];
      let valB = b[currentSortKey];
      if (currentSortOrder === "desc") {
        return valB - valA;
      } else {
        return valA - valB;
      }
    });

    // 直接取前五名
    const displayItems = items.slice(0, 5);

    // 排序表头图标辅助函数
    const getSortIcon = (key) => {
      if (currentSortKey !== key) return '<span class="sort-icon">↕</span>';
      return currentSortOrder === 'desc' ? '<span class="sort-icon">▼</span>' : '<span class="sort-icon">▲</span>';
    };
    const getSortClass = (key) => currentSortKey === key ? 'active-sort' : '';

    board.innerHTML = `
      <div class="ab-title">
        ${category === "broad" ? "宽基" : "行业"}份额变化排行
        <span class="ab-sub">（点击表头排序 · 前5名）</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>代码</th>
            <th>名称</th>
            <th class="sortable ${getSortClass('value')}" data-sort="value" style="text-align:right">份额(亿) ${getSortIcon('value')}</th>
            <th class="sortable ${getSortClass('changeQuarter')}" data-sort="changeQuarter" style="text-align:right">近三月 ${getSortIcon('changeQuarter')}</th>
            <th class="sortable ${getSortClass('changeMonth')}" data-sort="changeMonth" style="text-align:right">近一月 ${getSortIcon('changeMonth')}</th>
            <th class="sortable ${getSortClass('changeWeek')}" data-sort="changeWeek" style="text-align:right">近一周 ${getSortIcon('changeWeek')}</th>
          </tr>
        </thead>
        <tbody>
          ${displayItems.map((item, idx) => {
            // 统一处理差值格式化（保留两位小数，加正负号）
            const formatDiff = (val) => {
              const str = (val > 0 ? "+" : "") + fmt(val);
              const cls = val > 0 ? "text-up" : (val < 0 ? "text-down" : "text-flat");
              return `<td class="${cls}" style="text-align:right; font-variant-numeric: tabular-nums; font-weight: 600;">${str}</td>`;
            };

            return `
            <tr>
              <td>${idx + 1}</td>
              <td>${item.code}</td>
              <td>${item.name}</td>
              <td style="text-align:right; font-variant-numeric: tabular-nums;">${fmt(item.value)}</td>
              ${formatDiff(item.changeQuarter)}
              ${formatDiff(item.changeMonth)}
              ${formatDiff(item.changeWeek)}
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    `;
    board.style.display = "block";

    // 绑定表头点击排序事件
    board.querySelectorAll('th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (currentSortKey === key) {
          // 同一个列，切换升降序
          currentSortOrder = currentSortOrder === "desc" ? "asc" : "desc";
        } else {
          // 不同列，默认降序
          currentSortKey = key;
          currentSortOrder = "desc";
        }
        renderLeaderboard(currentCategory);
      });
    });
  }

  function initDOM() {
    gridEl.innerHTML = GROUPS.map((g, idx) => {
      const legendHtml = g.codes.map(c => `
        <span class="legend-item"><i style="background:${CODE_COLOR[c] || PALETTE[0]}"></i>${shortName(c)}</span>
      `).join("");

      const tabs = buildTabs(g);
      let tabsHtml = "";
      if (tabs && tabs.length > 1) {
        tabsHtml = `
          <div class="group-tabs" id="tabs-${idx}">
            ${tabs.map((t, ti) =>
              `<button class="tab-btn${ti === 0 ? " active" : ""}" data-tab="${ti}">${t.label}</button>`
            ).join("")}
          </div>
        `;
      }

      const category = g.category || "broad";
      const displayStyle = groupHasData(g) && category === "broad" ? "flex" : "none";

      return `
        <div class="chart-card" id="card-${idx}" data-category="${category}" style="display: ${displayStyle};">
          <div class="chart-header">
            <div>
              <div class="chart-title">${g.name}</div>
              <div class="chart-legend">${legendHtml}</div>
            </div>
            ${tabsHtml}
          </div>
          <div class="chart-body" id="chart-${idx}"></div>
        </div>
      `;
    }).join("");
  }

  function createChart(containerId, group, groupIdx) {
    const el = document.getElementById(containerId);
    const chart = LightweightCharts.createChart(el, {
      autoSize: true,
      layout: { background: { type: "solid", color: "transparent" }, textColor: "#8ba0bd", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: "rgba(139,160,189,0.04)" }, horzLines: { color: "rgba(139,160,189,0.04)" } },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: "rgba(139,160,189,0.3)", width: 1, style: 2, labelBackgroundColor: "#22314d" },
        horzLine: { color: "rgba(139,160,189,0.3)", width: 1, style: 2, labelBackgroundColor: "#22314d" },
      },
      rightPriceScale: { borderColor: "transparent", scaleMargins: { top: 0.2, bottom: 0.2 } },
      leftPriceScale: { visible: false },
      timeScale: { borderColor: "transparent", rightOffset: 2, barSpacing: 4 },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
    });

    const ctx = {
      chart, group, groupIdx,
      seriesList: [], seriesByCode: {}, timeIndex: {}, markerInfo: {},
      splitMarkers: {}, splitEventMap: {},
      colorMap: buildColorMap(group), tabs: buildTabs(group), visibleCodes: group.codes.slice()
    };

    if (ctx.tabs && ctx.tabs.length > 1) {
      const tabEls = document.querySelectorAll(`#tabs-${groupIdx} .tab-btn`);
      tabEls.forEach(tabEl => {
        tabEl.addEventListener("click", () => {
          tabEls.forEach(t => t.classList.remove("active"));
          tabEl.classList.add("active");
          const ti = parseInt(tabEl.dataset.tab, 10);
          ctx.visibleCodes = ctx.tabs[ti].codes.slice();
          updateGroupVisibility(ctx);
        });
      });
    }

    bindTooltip(ctx, el);
    bindCrosshairSync(ctx);
    bindTimeScaleSync(ctx);
    return ctx;
  }

  function updateGroupVisibility(ctx) {
    const multi = ctx.visibleCodes.length > 1;
    const isNorm = currentMode === "norm";

    ctx.group.codes.forEach((code) => {
      const s = ctx.seriesByCode[code];
      if (!s) return;

      s.applyOptions({ visible: ctx.visibleCodes.includes(code) });
      const info = ctx.markerInfo[code];
      if (!info) return;

      const peakText = isNorm ? "峰值" : (multi ? "峰" : `峰 ${fmt(info.maxVal)}`);
      const lowText  = isNorm ? "低点" : (multi ? "低" : `低 ${fmt(info.lowVal)}`);

      const markers = [
        { time: info.lowDate, position: "belowBar", color: info.color, shape: "arrowUp", text: lowText },
        { time: info.maxDate, position: "aboveBar", color: info.color, shape: "arrowDown", text: peakText },
        ...(ctx.splitMarkers[code] || []),
      ];

      s.setMarkers(markers);
    });
  }

  function bindTimeScaleSync(ctx) {
    ctx.chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
      if (!range || isSyncingTime) return;
      const fromStr = toTimeStr(range.from);
      const toStr = toTimeStr(range.to);
      if (!fromStr || !toStr) return;

      isSyncingTime = true;
      chartInstances.forEach(otherCtx => {
        if (otherCtx.chart !== ctx.chart) {
          try { otherCtx.chart.timeScale().setVisibleRange({ from: fromStr, to: toStr }); } catch (e) {}
        }
      });

      const visibleDays = (new Date(toStr).getTime() - new Date(fromStr).getTime()) / (1000 * 60 * 60 * 24);
      rangeBtns.forEach(b => {
        let isActive = false;
        if (b.dataset.months === "0" && visibleDays > 700) isActive = true;
        if (b.dataset.months === "12" && visibleDays > 300 && visibleDays < 400) isActive = true;
        if (b.dataset.months === "6" && visibleDays > 150 && visibleDays < 200) isActive = true;
        if (b.dataset.months === "3" && visibleDays > 70 && visibleDays < 110) isActive = true;
        if (b.dataset.months === "1" && visibleDays < 45) isActive = true;
        b.classList.toggle("active", isActive);
      });

      setTimeout(() => { isSyncingTime = false; }, 50);
    });
  }

  function bindCrosshairSync(ctx) {
    ctx.chart.subscribeCrosshairMove((param) => {
      if (isSyncingCrosshair) return;
      isSyncingCrosshair = true;

      chartInstances.forEach(otherCtx => {
        if (otherCtx.chart !== ctx.chart) {
          const otherCard = document.getElementById(`card-${otherCtx.groupIdx}`);
          if (otherCard && otherCard.style.display === "none") return;

          if (!param.time) {
            otherCtx.chart.clearCrosshairPosition();
          } else {
            const currentTimeStr = toTimeStr(param.time);
            const firstVisibleCode = otherCtx.visibleCodes[0] || otherCtx.group.codes[0];
            const idx = otherCtx.timeIndex[firstVisibleCode];

            if (idx && currentTimeStr) {
              const v = idx.get(currentTimeStr);
              if (v !== undefined) {
                const series = otherCtx.seriesByCode[firstVisibleCode];
                if (series) otherCtx.chart.setCrosshairPosition(v, param.time, series);
              }
            }
          }
        }
      });
      setTimeout(() => { isSyncingCrosshair = false; }, 20);
    });
  }

  // === 悬浮窗 ===
  const tooltipEl = document.getElementById("tooltip");
  function bindTooltip(ctx, chartEl) {
    ctx.chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point) { tooltipEl.style.display = "none"; return; }

      const dateStr = toTimeStr(param.time);
      let html = `<div class="lw-tooltip-date">${dateStr}</div>`;
      let hasData = false;

      ctx.group.codes.forEach((code) => {
        if (!ctx.visibleCodes.includes(code)) return;
        const series = ctx.seriesByCode[code];
        if (!series) return;
        const d = param.seriesData.get(series);
        if (!d) return;

        hasData = true;
        const nm = NAME_MAP[code] || code;
        let labelHtml = nm === code
          ? `<span class="lw-label">${code}</span>`
          : `<span class="lw-label">${nm}<span class="lw-code">${code}</span></span>`;

        const ev = (ctx.splitEventMap[dateStr] || []).find(e => e.code === code);
        if (ev) {
          const isSplit = ev.type === "split";
          const color = isSplit ? "#fbbf24" : "#38bdf8";
          const txt = isSplit ? "拆" : "合";
          labelHtml += ` <span style="color:${color}; font-size:11px; font-weight:700; margin-left:4px;">${txt}(${ev.ratio})</span>`;
        }

        html += `
          <div class="lw-tooltip-row">
            <span class="lw-dot" style="background:${ctx.colorMap[code]}"></span>
            ${labelHtml}
            <b>${fmt(d.value)}${currentMode === "norm" ? "" : " 亿份"}</b>
          </div>`;
      });

      if (!hasData) { tooltipEl.style.display = "none"; return; }

      tooltipEl.innerHTML = html;
      tooltipEl.style.display = "block";

      const rect = chartEl.getBoundingClientRect();
      const left = Math.min(rect.left + param.point.x + 15, window.innerWidth - tooltipEl.offsetWidth - 10);
      tooltipEl.style.left = left + "px";
      tooltipEl.style.top = rect.top + param.point.y + 15 + "px";
    });

    chartEl.addEventListener("mouseleave", () => tooltipEl.style.display = "none");
  }

  function applyMode(mode) {
    currentMode = mode;
    const isNorm = mode === "norm";

    chartInstances.forEach((ctx) => {
      ctx.seriesList.forEach(s => ctx.chart.removeSeries(s));
      ctx.seriesList = [];
      ctx.seriesByCode = {};
      ctx.timeIndex = {};
      ctx.markerInfo = {};
      ctx.splitMarkers = {};
      ctx.splitEventMap = {};

      const card = document.getElementById(`card-${ctx.groupIdx}`);
      if (card && card.style.display === "none") return;

      ctx.group.codes.forEach((code) => {
        const pts = sortByDate(DATA.series[code] || []);
        if (!pts.length) return;

        const base = pts[0].shares_yi || 1;
        const chartData = pts.map((p) => ({
          time: p.date,
          value: isNorm ? +((p.shares_yi / base) * 100).toFixed(2) : p.shares_yi,
        }));

        const idx = new Map();
        chartData.forEach(d => idx.set(d.time, d.value));
        ctx.timeIndex[code] = idx;

        const color = ctx.colorMap[code];
        const series = ctx.chart.addLineSeries({
          color: color,
          lineWidth: 1.8,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 4,
          crosshairMarkerBorderColor: color,
          crosshairMarkerBackgroundColor: color,
        });

        series.setData(chartData);

        let maxPt = pts[0];
        let lowPt = pts[0];

        pts.forEach(p => {
          if (p.shares_yi > maxPt.shares_yi) maxPt = p;
          if (p.shares_yi < lowPt.shares_yi) lowPt = p;
        });

        ctx.markerInfo[code] = {
          color: color,
          lowDate: lowPt.date,
          lowVal: lowPt.shares_yi,
          maxDate: maxPt.date,
          maxVal: maxPt.shares_yi,
        };

        const events = SPLIT_EVENTS[code] || [];
        ctx.splitMarkers[code] = events
          .map((ev) => {
            let alignedDate = null;
            for (const p of pts) {
              if (p.date <= ev.date) alignedDate = p.date;
              else break;
            }
            if (!alignedDate) return null;

            if (!ctx.splitEventMap[alignedDate]) ctx.splitEventMap[alignedDate] = [];
            ctx.splitEventMap[alignedDate].push({
              code,
              name: NAME_MAP[code] || code,
              date: ev.date,
              ratio: ev.ratio,
              type: ev.type,
            });

            return {
              time: alignedDate,
              position: ev.type === "split" ? "aboveBar" : "belowBar",
              color: ev.type === "split" ? "#fbbf24" : "#38bdf8",
              shape: ev.type === "split" ? "arrowDown" : "arrowUp",
              text: ev.type === "split" ? "拆" : "合",
            };
          })
          .filter(Boolean);

        ctx.seriesList.push(series);
        ctx.seriesByCode[code] = series;
      });

      if (isNorm && ctx.seriesList.length > 0) {
        ctx.seriesList[0].createPriceLine({
          price: 100,
          color: "rgba(255,255,255,0.15)",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: false,
        });
      }

      updateGroupVisibility(ctx);
    });

    modeBtns.forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    applyRange(currentRangeMonths);
  }

  function applyRange(months) {
    currentRangeMonths = months;

    rangeBtns.forEach((b) => {
      b.classList.toggle("active", b.dataset.months === String(months));
    });

    if (!allRealDates.length) return;

    const lastDateStr = allRealDates[allRealDates.length - 1];
    let fromStr = allRealDates[0];

    if (months > 0) {
      const lastDate = new Date(lastDateStr);
      const targetDate = new Date(lastDate);
      targetDate.setMonth(targetDate.getMonth() - months);
      const targetTime = targetDate.getTime();

      for (let i = 0; i < allRealDates.length; i++) {
        if (new Date(allRealDates[i]).getTime() >= targetTime) {
          fromStr = allRealDates[i];
          break;
        }
      }
    }

    isSyncingTime = true;
    chartInstances.forEach(ctx => {
      const card = document.getElementById(`card-${ctx.groupIdx}`);
      if (card && card.style.display !== "none") {
        try { ctx.chart.timeScale().setVisibleRange({ from: fromStr, to: lastDateStr }); } catch (e) {}
      }
    });
    setTimeout(() => { isSyncingTime = false; }, 100);
  }

  rangeBtns.forEach((btn) => {
    btn.addEventListener("click", () => { applyRange(parseInt(btn.dataset.months, 10)); });
  });

  modeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("active")) return;
      applyMode(btn.dataset.mode);
    });
  });

  categoryBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("active")) return;
      categoryBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const category = btn.dataset.category;
      currentCategory = category;

      renderAnnouncementBoard(category);
      renderLeaderboard(category);

      document.querySelectorAll(".chart-card").forEach(card => {
        const idx = parseInt(card.id.replace("card-", ""), 10);
        const g = GROUPS[idx];

        if (!groupHasData(g)) {
          card.style.display = "none";
          return;
        }

        if (card.dataset.category === category) {
          card.style.display = "flex";
          const isInit = chartInstances.some(ctx => ctx.groupIdx === idx);
          if (!isInit) {
            const ctx = createChart(`chart-${idx}`, g, idx);
            chartInstances.push(ctx);
          }
        } else {
          card.style.display = "none";
        }
      });

      setTimeout(() => { applyMode(currentMode); }, 50);
    });
  });

  initDOM();
  renderAnnouncementBoard("broad");
  renderLeaderboard("broad");

  GROUPS.forEach((g, idx) => {
    const category = g.category || "broad";
    if (category === "broad" && groupHasData(g)) {
      const ctx = createChart(`chart-${idx}`, g, idx);
      chartInstances.push(ctx);
    }
  });

  applyMode("abs");

})();