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