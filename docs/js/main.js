// Bootstrap: theme, navigation, hero figures, module initialisation, deep links and landing position.
// Each module exports `init(mountEl, ctx)` and owns everything inside its mount element.

import { bus } from './bus.js';
import * as data from './data.js';
import * as util from './util.js';

// The map comes first. The plates below it start once the map is up, or earlier if the reader
// scrolls near them, so on a slow connection the map does not share bandwidth with plates out of sight.
const MODULES = [
  { name: 'map', mount: 'map-app', load: () => import('./map.js') },
  { name: 'slope', mount: 'slope-app', load: () => import('./slope.js') },
  { name: 'climate', mount: 'climate-app', load: () => import('./climate.js') },
  { name: 'hierarchy', mount: 'hierarchy-app', load: () => import('./hierarchy.js') },
  { name: 'villages', mount: 'villages-app', load: () => import('./villages.js') },
  { name: 'finder', mount: 'finder-app', load: () => import('./finder.js') },
  { name: 'sources', mount: 'sources-app', load: () => import('./sources.js') },
];

const ctx = { bus, data, util, params: new URLSearchParams(location.search) };

// The page restores its own position (see initLanding), because the plates grow after load and
// the browser's remembered offset would land in the wrong plate.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

/* ---------- Theme ---------- */
function initTheme() {
  const btn = document.getElementById('theme-toggle');
  // A toggle button with a constant name, "Dark theme", that is either pressed or not.
  const sync = () => btn.setAttribute('aria-pressed', String(util.theme() === 'dark'));
  const apply = t => {
    document.documentElement.dataset.theme = t;
    sync();
    bus.emit('theme:change', { theme: t });
  };
  btn.addEventListener('click', () => {
    const next = util.theme() === 'dark' ? 'light' : 'dark';
    util.store.set('theme', next);
    apply(next);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!util.store.get('theme')) { sync(); bus.emit('theme:change', { theme: util.theme() }); }
  });
  sync();
}

/* ---------- Navigation: border on scroll, current plate, sideways strip on narrow screens ---------- */
function initNav() {
  const nav = document.getElementById('site-nav');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  const strip = nav.querySelector('.nav-links');
  const links = [...strip.querySelectorAll('a')];
  const byId = new Map(links.map(a => [a.getAttribute('href').slice(1), a]));

  // When the links do not fit, the strip scrolls. Fade the edge that has links behind it, and bring
  // a link wholly into the strip, clear of the fade, when it takes focus or becomes current.
  const cue = () => {
    const max = strip.scrollWidth - strip.clientWidth;
    strip.classList.toggle('can-l', max > 1 && strip.scrollLeft > 1);
    strip.classList.toggle('can-r', max > 1 && strip.scrollLeft < max - 1);
  };
  const reveal = (a, smooth) => {
    const max = strip.scrollWidth - strip.clientWidth;
    if (max <= 1) return;
    const pad = 32;
    const sr = strip.getBoundingClientRect(), ar = a.getBoundingClientRect();
    const from = ar.left - sr.left + strip.scrollLeft - pad;
    const to = ar.right - sr.left + strip.scrollLeft + pad - strip.clientWidth;
    let x = strip.scrollLeft;
    if (from < x) x = from; else if (to > x) x = to;
    x = Math.max(0, Math.min(max, x));
    if (Math.abs(x - strip.scrollLeft) > 1) strip.scrollTo({ left: x, behavior: smooth && !util.reducedMotion() ? 'smooth' : 'auto' });
  };
  strip.addEventListener('scroll', cue, { passive: true });
  addEventListener('resize', util.debounce(cue, 100));
  if (document.fonts) document.fonts.ready.then(cue);
  cue();
  links.forEach(a => a.addEventListener('focus', () => reveal(a, false)));

  // The current plate is the section crossing a band just below the middle of the screen. The hero
  // and the sections that have no link (bottles, further reading) clear the marker.
  const setCurrent = cur => {
    links.forEach(a => { if (a !== cur) a.removeAttribute('aria-current'); });
    if (cur && cur.getAttribute('aria-current') !== 'true') { cur.setAttribute('aria-current', 'true'); reveal(cur, true); }
  };
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) setCurrent(byId.get(e.target.id) || null);
  }, { rootMargin: '-45% 0px -50% 0px' });
  document.querySelectorAll('main > section[id]').forEach(el => io.observe(el));
}

/* ---------- Reveal on scroll ---------- */
function initReveal() {
  const els = document.querySelectorAll('.reveal');
  if (util.reducedMotion() || !('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('in')); return; }
  const io = new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { rootMargin: '0px 0px -8% 0px' });
  els.forEach(e => io.observe(e));
}

/* ---------- Hero figures, all computed from the data files ---------- */
async function initHeroStats() {
  const el = document.getElementById('hero-stats');
  try {
    const [idx, vil] = await Promise.all([data.index(), data.villages()]);
    const f = idx.features;
    const gc = f.filter(x => x.kind === 'grand_cru').length;
    const climats = f.filter(x => x.kind === 'climat').length;
    // Land in the village appellations. The Petit Chablis delimitation contains the whole Chablis
    // area, so only its land outside Chablis counts here, as the map draws it and its village profile
    // measures it. The other overlaps (Blagny and Volnay under Meursault and Puligny) total 85 ha,
    // well inside the rounding to the nearest thousand.
    const pc = vil.villages.find(v => v.id === 'petit-chablis');
    const pcId = pc && pc.featureIds && pc.featureIds.appellation[0];
    const ha = f.filter(x => x.kind === 'appellation')
      .reduce((a, x) => a + (x.id === pcId ? pc.stats.area_ha.total : x.area_ha), 0);
    const items = [
      [vil.villages.length, 'appellations profiled'],
      [gc, 'grand cru vineyards mapped'],
      [climats, 'named premier cru climats'],
      [util.fmt.num(Math.round(ha / 1000) * 1000), 'hectares of village appellations delimited'],
    ];
    el.replaceChildren(...items.map(([v, k]) => util.h('div', {}, util.h('span', { class: 'v num', text: v }), util.h('span', { class: 'k', text: k }))));
  } catch (err) {
    console.error(err);
    el.remove();
  }
}

/* ---------- Modules ---------- */
function startModule(m) {
  const el = document.getElementById(m.mount);
  if (!el) return Promise.resolve();
  return (async () => {
    try {
      const mod = await m.load();
      await mod.init(el, ctx);
    } catch (err) {
      console.error(`[${m.name}] failed to initialise`, err);
      el.replaceChildren(util.h('p', { class: 'error-box', text: `This section could not load (${err.message}). The rest of the atlas still works.` }));
    }
  })();
}

function initModules() {
  // Modules fail independently. The map starts at once and the rest follow (see MODULES).
  const [first, ...rest] = MODULES;
  const mapReady = startModule(first);
  return Promise.all([mapReady, ...rest.map(m => new Promise(resolve => {
    let started = false;
    const go = () => { if (!started) { started = true; resolve(startModule(m)); } };
    mapReady.then(go);
    const el = document.getElementById(m.mount);
    if (el) util.whenVisible(el, go, '600px');
  }))]);
}

/* ---------- A one-line note for a link the atlas could not follow ---------- */
function linkNote(text) {
  const note = document.body.appendChild(util.h('p', { class: 'link-note', attrs: { role: 'status' } }));
  requestAnimationFrame(() => { note.textContent = text; });
  setTimeout(() => {
    note.classList.add('is-out');
    setTimeout(() => note.remove(), 400);
  }, 6000);
}

/* ---------- Deep links: ?feature=, ?village=, ?region= ---------- */
// One place wins, in the order feature, village, region. Only the winner scrolls or moves focus, and
// the region every plate shows agrees with it. Links naming nothing in the atlas are dropped with a note.
// Resolves to true when the page was sent somewhere.
async function applyDeepLinks() {
  const { params } = ctx;
  let feature = params.get('feature'), village = params.get('village'), region = params.get('region');
  if (feature == null && village == null && region == null) return false;
  const [idx, vil] = await Promise.all([data.index().catch(() => null), data.villages().catch(() => null)]);
  const missing = [];
  const drop = key => util.setParam(key, null);

  if (region != null && region !== 'all' && !util.REGIONS.some(r => r.id === region)) {
    if (region) missing.push('region');
    drop('region'); region = null;
  }
  const vRec = village && vil ? vil.villages.find(v => v.id === village) : null;
  if (village != null && vil && !vRec) {
    if (village) missing.push('village');
    drop('village'); village = null;
  }
  const fRec = feature && idx ? idx.features.find(f => f.id === feature) : null;
  if (feature === '' || (feature && idx && !fRec && village)) {
    // An unknown place loses to a known village. On its own it goes to the map, which explains it there.
    if (feature) missing.push('place');
    drop('feature'); feature = null;
  }
  if (missing.length) linkNote(`No ${missing.length > 1 ? `${missing.slice(0, -1).join(', ')} or ${missing.at(-1)}` : missing[0]} in the atlas matches that link.`);

  if (feature) {
    if (village) { drop('village'); village = null; }
    const own = fRec ? fRec.region : null;
    if (own && region && region !== own) { drop('region'); region = null; }
    const shown = own || region;
    if (shown) bus.emit('region:select', { region: shown, source: 'url' });
    bus.emit('feature:focus', { id: feature, source: 'url' });
    util.scrollToId('map');
    return true;
  }
  if (village) {
    if (region && region !== 'all' && region !== vRec.region) { drop('region'); region = null; }
    if (region) bus.emit('region:select', { region, source: 'url' });
    bus.emit('village:focus', { id: village, source: 'url', reveal: 'card' });
    return true;
  }
  if (region) bus.emit('region:select', { region, source: 'url' });
  return false;
}

/* ---------- Landing position ---------- */
// The plates start as short placeholders and grow by thousands of pixels as their modules render, so
// the browser's jump to #plate, or its remembered offset on reload, lands in the wrong plate. Instead,
// hold the target in place while the page settles: the plate named in the address, or on reload and
// back/forward the plate the reader was reading. Stop as soon as the reader scrolls, touches or types.
const SAVED = 'atlas.position';

function savePosition() {
  addEventListener('pagehide', () => {
    const top = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    const secs = [...document.querySelectorAll('main > section[id]')];
    const sec = secs.filter(s => s.getBoundingClientRect().top <= top + 1).pop();
    const pos = sec ? { url: location.href, id: sec.id, dy: top - sec.getBoundingClientRect().top } : null;
    try { if (pos && scrollY > 0) sessionStorage.setItem(SAVED, JSON.stringify(pos)); else sessionStorage.removeItem(SAVED); } catch { /* ignore */ }
  });
}

function landingTarget() {
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(SAVED)); sessionStorage.removeItem(SAVED); } catch { /* ignore */ }
  const nav = performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
  const returning = nav && (nav.type === 'reload' || nav.type === 'back_forward');
  if (returning && saved && saved.url === location.href && document.getElementById(saved.id)) return { id: saved.id, dy: Number(saved.dy) || 0 };
  let hash = '';
  try { hash = decodeURIComponent(location.hash.slice(1)); } catch { /* malformed */ }
  // #src-… links are held by the sources plate itself.
  if (hash && !hash.startsWith('src-') && document.getElementById(hash)) return { id: hash, dy: 0 };
  return null;
}

/** Work out the landing target now, and return a function that starts holding it. */
function initLanding(ready) {
  savePosition();
  const target = landingTarget();
  let started = false;
  return () => {
    if (started || !target) return;
    started = true;
    hold(target, ready);
  };
}

function hold(target, ready) {
  const el = document.getElementById(target.id);
  const USER = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
  let done = false, settle = 0;
  const align = () => {
    if (done) return;
    const top = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    const y = el.getBoundingClientRect().top + scrollY - top + target.dy;
    if (Math.abs(y - scrollY) > 1) scrollTo({ top: y, behavior: 'instant' });
  };
  const ro = new ResizeObserver(align);
  const stop = () => {
    if (done) return;
    done = true; ro.disconnect(); clearTimeout(settle); clearTimeout(cap);
    USER.forEach(t => removeEventListener(t, stop));
  };
  const cap = setTimeout(stop, 30000); // never hold longer than this, even on a very slow connection
  USER.forEach(t => addEventListener(t, stop, { passive: true }));
  ro.observe(document.body);
  align();
  // Once every plate and the fonts are in, keep holding a little longer for late layout, then let go.
  Promise.all([ready, document.fonts ? document.fonts.ready : null]).then(() => {
    align();
    settle = setTimeout(stop, 1500);
  });
}

/* ---------- Static editorial links into the village profiles ---------- */
function initBottleLinks() {
  document.querySelectorAll('.bottle-link[data-village]').forEach(b =>
    b.addEventListener('click', () => bus.emit('village:focus', { id: b.dataset.village, reveal: 'card', source: 'bottles' })));
}

initTheme();
initNav();
initBottleLinks();
initReveal();
initHeroStats();
const ready = initModules();
const land = initLanding(ready);
// A ?feature= or ?village= link sends the page to its own plate. Otherwise, or if that link turns out
// to name nothing, the page holds the plate named in the address or the one the reader left.
const linkMayScroll = ['feature', 'village'].some(k => ctx.params.get(k));
if (!linkMayScroll) land();
ready.then(applyDeepLinks).then(scrolled => { if (!scrolled) land(); }, err => { console.error(err); land(); });
