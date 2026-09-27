// Shared helpers. Every module imports from here so formatting, level names and
// small SVG widgets look the same across the atlas.

/** Create an element. props: class, text, html (trusted only), attrs {}, dataset {}, style {}, on {event: fn} */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'attrs') for (const [a, av] of Object.entries(v)) { if (av != null && av !== false) el.setAttribute(a, av === true ? '' : av); }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style') Object.assign(el.style, v);
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else el[k] = v;
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** SVG element helper, same props as h() except no text/html shortcuts for children. */
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'text') el.textContent = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c);
  return el;
}

/** Escape text for use inside template-literal HTML. */
export function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const nf0 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmt = {
  /** Hectares: 1 dp under 100 ha, integer above. */
  ha: n => n == null ? '–' : `${n < 100 ? nf1.format(n) : nf0.format(n)} ha`,
  /** Metres of elevation. */
  m: n => n == null ? '–' : `${nf0.format(n)} m`,
  /** Range of metres, e.g. "247–252 m". */
  mRange: (a, b) => (a == null || b == null) ? '–' : `${nf0.format(a)}–${nf0.format(b)} m`,
  deg: n => n == null ? '–' : `${nf1.format(n)}°`,
  pct: n => n == null ? '–' : `${nf0.format(n)}%`,
  num: (n, d = 0) => n == null ? '–' : (d === 0 ? nf0 : d === 1 ? nf1 : nf2).format(n),
  temp: n => n == null ? '–' : `${nf1.format(n)} °C`,
  signed: (n, d = 1) => n == null ? '–' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${(d === 1 ? nf1 : nf2).format(Math.abs(n))}`,
};

/** Appellation levels, highest first. `color` is a CSS custom property name. */
export const LEVELS = {
  'grand-cru': { label: 'Grand Cru', short: 'GC', color: '--lvl-gc', soft: '--lvl-gc-soft', rank: 4 },
  'premier-cru': { label: 'Premier Cru', short: '1er', color: '--lvl-pc', soft: '--lvl-pc-soft', rank: 3 },
  'village': { label: 'Village', short: 'Vil.', color: '--lvl-vl', soft: '--lvl-vl-soft', rank: 2 },
  'regional': { label: 'Regional Bourgogne', short: 'Rég.', color: '--lvl-rg', soft: '--lvl-rg-soft', rank: 1 },
  'none': { label: 'Outside AOC', short: '–', color: '--lvl-none', soft: '--lvl-none', rank: 0 },
};

export const REGIONS = [
  { id: 'chablis', name: 'Chablis' },
  { id: 'cote-de-beaune', name: 'Côte de Beaune' },
  { id: 'cote-chalonnaise', name: 'Côte Chalonnaise' },
  { id: 'maconnais', name: 'Mâconnais' },
];
export const regionName = id => (REGIONS.find(r => r.id === id) || {}).name || id;

const ASPECT_WORDS = {
  N: 'north', NNE: 'north-northeast', NE: 'northeast', ENE: 'east-northeast', E: 'east', ESE: 'east-southeast',
  SE: 'southeast', SSE: 'south-southeast', S: 'south', SSW: 'south-southwest', SW: 'southwest', WSW: 'west-southwest',
  W: 'west', WNW: 'west-northwest', NW: 'northwest', NNW: 'north-northwest', flat: 'flat',
};
/** "ESE" -> "east-southeast" */
export const aspectWord = label => ASPECT_WORDS[label] || label;

/** Read a CSS custom property from :root (resolved for the current theme). */
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
export const levelColor = level => cssVar((LEVELS[level] || LEVELS.none).color);

/** Current resolved theme: 'light' | 'dark'. */
export function theme() {
  const t = document.documentElement.dataset.theme;
  if (t === 'light' || t === 'dark') return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** URL query state (?village=meursault&climat=...). Uses replaceState so it never adds history entries. */
export function getParam(key) { return new URLSearchParams(location.search).get(key); }
export function setParam(key, value) {
  const u = new URL(location.href);
  if (value == null || value === '') u.searchParams.delete(key); else u.searchParams.set(key, value);
  history.replaceState(history.state, '', u);
}

export function debounce(fn, ms = 150) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** Accent-insensitive lowercase key for search: "Vaudésir" -> "vaudesir". */
export const fold = str => String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Safe localStorage wrapper (private windows can throw). */
export const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

/**
 * A single shared tooltip element. tip.show(evt, nodeOrText), tip.hide()
 * Visual only: it is hidden from assistive technology, so every value a tooltip shows must also be
 * reachable another way (a control's name, aria-valuetext or a table view).
 */
export const tip = (() => {
  let el;
  const ensure = () => el || (el = document.body.appendChild(h('div', { class: 'tip', attrs: { 'aria-hidden': 'true' } })));
  return {
    show(evt, content) {
      const t = ensure();
      t.replaceChildren(content instanceof Node ? content : document.createTextNode(String(content)));
      const pad = 14, r = t.getBoundingClientRect();
      let x = evt.clientX + pad, y = evt.clientY + pad;
      if (x + r.width > innerWidth - 8) x = evt.clientX - r.width - pad;
      if (y + r.height > innerHeight - 8) y = evt.clientY - r.height - pad;
      t.style.left = `${Math.max(8, x)}px`; t.style.top = `${Math.max(8, y)}px`;
      t.classList.add('on');
    },
    hide() { if (el) el.classList.remove('on'); },
  };
})();

/**
 * Aspect rose: 8 wedges (N, NE, E, SE, S, SW, W, NW) sized by the share of sloping ground facing each way.
 * hist: array of 8 fractions (sum ~1). Returns an <svg>. Colour defaults to currentColor.
 */
export function aspectRose(hist, { size = 72, color = 'currentColor', label = true, title = 'Share of sloping ground facing each direction' } = {}) {
  const c = size / 2, R = size / 2 - (label ? 11 : 2);
  const max = Math.max(0.0001, ...(hist || [0]));
  const svg = s('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'aspect-rose', role: 'img', 'aria-label': title });
  svg.append(s('title', { text: title }));
  svg.append(s('circle', { cx: c, cy: c, r: R, fill: 'none', stroke: 'var(--rule-strong)', 'stroke-width': 1 }));
  svg.append(s('circle', { cx: c, cy: c, r: R / 2, fill: 'none', stroke: 'var(--rule)', 'stroke-width': 1 }));
  (hist || []).forEach((v, i) => {
    const r = R * Math.sqrt(v / max);
    if (r < 0.5) return;
    const a0 = (i * 45 - 22.5 - 90) * Math.PI / 180, a1 = (i * 45 + 22.5 - 90) * Math.PI / 180;
    const d = `M${c},${c} L${c + r * Math.cos(a0)},${c + r * Math.sin(a0)} A${r},${r} 0 0 1 ${c + r * Math.cos(a1)},${c + r * Math.sin(a1)} Z`;
    svg.append(s('path', { d, fill: color, 'fill-opacity': 0.75, stroke: color, 'stroke-width': 0.8 }));
  });
  if (label) {
    [['N', c, 8.5], ['E', size - 4, c + 3], ['S', c, size - 1.5], ['W', 4, c + 3]].forEach(([t, x, y]) =>
      svg.append(s('text', { x, y, 'text-anchor': 'middle', 'font-size': 8, 'font-family': 'var(--font-mono)', fill: 'var(--muted)', text: t })));
  }
  return svg;
}

/** Scroll to an element id with the sticky nav offset handled by CSS scroll-padding. */
export function scrollToId(id, block = 'start') {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block });
}

/** Run fn once when el first comes within `margin` of the viewport. */
export function whenVisible(el, fn, margin = '400px') {
  if (!('IntersectionObserver' in window)) { fn(); return; }
  const io = new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting)) { io.disconnect(); fn(); }
  }, { rootMargin: margin });
  io.observe(el);
}
