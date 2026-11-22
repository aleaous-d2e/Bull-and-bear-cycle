/* ================= 合并宽基 + 行业数据 ================= */
window.__ETF_SHARE_DATA__ = {
  meta:   { ...(window.__ETF_SHARE_BROAD__?.meta  || {}) },
  series: { ...(window.__ETF_SHARE_BROAD__?.series || {}) },
};

/* ================= 分组定义 ================= */
window.__ETF_GROUPS__ = [
  { "name": "科创板50",         "codes": ["588080","588000"],           "category": "broad" },
  { "name": "沪深300",  "codes": ["510300", "510310","159919","510330"], "category": "broad" },
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

  // ★ common.js 已在 HTML 中先于本脚本加载，直接解构公共工具
  //   （formatNumber 别名 fmt；toTimeStr / diffOverDays / sortByDate 均为 window 上已有）
  const { formatNumber: fmt, sortByDate, toTimeStr, diffOverDays } = window;

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

  /* Lightweight Charts 不会读取 CSS 变量，明暗切换时手动同步配色 */
  function chartTheme() {
    const isLight = document.body.classList.contains("theme-light");
    return {
      text: isLight ? "#4b5563" : "#8ba0bd",
      grid: isLight ? "rgba(107,114,128,0.08)" : "rgba(139,160,189,0.06)",
      cross: isLight ? "rgba(107,114,128,0.35)" : "rgba(139,160,189,0.3)",
      labelBg: isLight ? "#6b7280" : "#22314d",
    };
  }

  const shortName = (code) => (NAME_MAP[code] || code).replace("ETF", "");

  // 只保留真实有数据的代码，避免切到空 Tab 后图表一片空白
  const codesWithData = (g) => (g.codes || []).filter((c) => (DATA.series[c] || []).length > 0);

  const groupHasData = (g) =>
    Array.isArray(g.codes) &&
    g.codes.length > 0 &&
    g.codes.some((c) => (DATA.series[c] || []).length > 0);

  function buildTabs(group) {
    const codes = codesWithData(group);
    if (codes.length > 1) {
      return [
        { label: "全部", codes: codes.slice() },
        ...codes.map(c => ({ label: shortName(c), codes: [c] }))
      ];
    }
    return null;
  }

  // === 表格单元格模板（消除排行榜 6 处重复的内联 style） ===
  const TD_R = 'text-align:right; font-variant-numeric: tabular-nums';
  const numCell = (v) => `<td style="${TD_R};">${fmt(v)}</td>`;
  const diffCell = (v) => {
    const str = (v > 0 ? "+" : "") + fmt(v);
    const cls = v > 0 ? "text-up" : (v < 0 ? "text-down" : "text-flat");
    return `<td class="${cls}" style="${TD_R}; font-weight: 600;">${str}</td>`;
  };

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
  function rebuildAllDates() {
    const dates = [];
    GROUPS.forEach(g => g.codes.forEach(c => {
      if (DATA.series[c]) DATA.series[c].forEach(p => dates.push(p.date));
    }));
    allRealDates = [...new Set(dates)].sort();
  }
  rebuildAllDates();

  /* ---------- 行业数据按需加载 ----------
     首屏只加载宽基数据（约 1.3MB）；点「行业」时再拉 sector 文件，
     避免每次打开都先解析 1.1MB 暂时用不到的数据。 */
  let sectorState = "idle";   // idle / loading / loaded / error
  let sectorPromise = null;

  function mergeSectorData() {
    const ext = window.__ETF_SHARE_SECTOR__;
    if (!ext || !ext.series) throw new Error("行业数据为空");

    Object.assign(DATA.meta || (DATA.meta = {}), ext.meta || {});
    Object.assign(DATA.series || (DATA.series = {}), ext.series || {});

    if (DATA.meta) {
      for (const code in DATA.meta) {
        if (DATA.meta[code] && DATA.meta[code].name) NAME_MAP[code] = DATA.meta[code].name;
      }
    }
    rebuildAllDates();
  }

  function refreshCardMeta(g, idx) {
    const card = document.getElementById(`card-${idx}`);
    if (!card) return;

    const legend = card.querySelector(".chart-legend");
    if (legend) {
      legend.innerHTML = codesWithData(g).map(c => `
        <span class="legend-item"><i style="background:${CODE_COLOR[c] || PALETTE[0]}"></i>${shortName(c)}</span>
      `).join("");
    }

    const header = card.querySelector(".chart-header");
    const tabs = buildTabs(g);
    const oldTabs = card.querySelector(`#tabs-${idx}`);
    if (tabs && tabs.length > 1) {
      const html = `
        <div class="group-tabs" id="tabs-${idx}">
          ${tabs.map((tab, ti) =>
            `<button class="tab-btn${ti === 0 ? " active" : ""}" data-tab="${ti}">${tab.label}</button>`
          ).join("")}
        </div>`;
      if (oldTabs) oldTabs.outerHTML = html;
      else if (header) header.insertAdjacentHTML("beforeend", html);
    } else if (oldTabs) {
      oldTabs.remove();
    }
  }

  function loadSectorData() {
    if (sectorState === "loaded") return Promise.resolve();
    if (sectorState === "loading") return sectorPromise;

    sectorState = "loading";
    sectorPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "etf_share_data_sector.js";
      s.async = true;
      s.onload = () => {
        try {
          mergeSectorData();
          GROUPS.forEach((g, idx) => {
            if ((g.category || "broad") === "sector") refreshCardMeta(g, idx);
          });
          sectorState = "loaded";
          resolve();
        } catch (err) {
          sectorState = "error";
          reject(err);
        }
      };
      s.onerror = () => {
        sectorState = "error";
        reject(new Error("行业数据文件加载失败"));
      };
      document.head.appendChild(s);
    });
    return sectorPromise;
  }

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

  // === 份额排行榜：周/月/季变化统一由 common.js 的 diffOverDays 计算 ===
  //    diffOverDays 内部已处理"数据跨度不足时回退到首条"的逻辑
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
      const pts = sortByDate(DATA.series[code] || []);
      if (!pts.length) return;

      items.push({
        code: code,
        name: NAME_MAP[code] || code,
        value: pts[pts.length - 1].shares_yi,
        changeWeek:    diffOverDays(pts, 7),
        changeMonth:   diffOverDays(pts, 30),
        changeQuarter: diffOverDays(pts, 90),
      });
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
          ${displayItems.map((item, idx) => `
            <tr>
              <td>${idx + 1}</td>
              <td>${item.code}</td>
              <td>${item.name}</td>
              ${numCell(item.value)}
              ${diffCell(item.changeQuarter)}
              ${diffCell(item.changeMonth)}
              ${diffCell(item.changeWeek)}
            </tr>`).join("")}
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
      const legendHtml = codesWithData(g).map(c => `
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
    const th = chartTheme();
    const chart = LightweightCharts.createChart(el, {
      autoSize: true,
      layout: { background: { type: "solid", color: "transparent" }, textColor: th.text, fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: th.grid }, horzLines: { color: th.grid } },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: th.cross, width: 1, style: 2, labelBackgroundColor: th.labelBg },
        horzLine: { color: th.cross, width: 1, style: 2, labelBackgroundColor: th.labelBg },
      },
      rightPriceScale: { borderColor: "transparent", scaleMargins: { top: 0.12, bottom: 0.06 } },
      leftPriceScale: { visible: false },
      timeScale: {
        borderColor: "transparent",
        rightOffset: 2,
        barSpacing: 4,
        tickMarkFormatter: (time) => {
          // LWC v4 在日线数据下可能传 'YYYY-MM-DD' 字符串，而非 BusinessDay 对象
          let month;
          if (typeof time === "string") {
            month = Number(time.slice(5, 7));
          } else if (typeof time === "object" && time !== null) {
            month = time.month;
          } else {
            month = new Date(time * 1000).getMonth() + 1;
          }
          return Number.isFinite(month) ? `${month}月` : "";
        },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
    });

    const ctx = {
      chart, group, groupIdx,
      seriesList: [], seriesByCode: {}, timeIndex: {}, markerInfo: {},
      splitMarkers: {}, splitEventMap: {},
      colorMap: buildColorMap(group), tabs: buildTabs(group),
      visibleCodes: codesWithData(group)
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
        const isLight = document.body.classList.contains("theme-light");
        ctx.seriesList[0].createPriceLine({
          price: 100,
          color: isLight ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.15)",
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

    // 用“当前可见图表”的并集算区间，避免行业/宽基互相拖着对方的时间轴
    const visibleDates = [];
    chartInstances.forEach((ctx) => {
      const card = document.getElementById(`card-${ctx.groupIdx}`);
      if (card && card.style.display === "none") return;
      ctx.group.codes.forEach((code) => {
        (DATA.series[code] || []).forEach((p) => visibleDates.push(p.date));
      });
    });
    const dates = [...new Set(visibleDates)].sort();
    if (!dates.length) return;

    const lastDateStr = dates[dates.length - 1];
    let fromStr = dates[0];

    if (months > 0) {
      const lastDate = new Date(lastDateStr + "T00:00:00");
      const targetDate = new Date(lastDate);
      targetDate.setMonth(targetDate.getMonth() - months);
      const targetTime = targetDate.getTime();

      for (let i = 0; i < dates.length; i++) {
        if (new Date(dates[i] + "T00:00:00").getTime() >= targetTime) {
          fromStr = dates[i];
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

  function applyChartTheme() {
    const th = chartTheme();
    chartInstances.forEach((ctx) => {
      ctx.chart.applyOptions({
        layout: { textColor: th.text },
        grid: { vertLines: { color: th.grid }, horzLines: { color: th.grid } },
        crosshair: {
          vertLine: { color: th.cross, labelBackgroundColor: th.labelBg },
          horzLine: { color: th.cross, labelBackgroundColor: th.labelBg },
        },
      });
    });
  }
  window.addEventListener("themeChanged", () => requestAnimationFrame(applyChartTheme));

  modeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("active")) return;
      applyMode(btn.dataset.mode);
    });
  });

  function showCategory(category) {
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
  }

  function showSectorLoading() {
    let tip = document.getElementById("etf-data-loading");
    if (!tip) {
      tip = document.createElement("div");
      tip.id = "etf-data-loading";
      tip.className = "empty";
      tip.textContent = "行业数据加载中…";
      gridEl.parentNode.insertBefore(tip, gridEl);
    }
    tip.style.display = "block";
  }

  function hideSectorLoading() {
    const tip = document.getElementById("etf-data-loading");
    if (tip) tip.remove();
  }

  categoryBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("active")) return;
      categoryBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const category = btn.dataset.category;

      if (category === "sector" && sectorState !== "loaded") {
        showSectorLoading();
        loadSectorData().then(() => {
          hideSectorLoading();
          if (currentCategory === "sector" || btn.classList.contains("active")) {
            showCategory("sector");
          }
        }).catch((err) => {
          hideSectorLoading();
          const tip = document.createElement("div");
          tip.className = "empty";
          tip.textContent = "行业数据加载失败：" + err.message;
          gridEl.parentNode.insertBefore(tip, gridEl);
        });
        return;
      }

      showCategory(category);
    });
  });

  initDOM();
  showCategory("broad");


})();