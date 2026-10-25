(function(){
  "use strict";

  const ym2i = s => { const p = s.split('-'); return (+p[0]) * 12 + (+p[1]) - 1; };
  const i2ym = i => Math.floor(i/12) + '-' + String(i%12+1).padStart(2,'0');
  const rnd  = s => { const x = Math.sin(s) * 43758.5453; return x - Math.floor(x); };

  const PIVOTS = [
    { d:'2007-10', v:6124, lab:'6124', pos:'above' },
    { d:'2008-10', v:1664, lab:'1664', pos:'below' },
    { d:'2009-08', v:3478, lab:'3478', pos:'above' },
    { d:'2012-12', v:1949, lab:'1949', pos:'below', anchor:'end', dx:-8 },
    { d:'2013-06', v:1849, lab:'1849', pos:'below', anchor:'start', dx:10, dy:6 },
    { d:'2015-06', v:5178, lab:'5178', pos:'above' },
    { d:'2015-07', v:4184, minor:true, pos:'above' },
    { d:'2016-01', v:2638, lab:'2638', pos:'below', anchor:'end', dx:-8 },
    { d:'2018-01', v:3587, lab:'3587', pos:'above' },
    { d:'2019-01', v:2440, lab:'2440', pos:'below' },
    { d:'2021-02', v:3731, lab:'3731', pos:'above' },
    { d:'2024-02', v:2635, lab:'2635', pos:'below', anchor:'end', dx:-10 },
    { d:'2024-05', v:3174, minor:true, pos:'above' },
    { d:'2024-09', v:2689, lab:'2689', pos:'below', anchor:'start', dx:12, dy:10 },
    { d:'2026-01', v:4197, lab:'4197', pos:'above', anchor:'end', dx:-6 },
    { d:'2026-05', v:4258, lab:'4258', pos:'above', anchor:'start', dx:4, dy:-6 }
  ];

  const EVENTS = [
    { d:'2008-09', t:'汇金增持四大行' },
    { d:'2011-10', t:'汇金第三轮增持启动' },
    { d:'2013-06', t:'汇金增持金融股并申购蓝筹ETF' },
    { d:'2015-07', t:'证金万亿级救市' },
    { d:'2018-10', t:'证金汇金扎堆宽基ETF' },
    { d:'2024-02', t:'汇金获央行再贷款，扩大ETF增持' },
    { d:'2024-09', t:'国新、诚通入场 + 924组合拳' },
    { d:'2026-01', t:'媒体明确减仓，科创创板后续续降' },
    { d:'2026-07', t:'份额企稳，开启小幅加回' }
  ];

  const W = 1120, H = 600;
  const PAD = { t: 58, r: 58, b: 95, l: 74 };
  const YMAX = 6500, YMIN = 1500;
  const X0 = ym2i('2007-10');
  const X1 = ym2i('2026-05');
  const PW = W - PAD.l - PAD.r;
  const PH = H - PAD.t - PAD.b;
  const Y_BASE = PAD.t + PH;

  const X = i => PAD.l + (i - X0) / (X1 - X0) * PW;
  const Y = v => PAD.t + (1 - (v - YMIN) / (YMAX - YMIN)) * PH;

  const segs = [];
  const ALL  = [];

  for (let k = 0; k < PIVOTS.length - 1; k++) {
    const a = PIVOTS[k], b = PIVOTS[k + 1];
    const ia = ym2i(a.d), ib = ym2i(b.d);
    const span = Math.max(1, ib - ia);
    const amp = Math.abs(b.v - a.v) * 0.075 + 45;
    const pts = [];

    for (let i = ia; i < ib; i++) {
      const t = (i - ia) / span;
      const base = a.v + (b.v - a.v) * t;
      const env = Math.sin(Math.PI * t);
      const osc =
        Math.sin(t * Math.PI * (2 + (k % 3)) + k * 1.9) * 0.55 +
        Math.sin(t * Math.PI * (3.7 + (k % 2)) + k * 1.1) * 0.45;
      const noise = (rnd(i * 1.317 + k * 7.233) - 0.5) * 0.55;
      const v = base + (amp * osc + amp * noise) * env;
      pts.push({ i, v: Math.max(300, v) });
    }
    pts.push({ i: ib, v: b.v });

    segs.push({ pts, up: b.v >= a.v });
    for (const p of pts) {
      if (!ALL.length || ALL[ALL.length - 1].i !== p.i) ALL.push(p);
    }
  }

  let s = `<defs>
    <linearGradient id="gUp" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#c94137" stop-opacity="0.14"/>
      <stop offset="100%" stop-color="#c94137" stop-opacity="0.01"/>
    </linearGradient>
    <linearGradient id="gDown" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#2f855a" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#2f855a" stop-opacity="0.01"/>
    </linearGradient>
  </defs>`;

  for (let v = 1500; v <= 6500; v += 1000) {
    const y = Y(v);
    s += `<line x1="${PAD.l}" y1="${y}" x2="${W - PAD.r}" y2="${y}" stroke="#eef0f4" stroke-width="1"/>`;
    s += `<text class="ax-y" x="${PAD.l - 14}" y="${y + 4}" text-anchor="end">${v}</text>`;
  }
  s += `<line x1="${PAD.l}" y1="${Y_BASE}" x2="${W - PAD.r}" y2="${Y_BASE}" stroke="#dfe3ea" stroke-width="1.2"/>`;

  for (let yr = 2008; yr <= 2026; yr++) {
    const i = yr * 12;
    if (i < X0 || i > X1) continue;
    const x = X(i);
    s += `<line x1="${x}" y1="${PAD.t}" x2="${x}" y2="${Y_BASE}" stroke="#f2f4f7" stroke-width="1"/>`;
    s += `<text class="ax" x="${x}" y="${Y_BASE + 24}" text-anchor="middle">${yr}</text>`;
  }

  let evIndex = 1;
  const evItems = [];
  for (const ev of EVENTS) {
    const i = ym2i(ev.d);
    if (i < X0 || i > X1) continue;
    const x = X(i);
    s += `<line x1="${x}" y1="${PAD.t}" x2="${x}" y2="${Y_BASE}" stroke="#2b6cb0" stroke-width="1.8" stroke-dasharray="5 5" opacity="0.6"/>`;
    const yb = Y_BASE + 48;
    s += `<g><title>${ev.d} · ${ev.t}</title>`;
    s += `<circle cx="${x}" cy="${yb}" r="9" fill="#f0f7ff" stroke="#2b6cb0" stroke-width="1.5" opacity="0.95"/>`;
    s += `<text x="${x}" y="${yb + 3.5}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#2b6cb0">${evIndex}</text>`;
    s += `</g>`;
    evItems.push(`<li><b>${evIndex}</b> <span class="ev-date">${ev.d}</span> ${ev.t}</li>`);
    evIndex++;
  }
  const listHtml = '<div class="ev-list"><div class="ev-list-title">国家队动作节点（对应图中底部数字标记）</div><ul>'
                 + evItems.join('') + '</ul></div>';

  for (const seg of segs) {
    const pts = seg.pts;
    if (pts.length < 2) continue;
    let d = '';
    for (let i = 0; i < pts.length; i++) {
      d += (i === 0 ? 'M' : 'L') + X(pts[i].i).toFixed(1) + ',' + Y(pts[i].v).toFixed(1);
    }
    const first = pts[0], last = pts[pts.length - 1];
    const dArea = d + `L${X(last.i).toFixed(1)},${Y_BASE}L${X(first.i).toFixed(1)},${Y_BASE}Z`;
    const fill = seg.up ? 'url(#gUp)' : 'url(#gDown)';
    const stroke = seg.up ? '#c94137' : '#2f855a';

    s += `<path d="${dArea}" fill="${fill}" stroke="none"/>`;
    s += `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round"/>`;
  }

  for (const pv of PIVOTS) {
    const i = ym2i(pv.d);
    const x = X(i), y = Y(pv.v);
    const color = pv.pos === 'above' ? '#c94137' : '#2f855a';

    s += `<circle cx="${x}" cy="${y}" r="${pv.minor ? 3 : 4.4}" fill="#fff" stroke="${color}" stroke-width="2"/>`;

    if (pv.lab) {
      const dx = pv.dx || 0;
      let dy = pv.dy || 0;
      dy += pv.pos === 'above' ? -13 : 22;
      const anchor = pv.anchor || 'middle';
      s += `<text class="plab" x="${(x + dx).toFixed(1)}" y="${(y + dy).toFixed(1)}" text-anchor="${anchor}">${pv.lab}</text>`;
    } else if (pv.minor) {
      const dy = pv.pos === 'above' ? -10 : 16;
      s += `<text class="plab minor" x="${x.toFixed(1)}" y="${(y + dy).toFixed(1)}" text-anchor="middle">${pv.v}</text>`;
    }
  }

  s += `<text class="ttl" x="${PAD.l - 14}" y="${PAD.t - 22}" text-anchor="end">上证指数</text>`;
  s += `<text class="ttl" x="${PAD.l}" y="${PAD.t - 22}" text-anchor="start">· 点位</text>`;

  s += `<line id="cross" x1="0" y1="${PAD.t}" x2="0" y2="${Y_BASE}" stroke="#12395f" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>`;
  s += `<circle id="hdot" cx="0" cy="0" r="4.5" fill="#12395f" opacity="0"/>`;
  s += `<rect id="hit" x="${PAD.l}" y="${PAD.t}" width="${PW}" height="${PH}" fill="transparent" style="cursor:crosshair"/>`;

  const svg = document.getElementById('chart');
  svg.innerHTML = s;

  document.querySelector('.chart-scroll').insertAdjacentHTML('afterend', listHtml);

  const tip = document.getElementById('tip');
  const cross = svg.querySelector('#cross');
  const hdot = svg.querySelector('#hdot');
  const hit = svg.querySelector('#hit');

  function nearest(iF) {
    let best = ALL[0], bd = Infinity;
    for (const p of ALL) {
      const d = Math.abs(p.i - iF);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  function eventNear(i) {
    let best = null, bd = 2.5;
    for (const ev of EVENTS) {
      const d = Math.abs(ym2i(ev.d) - i);
      if (d <= bd) { bd = d; best = ev; }
    }
    return best;
  }

  function hide() {
    cross.setAttribute('opacity', '0');
    hdot.setAttribute('opacity', '0');
    tip.style.opacity = '0';
  }

  hit.addEventListener('mousemove', function (e) {
    const r = svg.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width * W;
    if (px < PAD.l || px > W - PAD.r) { hide(); return; }

    const iF = X0 + (px - PAD.l) / PW * (X1 - X0);
    const p = nearest(iF);
    const x = X(p.i), y = Y(p.v);

    cross.setAttribute('x1', x); cross.setAttribute('x2', x);
    cross.setAttribute('opacity', '0.55');
    hdot.setAttribute('cx', x); hdot.setAttribute('cy', y);
    hdot.setAttribute('opacity', '1');

    const ev = eventNear(p.i);
    tip.innerHTML =
      '<b>' + i2ym(p.i) + '</b> · ' + Math.round(p.v) + ' 点' +
      (ev ? '<span class="ev">◆ ' + ev.t + '</span>' : '');
    tip.style.opacity = '1';

    const pageX = r.left + x / W * r.width;
    const pageY = r.top + y / H * r.height;
    let left = pageX + 16;
    let top = pageY - 46;

    if (left + tip.offsetWidth > window.innerWidth - 12) {
      left = pageX - tip.offsetWidth - 16;
    }
    if (top < 8) top = 8;

    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  });

  hit.addEventListener('mouseleave', hide);
  window.addEventListener('scroll', hide, { passive: true });

})();