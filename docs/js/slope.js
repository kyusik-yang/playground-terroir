// Plate II: slope cross-sections.
// Every number and every name drawn here is computed at runtime from data/transects.json
// (the elevation profile and the classification of each 10 m sample along a line), from
// data/index.json (full INAO names, which features the atlas map can open) and, once the
// plate comes near the screen, from the region GeoJSON (the polygons the line crosses).

const IGN_ORTHO = 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg';
const LVL = { 'grand-cru': 'gc', 'premier-cru': 'pc', village: 'vl', regional: 'rg', none: 'none' };
const LEVEL_ORDER = ['grand-cru', 'premier-cru', 'village', 'regional', 'none'];
// Height of the classification band under the axis. It follows the level, so the band
// reads in rank order without relying on colour alone.
const RIB_H = { 'grand-cru': 10, 'premier-cru': 8, village: 6, regional: 4, none: 4 };
const RIB_MAX = 10;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const LETTERS = 'ABCDEFGHIJKLMNOP';
const PRIME = '′';
const NBSP = ' ';
const MERGE_GAP_M = 20;    // an unclassified gap this short between two stretches of one name is bridged
const GRAD_HALF = 3;       // samples either side of the crosshair for the local gradient readout
const EXTREME_TOL_M = 3;   // an interior high or low this close to an end height is not called out
const SHORT_M = 50;        // a stretch shorter than this is too short to quote a gradient for

const compass = b => COMPASS[Math.round((((b % 360) + 360) % 360) / 45) % 8];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lcls = level => `sl-l-${LVL[level] || 'none'}`;
/** Keep a number and its unit together: "2,543 m" never breaks. */
const nb = str => String(str).replace(/(\d) m\b/g, `$1${NBSP}m`);

/** "Meursault premier cru Perrières" -> { short: "Perrières", app: "Meursault" } */
function parseName(name, level) {
  const m = /^(.*?) premier cru(?: (.+))?$/.exec(name || '');
  if (level === 'premier-cru' && m) return { short: m[2] || '', app: m[1] };
  return { short: name || '', app: '' };
}

/** Consecutive segments of one name become one part. A short unclassified gap between two
 *  stretches of the same name is absorbed so the part stays contiguous. `len` counts only the
 *  classified ground, `gap` the bridged ground outside any AOC. */
function mergeParts(segs) {
  const parts = [];
  const open = sg => ({ level: sg.level, name: sg.name, short: sg.short, app: sg.app, feature: sg.feature,
    d0: sg.d0, d1: sg.d1, zmin: sg.zlo, zmax: sg.zhi, segs: [sg.k], len: sg.d1 - sg.d0, gap: 0, ns: sg.ns });
  const grow = (p, sg) => {
    p.segs.push(sg.k); p.d1 = sg.d1;
    if (sg.level === 'none' && p.level !== 'none') p.gap += sg.d1 - sg.d0;
    else { p.len += sg.d1 - sg.d0; p.ns += sg.ns; p.zmin = Math.min(p.zmin, sg.zlo); p.zmax = Math.max(p.zmax, sg.zhi); }
  };
  const same = (a, b) => a && b && a.name && a.name === b.name && a.level === b.level;
  for (let k = 0; k < segs.length; k++) {
    const sg = segs[k];
    const last = parts[parts.length - 1];
    if (last && sg.level !== 'none' && same(last, sg)) { grow(last, sg); continue; }
    const next = segs[k + 1];
    if (last && sg.level === 'none' && sg.d1 - sg.d0 <= MERGE_GAP_M && same(last, next)) {
      grow(last, sg); grow(last, next); k++; continue;
    }
    parts.push(open(sg));
  }
  parts.forEach((p, i) => {
    p.index = i;
    p.labelable = (p.level === 'grand-cru' || p.level === 'premier-cru') && !!p.short;
  });
  return parts;
}

/** Significant turning points of a profile (a zigzag filter): indices of the start, every
 *  high or low that the ground leaves again by at least T metres, and the end. */
function turningPoints(z, T) {
  const piv = [0];
  let dir = 0, ext = 0, hi = 0, lo = 0;
  for (let i = 1; i < z.length; i++) {
    if (dir === 0) {
      if (z[i] > z[hi]) hi = i;
      if (z[i] < z[lo]) lo = i;
      if (z[hi] - z[0] >= T) { dir = 1; ext = hi; } else if (z[0] - z[lo] >= T) { dir = -1; ext = lo; }
      continue;
    }
    if (dir === 1) {
      if (z[i] > z[ext]) ext = i;
      else if (z[ext] - z[i] >= T) { piv.push(ext); dir = -1; ext = i; }
    } else if (z[i] < z[ext]) ext = i;
    else if (z[i] - z[ext] >= T) { piv.push(ext); dir = 1; ext = i; }
  }
  piv.push(z.length - 1);
  return piv;
}

/** Whole-number shares that add up to 100 (largest remainder). */
function roundShares(share) {
  const keys = LEVEL_ORDER.filter(k => share[k] > 0);
  const raw = keys.map(k => share[k] * 100);
  const out = raw.map(Math.floor);
  const rest = 100 - out.reduce((a, b) => a + b, 0);
  raw.map((v, i) => [v - out[i], i]).sort((a, b) => b[0] - a[0]).slice(0, Math.max(0, rest)).forEach(([, i]) => { out[i]++; });
  return Object.fromEntries(keys.map((k, i) => [k, { pct: out[i], raw: raw[i] }]));
}

function prepare(t, index) {
  const step = t.step_m || 10;
  const z = t.z;
  const n = z.length;
  // Distances run from the first end to the line's stated length. Each sample stands for the
  // 10 m of line centred on it, so a stretch reaches 5 m either side of its first and last sample.
  const D = Math.max((n - 1) * step, Number(t.length_m) || 0);
  let zmin = Infinity, zmax = -Infinity, imin = 0, imax = 0;
  for (let i = 0; i < n; i++) {
    if (z[i] < zmin) { zmin = z[i]; imin = i; }
    if (z[i] > zmax) { zmax = z[i]; imax = i; }
  }
  const segs = (t.segments || []).map((sg, k) => {
    const level = LVL[sg.level] ? sg.level : 'none';
    const { short, app } = parseName(sg.name, level);
    const zr = Array.isArray(sg.z) ? sg.z : [z[Math.round(sg.from / step)], z[Math.round(sg.to / step)]];
    return {
      k, level, name: sg.name || '', short, app, feature: sg.feature || '', from: sg.from, to: sg.to,
      d0: clamp(sg.from - step / 2, 0, D), d1: clamp(sg.to + step / 2, 0, D), zlo: zr[0], zhi: zr[1],
      ns: Math.round((sg.to - sg.from) / step) + 1,
    };
  });
  const sampleSeg = new Int16Array(n).fill(-1);
  for (const sg of segs) {
    for (let i = Math.round(sg.from / step); i <= Math.round(sg.to / step); i++) if (i >= 0 && i < n) sampleSeg[i] = sg.k;
  }
  const parts = mergeParts(segs);
  const segPart = new Int16Array(segs.length).fill(-1);
  parts.forEach(p => p.segs.forEach(k => { segPart[k] = p.index; }));
  const share = {};
  for (const sg of segs) share[sg.level] = (share[sg.level] || 0) + (sg.d1 - sg.d0);
  for (const key of Object.keys(share)) share[key] /= D || 1;
  const piv = turningPoints(z, Math.max(15, 0.2 * (zmax - zmin)));
  return {
    t, id: t.id, letter: LETTERS[index] || String(index + 1), step, z, n, D, zmin, zmax, imin, imax,
    segs, parts, sampleSeg, segPart, share, shares: roundShares(share), piv,
    down: compass(t.bearing_downslope), up: compass(t.bearing_downslope + 180),
  };
}

const zAt = (M, d) => {
  const f = clamp(d / M.step, 0, M.n - 1);
  const i = Math.floor(f);
  return i >= M.n - 1 ? M.z[M.n - 1] : M.z[i] + (M.z[i + 1] - M.z[i]) * (f - i);
};
const latlngAt = (M, d) => {
  const f = clamp(d / (M.t.length_m || M.D || 1), 0, 1);
  return [M.t.start[0] + (M.t.end[0] - M.t.start[0]) * f, M.t.start[1] + (M.t.end[1] - M.t.start[1]) * f];
};

const NICE = [];
for (let e = -1; e <= 5; e++) for (const c of [1, 2, 2.5, 5]) NICE.push(c * 10 ** e);
function niceStep(range, count) {
  const raw = range / Math.max(1, count);
  return NICE.find(c => c >= raw) || NICE[NICE.length - 1];
}
const multiplesIn = (a, b, st) => {
  const out = [];
  for (let v = Math.ceil(a / st - 1e-9) * st; v <= b + 1e-9; v += st) out.push(Math.round(v * 1000) / 1000 + 0); // + 0 turns -0 into 0
  return out;
};

/* ---------- Label placement: near the ground, leader lines, no overlaps ----------
   Every label gets candidate boxes above the ground (preferred) and below it, inside the
   ground wash. Candidates cost their leader length, plus a penalty when the label sits over
   ground that is not its own. In strict mode a label must sit mostly over its own stretch.
   A box is kept only if it clears the ground, every other label (with a gap wide enough that
   two labels never read as one), every leader line and the obstacles. */
const hitBox = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const inflate = (r, dx, dy) => ({ x0: r.x0 - dx, x1: r.x1 + dx, y0: r.y0 - dy, y1: r.y1 + dy });
/** Compare two score keys element by element. */
const cmpKey = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
function placeLabels(groups, env, rects, leaders, { aligns, strict, obstacles, gapX = 8, gapY = 6 }) {
  const PAD = 3, CLEAR = 9, STEP = 4;
  const placed = [];
  const failed = [];
  for (const g of groups) {
    const cands = [];
    const c0 = g.anchors[0];
    for (const sh of g.shapes) {
      for (const ax of g.anchors) {
        for (const align of aligns) {
          let x0 = align === 'middle' ? ax - sh.w / 2 : align === 'start' ? ax - 6 : ax + 6 - sh.w;
          x0 = clamp(x0, 0, Math.max(0, env.W - sh.w));
          const x1 = x0 + sh.w;
          if (ax < x0 + 1 || ax > x1 - 1) continue;
          const as = env.assoc(g, x0, x1);
          if (strict && as.own < Math.min(0.4, as.target * 0.6) - 1e-6) continue;
          // Inside the ground a label reads as naming the wash around it, so it must sit
          // more squarely over its own stretch there.
          const belowOK = !strict || as.own >= Math.min(0.55, as.target * 0.8) - 1e-6;
          const foot = env.yAt(ax);
          const top = env.topBetween(x0 - PAD, x1 + PAD), bot = env.bottomBetween(x0 - PAD, x1 + PAD);
          const bias = Math.abs(ax - c0) * 0.25 + (align === aligns[0] ? 0 : 3) + (sh.extra || 0)
            + (1 - Math.min(1, as.own / as.target)) * 60 + as.foreign * 70;
          for (let k = 0; k <= 90; k++) {
            const y1 = top - CLEAR - k * STEP;
            cands.push({ x0, x1, y0: y1 - sh.h, y1, ax, foot, sh, below: false, cost: foot - y1 + bias });
          }
          if (!belowOK) continue;
          for (let k = 0; k <= 60; k++) {
            const y0 = bot + CLEAR + 2 + k * STEP;
            if (y0 + sh.h > env.H - 8) break;
            cands.push({ x0, x1, y0, y1: y0 + sh.h, ax, foot, sh, below: true, cost: y0 - foot + bias + 18 + as.foreign * 50 });
          }
        }
      }
    }
    cands.sort((a, b) => a.cost - b.cost);
    let found = null;
    for (const c of cands) {
      const r = { x0: c.x0 - PAD, x1: c.x1 + PAD, y0: c.y0 - PAD, y1: c.y1 + PAD };
      const rg = inflate(r, gapX, gapY);
      if (rects.some(o => hitBox(o, rg)) || leaders.some(o => hitBox(o, r)) || obstacles.some(o => hitBox(o, r))) continue;
      const L = c.below ? { x0: c.ax - 1.5, x1: c.ax + 1.5, y0: c.foot, y1: c.y0 } : { x0: c.ax - 1.5, x1: c.ax + 1.5, y0: c.y1, y1: c.foot };
      if (rects.some(o => hitBox(o, L)) || obstacles.some(o => hitBox(o, L))) continue;
      found = { ...c, g, r, L, strict };
      break;
    }
    if (!found) { failed.push(g); continue; }
    rects.push(found.r); leaders.push(found.L); placed.push(found);
  }
  return { placed, failed };
}

export async function init(mount, ctx) {
  const { bus, data, util } = ctx;
  const { h, s, fmt, LEVELS } = util;

  const tr = await data.transects();
  const list = (tr.transects || []).map(prepare);
  if (!list.length) throw new Error('transects.json lists no transects');
  const meta = tr.meta || {};

  const G = {
    D: Math.max(...list.map(M => M.D)),
    zmin: Math.min(...list.map(M => M.zmin)) - 8,
    zmax: Math.max(...list.map(M => M.zmax)) + 4,
  };

  const levelLabel = lv => (LEVELS[lv] || LEVELS.none).label;
  const signedM = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt.m(Math.abs(v))}`;
  const partTitle = p => p.level === 'none' ? levelLabel('none') : (p.short || p.name || levelLabel(p.level));
  const elevText = (a, b) => Math.round(a) === Math.round(b) ? fmt.m(a) : fmt.mRange(a, b);
  const pctText = f => f > 0 && f < 0.005 ? '<1%' : fmt.pct(f * 100);
  const endAdj = c => `${util.aspectWord(c)}ern`; // "northwest" -> "northwestern"
  const reduce = () => util.reducedMotion();
  const motionOK = !reduce() && 'IntersectionObserver' in window;

  const state = {
    cur: 0, sel: null, ve: 'fit',
    cross: null, crossSrc: null,
    hotPart: null, hotFeature: null,
    layout: null, index: null, extraNotes: [], wantRegion: false,
  };
  const cur = () => list[state.cur];
  const regionInfo = new Map(); // region id -> Map(feature id -> properties)

  /** The INAO denomination for a feature, from index.json or the region file, else the transect's name. */
  const fullOf = (feature, fallback) => (feature && (state.index?.get(feature)?.full
    || [...regionInfo.values()].find(m => m.has(feature))?.get(feature)?.full)) || fallback || '';
  const partFull = p => p.level === 'none' ? levelLabel('none') : fullOf(p.feature, p.name) || partTitle(p);

  /* ---------- Static frame ---------- */
  const root = h('div', { class: 'sl' });

  // Hatch patterns shared by the chart, the legend and the table. Kept in a persistent,
  // zero-size SVG so they survive every redraw.
  const defs = s('svg', { class: 'sl-defs', width: 0, height: 0, 'aria-hidden': 'true', focusable: 'false' },
    s('defs', {},
      s('pattern', { id: 'sl-hatch', patternUnits: 'userSpaceOnUse', width: 6, height: 6, patternTransform: 'rotate(45)' },
        s('rect', { class: 'sl-hatch-bg', width: 6, height: 6 }),
        s('line', { class: 'sl-hatch-ln', x1: 0, y1: 0, x2: 0, y2: 6 })),
      s('pattern', { id: 'sl-hatch-fine', patternUnits: 'userSpaceOnUse', width: 3, height: 3, patternTransform: 'rotate(45)' },
        s('rect', { class: 'sl-hatch-bg', width: 3, height: 3 }),
        s('line', { class: 'sl-hatch-ln', x1: 0, y1: 0, x2: 0, y2: 3 }))));

  /** A small key: a piece of the classification band, as tall as the level's band. */
  const swatch = level => s('svg', { class: `sl-sw ${lcls(level)}`, width: 14, height: RIB_MAX, viewBox: `0 0 14 ${RIB_MAX}`, 'aria-hidden': 'true', focusable: 'false' },
    s('rect', { class: `sl-sw-r ${lcls(level)}`, x: 0.5, y: 0.5, width: 13, height: RIB_H[level] - 1 }));

  // Transect selector: small multiples drawn on one shared scale.
  const tablist = h('div', { class: 'sl-tabs', attrs: { role: 'tablist', 'aria-label': 'Cross-sections' } });
  const tabs = list.map((M, i) => h('button', {
    class: 'sl-tab', type: 'button',
    attrs: { role: 'tab', id: `sl-tab-${M.id}`, 'aria-selected': 'false', 'aria-controls': 'sl-panel', tabindex: '-1' },
    on: { click: () => select(i, { writeUrl: true }) },
  },
  h('span', { class: 'sl-tab-no' },
    h('span', { class: 'sl-tab-letter' }, h('span', { class: 'visually-hidden', text: 'Section ' }), M.letter),
    h('span', { class: 'sl-tab-region', text: util.regionName(M.t.region) })),
  h('span', { class: 'sl-tab-title', text: M.t.title }),
  sparkline(M),
  h('span', { class: 'sl-tab-meta', attrs: { 'aria-hidden': 'true' }, text: nb(`${fmt.m(M.t.length_m || M.D)} · ${fmt.mRange(M.zmin, M.zmax)}`) })));
  tablist.append(...tabs);
  tablist.style.setProperty('--n', String(list.length));
  // When the strip scrolls sideways (narrow screens), its edges fade where more cards wait.
  const tabCue = () => {
    const max = tablist.scrollWidth - tablist.clientWidth;
    tablist.classList.toggle('can-l', max > 1 && tablist.scrollLeft > 2);
    tablist.classList.toggle('can-r', max > 1 && tablist.scrollLeft < max - 2);
  };
  tablist.addEventListener('scroll', tabCue, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(util.debounce(tabCue, 100)).observe(tablist);
  else addEventListener('resize', util.debounce(tabCue, 100));
  tablist.addEventListener('keydown', e => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    let j = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = tabs.length - 1;
    if (j == null) return;
    e.preventDefault();
    select(j, { writeUrl: true });
    tabs[j].focus();
  });

  const panel = h('div', { class: 'sl-panel', attrs: { role: 'tabpanel', id: 'sl-panel' } });

  // Head, the shared figure heading. Each section is a figure of Plate II, A to E as Fig. II.1 to II.5.
  const headNo = h('p', { class: 'fig-no', attrs: { id: 'sl-figno' } });
  const headTitle = h('h3', { class: 'sl-title', attrs: { id: 'sl-title' } });
  const headMeta = h('p', { class: 'sl-meta' });
  const showBtn = h('button', {
    class: 'btn btn-ghost btn-sm', type: 'button',
    on: { click: () => bus.emit('transect:show', { id: cur().id, source: 'slope' }) },
  }, mapGlyph(), 'Show on the atlas map');
  const veVal = h('span', { class: 'sl-ve-val' });
  const veBtns = [['fit', 'Fitted'], ['true', 'True scale']].map(([v, label]) => h('button', {
    type: 'button', text: label,
    attrs: { role: 'radio', 'aria-checked': String(state.ve === v), tabindex: state.ve === v ? '0' : '-1', 'data-ve': v },
    on: { click: () => setVE(v) },
  }));
  const veGroup = h('div', { class: 'seg sl-ve-seg', attrs: { role: 'radiogroup', 'aria-label': 'Vertical scale' } }, ...veBtns);
  veGroup.addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const next = state.ve === 'fit' ? 'true' : 'fit';
    setVE(next);
    veBtns.find(b => b.dataset.ve === next).focus();
  });
  const head = h('div', { class: 'fig-head sl-head' },
    headNo,
    h('div', { class: 'sl-head-text' }, headTitle, headMeta),
    h('div', { class: 'sl-head-ctrl' }, h('div', { class: 'sl-ve' }, veVal, veGroup), showBtn));

  // Chart
  const legend = h('ul', { class: 'sl-legend', attrs: { 'aria-label': 'Classification, with its share of the line' } });
  const toolbar = h('div', { class: 'sl-toolbar' }, legend);
  const kbtip = h('div', { class: 'tip sl-kbtip', attrs: { 'aria-hidden': 'true' } });
  const plot = h('div', {
    class: 'sl-plot',
    attrs: {
      tabindex: '0', role: 'slider', 'aria-valuemin': '0', 'aria-orientation': 'horizontal',
      'aria-describedby': 'sl-hint',
    },
  });
  // Until the plot scrolls into view it waits, hidden, so the entrance never flashes.
  if (motionOK) plot.classList.add('is-pending');
  const hint = h('p', {
    class: 'sl-hint', attrs: { id: 'sl-hint' },
    text: 'Hover or drag across the section to read it, and click a stretch to select it. With the keyboard, focus the section and use the arrow keys. Up and down jump between stretches. Enter selects. The band under the axis repeats the classification, taller for higher levels.',
  });
  const chartBox = h('div', { class: 'sl-chart', attrs: { role: 'figure', 'aria-labelledby': 'sl-figno sl-title', 'aria-describedby': 'sl-caption' } }, toolbar, plot, hint);

  // Selected stretch. The frame persists, so focus stays on the arrows while stepping.
  const selBadge = h('span', { class: 'badge' });
  const selCount = h('span', { class: 'sl-sel-count num' });
  const navBtn = (dir, glyph) => h('button', {
    class: 'sl-navbtn', type: 'button',
    on: { click: () => stepPart(dir) },
  }, s('svg', { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'aria-hidden': 'true', focusable: 'false' }, s('path', { d: glyph })));
  const prevBtn = navBtn(-1, 'M10 3L5 8l5 5');
  const nextBtn = navBtn(1, 'M6 3l5 5-5 5');
  const selName = h('h4', { class: 'sl-sel-name' });
  const selFull = h('p', { class: 'sl-sel-full' });
  const selFacts = h('dl', { class: 'facts sl-sel-facts' });
  const selAction = h('div', { class: 'sl-sel-action' });
  const selLive = h('p', { class: 'visually-hidden', attrs: { 'aria-live': 'polite' } });
  const sel = h('section', { class: 'sl-sel panel', attrs: { 'aria-label': 'Selected stretch' } },
    h('div', { class: 'sl-sel-top' }, selBadge, h('div', { class: 'sl-sel-nav' }, selCount, prevBtn, nextBtn)),
    selName, selFull, selFacts, selAction, selLive);

  // Locator map
  const mapEl = h('div', { class: 'sl-minimap', attrs: { role: 'region', 'aria-label': 'Locator map' } },
    h('p', { class: 'sl-map-loading', text: 'Loading the locator map…' }));
  const mapTag = h('p', { class: 'sl-map-tag', attrs: { 'aria-hidden': 'true' }, text: 'Locator · IGN aerial photography' });
  const mapBox = h('div', { class: 'sl-mapbox' }, mapEl, mapTag);

  // Caption, facts, table, notes
  const caption = h('p', { class: 'sl-caption', attrs: { id: 'sl-caption' } });
  const facts = h('dl', { class: 'facts sl-facts' });
  const tableWrap = h('div', { class: 'sl-table-wrap visually-hidden', attrs: { id: 'sl-table' } });
  const tableBtn = h('button', {
    class: 'disclosure-btn sl-table-btn', type: 'button', text: 'Show the segment table',
    attrs: { 'aria-expanded': 'false', 'aria-controls': 'sl-table' },
    on: {
      click: () => {
        const open = tableBtn.getAttribute('aria-expanded') !== 'true';
        tableBtn.setAttribute('aria-expanded', String(open));
        tableBtn.textContent = open ? 'Hide the segment table' : 'Show the segment table';
        tableWrap.classList.toggle('visually-hidden', !open);
        tableScroll();
      },
    },
  });
  // When the open table is wider than the column it scrolls sideways, so it becomes a
  // focusable, named region that the keyboard can scroll.
  function tableScroll() {
    const open = !tableWrap.classList.contains('visually-hidden');
    const scrolls = open && tableWrap.scrollWidth > tableWrap.clientWidth + 1;
    if (scrolls) { tableWrap.setAttribute('tabindex', '0'); tableWrap.setAttribute('role', 'region'); tableWrap.setAttribute('aria-label', 'Segment table, scrolls sideways'); }
    else { tableWrap.removeAttribute('tabindex'); tableWrap.removeAttribute('role'); tableWrap.removeAttribute('aria-label'); }
  }
  const notes = h('div', { class: 'sl-notes' });
  const capBox = h('div', { class: 'sl-cap' }, caption, facts, tableBtn, tableWrap, notes);

  // DOM order follows the reading order: chart, then the locator and the panel beside it, then the text.
  const body = h('div', { class: 'sl-body' }, chartBox, mapBox, sel, capBox);
  panel.append(head, body);
  root.append(defs, tablist, panel);
  mount.replaceChildren(root);

  /* ---------- Small multiples in the tabs ---------- */
  function sparkline(M) {
    const VW = 240, VH = 48;
    const x = d => d / G.D * VW;
    const y = z => VH - (z - G.zmin) / (G.zmax - G.zmin) * VH;
    const svg = s('svg', { class: 'sl-spark', viewBox: `0 0 ${VW} ${VH}`, preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
    const top = (d0, d1) => {
      const pts = [[d0, zAt(M, d0)]];
      for (let i = Math.ceil(d0 / M.step); i * M.step < d1 && i < M.n; i++) if (i * M.step > d0) pts.push([i * M.step, M.z[i]]);
      pts.push([d1, zAt(M, d1)]);
      return pts.map(([d, z]) => `${x(d).toFixed(2)},${y(z).toFixed(2)}`);
    };
    for (const sg of M.segs) {
      if (sg.d1 <= sg.d0) continue;
      svg.append(s('path', { class: `sl-sp-fill ${lcls(sg.level)}`, d: `M${top(sg.d0, sg.d1).join('L')}L${x(sg.d1).toFixed(2)},${VH}L${x(sg.d0).toFixed(2)},${VH}Z` }));
    }
    svg.append(s('path', { class: 'sl-sp-line', d: `M${top(0, M.D).join('L')}` }));
    svg.append(s('line', { class: 'sl-sp-base', x1: 0, x2: VW, y1: VH - 0.5, y2: VH - 0.5 }));
    return svg;
  }

  function mapGlyph() {
    return s('svg', { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'aria-hidden': 'true', focusable: 'false' },
      s('path', { d: 'M1.5 3.5l4-1.5 5 2 4-1.5v10l-4 1.5-5-2-4 1.5z' }), s('path', { d: 'M5.5 2v10M10.5 4v10' }));
  }

  /* ---------- Selection of a transect ---------- */
  function select(i, { writeUrl = false } = {}) {
    if (writeUrl) util.setParam('transect', list[i].id);
    if (i === state.cur && panel.dataset.ready) return;
    state.cur = i;
    const M = cur();
    tabs.forEach((t, j) => {
      t.setAttribute('aria-selected', String(j === i));
      t.setAttribute('tabindex', j === i ? '0' : '-1');
    });
    panel.setAttribute('aria-labelledby', tabs[i].id);
    panel.dataset.ready = '1';
    revealTab(i);
    state.sel = defaultPart(M);
    state.cross = null; state.crossSrc = null; state.hotPart = null; state.hotFeature = null;
    state.extraNotes = regionInfo.has(M.t.region) ? extraNotes(M, regionInfo.get(M.t.region)) : [];
    util.tip.hide();
    renderStatic();
    renderChart({ wipe: panel.dataset.shown === '1' });
    renderSel();
    drawMini();
    loadRegionInfo();
  }

  // On narrow screens the strip scrolls sideways. A selected tab that is not fully in view is
  // brought to the start, which is also where the strip snaps. The start sits just past the
  // edge fade (the strip's scroll padding), so the tab itself is never faded.
  function revealTab(i) {
    if (tablist.scrollWidth <= tablist.clientWidth + 1) return;
    const t = tabs[i];
    const pad = parseFloat(getComputedStyle(tablist).scrollPaddingLeft) || 0;
    const sl = tablist.scrollLeft, max = tablist.scrollWidth - tablist.clientWidth;
    const left = sl + (sl > 2 ? pad : 0), right = sl + tablist.clientWidth - (sl < max - 2 ? pad : 0);
    const visible = t.offsetLeft >= left - 1 && t.offsetLeft + t.offsetWidth <= right + 1;
    if (!visible) tablist.scrollTo({ left: Math.max(0, t.offsetLeft - pad), behavior: reduce() ? 'auto' : 'smooth' });
  }

  function defaultPart(M) {
    const want = (M.t.anchors || [])[0];
    const named = M.parts.filter(p => p.labelable);
    return (named.find(p => p.short === want || p.name === want)
      || named.find(p => p.level === 'grand-cru')
      || named[0]
      || M.parts.find(p => p.level !== 'none')
      || M.parts[0]).index;
  }

  // Stretches the panel arrows and the Up and Down keys step through. Single-sample slivers
  // (10 m) stay on the chart and in the table but are not stops.
  const navParts = M => {
    const nav = M.parts.filter(p => p.level !== 'none' && (p.ns >= 2 || p.labelable));
    return nav.length ? nav : M.parts;
  };

  /* ---------- Text that depends only on the transect ---------- */
  function renderStatic() {
    const M = cur();
    const t = M.t;
    headNo.textContent = `Fig. II.${state.cur + 1} · Section ${M.letter} · ${util.regionName(t.region)}`;
    headTitle.textContent = t.title;
    headMeta.textContent = `Drawn from ${M.letter} at the ${util.aspectWord(M.up)} end, on the left, to ${M.letter}${PRIME} at the ${util.aspectWord(M.down)} end.`;
    plot.setAttribute('aria-label', `Section ${M.letter}, position along the line`);
    plot.setAttribute('aria-valuemax', String(Math.round(M.D)));

    // Legend with each level's share of the line
    legend.replaceChildren(...LEVEL_ORDER.filter(lv => M.shares[lv]).map(lv => h('li', {},
      swatch(lv),
      h('span', { text: levelLabel(lv) }),
      h('span', { class: 'sl-share', text: M.shares[lv].pct === 0 ? '<1%' : fmt.pct(M.shares[lv].pct) }))));

    // Transect facts
    const z0 = M.z[0], z1 = M.z[M.n - 1];
    const net = z0 - z1;
    const where = i => i === 0 ? `at ${M.letter}` : i === M.n - 1 ? `at ${M.letter}${PRIME}` : `${fmt.m(i * M.step)} from ${M.letter}`;
    const item = (k, v, sub) => h('div', {}, h('dt', { text: k }), h('dd', {}, nb(v), sub ? h('span', { class: 'sl-dd-sub', text: nb(sub) }) : null));
    facts.replaceChildren(
      item('Length', fmt.m(t.length_m || M.D)),
      item(`Height at ${M.letter}`, fmt.m(z0)),
      item(`Height at ${M.letter}${PRIME}`, fmt.m(z1)),
      item('Highest point', fmt.m(M.zmax), where(M.imax)),
      item('Lowest point', fmt.m(M.zmin), where(M.imin)),
      item(Math.round(net) < 0 ? 'Net rise' : 'Net fall', fmt.m(Math.abs(net)), `${M.letter} to ${M.letter}${PRIME}`),
      item('Net gradient', fmt.pct(Math.abs(net) / M.D * 100)),
      item(`Bearing, ${M.letter} to ${M.letter}${PRIME}`, `${fmt.num(t.bearing_downslope)}° ${M.down}`),
      item('Samples', `${fmt.num(M.n)}, every ${fmt.m(M.step)}`));

    renderTable();
    renderNotes();
  }

  function renderTable() {
    const M = cur();
    const th = (t, cls) => h('th', { attrs: { scope: 'col' }, class: cls, text: t });
    const rows = M.segs.map(sg => h('tr', {},
      h('td', { class: 'num', text: `${fmt.num(sg.d0)}–${fmt.num(sg.d1)}` }),
      h('td', { class: 'sl-td-lvl' }, swatch(sg.level), ` ${levelLabel(sg.level)}`),
      h('td', { text: sg.level === 'none' ? '' : fullOf(sg.feature, sg.name) }),
      h('td', { class: 'num', text: Math.round(sg.zlo) === Math.round(sg.zhi) ? fmt.num(sg.zlo) : `${fmt.num(sg.zlo)}–${fmt.num(sg.zhi)}` })));
    tableWrap.replaceChildren(h('table', { class: 'sl-table' },
      h('caption', { text: `Section ${M.letter}, every stretch of one classification and name, from ${M.letter} at the ${util.aspectWord(M.up)} end to ${M.letter}${PRIME} at the ${util.aspectWord(M.down)} end. Distances are metres from ${M.letter}.` }),
      h('thead', {}, h('tr', {}, th('Along the line (m)', 'num'), th('Classification'), th('INAO name'), th('Elevation (m)', 'num'))),
      h('tbody', {}, rows)));
    tableScroll();
  }

  function renderNotes() {
    const M = cur();
    const items = [];
    const unnamed = M.segs.filter(sg => sg.level === 'premier-cru' && !sg.short);
    if (unnamed.length) {
      const len = unnamed.reduce((a, sg) => a + sg.d1 - sg.d0, 0);
      items.push(`${fmt.m(len)} of premier cru ground on this line carries no climat name in the INAO data.`);
    }
    items.push(...state.extraNotes);
    items.push('INAO’s digital delimitation does not yet name every climat. Several climat names nest, and some ground carries two names.');
    // The method from transects.json, with its last item spelled out in a sentence of its own.
    const steps = String(meta.method || '').split(/,\s*/).filter(x => x && !/highest containing classification/i.test(x));
    // meta.method describes the two-anchor lines. A line with a single anchor (both anchors
    // the same shape) runs through it along that shape's mean downslope bearing instead.
    const [a0, a1] = M.t.anchors || [];
    if (a0 && a0 === a1 && M.t.bearing_downslope != null && /^straight line through two anchor/i.test(steps[0] || '')) {
      steps[0] = `straight line through ${a0} along its mean downslope bearing of ${fmt.num(M.t.bearing_downslope)}°`;
    }
    const method = steps.length ? `${steps.join(', ').replace(/^./, c => c.toUpperCase())}. ` : '';
    notes.replaceChildren(
      ...items.map(t => h('p', { class: 'caveat', text: nb(t) })),
      h('p', { class: 'caveat sl-method' },
        h('span', { class: 'eyebrow', text: 'Method' }), ' ',
        `${method}Where boundaries overlap, a sample takes the highest classification that contains it. Each sample stands for the ${fmt.m(M.step)} of line centred on it, and distances are measured from the first end, ${M.letter}.${meta.dem ? ` Elevation from ${meta.dem}.` : ''}${meta.classification ? ` Classification from ${meta.classification}.` : ''}`));
  }

  /** Notes that come from the feature properties (documented in data/README.md). */
  function extraNotes(M, byId) {
    const out = [];
    const ids = [...new Set(M.segs.map(sg => sg.feature).filter(Boolean))];
    for (const id of ids) {
      const pr = byId.get(id);
      if (!pr) continue;
      if (Array.isArray(pr.contains) && pr.contains.length) out.push(`${pr.contains.join(' and ')} lies inside ${pr.name} and is not drawn as a separate shape.`);
      if (pr.display_note === 'petit-chablis-exclusive') out.push(`The ${pr.name} shape shows land entitled to ${pr.name} but not to Chablis.`);
    }
    return out;
  }

  // The region file is large, so it is fetched only once the plate comes near the screen.
  // The notes and the locator map both read it from the shared cache.
  async function loadRegionInfo() {
    if (!state.wantRegion) return;
    const M = cur();
    let byId = regionInfo.get(M.t.region);
    if (!byId) {
      let fc;
      try { fc = await data.region(M.t.region); } catch (err) { console.error('[slope] region data', err); return; }
      byId = new Map((fc.features || []).map(f => [f.properties.id, f.properties]));
      regionInfo.set(M.t.region, byId);
    }
    if (cur() !== M) return;
    const extra = extraNotes(M, byId);
    if (extra.join('|') !== state.extraNotes.join('|')) { state.extraNotes = extra; renderNotes(); }
    renderSel();
  }

  function captionText(M, ve) {
    const t = M.t;
    const z0 = M.z[0], z1 = M.z[M.n - 1];
    const L = M.letter;
    const out = [];
    const listJoin = arr => arr.length < 2 ? arr.join('') : `${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`;
    const len = fmt.m(t.length_m || M.D);
    // The shape of the ground, from the significant turning points of the profile.
    if (M.piv.length <= 2) {
      const net = z0 - z1;
      const way = Math.round(net) === 0 ? 'across' : net > 0 ? 'down' : 'up';
      const netText = Math.round(net) === 0 ? ', ending level with its start' : `, a net ${net > 0 ? 'fall' : 'rise'} of ${fmt.m(Math.abs(net))}`;
      out.push(`Section ${L} runs ${len} from ${fmt.m(z0)} at its ${endAdj(M.up)} end ${way} to ${fmt.m(z1)} at its ${endAdj(M.down)} end${netText}.`);
    } else {
      out.push(`Section ${L} runs ${len} from ${fmt.m(z0)} at its ${endAdj(M.up)} end.`);
      const seen = new Set();
      const moves = M.piv.slice(1).map((idx, k) => {
        const verb = M.z[idx] < M.z[M.piv[k]] ? 'falls' : 'climbs';
        const again = seen.has(verb) ? ' again' : '';
        seen.add(verb);
        const where = idx === M.n - 1 ? ` at its ${endAdj(M.down)} end` : `, ${fmt.m(idx * M.step)} from ${L}`;
        return `${verb}${again} to ${fmt.m(M.z[idx])}${where}`;
      });
      out.push(`The ground ${moves.join(', then ')}.`);
    }
    const piv = new Set(M.piv);
    const called = (i, zv) => i !== 0 && i !== M.n - 1 && !piv.has(i) && Math.min(Math.abs(zv - z0), Math.abs(zv - z1)) >= EXTREME_TOL_M;
    if (called(M.imax, M.zmax) && M.zmax > Math.max(z0, z1)) out.push(`The highest ground on the line, ${fmt.m(M.zmax)}, lies ${fmt.m(M.imax * M.step)} from ${L}.`);
    if (called(M.imin, M.zmin) && M.zmin < Math.min(z0, z1)) out.push(`The lowest ground on the line, ${fmt.m(M.zmin)}, lies ${fmt.m(M.imin * M.step)} from ${L}.`);

    const named = M.parts.filter(p => p.labelable);
    if (named.length) {
      const runs = [];
      for (const p of named) {
        const last = runs[runs.length - 1];
        if (last && last.level === p.level && last.app === p.app) last.items.push(p); else runs.push({ level: p.level, app: p.app, items: [p] });
      }
      const seen = new Set();
      const text = runs.map(r => {
        const names = r.items.map(p => {
          const again = seen.has(p.name) ? ' again' : '';
          seen.add(p.name);
          return `${p.short}${again} (${elevText(p.zmin, p.zmax)})`;
        });
        const many = r.items.length > 1;
        // English plurals, as on every other plate: "grand crus", "premier cru climats".
        const kind = r.level === 'grand-cru' ? (many ? 'grand crus' : 'grand cru') : `${r.app} ${many ? 'premier cru climats' : 'premier cru'}`;
        return `the ${kind} ${listJoin(names)}`;
      });
      out.push(`In order, it crosses ${text.join(', then ')}.`);
    } else {
      out.push('It crosses no named grand cru or premier cru.');
    }
    const shares = LEVEL_ORDER.filter(lv => M.shares[lv]).map(lv => {
      const v = M.shares[lv].pct === 0 ? 'less than 1%' : fmt.pct(M.shares[lv].pct);
      return `${v} ${lv === 'none' ? 'lies outside any AOC' : `is ${lv === 'regional' ? 'regional Bourgogne' : levelLabel(lv).toLowerCase()}`}`;
    });
    out.push(`Of its length, ${listJoin(shares)}.`);
    const gc = M.parts.filter(p => p.level === 'grand-cru');
    if (gc.length) {
      const lo = Math.min(...gc.map(p => p.zmin)), hi = Math.max(...gc.map(p => p.zmax));
      out.push(`All grand cru ground on this line lies at ${fmt.mRange(lo, hi)}, on a line that spans ${fmt.mRange(M.zmin, M.zmax)}.`);
    }
    out.push(ve === 1 ? 'The drawing is at true scale, with no vertical exaggeration.' : `The drawing exaggerates the vertical scale ${fmt.num(ve, ve < 10 ? 1 : 0)} times.`);
    // Keep "247–252 m" and "2,543 m" on one line when the caption wraps.
    return nb(out.join(' ').replace(/(\d)–(\d)/g, '$1–⁠$2'));
  }

  /* ---------- The profile chart ---------- */
  const mctx = document.createElement('canvas').getContext('2d');
  const displayFont = () => util.cssVar('--font-display') || 'Cormorant, Garamond, serif';
  const textW = (txt, font) => { mctx.font = font; return mctx.measureText(txt).width; };
  function splitLines(text, font, maxW) {
    if (textW(text, font) <= maxW || !text.includes(' ')) return [text];
    const words = text.split(' ');
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
      const m = Math.max(textW(a, font), textW(b, font));
      if (!best || m < best.m) best = { lines: [a, b], m };
    }
    return best.lines;
  }
  /** The most balanced two-line break of a name, at a space or just after a hyphen. */
  function splitAnywhere(text, font) {
    let best = null;
    for (let i = 1; i < text.length - 1; i++) {
      let a, b;
      if (text[i] === ' ') { a = text.slice(0, i); b = text.slice(i + 1); } else if (text[i - 1] === '-') { a = text.slice(0, i); b = text.slice(i); } else continue;
      if (a.length < 3 || b.length < 3) continue;
      const m = Math.max(textW(a, font), textW(b, font));
      if (!best || m < best.m) best = { lines: [a, b], m };
    }
    return best && best.lines;
  }

  let els = null; // element handles from the last render
  let lastWidth = 0;

  function renderChart({ wipe = false } = {}) {
    const M = cur();
    const Wfull = Math.round(plot.clientWidth);
    if (!Wfull) return;
    lastWidth = Wfull;
    const narrow = Wfull < 560;
    const mr = narrow ? 6 : 10, mb = 60;
    const dz = M.zmax - M.zmin;
    const monoFont = `11px ${util.cssVar('--font-mono') || 'monospace'}`;
    // Frame for a given left margin. At true scale the plot is only as tall as the ground
    // needs, so the flat reality is not lost in an empty box.
    const frame = ml => {
      const W = Wfull - ml - mr;
      const sx = W / M.D;
      const Hfit = Math.round(narrow ? 210 : clamp(W * 0.4, 250, 350));
      let H, zBot, zTop, yTicks;
      if (state.ve === 'true') {
        H = Math.round(clamp(dz * sx + 64, narrow ? 96 : 120, Hfit));
        zBot = M.zmin - 14 / sx;
        zTop = zBot + H / sx;
        // Ticks only across the ground's own range, far enough apart to read, and always
        // at least one inside it.
        let st = niceStep(dz, 3);
        while (st * sx < 18) st = NICE.find(c => c > st) || st * 10;
        yTicks = multiplesIn(M.zmin, M.zmax, st);
        if (!yTicks.length) {
          for (let i = NICE.indexOf(niceStep(dz, 1)); i >= 0 && !yTicks.length; i--) {
            const m = multiplesIn(M.zmin, M.zmax, NICE[i]);
            if (m.length) yTicks = [m.reduce((a, b) => Math.abs(b - (M.zmin + M.zmax) / 2) < Math.abs(a - (M.zmin + M.zmax) / 2) ? b : a)];
          }
        }
      } else {
        H = Hfit;
        zBot = M.zmin - Math.max(4, 0.1 * dz);
        zTop = M.zmax + Math.max(2, 0.02 * dz);
        yTicks = multiplesIn(zBot, zTop, niceStep(zTop - zBot, Math.max(2, Math.floor(H / 48))));
      }
      const tickText = (v, i) => `${fmt.num(v)}${i === yTicks.length - 1 ? ' m' : ''}`;
      const need = Math.ceil(Math.max(0, ...yTicks.map((v, i) => textW(tickText(v, i), monoFont)))) + 12;
      return { ml, W, sx, H, zBot, zTop, yTicks, tickText, need };
    };
    // The left margin fits the widest elevation label, so measure once and re-frame if needed.
    let F = frame(Math.ceil(textW(`${fmt.num(Math.ceil(M.zmax))} m`, monoFont)) + 12);
    if (F.need > F.ml) F = frame(F.need);
    const { ml, W, sx, H, zBot, zTop, yTicks, tickText } = F;
    const sy = H / (zTop - zBot);
    const ve = state.ve === 'true' ? 1 : sy / sx;
    const x = d => d * sx;
    const y = z => (zTop - z) * sy;
    // The profile: every sample, plus the line's last few metres past the final sample.
    const prof = [];
    for (let i = 0; i < M.n; i++) prof.push([x(i * M.step), y(M.z[i])]);
    if (M.D > (M.n - 1) * M.step) prof.push([x(M.D), y(M.z[M.n - 1])]);
    const yAt = px => y(zAt(M, clamp(px, 0, W) / sx));
    const extremeBetween = (a, b, pick) => {
      a = clamp(a, 0, W); b = clamp(b, 0, W);
      let m = pick(yAt(a), yAt(b));
      const i0 = Math.ceil(a / sx / M.step), i1 = Math.floor(b / sx / M.step);
      for (let i = Math.max(0, i0); i <= Math.min(M.n - 1, i1); i++) m = pick(m, prof[i][1]);
      return m;
    };
    const topBetween = (a, b) => extremeBetween(a, b, Math.min);
    const bottomBetween = (a, b) => extremeBetween(a, b, Math.max);

    // One label group per named grand cru or premier cru stretch, with a few candidate anchors along it.
    const fam = displayFont();
    const size = { gc: narrow ? 15 : 17, pc: narrow ? 14 : 15.5 };
    const maxW = narrow ? Math.max(110, W * 0.46) : Math.min(230, W * 0.32);
    const partPx = M.parts.map(p => ({ p, x0: x(p.d0), x1: x(p.d1) }));
    const groups = M.parts.filter(p => p.labelable).map(p => {
      const gc = p.level === 'grand-cru';
      const fs = gc ? size.gc : size.pc;
      const font = `${gc ? 'normal 600' : 'italic 500'} ${fs}px ${fam}`;
      const lh = Math.round(fs * 1.02);
      const shape = (lines, extra = 0) => ({ lines, extra, w: Math.ceil(Math.max(...lines.map(l => textW(l, font)))) + 1, h: lh * lines.length });
      // The name on one line (two if it is too long), and a narrower two-line shape for
      // tight spots, broken at a space or after a hyphen, which costs a little more.
      const shapes = [shape(splitLines(p.short, font, maxW))];
      const alt = splitAnywhere(p.short, font);
      if (alt && shapes[0].lines.length === 1) {
        const sh = shape(alt, 30);
        if (sh.w < shapes[0].w * 0.75) shapes.push(sh);
      }
      const gx0 = x(p.d0), gx1 = x(p.d1), c = (gx0 + gx1) / 2;
      const anchors = [c];
      if (gx1 - gx0 > 16) for (const f of [0.35, 0.65, 0.2, 0.8]) anchors.push(gx0 + (gx1 - gx0) * f);
      return { p, gc, fs, lh, shapes, anchors, gx0, gx1 };
    });
    // How much of a label box lies over its own stretch, and how much over other named ground.
    const assoc = (g, x0, x1) => {
      const w = x1 - x0;
      let own = 0, foreign = 0;
      for (const q of partPx) {
        const ov = Math.min(x1, q.x1) - Math.max(x0, q.x0);
        if (ov <= 0) continue;
        if (q.p === g.p) { own += ov; continue; }
        const wt = q.p.level === 'none' ? 0.15
          : q.p.name === g.p.name ? 0.3
            : q.p.labelable ? (q.p.level === g.p.level ? 0.8 : 1)
              : (q.p.level === g.p.level ? 0.3 : 0.5);
        foreign += ov * wt;
      }
      return { own: own / w, target: Math.max(0.01, Math.min(1, (g.gx1 - g.gx0) / w)), foreign: foreign / w };
    };

    // Section letters sit just above the two ends of the ground, with room around them so
    // they never read as part of a label or of an elevation tick.
    const letterFs = narrow ? 17 : 19;
    const letterFont = `normal 600 ${letterFs}px ${fam}`;
    const ends = [
      { text: `${M.letter}`, anchor: 'start' },
      { text: `${M.letter}${PRIME}`, anchor: 'end' },
    ].map(e => {
      const w = textW(e.text, letterFont) + 2;
      const x0 = e.anchor === 'start' ? -2 : W - w - 4, x1 = e.anchor === 'start' ? w + 4 : W + 2;
      const yy = (e.anchor === 'start' ? topBetween(0, w + 6) : topBetween(W - w - 6, W)) - 8;
      return { ...e, x0, x1, y: yy };
    });
    const endBox = (e, yy) => ({ x0: e.x0, x1: e.x1, y0: yy - letterFs, y1: yy + 3 });
    const tickBoxes = yTicks.map(v => ({ x0: -ml, x1: 0, y0: y(v) - 8, y1: y(v) + 8 }));
    const tickObstacles = tickBoxes.map(b => ({ ...b, x1: b.x1 + 10 }));
    const env = { W, H, yAt, topBetween, bottomBetween, assoc };

    // Greedy placement depends on the order, so try several orders and keep the best result:
    // most labels placed, fewest that had to leave their own stretch, grand crus first,
    // then the shortest leaders. Each order runs in three passes. The first keeps labels off
    // the letters' spots and over their own ground, the second lets a label take a letter's
    // spot (the letter then climbs), the last lets a label drift over neighbouring ground.
    const byX = (a, b) => a.anchors[0] - b.anchors[0];
    // On a flat drawing (true scale) labels have to stack. That works as a staircase, built
    // from the right with every label running right of its leader, or from the left with
    // every label running left, so those two orders keep a single alignment.
    const variants = [
      { order: [...groups].sort((a, b) => (b.gc - a.gc) || byX(a, b)), aligns: ['middle', 'start', 'end'] },
      { order: [...groups].sort((a, b) => (b.gc - a.gc) || byX(b, a)), aligns: ['start', 'middle', 'end'] },
      { order: [...groups].sort(byX).reverse(), aligns: ['start', 'middle'] },
      { order: [...groups].sort(byX), aligns: ['end', 'middle'] },
      { order: [...groups].sort(byX).reverse(), aligns: ['start'] },
      { order: [...groups].sort(byX), aligns: ['end'] },
    ];
    const letterObstacles = ends.map(e => inflate(endBox(e, e.y), 12, 9));
    let best = null;
    for (const v of variants) {
      const rects = [], leaders = [];
      const opt = { aligns: v.aligns };
      const p1 = placeLabels(v.order, env, rects, leaders, { ...opt, strict: true, obstacles: [...letterObstacles, ...tickObstacles] });
      const p2 = p1.failed.length ? placeLabels(p1.failed, env, rects, leaders, { ...opt, strict: true, obstacles: tickObstacles }) : { placed: [], failed: [] };
      const p3 = p2.failed.length ? placeLabels(p2.failed, env, rects, leaders, { ...opt, strict: false, obstacles: tickObstacles, gapX: 4, gapY: 3 }) : { placed: [], failed: [] };
      const placedV = [...p1.placed, ...p2.placed, ...p3.placed];
      const key = [placedV.length, -p3.placed.length, placedV.filter(pl => pl.g.gc).length, -placedV.reduce((a, pl) => a + pl.cost, 0)];
      if (!best || cmpKey(key, best.key) > 0) best = { key, placed: placedV, rects, leaders };
    }
    const { placed, rects, leaders } = best;
    for (const e of ends) {
      let yy = e.y;
      const clash = b => rects.some(o => hitBox(o, inflate(b, 12, 8))) || leaders.some(o => hitBox(o, inflate(b, 12, 0)))
        || (e.anchor === 'start' && tickBoxes.some(o => hitBox(o, inflate(b, 12, 0))));
      for (let k = 0; k < 120 && clash(endBox(e, yy)); k++) yy -= 2;
      e.y = yy;
      rects.push(endBox(e, yy));
    }
    const minY = Math.min(0, ...placed.map(pl => pl.y0), ...ends.map(e => e.y - letterFs));
    const mt = Math.ceil(Math.max(14, -minY + 8));
    const Htot = mt + H + mb;

    const svg = s('svg', { class: 'sl-svg', width: Wfull, height: Htot, viewBox: `0 0 ${Wfull} ${Htot}`, 'aria-hidden': 'true', focusable: 'false' });
    const g = s('g', { transform: `translate(${ml},${mt})` });
    svg.append(g);

    // Grid and y axis
    const gGrid = s('g', { class: 'sl-grid' });
    yTicks.forEach((v, i) => {
      const yy = Math.round(y(v)) + 0.5;
      gGrid.append(s('line', { class: 'sl-gridline', x1: 0, x2: W, y1: yy, y2: yy }));
      gGrid.append(s('text', { class: 'sl-tick', x: -8, y: yy, dy: '0.32em', 'text-anchor': 'end', text: tickText(v, i) }));
    });
    g.append(gGrid);

    // Ground: a light wash of the level colour, a solid skin under the surface, the profile line.
    const gDrawn = s('g', { class: 'sl-drawn' });
    const pts = (d0, d1) => {
      const out = [[x(d0), y(zAt(M, d0))]];
      for (let i = Math.ceil(d0 / M.step); i < M.n && i * M.step < d1; i++) if (i * M.step > d0) out.push(prof[i]);
      out.push([x(d1), y(zAt(M, d1))]);
      return out;
    };
    const skin = narrow ? 4 : 5;
    const P = ([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`;
    const segEls = M.segs.map(sg => {
      if (sg.d1 <= sg.d0) return null;
      const top = pts(sg.d0, sg.d1);
      const wash = s('path', { class: `sl-wash ${lcls(sg.level)}`, 'data-p': M.segPart[sg.k], d: `M${top.map(P).join('L')}L${x(sg.d1).toFixed(1)},${H}L${x(sg.d0).toFixed(1)},${H}Z` });
      const sk = s('path', { class: `sl-skin ${lcls(sg.level)}`, d: `M${top.map(P).join('L')}L${[...top].reverse().map(([a, b]) => P([a, b + skin])).join('L')}Z` });
      gDrawn.append(wash, sk);
      return { wash, skin: sk, rib: null };
    });
    // Surface gaps between neighbours: full depth where the level changes, through the skin where only the name does.
    for (let k = 1; k < M.segs.length; k++) {
      const a = M.segs[k - 1], b = M.segs[k];
      if (x(a.d1) - x(a.d0) < 3 || x(b.d1) - x(b.d0) < 3) continue;
      const xx = x(b.d0), yy = y(zAt(M, b.d0));
      if (a.level !== b.level) gDrawn.append(s('line', { class: 'sl-sep', x1: xx, x2: xx, y1: yy + 0.5, y2: H }));
      else if (a.name !== b.name) gDrawn.append(s('line', { class: 'sl-sep', x1: xx, x2: xx, y1: yy + 0.5, y2: yy + skin }));
    }
    gDrawn.append(s('path', { class: 'sl-profile', d: `M${prof.map(P).join('L')}` }));
    g.append(gDrawn);

    // X axis, classification band, ends
    const gAxis = s('g', { class: 'sl-axis' });
    gAxis.append(s('line', { class: 'sl-baseline', x1: 0, x2: W, y1: H + 0.5, y2: H + 0.5 }));
    const ribY = H + 5;
    M.segs.forEach((sg, k) => {
      const x0 = x(sg.d0), x1 = x(sg.d1);
      if (x1 <= x0) return;
      const gap = x1 - x0 > 3 ? 0.5 : 0;
      const r = s('rect', { class: `sl-rib ${lcls(sg.level)}`, x: (x0 + gap).toFixed(1), y: ribY, width: Math.max(0.6, x1 - x0 - 2 * gap).toFixed(1), height: RIB_H[sg.level] });
      gAxis.append(r);
      if (segEls[k]) segEls[k].rib = r;
    });
    const tickY = ribY + RIB_MAX;
    const xStep = niceStep(M.D, Math.max(2, Math.floor(W / (narrow ? 64 : 96))));
    const xTicks = multiplesIn(0, M.D, xStep);
    xTicks.forEach((d, i) => {
      const xx = Math.round(x(d)) + 0.5;
      const last = i === xTicks.length - 1;
      gAxis.append(s('line', { class: 'sl-xtick', x1: xx, x2: xx, y1: tickY + 2, y2: tickY + 6 }));
      const anchor = i === 0 ? 'start' : (xx > W - 24 ? 'end' : 'middle');
      gAxis.append(s('text', { class: 'sl-tick', x: i === 0 ? 0 : xx, y: tickY + 19, 'text-anchor': anchor, text: `${fmt.num(d)}${last ? ' m' : ''}` }));
    });
    gAxis.append(s('text', { class: 'sl-end', x: 0, y: H + 52, 'text-anchor': 'start', text: `← ${util.aspectWord(M.up)}` }));
    gAxis.append(s('text', { class: 'sl-end', x: W, y: H + 52, 'text-anchor': 'end', text: `${util.aspectWord(M.down)} →` }));
    if (!narrow) gAxis.append(s('text', { class: 'sl-end sl-end-mid', x: W / 2, y: H + 52, 'text-anchor': 'middle', text: `distance from ${M.letter}` }));
    g.append(gAxis);

    // Crosshair, under the labels so their halo keeps the text clear of the line.
    const crossLine = s('line', { class: 'sl-cross-line', x1: 0, x2: 0, y1: 0, y2: H });
    const crossDot = s('circle', { class: 'sl-cross-dot', cx: 0, cy: 0, r: 4.5 });
    const gCross = s('g', { class: 'sl-cross', visibility: 'hidden' }, crossLine, crossDot);
    g.append(gCross);

    // Labels with leader lines
    const gLab = s('g', { class: 'sl-labels' });
    const labelEls = new Map();
    for (const pl of placed) {
      const { g: grp } = pl;
      const lg = s('g', { class: `sl-label ${lcls(grp.p.level)}`, 'data-part': grp.p.index });
      lg.append(s('rect', { class: 'sl-lab-hit', x: pl.x0 - 4, y: pl.y0 - 3, width: pl.sh.w + 8, height: pl.sh.h + 6 }));
      if (pl.below) { if (pl.y0 - pl.foot > 6) lg.append(s('line', { class: 'sl-leader', x1: pl.ax, x2: pl.ax, y1: pl.foot + 3, y2: pl.y0 - 1 })); }
      else if (pl.foot - pl.y1 > 2) lg.append(s('line', { class: 'sl-leader', x1: pl.ax, x2: pl.ax, y1: pl.y1 + 2, y2: pl.foot - 3 }));
      lg.append(s('circle', { class: 'sl-foot', cx: pl.ax, cy: pl.foot, r: 2.6 }));
      const tx = s('text', { class: `sl-lab ${grp.gc ? 'sl-lab-gc' : 'sl-lab-pc'}${pl.below ? ' sl-lab-in' : ''}`, style: `font-size:${grp.fs}px` });
      pl.sh.lines.forEach((ln, j) => tx.append(s('tspan', { x: pl.x0, y: (pl.y0 + grp.lh * (j + 1) - grp.lh * 0.22).toFixed(1), text: ln })));
      lg.append(tx);
      gLab.append(lg);
      labelEls.set(grp.p.index, lg);
    }
    for (const e of ends) {
      gLab.append(s('text', { class: 'sl-letter', x: e.anchor === 'start' ? 0 : W, y: e.y, 'text-anchor': e.anchor, style: `font-size:${letterFs}px`, text: e.text }));
    }
    g.append(gLab);

    plot.replaceChildren(svg, kbtip);
    els = { svg, segEls, labelEls, gCross, crossLine, crossDot, gDrawn, gLab };
    state.layout = { M, ml, mt, W, H, Htot, sx, x, y, ve, boxes: rects.map(r => ({ ...r })) };

    veVal.textContent = `Vertical scale ×${fmt.num(ve, ve === 1 ? 0 : ve < 10 ? 1 : 0)}`;
    caption.textContent = captionText(M, ve);

    applyHighlight();
    if (state.cross != null) drawCross();
    if (wipe && !reduce() && !plot.classList.contains('is-pending')) for (const el of [gDrawn, gLab]) el.classList.add('is-wipe');
  }

  function setVE(v) {
    if (state.ve === v) return;
    state.ve = v;
    veBtns.forEach(b => {
      const on = b.dataset.ve === v;
      b.setAttribute('aria-checked', String(on));
      b.setAttribute('tabindex', on ? '0' : '-1');
    });
    renderChart();
  }

  /* ---------- Highlighting, shared by chart and map ---------- */
  function hotSets() {
    const M = cur();
    const parts = new Set();
    if (state.hotPart != null) parts.add(state.hotPart);
    if (state.hotFeature) M.parts.forEach(p => { if (p.feature === state.hotFeature) parts.add(p.index); });
    return parts;
  }

  function applyHighlight() {
    const M = cur();
    const hot = hotSets();
    const selPart = M.parts[state.sel];
    if (els && state.layout && state.layout.M === M) {
      els.svg.classList.toggle('has-hot', hot.size > 0);
      M.segs.forEach((sg, k) => {
        const e = els.segEls[k];
        if (!e) return;
        const pi = M.segPart[k];
        const isHot = hot.has(pi), isSel = pi === state.sel;
        for (const el of [e.wash, e.skin, e.rib]) {
          if (!el) continue;
          el.classList.toggle('is-hot', isHot);
          el.classList.toggle('is-sel', isSel);
        }
      });
      els.labelEls.forEach((lg, pi) => {
        lg.classList.toggle('is-hot', hot.has(pi));
        lg.classList.toggle('is-sel', pi === state.sel);
      });
    }
    // Map. Classes only: the polygons keep the paint order of the region file (large under
    // small), so a village appellation never climbs over the premier crus inside it.
    const hotIds = new Set([...hot].map(pi => M.parts[pi]?.feature).filter(Boolean));
    const selId = selPart?.feature || '';
    mini.polyById.forEach((layer, id) => {
      const el = layer.getElement && layer.getElement();
      if (!el) return;
      el.classList.toggle('is-hot', hotIds.has(id));
      el.classList.toggle('is-sel', id === selId);
    });
    mini.lineEls.forEach((ln, pi) => {
      const el = ln.getElement && ln.getElement();
      if (!el) return;
      el.classList.toggle('is-hot', hot.has(pi));
      el.classList.toggle('is-sel', pi === state.sel);
    });
  }

  /* ---------- Crosshair ---------- */
  function segAt(M, i) { const k = M.sampleSeg[i]; return k >= 0 ? M.segs[k] : null; }

  function gradientAt(M, i) {
    const a = Math.max(0, i - GRAD_HALF), b = Math.min(M.n - 1, i + GRAD_HALF);
    const run = (b - a) * M.step;
    return run > 0 ? { g: (M.z[a] - M.z[b]) / run * 100, run } : null;
  }

  function readout(M, i) {
    const sg = segAt(M, i);
    const level = sg ? sg.level : 'none';
    const gr = gradientAt(M, i);
    let grText = '';
    if (gr) {
      const v = Math.abs(gr.g);
      grText = v < 0.5 ? `Level ground here, measured over ${fmt.m(gr.run)}` : `Ground ${gr.g > 0 ? 'falls' : 'rises'} ${fmt.pct(v)} towards ${M.letter}${PRIME} here, measured over ${fmt.m(gr.run)}`;
    }
    const name = sg && sg.level !== 'none' ? fullOf(sg.feature, sg.name) : '';
    return { d: i * M.step, z: M.z[i], level, name, unnamed: !!sg && sg.level === 'premier-cru' && !sg.short, grText };
  }

  function readoutNode(M, i) {
    const r = readout(M, i);
    return h('div', { class: 'sl-tipc' },
      h('div', { class: 'sl-tip-top' }, h('b', { text: fmt.m(r.z) }), h('span', { text: ` at ${fmt.m(r.d)} from ${M.letter}` })),
      h('div', { class: 'sl-tip-lvl' }, h('span', { class: `sl-key ${lcls(r.level)}`, attrs: { 'aria-hidden': 'true' } }), levelLabel(r.level)),
      r.name ? h('div', { class: 'sl-tip-name', text: r.unnamed ? `${r.name}, no climat name in the INAO data` : r.name }) : null,
      r.grText ? h('div', { class: 'sl-tip-sub', text: r.grText }) : null);
  }

  function valueText(M, i) {
    const r = readout(M, i);
    return `${fmt.m(r.d)} from ${M.letter}, elevation ${fmt.m(r.z)}, ${levelLabel(r.level)}${r.name ? `, ${r.name}` : ''}`;
  }

  let lastPointer = null;
  function setCross(i, src, evt) {
    const M = cur();
    state.cross = clamp(i, 0, M.n - 1);
    state.crossSrc = src;
    if (evt) lastPointer = { clientX: evt.clientX, clientY: evt.clientY };
    drawCross();
    const k = M.sampleSeg[state.cross];
    const pi = k >= 0 ? M.segPart[k] : null;
    if (pi !== state.hotPart) { state.hotPart = pi; applyHighlight(); }
    plot.setAttribute('aria-valuenow', String(state.cross * M.step));
    plot.setAttribute('aria-valuetext', valueText(M, state.cross));
    if (src === 'pointer' && lastPointer) {
      kbtip.classList.remove('on');
      util.tip.show(lastPointer, readoutNode(M, state.cross));
    } else {
      util.tip.hide();
      placeKbTip();
    }
    if (mini.dot) {
      mini.dot.setLatLng(latlngAt(M, state.cross * M.step));
      mini.dot.getElement()?.classList.add('is-on');
    }
  }

  function drawCross() {
    const L = state.layout;
    if (!els || !L || state.cross == null) return;
    const M = cur();
    const xx = L.x(state.cross * M.step), yy = L.y(M.z[state.cross]);
    els.crossLine.setAttribute('x1', xx); els.crossLine.setAttribute('x2', xx);
    els.crossDot.setAttribute('cx', xx); els.crossDot.setAttribute('cy', yy);
    const sg = segAt(M, state.cross);
    els.crossDot.setAttribute('class', `sl-cross-dot ${lcls(sg ? sg.level : 'none')}`);
    els.gCross.setAttribute('visibility', 'visible');
    if (state.crossSrc === 'key') placeKbTip();
  }

  // The keyboard readout sits beside the dot, on whichever side covers the fewest labels.
  function placeKbTip() {
    const L = state.layout;
    if (!L || state.cross == null || state.crossSrc !== 'key') return;
    const M = cur();
    kbtip.replaceChildren(readoutNode(M, state.cross));
    kbtip.classList.add('on');
    const px = L.ml + L.x(state.cross * M.step), py = L.mt + L.y(M.z[state.cross]);
    const w = kbtip.offsetWidth, ht = kbtip.offsetHeight;
    const wrapW = plot.clientWidth, wrapH = plot.clientHeight;
    const boxes = L.boxes.map(b => ({ x0: b.x0 + L.ml, x1: b.x1 + L.ml, y0: b.y0 + L.mt, y1: b.y1 + L.mt }));
    const cands = [
      [px + 16, py - ht - 16], [px - w - 16, py - ht - 16],
      [px + 16, py + 18], [px - w - 16, py + 18],
    ].map(([lx, ty]) => {
      const r = { x0: clamp(lx, 0, Math.max(0, wrapW - w)), y0: clamp(ty, 0, Math.max(0, wrapH - ht)) };
      r.x1 = r.x0 + w; r.y1 = r.y0 + ht;
      const covers = boxes.reduce((a, b) => a + Math.max(0, Math.min(r.x1, b.x1) - Math.max(r.x0, b.x0)) * Math.max(0, Math.min(r.y1, b.y1) - Math.max(r.y0, b.y0)), 0);
      const onDot = px > r.x0 - 6 && px < r.x1 + 6 && py > r.y0 - 6 && py < r.y1 + 6;
      return { r, cost: covers + (onDot ? 1e6 : 0) };
    });
    const bestTip = cands.reduce((a, b) => (b.cost < a.cost ? b : a));
    kbtip.style.left = `${bestTip.r.x0}px`;
    kbtip.style.top = `${bestTip.r.y0}px`;
  }

  function clearCross() {
    state.cross = null; state.crossSrc = null;
    if (els) els.gCross.setAttribute('visibility', 'hidden');
    kbtip.classList.remove('on');
    util.tip.hide();
    mini.dot?.getElement()?.classList.remove('is-on');
    if (state.hotPart != null) { state.hotPart = null; applyHighlight(); }
    idleValue();
  }

  // A slider always carries a value. Without a crosshair it is where the keyboard would
  // start, the middle of the selected stretch.
  function idleValue() {
    const M = cur();
    const i = centerSample(M, M.parts[state.sel]);
    plot.setAttribute('aria-valuenow', String(i * M.step));
    plot.setAttribute('aria-valuetext', valueText(M, i));
  }

  const sampleFromClientX = clientX => {
    const L = state.layout;
    const r = plot.getBoundingClientRect();
    const M = cur();
    return clamp(Math.round((clientX - r.left - L.ml) / L.sx / M.step), 0, M.n - 1);
  };

  let pending = null, raf = 0, touchTimer = 0;
  const flush = () => {
    raf = 0;
    if (!pending || !state.layout) return;
    const e = pending; pending = null;
    const lab = e.target && e.target.closest && e.target.closest('[data-part]');
    if (lab) showPartTip(Number(lab.dataset.part), e);
    else setCross(sampleFromClientX(e.clientX), 'pointer', e);
  };
  // Hovering a label describes its whole stretch rather than the sample under the pointer.
  function showPartTip(pi, e) {
    const M = cur();
    const p = M.parts[pi];
    if (!p) return;
    state.cross = null; state.crossSrc = 'pointer';
    if (els) els.gCross.setAttribute('visibility', 'hidden');
    kbtip.classList.remove('on');
    mini.dot?.getElement()?.classList.remove('is-on');
    if (state.hotPart !== pi) { state.hotPart = pi; applyHighlight(); }
    util.tip.show(e, h('div', { class: 'sl-tipc' },
      h('div', { class: 'sl-tip-lvl' }, h('span', { class: `sl-key ${lcls(p.level)}`, attrs: { 'aria-hidden': 'true' } }), levelLabel(p.level)),
      h('div', { class: 'sl-tip-name' }, h('b', { text: partFull(p) })),
      h('div', { class: 'sl-tip-sub', text: nb(`${elevText(p.zmin, p.zmax)} high, ${fmt.num(p.d0)}–${fmt.m(p.d1)} from ${M.letter}`) })));
  }
  plot.addEventListener('pointermove', e => {
    pending = e;
    if (!raf) raf = requestAnimationFrame(flush);
  });
  plot.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || !state.layout) return;
    clearTimeout(touchTimer);
    // A tap reads the same thing a hover would: a label describes its stretch, the ground its sample.
    const lab = e.target.closest && e.target.closest('[data-part]');
    if (lab) showPartTip(Number(lab.dataset.part), e);
    else setCross(sampleFromClientX(e.clientX), 'pointer', e);
  });
  plot.addEventListener('pointerup', e => {
    if (e.pointerType === 'mouse') return;
    clearTimeout(touchTimer);
    // After a touch the readout lingers, then the chart returns to rest: tooltip, crosshair and highlight together.
    touchTimer = setTimeout(() => { if (state.crossSrc === 'pointer') clearCross(); }, 1600);
  });
  plot.addEventListener('pointerleave', e => {
    if (e.pointerType !== 'mouse') return;
    pending = null;
    if (state.crossSrc === 'pointer') clearCross();
  });
  plot.addEventListener('pointercancel', () => { pending = null; clearCross(); });
  plot.addEventListener('click', e => {
    if (!state.layout) return;
    const lab = e.target.closest && e.target.closest('[data-part]');
    const M = cur();
    if (lab) { selectPart(Number(lab.dataset.part)); return; }
    const k = M.sampleSeg[sampleFromClientX(e.clientX)];
    if (k >= 0) selectPart(M.segPart[k]);
  });

  plot.addEventListener('keydown', e => {
    const M = cur();
    const start = state.cross ?? centerSample(M, M.parts[state.sel]);
    let i = start;
    const big = 10;
    switch (e.key) {
      case 'ArrowLeft': i -= e.shiftKey ? big : 1; break;
      case 'ArrowRight': i += e.shiftKey ? big : 1; break;
      case 'PageDown': i -= big; break;
      case 'PageUp': i += big; break;
      case 'Home': i = 0; break;
      case 'End': i = M.n - 1; break;
      case 'ArrowUp': i = jumpPart(M, start, 1); break;
      case 'ArrowDown': i = jumpPart(M, start, -1); break;
      case 'Enter': case ' ': {
        e.preventDefault();
        const k = M.sampleSeg[start];
        if (k >= 0) selectPart(M.segPart[k]);
        return;
      }
      case 'Escape': clearCross(); return;
      default: return;
    }
    e.preventDefault();
    setCross(i, 'key');
  });
  plot.addEventListener('focus', () => {
    if (plot.matches(':focus-visible') && state.cross == null) setCross(centerSample(cur(), cur().parts[state.sel]), 'key');
  });
  plot.addEventListener('blur', () => { if (state.crossSrc === 'key') clearCross(); });

  function centerSample(M, p) {
    if (!p) return 0;
    return clamp(Math.round((p.d0 + p.d1) / 2 / M.step), 0, M.n - 1);
  }
  // Up and down step through the same stretches as the selection panel's arrows.
  function jumpPart(M, i, dir) {
    const centres = navParts(M).map(p => centerSample(M, p));
    const next = dir > 0 ? centres.find(c => c > i) : [...centres].reverse().find(c => c < i);
    return next ?? i;
  }

  /* ---------- Selected stretch ---------- */
  function selectPart(pi, { announce = true } = {}) {
    const M = cur();
    if (pi == null || pi < 0 || !M.parts[pi]) return;
    state.sel = pi;
    applyHighlight();
    renderSel();
    if (announce) {
      const p = M.parts[pi];
      selLive.textContent = `Selected ${partFull(p)}, ${levelLabel(p.level)}, ${elevText(p.zmin, p.zmax)}.`;
    }
  }

  function selectFeature(id) {
    const M = cur();
    const hits = M.parts.filter(q => q.feature === id);
    if (!hits.length) return;
    // A feature the line crosses twice: a second click moves to its next stretch.
    const at = hits.findIndex(q => q.index === state.sel);
    selectPart(hits[(at + 1) % hits.length].index);
  }

  function stepPart(dir) {
    const M = cur();
    const nav = navParts(M);
    const p = M.parts[state.sel];
    let j = nav.indexOf(p);
    if (j >= 0) j = (j + dir + nav.length) % nav.length;
    else {
      // A sliver is selected: go to the nearest stop in that direction.
      const c = p ? (p.d0 + p.d1) / 2 : 0;
      j = dir > 0 ? nav.findIndex(q => q.d0 >= c) : nav.map(q => q.d1 <= c).lastIndexOf(true);
      if (j < 0) j = dir > 0 ? 0 : nav.length - 1;
    }
    selectPart(nav[j].index);
  }

  function renderSel() {
    const M = cur();
    if (state.cross == null) idleValue();
    const p = M.parts[state.sel];
    if (!p) return;
    const nav = navParts(M);
    const pos = nav.indexOf(p);
    const L = M.letter;
    selBadge.className = `badge ${lcls(p.level)}`;
    selBadge.dataset.level = p.level;
    selBadge.textContent = levelLabel(p.level);
    selCount.textContent = pos >= 0 ? `${pos + 1} of ${nav.length}` : '';
    prevBtn.setAttribute('aria-label', `Previous stretch, towards ${L}`);
    prevBtn.title = `Previous stretch, towards ${L}`;
    nextBtn.setAttribute('aria-label', `Next stretch, towards ${L}${PRIME}`);
    nextBtn.title = `Next stretch, towards ${L}${PRIME}`;
    selName.textContent = partTitle(p);
    const full = partFull(p);
    selFull.textContent = full !== partTitle(p) ? full : '';
    selFull.hidden = !selFull.textContent;

    const ext = p.d1 - p.d0;
    const chg = Math.round(zAt(M, p.d1) - zAt(M, p.d0));
    const item = (k, v, sub) => h('div', {}, h('dt', { text: k }), h('dd', {}, nb(v), sub ? h('span', { class: 'sl-dd-sub', text: nb(sub) }) : null));
    selFacts.replaceChildren(
      item('Along the line', `${fmt.num(p.d0)}–${fmt.m(p.d1)}`, `from ${L}`),
      item('Elevation', elevText(p.zmin, p.zmax)),
      item('Length', fmt.m(p.len), p.gap > 0 ? `plus ${fmt.m(p.gap)} outside any AOC` : null),
      item('Height change across it', signedM(chg), `towards ${L}${PRIME}`),
      item('Net gradient', ext >= SHORT_M ? fmt.pct(Math.abs(chg) / ext * 100) : '–', ext >= SHORT_M ? null : 'too short to measure'),
      item('Share of the line', pctText(p.len / M.D)));

    const inIndex = p.feature && (!state.index || state.index.has(p.feature));
    const kindWord = p.level === 'village' ? 'appellation' : 'climat';
    const openBtn = inIndex
      ? h('button', { class: 'btn btn-sm', type: 'button', text: `Open this ${kindWord}`, on: { click: () => { bus.emit('feature:focus', { id: p.feature, source: 'slope' }); util.scrollToId('map'); } } })
      : null;
    const why = !p.feature
      ? (p.level === 'none' ? 'This ground lies outside every AOC boundary in the data.' : 'This stretch has no climat name in the INAO data, so it has no entry on the atlas map.')
      : (!inIndex ? 'This appellation is not drawn on the atlas map.' : null);
    selAction.replaceChildren(...[openBtn, why ? h('p', { class: 'caveat', text: why }) : null].filter(Boolean));
  }

  /* ---------- Locator map ---------- */
  const mini = { map: null, group: null, polyLayer: null, polyById: new Map(), lineEls: [], dot: null, token: 0 };

  function initMini() {
    if (mini.map) return;
    const L = window.L;
    if (!L) { mapEl.replaceChildren(h('p', { class: 'sl-map-loading', text: 'The locator map could not load.' })); return; }
    mapEl.replaceChildren();
    // On touch screens the locator never captures a drag or a pinch, so the page keeps
    // scrolling. The zoom buttons zoom about the centre, where the line sits.
    const coarse = matchMedia('(pointer: coarse)').matches;
    const map = L.map(mapEl, {
      zoomControl: false, scrollWheelZoom: false, dragging: !coarse, touchZoom: !coarse, doubleClickZoom: !coarse, boxZoom: false,
      // Whole zoom levels only. Scaled tiles at fractional zoom show hairline seams.
      zoomSnap: 1, attributionControl: true,
      fadeAnimation: !reduce(), zoomAnimation: !reduce(), markerZoomAnimation: !reduce(),
    });
    // The same stroked plus and minus as the atlas map's zoom buttons, not Leaflet's text glyphs.
    const zoomIcon = d => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
    L.control.zoom({ zoomInText: zoomIcon('M12 6v12M6 12h12'), zoomOutText: zoomIcon('M6 12h12') }).addTo(map);
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" rel="noopener">Leaflet</a>');
    L.tileLayer(IGN_ORTHO, { maxZoom: 19, maxNativeZoom: 19, attribution: '© IGN Géoplateforme' }).addTo(map);
    map.attributionControl.addAttribution('Appellations © INAO');
    [['sl-polys', 410], ['sl-lines', 420], ['sl-marks', 430]].forEach(([name, zi]) => { map.createPane(name).style.zIndex = zi; });
    map.getPane('sl-lines').style.pointerEvents = 'none';
    map.getPane('sl-marks').style.pointerEvents = 'none';
    mini.map = map;
    drawMini();
    if ('ResizeObserver' in window) {
      let lastH = 0, lastW = 0;
      new ResizeObserver(util.debounce(() => {
        if (mapEl.clientWidth === lastW && mapEl.clientHeight === lastH) return;
        lastW = mapEl.clientWidth; lastH = mapEl.clientHeight;
        map.invalidateSize({ animate: false });
        fitMini();
      }, 150)).observe(mapEl);
    }
  }

  function fitMini() {
    const M = cur();
    if (!mini.map) return;
    // Keep both end markers clear of the zoom buttons (top left), the tag and the attribution
    // (bottom). A short map drops the tag, which the attribution repeats, and frames tighter.
    const compact = mapEl.clientHeight < 300;
    mapBox.classList.toggle('is-compact', compact);
    const pad = compact ? { paddingTopLeft: [54, 18], paddingBottomRight: [18, 26] } : { paddingTopLeft: [60, 56], paddingBottomRight: [34, 38] };
    mini.map.fitBounds(window.L.latLngBounds([M.t.start, M.t.end]), { ...pad, animate: false });
  }

  async function drawMini() {
    const map = mini.map;
    if (!map) return;
    const L = window.L;
    const M = cur();
    const token = ++mini.token;
    mini.group?.remove();
    mini.polyLayer?.remove();
    mini.polyLayer = null;
    mini.polyById = new Map();
    const group = L.layerGroup().addTo(map);
    L.polyline([M.t.start, M.t.end], { pane: 'sl-lines', className: 'sl-mcase', interactive: false }).addTo(group);
    mini.lineEls = M.parts.map(p => L.polyline([latlngAt(M, p.d0), latlngAt(M, p.d1)], { pane: 'sl-lines', className: `sl-mline ${lcls(p.level)}`, interactive: false }).addTo(group));
    const endIcon = txt => L.divIcon({ className: 'sl-mend', html: `<span>${util.esc(txt)}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] });
    L.marker(M.t.start, { pane: 'sl-marks', icon: endIcon(M.letter), interactive: false, keyboard: false }).addTo(group);
    L.marker(M.t.end, { pane: 'sl-marks', icon: endIcon(`${M.letter}${PRIME}`), interactive: false, keyboard: false }).addTo(group);
    mini.dot = L.circleMarker(M.t.start, { pane: 'sl-marks', radius: 5, className: 'sl-mdot', interactive: false }).addTo(group);
    mini.group = group;
    mapEl.setAttribute('aria-label', `Locator map of section ${M.letter} on IGN aerial photography, with the appellation outlines it crosses`);
    fitMini();
    applyHighlight();

    let fc;
    try { fc = await data.region(M.t.region); } catch (err) { console.error('[slope] region data', err); return; }
    if (token !== mini.token) return;
    const ids = new Set(M.segs.map(sg => sg.feature).filter(Boolean));
    // The region file is already in paint order (large under small), and so is this subset.
    const feats = (fc.features || []).filter(f => ids.has(f.properties.id));
    mini.polyLayer = L.geoJSON({ type: 'FeatureCollection', features: feats }, {
      pane: 'sl-polys',
      style: f => ({ className: `sl-poly ${lcls(f.properties.level)}`, weight: 1.5 }),
      onEachFeature: (f, layer) => {
        const id = f.properties.id;
        mini.polyById.set(id, layer);
        layer.bindTooltip(f.properties.full || f.properties.name || id, { sticky: true, direction: 'top', className: 'sl-maptip', opacity: 1, offset: [0, -8] });
        layer.on('mouseover', () => { state.hotFeature = id; applyHighlight(); });
        layer.on('mouseout', () => { state.hotFeature = null; applyHighlight(); });
        layer.on('click', () => selectFeature(id));
      },
    }).addTo(map);
    // The chart slider and the panel arrows give full keyboard access, so the outlines stay
    // out of the tab order.
    mini.polyById.forEach(layer => {
      const el = layer.getElement && layer.getElement();
      if (el) { el.setAttribute('tabindex', '-1'); el.setAttribute('focusable', 'false'); }
    });
    applyHighlight();
  }

  /* ---------- Wiring ---------- */
  // The map sent a section here: bring the plate into view and move keyboard focus to the
  // selected tab, so the next Tab continues inside this plate rather than back up in the map.
  function arrive(i) {
    util.scrollToId('slope');
    tabs[i].focus({ preventScroll: true });
  }

  // A cold ?transect= link lands on the plate. Plates above render later and can push it down,
  // so it is re-aligned once the page settles, unless the reader has moved in the meantime.
  function keepInView() {
    const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
    let moved = false;
    const stop = () => { moved = true; events.forEach(t => removeEventListener(t, stop)); };
    events.forEach(t => addEventListener(t, stop, { passive: true }));
    const align = () => { if (!moved) document.getElementById('slope')?.scrollIntoView({ block: 'start' }); };
    requestAnimationFrame(align);
    const late = () => setTimeout(() => { align(); stop(); }, 400);
    if (document.readyState === 'complete') late();
    else addEventListener('load', late, { once: true });
  }

  bus.on('transect:show', p => {
    const i = list.findIndex(M => M.id === p?.id);
    if (i < 0) return;
    select(i, { writeUrl: p.source !== 'url' });
    if (p.source === 'map') arrive(i);
  });

  const onResize = util.debounce(() => {
    if (Math.round(plot.clientWidth) !== lastWidth) renderChart();
    tableScroll();
  }, 120);
  if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(plot);
  else addEventListener('resize', onResize);

  // Initial transect: a transect:show that fired before this module loaded, ?transect=, or the first.
  const wanted = ctx.params.get('transect');
  const fromParam = list.findIndex(M => M.id === wanted);
  // An unknown ?transect= is dropped from the address, so a copied link does not carry it on.
  if (wanted != null && fromParam < 0) util.setParam('transect', null);
  const early = bus.last('transect:show');
  const fromBus = early && early.source !== 'slope' ? list.findIndex(M => M.id === early.id) : -1;
  select(fromBus >= 0 ? fromBus : Math.max(0, fromParam), { writeUrl: fromBus >= 0 && fromBus !== fromParam });
  if (fromBus >= 0 && early.source === 'map') arrive(fromBus);
  else if (fromBus < 0 && fromParam >= 0) {
    // Scroll only when no other deep link claims the page (?feature= goes to the map,
    // ?village= to its card) and no other section is named in the hash.
    const other = ['feature', 'village'].some(k => ctx.params.get(k));
    if (!other && (!location.hash || location.hash === '#slope')) keepInView();
  }

  // Re-measure labels once the display face has loaded.
  if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(() => renderChart());

  // Draw the section as soon as its first pixel comes into view, then on every change of section.
  util.whenVisible(plot, () => {
    panel.dataset.shown = '1';
    if (!plot.classList.contains('is-pending')) return;
    plot.classList.remove('is-pending');
    if (!reduce() && els) for (const el of [els.gDrawn, els.gLab]) el.classList.add('is-wipe');
  }, '0px');

  // Region data (notes, full names) once the plate is near, the locator map a little later.
  util.whenVisible(root, () => { state.wantRegion = true; loadRegionInfo(); }, '600px');
  util.whenVisible(mapBox, initMini, '300px');

  // Full INAO names, and which feature ids the atlas map can open.
  data.index().then(idx => {
    state.index = new Map((idx.features || []).map(f => [f.id, f]));
    renderSel();
    renderTable();
  }).catch(() => {});
}
