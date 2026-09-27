// Plate III: the climate.
// Every figure and sentence here is computed at runtime from data/climate.json:
// growing-season warming stripes, a year-by-year index chart with headline figures,
// ten-year analogues between sites, a year inspector, and a pointer to the caveats and
// citations kept in Sources and method.
// Site colours are CSS custom properties in css/climate.css, validated for
// colour-vision deficiency against both theme surfaces.

const SITE_VAR = { chablis: '--clim-site-chablis', meursault: '--clim-site-meursault', rully: '--clim-site-rully', fuisse: '--clim-site-fuisse' };
const siteColor = id => `var(${SITE_VAR[id] || '--ink-2'})`;
const ROLL = 11; // centred rolling mean, years
const CC_BY_URL = 'https://creativecommons.org/licenses/by/4.0/';
const NB = '\u00a0'; // keeps a number and its unit on one line
const NARROW = 560; // chart width (px) below which the index chart uses its compact layout
const span = (a, b) => `${a}–${b}`;
const capFirst = t => t.charAt(0).toUpperCase() + t.slice(1);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
  'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
/** 0-99 in words, numerals above. */
function words(n) {
  if (!Number.isInteger(n) || n < 0 || n > 99) return String(n);
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
}

let uid = 0;
const newId = p => `clim-${p}-${++uid}`;

/** Decimal places written in a JSON number. */
function decimals(v) {
  if (v == null || !Number.isFinite(v) || Number.isInteger(v)) return 0;
  const str = String(v);
  const i = str.indexOf('.');
  return i < 0 ? 0 : str.length - i - 1;
}

function rolling(arr, w) {
  const half = (w - 1) / 2;
  return arr.map((_, i) => {
    if (i - half < 0 || i + half >= arr.length) return null;
    let sum = 0;
    for (let j = i - half; j <= i + half; j++) { if (arr[j] == null) return null; sum += arr[j]; }
    return sum / w;
  });
}

/** Trailing means of `w` values ending at each index (null until a full window exists). */
function trailing(arr, w) {
  return arr.map((_, i) => {
    if (i < w - 1) return null;
    let sum = 0;
    for (let j = i - w + 1; j <= i; j++) { if (arr[j] == null) return null; sum += arr[j]; }
    return sum / w;
  });
}

/** Competition ranks, 1 = highest. Ties share their first rank. */
const ranksDesc = arr => arr.map(v => v == null ? null : 1 + arr.filter(x => x != null && x > v).length);

/** Clean axis ticks. */
function niceScale(min, max, count = 5) {
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const err = raw / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return { lo, hi, step, ticks, dp: Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) };
}

/** Push overlapping labels apart, keeping order, inside [lo, hi]. */
function spread(items, gap, lo, hi) {
  items.sort((a, b) => a.y - b.y);
  for (let i = 0; i < items.length; i++) {
    items[i].y = Math.max(items[i].y, lo);
    if (i && items[i].y - items[i - 1].y < gap) items[i].y = items[i - 1].y + gap;
  }
  for (let i = items.length - 1; i >= 0; i--) {
    const cap = i === items.length - 1 ? hi : items[i + 1].y - gap;
    if (items[i].y > cap) items[i].y = cap;
  }
  return items;
}

function pathFrom(points, x, y) {
  let d = '', pen = false;
  for (const [px, py] of points) {
    if (py == null) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${x(px).toFixed(1)},${y(py).toFixed(1)}`;
    pen = true;
  }
  return d;
}

/* ------------------------------------------------------------------ model */

function buildModel(c) {
  const meta = c.meta || {};
  const [b0, b1] = meta.baseline || [1961, 1990];
  const [r0, r1] = meta.recent || [2016, 2025];
  const baseKey = `baseline_${b0}_${b1}`;
  const recentKey = `recent_${r0}_${r1}`;
  const sites = [...c.sites].sort((a, b) => b.lat - a.lat); // north to south
  const years = sites[0].years;
  const keys = Object.keys(c.indices).filter(k => sites.every(st => Array.isArray(st[k]) && c.summary?.[st.id]?.[k]));
  const idx = {};
  for (const k of keys) {
    const all = sites.flatMap(st => st[k]).filter(v => v != null);
    const sums = sites.map(st => c.summary[st.id][k]);
    idx[k] = {
      key: k, ...c.indices[k],
      dp: Math.min(2, Math.max(0, ...all.map(decimals))),
      sdp: Math.min(2, Math.max(0, ...sums.flatMap(x => [x[baseKey], x[recentKey], x.delta]).map(decimals))),
      tdp: Math.min(2, Math.max(0, ...sums.map(x => decimals(x.trend_per_decade)))),
      min: Math.min(...all), max: Math.max(...all),
    };
  }
  for (const st of sites) {
    st.roll = {}; st.rank = {};
    for (const k of keys) { st.roll[k] = rolling(st[k], ROLL); st.rank[k] = ranksDesc(st[k]); }
    const base = c.summary[st.id].gs_tmean?.[baseKey];
    st.anom = (st.gs_tmean || []).map(v => v == null || base == null ? null : v - base);
  }
  // First and last year with a full centred window
  const half = (ROLL - 1) / 2;
  const rollSpan = [years[half], years[years.length - 1 - half]];
  return { meta, indices: idx, keys, sites, years, summary: c.summary, analogs: c.analogs || {}, b0, b1, r0, r1, baseKey, recentKey, rollSpan };
}

/* ------------------------------------------------------------------ small widgets */

/** Radio group behaviour on role="radio" buttons: roving tabindex, arrows, Home/End. */
function radioGroup(group, buttons, onSelect) {
  group.addEventListener('keydown', e => {
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    let j = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % buttons.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + buttons.length) % buttons.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = buttons.length - 1;
    if (j == null) return;
    e.preventDefault();
    buttons[j].focus();
    onSelect(buttons[j].dataset.value);
  });
  buttons.forEach(b => b.addEventListener('click', () => onSelect(b.dataset.value)));
}
function syncRadios(buttons, value) {
  for (const b of buttons) {
    const on = b.dataset.value === value;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  }
}

/**
 * The shared util.tip, shown on behalf of one owner. hide() only hides the tip while it
 * still holds this owner's content, so a scroll here never hides another plate's tip.
 */
function tipOwner(tip) {
  let node = null;
  const on = () => !!node && node.isConnected && !!node.parentElement?.classList.contains('on');
  return {
    show(evt, content) { node = content; tip.show(evt, content); return content.parentElement; },
    hide() { if (on()) tip.hide(); node = null; },
    get on() { return on(); },
  };
}

/** Tick label width in px for the 10.5px mono axis face (0.6 em per glyph). */
const monoW = str => String(str).length * 6.3;

/**
 * A line chart drawn in SVG at the container's pixel width. The plot is a keyboard slider
 * over the x values (years), with a hover crosshair and a tooltip listing every series.
 * On touch a tap shows the same crosshair and tooltip until the next tap elsewhere.
 */
function lineChart(util, { label, onPick, cls = '', isShown = () => true }) {
  const { h, s } = util;
  const tip = tipOwner(util.tip);
  const svg = s('svg', { class: 'clim-svg', 'aria-hidden': 'true', focusable: 'false' });
  const el = h('div', {
    class: `clim-plot ${cls}`,
    attrs: { role: 'slider', tabindex: 0, 'aria-label': label, 'aria-orientation': 'horizontal' },
  }, svg);
  let cfg = null, G = null, rect = null, drawn = false, crossOn = false, lastPointer = 'mouse';
  let keyX = null, raf = 0; // keyX: the year a keyboard tooltip is anchored to

  // A tooltip is positioned in viewport pixels, so a scroll would strand it. A keyboard
  // tooltip follows its chart (once per frame) while the chart has focus and the anchor is
  // on screen. Any other tooltip, and one whose anchor has left the screen, is dropped.
  addEventListener('scroll', () => {
    rect = null;
    if (!crossOn && !tip.on) return;
    if (keyX == null || document.activeElement !== el) { hideCross(); tip.hide(); return; }
    if (!raf) raf = requestAnimationFrame(() => {
      raf = 0;
      if (keyX == null || !G) return;
      const r = getRect(), ay = r.top + G.Y1 + 8;
      const navH = parseFloat(util.cssVar('--nav-h')) || 0; // the sticky bar covers the top
      if (ay < navH || ay > innerHeight - 24) { hideCross(); tip.hide(); } else anchoredTip(keyX);
    });
  }, { passive: true });
  addEventListener('resize', () => { rect = null; }, { passive: true });
  document.addEventListener('pointerdown', e => {
    if ((crossOn || tip.on) && !el.contains(e.target)) { hideCross(); tip.hide(); }
  }, { passive: true });
  const getRect = () => rect || (rect = el.getBoundingClientRect());

  function render(next) {
    if (next) cfg = next;
    if (!cfg) return;
    const width = Math.max(260, Math.round(el.clientWidth || 640));
    const m = cfg.margin(width);
    // Room for the longest y tick label, so four-digit ticks stay inside the column.
    m.l = Math.max(m.l, Math.ceil(Math.max(...cfg.yTicks.map(t => monoW(cfg.yFmt(t))))) + 12);
    const H = cfg.height(width);
    const X0 = m.l, X1 = width - m.r, Y0 = H - m.b, Y1 = m.t;
    const [xa, xb] = cfg.xDomain;
    const [ya, yb] = cfg.yDomain;
    const x = v => X0 + (v - xa) / (xb - xa) * (X1 - X0);
    const y = v => Y0 - (v - ya) / (yb - ya) * (Y0 - Y1);
    G = { X0, X1, Y0, Y1, x, y, xa, xb, width, H };
    svg.setAttribute('viewBox', `0 0 ${width} ${H}`);
    svg.setAttribute('width', width);
    svg.setAttribute('height', H);
    // Lines draw in once. Until the figure has been revealed every render keeps the draw
    // class (the lines wait, hidden, for the reveal), so a re-render that happens before
    // the reveal, such as a region picked on the map, does not spend the animation.
    const animate = cfg.animate && !drawn && !util.reducedMotion();
    if (animate && isShown()) drawn = true;

    const kids = [];
    // Bands (reference periods)
    for (const b of cfg.bands || []) {
      kids.push(s('rect', { class: 'band', x: x(b.x0), y: Y1, width: x(b.x1) - x(b.x0), height: Y0 - Y1 }));
      if (b.label) kids.push(s('text', { class: 'band-label', x: x(b.x0) + 6, y: Y1 + 13, text: b.label }));
    }
    // Grid and y axis
    for (const t of cfg.yTicks) {
      const yy = y(t);
      kids.push(s('line', { class: t === 0 && cfg.zero ? 'grid zero' : 'grid', x1: X0, x2: X1, y1: yy, y2: yy }));
      kids.push(s('text', { class: 'tick', x: X0 - 8, y: yy + 3.5, 'text-anchor': 'end', text: cfg.yFmt(t) }));
    }
    // The unit sits on its own line above the tick column, clear of the year marker's label.
    if (cfg.yUnit) kids.push(s('text', { class: 'unit', x: 0, y: Y1 - 24, 'text-anchor': 'start', text: cfg.yUnit }));
    // x axis
    kids.push(s('line', { class: 'axis', x1: X0, x2: X1, y1: Y0, y2: Y0 }));
    for (const t of cfg.xTicks(width)) {
      kids.push(s('line', { class: 'axis', x1: x(t), x2: x(t), y1: Y0, y2: Y0 + 4 }));
      kids.push(s('text', { class: 'tick', x: x(t), y: Y0 + 17, 'text-anchor': 'middle', text: String(t) }));
    }
    if (cfg.xTitle) kids.push(s('text', { class: 'unit', x: X1, y: Y0 + 36, 'text-anchor': 'end', text: cfg.xTitle }));
    // Series: faint yearly lines under bold smoothed lines, emphasised series last
    const series = [...cfg.series].sort((a, b) => (a.emph ? 1 : 0) - (b.emph ? 1 : 0));
    for (const sr of series) if (sr.raw) {
      kids.push(s('path', { class: `raw${sr.emph ? ' emph' : ''}`, d: pathFrom(sr.raw, x, y), stroke: sr.color }));
    }
    for (const sr of series) if (sr.smooth) {
      kids.push(s('path', {
        class: `smooth${sr.emph ? ' emph' : ''}${animate ? ' draw' : ''}`, d: pathFrom(sr.smooth, x, y),
        stroke: sr.color, pathLength: animate ? 1 : null,
      }));
    }
    // Reference lines, each label placed where it covers the least ink. Bold smoothed
    // lines weigh more than faint yearly lines, and end dots with their leaders are
    // treated as obstacles a label must not sit on.
    const polylines = cfg.series.flatMap(sr => [
      sr.raw && { w: 1, pts: sr.raw }, sr.smooth && { w: sr.emph ? 8 : 5, pts: sr.smooth },
    ]).filter(Boolean).map(({ w, pts }) => ({ w, pl: pts.filter(p => p[1] != null).map(([px, py]) => [x(px), y(py)]) }));
    const obstacles = (cfg.endLabels || []).filter(L => L.y != null)
      .map(L => [x(L.x) - 7, X1 + 2, y(L.y) - 6, y(L.y) + 6]);
    const hits = (bx0, bx1, by0, by1) => {
      let n = 0;
      for (const { w, pl } of polylines) for (let i = 1; i < pl.length; i++) {
        const [ax, ay] = pl[i - 1], [cx, cy] = pl[i];
        if (cx < bx0 || ax > bx1) continue;
        for (let t = 0; t <= 1; t += 0.25) {
          const px = ax + (cx - ax) * t, py = ay + (cy - ay) * t;
          if (px >= bx0 && px <= bx1 && py >= by0 && py <= by1) { n += w; break; }
        }
      }
      for (const [ox0, ox1, oy0, oy1] of obstacles) if (ox0 < bx1 && ox1 > bx0 && oy0 < by1 && oy1 > by0) n += 1000;
      return n;
    };
    for (const r of cfg.hlines || []) {
      const yy = y(r.y), rx0 = x(r.x0 ?? xa), rx1 = x(r.x1 ?? xb);
      kids.push(s('line', { class: `ref ${r.cls || ''}`, x1: rx0, x2: rx1, y1: yy, y2: yy }));
      if (!r.label || (r.minWidth && width < r.minWidth)) continue;
      const tw = r.label.length * 5.9 + 6;
      const cands = [
        { x: rx1 - 4, anchor: 'end', dy: 14 }, { x: rx1 - 4, anchor: 'end', dy: -6 },
        { x: rx0 + 4, anchor: 'start', dy: -6 }, { x: rx0 + 4, anchor: 'start', dy: 14 },
        ...[0.5, 0.25, 0.75].flatMap(f => [
          { x: rx0 + (rx1 - rx0) * f, anchor: 'middle', dy: 14 }, { x: rx0 + (rx1 - rx0) * f, anchor: 'middle', dy: -6 },
        ]),
      ].map(c => {
        const bx0 = c.anchor === 'end' ? c.x - tw : c.anchor === 'middle' ? c.x - tw / 2 : c.x;
        const by1 = yy + c.dy + 3, by0 = by1 - 13;
        const out = by0 < Y1 || by1 > Y0;
        return { ...c, score: out ? 1e6 : hits(bx0, bx0 + tw, by0, by1) };
      });
      const best = cands.reduce((a, b) => b.score < a.score ? b : a);
      kids.push(s('text', { class: 'ref-label', x: best.x, y: yy + best.dy, 'text-anchor': best.anchor, text: r.label }));
    }
    // Marker (selected x)
    if (cfg.marker != null) {
      const mx = x(cfg.marker);
      kids.push(s('line', { class: 'marker', x1: mx, x2: mx, y1: Y1 - 4, y2: Y0 }));
      const anchor = mx > X1 - 24 ? 'end' : mx < X0 + 24 ? 'start' : 'middle';
      kids.push(s('text', { class: 'marker-label', x: mx, y: Y1 - 8, 'text-anchor': anchor, text: cfg.markerLabel ? cfg.markerLabel(cfg.marker) : String(cfg.marker) }));
    }
    // Dots, each with a 2px surface ring (CSS) so neighbours stay legible where they touch
    for (const d of cfg.dots || []) {
      kids.push(s('circle', { class: 'dot', cx: x(d.x), cy: y(d.y), r: d.r || 4, fill: d.color }));
    }
    // Direct end labels. A neutral dotted leader joins each line's last point to its
    // label, so the gap between the end of a smoothed line and the right edge never
    // reads as data. A short key in the series colour sits beside the label text.
    const labels = (cfg.endLabels || []).map(L => ({ ...L, y0: y(L.y), y: y(L.y) }));
    spread(labels, 15, Y1 + 4, Y0 - 2);
    // End dots: the emphasised series first, then any dot that would sit on one already
    // placed is left out (its line still ends there and its leader still starts there).
    const endDots = [];
    if (cfg.endDots) {
      for (const L of [...labels].sort((a, b) => (b.emph ? 1 : 0) - (a.emph ? 1 : 0))) {
        const r = L.emph ? 4.5 : 4, cx = x(L.x), cy = L.y0;
        if (endDots.some(o => Math.hypot(o.cx - cx, o.cy - cy) < o.r + r + 1)) continue;
        endDots.push({ cx, cy, r, color: L.color });
      }
    }
    for (const L of labels) {
      const lx = X1 + 6;
      const ex = x(L.x);
      const sx = ex + (cfg.endDots ? 6 : 3);
      const d = sx < X1 ? `M${sx.toFixed(1)},${L.y0.toFixed(1)}H${X1.toFixed(1)}L${lx.toFixed(1)},${L.y.toFixed(1)}`
        : `M${sx.toFixed(1)},${L.y0.toFixed(1)}L${lx.toFixed(1)},${L.y.toFixed(1)}`;
      kids.push(s('path', { class: 'leader', d }));
    }
    for (const D of endDots.reverse()) {
      kids.push(s('circle', { class: 'end-dot', cx: D.cx.toFixed(1), cy: D.cy.toFixed(1), r: D.r, fill: D.color }));
    }
    for (const L of labels) {
      const lx = X1 + 6;
      kids.push(s('line', { class: 'end-key', x1: lx + 2, x2: lx + 11, y1: L.y, y2: L.y, stroke: L.color }));
      const t = s('text', { class: `end-label${L.emph ? ' emph' : ''}`, x: lx + 15, y: L.y + 4, text: L.text });
      if (cfg.onLabel) { t.addEventListener('click', () => cfg.onLabel(L.id)); t.classList.add('clickable'); }
      kids.push(t);
    }
    // Crosshair layer (updated on hover without a full redraw)
    const cross = s('g', { class: 'cross', visibility: 'hidden' });
    kids.push(cross);
    svg.replaceChildren(...kids);
    G.cross = cross;
    crossOn = false;
    cfg.onRender?.(width);

    el.setAttribute('aria-valuemin', xa);
    el.setAttribute('aria-valuemax', xb);
    const now = cfg.marker ?? xb;
    el.setAttribute('aria-valuenow', now);
    el.setAttribute('aria-valuetext', cfg.valueText ? cfg.valueText(now) : String(now));
  }

  function showCross(xv) {
    if (!G || !cfg) return;
    const { x, y, Y0, Y1 } = G;
    const kids = [s('line', { class: 'crossline', x1: x(xv), x2: x(xv), y1: Y1, y2: Y0 })];
    for (const c of cfg.cross || []) {
      const v = c.at(xv);
      if (v == null) continue;
      kids.push(s('circle', { class: 'crossdot', cx: x(xv), cy: y(v), r: 4, fill: c.color }));
    }
    G.cross.replaceChildren(...kids);
    G.cross.setAttribute('visibility', 'visible');
    crossOn = true;
  }
  function hideCross() { if (G?.cross) G.cross.setAttribute('visibility', 'hidden'); crossOn = false; keyX = null; }

  function xFromClient(clientX) {
    const r = getRect();
    const { X0, X1, xa, xb } = G;
    return clamp(Math.round(xa + (clientX - r.left - X0) / (X1 - X0) * (xb - xa)), xa, xb);
  }

  /** Tooltip for a year chosen without a pointer (keyboard), anchored to the plot. It sits
   * to the left of the year line whenever the right-hand side would cover the end labels. */
  function anchoredTip(xv) {
    keyX = xv;
    if (!cfg.tipFor) return;
    const r = getRect();
    const mx = r.left + G.x(xv), my = r.top + G.Y1 + 8;
    const t = tip.show({ clientX: mx, clientY: my }, cfg.tipFor(xv));
    if (!t) return;
    const w = t.getBoundingClientRect().width;
    const coversLabels = mx + 14 + w > r.left + G.X1 - 4;
    if (coversLabels && mx - 14 - w >= 8) tip.show({ clientX: mx - w - 28, clientY: my }, t.firstChild);
  }

  el.addEventListener('pointerenter', () => { rect = null; });
  el.addEventListener('pointerdown', e => { lastPointer = e.pointerType || 'mouse'; }, { passive: true });
  el.addEventListener('pointermove', e => {
    if (!G || !cfg || e.pointerType === 'touch') return;
    const xv = xFromClient(e.clientX);
    keyX = null;
    showCross(xv);
    if (cfg.tipFor) tip.show(e, cfg.tipFor(xv));
  });
  el.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch') { hideCross(); tip.hide(); } });
  el.addEventListener('click', e => {
    if (!G || !cfg || e.target.classList?.contains('clickable')) return;
    const xv = xFromClient(e.clientX);
    onPick?.(xv, 'pointer');
    // A tap has no hover, so the tap itself opens the crosshair and tooltip. They stay
    // until the next tap outside the chart or a scroll.
    const type = e.pointerType || lastPointer;
    if (type === 'touch' || type === 'pen') {
      keyX = null;
      showCross(xv);
      if (cfg.tipFor) tip.show(e, cfg.tipFor(xv));
    }
  });
  el.addEventListener('keydown', e => {
    if (!G || !cfg) return;
    const cur = cfg.marker ?? G.xb;
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 }[e.key];
    let nx = null;
    if (step) nx = cur + step;
    else if (e.key === 'Home') nx = G.xa;
    else if (e.key === 'End') nx = G.xb;
    else if (e.key === 'Escape') { hideCross(); tip.hide(); return; }
    if (nx == null) return;
    e.preventDefault();
    nx = clamp(nx, G.xa, G.xb);
    onPick?.(nx, 'key');
    showCross(nx);
    anchoredTip(nx);
  });
  el.addEventListener('blur', () => { hideCross(); tip.hide(); });

  return { el, render, markDrawn() { drawn = true; }, get cfg() { return cfg; } };
}

/* ------------------------------------------------------------------ init */

export async function init(mount, ctx) {
  const { data, util, bus } = ctx;
  const { h, s, fmt, tip } = util;
  const raw = await data.climate();
  const M = buildModel(raw);
  const { meta, indices: IDX, keys, sites, years, summary, b0, b1, r0, r1, baseKey, recentKey } = M;
  if (!sites.length || !keys.length) throw new Error('climate.json has no sites or indices');

  const Y0 = years[0], YN = years[years.length - 1], NY = years.length;
  const yearIndex = new Map(years.map((yv, i) => [yv, i]));
  const siteById = new Map(sites.map(st => [st.id, st]));
  const nSites = sites.length;

  /* ---------- number formatting (all through util.fmt) ---------- */
  const tiny = d => 0.5 * 10 ** -d;
  const num = (v, d = 0) => v == null ? '–' : Math.abs(v) < tiny(d) ? fmt.num(0, d) : `${v < 0 ? '−' : ''}${fmt.num(Math.abs(v), d)}`;
  const signed = (v, d = 0) => v == null ? '–' : Math.abs(v) < tiny(d) ? fmt.num(0, d) : `${v > 0 ? '+' : '−'}${fmt.num(Math.abs(v), d)}`;
  // Singular only for a whole 1 written without decimals ("1 day", but "1.0 days").
  const unitOf = (k, v, d = 0) => {
    const u = IDX[k].unit;
    return u === 'days' && d === 0 && v != null && Math.abs(v) === 1 ? 'day' : u;
  };
  const withUnit = (k, v, d) => `${num(v, d)}${NB}${unitOf(k, v, d)}`;
  const withUnitSigned = (k, v, d) => `${signed(v, d)}${NB}${unitOf(k, v, d)}`;
  const absUnit = (k, v, d) => `${num(Math.abs(v), d)}${NB}${unitOf(k, Math.abs(v), d)}`;
  const temp2 = v => `${num(v, 2)}${NB}°C`;
  const possessive = name => `${name}\u2019s`;
  const listJoin = arr => arr.length <= 1 ? (arr[0] || '') : `${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`;
  const baseLabel = span(b0, b1), recentLabel = span(r0, r1);

  /* ---------- attribution (exactly as meta.attribution_html describes) ---------- */
  function attribution() {
    let href = 'https://open-meteo.com/', text = 'Weather data by Open-Meteo.com';
    try {
      const a = new DOMParser().parseFromString(meta.attribution_html || '', 'text/html').querySelector('a[href]');
      if (a) { href = a.getAttribute('href'); text = a.textContent.trim() || text; }
    } catch { /* keep the default */ }
    return h('a', { class: 'clim-attrib', attrs: { href }, text });
  }
  // CC BY 4.0 asks for a link to the licence and a note that the values shown are derived.
  const ccLink = () => h('a', { class: 'clim-attrib', attrs: { href: CC_BY_URL, rel: 'license' }, text: meta.licence || 'CC BY 4.0' });
  const datasetText = listJoin(String(meta.dataset || '').split(/,\s*/).filter(Boolean));
  const sourceLine = () => h('p', { class: 'clim-source' },
    attribution(), ' · ', ccLink(), ' · ', `Indices computed from Open-Meteo data${datasetText ? `, ${datasetText}` : ''}.`);

  /* ---------- state ---------- */
  const firstKey = keys.includes('gs_tmean') ? 'gs_tmean' : keys[0];
  const state = {
    index: firstKey,
    shown: new Set(sites.map(st => st.id)),
    focus: sites[0].id,
    year: YN,
    featured: M.analogs.chablis ? 'chablis' : (Object.keys(M.analogs)[0] || null),
  };

  const root = h('div', { class: 'clim' });
  if (!util.reducedMotion()) root.classList.add('clim--anim');

  /* ================================================================ Fig. III.1 stripes */
  const anomAll = sites.flatMap(st => st.anom).filter(v => v != null);
  const maxAbs = Math.max(...anomAll.map(Math.abs));
  const S = Math.ceil(maxAbs * 2) / 2; // symmetric scale, rounded up to 0.5 °C
  const stripeFill = a => {
    if (a == null) return 'var(--lvl-none)';
    const p = Math.round(clamp(Math.abs(a) / S, 0, 1) * 100);
    return `color-mix(in oklab, var(${a >= 0 ? '--warm' : '--cool'}) ${p}%, var(--clim-mid))`;
  };
  const gsPeriod = IDX.gs_tmean?.period || '';
  const stripesId = newId('stripes');
  const stripesSummaryId = newId('stripes-sum');

  // Colour key
  const keyStep = S >= 2 ? 1 : 0.5;
  const keyTicks = [];
  for (let t = -Math.floor(S / keyStep) * keyStep; t <= S + 1e-9; t += keyStep) keyTicks.push(+t.toFixed(2));
  const key = h('div', { class: 'clim-key', attrs: { 'aria-hidden': 'true' } },
    h('p', { class: 'clim-key-title', text: `Difference from the ${baseLabel} mean, °C` }),
    h('div', { class: 'clim-key-bar' }),
    h('div', { class: 'clim-key-ticks' }, keyTicks.map(t => h('span', {
      class: `clim-key-tick${Math.abs(t) === Math.floor(S) || t === 0 ? '' : ' minor'}`,
      style: { left: `${(t + S) / (2 * S) * 100}%` },
      text: t === 0 ? '0' : signed(t, keyStep < 1 ? 1 : 0),
    }))));

  const readout = h('p', { class: 'clim-readout', attrs: { 'aria-hidden': 'true' } });
  const readoutIdle = () => readout.replaceChildren(h('span', { class: 'idle', text: 'Hover over or focus a stripe to read its year and value. Select one to open that year in the inspector below.' }));
  readoutIdle();

  const stripeRows = [];
  const cellLabel = (st, i) => {
    const v = st.gs_tmean[i], a = st.anom[i];
    const dir = Math.abs(a) < tiny(2) ? `equal to the ${baseLabel} mean` : `${num(Math.abs(a), 2)}${NB}°C ${a > 0 ? 'above' : 'below'} the ${baseLabel} mean`;
    return `${st.name}, ${years[i]}, ${temp2(v)}, ${dir}`;
  };
  const tipNode = (st, i) => h('div', { class: 'clim-tip' },
    h('div', { class: 'clim-tip-head' }, h('b', { text: String(years[i]) }), ` ${st.name}`),
    h('div', {}, h('b', { text: temp2(st.gs_tmean[i]) }), ` · ${signed(st.anom[i], 2)}${NB}°C against ${baseLabel}`));
  const setReadout = (st, i) => readout.replaceChildren(
    h('span', { class: 'swatch-line', style: { background: siteColor(st.id) } }),
    h('b', { text: `${st.name} ${years[i]}` }), ' ',
    h('span', { class: 'num', text: temp2(st.gs_tmean[i]) }), ' ',
    h('span', { class: 'num strong', text: `${signed(st.anom[i], 2)}${NB}°C` }), ` against ${baseLabel}`);

  const grid = h('div', {
    class: 'clim-stripes', id: stripesId,
    attrs: { role: 'grid', 'aria-label': `Growing-season mean temperature, difference from each site’s ${baseLabel} mean, one stripe per year from ${Y0} to ${YN}`, 'aria-describedby': stripesSummaryId },
  });
  let activeCell = null;
  sites.forEach((st, r) => {
    const cells = years.map((yv, i) => h('div', {
      class: 'clim-stripe', attrs: { role: 'gridcell', tabindex: -1, 'aria-label': cellLabel(st, i), 'aria-selected': 'false' },
      dataset: { r: String(r), i: String(i) },
      style: { background: stripeFill(st.anom[i]) },
    }));
    const sm = summary[st.id].gs_tmean;
    const row = h('div', { class: 'clim-srow', attrs: { role: 'row' } },
      h('div', { class: 'clim-sname', attrs: { role: 'rowheader' } },
        h('span', { class: 'clim-sname-n', text: st.name }),
        h('span', { class: 'clim-sname-r', text: `${st.region && st.region !== st.name ? `${st.region} · ` : ''}${num(st.lat, 2)}° N` })),
      h('div', { class: 'clim-scells', attrs: { role: 'none' }, style: { gridTemplateColumns: `repeat(${NY}, minmax(0, 1fr))` } }, cells),
      h('div', { class: 'clim-send', attrs: { 'aria-hidden': 'true' } },
        h('span', { class: 'v', text: `${signed(sm.delta, 2)}${NB}°C` }),
        h('span', { class: 'k', text: `Change to ${recentLabel}` })));
    row.style.setProperty('--i', String(r));
    stripeRows.push({ st, row, cells });
    grid.append(row);
  });
  const allCells = stripeRows.map(r => r.cells);
  const setActiveCell = (r, i, focus) => {
    if (activeCell) activeCell.tabIndex = -1;
    activeCell = allCells[r][i];
    activeCell.tabIndex = 0;
    if (focus) activeCell.focus();
  };
  setActiveCell(0, yearIndex.get(state.year), false);

  grid.addEventListener('pointerover', e => {
    const c = e.target.closest('.clim-stripe');
    if (!c) return;
    const st = sites[+c.dataset.r], i = +c.dataset.i;
    setReadout(st, i);
  });
  const stripeTip = tipOwner(tip);
  let tipCell = null, tipEl = null;
  grid.addEventListener('pointermove', e => {
    const c = e.target.closest('.clim-stripe');
    if (!c || e.pointerType === 'touch') { stripeTip.hide(); tipCell = null; return; }
    if (c !== tipCell) { tipCell = c; tipEl = tipNode(sites[+c.dataset.r], +c.dataset.i); }
    stripeTip.show(e, tipEl);
  });
  grid.addEventListener('pointerleave', () => { stripeTip.hide(); tipCell = null; if (!grid.contains(document.activeElement)) readoutIdle(); });
  // The tooltip is placed in viewport pixels, so a scroll would strand it over other content.
  addEventListener('scroll', () => { if (stripeTip.on) { stripeTip.hide(); tipCell = null; } }, { passive: true });
  grid.addEventListener('focusin', e => {
    const c = e.target.closest('.clim-stripe');
    if (!c) return;
    setReadout(sites[+c.dataset.r], +c.dataset.i);
  });
  grid.addEventListener('focusout', e => { if (!grid.contains(e.relatedTarget)) readoutIdle(); });
  grid.addEventListener('click', e => {
    const c = e.target.closest('.clim-stripe');
    if (!c) return;
    setActiveCell(+c.dataset.r, +c.dataset.i, false);
    setYear(years[+c.dataset.i]);
  });
  grid.addEventListener('keydown', e => {
    const c = e.target.closest('.clim-stripe');
    if (!c) return;
    let r = +c.dataset.r, i = +c.dataset.i;
    switch (e.key) {
      case 'ArrowRight': i++; break;
      case 'ArrowLeft': i--; break;
      case 'ArrowDown': r++; break;
      case 'ArrowUp': r--; break;
      case 'Home': i = 0; if (e.ctrlKey) r = 0; break;
      case 'End': i = NY - 1; if (e.ctrlKey) r = nSites - 1; break;
      case 'PageUp': i -= 10; break;
      case 'PageDown': i += 10; break;
      case 'Enter': case ' ': e.preventDefault(); setYear(years[i]); return;
      default: return;
    }
    e.preventDefault();
    setActiveCell(clamp(r, 0, nSites - 1), clamp(i, 0, NY - 1), true);
  });

  // Axis and baseline bracket, aligned to the cells column
  const pct = i => `${(i + 0.5) / NY * 100}%`;
  const decadeTicks = years.filter(yv => yv % 10 === 0);
  const bi0 = yearIndex.get(b0), bi1 = yearIndex.get(b1);
  const bracket = h('div', { class: 'clim-sbracket', attrs: { 'aria-hidden': 'true' } },
    h('div', { class: 'clim-sbracket-in', style: { left: `${bi0 / NY * 100}%`, width: `${(bi1 - bi0 + 1) / NY * 100}%` } },
      h('span', { text: `${baseLabel} baseline` })));
  const yearCaret = h('span', { class: 'clim-scaret' });
  const yearCaretLabel = h('span', { class: 'clim-scaret-label' });
  const axis = h('div', { class: 'clim-saxis', attrs: { 'aria-hidden': 'true' } },
    decadeTicks.map(yv => h('span', { class: `clim-saxis-t${yv % 20 ? ' minor' : ''}`, style: { left: pct(yearIndex.get(yv)) }, text: String(yv) })),
    yearCaret, yearCaretLabel);
  const frameRow = (inner, cls) => h('div', { class: `clim-sframe ${cls}` }, h('div'), h('div', { class: 'clim-sframe-mid' }, inner), h('div'));

  // Text alternative for the stripes
  const stripeSummary = h('div', { class: 'visually-hidden', id: stripesSummaryId },
    sites.map(st => {
      let lo = 0, hi = 0;
      st.anom.forEach((a, i) => { if (a < st.anom[lo]) lo = i; if (a > st.anom[hi]) hi = i; });
      const sm = summary[st.id].gs_tmean;
      return h('p', { text: `${st.name}. Differences run from ${signed(st.anom[lo], 2)}${NB}°C in ${years[lo]} to ${signed(st.anom[hi], 2)}${NB}°C in ${years[hi]}. The ${recentLabel} mean is ${signed(sm.delta, 2)}${NB}°C against ${baseLabel}.` });
    }));

  // Figure blocks are unnamed sections, so they add no landmarks. Their h3 headings carry navigation.
  const fig1 = h('section', { class: 'clim-block clim-fig1' });
  const fig1H = h('h3', {}, 'Each season ', h('span', { class: 'italic-display', text: 'against its own baseline' }));
  fig1.append(
    h('div', { class: 'fig-head clim-fighead' },
      h('p', { class: 'fig-no', text: 'Fig. III.1 · Growing-season temperature' }),
      h('div', {},
        fig1H,
        h('p', { class: 'caption clim-figcap', text: `One stripe per growing season${gsPeriod ? ` (${gsPeriod})` : ''} from ${Y0} to ${YN}, at ${words(nSites)} commune centres from north to south. Colour shows how far that season’s mean temperature sits from the site’s own ${baseLabel} mean, on one scale shared by all rows.` })),
      key),
    h('div', { class: 'clim-sfig' },
      frameRow(bracket, 'top'),
      grid,
      frameRow(axis, 'bottom')),
    readout,
    stripeSummary,
    sourceLine());

  /* ================================================================ Fig. III.2 index chart */
  const railButtons = keys.map(k => h('button', {
    type: 'button', class: 'clim-rail-btn', attrs: { role: 'radio', 'aria-checked': 'false' }, dataset: { value: k },
  }, h('span', { class: 'l', text: IDX[k].label }), h('span', { class: 'm', text: `${IDX[k].unit} · ${IDX[k].period}` })));
  const rail = h('div', { class: 'clim-rail', attrs: { role: 'radiogroup', 'aria-label': 'Climate index' } }, railButtons);
  radioGroup(rail, railButtons, k => setIndex(k));

  const selectId = newId('select');
  const select = h('select', { class: 'input', id: selectId, on: { change: e => setIndex(e.target.value) } },
    keys.map(k => h('option', { value: k, text: `${IDX[k].label} (${IDX[k].unit})` })));
  const selectField = h('div', { class: 'field clim-select' }, h('label', { attrs: { for: selectId }, text: 'Climate index' }), select);

  const chips = sites.map(st => h('button', {
    type: 'button', class: 'chip clim-chip', attrs: { 'aria-pressed': 'true' }, dataset: { site: st.id },
    on: {
      click: () => toggleSite(st.id),
      pointerenter: e => { if (e.pointerType === 'mouse') previewSite(st.id); },
      pointerleave: () => previewSite(null),
      focus: () => previewSite(st.id), blur: () => previewSite(null),
    },
  }, h('span', { class: 'clim-linekey', style: { background: siteColor(st.id) } }), st.name));
  const chipRow = h('div', { class: 'clim-chips', attrs: { role: 'group', 'aria-label': 'Sites shown on the chart' } },
    h('span', { class: 'clim-chips-label', attrs: { 'aria-hidden': 'true' }, text: 'Sites' }), chips);

  const fig2Title = h('h3');
  const fig2Def = h('p', { class: 'caption clim-figcap' });
  const mainSummary = h('p', { class: 'visually-hidden', id: newId('main-sum') });
  const emptyNote = h('p', { class: 'clim-empty', hidden: true, text: 'No sites selected. Choose at least one site above to draw the chart.' });
  // On narrow charts the baseline mean is named here instead of on the plot.
  const refLegText = h('span');
  const refLeg = h('span', { class: 'clim-leg', hidden: true }, h('span', { class: 'clim-legend-ref', attrs: { 'aria-hidden': 'true' } }), refLegText);
  let preview = null;
  // Until its figure has been revealed a chart keeps its lines ready to draw in.
  const revealed = el => !root.classList.contains('clim--anim') || !!el.closest('.clim-block')?.classList.contains('is-in');
  const main = lineChart(util, { label: 'Index chart', onPick: x => setYear(x), isShown: () => revealed(main.el) });
  const plotWrap = h('div', { class: 'clim-plot-wrap' }, main.el, emptyNote);
  main.el.setAttribute('aria-describedby', mainSummary.id);

  // Headline figures
  const focusButtons = sites.map(st => h('button', {
    type: 'button', attrs: { role: 'radio', 'aria-checked': 'false' }, dataset: { value: st.id }, text: st.name,
  }));
  const focusSeg = h('div', { class: 'seg clim-focus', attrs: { role: 'radiogroup', 'aria-label': 'Headline figures for' } }, focusButtons);
  radioGroup(focusSeg, focusButtons, id => setFocus(id, true));
  const leadSentence = h('p', { class: 'clim-lead' });
  const leadSub = h('p', { class: 'clim-lead-sub' });
  const crossSentence = h('p', { class: 'clim-lead-sub' });
  const facts = h('dl', { class: 'facts clim-facts' });
  // The headline is spoken only after a choice made in this plate (the site buttons, an end
  // label, the index). A region picked on the map updates it silently.
  const leadStatus = h('p', { class: 'visually-hidden', attrs: { role: 'status' } });
  const announceHeadline = () => { leadStatus.textContent = leadSentence.textContent; };
  const headline = h('div', { class: 'clim-headline' });

  // Table view of the plotted values
  const tableBody = h('tbody');
  const tableHeadRow = h('tr');
  const tableCaption = h('caption', { class: 'visually-hidden' });
  const dataTable = h('details', { class: 'disclosure clim-details' },
    h('summary', { text: 'Table of yearly values' }),
    h('div', { class: 'clim-table-scroll', attrs: { tabindex: 0, role: 'region', 'aria-label': 'Yearly values' } },
      h('table', { class: 'clim-table' }, tableCaption, h('thead', {}, tableHeadRow), tableBody)));

  const fig2 = h('section', { class: 'clim-block clim-fig2' },
    h('div', { class: 'fig-head clim-fighead' },
      h('p', { class: 'fig-no', text: 'Fig. III.2 · Index by year' }),
      h('div', {}, fig2Title, fig2Def)),
    h('div', { class: 'clim-fig2-grid' },
      rail,
      h('div', { class: 'clim-fig2-plot' },
        h('div', { class: 'clim-controls' }, selectField, chipRow),
        h('figure', { class: 'clim-figure' }, plotWrap, mainSummary,
          h('figcaption', { class: 'caption clim-figcap-sm clim-legend' },
            h('span', { class: 'clim-leg' }, h('span', { class: 'clim-legend-raw', attrs: { 'aria-hidden': 'true' } }), h('span', { text: 'Single years' })),
            h('span', { class: 'clim-leg' }, h('span', { class: 'clim-legend-smooth', attrs: { 'aria-hidden': 'true' } }), h('span', { text: `${capFirst(words(ROLL))}-year centred mean, drawn ${span(...M.rollSpan)} where a full window exists` })),
            h('span', { class: 'clim-leg' }, h('span', { class: 'clim-legend-band', attrs: { 'aria-hidden': 'true' } }), h('span', { text: `${baseLabel} baseline` })),
            refLeg,
            h('span', { class: 'clim-leg' }, h('span', { class: 'clim-legend-marker', attrs: { 'aria-hidden': 'true' } }), h('span', { text: 'Selected year, shown in the year inspector below' })))),
        dataTable,
        sourceLine())),
    headline);
  headline.append(
    h('div', { class: 'clim-headline-text' },
      h('p', { class: 'eyebrow', text: 'Headline figures' }),
      focusSeg, leadSentence, leadSub, crossSentence, leadStatus),
    facts);

  /* ================================================================ Fig. III.3 analogs */
  const analogKeys = Object.keys(M.analogs).filter(id => siteById.has(id) && M.analogs[id]?.length);
  let fig3 = null, analogChart = null, analogMarker = null;
  const analogLead = h('p', { class: 'clim-analog-lead' });
  const analogLead2 = h('p', { class: 'clim-analog-lead2' });
  const analogCap = h('p', { class: 'clim-analog-cap' });
  const analogList = h('ul', { class: 'clim-analog-list' });
  const analogTableBody = h('tbody');
  let winLen = 10;
  const analogCapId = newId('analog-cap');
  if (analogKeys.length) {
    const w0 = M.analogs[analogKeys[0]][0].window;
    winLen = w0[1] - w0[0] + 1;
    // Ten-year means that climate.json states (each site's recent mean and every analog run)
    // are taken from the file, so the chart, its tooltip and the text quote one number.
    // Other runs are averaged here from the published yearly values.
    const known = new Map();
    const addKnown = (id, w, v) => {
      if (v == null || !Array.isArray(w) || w[1] - w[0] + 1 !== winLen) return;
      const key = `${id}:${w[1]}`;
      if (!known.has(key)) known.set(key, v);
    };
    for (const st of sites) addKnown(st.id, [r0, r1], summary[st.id].gs_tmean?.[recentKey]);
    for (const list of Object.values(M.analogs)) for (const a of list || []) addKnown(a.site, a.window, a.gs_tmean);
    for (const st of sites) st.win = trailing(st.gs_tmean, winLen).map((v, i) => v == null ? null : known.get(`${st.id}:${years[i]}`) ?? v);
    analogChart = lineChart(util, {
      label: `${capFirst(words(winLen))}-year running means of growing-season temperature at the ${words(nSites)} sites`,
      onPick: x => { analogMarker = x; renderAnalogChart(); },
      isShown: () => revealed(analogChart.el),
    });
    analogChart.el.setAttribute('aria-describedby', analogCapId);
    const fig3Title = h('h3', {}, `${capFirst(words(winLen))}-year `, h('span', { class: 'italic-display', text: 'analogues' }));
    fig3 = h('section', { class: 'clim-block clim-fig3' },
      h('div', { class: 'fig-head clim-fighead' },
        h('p', { class: 'fig-no', text: 'Fig. III.3 · Warmth matched across sites' }),
        h('div', {},
          fig3Title,
          h('p', { class: 'caption clim-figcap', text: `Each site’s ${recentLabel} mean growing-season temperature, set against every run of ${words(winLen)} consecutive seasons at the other sites, from ${span(Y0, Y0 + winLen - 1)} to ${span(YN - winLen + 1, YN)}. For each other site the closest run is shown.` }))),
      h('div', { class: 'clim-analog-grid' },
        h('div', { class: 'clim-analog-text' }, h('div', { attrs: { 'aria-live': 'polite' } }, analogLead, analogLead2), analogCap, analogList),
        h('figure', { class: 'clim-figure clim-analog-fig' }, analogChart.el,
          h('figcaption', { class: 'caption clim-figcap-sm', id: analogCapId, text: `Lines are ${words(winLen)}-year running means, plotted at the last year of each run. The horizontal rule is the featured site’s ${recentLabel} mean. Arrow keys step through the runs. Runs named in the text use the means published with the data. Other runs are averaged here from the yearly values, which are published to ${words(IDX.gs_tmean?.dp ?? 2)} decimal places, so they can differ from an exact mean in the last digit.` }))),
      h('div', { class: 'clim-analog-table-wrap' },
        h('table', { class: 'clim-table clim-analog-table' },
          h('caption', { class: 'clim-tcap', text: `All ${words(analogKeys.length)} sites. Select a site to feature it above.` }),
          h('thead', {}, h('tr', {},
            h('th', { attrs: { scope: 'col' }, text: 'Site' }),
            h('th', { attrs: { scope: 'col' }, class: 'num-col', text: `${recentLabel} mean` }),
            h('th', { attrs: { scope: 'col' }, text: `Closest ${words(winLen)}-year runs elsewhere` }))),
          analogTableBody)),
      sourceLine());
  }

  /* ================================================================ Fig. III.4 year inspector */
  const yearBig = h('p', { class: 'clim-year-big display-num', attrs: { 'aria-hidden': 'true' } });
  const sliderId = newId('year');
  const slider = h('input', {
    type: 'range', id: sliderId, min: Y0, max: YN, step: 1, value: state.year,
    on: { input: e => setYear(+e.target.value) },
  });
  const prevBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', on: { click: () => setYear(state.year - 1) } });
  const nextBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', on: { click: () => setYear(state.year + 1) } });
  const yearTicks = h('div', { class: 'clim-year-ticks', attrs: { 'aria-hidden': 'true' } },
    decadeTicks.concat(YN % 10 ? [YN] : []).map(yv => h('span', {
      // Narrow screens keep every second decade from the first one, plus the last year.
      class: [
        (yv - decadeTicks[0]) % 20 === 0 || yv === YN ? '' : 'minor', yv === Y0 ? 'first' : '', yv === YN ? 'last' : '',
        yv !== YN && YN - yv < 8 ? 'near-end' : '',
      ].filter(Boolean).join(' '),
      style: { left: `${(yv - Y0) / (YN - Y0) * 100}%` }, text: String(yv),
    })));
  const inspBody = h('tbody');
  const inspCaption = h('caption', { class: 'visually-hidden' });
  const fig4Title = h('h3', {}, 'One season, ', h('span', { class: 'italic-display', text: 'every index' }));
  const fig4 = h('section', { class: 'clim-block clim-fig4' },
    h('div', { class: 'fig-head clim-fighead' },
      h('p', { class: 'fig-no', text: 'Fig. III.4 · Year inspector' }),
      h('div', {},
        fig4Title,
        h('p', { class: 'caption clim-figcap', text: `Every index for one year at the ${words(nSites)} sites, with that year’s rank among the ${words(NY)} years ${span(Y0, YN)}. Rank 1 is the highest value at that site. Years with the same value share a range of ranks. The strip under each value runs from the lowest year on the left to the highest on the right.` }))),
    h('div', { class: 'clim-year-ctrl' },
      yearBig,
      h('div', { class: 'clim-year-slider' },
        h('label', { attrs: { for: sliderId }, class: 'clim-year-label', text: 'Year' }),
        slider, yearTicks),
      h('div', { class: 'clim-year-steps' }, prevBtn, nextBtn)),
    h('div', { class: 'clim-insp-wrap' },
      h('table', { class: 'clim-table clim-insp' }, inspCaption,
        h('thead', {}, h('tr', {},
          h('th', { attrs: { scope: 'col' }, text: 'Index' }),
          sites.map(st => h('th', { attrs: { scope: 'col' }, class: 'num-col' },
            h('span', { class: 'clim-linekey', style: { background: siteColor(st.id) } }), st.name)))),
        inspBody)),
    sourceLine());

  /* ================================================================ notes */
  // The record's caveats, its description, the site table and the citations are set out once,
  // in Sources and method. This plate points there. The attribution stays under every figure.
  // The links are plain fragment links, so the Sources plate hears the hashchange and opens the
  // part. Clicking the same link again re-sends the event. Without that plate they fall back to it.
  const toPart = (id, text) => h('a', {
    attrs: { href: `#${id}` }, text,
    on: {
      click: e => {
        if (!document.getElementById(id)) { e.preventDefault(); util.scrollToId('sources'); return; }
        if (location.hash === `#${id}`) setTimeout(() => dispatchEvent(new HashChangeEvent('hashchange')));
      },
    },
  });
  const nCaveats = (meta.caveats || []).length;
  const notesTitle = h('h3', { class: 'clim-notes-title', text: 'About the climate data' });
  const notes = h('div', { class: 'clim-notes' },
    notesTitle,
    h('p', { class: 'clim-notes-text' },
      nCaveats ? [`The ${words(nCaveats)} caveats that come with the climate record are listed under `, toPart('src-limits', 'Known limits'),
        ', part III of Sources and method. Read them before quoting a figure from this plate. '] : null,
      `How each index is computed, the ${words(nSites)} sites with their grid cells, and how to cite the data are under `,
      toPart('src-method', 'Method'), ', part II.'));

  root.append(fig1, fig2);
  if (fig3) root.append(fig3);
  root.append(fig4, notes);

  /* ================================================================ renderers */
  const xTicksYears = w => years.filter(yv => yv % (w < NARROW ? 20 : 10) === 0);
  const siteVal = (st, k, yv) => { const i = yearIndex.get(yv); return i == null ? null : st[k][i]; };

  function mainConfig() {
    const k = state.index, I = IDX[k];
    const sc = niceScale(I.min, I.max, 5);
    const shown = sites.filter(st => state.shown.has(st.id));
    const emphId = preview && state.shown.has(preview) ? preview : state.focus;
    const focusSt = siteById.get(state.focus);
    const base = summary[state.focus][k][baseKey];
    return {
      animate: true,
      xDomain: [Y0, YN], yDomain: [sc.lo, sc.hi], yTicks: sc.ticks, zero: sc.lo < 0 && sc.hi > 0,
      yFmt: v => num(v, sc.dp), yUnit: I.unit,
      xTicks: xTicksYears,
      margin: w => ({ t: 40, r: w < NARROW ? 86 : 100, b: 28, l: w < NARROW ? 32 : 44 }),
      endDots: true,
      height: w => w < NARROW ? 280 : w < 900 ? 340 : 380,
      bands: [{ x0: b0, x1: b1, label: baseLabel }],
      hlines: state.shown.has(state.focus) ? [{ y: base, x0: b0, x1: YN, cls: 'baseline', label: `${focusSt.name} ${baseLabel} mean`, minWidth: NARROW }] : [],
      onRender: w => {
        refLeg.hidden = !(w < NARROW && state.shown.has(state.focus));
        refLegText.textContent = `${focusSt.name} ${baseLabel} mean`;
      },
      series: shown.map(st => ({
        id: st.id, color: siteColor(st.id), emph: st.id === emphId,
        raw: years.map((yv, i) => [yv, st[k][i]]),
        smooth: years.map((yv, i) => [yv, st.roll[k][i]]),
      })),
      endLabels: shown.map(st => {
        let li = st.roll[k].length - 1;
        while (li > 0 && st.roll[k][li] == null) li--;
        return { id: st.id, text: st.name, color: siteColor(st.id), x: years[li], y: st.roll[k][li], emph: st.id === emphId };
      }),
      onLabel: id => setFocus(id, true),
      marker: state.year,
      cross: shown.map(st => ({ id: st.id, color: siteColor(st.id), at: xv => siteVal(st, k, xv) })),
      tipFor: xv => {
        const i = yearIndex.get(xv);
        return h('div', { class: 'clim-tip' },
          h('div', { class: 'clim-tip-head' }, h('b', { text: String(xv) }), ` ${I.label}`),
          shown.map(st => h('div', { class: 'clim-tip-row' },
            h('span', { class: 'clim-linekey', style: { background: siteColor(st.id) } }),
            h('b', { class: 'num', text: withUnit(k, st[k][i], I.dp) }),
            h('span', { text: ` ${st.name}` }),
            st.roll[k][i] != null ? h('span', { class: 'clim-tip-mute num', text: ` · mean ${num(st.roll[k][i], Math.min(2, I.dp + 1))}` }) : null)));
      },
      valueText: xv => {
        const i = yearIndex.get(xv);
        return shown.length ? `${xv}. ${shown.map(st => `${st.name} ${withUnit(k, st[k][i], I.dp)}`).join(', ')}` : String(xv);
      },
    };
  }

  function renderMain() {
    const k = state.index, I = IDX[k];
    fig2Title.replaceChildren(I.label);
    fig2Def.textContent = `${I.period}. ${I.definition ? `${I.definition}.` : ''} Values in ${I.unit}.`;
    main.el.setAttribute('aria-label', `${I.label}, ${Y0} to ${YN}. Arrow keys move the selected year.`);
    const any = state.shown.size > 0;
    emptyNote.hidden = any;
    plotWrap.classList.toggle('is-empty', !any);
    main.render(mainConfig());
    mainSummary.textContent = any
      ? `Line chart of ${I.label} at ${listJoin(sites.filter(st => state.shown.has(st.id)).map(st => st.name))}, ${Y0} to ${YN}. ${crossSiteText(k)} The full values are in the table below the chart.`
      : `No sites are selected, so the chart of ${I.label} is empty. The full values are in the table below the chart.`;
  }

  function crossSiteText(k) {
    const I = IDX[k];
    const ds = sites.map(st => ({ st, d: summary[st.id][k].delta }));
    const lo = ds.reduce((a, b) => b.d < a.d ? b : a), hi = ds.reduce((a, b) => b.d > a.d ? b : a);
    const allUp = ds.every(x => x.d > 0), allDown = ds.every(x => x.d < 0);
    if (lo.d === hi.d) return `${recentLabel} differs from ${baseLabel} by ${withUnitSigned(k, lo.d, I.sdp)} at every site.`;
    if (allUp) return `All ${words(ds.length)} sites are higher in ${recentLabel} than in ${baseLabel}, by ${absUnit(k, lo.d, I.sdp)} at ${lo.st.name} to ${absUnit(k, hi.d, I.sdp)} at ${hi.st.name}.`;
    if (allDown) return `All ${words(ds.length)} sites are lower in ${recentLabel} than in ${baseLabel}, by ${absUnit(k, hi.d, I.sdp)} at ${hi.st.name} to ${absUnit(k, lo.d, I.sdp)} at ${lo.st.name}.`;
    return `The change from ${baseLabel} to ${recentLabel} runs from ${withUnitSigned(k, lo.d, I.sdp)} at ${lo.st.name} to ${withUnitSigned(k, hi.d, I.sdp)} at ${hi.st.name}.`;
  }

  function extremeText(st, k, which) {
    const I = IDX[k];
    const vals = st[k];
    const target = which === 'high' ? Math.max(...vals.filter(v => v != null)) : Math.min(...vals.filter(v => v != null));
    const yrs = years.filter((_, i) => vals[i] === target);
    const word = which === 'high' ? 'highest' : 'lowest';
    if (yrs.length === 1) return `The ${word} value came in ${yrs[0]}, at ${withUnit(k, target, I.dp)}.`;
    return `${capFirst(words(yrs.length))} years share the ${word} value, ${withUnit(k, target, I.dp)}, most recently ${yrs[yrs.length - 1]}.`;
  }

  function renderHeadline() {
    const k = state.index, I = IDX[k];
    const st = siteById.get(state.focus);
    const sm = summary[st.id][k];
    const d = sm.delta;
    const rel = Math.abs(d) < tiny(I.sdp) ? `the same as the ${baseLabel} average` : `${absUnit(k, d, I.sdp)} ${d > 0 ? 'above' : 'below'} the ${baseLabel} average of ${withUnit(k, sm[baseKey], I.sdp)}`;
    leadSentence.replaceChildren(`At ${st.name}, ${recentLabel} averaged `, h('span', { class: 'clim-lead-v display-num', text: withUnit(k, sm[recentKey], I.sdp) }), `, ${rel}.`);
    leadSub.textContent = `The least-squares trend over ${span(Y0, YN)} is ${withUnitSigned(k, sm.trend_per_decade, I.tdp)} per decade. ${extremeText(st, k, 'high')} ${extremeText(st, k, 'low')}`;
    crossSentence.textContent = crossSiteText(k);
    const tiesBeyond = (list, which) => {
      if (!list?.length) return 0;
      const edge = list[list.length - 1][1];
      const n = st[k].filter(v => v === edge).length;
      const inList = list.filter(([, v]) => v === edge).length;
      return n - inList;
    };
    const yearList = (list, which) => {
      const extra = tiesBeyond(list, which);
      return h('dd', {}, (list || []).map(([yv, v]) => h('span', { class: 'clim-fact-yr' }, h('span', { text: String(yv) }), h('span', { class: 'v', text: num(v, I.dp) }))),
        extra > 0 ? h('span', { class: 'clim-fact-more', text: `and ${words(extra)} more tied` }) : null);
    };
    facts.replaceChildren(
      h('div', {}, h('dt', { text: `${baseLabel} mean` }), h('dd', { text: withUnit(k, sm[baseKey], I.sdp) })),
      h('div', {}, h('dt', { text: `${recentLabel} mean` }), h('dd', { text: withUnit(k, sm[recentKey], I.sdp) })),
      h('div', {}, h('dt', { text: 'Change' }), h('dd', { text: withUnitSigned(k, d, I.sdp) })),
      h('div', {}, h('dt', { text: `Trend per decade, ${span(Y0, YN)}` }), h('dd', { text: withUnitSigned(k, sm.trend_per_decade, I.tdp) })),
      h('div', { class: 'clim-fact-list' }, h('dt', { text: 'Three highest years' }), yearList(sm.top3, 'high')),
      h('div', { class: 'clim-fact-list' }, h('dt', { text: 'Three lowest years' }), yearList(sm.bottom3, 'low')));
  }

  function renderTable() {
    const k = state.index, I = IDX[k];
    tableCaption.textContent = `${I.label} by year, in ${I.unit}`;
    tableHeadRow.replaceChildren(h('th', { attrs: { scope: 'col' }, text: 'Year' }),
      ...sites.map(st => h('th', { attrs: { scope: 'col' }, class: 'num-col', text: st.name })));
    tableBody.replaceChildren(...years.map((yv, i) => h('tr', { class: yv === state.year ? 'is-year' : '' },
      h('th', { attrs: { scope: 'row' }, class: 'num', text: String(yv) }),
      sites.map(st => h('td', { class: 'num-col num', text: num(st[k][i], I.dp) })))));
  }

  function syncIndexControls() {
    syncRadios(railButtons, state.index);
    select.value = state.index;
  }
  function syncChips() {
    for (const c of chips) c.setAttribute('aria-pressed', String(state.shown.has(c.dataset.site)));
  }

  function renderStripesYear() {
    const i = yearIndex.get(state.year);
    for (const { cells } of stripeRows) cells.forEach((c, j) => {
      const on = j === i;
      c.classList.toggle('is-year', on);
      c.setAttribute('aria-selected', String(on));
    });
    yearCaret.style.left = `clamp(4px, ${pct(i)}, calc(100% - 4px))`;
    yearCaretLabel.style.left = pct(i);
    yearCaretLabel.textContent = String(state.year);
    const f = (i + 0.5) / NY;
    yearCaretLabel.dataset.anchor = f > 0.94 ? 'end' : f < 0.06 ? 'start' : 'middle';
  }

  function renderInspector() {
    const yv = state.year, i = yearIndex.get(yv);
    yearBig.textContent = String(yv);
    slider.value = String(yv);
    slider.setAttribute('aria-valuetext', String(yv));
    prevBtn.disabled = yv <= Y0; nextBtn.disabled = yv >= YN;
    prevBtn.replaceChildren(h('span', { attrs: { 'aria-hidden': 'true' }, text: '← ' }), yv > Y0 ? h('span', { class: 'num', text: String(yv - 1) }) : 'Earlier');
    nextBtn.replaceChildren(yv < YN ? h('span', { class: 'num', text: String(yv + 1) }) : 'Later', h('span', { attrs: { 'aria-hidden': 'true' }, text: ' →' }));
    // Accessible names contain the visible text (the year shown, or "Earlier" and "Later" at the ends).
    if (yv > Y0) prevBtn.setAttribute('aria-label', `Previous year, ${yv - 1}`); else prevBtn.removeAttribute('aria-label');
    if (yv < YN) nextBtn.setAttribute('aria-label', `Next year, ${yv + 1}`); else nextBtn.removeAttribute('aria-label');
    inspCaption.textContent = `Every climate index in ${yv} at each site, with its rank among the ${NY} years`;
    inspBody.replaceChildren(...keys.map(k => {
      const I = IDX[k];
      return h('tr', {},
        h('th', { attrs: { scope: 'row' } },
          h('span', { class: 'clim-insp-l', text: I.label }),
          h('span', { class: 'clim-insp-u', text: `${I.unit} · ${I.period}` })),
        sites.map(st => {
          const v = st[k][i];
          if (v == null) return h('td', { class: 'num-col' }, h('span', { class: 'clim-insp-v num', text: '–' }));
          const R = rankOf(st, k, i);
          const cls = R.first <= 3 ? ' hi' : R.last >= R.n - 2 ? ' lo' : '';
          return h('td', { class: `num-col${cls}` },
            h('span', { class: 'clim-insp-v num', text: num(v, I.dp) }),
            h('span', { class: 'clim-insp-r' },
              h('span', { attrs: { 'aria-hidden': 'true' }, text: R.shown }),
              h('span', { class: 'visually-hidden', text: `, ${R.spoken}` })),
            rankStrip(R));
        }));
    }));
    for (const tr of tableBody.children) tr.classList.toggle('is-year', tr.firstChild?.textContent === String(yv));
  }
  /**
   * One rank model for the visible text, the spoken text and the strip. Ranks count down
   * from the highest value (1). Years with the same value occupy a block of ranks, first
   * to last, so a value shared by the 26 lowest years holds ranks 51 to 76 of 76.
   */
  function rankOf(st, k, i) {
    const vals = st[k], v = vals[i];
    const n = vals.filter(x => x != null).length;
    const first = st.rank[k][i];
    const tie = vals.filter(x => x === v).length;
    const last = first + tie - 1;
    const top = first === 1, bottom = last === n;
    let shown, spoken;
    if (tie === 1) {
      shown = top ? 'Highest' : bottom ? 'Lowest' : `#${first}`;
      spoken = top ? `highest of ${n} years` : bottom ? `lowest of ${n} years` : `rank ${first} of ${n}`;
    } else {
      const others = `${tie - 1} other ${tie - 1 === 1 ? 'year' : 'years'}`;
      shown = top ? `Highest, ${tie} tied` : bottom ? `Lowest, ${tie} tied` : `#${first}–${last}`;
      spoken = `${top ? 'highest, ' : bottom ? 'lowest, ' : ''}tied with ${others}, ranks ${first} to ${last} of ${n}`;
    }
    return { first, last, n, tie, shown, spoken };
  }
  function rankStrip(R) {
    const W = 64, pos = r => (R.n - r) / (R.n - 1) * (W - 6) + 3;
    const x0 = pos(R.last), x1 = pos(R.first);
    return s('svg', { class: 'clim-rank', viewBox: `0 0 ${W} 8`, width: W, height: 8, 'aria-hidden': 'true', focusable: 'false' },
      s('line', { x1: 3, x2: W - 3, y1: 4, y2: 4 }),
      R.tie > 1
        ? s('line', { class: 'tie', x1: x0.toFixed(1), x2: x1.toFixed(1), y1: 4, y2: 4 })
        : s('circle', { cx: x1.toFixed(1), cy: 4, r: 3 }));
  }

  /* ---------- analogs ---------- */
  function analogText(id) {
    const st = siteById.get(id);
    const list = M.analogs[id] || [];
    const target = list[0]?.target ?? summary[id].gs_tmean[recentKey];
    const matches = list.filter(a => a.in_range);
    const misses = list.filter(a => !a.in_range);
    const lead = `${possessive(st.name)} ${recentLabel} growing seasons averaged ${temp2(target)}.`;
    let lead2 = '';
    if (matches.length) {
      const parts = matches.map((a, j) => j === 0 ? `${siteById.get(a.site).name} averaged that over ${span(...a.window)}` : `${siteById.get(a.site).name} over ${span(...a.window)}`);
      const within = Math.max(...matches.map(a => a.abs_diff));
      lead2 = `${listJoin(parts)}. ${matches.length > 1 ? 'Each run is' : 'The run is'} within ${num(within, 2)}${NB}°C of it.`;
    }
    const below = misses.filter(a => a.diff < 0), above = misses.filter(a => a.diff >= 0);
    const missText = [];
    const nm = a => siteById.get(a.site).name;
    if (below.length === 1) missText.push(`No ${words(winLen)}-year run at ${nm(below[0])} averaged that much. Its warmest, ${span(...below[0].window)}, averaged ${temp2(below[0].gs_tmean)}.`);
    else if (below.length > 1) missText.push(`No ${words(winLen)}-year run at ${listJoin(below.map(nm)).replace(/ and ([^ ]+)$/, ' or $1')} averaged that much.`);
    if (above.length === 1) missText.push(`Every ${words(winLen)}-year run at ${nm(above[0])} averaged more. Its coolest, ${span(...above[0].window)}, averaged ${temp2(above[0].gs_tmean)}.`);
    else if (above.length > 1) missText.push(`Every ${words(winLen)}-year run at ${listJoin(above.map(nm))} averaged more.`);
    return { st, target, list, lead, lead2: [lead2, ...missText].filter(Boolean).join(' ') };
  }

  // The table rows are built once. Featuring a site only flips their pressed state, so a
  // keyboard user keeps focus on the button they pressed.
  const analogRows = new Map();
  function buildAnalogTable() {
    analogTableBody.replaceChildren(...analogKeys.map(id => {
      const T = analogText(id);
      const btn = h('button', {
        type: 'button', class: 'clim-feature-btn', attrs: { 'aria-pressed': 'false' },
        on: { click: () => setFeatured(id) },
      }, h('span', { class: 'clim-linekey', style: { background: siteColor(id) } }), T.st.name);
      const tr = h('tr', {},
        h('th', { attrs: { scope: 'row' } }, btn),
        h('td', { class: 'num-col num', text: temp2(T.target) }),
        h('td', { class: 'clim-analog-td' }, h('div', { class: 'clim-analog-cell' }, T.list.map(a => h('span', { class: `clim-analog-item${a.in_range ? '' : ' miss'}` },
          h('span', { class: 'n', text: siteById.get(a.site).name }), ' ',
          a.in_range
            ? h('span', { class: 'num', text: `${span(...a.window)}, ${temp2(a.gs_tmean)}` })
            : h('span', { class: 'clim-miss-note', text: `no run as ${a.diff < 0 ? 'warm' : 'cool'}, ${a.diff < 0 ? 'warmest' : 'coolest'} ${span(...a.window)} at ${temp2(a.gs_tmean)}` }))))));
      analogRows.set(id, { tr, btn });
      return tr;
    }));
  }
  function setFeatured(id) {
    if (!M.analogs[id] || id === state.featured) return;
    state.featured = id;
    renderAnalog();
  }

  function renderAnalog() {
    if (!fig3) return;
    const A = analogText(state.featured);
    analogLead.replaceChildren(
      `${possessive(A.st.name)} ${recentLabel} growing seasons averaged `,
      h('span', { class: 'clim-lead-v display-num', text: temp2(A.target) }), '.');
    analogLead2.textContent = A.lead2;
    analogCap.textContent = `The closest ${words(winLen)}-year run at each other site, its mean, and its difference from ${temp2(A.target)}.`;
    analogList.replaceChildren(...A.list.map(a => h('li', { class: a.in_range ? '' : 'miss' },
      h('span', { class: 'clim-linekey', style: { background: siteColor(a.site) } }),
      h('span', { class: 'n', text: siteById.get(a.site).name }),
      h('span', { class: 'w num', text: span(...a.window) }),
      h('span', { class: 'v num', text: temp2(a.gs_tmean) }),
      h('span', { class: 'd num', text: a.in_range ? `${signed(a.diff, 2)}${NB}°C` : (a.diff < 0 ? 'warmest run' : 'coolest run') }))));
    for (const [id, { tr, btn }] of analogRows) {
      const on = id === state.featured;
      tr.classList.toggle('is-featured', on);
      btn.setAttribute('aria-pressed', String(on));
    }
    renderAnalogChart();
  }

  function renderAnalogChart() {
    if (!analogChart) return;
    const A = analogText(state.featured);
    const wins = sites.flatMap(st => st.win).filter(v => v != null);
    const sc = niceScale(Math.min(...wins, A.target), Math.max(...wins, A.target), 4);
    const xa = years[winLen - 1];
    const winSpan = xv => span(xv - winLen + 1, xv);
    analogChart.render({
      animate: true,
      xDomain: [xa, YN], yDomain: [sc.lo, sc.hi], yTicks: sc.ticks, yFmt: v => num(v, sc.dp), yUnit: '°C',
      xTicks: w => years.filter(yv => yv >= xa && yv % (w < 480 ? 20 : 10) === 0),
      xTitle: `Last year of each ${words(winLen)}-year run`,
      margin: w => ({ t: 40, r: w < 480 ? 82 : 94, b: 46, l: w < 480 ? 32 : 40 }),
      height: w => w < 480 ? 276 : 316,
      hlines: [{ y: A.target, cls: 'target', label: `${A.st.name} ${recentLabel}, ${temp2(A.target)}` }],
      series: sites.map(st => ({
        id: st.id, color: siteColor(st.id), emph: st.id === state.featured,
        smooth: years.map((yv, i) => [yv, st.win[i]]).filter(p => p[0] >= xa),
      })),
      dots: [
        ...A.list.filter(a => a.in_range).map(a => ({ x: a.window[1], y: a.gs_tmean, color: siteColor(a.site) })),
        { x: YN, y: A.target, color: siteColor(state.featured) },
      ],
      endLabels: sites.map(st => ({ id: st.id, text: st.name, color: siteColor(st.id), x: YN, y: st.win[years.length - 1], emph: st.id === state.featured })),
      onLabel: id => setFeatured(id),
      marker: analogMarker,
      markerLabel: winSpan,
      cross: sites.map(st => ({ id: st.id, color: siteColor(st.id), at: xv => st.win[yearIndex.get(xv)] })),
      tipFor: xv => {
        const i = yearIndex.get(xv);
        return h('div', { class: 'clim-tip' },
          h('div', { class: 'clim-tip-head' }, h('b', { text: winSpan(xv) }), ` mean growing-season temperature`),
          sites.map(st => h('div', { class: 'clim-tip-row' },
            h('span', { class: 'clim-linekey', style: { background: siteColor(st.id) } }),
            h('b', { class: 'num', text: temp2(st.win[i]) }), h('span', { text: ` ${st.name}` }))));
      },
      valueText: xv => `${winSpan(xv)}. ${sites.map(st => `${st.name} ${temp2(st.win[yearIndex.get(xv)])}`).join(', ')}`,
    });
  }

  /* ---------- actions ---------- */
  function setIndex(k) {
    if (!IDX[k] || k === state.index) { syncIndexControls(); return; }
    state.index = k;
    syncIndexControls();
    renderMain(); renderHeadline(); renderTable();
    announceHeadline();
  }
  function setFocus(id, announce = false) {
    if (!siteById.has(id)) return;
    state.focus = id;
    if (!state.shown.has(id)) { state.shown.add(id); syncChips(); }
    syncRadios(focusButtons, id);
    renderMain(); renderHeadline();
    if (announce) announceHeadline();
  }
  function toggleSite(id) {
    if (state.shown.has(id)) state.shown.delete(id); else state.shown.add(id);
    syncChips();
    renderMain();
  }
  function previewSite(id) {
    if (preview === id) return;
    preview = id;
    renderMain();
  }
  function setYear(yv) {
    yv = clamp(Math.round(yv), Y0, YN);
    if (yv === state.year) return;
    state.year = yv;
    renderStripesYear(); renderInspector();
    main.render(mainConfig());
  }

  // Focus the site that stands for a region chosen elsewhere in the atlas.
  const onRegion = p => {
    const region = p?.region;
    if (!region || region === 'all') return;
    const name = util.regionName(region);
    const st = sites.find(x => x.region === name);
    if (st && st.id !== state.focus) setFocus(st.id);
  };
  bus.on('region:select', onRegion);

  /* ---------- mount ---------- */
  syncIndexControls(); syncChips(); syncRadios(focusButtons, state.focus);
  mount.replaceChildren(root);
  renderStripesYear();
  if (fig3) buildAnalogTable();
  renderMain(); renderHeadline(); renderTable(); renderInspector(); renderAnalog();
  if (bus.last('region:select')) onRegion(bus.last('region:select'));

  // Redraw charts on width changes only
  const widths = new WeakMap();
  const redraw = util.debounce(entries => {
    for (const e of entries) {
      const w = Math.round(e.contentRect.width);
      if (widths.get(e.target) === w) continue;
      widths.set(e.target, w);
      if (e.target === main.el) main.render();
      else if (analogChart && e.target === analogChart.el) analogChart.render();
    }
  }, 120);
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(entries => redraw(entries));
    ro.observe(main.el);
    if (analogChart) ro.observe(analogChart.el);
    widths.set(main.el, Math.round(main.el.clientWidth));
    if (analogChart) widths.set(analogChart.el, Math.round(analogChart.el.clientWidth));
  }

  // Reveal: stripes print in and lines draw once, when the plate first comes into view.
  const reveal = (el, chart) => util.whenVisible(el, () => { el.classList.add('is-in'); chart?.markDrawn(); }, '0px 0px -12% 0px');
  if (root.classList.contains('clim--anim')) {
    reveal(fig1); reveal(fig2, main); if (fig3) reveal(fig3, analogChart);
  }
}
