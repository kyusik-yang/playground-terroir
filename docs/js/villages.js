// Plate IV, part two: the fifteen village profiles.
// Each card is a wine label on top and an atlas fact block below. Every number on a card is
// computed from data/villages.json at runtime. Curated text is shown exactly as written there.
// Also exports a few small helpers that hierarchy.js shares (level parts, ordering, radio segs).

import { h, s, fmt, LEVELS, REGIONS, aspectRose, aspectWord, fold, reducedMotion, tip, debounce, scrollToId } from './util.js';

/* ==========================================================================
   Shared helpers (imported by hierarchy.js)
   ========================================================================== */

/** Exclusive levels in villages.json stats, highest first. */
export const LV = [
  { key: 'grand_cru', id: 'grand-cru', word: 'grand cru' },
  { key: 'premier_cru', id: 'premier-cru', word: 'premier cru' },
  { key: 'village', id: 'village', word: 'village' },
];

const regionIdx = id => { const i = REGIONS.findIndex(r => r.id === id); return i < 0 ? 99 : i; };

/** North to south: region order first, then the latitude of the village's map marker. */
export function northToSouth(a, b) {
  return (regionIdx(a.region) - regionIdx(b.region)) || ((b.marker?.[0] ?? 0) - (a.marker?.[0] ?? 0));
}

/** Hectares and shares for the three exclusive levels. Shares use the sum of the levels. */
export function levelParts(v) {
  const a = v.stats?.area_ha || {};
  const sum = LV.reduce((t, l) => t + (a[l.key] || 0), 0);
  return LV.map(l => ({ ...l, ha: a[l.key] || 0, share: sum > 0 ? (a[l.key] || 0) / sum * 100 : 0 }));
}

/**
 * Grand cru land that one profile shares with another. Grand cru land is counted by commune, so a
 * commune profile can hold part of a grand cru that is also profiled on its own as an appellation
 * (Corton-Charlemagne). The match is a grand cru feature id in one profile that is the appellation
 * feature of another. Two commune profiles that each hold their own part of one grand cru (Montrachet
 * in Puligny and in Chassagne) do not overlap and are not matched. Corton-Charlemagne lists its own
 * shape as its one grand cru, so a profile is never matched with itself.
 * Returns [{ a, b, g }]: a lists grand cru g, and g is the whole of profile b.
 */
export function overlaps(V) {
  const out = [];
  for (const a of V) {
    for (const g of a.stats?.grand_crus || []) {
      if (!g.id) continue;
      const b = V.find(x => x !== a && (x.featureIds?.appellation || []).includes(g.id));
      if (b) out.push({ a, b, g });
    }
  }
  return out;
}

/**
 * The figure row a reader came from when a figure row opened a card. hierarchy.js records it just before
 * it emits village:focus, so the card can offer a way back. Cleared once used.
 */
let origin = null;
export function noteOrigin(el, label) { origin = el ? { el, label } : null; }

/**
 * Region changes that stay inside this plate. Opening a card that the region filter hides widens the
 * cards to All. That is not a region choice, so it is not broadcast as region:select (the map would
 * leave the region and close its panel). hierarchy.js listens here so its figures stop dimming.
 */
const plateRegion = new Set();
export function onPlateRegion(fn) { plateRegion.add(fn); return () => plateRegion.delete(fn); }

/** Price bands as written in the profiles ("$$-$$$$"), shown with an en dash as every other range is. */
const band = str => String(str || '').replace(/-/g, '–');

/** Percent text that never rounds a real sliver down to zero. */
export const pctText = p => (p > 0 && p < 1 ? '<1%' : fmt.pct(p));

export const listText = (() => {
  const lf = typeof Intl.ListFormat === 'function' ? new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' }) : null;
  return arr => (lf ? lf.format(arr) : arr.join(', '));
})();

const NUM_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen'];
/** Small counts as words, larger ones as figures. */
export const countWord = n => NUM_WORDS[n] || fmt.num(n);
export const cap1 = str => str.charAt(0).toUpperCase() + str.slice(1);

/**
 * Accessible single-choice segmented control (role="radiogroup", roving tabindex, arrow keys).
 * Returns { el, set(value), get() }. set() never calls onChange.
 */
export function radioSeg({ label, options, value, onChange, className = '' }) {
  let current = value;
  const el = h('div', { class: `seg ${className}`.trim(), attrs: { role: 'radiogroup', 'aria-label': label } });
  const btns = options.map(o => h('button', {
    text: o.text,
    dataset: { value: o.value },
    attrs: { type: 'button', role: 'radio', 'aria-checked': String(o.value === value), tabindex: o.value === value ? '0' : '-1' },
    on: { click: () => choose(o.value, true) },
  }));
  el.append(...btns);
  el.addEventListener('keydown', e => {
    const i = btns.findIndex(b => b.dataset.value === current);
    let j = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % btns.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + btns.length) % btns.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = btns.length - 1;
    if (j == null) return;
    e.preventDefault();
    choose(btns[j].dataset.value, true);
    btns[j].focus();
  });
  function choose(v, fromUser) {
    if (!btns.some(b => b.dataset.value === v)) return;
    const changed = v !== current;
    current = v;
    btns.forEach(b => {
      const on = b.dataset.value === v;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    if (fromUser && changed) onChange(v);
  }
  return { el, set: v => choose(v, false), get: () => current };
}

/** Show the shared tooltip next to an element (keyboard focus uses the same content as hover). */
export function tipAt(el, content) {
  const r = el.getBoundingClientRect();
  tip.show({ clientX: Math.min(r.right, innerWidth - 40) - 24, clientY: r.top + r.height / 2 }, content);
}

/** Tooltip body: a bold heading and value lines. Lines are [value, label] pairs or plain strings. */
export function tipBody(title, lines) {
  return h('div', { class: 'vl-tipbody' },
    h('b', { text: title }),
    ...lines.map(l => Array.isArray(l)
      ? h('div', {}, h('span', { class: 'vl-tipv', text: l[0] }), ' ', h('span', { class: 'vl-tipk', text: l[1] }))
      : h('div', { class: 'vl-tipk', text: l })));
}

/**
 * A second, official count of premier cru climats, when villages.json carries one (climatsOfficial).
 * INAO's digital delimitation does not name every climat, so for these villages the INAO count is shown
 * next to the official one with its source. Returns null when there is none.
 */
export function officialClimats(v) {
  const o = v.climatsOfficial;
  if (!o || !Number.isFinite(o.count) || !o.label) return null;
  const tag = (String(o.label).match(/\(([^()]+)\)\s*$/) || [])[1] || 'Official';
  return { ...o, tag };
}

/** "2026-09-25" -> "25 September 2026" (the string itself when it is not a plain date). */
export function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return iso || '';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
}

const HIST_DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** Directions ranked by their share of sloping ground, from an 8-way histogram. */
export function rankedFacings(hist) {
  if (!Array.isArray(hist) || !hist.some(x => x > 0)) return [];
  return hist.map((x, i) => ({ label: HIST_DIRS[i], share: x * 100 })).filter(d => d.share > 0).sort((a, b) => b.share - a.share);
}
/** The direction with the largest share of sloping ground. */
export const dominantFacing = hist => rankedFacings(hist)[0] || null;

/** Sentence-case level name used everywhere in this plate: "Grand cru", "Premier cru", "Village". */
export const levelName = id => cap1((LV.find(l => l.id === id) || { word: id }).word);

/* ==========================================================================
   Village profiles
   ========================================================================== */

const FLAVOURS = [['mineral', 'Mineral'], ['citrus', 'Citrus'], ['oak', 'Oak'], ['body', 'Body'], ['floral', 'Floral']];
const SORTS = [
  { value: 'ns', text: 'North to south', phrase: 'from north to south' },
  { value: 'area', text: 'Largest delimited area', phrase: 'largest delimited area first' },
  { value: 'elev', text: 'Highest mean elevation', phrase: 'highest mean elevation first' },
  { value: 'price', text: 'Price band, low to high', phrase: 'lowest price band first' },
];
const MAX_COMPARE = 3;
const SHAPES = ['circle', 'square', 'diamond'];

/** "$$-$$$$" -> midpoint of the dollar counts, ties broken by the upper bound. Unknown sorts last. */
function priceKey(v) {
  const parts = String(v.priceRange || '').split(/[-–]/).map(p => (p.match(/\$/g) || []).length).filter(Boolean);
  if (!parts.length) return Infinity;
  const lo = Math.min(...parts), hi = Math.max(...parts);
  return (lo + hi) / 2 + hi / 100;
}

const ICON_PIN = () => s('svg', { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4 },
  s('path', { d: 'M8 14.5s-4.5-4.3-4.5-7.8a4.5 4.5 0 0 1 9 0c0 3.5-4.5 7.8-4.5 7.8z' }), s('circle', { cx: 8, cy: 6.6, r: 1.6 }));
const ICON_PLUS = () => s('svg', { viewBox: '0 0 16 16', width: 12, height: 12, 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', class: 'vl-ico-plus' },
  s('path', { d: 'M8 3v10M3 8h10' }));
const ICON_CHECK = () => s('svg', { viewBox: '0 0 16 16', width: 12, height: 12, 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'vl-ico-check' },
  s('path', { d: 'M3.2 8.4l3 3 6.6-7' }));
const ICON_OUT = () => s('svg', { viewBox: '0 0 16 16', width: 10, height: 10, 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'vl-ico-out' },
  s('path', { d: 'M6 3h7v7M13 3L4 12' }));
const ICON_X = () => s('svg', { viewBox: '0 0 16 16', width: 12, height: 12, 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round' },
  s('path', { d: 'M4 4l8 8M12 4l-8 8' }));
const ICON_DOWN = () => s('svg', { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'vl-ico-down' },
  s('path', { d: 'M3.5 6l4.5 4.5L12.5 6' }));
const ICON_UP = () => s('svg', { viewBox: '0 0 16 16', width: 12, height: 12, 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'vl-ico-up' },
  s('path', { d: 'M8 13V3M3.5 7.5L8 3l4.5 4.5' }));

/** Which levels hold delimited land, as three small pips on the label (filled when present). */
function levelPips(v) {
  const parts = levelParts(v);
  const present = parts.filter(p => p.ha > 0);
  const aria = present.length === 1 ? `${cap1(present[0].word)} land only` : `Includes ${listText(present.map(p => p.word))} land`;
  return h('span', { class: 'vl-lvls', attrs: { role: 'img', 'aria-label': aria, title: aria } },
    parts.map(p => h('span', { class: 'vl-lvl', dataset: { level: p.id, on: String(p.ha > 0) }, attrs: { 'aria-hidden': 'true' } },
      h('i', { class: 'vl-lvl-dot' }), LEVELS[p.id].short)));
}

/** Series key for the comparison: a short line with the slot's marker shape. */
function keyGlyph(slot, size = 22) {
  const svg = s('svg', { viewBox: `0 0 ${size} 12`, width: size, height: 12, 'aria-hidden': 'true', class: `vl-key vl-series-${slot}` });
  svg.append(s('line', { x1: 1, y1: 6, x2: size - 1, y2: 6, class: 'vl-key-line' }));
  svg.append(marker(SHAPES[slot], size / 2, 6, 4, 'vl-key-mark'));
  return svg;
}

function marker(shape, x, y, r, cls) {
  if (shape === 'square') return s('rect', { x: x - r * 0.9, y: y - r * 0.9, width: r * 1.8, height: r * 1.8, class: cls });
  if (shape === 'diamond') return s('path', { d: `M${x},${y - r * 1.25} L${x + r * 1.25},${y} L${x},${y + r * 1.25} L${x - r * 1.25},${y} Z`, class: cls });
  return s('circle', { cx: x, cy: y, r, class: cls });
}

export async function init(mount, ctx) {
  const { bus, data } = ctx;
  const doc = await data.villages();
  const V = [...doc.villages].sort(northToSouth);
  const byId = new Map(V.map(v => [v.id, v]));
  const nsIndex = new Map(V.map((v, i) => [v.id, i + 1]));
  const OVERLAPS = overlaps(V);

  const state = { region: 'all', sort: 'ns', q: '', compare: [] };
  const slots = new Map(); // compare id -> stable colour slot (colour follows the village, not its position)

  /* ---------- Toolbar ---------- */
  const regionSeg = radioSeg({
    label: 'Region',
    className: 'vl-regions',
    options: [{ value: 'all', text: 'All' }, ...REGIONS.map(r => ({ value: r.id, text: r.name }))],
    value: 'all',
    onChange: v => { state.region = v; revealRegionButton(); apply({ announce: true }); bus.emit('region:select', { region: v, source: 'villages' }); },
  });
  // On a narrow screen the region control scrolls on one line inside its pill, as the map's does,
  // with a fade on the side that has more to show.
  const regWrap = h('div', { class: 'vl-regions-wrap' }, regionSeg.el);
  const regionCue = () => {
    const max = regWrap.scrollWidth - regWrap.clientWidth;
    regWrap.classList.toggle('can-l', regWrap.scrollLeft > 2);
    regWrap.classList.toggle('can-r', regWrap.scrollLeft < max - 2);
  };
  regWrap.addEventListener('scroll', regionCue, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(debounce(regionCue, 100)).observe(regWrap);
  const sortSel = h('select', { class: 'input', id: 'vl-sort', on: { change: e => { state.sort = e.target.value; apply({ announce: true }); } } },
    SORTS.map(o => h('option', { value: o.value, text: o.text })));
  const runQuery = debounce(() => { state.q = qInput.value; apply({ announce: true }); }, 140);
  const qInput = h('input', {
    class: 'input', id: 'vl-q', type: 'search', autocomplete: 'off', spellcheck: false,
    attrs: { placeholder: 'Name, commune, producer, tag', 'aria-describedby': 'vl-count' },
    on: { input: () => { qClear.hidden = !qInput.value; runQuery(); } },
  });
  // The native search cancel button is hidden in CSS (it draws in the browser's own blue), so this one replaces it.
  const qClear = h('button', { class: 'vl-q-clear', hidden: true, attrs: { type: 'button', 'aria-label': 'Clear the filter' },
    on: { click: () => { qInput.value = ''; qClear.hidden = true; state.q = ''; apply({ announce: true }); qInput.focus(); } } }, ICON_X());
  // The count is not a live region. It is announced through `status` only when this plate's own controls
  // change it, so a region picked on the map does not queue an announcement here.
  const count = h('p', { class: 'vl-count caption', id: 'vl-count' });
  const live = h('p', { class: 'visually-hidden', attrs: { 'aria-live': 'assertive' } });
  const status = h('p', { class: 'visually-hidden', attrs: { role: 'status' } });

  const toolbar = h('div', { class: 'vl-toolbar' },
    h('div', { class: 'field vl-field-region' }, h('span', { class: 'label', id: 'vl-region-label', text: 'Region' }), regWrap),
    h('div', { class: 'field vl-field-sort' }, h('label', { attrs: { for: 'vl-sort' }, text: 'Sort' }), sortSel),
    h('div', { class: 'field vl-field-q' }, h('label', { attrs: { for: 'vl-q' }, text: 'Filter' }), h('div', { class: 'vl-q-wrap' }, qInput, qClear)));
  regionSeg.el.setAttribute('aria-labelledby', 'vl-region-label');
  regionSeg.el.removeAttribute('aria-label');

  /* ---------- Cards ---------- */
  const grid = h('ul', { class: 'vl-grid', attrs: { role: 'list', 'aria-label': 'Village profiles' } });
  const cards = V.map(v => buildCard(v));
  grid.append(...cards.map(c => c.li));

  const clearBtn = h('button', { class: 'link-btn', attrs: { type: 'button' }, text: 'Clear the filters', on: { click: () => resetFilters(true) } });
  const empty = h('div', { class: 'vl-empty', hidden: true },
    h('p', { class: 'vl-empty-title', text: 'No profile matches.' }),
    h('p', { class: 'caption' }, 'Try another name, commune, producer or tag. ', clearBtn));

  const withOfficial = V.map(v => ({ v, off: officialClimats(v) })).filter(x => x.off);
  const caveats = h('div', { class: 'vl-caveats' },
    h('p', { class: 'caveat', text: 'Named premier cru climats counts the premier cru climats named in INAO’s digital delimitation. INAO’s digital delimitation does not yet name every climat. In Chablis only ten premier cru climats are digitised by name, all outside the commune of Chablis itself. Several climat names nest, for example Morgeot contains Les Brussonnes and La Boudriotte.' }),
    ...withOfficial.map(({ v, off }) => h('p', { class: 'caveat' },
      `For ${v.name} the card also gives the number of ${off.label}.`,
      off.quote ? ` The source page${off.accessed ? `, accessed ${longDate(off.accessed)},` : ''} reads “${off.quote}”` : '')),
    h('p', { class: 'caveat', text: 'Measured facts are computed from INAO delimited areas and the IGN RGE ALTI elevation model. Delimited land is not the same as planted vineyard. The facing rose shows the share of ground sloping at least 2 degrees that faces each of eight directions. The level pips on each label show which levels of land the profile holds, not the level of its appellation.' }),
    h('p', { class: 'caveat', text: 'Style, tags, tasting profile, food, producers, price band and notes are editorial and subjective.' }));

  /* ---------- Compare tray and dialog ---------- */
  const trayList = h('ul', { class: 'vl-tray-list', attrs: { role: 'list' } });
  const openBtn = h('button', { class: 'btn btn-sm', hidden: true, attrs: { type: 'button' }, on: { click: openCompare } });
  const trayHint = h('p', { class: 'vl-tray-hint', text: 'Add one more to compare' });
  const clearCmp = h('button', { class: 'btn btn-ghost btn-sm', attrs: { type: 'button' }, text: 'Clear', on: { click: () => {
    const last = state.compare[state.compare.length - 1];
    state.compare = []; slots.clear(); syncCompare(true);
    say('The comparison is empty.');
    focusCompareButton(last);
  } } });
  const tray = h('div', { class: 'vl-tray', hidden: true, attrs: { role: 'region', 'aria-label': 'Comparison tray' } },
    h('p', { class: 'eyebrow vl-tray-k', text: 'Compare' }), trayList, h('div', { class: 'vl-tray-actions' }, trayHint, openBtn, clearCmp));

  const dlgBody = h('div', { class: 'vl-dlg-body' });
  const dlgTitle = h('h3', { id: 'vl-dlg-title', class: 'vl-dlg-title' });
  const dlgClose = h('button', { class: 'vl-dlg-close', attrs: { type: 'button', 'aria-label': 'Close comparison' }, on: { click: () => dlg.close() } }, ICON_X());
  const dlgHead = h('div', { class: 'vl-dlg-head' }, h('div', {}, h('p', { class: 'eyebrow', text: 'Comparison' }), dlgTitle), dlgClose);
  const dlg = h('dialog', { class: 'vl-dialog', attrs: { 'aria-labelledby': 'vl-dlg-title' } },
    h('div', { class: 'vl-dlg-inner' }, dlgHead, dlgBody));
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => { tip.hide(); (openBtn.isConnected && !tray.hidden && !openBtn.hidden ? openBtn : null)?.focus(); });
  // The header stays pinned while the dialog scrolls. The radar pins just below it on wide screens.
  if ('ResizeObserver' in window) new ResizeObserver(() => dlg.style.setProperty('--vl-dlg-head-h', `${dlgHead.offsetHeight}px`)).observe(dlgHead);
  // A table column too narrow for a label column plus one column per profile gets the stacked table
  // (label above the values). The choice follows the column's own width, so it is re-made on resize.
  if ('ResizeObserver' in window) new ResizeObserver(debounce(() => {
    const col = dlgBody.querySelector('.vl-ctable-col');
    if (dlg.open && col && String(isNarrow(col)) !== col.dataset.narrow) fillTable(col);
  }, 80)).observe(dlgBody);

  const head = h('div', { class: 'vl-head' },
    h('p', { class: 'eyebrow vl-head-k', text: 'Village profiles' }),
    h('p', { class: 'vl-head-sub', text: 'A label for each appellation, then what the maps and the elevation model measure, then the tasting notes.' }));
  const app = h('div', { class: 'vl-app' }, head, toolbar, count, live, status, grid, empty, tray, caveats, dlg);
  mount.replaceChildren(app);

  apply({ animate: false });
  syncCompare(false);

  /* While the sticky tray is on screen, focus and scrollIntoView keep clear of it. */
  let trayInView = false;
  const syncScrollPad = () => {
    const on = !tray.hidden && trayInView;
    document.documentElement.style.scrollPaddingBottom = on ? `${tray.offsetHeight + 32}px` : '';
  };
  if ('IntersectionObserver' in window) new IntersectionObserver(es => { trayInView = es.some(e => e.isIntersecting); syncScrollPad(); }).observe(grid);
  if ('ResizeObserver' in window) new ResizeObserver(syncScrollPad).observe(tray);

  /* ---------- Bus ---------- */
  bus.on('region:select', p => { if (p && p.source !== 'villages') setRegion(p.region); });
  bus.on('village:focus', p => { if (p) focusVillage(p); });
  bus.on('compare:change', p => {
    const ids = (p?.ids || []).filter(id => byId.has(id)).slice(0, MAX_COMPARE);
    if (ids.join('|') === state.compare.join('|')) return;
    state.compare = ids;
    for (const id of [...slots.keys()]) if (!ids.includes(id)) slots.delete(id);
    syncCompare(false);
  });
  // Catch up with anything emitted before this module finished loading.
  const lastRegion = bus.last('region:select');
  if (lastRegion && lastRegion.source !== 'villages') setRegion(lastRegion.region);
  const lastFocus = bus.last('village:focus');
  if (lastFocus) focusVillage({ ...lastFocus, reveal: lastFocus.reveal === 'card' ? 'card' : undefined });

  /* ======================================================================
     Card
     ====================================================================== */
  function buildCard(v) {
    const st = v.stats || {};
    const all = st.all || {};
    const parts = levelParts(v);
    const nameId = `vl-name-${v.id}`;
    const [emin, emean, emax] = all.elev || [];
    const producers = Array.isArray(v.producers) ? v.producers : [];
    const apps = Array.isArray(v.apps) ? v.apps : [];
    const showApps = apps.length > 1 || (apps.length === 1 && fold(apps[0]) !== fold(v.name));

    /* Label */
    // The name size steps down with its length (see .vl-name), so a long compound name such as
    // Chassagne-Montrachet stays on one line instead of breaking at its hyphen.
    const name = h('h3', { class: 'vl-name', id: nameId, text: v.name });
    name.style.setProperty('--vl-n', String(Math.max(1, String(v.name || '').length)));
    const label = h('div', { class: 'vl-label' },
      h('div', { class: 'vl-label-inner' },
        h('div', { class: 'vl-label-top' },
          h('span', { class: 'vl-no num', text: String(nsIndex.get(v.id)).padStart(2, '0'), attrs: { 'aria-hidden': 'true' } }),
          levelPips(v)),
        h('div', { class: 'vl-label-main' },
          h('p', { class: 'eyebrow vl-region', text: v.regionName || '' }),
          name,
          showApps ? h('p', { class: 'vl-apps', text: apps.join(' · ') }) : null,
          producers[0] ? h('p', { class: 'vl-producer', text: producers[0] }) : null,
          v.grape ? h('p', { class: 'vl-grape' }, h('span', { text: v.grape })) : null)));

    /* Measured block */
    const present = parts.filter(p => p.ha > 0);
    const stackLabel = `Delimited land by level. ${present.map(p => `${cap1(p.word)} ${fmt.ha(p.ha)}, ${pctText(p.share)}`).join('. ')}.`;
    const stack = h('div', { class: 'vl-stack', attrs: { role: 'img', 'aria-label': stackLabel } },
      present.map(p => h('span', { class: 'vl-stack-seg', dataset: { level: p.id }, style: { flexGrow: String(p.ha) } })));
    const stackKey = h('dl', { class: 'vl-stack-key' },
      parts.map(p => h('div', { class: p.ha > 0 ? '' : 'is-zero' },
        h('dt', {}, h('span', { class: 'swatch', dataset: { level: p.id }, attrs: { 'aria-hidden': 'true' } }), levelName(p.id)),
        h('dd', { class: 'num' }, p.ha > 0 ? fmt.ha(p.ha) : 'none', p.ha > 0 ? h('span', { class: 'vl-share', text: pctText(p.share) }) : null))));

    // Facing: the rose plus the two largest wedges. The vector-mean bearing is left to the comparison table,
    // because on ground that faces several ways it can point where few slopes face.
    const [f1, f2] = rankedFacings(all.aspect_hist);
    const rose = h('div', { class: 'vl-rose' },
      aspectRose(all.aspect_hist, { size: 88, color: 'currentColor', title: `Share of ${v.name} ground sloping at least 2 degrees that faces each direction` }));
    const facts = h('dl', { class: 'vl-facts' },
      fact('Elevation', fmt.mRange(emin, emax)),
      fact('Mean elevation', fmt.m(emean)),
      fact('Mean slope', fmt.deg(all.slope)),
      fact('Named premier cru climats', climatCount(v)));
    const climatFootnote = climatNote(v);
    const facing = h('div', { class: 'vl-facing' }, rose,
      h('dl', { class: 'vl-facing-dl' },
        f1 ? fact('Most common facing', `${aspectWord(f1.label)}, ${pctText(f1.share)} of sloping ground`) : fact('Facing', 'flat'),
        f2 ? fact('Next most common', `${aspectWord(f2.label)}, ${pctText(f2.share)}`) : null));

    const gcs = Array.isArray(st.grand_crus) ? st.grand_crus : [];
    // A grand cru appellation profiled on its own (Corton-Charlemagne) would only list itself, so the list is skipped.
    // Its one grand cru id is the profile's own appellation feature, which "On the map" already opens.
    const selfOnly = gcs.length === 1 && (gcs[0].id
      ? (v.featureIds?.appellation || []).includes(gcs[0].id)
      : fold(gcs[0].name) === fold(v.name));
    // Many short names flow into two columns. Long hyphenated names keep one ruled column so they never break.
    const flow = gcs.length > 2 && gcs.every(g => String(g.name).length <= 12);
    // Grand cru land that is also counted in another profile, in either direction.
    const sharedOut = OVERLAPS.filter(o => o.a === v);
    const sharedIn = OVERLAPS.filter(o => o.b === v);
    const gcBlock = gcs.length && !selfOnly ? h('div', { class: 'vl-gc' },
      h('p', { class: 'vl-sub', text: gcs.length === 1 ? 'Grand cru' : `Grand crus (${gcs.length})` }),
      h('ul', { class: `vl-gc-list${flow ? ' is-flow' : ''}`, attrs: { role: 'list' } }, gcs.map(g => h('li', {},
        g.id
          ? h('button', { class: 'link-btn vl-gc-link', attrs: { type: 'button', 'aria-label': `${g.name}, ${fmt.ha(g.area_ha)}. Show on the map` }, text: g.name,
              on: { click: () => { bus.emit('feature:focus', { id: g.id, source: 'villages' }); scrollToId('map'); } } })
          : h('span', { text: g.name }),
        h('span', { class: 'num', text: fmt.ha(g.area_ha) })))),
      sharedOut.map(o => h('p', { class: 'vl-overlap' },
        `The ${fmt.ha(o.g.area_ha)} of ${o.g.name} here are also counted in the `, profileLink(o.b), ' profile.'))) : null;
    const inNote = sharedIn.map(o => h('p', { class: 'vl-overlap' },
      `Includes the ${fmt.ha(o.g.area_ha)} counted as grand cru land in the `, profileLink(o.a), ' profile.'));

    // On a phone a card shows its label, the delimited land bar and its actions. The terrain facts, the
    // grand crus and the editorial block sit behind this disclosure (CSS hides it on wider screens,
    // where everything is shown).
    const moreId = `vl-more-${v.id}`, edId = `vl-ed-${v.id}`;
    const moreText = cap1(listText(['terrain', gcBlock ? 'grand crus' : null, 'tasting notes'].filter(Boolean)));
    const moreBtn = h('button', { class: 'vl-more-btn', attrs: { type: 'button', 'aria-expanded': 'false', 'aria-controls': `${moreId} ${edId}` } },
      h('span', {}, moreText, h('span', { class: 'visually-hidden', text: ` for ${v.name}` })), ICON_DOWN());

    const measured = h('div', { class: 'vl-measured', attrs: { role: 'group', 'aria-label': `${v.name}, measured` } },
      h('p', { class: 'vl-kicker' }, h('span', { class: 'eyebrow', text: 'Measured' })),
      h('div', { class: 'vl-area' },
        h('div', { class: 'vl-area-head' }, h('span', { class: 'vl-sub', text: 'Delimited land' }), h('span', { class: 'vl-total display-num', text: fmt.ha(st.area_ha?.total) })),
        stack, stackKey, inNote),
      moreBtn,
      h('div', { class: 'vl-more', id: moreId }, facts, climatFootnote, facing, gcBlock));

    /* Editorial block */
    const flavour = v.flavor || {};
    const taste = h('div', { class: 'vl-taste', attrs: { role: 'img', 'aria-label': `Tasting profile, editorial, scored out of 100. ${FLAVOURS.map(([k, t]) => `${t} ${flavour[k] ?? 'not scored'}`).join(', ')}.` } },
      FLAVOURS.map(([k, t]) => h('span', { class: 'vl-taste-row', attrs: { 'aria-hidden': 'true' } },
        h('span', { class: 'vl-taste-k', text: t }),
        h('span', { class: 'vl-taste-track' }, h('span', { class: 'vl-taste-bar', style: { width: `${Math.max(0, Math.min(100, flavour[k] || 0))}%` } })),
        h('span', { class: 'vl-taste-v num', text: flavour[k] ?? '–' }))));
    const edDl = h('dl', { class: 'vl-ed-dl' },
      v.foodPairing ? [h('dt', { text: 'Food' }), h('dd', { text: v.foodPairing })] : null,
      producers.length ? [h('dt', { text: 'Producers' }), h('dd', { class: 'vl-producers', text: producers.join(', ') })] : null,
      v.priceRange ? [h('dt', { text: 'Price band' }), h('dd', { class: 'num', text: band(v.priceRange) })] : null);
    const editorial = h('div', { class: 'vl-editorial vl-more', id: edId, attrs: { role: 'group', 'aria-label': `${v.name}, editorial` } },
      h('p', { class: 'vl-kicker' }, h('span', { class: 'eyebrow', text: 'Editorial' })),
      v.style ? h('p', { class: 'vl-style', text: v.style }) : null,
      Array.isArray(v.tags) && v.tags.length ? h('ul', { class: 'vl-tags', attrs: { role: 'list', 'aria-label': 'Tags' } }, v.tags.map(t => h('li', { class: 'chip', text: t }))) : null,
      h('div', { class: 'vl-taste-block' }, h('h4', { class: 'vl-sub', text: 'Tasting profile (editorial)' }), taste),
      edDl,
      v.note ? h('p', { class: 'note vl-note', text: v.note }) : null);

    /* Actions */
    const mapBtn = h('button', { class: 'btn btn-ghost btn-sm', attrs: { type: 'button', 'aria-label': `Show ${v.name} on the map` },
      on: { click: () => bus.emit('village:focus', { id: v.id, reveal: 'map', source: 'villages' }) } }, ICON_PIN(), 'On the map');
    const cmpBtn = h('button', { class: 'btn btn-ghost btn-sm vl-cmp-btn', attrs: { type: 'button', 'aria-pressed': 'false', 'aria-label': `Compare ${v.name}` },
      on: { click: () => toggleCompare(v.id) } }, ICON_PLUS(), ICON_CHECK(), h('span', { text: 'Compare' }));

    const back = h('div', { class: 'vl-back-slot' });
    // Three rows (label, body, actions) that line up across each row of cards, see .vl-grid.
    const article = h('article', { class: 'vl-card', id: `village-${v.id}`, attrs: { 'aria-labelledby': nameId, tabindex: '-1' } },
      h('div', { class: 'vl-top' }, back, label),
      h('div', { class: 'vl-body' }, measured, editorial),
      h('div', { class: 'vl-actions' }, mapBtn, cmpBtn));
    const li = h('li', { class: 'vl-cell', dataset: { id: v.id } }, article);

    const hay = fold([v.name, v.regionName, v.grape, ...apps, ...(v.communes || []), ...producers, ...(v.tags || []), v.foodPairing, ...gcs.map(g => g.name)].join(' '));
    const card = { v, li, article, cmpBtn, back, moreBtn, hay };
    moreBtn.addEventListener('click', () => setOpen(card, moreBtn.getAttribute('aria-expanded') !== 'true'));
    return card;
  }

  /** Open or close a card's disclosure (it only hides anything on a phone). */
  function setOpen(c, open) {
    c.moreBtn.setAttribute('aria-expanded', String(open));
    c.article.classList.toggle('is-open', open);
  }

  function fact(k, val) {
    return h('div', { class: 'vl-fact' }, h('dt', { text: k }), h('dd', {}, val));
  }

  /** A profile name that opens that profile's card. */
  function profileLink(p) {
    return h('button', { class: 'link-btn vl-plink', attrs: { type: 'button' }, text: p.name,
      on: { click: () => bus.emit('village:focus', { id: p.id, reveal: 'card', source: 'villages' }) } });
  }

  /**
   * The named premier cru climat count. Usually INAO's number alone. When villages.json also carries an
   * official count (climatsOfficial), both are shown, each tagged with its source.
   */
  function climatCount(v) {
    const raw = v.stats?.n_climats;
    const n = raw === 0 ? 'none' : fmt.num(raw ?? null);
    const off = officialClimats(v);
    if (!off) return n;
    return h('span', { class: 'vl-cl' },
      h('span', { class: 'vl-cl-row' }, h('span', { class: 'vl-cl-n', text: n }), h('span', { class: 'vl-cl-src', text: 'INAO' })),
      h('span', { class: 'vl-cl-row' }, h('span', { class: 'vl-cl-n', text: fmt.num(off.count) }), h('span', { class: 'vl-cl-src', text: off.tag })));
  }

  /** Explains the two counts and links the official source. `lead` names the village when shown outside its card. */
  function climatNote(v, lead = '') {
    const off = officialClimats(v);
    if (!off) return null;
    const src = off.url
      ? h('a', { href: off.url, target: '_blank', rel: 'noopener' }, off.label, ICON_OUT(), h('span', { class: 'visually-hidden', text: ' (opens in a new tab)' }))
      : off.label;
    return h('p', { class: 'vl-cl-note' },
      `${lead}${lead ? 'the' : 'The'} INAO figure comes from INAO’s digital delimitation, which does not yet name every climat. The ${off.tag} figure is the number of `,
      src, off.accessed ? `, accessed ${longDate(off.accessed)}.` : '.');
  }

  /* ======================================================================
     Filtering and ordering
     ====================================================================== */
  function matches(c) {
    if (state.region !== 'all' && c.v.region !== state.region) return false;
    const toks = fold(state.q).split(/\s+/).filter(Boolean);
    return toks.every(t => c.hay.includes(t));
  }

  function sorted() {
    const list = [...cards];
    const key = {
      ns: null,
      area: c => -(c.v.stats?.area_ha?.total ?? 0),
      elev: c => -(c.v.stats?.all?.elev?.[1] ?? 0),
      price: c => priceKey(c.v),
    }[state.sort];
    if (key) list.sort((a, b) => (key(a) - key(b)) || northToSouth(a.v, b.v));
    return list;
  }

  function apply({ animate = true, announce = false } = {}) {
    const order = sorted();
    const doAnimate = animate && !reducedMotion() && isNearViewport(grid);
    const before = doAnimate ? new Map(cards.filter(c => !c.li.hidden).map(c => [c, c.li.getBoundingClientRect()])) : null;

    let shown = 0;
    order.forEach(c => { c.li.hidden = !matches(c); if (!c.li.hidden) shown++; });
    const current = [...grid.children];
    if (order.some((c, i) => current[i] !== c.li)) grid.append(...order.map(c => c.li));

    empty.hidden = shown > 0;
    // The 01 to 15 label numbers follow north to south, so they are hidden under the other sorts where they would read as ranks.
    grid.classList.toggle('is-resorted', state.sort !== 'ns');
    const total = cards.length;
    const phrase = SORTS.find(o => o.value === state.sort).phrase;
    count.textContent = shown === total ? `All ${countWord(total)} profiles, ${phrase}.`
      : shown === 0 ? 'No profile matches the current filters.'
        : `Showing ${countWord(shown)} of ${countWord(total)} profiles, ${phrase}.`;
    if (announce) say(count.textContent);

    if (doAnimate) {
      for (const c of order) {
        if (c.li.hidden) continue;
        const a = before.get(c), b = c.li.getBoundingClientRect();
        if (!a) { c.li.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }); continue; }
        const dx = a.left - b.left, dy = a.top - b.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
        c.li.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 480, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
      }
    }
  }

  function isNearViewport(el) {
    const r = el.getBoundingClientRect();
    return r.bottom > -200 && r.top < innerHeight + 200;
  }

  function setRegion(region, emit = false) {
    const valid = region === 'all' || REGIONS.some(r => r.id === region);
    if (!valid) return;
    state.region = region;
    regionSeg.set(region);
    revealRegionButton();
    // emit is true only for this plate's own controls ('Clear the filters'), so only then is the count announced.
    apply({ announce: emit });
    if (emit) bus.emit('region:select', { region, source: 'villages' });
  }

  /** Keep the checked region visible inside its own scroller. Never scrolls the page. */
  function revealRegionButton() {
    const b = regionSeg.el.querySelector('[aria-checked="true"]');
    if (!b || regWrap.scrollWidth <= regWrap.clientWidth) { regionCue(); return; }
    const left = b.getBoundingClientRect().left - regWrap.getBoundingClientRect().left + regWrap.scrollLeft, right = left + b.offsetWidth;
    let x = regWrap.scrollLeft;
    if (left < x + 8) x = left - 24;
    else if (right > x + regWrap.clientWidth - 8) x = right - regWrap.clientWidth + 24;
    if (x !== regWrap.scrollLeft) regWrap.scrollTo({ left: Math.max(0, x), behavior: reducedMotion() ? 'auto' : 'smooth' });
    else regionCue();
  }

  function resetFilters(focusInput) {
    state.q = '';
    qInput.value = '';
    qClear.hidden = true;
    if (state.region !== 'all') setRegion('all', true); else apply({ announce: true });
    if (focusInput) qInput.focus();
  }

  /* ======================================================================
     village:focus
     ====================================================================== */
  function focusVillage({ id, reveal, source }) {
    const c = cards.find(x => x.v.id === id);
    if (!c) return;
    cards.forEach(x => {
      x.article.classList.toggle('is-focus', x === c);
      if (x !== c) x.back.replaceChildren();
    });
    // A figure row that opened this card left its position, so the card can offer the way back.
    const from = source === 'hierarchy' && origin && origin.el.isConnected ? origin : null;
    origin = null;
    c.back.replaceChildren();
    if (reveal !== 'card') return;
    if (from) {
      c.back.append(h('button', { class: 'link-btn vl-back', attrs: { type: 'button' },
        on: { click: () => {
          c.back.replaceChildren();
          from.el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
          from.el.focus({ preventScroll: true });
        } } }, ICON_UP(), `Back to ${from.label}`));
    }
    if (c.li.hidden) {
      // The card is filtered out. Clear the text filter and widen the region so it can be seen.
      // The widening stays inside this plate (see onPlateRegion), so the map keeps its region and panel.
      state.q = ''; qInput.value = ''; qClear.hidden = true;
      if (state.region !== 'all' && state.region !== c.v.region) {
        state.region = 'all'; regionSeg.set('all'); revealRegionButton();
        plateRegion.forEach(fn => fn('all'));
      }
      apply({ animate: false });
    }
    setOpen(c, true);
    c.article.classList.remove('is-flash');
    void c.article.offsetWidth; // restart the highlight animation
    c.article.classList.add('is-flash');
    c.article.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    c.article.focus({ preventScroll: true });
  }

  /* ======================================================================
     Compare
     ====================================================================== */
  function toggleCompare(id) {
    const name = byId.get(id).name;
    const i = state.compare.indexOf(id);
    if (i >= 0) { state.compare.splice(i, 1); slots.delete(id); }
    else if (state.compare.length >= MAX_COMPARE) {
      live.textContent = '';
      live.textContent = `The comparison holds ${countWord(MAX_COMPARE)} profiles. Remove one before adding ${name}.`;
      return;
    } else state.compare.push(id);
    syncCompare(true);
    const n = state.compare.length;
    const tally = `${countWord(n)} of ${countWord(MAX_COMPARE)}`;
    if (i >= 0) say(n ? `${name} removed from the comparison, ${tally}.` : `${name} removed. The comparison is empty.`);
    else say(n < 2 ? `${name} added to the comparison, ${tally}. Add one more, then open it from the comparison tray after the list.`
      : `${name} added to the comparison, ${tally}. Open it from the comparison tray after the list.`);
  }

  /** Polite announcement for screen readers. */
  function say(text) {
    status.textContent = '';
    requestAnimationFrame(() => { status.textContent = text; });
  }

  function slotFor(id) {
    if (!slots.has(id)) {
      const used = new Set(slots.values());
      slots.set(id, [0, 1, 2].find(n => !used.has(n)) ?? 0);
    }
    return slots.get(id);
  }

  function syncCompare(emit) {
    const full = state.compare.length >= MAX_COMPARE;
    for (const c of cards) {
      const on = state.compare.includes(c.v.id);
      c.cmpBtn.setAttribute('aria-pressed', String(on));
      if (!on && full) c.cmpBtn.setAttribute('aria-disabled', 'true'); else c.cmpBtn.removeAttribute('aria-disabled');
      c.cmpBtn.title = !on && full ? `The comparison holds ${countWord(MAX_COMPARE)} profiles` : '';
      c.article.classList.toggle('is-compared', on);
    }
    state.compare.forEach(slotFor);
    renderTray();
    if (emit) bus.emit('compare:change', { ids: [...state.compare] });
    if (dlg.open) { if (state.compare.length >= 2) renderDialog(); else dlg.close(); }
  }

  function renderTray() {
    const n = state.compare.length;
    tray.hidden = n === 0;
    trayList.replaceChildren(
      ...state.compare.map(id => {
        const v = byId.get(id);
        return h('li', { class: 'vl-tray-item' },
          keyGlyph(slotFor(id), 18),
          h('span', { class: 'vl-tray-name', text: v.name }),
          h('button', { class: 'vl-tray-x', attrs: { type: 'button', 'aria-label': `Remove ${v.name} from the comparison` }, on: { click: () => removeFromTray(id) } }, ICON_X()));
      }),
      ...Array.from({ length: MAX_COMPARE - n }, () => h('li', { class: 'vl-tray-slot', attrs: { 'aria-hidden': 'true' }, text: 'Empty slot' })));
    // One profile is not yet a comparison. The tray says so in plain text and shows the button from two.
    openBtn.textContent = `Compare ${countWord(n)}`;
    openBtn.hidden = n < 2;
    trayHint.hidden = n !== 1;
  }

  function removeFromTray(id) {
    const idx = state.compare.indexOf(id);
    toggleCompare(id);
    // Keep keyboard focus inside the tray when possible.
    const xs = trayList.querySelectorAll('.vl-tray-x');
    if (xs.length) xs[Math.min(idx, xs.length - 1)].focus();
    else focusCompareButton(id);
  }

  /** When the tray empties and disappears, return focus to the card the reader last worked with. */
  function focusCompareButton(id) {
    const c = cards.find(x => x.v.id === id && !x.li.hidden) || cards.find(x => !x.li.hidden);
    if (c) c.cmpBtn.focus();
  }

  function openCompare() {
    if (state.compare.length < 2) return;
    // Open first so the table column has a width to measure, then fill it before the next paint.
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    renderDialog();
    dlgClose.focus();
  }

  const compareItems = () => state.compare.map(id => ({ v: byId.get(id), slot: slotFor(id) }));

  function renderDialog() {
    const items = compareItems();
    dlgTitle.textContent = listText(items.map(x => x.v.name));
    const col = h('div', { class: 'vl-ctable-col' });
    dlgBody.replaceChildren(
      h('figure', { class: 'vl-radar-fig' },
        radar(items),
        h('ul', { class: 'vl-legend', attrs: { role: 'list', 'aria-label': 'Legend' } },
          items.map(x => h('li', {}, keyGlyph(x.slot), h('span', { text: x.v.name })))),
        h('figcaption', { class: 'caption', text: 'Tasting profile (editorial). Subjective scores from 0 to 100, not measurements. Every score is also listed in the table.' })),
      col);
    fillTable(col);
  }

  /** A label column needs about 170 px and each profile column about 125 px. */
  function isNarrow(col) {
    return col.clientWidth < 170 + state.compare.length * 125;
  }

  function fillTable(col) {
    const narrow = isNarrow(col);
    col.dataset.narrow = String(narrow);
    col.replaceChildren(...compareTable(compareItems(), narrow));
  }

  function radar(items) {
    const size = 320, c = size / 2, R = c - 52;
    const n = FLAVOURS.length;
    const ang = i => (-90 + i * 360 / n) * Math.PI / 180;
    const pt = (i, val) => [c + R * (val / 100) * Math.cos(ang(i)), c + R * (val / 100) * Math.sin(ang(i))];
    const svg = s('svg', { viewBox: `0 0 ${size} ${size}`, class: 'vl-radar', role: 'img', 'aria-labelledby': 'vl-radar-t vl-radar-d' });
    svg.append(s('title', { id: 'vl-radar-t', text: 'Tasting profile (editorial), overlaid' }));
    svg.append(s('desc', { id: 'vl-radar-d', text: `${items.map(x => `${x.v.name} scores ${listText(FLAVOURS.map(([k, t]) => `${t.toLowerCase()} ${x.v.flavor?.[k] ?? 'not scored'}`))}`).join('. ')}.` }));
    const grid = s('g', { class: 'vl-radar-grid', 'aria-hidden': 'true' });
    [25, 50, 75, 100].forEach(r => grid.append(s('polygon', { points: FLAVOURS.map((_, i) => pt(i, r).join(',')).join(' '), class: r === 100 ? 'is-outer' : '' })));
    FLAVOURS.forEach((_, i) => { const [x, y] = pt(i, 100); grid.append(s('line', { x1: c, y1: c, x2: x, y2: y })); });
    // Ring values sit on the bisector between the first two axes, clear of every spoke.
    const mid = (ang(0) + ang(1)) / 2;
    [50, 100].forEach(r => {
      const rr = R * (r / 100) * Math.cos(Math.PI / n) + 2;
      grid.append(s('text', { x: c + rr * Math.cos(mid) + 3, y: c + rr * Math.sin(mid) - 3, class: 'vl-radar-tick', text: String(r) }));
    });
    FLAVOURS.forEach(([, t], i) => {
      const [x, y] = pt(i, 100);
      const dx = Math.cos(ang(i)), dy = Math.sin(ang(i));
      grid.append(s('text', { x: x + dx * 18, y: y + dy * 18 + 4, 'text-anchor': Math.abs(dx) < 0.2 ? 'middle' : dx > 0 ? 'start' : 'end', class: 'vl-radar-axis', text: t }));
    });
    svg.append(grid);
    for (const x of items) {
      const g = s('g', { class: `vl-radar-series vl-series-${x.slot}` });
      const pts = FLAVOURS.map(([k], i) => pt(i, x.v.flavor?.[k] ?? 0));
      g.append(s('polygon', { points: pts.map(p => p.join(',')).join(' '), class: 'vl-radar-area' }));
      pts.forEach((p, i) => {
        const [k, t] = FLAVOURS[i];
        g.append(marker(SHAPES[x.slot], p[0], p[1], 4.5, 'vl-radar-mark'));
        const hit = s('circle', { cx: p[0], cy: p[1], r: 12, class: 'vl-radar-hit' });
        const body = () => tipBody(x.v.name, [[fmt.num(x.v.flavor?.[k] ?? null), `${t.toLowerCase()}, editorial score out of 100`]]);
        hit.addEventListener('pointermove', e => tip.show(e, body()));
        hit.addEventListener('pointerleave', () => tip.hide());
        g.append(hit);
      });
      svg.append(g);
    }
    return svg;
  }

  function compareTable(items, narrow) {
    // Wide: one label column and a value column per profile. Narrow: each label sits on its own full-width
    // row above the values, so three value columns fit without sideways scrolling, and the values point at
    // their column, section and label headers with `headers`. Either way the header row stays pinned.
    const colId = i => `vl-ct-c${i}`;
    let rid = 0, sid = 0, secId = '';
    const corner = () => (narrow ? [] : [h('td', { class: 'vl-ct-corner' })]);
    const nowrap = t => h('span', { class: 'vl-nw', text: t });
    const lv = (v, key) => { const p = levelParts(v).find(q => q.key === key); return p.ha > 0 ? [nowrap(fmt.ha(p.ha)), ' · ', nowrap(pctText(p.share))] : 'none'; };
    const st = v => v.stats || {};
    const all = v => st(v).all || {};
    const facing = (v, n) => { const d = rankedFacings(all(v).aspect_hist)[n]; return d ? [`${aspectWord(d.label)}, `, nowrap(pctText(d.share))] : '–'; };
    const bearing = v => (all(v).aspect_label && all(v).aspect_label !== 'flat' ? [nowrap(`${fmt.num(all(v).aspect)}°`), `, ${aspectWord(all(v).aspect_label)}`] : 'flat');
    const section = t => {
      secId = `vl-ct-s${sid++}`;
      return h('tr', { class: 'vl-ct-sec' }, h('th', { id: secId, scope: 'rowgroup', attrs: { colspan: String(items.length + (narrow ? 0 : 1)) } }, h('span', { text: t })));
    };
    const row = (k, fn, words) => {
      const cell = (x, i, rowId) => h('td', { class: words ? 'is-words' : 'num', attrs: rowId ? { headers: `${colId(i)} ${secId} ${rowId}` } : null }, fn(x.v));
      if (!narrow) return h('tr', {}, h('th', { scope: 'row', text: k }), items.map((x, i) => cell(x, i)));
      const id = `vl-ct-r${rid++}`;
      return [h('tr', { class: 'vl-ct-k' }, h('th', { id, attrs: { colspan: String(items.length) }, text: k })),
        h('tr', { class: 'vl-ct-v' }, items.map((x, i) => cell(x, i, id)))];
    };
    const table = h('table', { class: `vl-ctable${narrow ? ' is-stacked' : ''}` },
      h('caption', { class: 'visually-hidden', text: `Measured facts and editorial notes for ${listText(items.map(x => x.v.name))}` }),
      h('thead', {},
        h('tr', {}, corner(), items.map((x, i) => h('th', { id: colId(i), scope: 'col' }, h('span', { class: 'vl-ct-head' }, keyGlyph(x.slot), h('span', { text: x.v.name }))))),
        h('tr', { class: 'vl-ct-region' }, corner(), items.map(x => h('td', { text: x.v.regionName || '' })))),
      h('tbody', {},
        section('Measured'),
        row('Delimited land', v => fmt.ha(st(v).area_ha?.total)),
        row('Grand cru', v => lv(v, 'grand_cru')),
        row('Premier cru', v => lv(v, 'premier_cru')),
        row('Village', v => lv(v, 'village')),
        row('Named premier cru climats', climatCount),
        row('Elevation', v => fmt.mRange(all(v).elev?.[0], all(v).elev?.[2])),
        row('Mean elevation', v => fmt.m(all(v).elev?.[1])),
        row('Mean slope', v => fmt.deg(all(v).slope)),
        row('Most common facing', v => facing(v, 0), true),
        row('Next most common', v => facing(v, 1), true),
        row('Mean bearing (vector mean)', bearing, true)),
      h('tbody', {},
        section('Editorial'),
        row('Grape', v => v.grape || '–', true),
        row('Price band', v => band(v.priceRange) || '–'),
        ...FLAVOURS.map(([k, t]) => row(t, v => fmt.num(v.flavor?.[k] ?? null)))));
    const notes = [
      ...items.map(x => climatNote(x.v, `In the ${x.v.name} column, `)).filter(Boolean),
      h('p', { class: 'vl-cl-note', text: 'Mean bearing is the vector mean of the directions the sloping ground faces, with steeper ground weighing more. Where the slopes face several ways it can point where few of them face, so read it next to the most common facings.' }),
    ];
    return [table, h('div', { class: 'vl-ctable-notes' }, notes)];
  }
}
