/* =========================================================
   common.js —— 全局公共交互脚本
   包含：主题控制(自动/手动) / 侧边栏交互 / 导航高亮
   ========================================================= */

(function () {
  'use strict';

  /* ================= 1. 主题控制逻辑 ================= */

  // 更新主题切换按钮的文案和图标
  const updateThemeBtn = (theme) => {
    const btn = document.getElementById('themeToggle');
    if (btn) {
      // 只保留图标，避免文字将按钮撑破
      btn.innerHTML = theme === 'light' ? '🌙' : '☀️';
      btn.title = theme === 'light' ? '切换深色' : '切换浅色';
    }
  };

  // 应用主题
  const applyTheme = (theme) => {
    document.body.classList.remove('theme-light', 'theme-dark');
    document.body.classList.add(`theme-${theme}`);
    updateThemeBtn(theme);
    window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme } }));
  };

  // 初始化主题
  const initTheme = () => {
    const savedTheme = localStorage.getItem('site-theme');
    const hour = new Date().getHours();

    let theme;
    if (savedTheme === 'light' || savedTheme === 'dark') {
      theme = savedTheme;
    } else {
      theme = (hour >= 9 && hour < 19) ? 'light' : 'dark';
    }

    applyTheme(theme);
  };

  // 手动切换主题
  const toggleTheme = () => {
    const isLight = document.body.classList.contains('theme-light');
    const newTheme = isLight ? 'dark' : 'light';
    localStorage.setItem('site-theme', newTheme);
    applyTheme(newTheme);
  };


  /* ================= 2. 侧边栏逻辑 ================= */

  const initSidebar = () => {
    const appLayout = document.querySelector('.app-layout');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const overlay = document.getElementById('sidebarOverlay');

    // 如果页面没有侧边栏，直接退出
    if (!appLayout || !sidebarToggle) return;

    // 动态创建一个固定在页面左上角的“展开按钮”
    const expandBtn = document.createElement('button');
    expandBtn.id = 'sidebarExpandBtn';
    expandBtn.className = 'sidebar-expand-btn';
    expandBtn.innerHTML = '☰';
    expandBtn.title = '展开侧边栏';
    document.body.appendChild(expandBtn);

    const isMobile = () => window.innerWidth <= 768;

    // 点击原侧边栏内的折叠按钮
    sidebarToggle.addEventListener('click', () => {
      if (isMobile()) {
        appLayout.classList.toggle('sidebar-open');
      } else {
        appLayout.classList.add('collapsed');
        expandBtn.style.display = 'flex'; // 显示左上角的悬浮展开按钮
      }
    });

    // 点击悬浮的展开按钮
    expandBtn.addEventListener('click', () => {
      appLayout.classList.remove('collapsed');
      expandBtn.style.display = 'none'; // 隐藏悬浮按钮
    });

    // 点击遮罩层关闭 H5 端抽屉
    if (overlay) {
      overlay.addEventListener('click', () => {
        appLayout.classList.remove('sidebar-open');
      });
    }

    // 监听窗口大小变化
    window.addEventListener('resize', () => {
      if (!isMobile()) {
        appLayout.classList.remove('sidebar-open');
        // 如果是 PC 端且处于折叠状态，保持悬浮按钮显示
        if (appLayout.classList.contains('collapsed')) {
          expandBtn.style.display = 'flex';
        }
      } else {
        expandBtn.style.display = 'none';
      }
    });
  };


  /* ================= 3. 导航菜单高亮 ================= */

  const highlightMenu = () => {
    const path = window.location.pathname.split('/').pop() || 'avg_price.html';
    const menuItems = document.querySelectorAll('.menu-item');

    menuItems.forEach(link => {
      const href = link.getAttribute('href');
      if (href === path) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  };


  /* ================= 4. 页面初始化 ================= */

  if (document.body) {
    initTheme();
  } else {
    document.addEventListener('DOMContentLoaded', initTheme);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const themeBtn = document.getElementById('themeToggle');
    if (themeBtn) {
      themeBtn.addEventListener('click', toggleTheme);
    }
    initSidebar();
    highlightMenu();
  });

})();

/* =========================================================
   5. 跨页面通用工具（window 挂载）
   ========================================================= */

window.$  = window.$  || (id => document.getElementById(id));
window.$$ = window.$$ || (sel => document.querySelectorAll(sel));

window.formatNumber = (n, d = 2) =>
  Number(n).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
window.fmt = window.formatNumber;

window.sortByDate = (arr) =>
  arr.slice().sort((a, b) => a.date.localeCompare(b.date));

window.debounce = (fn, wait = 250) => {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
};

window.getChartTheme = () => {
  const isLight = document.body.classList.contains('theme-light');
  return {
    isLight,
    text: isLight ? '#6b7280' : '#8ba0bd',
    grid: isLight ? '#f3f4f6' : 'rgba(139,160,189,0.08)',
    axis: isLight ? '#e5e7eb' : 'rgba(139,160,189,0.2)',
    tooltipBg: isLight ? '#ffffff' : 'rgba(17, 28, 48, 0.96)',
    tooltipBorder: isLight ? '#e5e7eb' : '#22314d',
    tooltipText: isLight ? '#1f2937' : '#e6edf7',
    crossLine: isLight ? '#d1d5db' : 'rgba(139,160,189,0.4)',
    crossLabelBg: isLight ? '#9ca3af' : '#22314d',
    crossLabelText: '#ffffff',
    zoomBorder: isLight ? '#e5e7eb' : '#22314d',
    zoomFill: isLight ? 'rgba(37,99,235,.08)' : 'rgba(56,189,248,.15)',
    zoomText: isLight ? '#6b7280' : '#8ba0bd',
    zoomHandle: isLight ? '#2563eb' : '#38bdf8',
    lineBlue: isLight ? '#2563eb' : '#38bdf8',
    lineYellow: isLight ? '#f59e0b' : '#fbbf24',
    lineRed: isLight ? '#ef4444' : '#f87171',
    lineGreen: isLight ? '#10b981' : '#34d399',
    linePurple: isLight ? '#8b5cf6' : '#c084fc',
  };
};

/* =========================================================
   6. 日期 / 时间工具（跨页面复用）
   ========================================================= */

// Date 对象 → 'YYYY-MM-DD'
window.formatDate = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// 某日期所在周的周一（'YYYY-MM-DD'）
window.getWeekKey = (dateStr) => {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay() || 7;
  const monday = new Date(d);
  monday.setDate(d.getDate() - day + 1);
  return window.formatDate(monday);
};

// 月份偏移（返回 'YYYY-MM-DD'）
window.shiftMonths = (dateStr, months) => {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() - months);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

// Lightweight Charts 时间 → 'YYYY-MM-DD'
window.toTimeStr = (t) => {
  if (!t) return null;
  if (typeof t === 'string') return t;
  if (typeof t === 'number') return new Date(t * 1000).toISOString().slice(0, 10);
  if (typeof t === 'object' && t.year !== undefined) {
    return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
  }
  return null;
};

// 日期数组（升序）中找 >= target 的最近值
window.nearestOnOrAfter = (dates, target) => {
  for (let i = 0; i < dates.length; i++) if (dates[i] >= target) return dates[i];
  return null;
};

// 日期数组（升序）中找 <= target 的最近值
window.nearestOnOrBefore = (dates, target) => {
  for (let i = dates.length - 1; i >= 0; i--) if (dates[i] <= target) return dates[i];
  return null;
};

// 读取 CSS 变量（带 fallback）
window.getCssVar = (name, fallback) => {
  const v = getComputedStyle(document.body).getPropertyValue(name);
  return (v && v.trim()) || fallback;
};

/* =========================================================
   7. 通用数据聚合与数学拟合
   ========================================================= */

// 聚合 OHLC（月线 / 周线），输入为对象数组
window.aggregateOHLC = (daily, gran) => {
  const groups = new Map();
  for (const r of daily) {
    if (r.open == null || r.high == null || r.low == null || r.close == null) continue;
    const key = gran === 'month' ? r.date.slice(0, 7) : window.getWeekKey(r.date);
    const g = groups.get(key);
    if (!g) groups.set(key, { key, open: r.open, high: r.high, low: r.low, close: r.close });
    else {
      if (r.high > g.high) g.high = r.high;
      if (r.low < g.low) g.low = r.low;
      g.close = r.close;
    }
  }
  return Array.from(groups.values()).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
};

// 最小二乘线性拟合：输入 [{x, y}]，返回预测函数 x => y；点数 < 2 或退化时返回 null
window.fitTrend = (points) => {
  if (!points || points.length < 2) return null;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const p of points) { sx += p.x; sy += p.y; sxy += p.x * p.y; sxx += p.x * p.x; }
  const n = points.length;
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return (x) => slope * x + intercept;
};

// N 天前的差值（用于排行榜周/月/季变化）
window.diffOverDays = (pts, days, field = 'shares_yi') => {
  if (!pts || !pts.length) return 0;
  const last = pts[pts.length - 1];
  const targetStr = new Date(new Date(last.date + 'T00:00:00Z').getTime() - days * 86400000)
    .toISOString().slice(0, 10);
  let base = pts[0];
  for (let i = pts.length - 1; i >= 0; i--) {
    if (pts[i].date <= targetStr) { base = pts[i]; break; }
  }
  return last[field] - base[field];
};

/* =========================================================
   8. ECharts 通用组件
   ========================================================= */

// 构造 inside + slider 两个 dataZoom
window.buildDataZoom = (range, isMobile, bottom, theme) => {
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
};

// 统一 ECharts 轴触发的 tooltip 配置
window.buildAxisTooltip = (theme, formatter, opts = {}) => ({
  trigger: 'axis',
  axisPointer: {
    type: 'cross',
    label: { backgroundColor: theme.crossLabelBg, color: theme.crossLabelText },
    crossStyle: { color: theme.crossLine },
    lineStyle: { color: theme.crossLine },
  },
  confine: true,
  backgroundColor: theme.tooltipBg,
  borderColor: theme.tooltipBorder,
  borderWidth: 1,
  textStyle: { color: theme.tooltipText },
  extraCssText: 'box-shadow: 0 4px 12px rgba(0,0,0,.1); border-radius: 6px;',
  formatter,
  ...opts,
});

// 公共 K 线 (Candlestick) 悬浮框排版
window.formatCandlestickTooltip = (theme, params, getDataFn) => {
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
};