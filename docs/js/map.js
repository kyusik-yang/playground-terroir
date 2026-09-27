// Plate I: the atlas map.
//
// A Leaflet map of INAO village appellations, named premier cru climats and grand crus on IGN
// basemaps, framed like a printed plate (neatline, graticule, scale bar, credit line).
// With "All" regions chosen the plate is an index: the four regions as separate sheets, all at
// one scale. Choosing a sheet, a region, a search result or a place on another plate opens the
// map itself. Clicking a shape or a village marker opens a details panel (right on desktop, a
// bottom sheet on phones). Every number shown comes from docs/data.

const Z = {
  index: 10.25,           // below this the main map veils the land outside the region sheets
  selDetail: 13.5,        // from here a selected grand cru is outlined with its full-detail shape
  regionLabelsBelow: 10.25, // region names label the zoomed-out map
  villageNames: 10,       // names of the profiled villages
  detail: 11.5,           // full region files load from here when the view overlaps a region
  appLabels: [11, 15],    // appellation names between these zooms (after the climats from pcLabels)
  gcLabels: 13,
  pcLabels: 14,
  geology: 11.5,          // the BRGM 1:50,000 scan is only served for close views
  contours: 12,
  buildings: 15,          // building footprints (below this the layer draws whole built-up zones)
  ends: 12,               // transect end heights
};

const IGN_WMTS = 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}';
const IGN_ATTR = '© <a href="https://www.ign.fr/geoplateforme">IGN Géoplateforme</a>';
// The map never leaves this box, which lies inside metropolitan France around the four regions and
// stops west of the Swiss border (5.96° E). Outside France the Géoplateforme answers 404 at close
// zooms, so no tile is ever requested beyond it and the tiles never end in a visible edge.
const MAX_BOUNDS = [[45.3, 2.3], [48.6, 5.85]];
const BRGM_ATTR = 'Géologie © <a href="https://www.brgm.fr/">BRGM</a>';

// IGN WMTS layers, each with the tile matrix set its capabilities declare. `max` and `min` are the
// tile zooms the layer is drawn at on the main map (see ignLayers for how they become zoom limits).
const IGN = {
  hs: { layer: 'IGNF_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW', tms: 'PM_6_17', native: [6, 17], z: 1 },
  contour: { layer: 'ELEVATION.CONTOUR.LINE', tms: 'PM_6_18', native: [6, 18], z: 2, min: Z.contours },
  hydro: { layer: 'HYDROGRAPHY.HYDROGRAPHY', tms: 'PM_6_18', native: [6, 18], z: 3 },
  bldg: { layer: 'BUILDINGS.BUILDINGS', tms: 'PM_6_18', native: [13, 18], z: 4, min: Z.buildings },
  plan: { layer: 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', tms: 'PM_0_19', native: [0, 19], z: 1 },
  ortho: { layer: 'ORTHOIMAGERY.ORTHOPHOTOS', tms: 'PM_0_19', native: [0, 19], z: 1, format: 'image/jpeg' },
};
// Relief is built from IGN layers that print no place names (hillshade, water, then contours and
// building footprints closer in), so the only names on it are the atlas's own, and a sheet's edge never
// cuts a basemap name. IGN's road layers print road numbers and street names, so Relief has no roads.
// Plan has them.
const BASES = { relief: ['hs', 'contour', 'hydro', 'bldg'], aerial: ['ortho'], plan: ['plan'] };
const SHEET_BASES = { relief: ['hs', 'hydro'], aerial: ['ortho'], plan: ['plan'] };

const KIND_LABEL = { appellation: 'Village appellation', climat: 'Premier cru climat', grand_cru: 'Grand cru' };
const LEVEL_NAME = { 'grand-cru': 'Grand cru', 'premier-cru': 'Premier cru', village: 'Village', regional: 'Regional', none: 'Outside AOC' };
const SECTORS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const NARROW = '(max-width: 719px)';
const SHEET_MARGIN = 0.012; // degrees of latitude added around each region's bounds for its sheet
const FRAME = { weight: 1, opacity: 0.75 };
const FRAME_HOT = { weight: 2, opacity: 1 };
// Below this resultant length of the aspect histogram the ground has no single direction worth naming.
const DISPERSED = 0.3;

// Label typography. The CSS in map.css must match these fonts so collision boxes are exact.
const LBL = {
  region: { font: 'italic 500 24px Cormorant', size: 24, h: 26, ls: 0, upper: false },
  sub: { font: '400 10.5px "IBM Plex Mono"', size: 10.5, h: 14, ls: 0, upper: false },
  village: { font: '600 10.5px "Instrument Sans"', size: 10.5, h: 16, ls: 0.12, upper: true, padX: 5 },
  app: { font: 'italic 600 15px Cormorant', size: 15, h: 18, ls: 0.01, upper: false },
  gc: { font: '700 14px Cormorant', size: 14, h: 17, ls: 0.02, upper: false },
  'gc-lg': { font: '700 16.5px Cormorant', size: 16.5, h: 19, ls: 0.02, upper: false },
  pc: { font: 'italic 600 13px Cormorant', size: 13, h: 16, ls: 0, upper: false },
  'pc-lg': { font: 'italic 600 15px Cormorant', size: 15, h: 18, ls: 0, upper: false },
  capName: { font: 'italic 500 24px Cormorant', size: 24, h: 26, ls: 0, upper: false },
  capNameS: { font: 'italic 500 19px Cormorant', size: 19, h: 21, ls: 0, upper: false },
  capSub: { font: '400 10.5px "IBM Plex Mono"', size: 10.5, h: 16, ls: 0, upper: false },
  loc: { font: '400 11px "Instrument Sans"', size: 11, h: 14, ls: 0, upper: false },
};

export async function init(mountEl, ctx) {
  if (!window.L) throw new Error('the map library did not load');
  const atlas = new Atlas(mountEl, ctx);
  await atlas.start();
}

class Atlas {
  constructor(root, ctx) {
    this.root = root;
    this.bus = ctx.bus;
    this.data = ctx.data;
    this.u = ctx.util;
    const store = this.u.store;
    const savedBase = store.get('atlas.basemap', 'relief');
    this.state = {
      region: 'all',
      basemap: ['relief', 'aerial', 'plan'].includes(savedBase) ? savedBase : 'relief',
      geology: false,
      geoOpacity: Math.min(1, Math.max(0.2, Number(store.get('atlas.geoOpacity', 0.7)) || 0.7)),
      panel: null,       // { type: 'feature' | 'village', id }
      transect: null,    // transect id
      active: false,     // wheel zoom (and touch panning) enabled
    };
    this.detail = new Map();    // region id -> { layer, byId, byApp, elevDomain }
    this.loading = new Map();   // region id -> Promise
    this.failedAt = new Map();  // region id -> time of the last failed load (automatic retries wait)
    this.overview = new Map();  // region id -> L.GeoJSON
    this.appWhite = new Map();  // appellation name -> true | false (null when unverified)
    this.geomById = new Map();  // feature id -> full-detail geometry, once its region has loaded
    this.gcInside = new Map();  // appellation id -> grand cru land inside it (see grandCruInside)
    this.shownDetail = new Set();
    this.labelEls = new Map();
    this.labelPts = new Map();  // feature id -> [lat, lng] where its name sits
    this.widthCache = new Map();
    this.focusToken = 0;
    this.geoHealth = this.freshGeoHealth();
    this.indexOn = false;
    this.mq = matchMedia(NARROW);
    this.coarse = matchMedia('(pointer: coarse)').matches;
  }

  /* =====================================================================
     Start-up
     ===================================================================== */
  async start() {
    this.buildShell();
    // The overview outlines download alongside the index and the villages rather than after them.
    // The no-op catch keeps an early failure from being reported as unhandled before the handler below is attached.
    const overview = this.data.overview();
    overview.catch(() => {});
    const [idx, vil] = await Promise.all([this.data.index(), this.data.villages()]);
    this.idx = idx;
    this.vil = vil;
    this.byId = new Map(idx.features.map(f => [f.id, f]));
    this.regions = new Map(idx.regions.map(r => [r.id, r]));
    this.villages = new Map(vil.villages.map(v => [v.id, v]));
    for (const f of idx.features) if (f.kind === 'appellation' && typeof f.white === 'boolean') this.appWhite.set(f.app, f.white);
    this.findTwins();

    this.buildSheets();
    this.buildToolbar();
    this.buildOverlays();
    this.buildCaveat();
    this.buildMap();
    this.buildVeil();
    this.buildIndexView();
    this.buildMarkers();
    this.registerBus();
    this.setupActivation();

    const last = this.bus.last('region:select');
    this.setRegion(last && this.regionIds().includes(last.region) ? last.region : 'all', { emit: false, animate: false });
    this.stageLoading.remove();

    overview.then(fc => this.addOverview(fc)).catch(err => {
      console.error('[map] overview', err);
      this.flash('The appellation outlines could not load. Choose a region to try again.');
    });
    this.transectsReady = this.data.transects().then(t => this.indexTransects(t)).catch(err => {
      console.error('[map] transects', err);
      return null;
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
      // Label boxes and the index layout are measured with the plate's fonts.
      this.widthCache.clear();
      if (this.indexOn) this.layoutIndex();
      this.renderLabels();
    });
  }

  regionIds() { return ['all', ...this.u.REGIONS.map(r => r.id)]; }

  /**
   * Some climats marked red wine only cover exactly the same ground as a climat that allows white
   * wine (the same area and the same extent in index.json). The map draws only the white one, so
   * that ground reads, and clicks, as white-wine land. Both panels name the other.
   */
  findTwins() {
    this.twinOf = new Map();
    this.hiddenTwins = new Set();
    const iou = (a, b) => {
      const s = Math.max(a[0], b[0]), w = Math.max(a[1], b[1]), n = Math.min(a[2], b[2]), e = Math.min(a[3], b[3]);
      if (n <= s || e <= w) return 0;
      const i = (n - s) * (e - w), A = (a[2] - a[0]) * (a[3] - a[1]), B = (b[2] - b[0]) * (b[3] - b[1]);
      return i / (A + B - i);
    };
    const whites = this.idx.features.filter(f => f.white !== false && f.kind !== 'appellation');
    for (const r of this.idx.features) {
      if (r.white !== false || r.kind === 'appellation') continue;
      const w = whites.find(x => x.region === r.region && !this.twinOf.has(x.id)
        && Math.abs(x.area_ha - r.area_ha) <= 0.02 * Math.max(x.area_ha, r.area_ha) && iou(x.bbox, r.bbox) >= 0.9);
      if (!w) continue;
      this.twinOf.set(r.id, w.id);
      this.twinOf.set(w.id, r.id);
      this.hiddenTwins.add(r.id);
    }
  }

  /* =====================================================================
     DOM shell
     ===================================================================== */
  buildShell() {
    const { h } = this.u;
    this.root.classList.add('atlas');
    this.bar = h('div', { class: 'atlas-bar' });
    this.mapEl = h('div', { class: 'atlas-map', attrs: { id: 'atlas-map' } });
    this.stageLoading = h('p', { class: 'atlas-loading', text: 'Loading the map…' });
    this.stage = h('div', { class: 'atlas-stage' }, this.mapEl, this.stageLoading);
    this.gratTop = h('div', { class: 'atlas-grat atlas-grat-top', attrs: { 'aria-hidden': 'true' } });
    this.gratLeft = h('div', { class: 'atlas-grat atlas-grat-left', attrs: { 'aria-hidden': 'true' } });
    this.scaleEl = h('div', { class: 'atlas-scale', attrs: { 'aria-hidden': 'true' } });
    this.coordEl = h('div', { class: 'atlas-coord', attrs: { 'aria-hidden': 'true' } });
    this.creditEl = h('div', { class: 'atlas-credit' });
    this.foot = h('div', { class: 'atlas-foot' }, this.scaleEl, this.coordEl, this.creditEl);
    this.plate = h('div', { class: 'atlas-plate' }, this.gratTop, this.gratLeft, this.stage, this.foot);
    this.summaryEl = h('p', { class: 'visually-hidden', attrs: { id: 'atlas-summary' } });
    this.liveEl = h('p', { class: 'visually-hidden', attrs: { 'aria-live': 'polite', 'aria-atomic': 'true' } });
    this.root.replaceChildren(this.bar, this.plate, this.summaryEl, this.liveEl);
  }

  announce(msg) {
    this.liveEl.textContent = '';
    requestAnimationFrame(() => { this.liveEl.textContent = msg; });
  }

  /** Accessible radiogroup built on the .seg component, with roving tabindex. */
  radioGroup(label, items, current, onSelect, cls = '') {
    const { h } = this.u;
    const btns = items.map(it => h('button', {
      type: 'button', text: it.label,
      attrs: { role: 'radio', 'aria-checked': String(it.id === current), tabindex: it.id === current ? '0' : '-1' },
      dataset: { value: it.id },
      on: { click: () => onSelect(it.id) },
    }));
    const g = h('div', { class: `seg ${cls}`, attrs: { role: 'radiogroup', 'aria-label': label } }, btns);
    g.addEventListener('keydown', e => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      let i = btns.indexOf(document.activeElement);
      if (i < 0) return;
      if (step) i = (i + step + btns.length) % btns.length;
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = btns.length - 1;
      else return;
      e.preventDefault();
      btns[i].focus();
      onSelect(btns[i].dataset.value);
    });
    g.setValue = v => btns.forEach(b => {
      const on = b.dataset.value === v;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    return g;
  }

  buildToolbar() {
    const { h, REGIONS } = this.u;
    const items = [{ id: 'all', label: 'All' }, ...REGIONS.map(r => ({ id: r.id, label: r.name }))];
    this.regionSeg = this.radioGroup('Region', items, 'all', id => this.setRegion(id, { emit: true }), 'atlas-regions');
    const regWrap = this.regWrap = h('div', { class: 'atlas-regions-wrap' }, this.regionSeg);
    const cue = () => {
      const max = regWrap.scrollWidth - regWrap.clientWidth;
      regWrap.classList.toggle('can-l', regWrap.scrollLeft > 2);
      regWrap.classList.toggle('can-r', regWrap.scrollLeft < max - 2);
    };
    this.regionCue = cue;
    regWrap.addEventListener('scroll', cue, { passive: true });
    if ('ResizeObserver' in window) new ResizeObserver(this.u.debounce(cue, 100)).observe(regWrap);
    this.bar.append(regWrap, this.buildSearch());
  }

  /** Keep the checked region visible inside its own scroller. Never scrolls the page. */
  revealRegionButton() {
    const w = this.regWrap;
    const b = w && this.regionSeg.querySelector('[aria-checked="true"]');
    if (!b || w.scrollWidth <= w.clientWidth) return;
    const left = b.getBoundingClientRect().left - w.getBoundingClientRect().left + w.scrollLeft, right = left + b.offsetWidth;
    let x = w.scrollLeft;
    if (left < x + 8) x = left - 24;
    else if (right > x + w.clientWidth - 8) x = right - w.clientWidth + 24;
    if (x !== w.scrollLeft) w.scrollTo({ left: Math.max(0, x), behavior: this.u.reducedMotion() ? 'auto' : 'smooth' });
    else this.regionCue();
  }

  buildOverlays() {
    const { h } = this.u;
    const svgIcon = (d, extra = '') => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="${d}"/>${extra}</svg>`;

    /* Layers card: basemap and geology */
    this.baseSeg = this.radioGroup('Basemap', [
      { id: 'relief', label: 'Relief' }, { id: 'aerial', label: 'Aerial' }, { id: 'plan', label: 'Plan' },
    ], this.state.basemap, id => this.setBasemap(id), 'atlas-base');
    this.geoBtn = h('button', {
      type: 'button', class: 'chip atlas-geo-btn',
      attrs: { 'aria-pressed': 'false', 'aria-controls': 'atlas-geo-extra' },
      html: '<span class="atlas-geo-dot" aria-hidden="true"></span>Geology',
      on: { click: () => this.setGeology(!this.state.geology) },
    });
    this.geoRange = h('input', {
      type: 'range', class: 'atlas-geo-range',
      attrs: { min: '20', max: '100', step: '5', 'aria-label': 'Geology opacity', id: 'atlas-geo-opacity' },
      value: String(Math.round(this.state.geoOpacity * 100)),
      on: { input: e => this.setGeoOpacity(Number(e.target.value) / 100) },
    });
    this.geoZoomNote = h('p', { class: 'atlas-geo-zoom' },
      'The geological map appears on closer views. ',
      h('button', { type: 'button', class: 'link-btn', text: 'Zoom in', on: { click: () => this.geoZoomIn() } }));
    this.geoStatus = h('p', { class: 'atlas-geo-status', hidden: true },
      'The BRGM geological map is not responding right now. ',
      h('button', { type: 'button', class: 'link-btn', text: 'Try again', on: { click: () => this.retryGeology() } }));
    this.geoExtra = h('div', { class: 'atlas-geo-extra', attrs: { id: 'atlas-geo-extra' }, hidden: true },
      h('label', { class: 'atlas-geo-label', attrs: { for: 'atlas-geo-opacity' }, text: 'Opacity' }), this.geoRange,
      this.geoZoomNote, this.geoStatus);
    this.layersCard = h('div', { class: 'atlas-ctl atlas-layers' },
      h('div', { class: 'atlas-layers-row' }, this.baseSeg, this.geoBtn), this.geoExtra);

    /* Zoom stack */
    this.zoomIn = h('button', { type: 'button', class: 'atlas-zbtn', attrs: { 'aria-label': 'Zoom in' }, html: svgIcon('M12 6v12M6 12h12'), on: { click: () => { if (this.zoomIn.getAttribute('aria-disabled') !== 'true') this.map.zoomIn(1); } } });
    this.zoomOut = h('button', { type: 'button', class: 'atlas-zbtn', attrs: { 'aria-label': 'Zoom out' }, html: svgIcon('M6 12h12'), on: { click: () => { if (this.zoomOut.getAttribute('aria-disabled') !== 'true') this.map.zoomOut(1); } } });
    this.zoomFit = h('button', { type: 'button', class: 'atlas-zbtn', attrs: { 'aria-label': 'Show the whole region' }, html: svgIcon('M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5'), on: { click: () => this.fitRegion(this.state.region) } });
    this.zoomCard = h('div', { class: 'atlas-ctl atlas-zoom', attrs: { role: 'group', 'aria-label': 'Zoom' } }, this.zoomIn, this.zoomOut, this.zoomFit);

    /* Legend */
    const lvlRow = (level, label, key, sub) => h('li', {},
      h('span', { class: 'swatch atlas-sw', dataset: { level } }),
      h('span', { class: 'lg-k' }, label, sub || null),
      h('span', { class: 'num lg-n', dataset: { count: key } }));
    this.climatHint = h('span', { class: 'lg-sub', text: 'drawn in region views' });
    this.redSub = h('span', { class: 'lg-sub' });
    this.redRow = h('li', { hidden: true }, h('span', { class: 'swatch atlas-sw atlas-sw-red' }), h('span', { class: 'lg-k' }, 'Red wine only', this.redSub), h('span', { class: 'lg-n' }));
    this.villageCount = h('span', { class: 'num lg-n' });
    this.legendTitle = h('span', { class: 'lg-where' });
    this.transectRow = h('div', { class: 'atlas-lg-transect', hidden: true });
    this.geoLegend = h('p', { class: 'atlas-lg-geo', hidden: true, text: 'Colours follow the BRGM 1:50,000 geological map.' });
    this.legendBody = h('div', { class: 'atlas-legend-body', attrs: { id: 'atlas-legend-body' } },
      h('ul', { class: 'atlas-lg-list' },
        lvlRow('grand-cru', 'Grand cru', 'grand_cru'),
        lvlRow('premier-cru', 'Premier cru climat', 'climat', this.climatHint),
        lvlRow('village', 'Village appellation', 'appellation'),
        this.redRow,
        h('li', {}, h('span', { class: 'atlas-vdot', attrs: { 'aria-hidden': 'true' } }), h('span', { class: 'lg-k', text: 'Profiled village' }), this.villageCount)),
      this.transectRow, this.geoLegend);
    const startOpen = !this.mq.matches;
    this.legendToggle = h('button', {
      type: 'button', class: 'atlas-legend-toggle',
      attrs: { 'aria-expanded': String(startOpen), 'aria-controls': 'atlas-legend-body' },
      on: { click: () => { this.legendAuto = false; this.setLegendOpen(this.legendToggle.getAttribute('aria-expanded') !== 'true'); } },
    }, h('span', { class: 'eyebrow', text: 'Legend' }), h('span', { class: 'visually-hidden', text: ', ' }), this.legendTitle,
    h('span', { class: 'lg-chev', attrs: { 'aria-hidden': 'true' }, html: svgIcon('M7 10l5 5 5-5') }));
    this.legend = h('div', { class: 'atlas-ctl atlas-legend' }, this.legendToggle, this.legendBody);
    this.setLegendOpen(startOpen);

    /* Hint, busy chip, panel */
    this.hint = h('div', { class: 'atlas-hint', attrs: { 'aria-hidden': 'true' } });
    this.busy = h('div', { class: 'atlas-busy', attrs: { 'aria-hidden': 'true' } });
    this.panelBody = h('div', { class: 'atlas-panel-body' });
    this.panelClose = h('button', { type: 'button', class: 'atlas-close', attrs: { 'aria-label': 'Close details' }, html: svgIcon('M6 6l12 12M18 6L6 18'), on: { click: e => this.closePanel({ pointer: e.detail > 0 }) } });
    // On phones the panel is a bottom sheet that opens at a little under half the map. Its grip grows it.
    this.panelGrip = h('button', {
      type: 'button', class: 'atlas-panel-grip',
      attrs: { 'aria-expanded': 'false', 'aria-controls': 'atlas-panel', 'aria-label': 'Expand details' },
      on: { click: () => this.setSheetTall(!this.panel.classList.contains('is-tall')) },
    }, h('span', { attrs: { 'aria-hidden': 'true' } }));
    this.panel = h('aside', { class: 'atlas-panel', attrs: { 'aria-labelledby': 'atlas-panel-title', id: 'atlas-panel' }, hidden: true },
      this.panelGrip, this.panelClose, this.panelBody);

    this.leftCol = h('div', { class: 'atlas-left' }, this.layersCard, this.zoomCard);
    // Controls and the panel come before the map in the DOM so the keyboard reaches them first.
    // Stacking is set by z-index, not by order.
    this.stage.prepend(this.leftCol, this.legend, this.panel);
    this.stage.append(this.hint, this.busy);

    this.root.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !this.state.panel) return;
      if (this.searchOpen) return; // the combobox handles its own Escape first
      e.preventDefault();
      this.closePanel({ restoreFocus: true });
    });
  }

  setLegendOpen(open) {
    this.legendToggle.setAttribute('aria-expanded', String(open));
    this.legendBody.hidden = !open;
    this.legend.classList.toggle('is-open', open);
    this.updateMarkerFocus();
  }

  setSheetTall(tall) {
    this.panel.classList.toggle('is-tall', tall);
    this.panelGrip.setAttribute('aria-expanded', String(tall));
    this.panelGrip.setAttribute('aria-label', tall ? 'Shrink details' : 'Expand details');
  }

  buildCaveat() {
    const { h, fmt } = this.u;
    const chablis = this.regions.get('chablis');
    const nChablis = chablis ? chablis.counts.climat : null;
    const planted = (this.vil.notes || []).join(' ').split(/(?<=\.)\s+/).find(s => /planted/i.test(s));
    const dem = this.idx.source && this.idx.source.dem;
    const res = dem && dem.resolution_m ? `${fmt.num(dem.resolution_m)} m ` : '';
    const nRed = this.idx.features.filter(f => f.white === false).length;
    const twins = [...this.hiddenTwins].map(id => this.byId.get(id)).filter(Boolean);
    const twinApps = [...new Set(twins.map(f => f.app))];
    const notes = [
      'INAO’s digital delimitation does not yet name every climat.' + (nChablis != null ? ` In Chablis only ${fmt.num(nChablis)} premier cru climats are digitised by name, all outside the commune of Chablis itself.` : ''),
      'Several climat names nest. Morgeot, for instance, contains Les Brussonnes, La Boudriotte and others. Some ground carries two names. Meursault premier cru Blagny and Blagny premier cru are the same land, for white and red wine respectively.',
      'The Charlemagne grand cru lies inside Corton-Charlemagne and is not drawn separately.',
    ];
    const method = [
      'The index shows the four regions as separate sheets, north to south, all at the same scale. Each sheet is drawn around its mapped shapes with a margin of about ' + `${fmt.num(SHEET_MARGIN * 111.2, 1)} km.`,
      'The Petit Chablis shape shows only the land entitled to Petit Chablis but not to Chablis. Its panel gives the figures for that land.',
      planted ? `Every area on the map is INAO delimited land. ${planted}` : null,
      `Shapes are simplified for display. Every area, height, slope and aspect was computed from the full-resolution boundaries and the IGN RGE ALTI ${res}elevation model.`,
      nRed ? `${fmt.num(nRed)} appellations and climats are marked in the data as red wine only. They are drawn in stone, with a dashed outline over a fine hatch. Where a region is drawn in full, a red-only appellation keeps its dashed outline but loses the hatch, so white-wine climats on its ground do not look red-only.` : null,
      twins.length ? `${fmt.num(twins.length)} of those climats (${twinApps.map(a => `${a} premier cru`).join(', ')}) cover the same ground as a climat that allows white wine. The map draws the white-wine climat, and each panel names the other.` : null,
      'The premier cru share of an appellation counts premier cru land only. Grand cru land that INAO’s premier cru area also covers is counted as grand cru, as in the village profiles.',
      'An aspect is named only when the ground mostly faces one way. Where the aspect rose is spread evenly, the panel says the ground has no single direction.',
      'The Relief basemap is built from IGN layers that print no place names (hillshade and water, then contours and building footprints closer in), so the names on the map are the atlas’s own. IGN’s road layers print road numbers and street names, so Relief leaves roads out. The Plan basemap shows them.',
    ].filter(Boolean);
    this.root.append(h('div', { class: 'atlas-caveat' },
      h('p', { class: 'caveat atlas-disclaimer', text: 'Boundaries come from INAO’s parcel delimitation and are shown for information only. The official delimitations are the plans filed in town halls and with INAO.' }),
      h('ol', { class: 'atlas-plate-notes', attrs: { 'aria-label': 'Notes on the map' } },
        notes.map((t, i) => h('li', {}, h('span', { class: 'num atlas-note-n', attrs: { 'aria-hidden': 'true' }, text: String(i + 1) }), h('span', { text: t })))),
      h('details', { class: 'disclosure atlas-notes' },
        h('summary', {}, 'How the map is drawn'),
        h('ul', {}, method.map(t => h('li', { text: t }))))));
  }

  /* =====================================================================
     Map
     ===================================================================== */
  buildMap() {
    const L = window.L;
    const reduced = this.u.reducedMotion();
    const map = this.map = L.map(this.mapEl, {
      zoomControl: false,
      attributionControl: false,
      zoomSnap: 0.05, // fine steps so every fit frames its target closely
      zoomDelta: 1,
      wheelPxPerZoomLevel: 110,
      minZoom: 7,
      maxZoom: 18.5,
      maxBounds: L.latLngBounds(MAX_BOUNDS),
      maxBoundsViscosity: 1,
      scrollWheelZoom: false,
      dragging: !this.coarse,
      zoomAnimation: !reduced,
      fadeAnimation: !reduced,
      markerZoomAnimation: !reduced,
      inertia: !reduced,
      keyboardPanDelta: 120,
    });
    this.updateMinZoom();
    map.fitBounds(this.boundsFor('cote-de-beaune'), { animate: false, padding: [28, 28] });

    const pane = (name, z, events = false) => {
      const p = map.createPane(name);
      p.style.zIndex = String(z);
      if (!events) p.style.pointerEvents = 'none';
      return p;
    };
    pane('geology', 250);
    this.veilPane = pane('veil', 300);
    pane('selection', 440);
    pane('transect', 450);
    this.labelPane = pane('labels', 560);
    // The transect's end heights sit over the village markers, since a line can end in a village.
    this.endsPane = pane('ends', 620);

    this.canvas = L.canvas({ padding: 0.4, tolerance: this.coarse ? 6 : 2 });
    this.svgVeil = L.svg({ pane: 'veil', padding: 0.6 });
    this.svgSel = L.svg({ pane: 'selection', padding: 0.4 });
    this.svgTr = L.svg({ pane: 'transect', padding: 0.4 });

    // Attribution lives in the plate's credit line under the map.
    this.attribution = L.control.attribution({ prefix: '<a href="https://leafletjs.com">Leaflet</a>' }).addTo(map);
    this.creditEl.append(this.attribution.getContainer());
    const inaoUrl = (this.idx.source && this.idx.source.inao && this.idx.source.inao.url) || 'https://www.inao.gouv.fr/';
    this.attribution.addAttribution(`Appellations © <a href="${this.u.esc(inaoUrl)}">INAO</a>`);
    // Tiles for the index sheets are credited here too, since the main map may have none on screen.
    this.attribution.addAttribution(IGN_ATTR);

    // Accessible name and text alternative for the map container.
    const c = map.getContainer();
    c.setAttribute('role', 'region');
    c.setAttribute('aria-roledescription', 'map');
    c.setAttribute('aria-label', 'Atlas map of white Burgundy. Arrow keys pan, plus and minus zoom.');
    c.setAttribute('aria-describedby', 'atlas-summary');

    // Tiles load when the plate comes near the viewport.
    this.u.whenVisible(this.stage, () => { this.tilesOn = true; this.syncBase(); }, '600px');
    this.root.dataset.basemap = this.state.basemap;

    // Redraw hooks.
    let raf = 0;
    const settle = this.settle = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        this.updateFillScale();
        this.drawSelection();
        this.updateLayers();
        this.updateZoomClasses();
        this.renderLabels();
        this.renderFrame();
        this.updateZoomButtons();
        this.updateGeoNote();
        this.syncRegionToView();
        this.labelPane.classList.remove('is-hidden');
      });
    };
    map.on('moveend zoomend', settle);
    map.on('moveend', () => { this.fitting = false; });
    map.on('zoomstart', () => {
      this.labelPane.classList.add('is-hidden');
      this.hoverSheet(null);
      this.hideTip();
    });
    map.on('movestart', () => {
      this.hideTip();
      if (!this.indexOn) this.coordEl.textContent = '';
      if (!this.fitting) this.userMoved = true;
    });
    // In the zoomed-out map a click on open ground inside a region's sheet opens that region.
    // Clicks on a shape are stopped by the canvas renderer and never reach this handler.
    map.on('click', e => {
      if (map.getZoom() >= Z.index) return;
      const sh = this.sheetAt(e.latlng);
      if (sh) { this.hoverSheet(null); this.setRegion(sh.id, { emit: true }); }
    });
    let rafMove = 0;
    map.on('move', () => {
      if (rafMove) return;
      rafMove = requestAnimationFrame(() => { rafMove = 0; this.renderGraticule(); });
    });
    if (!this.coarse) {
      let rafC = 0, last = null;
      let lastEvt = null;
      // Leaflet's canvas renderer drops pointer moves that arrive within 32 ms of the previous one,
      // so a quick flick can leave the wrong shape highlighted. Re-test once the pointer rests.
      // The re-test listens to the DOM, not to Leaflet. Leaflet never reports the dropped move, and the
      // re-test itself fires a Leaflet mousemove, which would otherwise schedule the next re-test forever.
      let rehoverT = 0;
      map.getContainer().addEventListener('mousemove', ev => {
        clearTimeout(rehoverT);
        const r = this.canvas;
        if (!r || ev.target !== r._container) return; // over a marker or a label, not the shapes
        rehoverT = setTimeout(() => {
          // Only while the pointer is still on the shapes, so nothing lights up after it has left the map.
          if (r._map && typeof r._onMouseMove === 'function' && r._container.matches(':hover')) r._onMouseMove(ev);
        }, 60);
      }, { passive: true });
      map.on('mousemove', e => {
        last = e.latlng;
        lastEvt = e.originalEvent;
        if (rafC) return;
        rafC = requestAnimationFrame(() => {
          rafC = 0;
          if (!last || this.indexOn) return;
          this.coordEl.textContent = `${dms(last.lat, 'N', 'S', true)}   ${dms(last.lng, 'E', 'W', true)}`;
          const sh = map.getZoom() < Z.index && !this.hovered ? this.sheetAt(last) : null;
          this.hoverSheet(sh, lastEvt);
        });
      });
      map.on('mouseout', () => { clearTimeout(rehoverT); last = null; if (!this.indexOn) this.coordEl.textContent = ''; this.hoverSheet(null); });
    }

    // Keep Leaflet in step with container size changes (layout, sheet, orientation).
    // When the plate changes size (window resize, phone rotation), a view the reader has not moved is framed again.
    const onResize = this.u.debounce(() => {
      map.invalidateSize({ debounceMoveend: true });
      this.updateMinZoom();
      if (this.indexOn) this.layoutIndex();
      else if (this.lastFit && !this.userMoved) this.fitTo(this.lastFit.bounds, { ...this.lastFit, animate: false });
      settle();
    }, 120);
    if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(this.stage);
    else addEventListener('resize', onResize);

    this.colors = this.readColors();
    this.applyTheme();
    this.updateCounts();
    settle();
  }

  /** The map can zoom out until its view would reach beyond MAX_BOUNDS, and no further. */
  updateMinZoom() {
    const size = this.map.getSize();
    if (!size.x || !size.y) return;
    const z = this.map.getBoundsZoom(window.L.latLngBounds(MAX_BOUNDS), true);
    this.map.setMinZoom(Math.max(6, Math.ceil(z * 20) / 20));
  }

  boundsFor(id) {
    const L = window.L;
    if (id === 'all') {
      const b = L.latLngBounds([]);
      for (const sh of this.sheets.values()) b.extend(sh.bounds);
      return b;
    }
    const r = this.regions.get(id);
    return r ? L.latLngBounds(r.bounds) : null;
  }

  /* ---------- Zoomed-out map: one framed sheet per region, the land around them veiled ---------- */
  /** Sheet extents: each region's bounds from index.json with a margin of about 1.3 km. */
  buildSheets() {
    const L = window.L;
    const P = SHEET_MARGIN;
    const rects = this.idx.regions.map(r => ({
      id: r.id, s: r.bounds[0][0] - P, w: r.bounds[0][1] - P * 1.45, n: r.bounds[1][0] + P, e: r.bounds[1][1] + P * 1.45,
    })).sort((a, b) => b.n - a.n);
    // Sheets that would overlap meet along a shared edge instead, like adjoining map sheets.
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (a.w < b.e && b.w < a.e && b.n > a.s) { const m = (a.s + b.n) / 2; a.s = m; b.n = m; }
      }
    }
    this.sheets = new Map(rects.map(r => [r.id, {
      id: r.id,
      ring: [[r.s, r.w], [r.n, r.w], [r.n, r.e], [r.s, r.e]],
      bounds: L.latLngBounds([r.s, r.w], [r.n, r.e]),
    }]));
  }

  buildVeil() {
    const L = window.L;
    const opt = { renderer: this.svgVeil, pane: 'veil', interactive: false };
    const outer = [[40, -6], [55, -6], [55, 16], [40, 16]];
    const sheets = [...this.sheets.values()];
    const veil = L.polygon([outer, ...sheets.map(sh => sh.ring)], {
      ...opt, stroke: false, fillColor: 'var(--paper)', fillOpacity: 0.8, className: 'atlas-veil',
    });
    for (const sh of sheets) {
      sh.frame = L.polygon(sh.ring, { ...opt, fill: false, color: 'var(--ink)', lineJoin: 'miter', ...FRAME });
    }
    L.layerGroup([veil, ...sheets.map(sh => sh.frame)]).addTo(this.map);
    this.updateZoomClasses();
  }

  /** Zoom-dependent states set as classes on the plate: the veil, far-off markers, transect heights. */
  updateZoomClasses() {
    if (!this.map) return;
    const z = this.map.getZoom();
    this.veilPane.classList.toggle('is-off', z >= Z.index);
    this.root.classList.toggle('is-far', z < Z.index);
    const endsWereOff = this.root.classList.contains('ends-off');
    this.root.classList.toggle('ends-off', z < Z.ends);
    // Hidden end heights have no size, so Leaflet placed them beside their dots rather than above.
    // Once shown they are placed again.
    if (endsWereOff && z >= Z.ends && this.transectLayer) {
      this.transectLayer.eachLayer(l => { const t = l.getTooltip && l.getTooltip(); if (t) t.update(); });
    }
    this.root.classList.toggle('is-close', z >= 14.75); // the basemap quietens where every parcel is drawn
    this.updateMarkerFocus();
  }

  sheetAt(latlng) {
    for (const sh of this.sheets.values()) if (sh.bounds.contains(latlng)) return sh;
    return null;
  }

  hoverSheet(sh, evt) {
    if (sh === this.hotSheet) { if (sh && evt) this.showTip(evt); return; }
    if (this.hotSheet) {
      this.hotSheet.frame.setStyle(FRAME);
      if (!this.hovered) this.hideTip();
    }
    this.hotSheet = sh || null;
    this.mapEl.classList.toggle('is-sheet-hot', !!sh);
    if (!sh) return;
    sh.frame.setStyle(FRAME_HOT);
    this.tipNode = this.regionTip(sh.id);
    if (evt) this.showTip(evt);
  }

  regionTip(id) {
    const { h } = this.u;
    const r = this.regions.get(id);
    return h('div', {}, h('b', { text: r.name }), h('div', { text: this.regionCounts(r, true).join(' · ') }), h('div', { text: 'Click to open this region' }));
  }

  /** "18 village appellations", "325 premier cru climats", "7 grand crus" (the first only when `apps`). */
  regionCounts(r, apps = false) {
    const { fmt } = this.u, c = r.counts, nb = ' ';
    const out = [];
    if (apps) out.push(`${fmt.num(c.appellation)}${nb}village ${c.appellation === 1 ? 'appellation' : 'appellations'}`);
    out.push(`${fmt.num(c.climat)}${nb}premier cru ${c.climat === 1 ? 'climat' : 'climats'}`);
    if (c.grand_cru) out.push(`${fmt.num(c.grand_cru)}${nb}grand ${c.grand_cru === 1 ? 'cru' : 'crus'}`);
    return out;
  }

  /* ---------- Basemaps and geology ---------- */
  /**
   * IGN WMTS tile layers. With `sheet` the zoom limits are dropped, since the index sheets are
   * label-free at every scale. Every layer stays inside MAX_BOUNDS.
   */
  ignLayers({ sheet = false } = {}) {
    const L = window.L;
    const out = {};
    for (const [k, d] of Object.entries(IGN)) {
      const url = `${IGN_WMTS}&LAYER=${d.layer}&STYLE=${d.style || 'normal'}&FORMAT=${d.format || 'image/png'}&TILEMATRIXSET=${d.tms}`;
      out[k] = L.tileLayer(url, {
        // Tiles load once a zoom settles, not at every step of a fly-to, which spares the tile service.
        attribution: IGN_ATTR, crossOrigin: false, updateWhenZooming: false, bounds: MAX_BOUNDS,
        minNativeZoom: d.native[0], maxNativeZoom: d.native[1],
        // Leaflet picks the tile zoom by rounding, but prunes tiles by comparing the exact map zoom with
        // these limits. Set at the rounding midpoint, both tests agree, so no band of zooms goes blank.
        minZoom: sheet || d.min == null ? 0 : d.min - 0.5, maxZoom: sheet || d.max == null ? 20 : d.max + 0.4999,
        className: `tl-${k}`, zIndex: d.z,
      });
      out[k].on('tileerror', e => this.onTileError(e));
    }
    return out;
  }

  /** The Géoplateforme now and then answers 404 for a tile it serves a moment later. Retry each tile twice. */
  onTileError(e) {
    const img = e.tile;
    const n = img ? Number(img.dataset.retried || 0) : 2;
    if (n < 2) {
      img.dataset.retried = String(n + 1);
      const src = img.src.replace(/&retry=\d+$/, '');
      setTimeout(() => { if (img.isConnected) img.src = `${src}&retry=${n + 1}`; }, n ? 4000 : 1200);
      return;
    }
    this.tileErrors = (this.tileErrors || 0) + 1;
    if (this.tileErrors === 8) this.flash('Some IGN basemap tiles did not load. The appellation data is still shown.');
  }

  tileLayers() {
    if (this._tiles) return this._tiles;
    const L = window.L;
    const t = this._tiles = {
      ...this.ignLayers(),
      // 512 px requests: a quarter as many calls to the BRGM service as the default 256 px grid.
      // The service draws SCAN_D_GEOL50 only between 1:251,000 and 1:9,000 (its WMS capabilities),
      // which on this grid is tile zooms 12 to 15. Closer in, the zoom 15 images are enlarged.
      // Its credit is added once a tile has loaded (see setGeology).
      geology: L.tileLayer.wms('https://geoservices.brgm.fr/geologie', {
        layers: 'SCAN_D_GEOL50', format: 'image/png', transparent: true, version: '1.3.0', tileSize: 512,
        pane: 'geology', className: 'tl-geol',
        minZoom: Z.geology, maxZoom: 19, minNativeZoom: 12, maxNativeZoom: 15, bounds: MAX_BOUNDS,
      }),
    };
    // A close view asks for only one or two of these tiles, so no fixed count of failures can tell a
    // refusing service from one bad tile. The service is taken to be down once every tile asked for has
    // failed and none has loaded. Tiles dropped mid-load by a zoom or a pan count as neither. A tile
    // that never answers cannot hold the note back for long either.
    const key = e => `${e.coords.x}:${e.coords.y}:${e.coords.z}`;
    const judge = force => {
      const g = this.geoHealth;
      if (g.ok || !g.err || g.down || (g.pending.size && !force)) return;
      g.down = true;
      this.setGeoAvailable(false);
    };
    t.geology.on('tileloadstart', e => this.geoHealth.pending.add(key(e)));
    t.geology.on('tileabort tileunload', e => { this.geoHealth.pending.delete(key(e)); judge(); });
    t.geology.on('tileload', e => {
      const g = this.geoHealth;
      g.pending.delete(key(e));
      g.ok += 1;
      if (g.ok === 1) { g.down = false; this.setGeoAvailable(true); }
    });
    t.geology.on('tileerror', e => {
      const g = this.geoHealth;
      g.pending.delete(key(e));
      g.err += 1;
      if (g.err === 1) { clearTimeout(this._geoT); this._geoT = setTimeout(() => { if (g === this.geoHealth) judge(true); }, 8000); }
      judge();
    });
    return t;
  }

  freshGeoHealth() {
    clearTimeout(this._geoT);
    return { ok: 0, err: 0, pending: new Set(), down: false };
  }

  /** Put the chosen basemap on the main map, or on the index sheets while the index is shown. */
  syncBase() {
    if (!this.tilesOn) return;
    const t = this.tileLayers();
    const want = BASES[this.state.basemap];
    for (const k of Object.keys(IGN)) this.toggleOn(this.map, t[k], !this.indexOn && want.includes(k));
    const sheetWant = SHEET_BASES[this.state.basemap];
    for (const sh of this.idxSheets ? this.idxSheets.values() : []) {
      if (!sh.map) continue;
      if (!sh.tiles) sh.tiles = this.ignLayers({ sheet: true });
      for (const k of Object.keys(IGN)) this.toggleOn(sh.map, sh.tiles[k], this.indexOn && sheetWant.includes(k));
    }
  }

  toggleOn(map, layer, on) {
    const has = map.hasLayer(layer);
    if (on && !has) layer.addTo(map);
    if (!on && has) map.removeLayer(layer);
  }

  setBasemap(id, { save = true } = {}) {
    this.state.basemap = id;
    this.root.dataset.basemap = id;
    this.baseSeg.setValue(id);
    if (save) this.u.store.set('atlas.basemap', id);
    this.syncBase();
    this.restyleAll();
  }

  setGeology(on) {
    this.state.geology = on;
    this.geoBtn.setAttribute('aria-pressed', String(on));
    this.geoExtra.hidden = !on;
    const t = this.tileLayers();
    t.geology.setOpacity(this.state.geoOpacity);
    if (on) {
      this.geoHealth = this.freshGeoHealth();
      this.geoStatus.hidden = true;
    } else {
      this.setGeoCredit(false);
      this.geoLegend.hidden = true;
      this.geoStatus.hidden = true;
    }
    this.syncGeology();
    this.updateGeoNote();
    this.announce(on ? 'Geological map shown.' : 'Geological map hidden.');
  }

  /** The geological map is drawn on the main map only, so nothing is asked of BRGM while the index is up. */
  syncGeology() {
    if (!this._tiles && !this.state.geology) return;
    this.toggleOn(this.map, this.tileLayers().geology, this.state.geology && !this.indexOn);
  }

  /** The note, the legend line and the BRGM credit appear only once the service has sent a tile. */
  setGeoAvailable(ok) {
    if (!this.state.geology) return;
    this.geoStatus.hidden = ok;
    this.geoLegend.hidden = !ok;
    this.setGeoCredit(ok);
    if (!ok) this.announce('The BRGM geological map is not responding right now.');
    this.updateGeoNote();
  }

  setGeoCredit(on) {
    if (on === !!this.geoCredit) return;
    this.geoCredit = on;
    if (on) this.attribution.addAttribution(BRGM_ATTR); else this.attribution.removeAttribution(BRGM_ATTR);
  }

  retryGeology() {
    const t = this.tileLayers();
    this.geoHealth = this.freshGeoHealth();
    this.geoStatus.hidden = true;
    t.geology.redraw();
    this.announce('Trying the geological map again.');
  }

  setGeoOpacity(v) {
    this.state.geoOpacity = v;
    this.u.store.set('atlas.geoOpacity', v);
    if (this._tiles) this._tiles.geology.setOpacity(v);
  }

  updateGeoNote() {
    if (!this.map) return;
    const far = this.indexOn || this.map.getZoom() < Z.geology;
    this.geoZoomNote.hidden = !this.state.geology || !far || !this.geoStatus.hidden;
  }

  /**
   * "Zoom in" from the geology note: towards the open place, or the chosen region, or from the index
   * the region with the most mapped climats, so the reader lands on vineyards and not open country.
   */
  geoZoomIn() {
    const pnl = this.state.panel;
    let center = null;
    if (pnl && pnl.type === 'feature') center = (this.byId.get(pnl.id) || {}).center || null;
    if (pnl && pnl.type === 'village') center = (this.villages.get(pnl.id) || {}).marker || null;
    let region = this.state.region;
    if (region === 'all') region = [...this.idx.regions].sort((a, b) => b.counts.climat - a.counts.climat)[0].id;
    if (!center) {
      const rb = this.boundsFor(region), view = this.map.getCenter();
      center = !this.indexOn && rb.contains(view) ? view : rb.getCenter();
    }
    if (this.state.region !== region) this.setRegion(region, { emit: true, fit: false });
    const wasIndex = this.indexOn;
    if (wasIndex) this.showIndex(false);
    this.lastFit = null;
    this.fitting = true;
    this.map.setView(center, Math.max(12.5, wasIndex ? 0 : this.map.getZoom()), { animate: !wasIndex && !this.u.reducedMotion() });
    this.announce(`Zoomed in on ${this.u.regionName(region)}.`);
  }

  /* ---------- Theme ---------- */
  /** A diagonal hatch as a canvas pattern. Leaflet's canvas renderer accepts it as a fill colour. */
  hatch(color, gap = 6) {
    this._hatch = this._hatch || new Map();
    const key = `${color}|${gap}`;
    if (this._hatch.has(key)) return this._hatch.get(key);
    const r = Math.max(1, Math.round(window.devicePixelRatio || 1)), n = gap * r;
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d');
    g.strokeStyle = color;
    g.lineWidth = r;
    g.beginPath();
    for (const o of [-n, 0, n]) { g.moveTo(o, n); g.lineTo(o + n, 0); }
    g.stroke();
    const pattern = g.createPattern(c, 'repeat');
    if (r > 1 && pattern.setTransform && window.DOMMatrix) pattern.setTransform(new DOMMatrix().scale(1 / r));
    this._hatch.set(key, pattern);
    return pattern;
  }

  readColors() {
    const v = this.u.cssVar;
    // Level colours come from base.css through util.levelColor, so a re-stepped palette or a theme
    // switch reaches the canvas. Red-only ground is drawn in stone (the muted text colour), not in a level colour.
    // Over aerial photographs, lines are lifted towards white so they read against dark fields and woods.
    const lc = this.u.levelColor;
    const C = { gc: lc('grand-cru'), pc: lc('premier-cru'), vl: lc('village'), stone: v('--muted'), surface: v('--surface') };
    C.vlAerial = mixColor(C.vl, '#ffffff', 0.5);
    C.dark = this.u.theme() === 'dark';
    C.stoneAerial = mixColor(C.stone, '#ffffff', 0.55);
    return C;
  }

  applyTheme() {
    this.root.classList.toggle('is-dark', this.u.theme() === 'dark');
  }

  onTheme() {
    this.applyTheme();
    this.colors = this.readColors();
    this.restyleAll();
  }

  /* =====================================================================
     Data layers
     ===================================================================== */
  isRed(p) {
    if (typeof p.white === 'boolean') return p.white === false;
    const rec = this.byId && this.byId.get(p.id);
    if (rec && typeof rec.white === 'boolean') return rec.white === false;
    return this.appWhite.get(p.app || (rec && rec.app)) === false;
  }

  styleFor(p, mode) {
    const C = this.colors || this.readColors();
    const aerial = this.state.basemap === 'aerial';
    const k = this.fillK || 1;
    let s;
    if (p.kind === 'grand_cru') {
      s = { color: C.gc, weight: 1.6, opacity: 1, fillColor: C.gc, fillOpacity: aerial ? 0.3 : 0.4 };
    } else if (p.kind === 'climat') {
      s = { color: C.pc, weight: aerial ? 1.3 : 1, opacity: 0.95, fillColor: C.pc, fillOpacity: aerial ? 0.14 : 0.16 };
    } else {
      // In the cellar theme the green is the brightest level colour, so village lines are held back
      // to keep premier and grand crus ahead of them.
      s = { color: aerial ? C.vlAerial : C.vl, weight: aerial ? 1.4 : C.dark ? 1 : 1.1, opacity: aerial ? 0.9 : C.dark ? 0.6 : 0.9, fillColor: C.vl, fillOpacity: aerial ? 0.04 : C.dark ? 0.08 : 0.1 };
    }
    // Grand crus thin less than the rest, so they stay gilt rather than turning khaki over the relief.
    s.fillOpacity *= p.kind === 'grand_cru' ? Math.max(k, 0.78) : k;
    s.dashArray = null;
    if (this.isRed(p)) {
      // Red-only ground: a dashed stone outline over a fine stone hatch, so it recedes but stays legible.
      // Close in the hatch thins with the other fills. A red-only appellation is hatched only where no
      // climats are drawn (the overview and the index sheets). In a region's full detail its red climats
      // carry their own hatch, and a white-wine climat on its ground (Blagny) must not look hatched.
      const line = aerial ? C.stoneAerial : C.stone;
      const app = p.kind === 'appellation';
      const detail = p.area_ha != null; // overview features carry no figures
      let fo = (aerial ? 0.55 : 0.42) * (app ? 0.8 : 1) * k;
      if (this.map && this.map.getZoom() >= 15) fo = Math.min(fo, 0.25);
      const flat = app && detail;
      Object.assign(s, {
        color: line, fillColor: flat ? line : this.hatch(line, app ? 8 : 6), fillOpacity: flat ? 0.07 * k : fo,
        opacity: aerial ? 0.9 : 0.85, weight: app ? 1.1 : 0.9, dashArray: '3 3',
      });
    }
    if (mode === 'hover') {
      s.weight += 1.3;
      s.opacity = 1;
      s.fillOpacity = Math.min(0.62, s.fillOpacity + 0.16);
    }
    return s;
  }

  /** Close in, the fills thin out so the ground beneath them (vine rows on the aerial) shows through. */
  updateFillScale() {
    const z = this.map.getZoom();
    const k = z >= 15.5 ? 0.55 : z >= 14 ? 0.78 : 1;
    const cap = z >= 15;
    if (k === this.fillK && cap === this.hatchCap) return;
    this.fillK = k;
    this.hatchCap = cap;
    this.restyleAll();
  }

  restyleAll() {
    const all = [...this.overview.values(), ...[...this.detail.values()].map(d => d.layer)];
    for (const sh of this.idxSheets ? this.idxSheets.values() : []) if (sh.data) all.push(sh.data);
    for (const g of all) g.setStyle(f => this.styleFor(f.properties));
  }

  bindFeature(layer, p, fromOverview) {
    layer.on('mouseover', e => {
      if (this.hovered && this.hovered.layer !== layer) this.hovered.layer.setStyle(this.styleFor(this.hovered.p));
      this.hovered = { layer, p };
      layer.setStyle(this.styleFor(p, 'hover'));
      this.tipNode = this.tipFor(p);
      this.showTip(e.originalEvent);
    });
    layer.on('mousemove', e => this.showTip(e.originalEvent));
    layer.on('mouseout', () => {
      layer.setStyle(this.styleFor(p));
      if (this.hovered && this.hovered.layer === layer) this.hovered = null;
      this.hideTip();
    });
    layer.on('click', e => {
      this.hideTip();
      const shownAsDetail = this.shownDetail.has(p.region);
      this.openFeature(p.id, { fit: fromOverview || !shownAsDetail, animate: true, point: e.containerPoint, user: true });
    });
  }

  tipFor(p) {
    const { h } = this.u;
    const bits = [p.kind === 'appellation' ? 'Village appellation' : LEVEL_NAME[p.level] || ''];
    if (p.kind === 'climat' && p.app) bits.push(p.app);
    if (p.kind === 'appellation' && p.region) bits.push(this.u.regionName(p.region));
    if (this.isRed(p)) bits.push('Red wine only');
    return h('div', {}, h('b', { text: p.name }), h('div', { text: bits.join(' · ') }));
  }

  hideTip() {
    if (this._tipRaf) { cancelAnimationFrame(this._tipRaf); this._tipRaf = 0; }
    this._tipEvt = null;
    this.u.tip.hide();
  }

  showTip(evt) {
    if (!evt || !this.tipNode) return;
    this._tipEvt = evt;
    if (this._tipRaf) return;
    this._tipRaf = requestAnimationFrame(() => {
      this._tipRaf = 0;
      if (this.tipNode && this._tipEvt) this.u.tip.show(this._tipEvt, this.tipNode);
    });
  }

  addOverview(fc) {
    const L = window.L;
    const groups = new Map();
    this.overviewById = new Map(fc.features.map(f => [f.properties.id, f]));
    for (const f of fc.features) {
      const r = f.properties.region;
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(f);
    }
    for (const [r, feats] of groups) {
      const layer = L.geoJSON({ type: 'FeatureCollection', features: feats }, {
        renderer: this.canvas,
        style: f => this.styleFor(f.properties),
        onEachFeature: (f, l) => this.bindFeature(l, f.properties, true),
      });
      this.overview.set(r, layer);
    }
    this.syncSheetData();
    this.updateLayers();
    this.renderLabels();
  }

  ensureRegion(id) {
    if (this.detail.has(id)) return Promise.resolve(this.detail.get(id));
    if (!this.regions.has(id)) return Promise.reject(new Error(`unknown region ${id}`));
    if (!this.loading.has(id)) {
      this.setBusy(id, true);
      const p = this.data.region(id)
        .then(fc => {
          const d = this.buildDetail(id, fc);
          this.detail.set(id, d);
          return d;
        })
        .catch(err => {
          this.failedAt.set(id, Date.now());
          console.error(`[map] region ${id}`, err);
          this.flash(`The detail for ${this.u.regionName(id)} could not load.`);
          throw err;
        })
        .finally(() => { this.loading.delete(id); this.setBusy(id, false); });
      this.loading.set(id, p);
    }
    return this.loading.get(id);
  }

  buildDetail(id, fc) {
    const L = window.L;
    const byId = new Map(), byApp = new Map();
    let lo = Infinity, hi = -Infinity;
    for (const f of fc.features) {
      const p = f.properties;
      byId.set(p.id, { feature: f, layer: null });
      this.geomById.set(p.id, f.geometry);
      if (p.kind === 'appellation') {
        byApp.set(p.app, f);
        if (typeof p.white === 'boolean') this.appWhite.set(p.app, p.white);
      }
      if (p.elev && p.kind !== 'climat') { lo = Math.min(lo, p.elev[0]); hi = Math.max(hi, p.elev[2]); }
    }
    // The file's paint order is kept. Red-only twins of a white-wine climat are left out (see findTwins).
    const layer = L.geoJSON(fc, {
      renderer: this.canvas,
      filter: f => !this.hiddenTwins.has(f.properties.id),
      style: f => this.styleFor(f.properties),
      onEachFeature: (f, l) => {
        byId.get(f.properties.id).layer = l;
        this.bindFeature(l, f.properties, false);
      },
    });
    this.scheduleLabelPoints(fc);
    return { id, layer, byId, byApp, elevDomain: [lo, hi] };
  }

  setBusy(id, on) {
    this._busy = this._busy || new Set();
    if (on) this._busy.add(id); else this._busy.delete(id);
    if (this._flashing) return; // an error message keeps the chip until it times out
    const names = [...this._busy].map(r => this.u.regionName(r));
    // The text stays while the chip fades out, so it never shows as an empty pill.
    if (names.length) this.busy.textContent = `Loading ${names.join(' and ')}…`;
    this.busy.classList.toggle('on', names.length > 0);
  }

  flash(msg) {
    this._flashing = true;
    this.busy.textContent = msg;
    this.busy.classList.add('on', 'is-error');
    this.announce(msg);
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => {
      this._flashing = false;
      this.setBusy(null, false);
      // drop the error styling only once the chip has faded
      setTimeout(() => { if (!this._flashing) this.busy.classList.remove('is-error'); }, 260);
    }, 5000);
  }

  /** Decide which regions draw their full detail file and which the light overview. */
  updateLayers() {
    if (!this.map) return;
    const z = this.map.getZoom();
    const view = this.map.getBounds();
    let changed = false;
    for (const id of this.regions.keys()) {
      const want = !this.indexOn && (id === this.state.region || (z >= Z.detail && view.intersects(this.boundsFor(id))));
      const cooling = Date.now() - (this.failedAt.get(id) || 0) < 20000;
      if (want && !this.detail.has(id) && !cooling) this.ensureRegion(id).then(() => { this.updateLayers(); this.renderLabels(); }).catch(() => {});
      const showDetail = want && this.detail.has(id);
      const d = this.detail.get(id), o = this.overview.get(id);
      if (d) changed = this.toggle(d.layer, showDetail) || changed;
      if (o) changed = this.toggle(o, !showDetail) || changed;
      if (showDetail) this.shownDetail.add(id); else this.shownDetail.delete(id);
    }
    return changed;
  }

  toggle(layer, on) {
    const has = this.map.hasLayer(layer);
    if (on && !has) { layer.addTo(this.map); return true; }
    if (!on && has) { this.map.removeLayer(layer); return true; }
    return false;
  }

  /* =====================================================================
     Index: the four regions as separate sheets at one scale
     ===================================================================== */
  buildIndexView() {
    const { h } = this.u;
    this.indexEl = h('div', { class: 'atlas-index', hidden: true, attrs: { role: 'group', 'aria-label': 'Index of the four regions, each drawn as a sheet at the same scale' } });
    this.idxSheets = new Map();
    for (const r of this.idx.regions) {
      const parts = this.regionCounts(r);
      const mapEl = h('div', { class: 'atlas-sheet-map' });
      const frame = h('div', { class: 'atlas-sheet-frame' }, mapEl);
      const cap = h('div', { class: 'atlas-sheet-cap' },
        h('span', { class: 'atlas-sheet-name', text: r.name }),
        h('span', { class: 'atlas-sheet-sub num' }, parts.map(t => h('span', { text: t }))));
      const all = this.regionCounts(r, true);
      const btn = h('button', {
        type: 'button', class: 'atlas-sheet-hit',
        attrs: { 'aria-label': `${r.name}. ${all.join(', ')}. Open this region.` },
        on: {
          click: () => { this.hideTip(); this.setRegion(r.id, { emit: true }); },
          mouseenter: e => this.hoverIndexSheet(r.id, e),
          mousemove: e => this.showTip(e),
          mouseleave: () => this.hoverIndexSheet(null),
          focus: () => this.hoverIndexSheet(r.id),
          blur: () => this.hoverIndexSheet(null),
        },
      });
      // The frame and caption are a picture of the region. The button over them carries its name.
      const el = h('div', { class: 'atlas-sheet', dataset: { region: r.id } },
        h('div', { class: 'atlas-sheet-art', attrs: { 'aria-hidden': 'true' } }, frame, cap), btn);
      this.indexEl.append(el);
      this.idxSheets.set(r.id, { r, el, frame, mapEl, cap, btn, parts });
    }
    this.stage.insertBefore(this.indexEl, this.mapEl);
    this.locator = this.buildLocator();
    this.leftCol.append(this.locator);
  }

  hoverIndexSheet(id, evt) {
    for (const [k, sh] of this.idxSheets) sh.el.classList.toggle('is-hot', k === id);
    if (this.locatorBoxes) for (const [k, el] of this.locatorBoxes) el.classList.toggle('is-hot', k === id);
    if (!id) { this.hideTip(); return; }
    if (evt) { this.tipNode = this.regionTip(id); this.showTip(evt); }
  }

  /** A region's sheet: its bounds with the margin, the centre in Mercator, and its size in km. */
  sheetGeom(r) {
    if (r._sheet) return r._sheet;
    const L = window.L, P = SHEET_MARGIN, zr = 12;
    const b = L.latLngBounds([r.bounds[0][0] - P, r.bounds[0][1] - P * 1.45], [r.bounds[1][0] + P, r.bounds[1][1] + P * 1.45]);
    const crs = L.CRS.EPSG3857;
    const nw = crs.latLngToPoint(b.getNorthWest(), zr), se = crs.latLngToPoint(b.getSouthEast(), zr);
    const center = crs.pointToLatLng(nw.add(se).divideBy(2), zr);
    // Metres per pixel at zoom zr at this latitude (Web Mercator, 256 px tiles).
    const mpp = (40075016.686 * Math.cos((center.lat * Math.PI) / 180)) / (256 * 2 ** zr);
    r._sheet = { b, center, zr, mpp, wKm: ((se.x - nw.x) * mpp) / 1000, hKm: ((se.y - nw.y) * mpp) / 1000 };
    return r._sheet;
  }

  showIndex(on) {
    if (this.indexOn === on) { if (on) this.layoutIndex(); return; }
    this.indexOn = on;
    this.root.classList.toggle('is-index', on);
    // While the index is up the map behind it takes no focus and says nothing to screen readers.
    this.mapEl.inert = on;
    if (on) this.mapEl.setAttribute('aria-hidden', 'true'); else this.mapEl.removeAttribute('aria-hidden');
    this.zoomCard.hidden = on;
    clearTimeout(this._indexT);
    if (on) {
      this.indexEl.hidden = false;
      this.hoverSheet(null);
      this.layoutIndex();
      const show = () => this.indexEl.classList.add('on');
      if (this.u.reducedMotion()) show(); else requestAnimationFrame(() => requestAnimationFrame(show));
    } else {
      const hadFocus = this.indexEl.contains(document.activeElement);
      this.hoverIndexSheet(null);
      this.indexEl.classList.remove('on');
      this._indexT = setTimeout(() => { if (!this.indexOn) this.indexEl.hidden = true; }, this.u.reducedMotion() ? 0 : 320);
      this.locator.hidden = true;
      if (this.legendAuto) { this.legendAuto = false; this.setLegendOpen(true); }
      if (hadFocus) this.map.getContainer().focus({ preventScroll: true });
    }
    this.syncBase();
    this.syncGeology();
    this.updateLayers();
    this.renderFrame();
    this.renderLabels();
    this.updateZoomButtons();
    this.updateMarkerFocus();
    this.updateGeoNote();
  }

  /**
   * Arrange the sheets. Every sheet is drawn at the same scale, so their sizes compare. The rows
   * (all four in a row, two and two, and so on) are tried in north-to-south order and the one that
   * allows the largest scale wins. On a wide plate the sheets sit to the right of the controls, with
   * the legend open and a small locator. Where that would make them much smaller, they use the full
   * width between the layers card and the folded legend instead.
   */
  layoutIndex() {
    if (!this.indexOn) return;
    const W = this.stage.clientWidth, H = this.stage.clientHeight;
    if (!W || !H) return;
    const narrow = this.mq.matches;
    const G = narrow
      ? { gap: 18, rowGap: 14, capGap: 8, nameH: 21, subH: 15 }
      : { gap: 34, rowGap: 22, capGap: 10, nameH: 26, subH: 16 };
    // On phones a caption's counts may wrap between words, so the sheets can sit two by two.
    const items = [...this.idxSheets.values()].map(sh => ({
      sh, g: this.sheetGeom(sh.r),
      nameW: this.measure(sh.r.name, narrow ? 'capNameS' : 'capName'),
      minW: narrow
        ? Math.max(...sh.parts.flatMap(t => t.split(' ')).map(t => this.measure(t, 'capSub')))
        : Math.max(...sh.parts.map(t => this.measure(t, 'capSub'))),
      fullW: this.measure(sh.parts.join(' · '), 'capSub'),
      parts: sh.parts,
      nParts: sh.parts.length,
    }));
    const sr = this.stage.getBoundingClientRect();
    const layersBottom = this.layersCard.getBoundingClientRect().bottom - sr.top;
    const areaB = { x0: 12, y0: layersBottom + 14, x1: W - 12, y1: H - 12 - this.legendToggle.offsetHeight - 16 };
    const b = this.bestRows(items, areaB, G);
    let choice = b && { ...b, mode: 'b' };
    if (!narrow) {
      const right = 12 + Math.max(this.layersCard.offsetWidth, this.legend.offsetWidth);
      const a = this.bestRows(items, { x0: right + 36, y0: 16, x1: W - 16, y1: H - 16 }, G);
      if (a && (!b || a.s >= 0.75 * b.s)) choice = { ...a, mode: 'a' };
    }
    if (!choice) return;
    // The legend folds for the full-width arrangement and opens again when it is no longer needed.
    const legendOpen = this.legendToggle.getAttribute('aria-expanded') === 'true';
    if (!narrow && choice.mode === 'b' && legendOpen) { this.legendAuto = true; this.setLegendOpen(false); }
    if (choice.mode === 'a' && this.legendAuto && !legendOpen) { this.legendAuto = false; this.setLegendOpen(true); }

    const { s, R, th, area } = choice;
    let y = area.y0 + Math.max(0, (area.y1 - area.y0 - th) / 2);
    for (const row of R) {
      let x = area.x0 + Math.max(0, (area.x1 - area.x0 - row.width) / 2);
      for (const o of row.its) {
        const sh = o.it.sh, g = o.it.g;
        sh.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        sh.el.style.width = `${Math.round(o.iw)}px`;
        sh.frame.style.marginTop = `${Math.round(row.mapH - o.h)}px`;
        sh.frame.style.width = `${Math.round(o.w)}px`;
        sh.frame.style.height = `${Math.round(o.h)}px`;
        sh.cap.classList.toggle('is-stacked', o.iw < o.it.fullW);
        sh.cap.classList.toggle('is-wrap', o.lines > o.it.nParts);
        sh.view = { center: g.center, zoom: g.zr + Math.log2((s * g.mpp) / 1000) };
        x += o.iw + G.gap;
      }
      y += row.mapH + row.capH + G.rowGap;
    }
    this.indexS = s;
    for (const sh of this.idxSheets.values()) this.placeSheetMap(sh);
    this.syncBase();
    this.placeLocator(choice.mode === 'a' && !narrow);
    this.renderScale();
  }

  /** Try every split of the sheets into consecutive rows and keep the one with the largest scale. */
  bestRows(items, A, G) {
    const W = A.x1 - A.x0, H = A.y1 - A.y0;
    if (W < 80 || H < 80) return null;
    const n = items.length;
    let best = null;
    for (let mask = 0; mask < 1 << (n - 1); mask++) {
      const rows = [];
      let cur = [items[0]];
      for (let i = 1; i < n; i++) {
        if (mask & (1 << (i - 1))) { rows.push(cur); cur = []; }
        cur.push(items[i]);
      }
      rows.push(cur);
      const fit = this.fitRows(rows, W, H, G);
      if (fit && (!best || fit.s > best.s)) best = { ...fit, area: A };
    }
    return best;
  }

  fitRows(rows, W, H, G) {
    const build = s => rows.map(r => {
      const its = r.map(it => {
        const w = it.g.wKm * s, hh = it.g.hKm * s;
        const iw = Math.max(w, it.nameW, it.minW);
        const lines = iw >= it.fullW ? 1 : it.parts.reduce((a, t) => a + this.wrapLines(t, iw - 2, 'capSub'), 0);
        return { it, w, h: hh, iw, lines, cap: G.capGap + G.nameH + G.subH * lines };
      });
      return {
        its,
        width: its.reduce((a, o) => a + o.iw, 0) + G.gap * (its.length - 1),
        mapH: Math.max(...its.map(o => o.h)),
        capH: Math.max(...its.map(o => o.cap)),
      };
    });
    const capMin = G.capGap + G.nameH + G.subH;
    let s = Math.min(
      ...rows.map(r => (W - G.gap * (r.length - 1)) / r.reduce((a, it) => a + it.g.wKm, 0)),
      (H - G.rowGap * (rows.length - 1) - rows.length * capMin) / rows.reduce((a, r) => a + Math.max(...r.map(it => it.g.hKm)), 0));
    for (let k = 0; k < 90 && s > 1; k++) {
      const R = build(s);
      const tw = Math.max(...R.map(r => r.width));
      const th = R.reduce((a, r) => a + r.mapH + r.capH, 0) + G.rowGap * (R.length - 1);
      if (tw <= W && th <= H) return { s, R, tw, th };
      s *= 0.97;
    }
    return null;
  }

  /** Lines a caption takes at a given width, breaking only at ordinary spaces (as the browser does). */
  wrapLines(text, width, cls) {
    let lines = 1, cur = '';
    for (const word of text.split(' ')) {
      const t = cur ? `${cur} ${word}` : word;
      if (!cur || this.measure(t, cls) <= width) cur = t;
      else { lines += 1; cur = word; }
    }
    return lines;
  }

  /** A still Leaflet map inside each sheet: the basemap, the region's outlines and its profiled villages. */
  placeSheetMap(sh) {
    const L = window.L;
    if (!sh.map) {
      // No handlers, no animation and no tab stop. The button over the sheet is the control.
      sh.map = L.map(sh.mapEl, {
        zoomControl: false, attributionControl: false, dragging: false, touchZoom: false, doubleClickZoom: false,
        scrollWheelZoom: false, boxZoom: false, keyboard: false, zoomSnap: 0,
        zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, inertia: false,
      });
      sh.canvas = L.canvas({ padding: 0.05 });
    }
    sh.map.invalidateSize(false);
    if (sh.view) sh.map.setView(sh.view.center, sh.view.zoom, { animate: false });
    this.syncSheetData(sh);
  }

  syncSheetData(only) {
    const L = window.L;
    if (!this.overviewById || !this.idxSheets) return;
    for (const sh of only ? [only] : this.idxSheets.values()) {
      if (!sh.map || sh.data) continue;
      const feats = [...this.overviewById.values()].filter(f => f.properties.region === sh.r.id);
      sh.data = L.geoJSON({ type: 'FeatureCollection', features: feats }, {
        renderer: sh.canvas, interactive: false, style: f => this.styleFor(f.properties),
      }).addTo(sh.map);
      const icon = L.divIcon({ className: 'atlas-vmark is-static', html: '<span></span>', iconSize: [10, 10], iconAnchor: [5, 5] });
      L.layerGroup([...this.villages.values()]
        .filter(v => v.region === sh.r.id && Array.isArray(v.marker))
        .map(v => L.marker(v.marker, { icon, interactive: false, keyboard: false }))).addTo(sh.map);
    }
  }

  /**
   * The locator: the four sheets as rectangles in their true positions, at one small scale,
   * so the index keeps the geography that separate sheets leave out.
   */
  buildLocator() {
    const { h, s, fmt } = this.u;
    const regs = this.idx.regions;
    const P = SHEET_MARGIN;
    const box = r => ({ s: r.bounds[0][0] - P, w: r.bounds[0][1] - P * 1.45, n: r.bounds[1][0] + P, e: r.bounds[1][1] + P * 1.45 });
    const bx = regs.map(r => ({ r, ...box(r) }));
    const S = Math.min(...bx.map(b => b.s)), N = Math.max(...bx.map(b => b.n)), Wl = Math.min(...bx.map(b => b.w));
    const kx = 111.32 * Math.cos((((S + N) / 2) * Math.PI) / 180), ky = 110.57;
    const k = 132 / ((N - S) * ky); // px per km, so the column of sheets is 132 px tall
    const X = lng => 6 + (lng - Wl) * kx * k, Y = lat => 6 + (N - lat) * ky * k;
    const nameW = Math.max(...regs.map(r => this.measure(r.name, 'loc')));
    const right = Math.max(...bx.map(b => X(b.e)));
    const Wsvg = Math.ceil(right + 7 + nameW + 4), Hsvg = Math.ceil(Y(S) + 30);
    this.locatorBoxes = new Map();
    const svg = s('svg', { viewBox: `0 0 ${Wsvg} ${Hsvg}`, width: Wsvg, height: Hsvg, class: 'atlas-loc-svg', 'aria-hidden': 'true' });
    for (const b of bx) {
      const g = s('g', { class: 'loc-box' },
        s('rect', { x: X(b.w), y: Y(b.n), width: Math.max(2, X(b.e) - X(b.w)), height: Y(b.s) - Y(b.n) }),
        s('text', { x: X(b.e) + 6, y: (Y(b.n) + Y(b.s)) / 2 + 4, text: b.r.name }));
      this.locatorBoxes.set(b.r.id, g);
      svg.append(g);
    }
    // A 50 km bar, and north.
    const bar = 50 * k, y0 = Y(S) + 16;
    svg.append(s('path', { class: 'loc-bar', d: `M6 ${y0 - 4}V${y0}H${6 + bar}V${y0 - 4}` }),
      s('text', { class: 'loc-bar-t', x: 6 + bar + 5, y: y0 + 1, text: '50 km' }));
    const nx = Wsvg - 10;
    svg.append(s('path', { class: 'loc-north', d: `M${nx} 18V4M${nx - 3.5} 8.5L${nx} 4L${nx + 3.5} 8.5` }),
      s('text', { class: 'loc-bar-t', x: nx, y: 30, 'text-anchor': 'middle', text: 'N' }));
    // The region farthest from the others, and how far it lies from its nearest neighbour.
    let far = null;
    for (const r of regs) {
      const n = this.nearestRegion(r.id);
      if (n && (!far || n.km > far.n.km)) far = { r, n };
    }
    const sentence = far ? `${far.r.name} lies about ${fmt.num(far.n.km)} km ${far.n.word} of ${far.n.name}, centre to centre.` : '';
    return h('figure', { class: 'atlas-ctl atlas-locator', hidden: true },
      h('figcaption', { class: 'eyebrow atlas-loc-k', text: 'Sheets in place' }),
      svg,
      sentence ? h('p', { class: 'atlas-loc-note', text: sentence }) : null,
      h('p', { class: 'visually-hidden', text: `The locator shows the four regions in their true positions, from ${regs[0].name} in the north to ${regs[regs.length - 1].name} in the south. ${sentence}` }));
  }

  /** The region nearest to `id`, by the centres of their bounds, with the distance and direction. */
  nearestRegion(id) {
    const L = window.L, { aspectWord } = this.u;
    const centre = r => L.latLngBounds(r.bounds).getCenter();
    const me = centre(this.regions.get(id));
    let near = null;
    for (const r of this.idx.regions) {
      if (r.id === id) continue;
      const c = centre(r), d = me.distanceTo(c);
      if (!near || d < near.d) near = { d, c, r };
    }
    if (!near) return null;
    const rad = Math.PI / 180, p1 = near.c.lat * rad, p2 = me.lat * rad, dl = (me.lng - near.c.lng) * rad;
    const deg = (Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / rad + 360) % 360;
    const word = aspectWord(SECTORS[Math.round(deg / 45) % 8]);
    return { km: Math.round(near.d / 10000) * 10, word, name: regionWithArticle(near.r.name) };
  }

  /** Show the locator between the layers card and the legend when there is room for it. */
  placeLocator(want) {
    const loc = this.locator;
    if (!want) { loc.hidden = true; return; }
    loc.hidden = false;
    const sr = this.stage.getBoundingClientRect();
    const lc = this.layersCard.getBoundingClientRect(), lg = this.legend.getBoundingClientRect();
    const room = lg.top - lc.bottom - 16;
    loc.hidden = loc.offsetHeight + 8 > room || lg.top - sr.top < 0;
  }

  /* =====================================================================
     Village markers
     ===================================================================== */
  villageName(v) {
    // Prefer the INAO spelling (with accents) when it names the same place.
    const f = this.u.fold;
    return (v.apps || []).find(a => f(a) === f(v.name)) || v.name;
  }

  buildMarkers() {
    const L = window.L;
    this.markers = new Map();
    // A 24 px target (32 px on touch screens) around a 13 px dot.
    const hit = this.coarse ? 32 : 24;
    const icon = L.divIcon({ className: 'atlas-vmark', html: '<span></span>', iconSize: [hit, hit], iconAnchor: [hit / 2, hit / 2] });
    for (const v of this.villages.values()) {
      if (!Array.isArray(v.marker)) continue;
      const name = this.villageName(v);
      const m = L.marker(v.marker, { icon, keyboard: true, autoPanOnFocus: false, riseOnHover: true, bubblingMouseEvents: false }).addTo(this.map);
      const el = m.getElement();
      el.setAttribute('aria-label', `${name}, profiled village. Open its summary.`);
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.openVillage(v.id, { focus: true, fit: this.map.getZoom() < Z.index, user: true }); }
      });
      // From the zoomed-out map a marker also brings its appellation into view. Closer in, the map stays put.
      m.on('click', () => { this.hideTip(); this.openVillage(v.id, { fit: this.map.getZoom() < Z.index, user: true }); });
      m.on('mouseover', e => {
        const { h } = this.u;
        this.tipNode = h('div', {}, h('b', { text: name }), h('div', { text: `Profiled village · ${v.regionName || this.u.regionName(v.region)}` }));
        this.showTip(e.originalEvent);
      });
      m.on('mouseout', () => this.hideTip());
      this.markers.set(v.id, m);
    }
    this.updateMarkerFocus();
  }

  /**
   * Only markers inside the view, and only once the map is close enough to name them, take a tab
   * stop. A marker under the legend, the controls or the panel takes none either, since its focus
   * ring would be hidden. The search box and the region control reach every village too.
   */
  updateMarkerFocus() {
    if (!this.markers || !this.map) return;
    const view = this.map.getBounds(), far = this.map.getZoom() < Z.index;
    const boxes = this.indexOn || far ? [] : this.overlayBoxes(4);
    for (const m of this.markers.values()) {
      const el = m.getElement();
      if (!el) continue;
      let on = !this.indexOn && !far && view.contains(m.getLatLng());
      if (on) {
        const p = this.map.latLngToContainerPoint(m.getLatLng());
        on = !boxes.some(b => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
      }
      el.tabIndex = on ? 0 : -1;
    }
  }

  /** Boxes of the cards laid over the map (controls, legend, panel), in map container pixels. */
  overlayBoxes(pad = 0) {
    const sr = this.stage.getBoundingClientRect();
    const out = [];
    for (const el of [this.layersCard, this.zoomCard, this.locator, this.legend, this.panel]) {
      if (!el || el.hidden || !el.offsetParent) continue;
      const r = el.getBoundingClientRect();
      out.push({ x: r.left - sr.left - pad, y: r.top - sr.top - pad, w: r.width + 2 * pad, h: r.height + 2 * pad });
    }
    return out;
  }

  /* =====================================================================
     Labels with greedy collision avoidance
     ===================================================================== */
  measure(text, cls) {
    const key = `${cls}|${text}`;
    if (this.widthCache.has(key)) return this.widthCache.get(key);
    const spec = LBL[cls];
    const ctx = this._mctx || (this._mctx = document.createElement('canvas').getContext('2d'));
    ctx.font = spec.font;
    const t = spec.upper ? text.toUpperCase() : text;
    const w = Math.ceil(ctx.measureText(t).width + spec.ls * spec.size * t.length + 2 * (spec.padX || 0)) + 2;
    this.widthCache.set(key, w);
    return w;
  }

  labelCandidates(z) {
    const out = [];
    const f = this.u.fold;
    if (z < Z.regionLabelsBelow) {
      for (const r of this.idx.regions) {
        const sh = this.sheets.get(r.id);
        const sub = this.regionSub(r);
        out.push({ key: `r:${r.id}`, text: r.name, sub, cls: 'region', bounds: [sh.bounds.getSouthWest(), sh.bounds.getNorthEast()], region: r.id, place: ['r', 'l', 'rt', 'lt', 'rb', 'lb', 'c'] });
      }
    }
    if (z >= Z.villageNames) {
      for (const v of this.villages.values()) if (Array.isArray(v.marker)) out.push({ key: `v:${v.id}`, text: this.villageName(v), cls: 'village', latlng: v.marker, place: ['r', 'l', 't', 'b'], village: true });
    }
    const feats = this.idx.features;
    const inside = ['c', 'n', 's'];
    if (z >= Z.gcLabels) {
      feats.filter(x => x.kind === 'grand_cru').sort((a, b) => b.area_ha - a.area_ha)
        .forEach(x => out.push({ key: `f:${x.id}`, id: x.id, text: x.name, cls: z >= 15 ? 'gc-lg' : 'gc', latlng: this.labelPoint(x), bbox: x.bbox, place: inside, minFill: 0 }));
    }
    const apps = z >= Z.appLabels[0] && z < Z.appLabels[1]
      ? feats.filter(x => x.kind === 'appellation').sort((a, b) => b.area_ha - a.area_ha)
        .map(x => ({ key: `f:${x.id}`, id: x.id, text: x.name, cls: 'app', latlng: this.labelPoint(x), bbox: x.bbox, place: inside, minFill: 0.35, red: x.white === false }))
      : [];
    // Appellation names lead until the climat names begin. From then on they fill the gaps left.
    if (z < Z.pcLabels) out.push(...apps);
    if (z >= Z.pcLabels) {
      feats.filter(x => x.kind === 'climat' && this.shownDetail.has(x.region) && !this.hiddenTwins.has(x.id)).sort((a, b) => b.area_ha - a.area_ha)
        .forEach(x => out.push({ key: `f:${x.id}`, id: x.id, text: x.name, cls: z >= 16.5 ? 'pc-lg' : 'pc', latlng: this.labelPoint(x), bbox: x.bbox, place: inside, minFill: 0.45, red: x.white === false }));
      out.push(...apps);
    }
    return out.map(c => ({ ...c, fold: f(c.text) }));
  }

  /**
   * Where a name sits: the point deepest inside the feature's largest part (its pole of inaccessibility),
   * once the region's full shapes are loaded. A bounding-box centre can fall outside a slanting strip
   * such as Montrachet. Until then the index centre stands in.
   */
  labelPoint(x) {
    return this.labelPts.get(x.id) || x.center;
  }

  computeLabelPoint(p, g) {
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    let best = null, bestA = -1;
    const lat0 = polys.length ? polys[0][0][0][1] : 0;
    const k = Math.cos((lat0 * Math.PI) / 180);
    const proj = poly => poly.map(ring => ring.map(([lng, lat]) => [lng * k, lat]));
    for (const poly of polys) {
      const P = proj(poly), a = Math.abs(ringArea(P[0]));
      if (a > bestA) { bestA = a; best = P; }
    }
    if (!best) return;
    // Holes smaller than 2% of the part cannot hold a name and only slow the search, so they are left out.
    const outerA = Math.abs(ringArea(best[0]));
    const rings = [best[0], ...best.slice(1).filter(r => Math.abs(ringArea(r)) > outerA * 0.02)];
    const pt = polylabel(rings);
    this.labelPts.set(p.id, [pt[1], pt[0] / k]);
  }

  /**
   * Label points for a region's shapes are worked out in idle time after its file loads, grand crus
   * first, so a large appellation never holds up a frame. Labels move onto them once all are ready.
   */
  scheduleLabelPoints(fc) {
    const rank = { grand_cru: 0, climat: 1, appellation: 2 };
    const todo = fc.features.filter(f => !this.labelPts.has(f.properties.id))
      .sort((a, b) => (rank[a.properties.kind] ?? 3) - (rank[b.properties.kind] ?? 3));
    const idle = window.requestIdleCallback
      ? fn => requestIdleCallback(fn, { timeout: 400 })
      : fn => setTimeout(() => fn({ timeRemaining: () => 8, didTimeout: false }), 16);
    const step = dl => {
      const t0 = performance.now();
      while (todo.length && (dl.timeRemaining() > 3 || (dl.didTimeout && performance.now() - t0 < 8))) {
        const f = todo.shift();
        this.computeLabelPoint(f.properties, f.geometry);
      }
      if (todo.length) idle(step);
      else this.renderLabels();
    };
    idle(step);
  }

  renderLabels() {
    if (!this.map || !this.idx) return;
    if (this.indexOn) { for (const el of this.labelEls.values()) el.hidden = true; return; }
    const map = this.map;
    const z = map.getZoom();
    const size = map.getSize();
    const view = map.getBounds().pad(0.05);
    const placed = [];
    const hit = b => placed.some(p => b.x < p.x + p.w && b.x + b.w > p.x && b.y < p.y + p.h && b.y + b.h > p.y);
    const inside = b => b.x >= 4 && b.y >= 4 && b.x + b.w <= size.x - 4 && b.y + b.h <= size.y - 4;

    // Obstacles: on-map controls, the open panel, the village dots and the transect's end heights.
    const sr = this.stage.getBoundingClientRect();
    const boxOf = (r, pad) => ({ x: r.left - sr.left - pad, y: r.top - sr.top - pad, w: r.width + 2 * pad, h: r.height + 2 * pad });
    for (const el of [this.layersCard, this.zoomCard, this.legend, this.panel]) {
      if (el.hidden || !el.offsetParent) continue;
      placed.push(boxOf(el.getBoundingClientRect(), 4));
    }
    for (const el of this.endsPane.querySelectorAll('.atlas-tt')) {
      const r = el.getBoundingClientRect();
      if (r.width) placed.push(boxOf(r, 2));
    }
    for (const m of this.markers.values()) {
      const p = map.latLngToContainerPoint(m.getLatLng());
      placed.push({ x: p.x - 7, y: p.y - 7, w: 14, h: 14 });
    }

    const villagesPlaced = [];
    const result = [];
    for (const c of this.labelCandidates(z)) {
      const spec = LBL[c.cls];
      let w = this.measure(c.text, c.cls), hgt = spec.h;
      if (c.sub) { w = Math.max(w, this.measure(c.sub, 'sub')); hgt += LBL.sub.h; }
      let anchor, box = null;
      if (c.bounds) {
        const b = window.L.latLngBounds(c.bounds);
        if (!view.intersects(b)) continue;
        const nw = map.latLngToContainerPoint(b.getNorthWest()), se = map.latLngToContainerPoint(b.getSouthEast());
        anchor = { minX: nw.x, maxX: se.x, minY: nw.y, maxY: se.y, midY: (nw.y + se.y) / 2, midX: (nw.x + se.x) / 2 };
      } else {
        if (!view.contains(c.latlng)) continue;
        anchor = map.latLngToContainerPoint(c.latlng);
        if (c.bbox) {
          const a = map.latLngToContainerPoint([c.bbox[0], c.bbox[1]]), b = map.latLngToContainerPoint([c.bbox[2], c.bbox[3]]);
          const ext = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
          if (ext < c.minFill * w) continue;
        }
        // A place already named by its village label needs no second name: an appellation anywhere on
        // the plate, a grand cru only when the two would sit close together.
        if (!c.village && villagesPlaced.some(v => v.fold === c.fold && (c.cls === 'app' || Math.hypot(v.x - anchor.x, v.y - anchor.y) < 150))) continue;
      }
      const geom = c.id && this.geomById.get(c.id);
      for (const pos of c.place) {
        let x, y;
        if (c.bounds) {
          // beside the sheet, centred, then aligned to its top or bottom edge
          const side = pos[0], v = pos[1];
          y = v === 't' ? anchor.minY : v === 'b' ? anchor.maxY - hgt : anchor.midY - hgt / 2;
          if (side === 'r') x = anchor.maxX + 14;
          else if (side === 'l') x = anchor.minX - 14 - w;
          else { x = anchor.midX - w / 2; y = anchor.midY - hgt / 2; }
        } else if (pos === 'c') { x = anchor.x - w / 2; y = anchor.y - hgt / 2; }
        else if (pos === 'n' || pos === 's') {
          // Just above or below the centre, if that spot still lies inside the shape.
          if (!geom) continue;
          const dy = (pos === 'n' ? -1 : 1) * (hgt + 2);
          const ll = map.containerPointToLatLng([anchor.x, anchor.y + dy]);
          if (!inGeom(ll.lng, ll.lat, geom)) continue;
          x = anchor.x - w / 2; y = anchor.y + dy - hgt / 2;
        }
        else if (pos === 'r') { x = anchor.x + 10; y = anchor.y - hgt / 2; }
        else if (pos === 'l') { x = anchor.x - 10 - w; y = anchor.y - hgt / 2; }
        else if (pos === 't') { x = anchor.x - w / 2; y = anchor.y - 10 - hgt; }
        else { x = anchor.x - w / 2; y = anchor.y + 9; }
        const bx = { x: x - 2, y: y - 1, w: w + 4, h: hgt + 2 };
        if (!inside(bx) || hit(bx)) continue;
        box = { x, y, w, h: hgt };
        placed.push(bx);
        break;
      }
      if (!box) continue;
      if (c.village) villagesPlaced.push({ fold: c.fold, x: anchor.x, y: anchor.y });
      result.push({ c, box });
    }

    // Write phase: reuse elements by key, position in layer coordinates.
    const used = new Set();
    for (const { c, box } of result) {
      used.add(c.key);
      let el = this.labelEls.get(c.key);
      if (!el) {
        el = document.createElement('span');
        if (c.region) {
          el.addEventListener('click', () => { this.hoverSheet(null); this.hideTip(); this.setRegion(c.region, { emit: true }); });
          el.addEventListener('mouseenter', e => { this.hoverSheet(this.sheets.get(c.region), e); });
          el.addEventListener('mousemove', e => this.showTip(e));
          el.addEventListener('mouseleave', () => this.hoverSheet(null));
        }
        this.labelEls.set(c.key, el);
        this.labelPane.append(el);
      }
      el.className = `atlas-lbl lbl-${c.cls}${c.red ? ' is-red' : ''}`;
      if (c.sub) {
        if (el.dataset.text !== c.text + c.sub) {
          el.dataset.text = c.text + c.sub;
          el.replaceChildren(c.text, this.u.h('span', { class: 'lbl-sub', text: c.sub }));
        }
      } else if (el.textContent !== c.text) { delete el.dataset.text; el.textContent = c.text; }
      const lp = map.containerPointToLayerPoint([box.x, box.y]);
      el.style.transform = `translate3d(${Math.round(lp.x)}px, ${Math.round(lp.y)}px, 0)`;
      el.hidden = false;
    }
    for (const [key, el] of this.labelEls) if (!used.has(key)) el.hidden = true;
  }

  /* =====================================================================
     Plate frame: graticule, scale bar
     ===================================================================== */
  renderFrame() {
    this.renderGraticule();
    this.renderScale();
  }

  renderGraticule() {
    if (!this.map) return;
    if (this.indexOn) {
      // Separate sheets share no coordinates, so the margin stays empty and the foot names the scale.
      this.gratTop.replaceChildren();
      this.gratLeft.replaceChildren();
      return;
    }
    const map = this.map, size = map.getSize();
    if (!size.x || !size.y) return;
    const b = map.getBounds();
    const narrow = this.mq.matches;
    const pick = (span, px, minPx) => {
      const steps = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200]; // seconds of arc
      const perSec = px / (span * 3600);
      return steps.find(s => s * perSec >= minPx) || 7200;
    };
    const ticks = (lo, hi, step) => {
      const out = [];
      for (let s = Math.ceil((lo * 3600) / step) * step; s <= hi * 3600; s += step) out.push(s / 3600);
      return out;
    };
    const lngStep = pick(b.getEast() - b.getWest(), size.x, narrow ? 120 : 130);
    const latStep = pick(b.getNorth() - b.getSouth(), size.y, narrow ? 100 : 110);
    const cy = b.getCenter().lat, cx = b.getCenter().lng;
    const top = ticks(b.getWest(), b.getEast(), lngStep).map(v => {
      const x = map.latLngToContainerPoint([cy, v]).x;
      return x > 24 && x < size.x - 24 ? { x, t: dms(v, 'E', 'W', lngStep < 60) } : null;
    }).filter(Boolean);
    const left = ticks(b.getSouth(), b.getNorth(), latStep).map(v => {
      const y = map.latLngToContainerPoint([v, cx]).y;
      return y > 24 && y < size.y - 24 ? { y, t: dms(v, 'N', 'S', latStep < 60) } : null;
    }).filter(Boolean);
    const { h } = this.u;
    this.gratTop.replaceChildren(...top.map(g => h('span', { class: 'gt', style: { transform: `translateX(${Math.round(g.x)}px)` } }, h('i'), g.t)));
    this.gratLeft.replaceChildren(...left.map(g => h('span', { class: 'gl', style: { transform: `translateY(${Math.round(g.y)}px)` } }, h('i'), h('b', { text: g.t }))));
  }

  renderScale() {
    const map = this.map, size = map.getSize();
    if (!size.x) return;
    let mpp;
    if (this.indexOn && this.indexS) {
      mpp = 1000 / this.indexS;
      this.coordEl.textContent = 'All four sheets at one scale';
    } else {
      const y = size.y / 2;
      mpp = map.distance(map.containerPointToLatLng([0, y]), map.containerPointToLatLng([100, y])) / 100;
      if (this.coordEl.textContent === 'All four sheets at one scale') this.coordEl.textContent = '';
    }
    const maxM = mpp * (this.mq.matches ? 90 : 130);
    const pow = 10 ** Math.floor(Math.log10(maxM));
    const d = maxM / pow;
    const nice = (d >= 5 ? 5 : d >= 2 ? 2 : 1) * pow;
    const w = Math.round(nice / mpp);
    const { fmt, h } = this.u;
    const label = nice >= 1000 ? `${fmt.num(nice / 1000, nice % 1000 ? 1 : 0)} km` : `${fmt.num(nice)} m`;
    this.scaleEl.replaceChildren(
      h('span', { class: 'sc-bar', style: { width: `${w}px` } }, h('i'), h('i'), h('i'), h('i')),
      h('span', { class: 'sc-lbl num' }, h('span', { text: '0' }), h('span', { text: label, style: { left: `${w}px` } })));
  }

  updateZoomButtons() {
    const z = this.map.getZoom();
    this.zoomIn.setAttribute('aria-disabled', String(z >= this.map.getMaxZoom()));
    this.zoomOut.setAttribute('aria-disabled', String(z <= this.map.getMinZoom() + 0.01));
  }

  /* =====================================================================
     Region control
     ===================================================================== */
  setRegion(id, { emit = false, fit = true, animate = true, keepPanel = false } = {}) {
    if (!this.regionIds().includes(id)) return;
    this.state.region = id;
    this.regionSeg.setValue(id);
    this.revealRegionButton();
    this.zoomFit.setAttribute('aria-label', id === 'all' ? 'Show the index of all four regions' : `Show the whole of ${this.u.regionName(id)}`);
    if (id !== 'all') this.ensureRegion(id).then(() => { this.updateLayers(); this.renderLabels(); }).catch(() => {});
    if (this.state.panel && !keepPanel) {
      const pr = this.panelRegion();
      if (id === 'all' || (pr && pr !== id)) this.closePanel();
    }
    this.updateCounts();
    this.syncTransectRow();
    if (fit) this.fitRegion(id, { animate });
    else this.updateLayers();
    if (emit) {
      this.bus.emit('region:select', { region: id, source: 'map' });
      this.announce(id === 'all' ? 'Showing the index of all four regions.' : `Showing ${this.u.regionName(id)}.`);
    }
  }

  /**
   * The Côte de Beaune, Côte Chalonnaise and Mâconnais sheets adjoin, so a reader can drag from one
   * into the next. The region control and the legend then follow the view, quietly: other plates are
   * told of a region only when the reader picks one.
   */
  syncRegionToView() {
    if (!this.userMoved || this.indexOn || this.map.getZoom() < Z.index) return;
    const sh = this.sheetAt(this.map.getCenter());
    if (sh && sh.id !== this.state.region) this.setRegion(sh.id, { emit: false, fit: false, keepPanel: true });
  }

  fitRegion(id, { animate = true } = {}) {
    if (id === 'all') { this.showIndex(true); return; }
    const b = this.boundsFor(id);
    if (b) this.fitTo(b, { animate, maxZoom: 15, region: id });
  }

  /** "325 premier cru climats · 7 grand crus" beside a region's sheet, or null on phones where the names stand alone. */
  regionSub(r) {
    if (this.mq.matches) return null;
    return this.regionCounts(r).join(' · ');
  }

  updateCounts() {
    const { fmt } = this.u;
    const id = this.state.region;
    const regs = id === 'all' ? this.idx.regions : [this.regions.get(id)];
    const sum = k => regs.reduce((a, r) => a + (r.counts[k] || 0), 0);
    for (const el of this.legendBody.querySelectorAll('[data-count]')) {
      const n = sum(el.dataset.count);
      el.textContent = fmt.num(n);
      el.closest('li').hidden = n === 0; // a region without grand crus has no gilt to explain
    }
    this.climatHint.hidden = id !== 'all';
    const red = this.idx.features.filter(f => f.white === false && (id === 'all' || f.region === id));
    const nApp = red.filter(f => f.kind === 'appellation').length, nOther = red.length - nApp;
    this.redRow.hidden = red.length === 0;
    this.redSub.textContent = [
      nApp ? `${fmt.num(nApp)} ${nApp === 1 ? 'appellation' : 'appellations'}` : null,
      nOther ? `${fmt.num(nOther)} ${nOther === 1 ? 'climat' : 'climats'}` : null,
    ].filter(Boolean).join(', ');
    const nV = [...this.villages.values()].filter(v => id === 'all' || v.region === id).length;
    this.villageCount.textContent = fmt.num(nV);
    this.legendTitle.textContent = id === 'all' ? 'All regions' : this.u.regionName(id);
    const where = id === 'all' ? 'the four white Burgundy regions in this atlas' : this.u.regionName(id);
    const intro = id === 'all' ? 'Index of the four regions, each drawn as a separate sheet at the same scale.' : `Map of ${where}.`;
    const held = listWords([
      `${fmt.num(sum('appellation'))} village appellations`,
      `${fmt.num(sum('climat'))} named premier cru climats`,
      sum('grand_cru') ? `${fmt.num(sum('grand_cru'))} grand crus` : null,
    ].filter(Boolean));
    this.summaryEl.textContent = `${intro} ${id === 'all' ? 'Together they hold' : 'It draws'} ${held}, and ${fmt.num(nV)} profiled ${nV === 1 ? 'village' : 'villages'}. Use the search box above the map to open any of them.`;
  }

  /* =====================================================================
     Fitting and visibility
     ===================================================================== */
  panelSize() {
    if (!this.state.panel || this.panel.hidden) return { right: 0, bottom: 0 };
    if (this.mq.matches) return { right: 0, bottom: this.panel.offsetHeight };
    return { right: this.panel.offsetWidth + 16, bottom: 0 };
  }

  /**
   * Frame `bounds`. `side` is the least room kept left and right of it (for labels that stand out
   * past its ends). `avoid` is a card in the lower left, such as the open legend. The target is framed
   * either to its right or above it, whichever lets it be drawn larger.
   */
  fitTo(bounds, { animate = true, maxZoom = 17, region = null, side = 0, avoid = null } = {}) {
    // Leaving the index: the map behind it jumps straight to the new view while the sheets fade.
    const fromIndex = this.indexOn;
    if (fromIndex) this.showIndex(false);
    // Remember the last framing so a resize can repeat it. Moves made while fitting are not the reader's.
    this.lastFit = { bounds, maxZoom, region, side, avoid };
    this.userMoved = false;
    this.fitting = true;
    clearTimeout(this._fitT);
    this._fitT = setTimeout(() => { this.fitting = false; }, 1500);
    const ps = this.panelSize();
    const narrow = this.mq.matches;
    let tl = [Math.max(side, narrow ? 20 : 64), narrow ? 64 : 84];
    let br = [ps.right + Math.max(side, narrow ? 20 : 40), ps.bottom + (narrow ? 20 : 40)];
    const sr = this.stage.getBoundingClientRect();
    const rel = el => { if (!el || el.hidden || !el.offsetParent) return null; const r = el.getBoundingClientRect(); return { left: r.left - sr.left, right: r.right - sr.left, bottom: r.bottom - sr.top }; };
    if (side) {
      // Labels standing about 30 px above the ends are kept off the controls. On phones the layers card
      // runs along the top and the zoom stack down the right. Wider, the zoom stack runs down the left.
      const lc = rel(this.layersCard), zc = rel(this.zoomCard);
      if (narrow) {
        if (lc) tl[1] = Math.max(tl[1], lc.bottom + 34);
        if (zc) br[0] = Math.max(br[0], ps.right + sr.width - zc.left + 30);
      } else if (zc) tl[0] = Math.max(tl[0], zc.right + 30);
    }
    if (avoid && !avoid.hidden && avoid.offsetParent) {
      const r = avoid.getBoundingClientRect(), gap = Math.max(16, side);
      const right = { tl: [Math.max(tl[0], r.right - sr.left + gap), tl[1]], br };
      const above = { tl, br: [br[0], Math.max(br[1], sr.bottom - r.top + gap)] };
      // A side that leaves too little of the map loses. (Leaflet reads padding wider than the map as room for any zoom.)
      const size = this.map.getSize();
      const zoomFor = o => {
        const pad = window.L.point(o.tl).add(o.br);
        if (size.x - pad.x < 80 || size.y - pad.y < 80) return -Infinity;
        const z = this.map.getBoundsZoom(bounds, false, pad);
        return Number.isFinite(z) ? z : -Infinity;
      };
      const zr = zoomFor(right), za = zoomFor(above);
      if (zr > -Infinity || za > -Infinity) ({ tl, br } = zr >= za ? right : above);
    }
    const opts = {
      paddingTopLeft: tl,
      paddingBottomRight: br,
      maxZoom,
    };
    const doAnimate = animate && !fromIndex && !this.u.reducedMotion() && this.visible !== false;
    if (!doAnimate) { this.map.fitBounds(bounds, { ...opts, animate: false }); return; }
    const far = !this.map.getBounds().pad(0.25).intersects(bounds);
    if (far) this.map.flyToBounds(bounds, { ...opts, duration: 1.1 });
    else this.map.fitBounds(bounds, { ...opts, animate: true });
  }

  /** Pan only when a point sits under the panel or too close to the frame, then bring it to the middle of the free area. */
  ensureVisible(point) {
    if (!point) return;
    const size = this.map.getSize(), ps = this.panelSize(), m = 40;
    const w = size.x - ps.right, hgt = size.y - ps.bottom;
    const inside = point.x >= m && point.x <= w - m && point.y >= m && point.y <= hgt - m;
    if (inside) return;
    this.map.panBy([point.x - w / 2, point.y - hgt / 2], { animate: !this.u.reducedMotion() });
  }

  /**
   * Scroll the page so the whole map is in view: the toolbar and the plate when they fit, else the
   * plate, else the stage from its top. Other plates and deep links only aim at the section heading.
   */
  revealStage() {
    const nav = document.getElementById('site-nav');
    const navH = nav ? nav.offsetHeight : 56;
    const vh = window.innerHeight, y = window.scrollY;
    const st = this.stage.getBoundingClientRect();
    if (st.top >= navH - 1 && st.bottom <= vh + 1) return; // already wholly in view
    const top = this.root.getBoundingClientRect().top + y;
    const plate = this.plate.getBoundingClientRect();
    const plateBottom = plate.bottom + y;
    const avail = vh - navH;
    let target;
    if (plateBottom - top + 16 <= avail) target = top - navH - 8;
    else if (plate.height + 8 <= avail) target = plateBottom - vh + 6;
    else target = this.stage.getBoundingClientRect().top + y - navH - 4;
    if (Math.abs(target - y) < 4) return;
    window.scrollTo({ top: Math.max(0, Math.round(target)), behavior: this.u.reducedMotion() ? 'auto' : 'smooth' });
  }

  /* =====================================================================
     Activation: wheel zoom and touch panning only after the map is chosen
     ===================================================================== */
  setupActivation() {
    const c = this.map.getContainer();
    const setActive = on => {
      if (this.state.active === on) return;
      this.state.active = on;
      this.root.classList.toggle('is-active', on);
      if (on) {
        this.map.scrollWheelZoom.enable();
        if (this.coarse) this.map.dragging.enable();
        this.hideHint();
      } else {
        this.map.scrollWheelZoom.disable();
        if (this.coarse) this.map.dragging.disable();
      }
    };
    c.addEventListener('pointerdown', () => setActive(true));
    c.addEventListener('focus', () => setActive(true));
    c.addEventListener('blur', e => { if (!this.stage.contains(e.relatedTarget)) setActive(false); });
    document.addEventListener('pointerdown', e => { if (!this.stage.contains(e.target)) setActive(false); }, { passive: true });
    c.addEventListener('wheel', () => {
      if (!this.state.active) this.showHint('Click the map to zoom with the scroll wheel');
    }, { passive: true });
    if (this.coarse) {
      c.addEventListener('touchstart', e => {
        if (!this.state.active && e.touches.length === 1) this.showHint('Tap the map to move it. Pinch to zoom.');
      }, { passive: true });
    }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(entries => {
        for (const e of entries) {
          this.visible = e.intersectionRatio > 0;
          if (e.intersectionRatio < 0.3) setActive(false);
        }
      }, { threshold: [0, 0.3] }).observe(this.stage);
    }
  }

  showHint(text) {
    this.hint.textContent = text;
    this.hint.classList.add('on');
    clearTimeout(this._hintT);
    this._hintT = setTimeout(() => this.hideHint(), 1600);
  }

  hideHint() { this.hint.classList.remove('on'); }

  /* =====================================================================
     Bus
     ===================================================================== */
  registerBus() {
    const bus = this.bus;
    bus.on('region:select', p => {
      if (!p || p.source === 'map' || !this.regionIds().includes(p.region)) return;
      this.setRegion(p.region, { emit: false, animate: p.source !== 'url' });
    });
    bus.on('feature:focus', p => { if (p && p.id) this.focusFeature(p.id, p); });
    bus.on('village:focus', p => { if (p && p.id && p.source !== 'map') this.focusVillage(p.id, p); });
    bus.on('transect:show', p => { if (p && p.id) this.showTransect(p.id, p); });
    bus.on('theme:change', () => this.onTheme());
  }

  /**
   * Bring the stage into view for a request from another plate or a link. Plates that send one also
   * scroll to the section heading straight after emitting, so this runs once their scroll has started.
   */
  revealSoon() {
    Promise.resolve().then(() => requestAnimationFrame(() => this.revealStage()));
  }

  async focusFeature(id, payload = {}) {
    const rec = this.byId.get(id);
    const fromMap = payload.source === 'map';
    if (!rec) {
      if (payload.source === 'url') {
        this.u.setParam('feature', null);
        this.flash('No place in the atlas matches that link.');
        this.revealSoon(); // the message sits on the map, which the page has scrolled towards
      } else this.announce('That place is not in the atlas.');
      return;
    }
    if (!fromMap) this.revealSoon();
    const token = ++this.focusToken;
    try { await this.ensureRegion(rec.region); } catch { return; }
    if (token !== this.focusToken) return;
    if (this.state.region !== rec.region) this.setRegion(rec.region, { emit: fromMap, fit: false, keepPanel: true });
    // Plates that send a place here scroll the page to the map, so keyboard focus follows to the panel title.
    // A cold deep link leaves focus where the browser put it.
    await this.openFeature(id, { fit: true, animate: payload.source !== 'url', focus: !fromMap && payload.source !== 'url' && payload.focusPanel !== false });
  }

  async focusVillage(id, payload = {}) {
    const v = this.villages.get(id);
    if (!v) return;
    const token = ++this.focusToken;
    const reveal = payload.reveal === 'map';
    // Another plate asked to see this village on the map: bring the map into view, and once it has
    // framed the village, put keyboard focus on the summary's title so the reader is not left far below.
    if (reveal) this.revealSoon();
    try { await this.ensureRegion(v.region); } catch { return; }
    if (token !== this.focusToken) return;
    if (this.state.region !== v.region) this.setRegion(v.region, { emit: false, fit: false, keepPanel: true });
    await this.openVillage(id, { fit: true, animate: payload.source !== 'url', quiet: !reveal });
    if (reveal && token === this.focusToken && this.state.panel && this.state.panel.id === id) {
      const t = this.panel.querySelector('#atlas-panel-title');
      if (t) t.focus({ preventScroll: true });
    }
  }

  /* =====================================================================
     Panel
     ===================================================================== */
  panelRegion() {
    const p = this.state.panel;
    if (!p) return null;
    if (p.type === 'village') return (this.villages.get(p.id) || {}).region;
    return (this.byId.get(p.id) || {}).region;
  }

  showPanel(nodes, { focus = false } = {}) {
    const wasHidden = this.panel.hidden;
    // Closing goes back to whatever opened the panel last (a marker, the search box), not to what
    // opened the first of a run of panels, which may by now lie far outside the view.
    const ae = document.activeElement;
    if (ae && ae !== document.body && this.root.contains(ae) && !this.panel.contains(ae)) this.returnFocus = ae;
    else if (wasHidden) this.returnFocus = null;
    if (wasHidden) this.setSheetTall(false);
    this.panelBody.replaceChildren(...nodes.filter(Boolean));
    this.panelBody.scrollTop = 0;
    this.panel.scrollTop = 0;
    this.panel.hidden = false;
    this.root.classList.add('has-panel');
    if (wasHidden && !this.u.reducedMotion()) {
      this.panel.classList.add('is-entering');
      requestAnimationFrame(() => requestAnimationFrame(() => this.panel.classList.remove('is-entering')));
    }
    if (focus) {
      const t = this.panel.querySelector('#atlas-panel-title');
      if (t) t.focus({ preventScroll: true });
    }
    this.updateMarkerFocus();
    requestAnimationFrame(() => this.renderLabels());
  }

  closePanel({ restoreFocus = false, pointer = false } = {}) {
    if (!this.state.panel) return;
    const hadFocus = this.panel.contains(document.activeElement);
    const sheetH = this.mq.matches ? this.panel.offsetHeight : 0;
    this.state.panel = null;
    this.panel.hidden = true;
    this.root.classList.remove('has-panel');
    this.clearSelection();
    this.u.setParam('feature', null);
    // A marker is a fit place to return to only while it still takes a tab stop (in view and clear of the controls).
    this.updateMarkerFocus();
    const rf = this.returnFocus;
    const usable = rf && document.contains(rf) && !rf.closest('[inert]') && !(this.mapEl.contains(rf) && rf !== this.map.getContainer() && rf.tabIndex < 0);
    let back = restoreFocus || hadFocus ? (usable ? rf : this.map.getContainer()) : null;
    // A tap or click on Close must not land in the search box, where a phone would raise its keyboard.
    if (pointer && back === this.input) back = this.map.getContainer();
    // Going back to the search box keeps the name typed there. Otherwise the box is cleared.
    if (back !== this.input) this.syncSearch(null);
    this.announce('Details closed.');
    if (back) {
      this.quietFocus = true; // returning focus must not pop the suggestion list open
      back.focus({ preventScroll: true });
      this.quietFocus = false;
    }
    this.returnFocus = null;
    // On phones the bottom sheet covered the lower part of the view. Re-centre what was left above it.
    if (sheetH && !this.indexOn) {
      this.fitting = true;
      this.map.panBy([0, -sheetH / 2], { animate: !this.u.reducedMotion() });
    }
    requestAnimationFrame(() => this.renderLabels());
  }

  select(feature) {
    this.clearSelection();
    this.selFeature = feature;
    this.drawSelection();
  }

  /**
   * Village appellations are made of many parcels split by roads and paths, so their full outlines
   * turn into a web. A selected appellation is therefore always outlined with its gap-closed overview
   * shape, in a light line. Grand crus switch to their full-detail shape from Z.selDetail, and climats
   * (which have no overview shape) always use it.
   */
  drawSelection() {
    const L = window.L;
    const f = this.selFeature;
    if (!f) return;
    const p = f.properties;
    const hasCoarse = this.overviewById && this.overviewById.has(p.id);
    const app = p.kind === 'appellation';
    const coarse = hasCoarse && (app || this.map.getZoom() < Z.selDetail);
    const mode = coarse ? 'coarse' : 'detail';
    if (this.selLayer && this.selMode === mode) return;
    if (this.selLayer) this.selLayer.remove();
    this.selMode = mode;
    const geo = coarse ? this.overviewById.get(p.id) : f;
    const base = { renderer: this.svgSel, pane: 'selection', interactive: false };
    const halo = app ? { weight: 3.5, opacity: 0.55 } : coarse ? { weight: 4, opacity: 0.8 } : { weight: 4.5, opacity: 0.85 };
    const line = app ? { weight: 1.3, opacity: 0.8 } : coarse ? { weight: 1.5, opacity: 1 } : { weight: 1.8, opacity: 1 };
    this.selLayer = L.layerGroup([
      L.geoJSON(geo, { ...base, style: { color: 'var(--paper)', ...halo, fill: false, lineJoin: 'round' } }),
      L.geoJSON(geo, { ...base, style: { color: 'var(--ink)', ...line, fill: false, lineJoin: 'round' } }),
    ]).addTo(this.map);
  }

  clearSelection() {
    if (this.selLayer) { this.selLayer.remove(); this.selLayer = null; }
    this.selFeature = null;
    this.selMode = null;
  }

  async openFeature(id, { fit = false, animate = true, focus = false, point = null, user = false } = {}) {
    const rec = this.byId.get(id);
    if (!rec) return;
    let det;
    try { det = await this.ensureRegion(rec.region); } catch { return; }
    const entry = det.byId.get(id);
    if (!entry) return;
    await this.transectsReady;
    // A place opened on the map moves the region control (and the other plates) with it.
    if (rec.region !== this.state.region) this.setRegion(rec.region, { emit: user, fit: false, keepPanel: true });
    const p = entry.feature.properties;
    this.state.panel = { type: 'feature', id };
    this.showPanel(this.featurePanel(p, det), { focus });
    this.select(entry.feature);
    this.u.setParam('feature', id);
    this.syncSearch(p.name);
    this.announce(`${p.name}, ${(KIND_LABEL[p.kind] || 'place').toLowerCase()}. Details open.`);
    if (fit || this.indexOn) this.fitTo(window.L.latLngBounds([rec.bbox[0], rec.bbox[1]], [rec.bbox[2], rec.bbox[3]]), { animate, maxZoom: 17 });
    else this.ensureVisible(point);
  }

  async openVillage(id, { fit = false, animate = true, focus = false, quiet = false, user = false } = {}) {
    const v = this.villages.get(id);
    if (!v) return;
    let det = null;
    try { det = await this.ensureRegion(v.region); } catch { /* the summary still works without the region file */ }
    if (v.region !== this.state.region) this.setRegion(v.region, { emit: user, fit: false, keepPanel: true });
    this.state.panel = { type: 'village', id };
    this.showPanel(this.villagePanel(v, det), { focus });
    const appId = v.featureIds && v.featureIds.appellation && v.featureIds.appellation[0];
    const entry = det && appId ? det.byId.get(appId) : null;
    if (entry) this.select(entry.feature); else this.clearSelection();
    this.u.setParam('feature', null);
    this.syncSearch(this.villageName(v));
    // A village chosen on another plate updates the map quietly, so screen readers there are not interrupted.
    if (!quiet) this.announce(`${this.villageName(v)}, profiled village. Summary open.`);
    const rec = appId && this.byId.get(appId);
    if ((fit || this.indexOn) && rec) this.fitTo(window.L.latLngBounds([rec.bbox[0], rec.bbox[1]], [rec.bbox[2], rec.bbox[3]]), { animate, maxZoom: 15 });
    else if (!fit) this.ensureVisible(this.map.latLngToContainerPoint(v.marker));
  }

  indexTransects(t) {
    this.transects = t;
    this.featureTransect = new Map();
    for (const tr of t.transects) for (const s of tr.segments) if (s.feature && !this.featureTransect.has(s.feature)) this.featureTransect.set(s.feature, tr.id);
    return t;
  }

  /* ---------- Panel content ---------- */
  panelHead(eyebrow, title, sub) {
    const { h } = this.u;
    return [
      h('p', { class: 'eyebrow atlas-p-eyebrow', text: eyebrow }),
      h('h3', { class: 'atlas-p-title', attrs: { id: 'atlas-panel-title', tabindex: '-1' }, text: title }),
      sub ? h('p', { class: 'atlas-p-full', text: sub }) : null,
    ];
  }

  /**
   * Petit Chablis is drawn as the land entitled to Petit Chablis but not to Chablis. Its record in
   * the region file describes the whole delimitation, so the panel uses the village profile's figures,
   * which were computed on the drawn land.
   */
  exclusiveStats(p) {
    if (p.display_note !== 'petit-chablis-exclusive') return null;
    const v = p.village && this.villages.get(p.village);
    const st = v && v.stats;
    const ids = (v && v.featureIds && v.featureIds.appellation) || [];
    if (!st || !st.all || !st.area_ha || !ids.includes(p.id)) return null;
    return { area: st.area_ha.total, all: st.all };
  }

  featurePanel(p, det) {
    const { h, fmt } = this.u;
    const kind = KIND_LABEL[p.kind] || '';
    const nodes = this.panelHead(`${this.u.regionName(p.region)} · ${kind}`, p.name, p.full && p.full !== p.name ? p.full : null);

    const badges = h('div', { class: 'atlas-p-badges' }, h('span', { class: 'badge', dataset: { level: p.level }, text: LEVEL_NAME[p.level] || '' }));
    if (this.isRed(p)) badges.append(h('span', { class: 'chip atlas-red-chip', text: 'Red wine only' }));
    nodes.push(badges);

    const actions = h('div', { class: 'atlas-p-actions' });
    if (p.village && this.villages.has(p.village)) {
      const v = this.villages.get(p.village);
      actions.append(h('button', {
        type: 'button', class: 'btn btn-sm', text: 'Village profile',
        attrs: { 'aria-label': `Village profile of ${this.villageName(v)}` },
        on: { click: () => this.bus.emit('village:focus', { id: p.village, reveal: 'card', source: 'map' }) },
      }));
    }
    const tid = this.featureTransect && this.featureTransect.get(p.id);
    if (tid) {
      actions.append(h('button', {
        type: 'button', class: 'btn btn-sm btn-ghost', text: 'See it in cross-section',
        // The slope plate scrolls itself into view and takes focus for a line sent from the map.
        on: { click: () => this.bus.emit('transect:show', { id: tid, source: 'map' }) },
      }));
    }
    actions.append(h('button', {
      type: 'button', class: 'link-btn atlas-p-zoom', text: 'Zoom to fit',
      on: { click: () => { const r = this.byId.get(p.id); this.fitTo(window.L.latLngBounds([r.bbox[0], r.bbox[1]], [r.bbox[2], r.bbox[3]]), { maxZoom: 17 }); } },
    }));
    nodes.push(actions);

    const ex = this.exclusiveStats(p);
    const facts = h('dl', { class: 'facts atlas-facts' });
    if (p.kind !== 'appellation' || p.app !== p.name) facts.append(fact(h, 'Appellation', p.app));
    // Where the level table below takes the village profile's figures, the area comes from there too,
    // so the panel gives one total. The region file and the profile can differ in the last decimal.
    const lvl = p.kind === 'appellation' && p.pc_area_ha ? this.landByLevel(p, det) : null;
    if (ex) {
      facts.append(fact(h, 'Area drawn', fmt.ha(ex.area), 'num'), fact(h, 'Whole delimitation', fmt.ha(p.area_ha), 'num'));
    } else facts.append(fact(h, 'Delimited area', fmt.ha(lvl && lvl.profile ? lvl.total : p.area_ha), 'num'));
    if (p.kind === 'appellation') facts.append(fact(h, 'Named premier cru climats', fmt.num(p.n_climats || 0), 'num'));
    nodes.push(facts);
    if (p.kind === 'appellation' && p.village && p.app === p.name) nodes.push(this.officialClimatsNote(this.villages.get(p.village), p.n_climats));
    if (p.communes && p.communes.length) nodes.push(this.communes(p.communes));

    const notes = [];
    if (this.isRed(p)) notes.push('Red wine only. In the data this denomination does not allow white wine.');
    if (p.display_note === 'petit-chablis-exclusive') {
      notes.push(ex
        ? `The shape shows land entitled to Petit Chablis but not to Chablis. Every figure here is for that land. The whole Petit Chablis delimitation, including the land also entitled to Chablis, covers ${fmt.ha(p.area_ha)}.`
        : 'The shape shows land entitled to Petit Chablis but not to Chablis. The figures here cover the whole Petit Chablis delimitation.');
    }
    if (Array.isArray(p.contains)) for (const n of p.contains) notes.push(`${n} lies inside ${p.name} and is not drawn separately.`);
    for (const n of notes) nodes.push(h('p', { class: 'note atlas-p-note', text: n }));
    const twin = this.twinOf.get(p.id) && this.byId.get(this.twinOf.get(p.id));
    if (twin) {
      const hidden = this.hiddenTwins.has(p.id);
      nodes.push(h('p', { class: 'note atlas-p-note atlas-p-twin' },
        hidden
          ? `The same ground is also delimited as ${twin.full}, which allows white wine. The map draws that name. `
          : `The same ground is also delimited as ${twin.full}, which in the data allows red wine only. `,
        h('button', { type: 'button', class: 'link-btn', text: `Open ${twin.name}`, attrs: { 'aria-label': `Open ${twin.full}` }, on: { click: () => this.openFeature(twin.id, { fit: false, focus: true }) } })));
    }

    const shared = this.sharedGround(p, det);
    if (shared) nodes.push(this.sharedNote(shared));

    if (p.kind === 'appellation') nodes.push(this.shareBlock(p, det));

    const elev = ex ? ex.all.elev : p.elev;
    if (elev) {
      const parent = p.kind === 'climat' && det ? det.byApp.get(p.app) : null;
      nodes.push(this.elevBlock(elev, p.level, det ? det.elevDomain : null, p.region,
        parent ? { name: parent.properties.name, elev: parent.properties.elev } : null));
    }
    nodes.push(ex
      ? this.terrainBlock({ slope: ex.all.slope, slopePct: null, aspect: ex.all.aspect, label: ex.all.aspect_label, hist: ex.all.aspect_hist, level: p.level })
      : this.terrainBlock({ slope: p.slope, slopePct: p.slope_pct, aspect: p.aspect, label: p.aspect_label, hist: p.aspect_hist, level: p.level }));

    return nodes;
  }

  /**
   * Ground a climat shares with climats of the other colour: red-only climats on a white-wine climat's
   * ground, or white-wine climats on a red-only one's. Measured on the display shapes by sampling points
   * inside the climat. Twins are left out, since their panels already name each other (see findTwins).
   */
  sharedGround(p, det) {
    this._shared = this._shared || new Map();
    if (this._shared.has(p.id)) return this._shared.get(p.id);
    const rec = this.byId.get(p.id);
    const entry = det && det.byId.get(p.id);
    let out = null;
    if (p.kind === 'climat' && rec && entry) {
      const red = this.isRed(p);
      const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
      const others = this.idx.features.filter(q => q.kind === 'climat' && q.region === p.region && q.id !== p.id
        && q.id !== this.twinOf.get(p.id) && (q.white === false) !== red && overlaps(q.bbox, rec.bbox));
      const pts = others.length ? samplePoints(entry.feature.geometry, rec.bbox) : [];
      if (pts.length) {
        const covered = new Set();
        const list = [];
        for (const q of others) {
          const g = this.geomById.get(q.id);
          if (!g) continue;
          let n = 0;
          pts.forEach(([x, y], i) => { if (inGeom(x, y, g)) { n += 1; covered.add(i); } });
          // Shapes that only touch along an edge share a few sample points, so small overlaps are ignored.
          const ha = (n / pts.length) * p.area_ha;
          if (ha >= 0.3 || n / pts.length >= 0.05) list.push(q);
        }
        if (list.length) {
          list.sort((x, y) => y.area_ha - x.area_ha);
          out = { list, red, all: covered.size / pts.length >= 0.95 };
        }
      }
    }
    this._shared.set(p.id, out);
    return out;
  }

  /** "This ground is also delimited as Blagny premier cru La Jeunellotte and ..., which ..." with each name a link. */
  sharedNote({ list, red, all }) {
    const { h } = this.u;
    const apps = [...new Set(list.map(q => q.app))];
    const one = apps.length === 1;
    const parts = [all ? 'This ground is also delimited as ' : 'Part of this ground is also delimited as '];
    if (one) parts.push(`${apps[0]} premier cru `);
    list.forEach((q, i) => {
      if (i) parts.push(i === list.length - 1 ? ' and ' : ', ');
      parts.push(h('button', {
        type: 'button', class: 'link-btn', text: one ? q.name : q.full,
        attrs: { 'aria-label': `Open ${q.full}` },
        on: { click: () => this.openFeature(q.id, { fit: false, focus: true }) },
      }));
    });
    const verb = list.length > 1 ? 'allow' : 'allows';
    parts.push(red ? `, which ${verb} white wine.` : `, which in the data ${verb} red wine only.`);
    return h('p', { class: 'note atlas-p-note atlas-p-twin' }, parts);
  }

  villagePanel(v, det) {
    const { h, fmt } = this.u;
    const st = v.stats || {};
    const name = this.villageName(v);
    const nodes = this.panelHead(`${v.regionName || this.u.regionName(v.region)} · Profiled village`, name, null);
    nodes.push(h('div', { class: 'atlas-p-badges' },
      h('span', { class: 'atlas-p-k', text: 'Highest level' }),
      h('span', { class: 'badge', dataset: { level: v.topLevel }, text: LEVEL_NAME[v.topLevel] || '' })));

    const actions = h('div', { class: 'atlas-p-actions' },
      h('button', {
        type: 'button', class: 'btn btn-sm', text: 'Read the profile',
        on: { click: () => this.bus.emit('village:focus', { id: v.id, reveal: 'card', source: 'map' }) },
      }));
    const appId = v.featureIds && v.featureIds.appellation && v.featureIds.appellation[0];
    if (appId && this.byId.has(appId)) {
      actions.append(h('button', {
        type: 'button', class: 'btn btn-sm btn-ghost', text: 'Appellation details',
        on: { click: () => this.openFeature(appId, { fit: false, focus: true }) },
      }));
    }
    nodes.push(actions);

    // Delimited land by level, exclusive, as a stacked bar with a table-like legend.
    const a = st.area_ha || {};
    const total = a.total || (a.grand_cru || 0) + (a.premier_cru || 0) + (a.village || 0);
    if (total > 0) {
      nodes.push(h('section', { class: 'atlas-p-sec' },
        h('h4', { text: 'Delimited land by level' }),
        this.levelTable({ gc: a.grand_cru || 0, pc: a.premier_cru || 0, vl: a.village || 0, total }, `Delimited land in ${name} by level`)));
    }

    const facts = h('dl', { class: 'facts atlas-facts' },
      fact(h, v.apps && v.apps.length > 1 ? 'Appellations' : 'Appellation', (v.apps || []).join(', ')),
      fact(h, 'Named premier cru climats', fmt.num(st.n_climats || 0), 'num'));
    nodes.push(facts);
    nodes.push(this.officialClimatsNote(v, st.n_climats));
    // The land counted above covers the whole appellation, so its communes are listed when they are more.
    const appEntry = det && appId ? det.byId.get(appId) : null;
    const appCommunes = appEntry && appEntry.feature.properties.communes;
    const communes = appCommunes && appCommunes.length > (v.communes || []).length ? appCommunes : v.communes;
    if (communes && communes.length) nodes.push(this.communes(communes));

    const all = st.all || {};
    if (all.elev) nodes.push(this.elevBlock(all.elev, v.topLevel, det ? det.elevDomain : null, v.region, null));
    nodes.push(this.terrainBlock({ slope: all.slope, slopePct: null, aspect: all.aspect, label: all.aspect_label, hist: all.aspect_hist, level: v.topLevel }));

    // A grand cru profiled on its own (Corton-Charlemagne) would only list itself, so the list is left out.
    const gcs = Array.isArray(st.grand_crus) ? st.grand_crus : [];
    const selfOnly = gcs.length === 1 && this.u.fold(gcs[0].name) === this.u.fold(v.name);
    if (gcs.length && !selfOnly) {
      const list = [...gcs].sort((x, y) => y.area_ha - x.area_ha);
      const row = g => [h('span', { class: 'g-n', text: g.name }), h('span', { class: 'num g-a', text: fmt.ha(g.area_ha) })];
      nodes.push(h('section', { class: 'atlas-p-sec' },
        h('h4', { text: list.length === 1 ? 'Grand cru' : `${fmt.num(list.length)} grand crus` }),
        h('ul', { class: 'atlas-gclist' }, list.map(g => h('li', {},
          g.id && this.byId.has(g.id)
            // Opened in place, so keyboard focus moves to the new panel's title like "Appellation details".
            ? h('button', {
              type: 'button', class: 'atlas-gcbtn',
              attrs: { 'aria-label': `${g.name}, ${fmt.ha(g.area_ha)}. Open on the map.` },
              on: { click: () => this.openFeature(g.id, { fit: true, focus: true, user: true }) },
            }, row(g))
            : h('span', { class: 'atlas-gcbtn is-static' }, row(g)))))));
    }

    return nodes;
  }

  /** Grand cru, premier cru and village land as a stacked bar and a small table with shares. */
  levelTable(L, caption) {
    const { h, fmt } = this.u;
    const rows = [
      { level: 'grand-cru', label: 'Grand cru', ha: L.gc },
      { level: 'premier-cru', label: 'Premier cru', ha: L.pc },
      { level: 'village', label: 'Village', ha: L.vl },
    ];
    const total = L.total;
    const pct = x => { const q = (100 * x) / total; return q > 0 && q < 1 ? '<1%' : fmt.pct(q); };
    const summary = rows.filter(r => r.ha > 0).map(r => `${r.label} ${fmt.ha(r.ha)}`).join(', ');
    return h('div', { class: 'atlas-lvl' },
      h('div', { class: 'atlas-lvlbar', attrs: { role: 'img', 'aria-label': `${summary}. Total ${fmt.ha(total)}.` } },
        rows.filter(r => r.ha > 0).map(r => h('span', { dataset: { level: r.level }, style: { flexGrow: String(r.ha) } }))),
      h('table', { class: 'atlas-lvltab' },
        h('caption', { class: 'visually-hidden', text: caption }),
        h('tbody', {}, rows.map(r => h('tr', {},
          h('th', { attrs: { scope: 'row' } }, h('span', { class: 'swatch', dataset: { level: r.level } }), ` ${r.label}`),
          r.ha > 0 ? h('td', { class: 'num', text: fmt.ha(r.ha) }) : nil(h),
          r.ha > 0 ? h('td', { class: 'num pct', text: pct(r.ha) }) : h('td', { class: 'num pct' }))),
        h('tr', { class: 'tot' }, h('th', { attrs: { scope: 'row' }, text: 'Total' }), h('td', { class: 'num', text: fmt.ha(total) }), h('td')))));
  }

  /**
   * An appellation's land by level. Where a profiled village's figures cover this very appellation
   * they are used, so the two panels agree. Otherwise the region file gives the appellation's area
   * and its premier cru area, and the grand cru land inside the appellation is measured from the
   * shapes. INAO's premier cru area also covers that grand cru land, so it is taken out of it.
   */
  landByLevel(p, det) {
    const v = p.village && this.villages.get(p.village);
    const a = v && v.stats && v.stats.area_ha;
    const ids = (v && v.featureIds && v.featureIds.appellation) || [];
    if (a && a.total && ids.includes(p.id) && Math.abs(a.total - p.area_ha) <= 0.01 * p.area_ha) {
      return { gc: a.grand_cru || 0, pc: a.premier_cru || 0, vl: a.village || 0, total: a.total, profile: true };
    }
    const g = det ? this.grandCruInside(p, det) : null;
    if (!g) return null;
    return { gc: g.ha, pc: Math.max(0, p.pc_area_ha - g.ha), vl: Math.max(0, p.area_ha - p.pc_area_ha), total: p.area_ha, names: g.names };
  }

  /**
   * Grand cru land inside an appellation, measured on the display shapes. Each grand cru that meets
   * the appellation is sampled on a grid. One that lies wholly inside counts with its full area, and
   * one nested in a grand cru already counted (Corton-Charlemagne in Corton) is not counted twice.
   * A grand cru only partly inside cannot be measured this way, so null is returned.
   */
  grandCruInside(p, det) {
    if (this.gcInside.has(p.id)) return this.gcInside.get(p.id);
    const app = det.byId.get(p.id);
    const rec = this.byId.get(p.id);
    let out = { ha: 0, names: [] };
    if (!app || !rec) out = null;
    const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    const gcs = out ? [...det.byId.values()].map(x => x.feature)
      .filter(f => f.properties.kind === 'grand_cru' && overlaps((this.byId.get(f.properties.id) || {}).bbox || [0, 0, 0, 0], rec.bbox))
      .sort((x, y) => y.properties.area_ha - x.properties.area_ha) : [];
    const counted = [];
    for (const g of gcs) {
      const pts = samplePoints(g.geometry, (this.byId.get(g.properties.id) || {}).bbox);
      if (!pts.length) continue;
      const share = geom => pts.filter(([x, y]) => inGeom(x, y, geom)).length / pts.length;
      const inApp = share(app.feature.geometry);
      if (inApp < 0.05) continue;
      if (inApp < 0.95) { out = null; break; }
      const nested = counted.map(c => share(c.geometry));
      if (nested.some(q => q > 0.95)) continue;
      if (nested.some(q => q > 0.05)) { out = null; break; }
      counted.push(g);
      out.ha += g.properties.area_ha;
      out.names.push(g.properties.name);
    }
    this.gcInside.set(p.id, out);
    return out;
  }

  shareBlock(p, det) {
    const { h, fmt } = this.u;
    const head = h('h4', { text: 'Premier cru share' });
    if (!p.pc_area_ha) return h('section', { class: 'atlas-p-sec' }, head, h('p', { class: 'atlas-p-plain', text: 'No premier cru land in the data.' }));
    const L = this.landByLevel(p, det);
    if (!L) {
      // The grand cru land inside could not be separated, so the premier cru area is given as INAO draws it.
      return h('section', { class: 'atlas-p-sec' }, head,
        h('p', { class: 'caption', text: `${fmt.ha(p.pc_area_ha)} of ${fmt.ha(p.area_ha)} is delimited as premier cru. In INAO’s data that area can include grand cru land.` }));
    }
    const share = Math.min(100, (100 * L.pc) / L.total);
    return h('section', { class: 'atlas-p-sec' }, head,
      h('p', { class: 'atlas-share-v num', text: fmt.pct(share) }),
      this.levelTable(L, `Delimited land in the ${p.name} appellation by level`),
      L.names && L.names.length ? h('p', { class: 'caption', text: `The grand cru land here is ${listWords(L.names)}.` }) : null);
  }

  /**
   * Where villages.json carries an official climat count (Chablis), the INAO count shown above is
   * set against it, with the source. INAO's digital delimitation does not yet name every climat.
   */
  officialClimatsNote(v, nInao) {
    const o = v && v.climatsOfficial;
    if (!o || !Number.isFinite(o.count) || !o.label) return null;
    const { h, fmt } = this.u;
    const link = o.url
      ? h('a', { href: o.url, target: '_blank', rel: 'noopener' }, o.label, h('span', { class: 'visually-hidden', text: ' (opens in a new tab)' }))
      : o.label;
    return h('p', { class: 'note atlas-p-note atlas-p-official' },
      `INAO’s digital delimitation names ${fmt.num(nInao || 0)} climats here, out of ${fmt.num(o.count)} `, link,
      o.accessed ? `, accessed ${longDate(o.accessed)}.` : '.');
  }

  communes(list) {
    const { h, fmt } = this.u;
    const LIMIT = 6;
    const dd = h('p', { class: 'atlas-p-communes', attrs: { tabindex: '-1' } });
    // Each name stays on one line, so "Puligny-Montrachet" never breaks at its hyphen.
    const names = arr => arr.flatMap((n, i) => [i ? ', ' : null, h('span', { class: 'atlas-commune', text: n })]).filter(Boolean);
    const render = all => {
      const shown = all || list.length <= LIMIT + 1 ? list : list.slice(0, LIMIT);
      dd.replaceChildren(...names(shown));
      if (!all && list.length > LIMIT + 1) {
        dd.append(' ', h('button', {
          type: 'button', class: 'link-btn', text: `and ${fmt.num(list.length - LIMIT)} more`,
          attrs: { 'aria-label': `Show all ${list.length} communes` },
          // The button goes away, so focus moves to the full list it revealed.
          on: { click: () => { render(true); dd.focus({ preventScroll: true }); } },
        }));
      }
    };
    render(false);
    return h('div', { class: 'atlas-p-sec atlas-p-comm' }, h('h4', { text: list.length === 1 ? 'Commune' : `${fmt.num(list.length)} communes` }), dd);
  }

  /** Elevation strip: this place's range and mean against the region's full range. */
  elevBlock(elev, level, domain, region, parent) {
    const { h, s, fmt, LEVELS } = this.u;
    const [mn, mean, mx] = elev;
    let [d0, d1] = domain && isFinite(domain[0]) ? domain : [mn, mx];
    if (parent) { d0 = Math.min(d0, parent.elev[0]); d1 = Math.max(d1, parent.elev[2]); }
    d0 = Math.min(d0, mn); d1 = Math.max(d1, mx);
    if (d1 - d0 < 1) { d0 -= 5; d1 += 5; }
    const W = 300, H = 60, pad = 1;
    const x = v => pad + ((v - d0) / (d1 - d0)) * (W - 2 * pad);
    const lv = (LEVELS[level] || LEVELS.none);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'atlas-elev', role: 'img', 'aria-label': `Elevation from ${fmt.m(mn)} to ${fmt.m(mx)}, mean ${fmt.m(mean)}. The scale runs across all mapped ground in ${this.u.regionName(region)}, ${fmt.mRange(d0, d1)}.` });
    svg.append(s('line', { x1: 0, x2: W, y1: 32, y2: 32, stroke: 'var(--rule-strong)', 'stroke-width': 1 }));
    for (const v of [d0, d1]) svg.append(s('line', { x1: x(v), x2: x(v), y1: 28, y2: 36, stroke: 'var(--rule-strong)', 'stroke-width': 1 }));
    if (parent) {
      svg.append(s('rect', { x: x(parent.elev[0]), y: 25, width: Math.max(1, x(parent.elev[2]) - x(parent.elev[0])), height: 14, fill: 'var(--lvl-vl-soft)' }));
    }
    svg.append(s('rect', { x: x(mn), y: 27, width: Math.max(2, x(mx) - x(mn)), height: 10, fill: `var(${lv.soft})`, stroke: `var(${lv.color})`, 'stroke-width': 1.2, rx: 1 }));
    svg.append(s('line', { x1: x(mean), x2: x(mean), y1: 20, y2: 44, stroke: 'var(--ink)', 'stroke-width': 1.6 }));
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    svg.append(s('text', { x: clamp(x(mean), 30, W - 30), y: 13, 'text-anchor': 'middle', class: 'e-mean', text: `mean ${fmt.m(mean)}` }));
    svg.append(s('text', { x: 0, y: 57, 'text-anchor': 'start', class: 'e-dom', text: fmt.m(d0) }));
    svg.append(s('text', { x: W, y: 57, 'text-anchor': 'end', class: 'e-dom', text: fmt.m(d1) }));
    return h('section', { class: 'atlas-p-sec' },
      h('h4', { text: 'Elevation' }),
      h('dl', { class: 'atlas-elev-nums' },
        h('div', {}, h('dt', { text: 'Min' }), h('dd', { class: 'num', text: fmt.m(mn) })),
        h('div', {}, h('dt', { text: 'Mean' }), h('dd', { class: 'num', text: fmt.m(mean) })),
        h('div', {}, h('dt', { text: 'Max' }), h('dd', { class: 'num', text: fmt.m(mx) }))),
      svg,
      h('p', { class: 'caption atlas-elev-cap' },
        `Scale spans all mapped ground in ${this.u.regionName(region)}.`,
        parent ? ` The pale band is the ${parent.name} appellation.` : ''));
  }

  /** Slope with a true-angle glyph, and the direction the ground faces with the aspect rose. */
  terrainBlock({ slope, slopePct, aspect, label, hist, level }) {
    const { h, s, fmt, aspectRose, aspectWord, LEVELS } = this.u;
    const lv = LEVELS[level] || LEVELS.none;
    const secs = [];
    if (slope != null) {
      // A 64-unit run with its true rise. The box grows with the rise, so steep ground is never clipped.
      const rise = 64 * Math.tan((slope * Math.PI) / 180);
      const H = Math.max(28, Math.ceil(rise) + 6), y0 = H - 3;
      const glyph = s('svg', { viewBox: `0 0 70 ${H}`, class: 'atlas-slope-g', 'aria-hidden': 'true' },
        s('path', { d: `M3 ${y0} L67 ${y0} L67 ${y0 - rise} Z`, fill: `var(${lv.soft})`, stroke: 'none' }),
        s('line', { x1: 3, y1: y0, x2: 67, y2: y0 - rise, stroke: `var(${lv.color})`, 'stroke-width': 1.6 }),
        s('line', { x1: 0, y1: y0, x2: 70, y2: y0, stroke: 'var(--rule-strong)', 'stroke-width': 1 }));
      secs.push(h('div', { class: 'atlas-terrain-cell' },
        h('h4', { text: 'Mean slope' }),
        h('p', { class: 'atlas-big num' }, fmt.deg(slope), slopePct != null ? h('span', { class: 'atlas-big-sub', text: ` ${fmt.num(slopePct, 1)}%` }) : null),
        glyph,
        h('p', { class: 'caption', text: 'Drawn at the true angle.' })));
    }
    if (label) {
      const flat = label === 'flat';
      const wrap = h('div', { class: 'atlas-rose', style: { color: `var(${lv.color})` } });
      if (Array.isArray(hist) && hist.some(v => v > 0)) {
        const rose = aspectRose(hist, { size: 84, title: 'Share of ground sloping at least 2 degrees that faces each direction' });
        // Compass letters large enough to read.
        rose.querySelectorAll('text').forEach(t => t.setAttribute('font-size', '10.5'));
        wrap.append(rose);
      }
      let share = null, spread = null;
      if (Array.isArray(hist) && hist.length === 8) {
        const i = hist.indexOf(Math.max(...hist));
        const tot = hist.reduce((a, b) => a + b, 0);
        if (tot > 0) {
          share = { pct: (100 * hist[i]) / tot, word: aspectWord(SECTORS[i]) };
          // Resultant length: 1 when all the sloping ground faces one way, near 0 when it faces every way.
          const ex = hist.reduce((a, v, j) => a + v * Math.sin((j * Math.PI) / 4), 0);
          const ey = hist.reduce((a, v, j) => a + v * Math.cos((j * Math.PI) / 4), 0);
          spread = Math.hypot(ex, ey) / tot;
        }
      }
      const dispersed = !flat && spread != null && spread < DISPERSED;
      const head = flat ? 'Mostly flat' : dispersed ? 'No single direction' : aspectWord(label);
      let cap = null;
      if (share) {
        const bit = `${fmt.pct(share.pct)} of the ground sloping at least 2°`;
        cap = dispersed ? `The ground faces many ways. The largest share, ${bit}, faces ${share.word}.`
          : !flat && share.word !== aspectWord(label) ? `The largest share, ${bit}, faces ${share.word}.`
            : `${bit[0].toUpperCase()}${bit.slice(1)} faces ${share.word}.`;
      }
      secs.push(h('div', { class: 'atlas-terrain-cell' },
        h('h4', { text: 'Faces' }),
        h('p', { class: 'atlas-face' }, head),
        !flat && !dispersed && aspect != null ? h('p', { class: 'num atlas-bearing', text: `mean bearing ${fmt.num(aspect)}°` }) : null,
        wrap,
        cap ? h('p', { class: 'caption', text: cap }) : null));
    }
    return h('section', { class: 'atlas-p-sec atlas-terrain' }, secs);
  }

  /* =====================================================================
     Transects
     ===================================================================== */
  async showTransect(id, payload = {}) {
    let t;
    try { t = await this.data.transects(); } catch { return; }
    if (!this.transects) this.indexTransects(t);
    const tr = t.transects.find(x => x.id === id);
    if (!tr) return;
    // The map sent this very line (the key's own button, or a panel button for the line already drawn).
    // It stays as it is, and the view neither moves nor scrolls. The slope plate takes the reader there.
    if (payload.source === 'map' && this.state.transect === id && this.transectLayer) return;
    const L = window.L;
    const { fmt, h, LEVELS } = this.u;
    this.clearTransect(false);
    this.state.transect = id;
    const at = d => {
      const f = Math.max(0, Math.min(1, d / tr.length_m));
      return [tr.start[0] + (tr.end[0] - tr.start[0]) * f, tr.start[1] + (tr.end[1] - tr.start[1]) * f];
    };
    const opt = extra => ({ renderer: this.svgTr, pane: 'transect', interactive: false, lineCap: 'butt', ...extra });
    const parts = [
      L.polyline([tr.start, tr.end], opt({ color: 'var(--paper)', weight: 8, opacity: 0.92 })),
      L.polyline([tr.start, tr.end], opt({ color: 'var(--ink)', weight: 1.4, opacity: 0.9, dashArray: '2 4' })),
    ];
    for (const sg of tr.segments) {
      if (!sg.level || sg.level === 'none' || sg.to <= sg.from) continue;
      const lv = LEVELS[sg.level] || LEVELS.none;
      parts.push(L.polyline([at(sg.from), at(sg.to + (tr.step_m || 10))], opt({ color: `var(${lv.color})`, weight: 4.5, opacity: 1 })));
    }
    for (let d = 500; d < tr.length_m; d += 500) {
      parts.push(L.circleMarker(at(d), opt({ radius: 2.6, color: 'var(--ink)', weight: 1.2, fillColor: 'var(--paper)', fillOpacity: 1 })));
    }
    const z0 = tr.z[0], z1 = tr.z[tr.z.length - 1];
    const start = L.circleMarker(tr.start, opt({ radius: 5, color: 'var(--paper)', weight: 2, fillColor: 'var(--ink)', fillOpacity: 1 }));
    const end = L.circleMarker(tr.end, opt({ radius: 5, color: 'var(--ink)', weight: 2, fillColor: 'var(--paper)', fillOpacity: 1 }));
    // The two end heights are hidden on wide views (see updateZoomClasses) and kept clear of the names.
    start.bindTooltip(fmt.m(z0), { permanent: true, direction: 'top', offset: [0, -6], className: 'atlas-tt', pane: 'ends' });
    end.bindTooltip(fmt.m(z1), { permanent: true, direction: 'top', offset: [0, -6], className: 'atlas-tt', pane: 'ends' });
    parts.push(start, end);
    this.transectLayer = L.layerGroup(parts).addTo(this.map);

    const km = tr.length_m >= 1000 ? `${fmt.num(tr.length_m / 1000, 1)} km` : fmt.m(tr.length_m);
    const bounds = L.latLngBounds([tr.start, tr.end]);
    // The key's title takes focus when another plate hands the line over (tabindex -1, never a tab stop).
    const title = h('p', { class: 'lg-tr-title', attrs: { tabindex: '-1' }, text: tr.title });
    // Shown once the map has moved on to another region, so the key never describes a line off the sheet.
    const where = h('p', { class: 'lg-tr-where', hidden: true },
      `This line lies in ${regionWithArticle(this.u.regionName(tr.region))}. `,
      h('button', { type: 'button', class: 'link-btn', text: 'Show the line', on: { click: () => this.frameTransect({ user: true }) } }));
    this.transectInfo = { tr, bounds, where, title };
    this.transectRow.replaceChildren(
      h('div', { class: 'lg-tr-head' }, h('span', { class: 'atlas-sw-line', attrs: { 'aria-hidden': 'true' } }), h('span', { class: 'lg-k', text: 'Cross-section' })),
      title,
      h('p', { class: 'lg-tr-meta', text: `${km}, from ${fmt.m(z0)} at the filled dot down to ${fmt.m(z1)}. Dots every 500 m.` }),
      where,
      h('div', { class: 'lg-tr-actions' },
        payload.source === 'slope' ? null : h('button', { type: 'button', class: 'link-btn', text: 'View the cross-section', on: { click: () => this.bus.emit('transect:show', { id: tr.id, source: 'map' }) } }),
        h('button', { type: 'button', class: 'link-btn', text: 'Clear', on: { click: () => this.clearTransect() } })));
    this.transectRow.hidden = false;
    // The legend is the line's key. On phones it opens only for a line handed over from another plate,
    // and the details sheet, which would cover it and half the line, makes way.
    const handover = payload.source !== 'map' && payload.source !== 'url';
    if (this.mq.matches && handover && this.state.panel) this.closePanel();
    if (this.legendBody.hidden && (!this.mq.matches || handover)) { this.legendAuto = false; this.setLegendOpen(true); }

    // The line belongs to one region, which the region control follows.
    if (tr.region && this.regions.has(tr.region) && this.state.region !== tr.region) this.setRegion(tr.region, { emit: false, fit: false });
    const ensure = this.ensureRegion(tr.region).catch(() => null);
    this.frameTransect({ animate: payload.source !== 'url' });
    // A request from anywhere but the map itself brings the map into view, and keyboard focus with it.
    if (payload.source !== 'map') {
      this.revealSoon();
      this.announce(`Cross-section line shown on the map. ${tr.title}.`);
      if (handover) title.focus({ preventScroll: true });
    }
    await ensure;
    requestAnimationFrame(() => this.renderLabels());
  }

  /** Fit the line with room for its end heights, clear of the open legend that keys it. */
  frameTransect({ animate = true, user = false } = {}) {
    const ti = this.transectInfo;
    if (!ti) return;
    if (this.state.region !== ti.tr.region && this.regions.has(ti.tr.region)) this.setRegion(ti.tr.region, { emit: user, fit: false });
    this.fitTo(ti.bounds, { animate, maxZoom: 16, side: 40, avoid: this.legendBody.hidden ? null : this.legend });
  }

  /** The key says so when the region shown is not the line's own, and offers to go back to it. */
  syncTransectRow() {
    const ti = this.transectInfo;
    if (!ti) return;
    const away = this.state.region !== ti.tr.region;
    if (ti.where.hidden === !away) return;
    // The button goes away with the note, so focus moves to the line's title.
    const refocus = !away && ti.where.contains(document.activeElement);
    ti.where.hidden = !away;
    if (refocus) ti.title.focus({ preventScroll: true });
  }

  clearTransect(announce = true) {
    if (this.transectLayer) { this.transectLayer.remove(); this.transectLayer = null; }
    this.state.transect = null;
    this.transectInfo = null;
    // Focus in the key would be lost with it, so it goes to the map the line was drawn on.
    const hadFocus = this.transectRow.contains(document.activeElement);
    this.transectRow.hidden = true;
    this.transectRow.replaceChildren();
    if (hadFocus) this.map.getContainer().focus({ preventScroll: true });
    this.updateMarkerFocus();
    if (announce) this.announce('Cross-section line removed.');
  }

  /* =====================================================================
     Search combobox (ARIA 1.2, list autocomplete)
     ===================================================================== */
  buildSearch() {
    const { h } = this.u;
    const norm = t => this.u.fold(t).replace(/[-'’.,]/g, ' ').replace(/\s+/g, ' ').trim();
    this._norm = norm;
    this.input = h('input', {
      type: 'text', class: 'input atlas-q',
      attrs: {
        id: 'atlas-q', role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false',
        'aria-controls': 'atlas-q-list', autocomplete: 'off', spellcheck: 'false',
        placeholder: 'Find a climat, grand cru or village', enterkeyhint: 'go',
      },
    });
    this.listbox = h('ul', { class: 'atlas-q-list', attrs: { id: 'atlas-q-list', role: 'listbox', 'aria-label': 'Matching places' }, hidden: true });
    this.qStatus = h('p', { class: 'visually-hidden', attrs: { 'aria-live': 'polite' } });
    const icon = h('span', { class: 'atlas-q-icon', attrs: { 'aria-hidden': 'true' }, html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>' });
    this.results = [];
    this.optIndex = -1;

    this.input.addEventListener('input', () => this.runSearch());
    this.input.addEventListener('focus', () => { if (!this.quietFocus && !this.input.value.trim()) this.runSearch(true); });
    this.input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== this.input) this.closeList(); }, 120));
    this.input.addEventListener('keydown', e => {
      const n = this.results.length;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!this.searchOpen) { this.runSearch(!this.input.value.trim()); return; }
        if (n) this.setOption((this.optIndex + 1) % n);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (this.searchOpen && n) this.setOption((this.optIndex - 1 + n) % n);
      } else if (e.key === 'Enter') {
        if (this.searchOpen && n) {
          e.preventDefault();
          this.choose(this.results[Math.max(0, this.optIndex)]);
        }
      } else if (e.key === 'Escape') {
        if (this.searchOpen) { e.preventDefault(); e.stopPropagation(); this.closeList(); }
        else if (this.input.value) { e.preventDefault(); e.stopPropagation(); this.input.value = ''; }
      } else if (e.key === 'Tab') {
        this.closeList();
      }
    });
    this.listbox.addEventListener('pointerdown', e => e.preventDefault()); // keep focus in the input
    this.listbox.addEventListener('click', e => {
      const li = e.target.closest('[role="option"]');
      if (li) this.choose(this.results[Number(li.dataset.i)]);
    });

    return h('div', { class: 'atlas-search' },
      h('label', { class: 'visually-hidden', attrs: { for: 'atlas-q' }, text: 'Search the map for a climat, grand cru, appellation or village' }),
      h('div', { class: 'atlas-combo' }, icon, this.input, this.listbox),
      this.qStatus);
  }

  searchIndex() {
    if (this._sidx) return this._sidx;
    const norm = this._norm;
    this._sidx = this.idx.features.map(f => ({ f, name: norm(f.name), hay: norm(`${f.name} ${f.full} ${f.app} ${this.u.regionName(f.region)}`) }));
    return this._sidx;
  }

  runSearch(suggest = false) {
    const q = this._norm(this.input.value);
    const rank = f => (this.u.LEVELS[f.level] || this.u.LEVELS.none).rank;
    let res;
    if (!q) {
      if (!suggest) { this.closeList(); return; }
      res = this.idx.features.filter(f => f.kind === 'grand_cru').sort((a, b) => b.area_ha - a.area_ha);
      this.suggesting = true;
    } else {
      this.suggesting = false;
      const toks = q.split(' ');
      const scored = [];
      for (const it of this.searchIndex()) {
        if (!toks.every(t => it.hay.includes(t))) continue;
        let sc = 5;
        if (it.name === q) sc = 0;
        else if (it.name.startsWith(q)) sc = 1;
        else if (it.name.split(' ').some(w => w.startsWith(toks[0]))) sc = 2;
        else if (it.hay.startsWith(q)) sc = 3;
        // A red-only twin follows the white-wine climat on the same ground.
        if (this.hiddenTwins.has(it.f.id)) sc += 0.5;
        scored.push({ f: it.f, sc });
      }
      scored.sort((a, b) => a.sc - b.sc || rank(b.f) - rank(a.f) || b.f.area_ha - a.f.area_ha);
      res = scored.slice(0, 12).map(x => x.f);
    }
    this.results = res;
    this.renderList(q);
  }

  renderList(q) {
    const { h } = this.u;
    const firstTok = q ? q.split(' ')[0] : '';
    this.listbox.replaceChildren(...this.results.map((f, i) => {
      const lvl = LEVEL_NAME[f.level] || '';
      const red = f.white === false ? ' · Red wine only' : '';
      const meta = f.kind === 'appellation' ? `Village appellation · ${this.u.regionName(f.region)}${red}`
        : f.kind === 'climat' ? `${lvl} · ${f.app}${red}` : `${lvl} · ${this.u.regionName(f.region)}`;
      return h('li', { attrs: { role: 'option', id: `atlas-opt-${i}`, 'aria-selected': 'false' }, dataset: { i: String(i) }, class: 'atlas-opt' },
        h('span', { class: 'swatch', dataset: { level: f.level }, attrs: { 'aria-hidden': 'true' } }),
        h('span', { class: 'o-text' }, h('span', { class: 'o-name' }, highlight(f.name, firstTok, this.u.fold)), h('span', { class: 'o-meta', text: meta })));
    }));
    const n = this.results.length;
    if (!n) {
      this.listbox.replaceChildren(h('li', { class: 'atlas-opt-empty', attrs: { role: 'presentation' }, text: 'No place matches that name.' }));
    }
    this.openList();
    this.setOption(n && q ? 0 : -1);
    this.qStatus.textContent = !n ? 'No place matches that name.'
      : this.suggesting ? `${n} grand crus suggested. Use the arrow keys to choose.`
        : `${n} ${n === 1 ? 'place' : 'places'} found. Use the arrow keys to choose.`;
  }

  setOption(i) {
    this.optIndex = i;
    const opts = this.listbox.querySelectorAll('[role="option"]');
    opts.forEach((o, j) => o.setAttribute('aria-selected', String(j === i)));
    if (i >= 0 && opts[i]) {
      this.input.setAttribute('aria-activedescendant', opts[i].id);
      opts[i].scrollIntoView({ block: 'nearest' });
    } else this.input.removeAttribute('aria-activedescendant');
  }

  openList() {
    this.listbox.hidden = false;
    this.searchOpen = true;
    this.input.setAttribute('aria-expanded', 'true');
  }

  closeList() {
    this.listbox.hidden = true;
    this.searchOpen = false;
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
  }

  /** Keep the search box from naming a place other than the one the panel shows. */
  syncSearch(name) {
    if (!this.input || this.searchOpen || !this.input.value) return; // never while the reader is choosing
    if (!name || this._norm(this.input.value) !== this._norm(name)) this.input.value = '';
  }

  choose(f) {
    if (!f) return;
    this.input.value = f.name;
    this.closeList();
    this.qStatus.textContent = '';
    this.bus.emit('feature:focus', { id: f.id, source: 'map' });
    // On a short screen the stage (and the details sheet at its foot) can lie below the search box.
    this.revealSoon();
  }
}

/* ---------- helpers ---------- */
/** Signed area of a ring of [x, y] points (shoelace). */
function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return a / 2;
}

/** Point in a GeoJSON Polygon or MultiPolygon (lng, lat), even-odd over every ring, so holes count. */
function inGeom(x, y, g) {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  let inside = false;
  for (const poly of polys) {
    for (const r of poly) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const ax = r[i][0], ay = r[i][1], bx = r[j][0], by = r[j][1];
        if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
      }
    }
  }
  return inside;
}

/** Points on a 30 by 30 grid over a bounding box [south, west, north, east] that fall inside a shape. */
function samplePoints(g, bbox) {
  if (!bbox) return [];
  const [s, w, n, e] = bbox, N = 30, out = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = w + ((e - w) * (i + 0.5)) / N, y = s + ((n - s) * (j + 0.5)) / N;
      if (inGeom(x, y, g)) out.push([x, y]);
    }
  }
  return out;
}

/** Signed distance from a point to a polygon's edges: positive inside, negative outside. */
function polyDist(x, y, rings) {
  let inside = false, min = Infinity;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [ax, ay] = r[i], [bx, by] = r[j];
      if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
      let dx = bx - ax, dy = by - ay, px = ax, py = ay;
      if (dx || dy) {
        const t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy);
        if (t > 1) { px = bx; py = by; } else if (t > 0) { px += dx * t; py += dy * t; }
      }
      dx = x - px; dy = y - py;
      min = Math.min(min, dx * dx + dy * dy);
    }
  }
  return (inside ? 1 : -1) * Math.sqrt(min);
}

/**
 * Pole of inaccessibility of a polygon (outer ring first, then holes): the interior point farthest
 * from any edge, found by quadtree search to 1/60 of the shape's size. Mourafiq and Agafonkin's
 * polylabel method, written out here.
 */
function polylabel(input) {
  // A label point needs no survey precision. Long rings are thinned to about 240 vertices first.
  const rings = input.map(r => { const step = Math.ceil(r.length / 240); return step > 1 ? r.filter((_, i) => i % step === 0) : r; });
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of rings[0]) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const w = maxX - minX, hgt = maxY - minY, size = Math.min(w, hgt);
  if (!(size > 0)) return [minX, minY];
  const precision = Math.max(w, hgt) / 60;
  const cell = (x, y, half) => { const d = polyDist(x, y, rings); return { x, y, half, d, max: d + half * Math.SQRT2 }; };
  // Binary max-heap on each cell's best possible distance.
  const heap = [];
  const push = c => {
    heap.push(c);
    for (let i = heap.length - 1; i > 0;) { const p = (i - 1) >> 1; if (heap[p].max >= heap[i].max) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < heap.length && heap[l].max > heap[m].max) m = l;
        if (r < heap.length && heap[r].max > heap[m].max) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  const h0 = size / 2;
  for (let x = minX; x < maxX; x += size) for (let y = minY; y < maxY; y += size) push(cell(x + h0, y + h0, h0));
  let best = cell(minX + w / 2, minY + hgt / 2, 0);
  let guard = 0;
  while (heap.length && guard++ < 1500) {
    const c = pop();
    if (c.d > best.d) best = c;
    if (c.max - best.d <= precision) continue;
    const hh = c.half / 2;
    push(cell(c.x - hh, c.y - hh, hh)); push(cell(c.x + hh, c.y - hh, hh));
    push(cell(c.x - hh, c.y + hh, hh)); push(cell(c.x + hh, c.y + hh, hh));
  }
  return [best.x, best.y];
}

/** Parse "#rgb", "#rrggbb" or "rgb(a)(...)" into [r, g, b]. */
function rgbOf(str) {
  const c = String(str || '').trim();
  if (c[0] === '#') {
    let x = c.slice(1);
    if (x.length === 3) x = x.split('').map(ch => ch + ch).join('');
    const n = parseInt(x.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) return m[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number);
  return [128, 128, 128];
}

/** Mix two colours in sRGB: t = 0 gives a, t = 1 gives b. */
function mixColor(a, b, t) {
  const A = rgbOf(a), B = rgbOf(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(', ')})`;
}

/** "2026-09-25" -> "25 September 2026" (the string itself when it is not a plain date). */
function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return iso || '';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
}

/** "Côte de Beaune" -> "the Côte de Beaune", "Mâconnais" -> "the Mâconnais", "Chablis" -> "Chablis" */
function regionWithArticle(name) {
  return /^(Côte|Mâconnais)/.test(name) ? `the ${name}` : name;
}

/** ["a", "b", "c"] -> "a, b and c" */
function listWords(arr) {
  return arr.length < 2 ? (arr[0] || '') : `${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`;
}

/** A table cell for a level with no land: the word "none", set quietly. */
function nil(h) {
  return h('td', { class: 'num is-nil', text: 'none' });
}

function fact(h, dt, dd, cls) {
  return h('div', {}, h('dt', { text: dt }), h('dd', { class: cls, text: dd }));
}

/** Degrees, minutes and optionally seconds: 46°57′30″ N */
function dms(v, pos, neg, withSec) {
  const hemi = v >= 0 ? pos : neg;
  let total = Math.round(Math.abs(v) * 3600);
  if (!withSec) total = Math.round(total / 60) * 60;
  const d = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const mm = String(m).padStart(2, '0');
  return withSec ? `${d}°${mm}′${String(s).padStart(2, '0')}″ ${hemi}` : `${d}°${mm}′ ${hemi}`;
}

/** Wrap the first accent-insensitive match of `tok` in <mark>. fold() keeps string length for Latin text. */
function highlight(text, tok, fold) {
  if (!tok) return text;
  const key = fold(text).replace(/[-'’.,]/g, ' ');
  const i = key.indexOf(tok);
  if (i < 0 || key.length !== text.length) return text;
  const frag = document.createDocumentFragment();
  frag.append(text.slice(0, i));
  const m = document.createElement('mark');
  m.textContent = text.slice(i, i + tok.length);
  frag.append(m, text.slice(i + tok.length));
  return frag;
}
