// Sources and method. Bibliography of every dataset and service, a provenance matrix,
// the build method read from scripts/*.py, the known limits and the rebuild order.
// Every number shown here is read from the data files at runtime.

// Method constants that live only in the build scripts (not in the data files).
// Each is quoted from the script named next to it.
const METHOD = {
  flatDeg: 2,            // 02_terrain.py MIN_SLOPE_DEG
  minSteepCells: 3,      // 02_terrain.py, fewer steep cells than this = "flat"
  sectors: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],             // 02_terrain.py SECTORS
  labels16: ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'],
  demPadM: 800,          // 02_terrain.py, margin around each region
  simplify: { appellation: 4, climat: 1.5, grand_cru: 1 },           // 03_export.py TOLERANCE
  overviewTol: 40,       // 03_export.py OVERVIEW_TOLERANCE
  coordDp: 5,            // 03_export.py rnd(), decimal places of the region file coordinates
  overviewDp: 4,         // 03_export.py rnd(..., 4) for the overview
};

// Where each source ends up. Keys match `feeds` in data/sources.json.
const TARGETS = [
  { id: 'terroir', file: 'terroir-*.geojson', what: 'Map shapes and their statistics' },
  { id: 'index', file: 'index.json', what: 'Search index and region bounds' },
  { id: 'transects', file: 'transects.json', what: 'Slope cross-sections' },
  { id: 'villages', file: 'villages.json', what: 'Village profiles' },
  { id: 'climate', file: 'climate.json', what: 'Yearly climate indices' },
  { id: 'hero', file: 'hero-*.svg', what: 'Opening artwork' },
  { id: 'live', file: 'live', what: 'Loaded live by the page' },
];

const STEPS = [
  { script: '01_inao.py', needs: [], line: 'Reads the INAO parcel shapefile and writes the village appellations, premier cru climats, grand crus and regional area, dissolved and measured in Lambert-93.',
    reads: ['data/raw/inao/*_delim-parcellaire-aoc-shp.shp'], writes: ['data/work/terroir_l93.gpkg'] },
  { script: '02_terrain.py', needs: ['01'], line: 'Downloads and caches the RGE ALTI grid for each region, then computes height, slope and aspect for every shape.',
    reads: ['data/work/terroir_l93.gpkg', 'Géoplateforme WMS-Raster'], writes: ['data/work/terrain_stats.csv', 'data/raw/dem/<region>.npy', 'data/raw/dem/<region>.json'] },
  { script: '03_export.py', needs: ['01', '02'], line: 'Simplifies the shapes for display and writes one GeoJSON file per region, the overview and the search index.',
    reads: ['data/work/terroir_l93.gpkg', 'data/work/terrain_stats.csv', 'data/raw/geoapi/communes_*.json'], writes: ['docs/data/terroir-<region>.geojson', 'docs/data/terroir-overview.geojson', 'docs/data/index.json'] },
  { script: '04_climate.py', needs: [], line: 'Fetches daily ERA5-Land and ERA5 series from Open-Meteo for one commune centre per region and computes the yearly indices, summaries and analogues.',
    reads: ['geo.api.gouv.fr', 'Open-Meteo Historical Weather API'], writes: ['docs/data/climate.json', 'data/raw/openmeteo/ (cache)'] },
  { script: '05_transects.py', needs: ['01', '02'], line: 'Samples each cross-section at a fixed step and tags every sample with the highest classification beneath it.',
    reads: ['data/work/terroir_l93.gpkg', 'data/work/terrain_stats.csv', 'data/raw/dem/<region>.npy', 'data/raw/dem/<region>.json'], writes: ['docs/data/transects.json'] },
  { script: '06_villages.py', needs: ['01', '02', '03'], line: 'Merges the curated village profiles with exclusive level areas, terrain statistics and marker positions, and patches the white-wine flags.',
    reads: ['content/villages.json', 'content/scope.json (optional)', 'data/work/terroir_l93.gpkg', 'data/raw/inao/*.shp', 'data/raw/dem/<region>.npy', 'data/raw/dem/<region>.json', 'data/raw/geoapi/communes_*.json', 'OpenStreetMap Nominatim', 'data/raw/nominatim.json (cache)'],
    writes: ['docs/data/villages.json', 'white flags in terroir-*.geojson and index.json', 'data/raw/nominatim.json (cache)'] },
  { script: '07_hero_art.py', needs: ['01', '02'], line: 'Draws the contour lines and cru outlines of the Puligny and Chassagne slope used as the opening artwork.',
    reads: ['data/raw/dem/cote-de-beaune.npy', 'data/raw/dem/cote-de-beaune.json', 'data/work/terroir_l93.gpkg'], writes: ['docs/assets/hero-contours.svg', 'docs/assets/hero-crus.svg', 'docs/assets/hero-climats.svg'] },
];

const ROMAN = ['I', 'II', 'III', 'IV'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

let uid = 0;
const nextId = p => `${p}-${++uid}`;

export async function init(mount, ctx) {
  const { util, data } = ctx;
  const { h, s, fmt } = util;

  /* ---------- formatting ---------- */
  const dFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const tFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
  const c4 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  const nf1 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
  const date = iso => {
    const d = new Date(iso);
    return Number.isNaN(+d) ? iso : dFmt.format(d);
  };
  const dateTime = iso => {
    const d = new Date(iso);
    if (Number.isNaN(+d)) return iso;
    return /T\d/.test(iso) ? `${dFmt.format(d)}, ${tFmt.format(d)} UTC` : dFmt.format(d);
  };
  const timeEl = (iso, withTime = false) => h('time', { attrs: { datetime: iso }, text: withTime ? dateTime(iso) : date(iso) });
  const kb = b => `${fmt.num(Math.round(b / 1024))} KB`;
  const km = m => `${nf1.format(m / 1000)} km`;
  const host = u => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } };
  // Host plus the owner for code hosts, so a licence on GitHub reads "github.com/etalab".
  const where = u => { try { const x = new URL(u); const hst = host(u); return hst === 'github.com' ? `${hst}/${x.pathname.split('/')[1]}` : hst; } catch { return u; } };
  const ext = (href, text, cls) => h('a', { href, class: cls, text, attrs: { rel: 'noopener' } });
  const listJoin = arr => arr.length < 2 ? arr.join('') : `${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`;
  const code = t => h('code', { text: t });
  // Figure heading (base.css .fig-head). The figures of this section are Fig. S.1 to S.5. The heading
  // is an h4 in part I and an h5 inside a Method step, one level below what holds it.
  const figHead = (no, title, level = 5) => {
    const id = nextId('src-fh');
    return { id, el: h('div', { class: 'fig-head' }, h('p', { class: 'fig-no', text: `Fig. S.${no}` }), h(`h${level}`, { id, text: title })) };
  };
  // Set snake_case field names in running text as code.
  const codeify = text => String(text).split(/(\b[a-z0-9]+(?:_[a-z0-9]+)+\b)/g)
    .map((part, i) => (i % 2 ? code(part) : part)).filter(x => x !== '');

  // Scroll containers are keyboard-focusable regions only while they actually scroll.
  const scrollRO = 'ResizeObserver' in window ? new ResizeObserver(es => es.forEach(e => syncScroller(e.target))) : null;
  function syncScroller(el) {
    const on = el.scrollWidth > el.clientWidth + 1;
    if (on) {
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'region');
      if (el.dataset.scrollLabel) el.setAttribute('aria-label', el.dataset.scrollLabel);
      if (el.dataset.scrollLabelledby) el.setAttribute('aria-labelledby', el.dataset.scrollLabelledby);
    } else ['tabindex', 'role', 'aria-label', 'aria-labelledby'].forEach(a => el.removeAttribute(a));
  }
  function scroller(cls, label, child) {
    const el = h('div', { class: cls, dataset: label.startsWith('#') ? { scrollLabelledby: label.slice(1) } : { scrollLabel: label } }, child);
    if (scrollRO) scrollRO.observe(el);
    return el;
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => mount.querySelectorAll('[data-scroll-label], [data-scroll-labelledby]').forEach(syncScroller));

  /* ---------- data ---------- */
  const sources = await data.sources();
  const byId = new Map(sources.map(x => [x.id, x]));

  /* ---------- skeleton ---------- */
  // Part I stays open. Parts II to IV start closed as one summary line each, so the atlas ends on a
  // short colophon. Their contents are still built in full, so counts and deep links work.
  const parts = [
    { id: 'src-sources', title: 'The sources', italic: 'and their licences' },
    { id: 'src-method', title: 'Method', italic: 'step by step', fold: true },
    { id: 'src-limits', title: 'Known limits', italic: 'read before quoting', fold: true },
    { id: 'src-rebuild', title: 'Rebuild it', italic: 'yourself', fold: true },
  ];
  const counts = parts.map(() => h('span', { class: 'src-toc-n num' }));
  const folds = new Map();
  const setFold = (id, open) => {
    const f = folds.get(id);
    if (!f) return;
    f.btn.setAttribute('aria-expanded', String(open));
    f.body.hidden = !open;
    f.sec.classList.toggle('open', open);
    f.cue.textContent = open ? 'Close' : 'Open';
  };
  // Open the closed part that holds an element, for deep links into it.
  const openAround = el => { const sec = el && el.closest('.src-block.fold'); if (sec) setFold(sec.id, true); };
  // A contents link opens its part, scrolls to it and moves keyboard focus to the part heading (or
  // its toggle), so the next Tab continues inside that part.
  const goToPart = id => {
    setFold(id, true);
    util.scrollToId(id);
    history.replaceState(history.state, '', `#${id}`);
    const f = folds.get(id);
    const head = f ? f.btn : document.getElementById(`${id}-h`);
    if (head) head.focus({ preventScroll: true });
  };
  const tocLinks = parts.map((p, i) => h('a', { href: `#${p.id}`, on: { click: e => { e.preventDefault(); goToPart(p.id); } } },
    h('span', { class: 'src-toc-no', text: ROMAN[i] }),
    h('span', { class: 'src-toc-t', text: p.title }),
    counts[i]));
  const toc = h('nav', { class: 'src-toc', attrs: { 'aria-label': 'Sources and method contents' } },
    h('p', { class: 'eyebrow', text: 'Contents' }),
    h('ol', {}, tocLinks.map(a => h('li', {}, a))));

  const blocks = [];
  const bodies = parts.map((p, i) => {
    const no = h('span', { class: 'src-block-no', attrs: { 'aria-hidden': 'true' }, text: ROMAN[i] });
    const title = [`${p.title} `, h('span', { class: 'italic-display', text: p.italic })];
    const sec = h('section', { class: `src-block${p.fold ? ' fold' : ''}`, id: p.id, attrs: { 'aria-labelledby': `${p.id}-h` } });
    blocks.push(sec);
    if (!p.fold) {
      sec.append(h('header', { class: 'src-block-head' }, no, h('h3', { id: `${p.id}-h`, attrs: { tabindex: '-1' } }, title)));
      return sec;
    }
    const bodyId = `${p.id}-body`;
    const cue = h('span', { class: 'src-fold-cue', attrs: { 'aria-hidden': 'true' }, text: 'Open' });
    const btn = h('button', { type: 'button', class: 'src-fold', attrs: { 'aria-expanded': 'false', 'aria-controls': bodyId } },
      h('span', { class: 'src-fold-t' }, title), cue, h('span', { class: 'src-fold-ic', attrs: { 'aria-hidden': 'true' } }));
    const sum = h('p', { class: 'src-block-sum' });
    const body = h('div', { class: 'src-block-body', id: bodyId, hidden: true });
    btn.addEventListener('click', () => setFold(p.id, btn.getAttribute('aria-expanded') !== 'true'));
    folds.set(p.id, { sec, btn, body, cue, sum });
    sec.append(h('header', { class: 'src-block-head' }, no, h('h3', { id: `${p.id}-h` }, btn), sum), body);
    return body;
  });
  const [bSources, bMethod, bLimits, bRebuild] = bodies;
  // The items of a summary line, each kept whole, with a dot between them.
  const dotList = items => items.map((t, i) => h('span', { class: 'src-sum-item', text: i < items.length - 1 ? `${t} ·` : t }))
    .flatMap((el, i) => (i ? [' ', el] : [el]));
  // The summary line of a closed part: its count, then what it holds.
  const setSum = (id, count, list, warn) => {
    const f = folds.get(id);
    if (!f) return;
    f.sum.replaceChildren(...[h('span', { class: 'src-sum-n num', text: count }), ' ', h('span', { class: 'src-sum-list' }, list),
      warn ? h('span', { class: 'src-sum-warn', text: ` ${warn}` }) : null].filter(Boolean));
  };

  mount.classList.add('src-app');
  mount.replaceChildren(h('div', { class: 'src-layout' }, h('aside', { class: 'src-aside' }, toc), h('div', { class: 'src-main' }, blocks)));
  setSum('src-method', '', 'Loading…');
  setSum('src-limits', '', 'Loading…');

  // Highlight the contents entry for the part in view.
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) {
        const i = blocks.indexOf(e.target);
        if (i < 0) continue;
        tocLinks.forEach((a, j) => { if (j === i) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
      }
    }, { rootMargin: '-40% 0px -55% 0px' });
    blocks.forEach(b => io.observe(b));
  }

  /* ================= I. Sources ================= */
  counts[0].textContent = sources.length;
  const inGroup = g => sources.filter(x => (x.group || 'data') === g).length;
  const matrixFig = buildMatrix();
  const bib = buildBibliography();
  const intro = [
    `The atlas is built from ${fmt.num(inGroup('data'))} datasets and services.`,
    inGroup('check') ? `Parts of its content were checked against ${fmt.num(inGroup('check'))} further references.` : null,
    inGroup('software') ? `The last ${fmt.num(inGroup('software'))} entries credit the software and typefaces the page loads.` : null,
    'Every source and licence page below was opened on the access date shown, and each entry keeps the exact wording that supports it.',
  ].filter(Boolean).join(' ');
  bSources.append(h('p', { class: 'src-intro', text: intro }), matrixFig, bib.el);

  function buildMatrix() {
    const capId = nextId('src-mx');
    const fh = figHead(1, 'Which source feeds which file', 4);
    const table = h('table', { class: 'src-matrix', attrs: { 'aria-labelledby': fh.id, 'aria-describedby': capId } });
    const caption = h('p', { id: capId, class: 'src-mx-cap', text: 'Rows are sources, columns are the data files the build writes, plus what the page loads live. Select a source to read its entry.' });
    const head = h('tr', {}, h('td', { class: 'src-mx-corner' }),
      TARGETS.map((t, j) => h('th', { attrs: { scope: 'col' }, dataset: { col: j } },
        h('span', { class: 'src-mx-col', attrs: { 'aria-hidden': 'true' }, text: t.file }),
        h('span', { class: 'visually-hidden', text: t.id === 'live' ? t.what : `${t.file}, ${t.what}` }))));
    table.append(h('thead', {}, head));
    const body = h('tbody');
    sources.forEach((src, i) => {
      const tr = h('tr', { dataset: { row: i } },
        h('th', { attrs: { scope: 'row' } },
          h('a', { href: `#src-${src.id}`, on: { click: e => { e.preventDefault(); bib.reveal(src.id); } } },
            h('span', { class: 'src-mx-n num', attrs: { 'aria-hidden': 'true' }, text: i + 1 }), src.short || src.title)));
      TARGETS.forEach((t, j) => {
        const on = (src.feeds || []).includes(t.id);
        tr.append(h('td', { class: on ? 'on' : '', dataset: { col: j } },
          h('span', { class: 'src-dot', attrs: { 'aria-hidden': 'true' } }),
          h('span', { class: 'visually-hidden', text: on ? 'Yes' : 'No' })));
      });
      body.append(tr);
    });
    table.append(body);
    // Crosshair highlight on hover and focus.
    const setCol = j => table.querySelectorAll('[data-col]').forEach(c => c.classList.toggle('col-hi', c.dataset.col === String(j)));
    table.addEventListener('pointerover', e => { const c = e.target.closest('[data-col]'); setCol(c ? c.dataset.col : null); });
    table.addEventListener('pointerleave', () => setCol(null));
    const key = h('dl', { class: 'src-mx-key' }, TARGETS.map(t => h('div', {},
      h('dt', { class: 'mono', text: t.file }), h('dd', { text: t.what }))));
    return h('figure', { class: 'src-mx-wrap', attrs: { 'aria-labelledby': fh.id } },
      fh.el,
      scroller('src-mx-scroll', `#${fh.id}`, table),
      h('div', { class: 'src-mx-side' }, caption, h('p', { class: 'eyebrow', text: 'Columns' }), key));
  }

  function buildBibliography() {
    const GROUPS = [
      { id: 'data', title: 'Data and services' },
      { id: 'check', title: 'References for the fact-check' },
      { id: 'software', title: 'Software and type' },
    ];
    const lists = new Map(GROUPS.map(g => [g.id, h('ol', { class: 'src-bib', attrs: { 'aria-labelledby': `src-grp-${g.id}` } })]));
    const panels = new Map();
    const toggles = [];
    const buildLines = new Map();
    // When most pages were opened on the same day, say so once in the bar. Phones then show a
    // per-entry date only where it differs.
    const dateCount = new Map();
    sources.forEach(x => dateCount.set(x.accessed, (dateCount.get(x.accessed) || 0) + 1));
    const [topDate, topN] = [...dateCount].sort((a, b) => b[1] - a[1])[0] || [null, 0];
    const commonDate = topN * 2 > sources.length ? topDate : null;
    const allSame = dateCount.size === 1;
    const expandAll = h('button', { type: 'button', class: 'link-btn src-expand-all', text: 'Open every entry' });
    const setOpen = (btn, panel, open) => {
      btn.setAttribute('aria-expanded', String(open));
      panel.hidden = !open;
    };
    expandAll.addEventListener('click', () => {
      const open = !toggles.every(([b]) => b.getAttribute('aria-expanded') === 'true');
      toggles.forEach(([b, p]) => setOpen(b, p, open));
      syncAll();
    });
    const syncAll = () => {
      const all = toggles.every(([b]) => b.getAttribute('aria-expanded') === 'true');
      expandAll.textContent = all ? 'Close every entry' : 'Open every entry';
    };

    sources.forEach((src, i) => {
      const panelId = `src-${src.id}-ev`;
      const btn = h('button', { type: 'button', class: 'disclosure-btn', attrs: { 'aria-expanded': 'false', 'aria-controls': panelId } },
        'Licence wording and notes');
      const panel = evidence(src, panelId);
      panel.hidden = true;
      btn.addEventListener('click', () => { setOpen(btn, panel, btn.getAttribute('aria-expanded') !== 'true'); syncAll(); });
      toggles.push([btn, panel]);
      panels.set(src.id, [btn, panel]);
      const build = h('p', { class: 'src-build' });
      buildLines.set(src.id, build);
      const li = h('li', { class: `src-entry${src.accessed === commonDate ? ' same-date' : ''}`, id: `src-${src.id}`, attrs: { value: String(i + 1) } },
        h('span', { class: 'src-no display-num', attrs: { 'aria-hidden': 'true' }, text: i + 1 }),
        h('div', { class: 'src-cell src-what' },
          h('h5', { class: 'src-title' }, ext(src.url, src.title)),
          h('p', { class: 'src-pub', text: src.publisher }),
          build),
        h('div', { class: 'src-cell src-use' }, h('span', { class: 'src-lab', text: 'Used for' }), h('p', { text: src.used_for })),
        h('div', { class: 'src-cell src-lic' }, h('span', { class: 'src-lab', text: 'Licence' }),
          h('p', {}, ext(src.licence_url, src.licence)),
          src.updated ? h('p', { class: 'src-sub' }, 'Data updated ', timeEl(src.updated)) : null),
        h('div', { class: 'src-cell src-acc' }, h('span', { class: 'src-lab', text: 'Accessed' }), h('p', { class: 'mono' }, timeEl(src.accessed))),
        h('div', { class: 'src-more' }, btn),
        panel);
      (lists.get(src.group) || lists.get('data')).append(li);
    });

    const head = h('div', { class: 'src-bib-head', attrs: { 'aria-hidden': 'true' } },
      h('span', { text: 'No.' }), h('span', { text: 'Source' }), h('span', { text: 'Used for' }), h('span', { text: 'Licence' }), h('span', { text: 'Accessed' }));
    const el = h('div', { class: 'src-bib-wrap' },
      h('div', { class: 'src-bib-bar' },
        h('p', { class: 'eyebrow', text: 'Bibliography' }),
        commonDate ? h('p', { class: 'src-bib-date' }, allSame ? 'All pages opened on ' : 'Most pages opened on ', timeEl(commonDate),
          allSame ? null : '. Other dates are shown on their entry.') : null,
        expandAll),
      head,
      GROUPS.filter(g => lists.get(g.id).children.length).map(g => h('div', { class: 'src-bib-group' },
        h('h4', { class: 'src-grp', id: `src-grp-${g.id}` },
          h('span', { text: g.title }),
          h('span', { class: 'src-grp-n num', attrs: { 'aria-hidden': 'true' }, text: (n => `${fmt.num(n)} ${n === 1 ? 'entry' : 'entries'}`)(lists.get(g.id).children.length) })),
        lists.get(g.id))));

    function reveal(id, scroll = true) {
      const pair = panels.get(id);
      const li = document.getElementById(`src-${id}`);
      if (!pair || !li) return;
      setOpen(pair[0], pair[1], true); syncAll();
      if (scroll) util.scrollToId(`src-${id}`);
      history.replaceState(history.state, '', `#src-${id}`);
      if (!util.reducedMotion()) { li.classList.remove('flash'); void li.offsetWidth; li.classList.add('flash'); }
      pair[0].focus({ preventScroll: true });
    }
    return { el, reveal, buildLines };
  }

  function quoteBlock(text, lang, source, translation) {
    return h('figure', { class: 'src-quote' },
      h('blockquote', { attrs: { lang: lang || 'en', cite: source || null } }, h('p', { text })),
      translation ? h('p', { class: 'src-trans' }, h('span', { class: 'src-lab-inline', text: 'Translation' }), ` ${translation}`) : null,
      source ? h('figcaption', {}, 'Source ', ext(source, host(source))) : null);
  }

  function evidence(src, id) {
    const box = h('div', { class: 'src-ev', id });
    const col1 = h('div', { class: 'src-ev-col' },
      h('p', { class: 'eyebrow', text: 'Licence wording, as checked' }),
      quoteBlock(src.quote, src.quote_lang, src.quote_source, src.quote_translation));
    (src.notes || []).forEach(n => {
      col1.append(h('div', { class: 'src-note' },
        h('p', { class: 'eyebrow', text: n.label }),
        n.quote ? quoteBlock(n.quote, n.lang, n.source, n.translation)
          : h('p', { class: 'src-note-text' }, n.text, n.source ? [' ', ext(n.source, `(${host(n.source)})`)] : null)));
    });
    const facts = h('dl', { class: 'src-ev-facts' });
    const add = (k, v) => { if (v != null && v !== '') facts.append(h('div', {}, h('dt', { text: k }), h('dd', {}, v))); };
    if (src.attribution) add('Credit line', src.attribution_url ? ext(src.attribution_url, src.attribution) : src.attribution);
    if (src.version) add('File', h('span', { class: 'mono', text: src.version }));
    if (src.service) add('Service', ext(src.service, host(src.service), 'mono'));
    if (src.layer) add('Layer', h('span', { class: 'mono', text: src.layer }));
    if (src.parts) add('Includes', h('ul', { class: 'src-parts' }, src.parts.map(p => h('li', {},
      p.url ? ext(p.url, p.name) : p.name,
      p.layer ? h('span', { class: 'mono src-sub', text: ` ${p.layer}` }) : null,
      p.designer ? h('span', { class: 'src-sub', text: `, ${p.designer}` }) : null,
      p.doi ? [' ', ext(`https://doi.org/${p.doi}`, `doi:${p.doi}`, 'mono src-sub')] : null))));
    const fc = src.fact_check;
    if (fc) {
      add('Record', h('span', { class: 'mono', text: fc.record }));
      if (fc.appellations != null) add('Appellations checked', h('span', { class: 'num', text: fmt.num(fc.appellations) }));
      if (fc.white_only != null) add('Colour rules found', h('ul', { class: 'src-parts' },
        h('li', {}, h('span', { class: 'num', text: fmt.num(fc.white_only) }), ' white only'),
        h('li', {}, h('span', { class: 'num', text: fmt.num(fc.white_and_red) }), ' white and red'),
        h('li', {}, h('span', { class: 'num', text: fmt.num(fc.red_only) }), ' red only')));
      if (fc.checked) add('Checked', timeEl(fc.checked, true));
      if (fc.rechecked && fc.quotes != null) add('Quotes found again', h('span', {},
        h('span', { class: 'num', text: `${fmt.num(fc.quotes_found)} of ${fmt.num(fc.quotes)}` }), ', ', timeEl(fc.rechecked, true)));
      const f = fc.in_force;
      if (f) add('Later texts listed by INAO', h('span', {},
        h('span', { class: 'num', text: `${fmt.num(f.later_text_listed)} of ${fmt.num(f.pages)}` }), ' product pages, dated ',
        h('span', { class: 'num', text: `${f.first_year}–${f.last_year}` }), ', opened ', timeEl(f.checked, true)));
      if (f && f.rules_checked) {
        add('Checked against the texts in force', h('span', {},
          h('span', { class: 'num', text: `${fmt.num(f.rules_checked)} of ${fmt.num(fc.appellations)}` }), ' colour rules, ',
          f.rules_agree === f.rules_checked ? 'all agreeing' : `${fmt.num(f.rules_agree)} agreeing`, ' with the drafts',
          f.rechecked ? [', ', timeEl(f.rechecked, true)] : null));
        if (f.not_verified && f.not_verified.length) add('Not checked against the texts in force', listJoin(f.not_verified));
      }
    }
    if (src.scripts && src.scripts.length) add('Read by', h('span', { class: 'src-chips' }, src.scripts.map(x => h('span', { class: 'chip mono', text: x }))));
    add('Licence text', ext(src.licence_url, where(src.licence_url)));
    box.append(col1, h('div', { class: 'src-ev-col src-ev-side' }, facts));
    return box;
  }

  /* ================= Everything else loads when the section comes near ================= */
  const placeholders = [bMethod, bLimits, bRebuild].map(b => {
    const p = h('p', { class: 'loading', text: 'Loading…' });
    b.append(p);
    return p;
  });
  counts[3].textContent = STEPS.length;
  renderRebuild();
  setSum('src-rebuild', `${fmt.num(STEPS.length)} scripts`, [code(STEPS[0].script), ' to ', code(STEPS[STEPS.length - 1].script), ' and the commands that run them']);
  placeholders[2].remove();

  // What goes missing when a data file fails to load, so the page can say so instead of
  // silently showing fewer steps and limits.
  const MISSING = {
    'data/index.json': { method: ['Appellations and climats', 'Height, slope and aspect', 'White-wine flags', 'Drawing the shapes'], limits: ['the limits counted from the map shapes', 'are'] },
    'data/villages.json': { method: ['Exclusive level areas', 'Village markers'], limits: ['the note on delimited land', 'is'] },
    'data/climate.json': { method: ['Climate indices'], limits: ['the caveats of the climate record', 'are'] },
    'data/transects.json': { method: ['Cross-sections'], limits: null },
  };
  const failNote = (failed, part) => {
    const lines = failed.map(file => {
      const m = MISSING[file];
      if (part === 'method') {
        const n = m.method.length;
        return `Could not load ${file}, so the ${n === 1 ? 'step' : 'steps'} ${listJoin(m.method.map(t => `“${t}”`))} ${n === 1 ? 'is' : 'are'} not shown.`;
      }
      return m.limits ? `Could not load ${file}, so ${m.limits[0]} ${m.limits[1]} not shown.` : null;
    }).filter(Boolean);
    return lines.length ? h('div', { class: 'error-box src-error', attrs: { role: 'status' } }, lines.map(t => h('p', { text: t }))) : null;
  };

  let startP = null;
  const start = () => startP || (startP = (async () => {
    const failed = [];
    const load = (fn, file) => fn().catch(err => { console.error('[sources]', err); failed.push(file); return null; });
    const [idx, vil, clim, tr] = await Promise.all([
      load(data.index, 'data/index.json'),
      load(data.villages, 'data/villages.json'),
      load(data.climate, 'data/climate.json'),
      load(data.transects, 'data/transects.json'),
    ]);
    failed.sort((a, b) => Object.keys(MISSING).indexOf(a) - Object.keys(MISSING).indexOf(b));
    placeholders[0].remove();
    placeholders[1].remove();
    fillBuildLines(idx, vil, clim);
    const methodErr = failNote(failed, 'method');
    const limitsErr = failNote(failed, 'limits');
    const titles = renderMethod(idx, vil, clim, tr, methodErr);
    const groups = renderLimits(idx, vil, clim, limitsErr);
    const warn = 'Part of it could not load.';
    setSum('src-method', `${fmt.num(titles.length)} ${titles.length === 1 ? 'step' : 'steps'}`, dotList(titles), methodErr ? warn : null);
    setSum('src-limits', `${counts[2].textContent} ${counts[2].textContent === '1' ? 'limit' : 'limits'}`, dotList(groups), limitsErr ? warn : null);
  })());
  util.whenVisible(mount, () => { start().catch(err => console.error('[sources]', err)); }, '900px');

  // Deep links (#src-inao, #src-method) open the entry, load the rest of the section, then keep the
  // target in view while the modules above finish loading and change the page height.
  const followHash = () => {
    const id = location.hash.startsWith('#src-') ? decodeURIComponent(location.hash.slice(1)) : null;
    if (!id) return;
    if (byId.has(id.slice(4))) bib.reveal(id.slice(4), false);
    openAround(document.getElementById(id));
    start().catch(err => console.error('[sources]', err)).finally(() => { openAround(document.getElementById(id)); holdInView(id); });
  };
  followHash();
  addEventListener('hashchange', followHash);

  function holdInView(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const USER = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
    let done = false;
    const go = () => { if (!done) el.scrollIntoView({ block: 'start', behavior: 'instant' }); };
    const ro = new ResizeObserver(go);
    const stop = () => {
      if (done) return;
      done = true; ro.disconnect(); clearTimeout(timer);
      USER.forEach(ev => removeEventListener(ev, stop));
    };
    const timer = setTimeout(stop, 5000);
    USER.forEach(ev => addEventListener(ev, stop, { passive: true }));
    ro.observe(document.body);
    go();
  }

  /* ---------- "In this build" lines, computed ---------- */
  function whiteTally(idx) {
    const f = idx.features;
    return {
      total: f.length,
      yes: f.filter(x => x.white === true).length,
      no: f.filter(x => x.white === false).length,
      unknown: f.filter(x => x.white == null).length,
    };
  }
  // The re-check of the colour rules against the homologated texts in force, from the fact-check
  // record. Which of the unchecked appellations the map draws is counted from index.json.
  function inForceText(fc, idx) {
    const f = fc && fc.in_force;
    if (!f || !f.rules_checked) return null;
    const agree = f.rules_agree === f.rules_checked
      ? `every one of the ${fmt.num(f.rules_checked)} colour rules agrees with the draft`
      : `${fmt.num(f.rules_agree)} of the ${fmt.num(f.rules_checked)} colour rules agree with the draft`;
    let out = `The homologated texts in force were read for ${fmt.num(f.rules_checked)} of the ${fmt.num(fc.appellations)} appellations, and ${agree}.`;
    const nv = f.not_verified || [];
    if (!nv.length) return out;
    const one = nv.length === 1;
    out += ` For ${listJoin(nv)} the text in force could not be read, so ${one ? 'its flag follows the draft' : 'their flags follow the drafts'}.`;
    if (!idx) return out;
    const shapes = idx.features.filter(x => nv.includes(x.app));
    const drawn = nv.filter(a => shapes.some(x => x.app === a));
    const n = `${fmt.num(shapes.length)} ${shapes.length === 1 ? 'shape' : 'shapes'}`;
    if (!drawn.length) out += one ? ' It is not drawn on the map.' : ' None of them is drawn on the map.';
    else if (drawn.length === nv.length) out += ` ${one ? 'It is' : 'All of them are'} drawn on the map, with ${n}.`;
    else out += ` Of these, only ${listJoin(drawn)} ${drawn.length === 1 ? 'is' : 'are'} drawn on the map, with ${n}.`;
    return out;
  }
  function fillBuildLines(idx, vil, clim) {
    const set = (id, ...content) => { const el = bib.buildLines.get(id); if (el && content.length) el.replaceChildren(h('span', { class: 'src-lab-inline', text: 'In this build' }), ' ', ...content); };
    if (idx) {
      const f = idx.features;
      const n = k => f.filter(x => x.kind === k).length;
      set('inao', `${fmt.num(f.length)} shapes, of which ${fmt.num(n('appellation'))} village appellations, ${fmt.num(n('climat'))} named premier cru climats and ${fmt.num(n('grand_cru'))} grand crus.`);
      if (idx.source && idx.source.dem) set('rge-alti', `Height, slope and aspect for ${fmt.num(f.length)} shapes at ${fmt.num(idx.source.dem.resolution_m)} m per cell.`);
      const w = whiteTally(idx);
      const fc = (byId.get('inao-cdc') || {}).fact_check;
      const inForce = fc && fc.in_force && fc.in_force.rules_checked
        ? `, and ${fmt.num(fc.in_force.rules_checked)} of their colour rules checked again against the texts in force` : '';
      if (w.total) set('inao-cdc', `${fc ? `${fmt.num(fc.appellations)} draft cahiers read${inForce}. ` : ''}Of ${fmt.num(w.total)} shapes, ${fmt.num(w.yes)} are flagged as allowing white wine and ${fmt.num(w.no)} as not${w.unknown ? `, and ${fmt.num(w.unknown)} are not verified` : ''}.`);
    }
    if (vil) {
      const off = vil.villages.filter(v => v.climatsOfficial && Number.isFinite(v.climatsOfficial.count) && /BIVB/.test(v.climatsOfficial.label || ''));
      if (off.length) set('bivb', listJoin(off.map(v => `${v.name}, ${fmt.num(v.climatsOfficial.count)} premier cru climats listed, against ${fmt.num(v.stats.n_climats)} named in INAO’s digital delimitation`)) + '.');
    }
    if (clim) {
      const m = clim.meta;
      set('open-meteo', `${fmt.num(clim.sites.length)} sites, ${m.years[0]}–${m.years[1]}, fetched by the build on ${date(m.accessed)}.`);
      const model = id => ({ era5_land: 'ERA5-Land', era5: 'ERA5' })[id] || id;
      if (m.models) set('era5', `Temperatures from ${model(m.models.temperature)} and precipitation from ${model(m.models.precipitation)}, requested from Open-Meteo as the models `, code(m.models.temperature), ' and ', code(m.models.precipitation), '.');
      set('geo-api', `Commune centres for the ${fmt.num(clim.sites.length)} climate sites, and the commune names on the map.`);
    }
    if (vil) {
      const osm = vil.villages.filter(v => /^OpenStreetMap Nominatim/.test(v.markerSource || '')).length;
      set('osm', `${fmt.num(osm)} of ${fmt.num(vil.villages.length)} village markers.`);
    }
  }

  /* ================= II. Method ================= */
  function renderMethod(idx, vil, clim, tr, errBox) {
    const steps = [];
    const titles = [];
    const article = (title, script, ...content) => {
      const n = steps.length + 1;
      titles.push(title);
      const a = h('article', { class: 'src-step', attrs: { 'aria-labelledby': `src-step-${n}` } },
        h('div', { class: 'src-step-head' },
          h('span', { class: 'src-step-no display-num', attrs: { 'aria-hidden': 'true' }, text: String(n).padStart(2, '0') }),
          h('h4', { id: `src-step-${n}`, text: title }),
          script ? h('span', { class: 'src-chips' }, [].concat(script).map(x => h('span', { class: 'chip mono', text: x }))) : null),
        h('div', { class: 'src-step-body' }, content));
      steps.push(a);
      return a;
    };
    const P = (...c) => h('p', {}, ...c);
    const facts = rows => h('dl', { class: 'facts src-facts' }, rows.filter(Boolean).map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', {}, v))));

    // Build record
    const record = [];
    if (idx && idx.generated) record.push(['Shapes and index', timeEl(idx.generated, true)]);
    if (vil && vil.generated) record.push(['Village profiles', timeEl(vil.generated, true)]);
    if (clim && clim.meta && clim.meta.accessed) record.push(['Climate data fetched', timeEl(clim.meta.accessed, true)]);
    const inao = byId.get('inao');
    if (inao && inao.updated) record.push(['INAO file dated', timeEl(inao.updated)]);
    bMethod.append(
      h('p', { class: 'src-intro', text: 'What the build scripts do, in the order they run. Counts, dates and measurements in this part are read at page load from the data files the scripts wrote. Fixed settings, such as the flat threshold for aspect, are quoted from the scripts.' }),
      ...[errBox, record.length ? h('div', { class: 'src-record' }, h('p', { class: 'eyebrow', text: 'This build' }), facts(record)) : null].filter(Boolean));

    // 1. Appellations and climats
    if (idx) {
      const f = idx.features;
      const regions = idx.regions || [];
      const gc = f.filter(x => x.kind === 'grand_cru');
      const gcChab = gc.filter(x => x.region === 'chablis').length;
      const gcCdb = gc.filter(x => x.region === 'cote-de-beaune').length;
      const example = f.filter(x => x.kind === 'climat').sort((a, b) => b.area_ha - a.area_ha)[0];
      const file = idx.source && idx.source.inao ? idx.source.inao.file : null;
      const tbl = h('table', { class: 'src-table num-table' },
        h('caption', { class: 'visually-hidden', text: 'Shapes extracted per region' }),
        h('thead', {}, h('tr', {}, ['Region', 'Village appellations', 'Named climats', 'Grand crus'].map((t, j) => h('th', { attrs: { scope: 'col' }, class: j ? 'r' : '', text: t })))),
        h('tbody', {}, regions.map(r => h('tr', {}, h('th', { attrs: { scope: 'row' }, text: r.name }),
          ['appellation', 'climat', 'grand_cru'].map(k => h('td', { class: 'r num', text: fmt.num(r.counts[k]) }))))),
        h('tfoot', {}, h('tr', {}, h('th', { attrs: { scope: 'row' }, text: 'All regions' }),
          ['appellation', 'climat', 'grand_cru'].map(k => h('td', { class: 'r num', text: fmt.num(regions.reduce((a, r) => a + r.counts[k], 0)) })))));
      article('Appellations and climats', '01_inao.py',
        P('The build starts from the INAO parcel shapefile', file ? [' (', code(file), ')'] : '', `. Each of its rows is one appellation or one named climat within one commune. The script keeps the Côte-d’Or, Saône-et-Loire and Yonne rows of the Dijon and Mâcon INAO offices, and within them the appellations of the ${fmt.num(regions.length)} regions of the atlas. Rows are dissolved across communes into one shape per denomination, and areas are measured in Lambert-93 (EPSG:2154).`),
        P(`A village appellation is an appellation row, with the grand cru appellations set aside. A named premier cru climat is any denomination written as the appellation, then “premier cru”, then a name${example ? `, such as ${example.full}` : ''}. The premier cru land of each appellation is also kept as one union, for statistics only.`),
        P(`Grand crus are the grand cru appellations of the Côte de Beaune and the Chablis Grand Cru climats. The map shows ${fmt.num(gcCdb)} in the Côte de Beaune and ${fmt.num(gcChab)} in Chablis. The regional Bourgogne area is kept only to label cross-section samples, in the communes that host one of these appellations.`),
        scroller('src-scroll', 'Shapes extracted per region', tbl));
    }

    // 2. Exclusive level areas
    if (vil) {
      const notes = vil.notes || [];
      const exclusive = notes.find(n => /exclusive/i.test(n));
      const areaNote = notes.find(n => /hectares/i.test(n));
      article('Exclusive level areas', '06_villages.py',
        P('Each hectare of a village profile is counted once, at its highest level. ', exclusive || ''),
        P('Two profiles are special cases. Petit Chablis uses the land entitled to Petit Chablis but not to Chablis, and holds no grand cru land. The Corton-Charlemagne profile is the grand cru area itself.'),
        areaNote ? P(areaNote) : null,
        levelExample(vil));
    }

    // 3. Height, slope and aspect
    if (idx) {
      const f = idx.features;
      const res = idx.source && idx.source.dem ? idx.source.dem.resolution_m : null;
      const flat = f.filter(x => x.aspect_label === 'flat').length;
      article('Height, slope and aspect', '02_terrain.py',
        P(`For each region the build requests the RGE ALTI terrain model from the Géoplateforme WMS-Raster as raw 32-bit values in Lambert-93${res ? `, at ${fmt.num(res)} m per cell` : ''}, over the region and a margin of ${fmt.num(METHOD.demPadM)} m. Slope comes from the elevation gradient between neighbouring cells. Aspect is the compass bearing of the downslope direction, with 0° for north.`),
        P('The statistics of a shape use every cell whose centre falls inside it. A sliver smaller than one cell is read at a single point inside it. Elevation is summarised by its minimum, mean and maximum, and slope by its mean in degrees and in percent.'),
        P(`Aspect is only measured where the ground slopes. Cells flatter than ${METHOD.flatDeg}° are left out of every aspect figure. The mean aspect is the circular mean of the cells of ${METHOD.flatDeg}° or more, each weighted by the sine of its slope, and is named with one of ${METHOD.labels16.length} compass points. The aspect rose gives the share of those cells in each of ${METHOD.sectors.length} sectors of 45°. A shape with fewer than ${METHOD.minSteepCells} such cells is labelled flat.`),
        facts([
          ['Shapes measured', h('span', { text: fmt.num(f.length) })],
          res ? ['Cell size', h('span', { text: `${fmt.num(res)} m` })] : null,
          ['Labelled flat', h('span', { text: fmt.num(flat) })],
          ['Flat threshold', h('span', { text: `${METHOD.flatDeg}°` })],
        ]),
        aspectKey());
    }

    // 4. Cross-sections
    if (tr && tr.transects && tr.transects.length) {
      const T = tr.transects;
      const step = T[0].step_m;
      const samples = T.reduce((a, t) => a + t.z.length, 0);
      const len = T.reduce((a, t) => a + t.length_m, 0);
      const res = idx && idx.source && idx.source.dem ? idx.source.dem.resolution_m : null;
      article('Cross-sections', '05_transects.py',
        P(`Each cross-section is a straight line through two anchor shapes, upslope anchor first, extended beyond both ends. When a single anchor is given, the line follows that shape’s mean downslope bearing. Elevation is read every ${fmt.num(step)} m by bilinear interpolation of the ${res ? `${fmt.num(res)} m ` : ''}grid.`),
        P('Each sample takes the highest classification whose INAO polygon contains it. Runs of samples with the same level and name become the coloured segments of the profile.'),
        rankList(),
        facts([
          ['Cross-sections', h('span', { text: fmt.num(T.length) })],
          ['Samples', h('span', { text: fmt.num(samples) })],
          ['Total length', h('span', { text: km(len) })],
          ['Step', h('span', { text: `${fmt.num(step)} m` })],
        ]),
        transectFigure(T));
    }

    // 5. Climate indices
    if (clim) {
      const m = clim.meta;
      const sites = clim.sites;
      const K = m.huglin_k;
      const kSrc = m.huglin_k_source || {};
      const band = /(\d+)°N-(\d+)°N/.exec(kSrc.table_row || '');
      const allInBand = sites.every(x => x.huglin_k === K);
      const nYears = m.years[1] - m.years[0] + 1;
      const firstAnalog = Object.values(clim.analogs || {})[0];
      const win = firstAnalog && firstAnalog[0] ? firstAnalog[0].window[1] - firstAnalog[0].window[0] + 1 : null;
      const nonnull = m.era5_land_precip_nonnull_values;
      article('Climate indices', '04_climate.py',
        P(`Daily maximum, minimum and mean temperatures come from ERA5-Land and daily precipitation from ERA5, both through the Open-Meteo Historical Weather API. Each site is the centre of one commune per region, as given by geo.api.gouv.fr. Days run in ${m.timezone} time, from ${m.years[0]} to ${m.years[1]}.`),
        nonnull === 0 ? P('Open-Meteo returned no ERA5-Land precipitation values for this build, which is why precipitation comes from ERA5.') : null,
        P(`Every index is computed for each year over a fixed window of days, shown below. The Huglin coefficient K is ${fmt.num(K, 2)}, from Table 2 of the ECA&D Algorithm Theoretical Basis Document${band ? `, for latitudes from ${band[1]}°N to ${band[2]}°N` : ''}${allInBand ? ', a band that holds every site' : ''}.`),
        P(`Each summary compares the ${m.baseline[0]}–${m.baseline[1]} mean with the ${m.recent[0]}–${m.recent[1]} mean, and fits a least-squares trend per decade over all ${fmt.num(nYears)} years.${win ? ` Analogues look, for each site, for the ${fmt.num(win)}-year window of every other site whose mean growing-season temperature comes closest to this site’s ${m.recent[0]}–${m.recent[1]} mean.` : ''}`),
        indexTable(clim),
        sitesTable(clim),
        citations(clim));
    }

    // 6. Village markers
    if (vil) {
      const V = vil.villages;
      const osm = V.filter(v => /^OpenStreetMap Nominatim/.test(v.markerSource || ''));
      const rep = V.filter(v => /^representative point/.test(v.markerSource || ''));
      article('Village markers', '06_villages.py',
        P(`${fmt.num(osm.length)} of the ${fmt.num(V.length)} village markers come from an OpenStreetMap Nominatim place search for a commune.${rep.length ? ` The other ${fmt.num(rep.length)}, ${listJoin(rep.map(v => v.name))}, sit on a representative point of the INAO delimited area.` : ''} The search waits more than a second between requests, as the Nominatim usage policy asks.`));
    }

    // 7. White-wine flags, from the fact-check record
    const cdc = byId.get('inao-cdc');
    if (idx && cdc && cdc.fact_check) {
      const fc = cdc.fact_check;
      const w = whiteTally(idx);
      const apps = idx.features.filter(f => f.kind === 'appellation');
      const redApps = apps.filter(f => f.white === false).map(f => f.name);
      const redSet = new Set(apps.filter(f => f.white === false).map(f => f.app));
      const redClimats = idx.features.filter(f => f.kind === 'climat' && redSet.has(f.app));
      const sameFlag = redClimats.length > 0 && redClimats.every(f => f.white === false);
      const f = fc.in_force;
      const years = [fc.drafts_2010 ? `${fmt.num(fc.drafts_2010)} dated 2010` : null, fc.drafts_2016 ? `${fmt.num(fc.drafts_2016)} dated 2016` : null].filter(Boolean);
      const recheck = inForceText(fc, idx);
      article('White-wine flags', '06_villages.py',
        P(`A fact-check pass read the draft cahier des charges of ${fmt.num(fc.appellations)} appellations and recorded, for each one, whether it allows white wine and red wine, the file it read and the sentence that says so. The record, `, code(fc.record), `, is dated ${dateTime(fc.checked)}. The script copies the white-wine answer into every shape of the appellation, in the region files and in the search index. The record is optional, and an appellation missing from it is left as not verified.`),
        fc.drafts ? P(`The ${fmt.num(fc.drafts)} files read are drafts that INAO published for a national opposition procedure${years.length ? `, ${listJoin(years)}` : ''}. They are not the texts in force.${f ? ` On ${date(f.checked)}, the INAO product pages of ${f.later_text_listed === f.pages ? `all ${fmt.num(f.pages)}` : `${fmt.num(f.later_text_listed)} of the ${fmt.num(f.pages)}`} appellations listed a cahier published later, between ${f.first_year} and ${f.last_year}.` : ''}`) : null,
        recheck ? P(recheck) : null,
        P(`The record also keeps ${fmt.num(fc.special_rules)} special rules with their quotes, which the script does not read. For this page the ${fmt.num(fc.quotes)} quotes were looked up again in the ${fmt.num(fc.files)} draft files on ${dateTime(fc.rechecked)}, and ${fc.quotes_found === fc.quotes ? `all ${fmt.num(fc.quotes_found)}` : fmt.num(fc.quotes_found)} were found.`),
        facts([
          ['Draft cahiers read', h('span', { text: fmt.num(fc.appellations) })],
          ['White only', h('span', { text: fmt.num(fc.white_only) })],
          ['White and red', h('span', { text: fmt.num(fc.white_and_red) })],
          ['Red only', h('span', { text: fmt.num(fc.red_only) })],
          f && f.rules_checked ? ['Checked in force', h('span', { text: `${fmt.num(f.rules_checked)} of ${fmt.num(fc.appellations)}` })] : null,
        ]),
        whiteFigure(w, apps.length, redApps, sameFlag ? redClimats.length : 0));
    }

    // 8. Drawing the shapes
    if (idx) {
      const regions = idx.regions || [];
      const total = regions.reduce((a, r) => a + (r.bytes || 0), 0);
      article('Drawing the shapes', '03_export.py',
        P(`Shapes are simplified for display only, with tolerances of ${fmt.num(METHOD.simplify.appellation)} m for appellations, ${fmt.num(METHOD.simplify.climat, 1)} m for climats and ${fmt.num(METHOD.simplify.grand_cru)} m for grand crus, and slivers and small holes are dropped. The zoomed-out overview closes the gaps between neighbouring parcels and simplifies at ${fmt.num(METHOD.overviewTol)} m. Coordinates in the region files are written to ${fmt.num(METHOD.coordDp)} decimal places of a degree, about a metre on the ground, and those of the overview to ${fmt.num(METHOD.overviewDp)}. Every area, height, slope and aspect figure comes from the full-resolution geometry.`),
        P('Petit Chablis is drawn as the land entitled to Petit Chablis but not to Chablis. The Charlemagne grand cru lies inside Corton-Charlemagne and is not drawn separately. Larger shapes are painted under smaller ones.'),
        h('div', { class: 'src-sizes' },
          h('p', { class: 'eyebrow', text: 'Region file sizes, as index.json records them' }),
          facts([
            ...regions.map(r => [r.name, h('span', { text: kb(r.bytes) })]),
            ['All regions', h('span', { text: kb(total) })],
          ])));
    }

    counts[1].textContent = steps.length;
    bMethod.append(h('div', { class: 'src-steps' }, steps));
    return titles;
  }

  function levelExample(vil) {
    const V = vil.villages.filter(v => v.stats && v.stats.area_ha);
    if (!V.length) return null;
    const three = V.filter(v => ['grand_cru', 'premier_cru', 'village'].every(k => v.stats.area_ha[k] > 0));
    const initial = (three.sort((a, b) => b.stats.area_ha.total - a.stats.area_ha.total)[0] || V[0]).id;
    const selId = nextId('src-lv');
    const select = h('select', { class: 'input src-select', id: selId },
      vil.villages.map(v => h('option', { value: v.id, text: v.name, selected: v.id === initial })));
    const bar = h('div', { class: 'src-lvbar', attrs: { role: 'img' } });
    const legend = h('p', { class: 'src-lvsum', attrs: { 'aria-live': 'polite' } });
    const draw = () => {
      const v = vil.villages.find(x => x.id === select.value);
      const a = v.stats.area_ha;
      const parts = [['grand-cru', 'grand_cru'], ['premier-cru', 'premier_cru'], ['village', 'village']];
      const sum = parts.reduce((acc, [, k]) => acc + (a[k] || 0), 0) || 1;
      bar.replaceChildren(...parts.filter(([, k]) => a[k] > 0).map(([lvl, k]) =>
        h('span', { class: 'src-lvseg', dataset: { level: lvl }, style: { flexGrow: String(a[k]) } })));
      const bits = parts.filter(([, k]) => a[k] > 0).map(([lvl, k]) => `${util.LEVELS[lvl].label} ${fmt.ha(a[k])}`);
      bar.setAttribute('aria-label', `${v.name}. ${bits.join(', ')}. Total ${fmt.ha(a.total)}.`);
      legend.replaceChildren(...parts.filter(([, k]) => a[k] > 0).flatMap(([lvl, k], i) => [
        i ? h('span', { class: 'src-op', attrs: { 'aria-hidden': 'true' }, text: '+' }) : [],
        h('span', { class: 'src-lvitem' }, h('span', { class: 'swatch', dataset: { level: lvl } }), ` ${util.LEVELS[lvl].label} `, h('b', { class: 'num', text: fmt.ha(a[k]) }), h('span', { class: 'src-sub num', text: ` ${fmt.pct(100 * a[k] / sum)}` }))]),
        h('span', { class: 'src-op', attrs: { 'aria-hidden': 'true' }, text: '=' }),
        h('span', { class: 'src-lvitem' }, 'Profile total ', h('b', { class: 'num', text: fmt.ha(a.total) })));
    };
    select.addEventListener('change', draw);
    draw();
    const fh = figHead(2, 'One village, each hectare counted once');
    return h('figure', { class: 'src-fig src-lvfig', attrs: { 'aria-labelledby': fh.id } },
      fh.el,
      h('div', { class: 'field src-field' }, h('label', { attrs: { for: selId }, text: 'Village' }), select),
      bar, legend,
      h('figcaption', { class: 'caveat', text: 'The profile total is the village area joined with its grand cru land. Rounding to a tenth of a hectare can leave the sum a little off the total.' }));
  }

  /* ---------- White-wine flags on the mapped shapes ---------- */
  function whiteFigure(w, nApps, redApps, nRedClimats) {
    const capId = nextId('src-wf');
    const parts = [
      ['yes', w.yes, 'Allows white wine'],
      ['no', w.no, 'Does not allow white wine'],
      ['unknown', w.unknown, 'Not verified'],
    ].filter(([, n]) => n > 0);
    const bar = h('div', { class: 'src-wbar', attrs: { role: 'img', 'aria-labelledby': capId } },
      parts.map(([k, n]) => h('span', { class: `src-wseg ${k}`, style: { flexGrow: String(n) } })));
    const key = h('ul', { class: 'src-wkey' }, parts.map(([k, n, label]) => h('li', {},
      h('span', { class: `src-wsw ${k}`, attrs: { 'aria-hidden': 'true' } }),
      ` ${label} `, h('b', { class: 'num', text: fmt.num(n) }),
      h('span', { class: 'src-sub num', text: ` ${fmt.pct(100 * n / w.total)}` }))));
    const fh = figHead(5, 'The white-wine flag on every mapped shape');
    return h('figure', { class: 'src-fig src-wf', attrs: { 'aria-labelledby': fh.id } },
      fh.el,
      h('p', { id: capId, class: 'src-fig-cap' },
        `${fmt.num(w.yes)} of the ${fmt.num(w.total)} mapped shapes in this build allow white wine and ${fmt.num(w.no)} do not${w.unknown ? `, and ${fmt.num(w.unknown)} are not verified` : ''}.`),
      bar, key,
      redApps.length ? h('p', { class: 'caveat' }, `The village appellations flagged as not allowing white wine are ${listJoin(redApps)}.${nRedClimats ? ` Their ${fmt.num(nRedClimats)} premier cru climats carry the same flag.` : ''} ${fmt.num(nApps - redApps.length)} of the ${fmt.num(nApps)} village appellations on the map allow it.`) : null);
  }

  function rankList() {
    const order = ['grand-cru', 'premier-cru', 'village', 'regional', 'none'];
    const extra = { 'premier-cru': 'a named climat, else unnamed premier cru land' };
    return h('ol', { class: 'src-rank', attrs: { 'aria-label': 'Classification order, highest first' } },
      order.map(l => h('li', {}, h('span', { class: 'swatch', dataset: { level: l } }), ' ', util.LEVELS[l].label,
        extra[l] ? h('span', { class: 'src-sub', text: ` (${extra[l]})` }) : null)));
  }

  /* ---------- Fig. S.3 · aspect key (a diagram of the binning rule, no data) ---------- */
  function aspectKey() {
    const S = 272, c = S / 2, R = 94, r0 = 30, rT = R + 8, rL = R + 24;
    const capId = nextId('src-ak');
    const fh = figHead(3, 'How aspect is binned');
    const pt = (r, deg) => { const a = (deg - 90) * Math.PI / 180; return [c + r * Math.cos(a), c + r * Math.sin(a)]; };
    const svg = s('svg', { viewBox: `0 0 ${S} ${S}`, width: S, height: S, class: 'src-aspect', role: 'img', 'aria-labelledby': `${fh.id} ${capId}` });
    METHOD.sectors.forEach((lab, i) => {
      const a0 = i * 45 - 22.5, a1 = i * 45 + 22.5;
      const [x0, y0] = pt(R, a0), [x1, y1] = pt(R, a1), [x2, y2] = pt(r0, a1), [x3, y3] = pt(r0, a0);
      svg.append(s('path', { d: `M${x0},${y0} A${R},${R} 0 0 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 0 0 ${x3},${y3} Z`, class: `src-wedge ${i % 2 ? 'odd' : 'even'}` }));
      const [lx, ly] = pt((r0 + R) / 2 + 4, i * 45);
      svg.append(s('text', { x: lx, y: ly + 4, 'text-anchor': 'middle', class: 'src-ak-lab', text: lab }));
    });
    METHOD.labels16.forEach((lab, j) => {
      const deg = j * 22.5;
      const [ax, ay] = pt(R + 2, deg), [bx, by] = pt(rT, deg);
      svg.append(s('line', { x1: ax, y1: ay, x2: bx, y2: by, class: j % 2 ? 'src-tick' : 'src-tick major' }));
      const [tx, ty] = pt(rL - (j % 2 ? 0 : 2), deg);
      svg.append(s('text', { x: tx, y: ty + 3.5, 'text-anchor': 'middle', class: j % 4 === 0 ? 'src-ak-16 cardinal' : 'src-ak-16', text: lab }));
    });
    svg.append(s('circle', { cx: c, cy: c, r: r0, class: 'src-flat' }));
    svg.append(s('text', { x: c, y: c + 4, 'text-anchor': 'middle', class: 'src-ak-flat', text: `<${METHOD.flatDeg}°` }));
    const ranges = h('ul', { class: 'src-ak-list' },
      METHOD.sectors.map((lab, i) => {
        const lo = (i * 45 - 22.5 + 360) % 360, hi = i * 45 + 22.5;
        return h('li', {}, h('b', { class: 'mono', text: lab }), h('span', { class: 'num', text: ` ${fmt.num(lo, 1)}–${fmt.num(hi, 1)}°` }));
      }),
      h('li', { class: 'flat' }, h('b', { class: 'mono', text: 'flat' }), h('span', { text: ` slope under ${METHOD.flatDeg}°` })));
    return h('figure', { class: 'src-fig src-ak', attrs: { 'aria-labelledby': fh.id } },
      fh.el,
      h('div', { class: 'src-ak-grid' }, svg, ranges),
      h('figcaption', { id: capId },
        `The inner ring shows the ${METHOD.sectors.length} sectors of 45° used by every aspect rose, each centred on its compass point. The outer ticks mark the ${METHOD.labels16.length} points that name a mean bearing. Ground in the centre, flatter than ${METHOD.flatDeg}°, has no aspect.`));
  }

  /* ---------- Fig. S.4 · sampling window on a real cross-section ---------- */
  function transectFigure(T) {
    let cur = 0;
    let start = 0;
    let nWin = 30;
    const capId = nextId('src-tx');
    const group = h('div', { class: 'seg src-seg', attrs: { role: 'radiogroup', 'aria-label': 'Cross-section, named by its upslope anchor' } });
    const radios = T.map((t, i) => h('button', {
      type: 'button', text: t.anchors[0],
      attrs: { role: 'radio', 'aria-checked': String(i === 0), tabindex: i === 0 ? '0' : '-1', title: t.title },
      on: { click: () => choose(i, false) },
    }));
    group.append(...radios);
    group.addEventListener('keydown', e => {
      const k = e.key;
      let i = cur;
      if (k === 'ArrowRight' || k === 'ArrowDown') i = (cur + 1) % T.length;
      else if (k === 'ArrowLeft' || k === 'ArrowUp') i = (cur - 1 + T.length) % T.length;
      else if (k === 'Home') i = 0;
      else if (k === 'End') i = T.length - 1;
      else return;
      e.preventDefault();
      choose(i, true);
    });
    const rangeId = nextId('src-range');
    const range = h('input', { type: 'range', id: rangeId, class: 'src-range', attrs: { min: '0', step: '1', value: '0' } });
    const rangeLabel = h('label', { attrs: { for: rangeId }, text: 'Move the window along the section' });
    const plot = h('div', { class: 'src-tx-plot' });
    // Not a live region. The range's aria-valuetext already speaks the window on every step, and this
    // longer description is there to be read, not announced.
    const readout = h('p', { class: 'src-readout' });
    const title = h('p', { class: 'src-tx-title' });

    function choose(i, focus) {
      cur = i;
      radios.forEach((b, j) => { b.setAttribute('aria-checked', String(j === i)); b.tabIndex = j === i ? 0 : -1; });
      if (focus) radios[i].focus();
      start = 0;
      draw();
    }
    range.addEventListener('input', () => { start = +range.value; draw(); });

    const levelsOf = t => {
      const out = new Array(t.z.length).fill('none');
      const names = new Array(t.z.length).fill('');
      for (const sg of t.segments) {
        const k0 = Math.round(sg.from / t.step_m), k1 = Math.round(sg.to / t.step_m);
        for (let k = k0; k <= k1 && k < out.length; k++) { out[k] = sg.level; names[k] = sg.name; }
      }
      return { lv: out, nm: names };
    };
    const cache = new Map();

    function draw() {
      const t = T[cur];
      if (!cache.has(cur)) cache.set(cur, levelsOf(t));
      const { lv, nm } = cache.get(cur);
      const W = Math.max(280, Math.round(plot.clientWidth || 600));
      const padL = 44, padR = 12;
      const inner = W - padL - padR;
      nWin = Math.max(12, Math.min(41, Math.floor(inner / 16)));
      const maxStart = Math.max(0, t.z.length - nWin);
      start = Math.min(start, maxStart);
      range.max = String(maxStart);
      range.value = String(start);
      const end = Math.min(t.z.length - 1, start + nWin - 1);
      const step = t.step_m;
      const fromM = start * step, toM = end * step;
      range.setAttribute('aria-valuetext', `${fmt.num(fromM)} to ${fmt.num(toM)} m from the upslope end`);

      const ctxH = 46, gap = 26, detH = 150, band = 7, axisH = 22;
      const H = ctxH + gap + detH + band + axisH;
      const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'src-tx-svg', 'aria-hidden': 'true' });

      // Context strip: the whole profile, with the window marked.
      const [zmin, zmax] = t.z_range;
      const cx = k => padL + (k / (t.z.length - 1)) * inner;
      const cy = z => 6 + (1 - (z - zmin) / Math.max(1, zmax - zmin)) * (ctxH - 14);
      let d = '';
      t.z.forEach((z, k) => { d += `${k ? 'L' : 'M'}${cx(k).toFixed(1)},${cy(z).toFixed(1)}`; });
      svg.append(s('text', { x: padL - 6, y: 12, 'text-anchor': 'end', class: 'src-ax', text: fmt.num(zmax) }));
      svg.append(s('text', { x: padL - 6, y: ctxH - 6, 'text-anchor': 'end', class: 'src-ax', text: fmt.num(zmin) }));
      let k0 = 0;
      for (let k = 1; k <= lv.length; k++) {
        if (k === lv.length || lv[k] !== lv[k0]) {
          svg.append(s('rect', { x: cx(k0), y: ctxH - 4, width: Math.max(0.8, cx(Math.min(k, lv.length - 1)) - cx(k0)), height: 3, class: `src-lv lv-${lv[k0]}` }));
          k0 = k;
        }
      }
      svg.append(s('path', { d, class: 'src-ctx-line' }));
      const wx0 = cx(start), wx1 = cx(end);
      const win = s('rect', { x: wx0 - 1, y: 1, width: Math.max(3, wx1 - wx0 + 2), height: ctxH - 2, class: 'src-win' });
      svg.append(win);
      // Leader lines from the window to the detail panel.
      const dy0 = ctxH + gap;
      svg.append(s('path', { d: `M${wx0},${ctxH} L${padL},${dy0 - 4} M${wx1},${ctxH} L${W - padR},${dy0 - 4}`, class: 'src-leader' }));

      // Detail: every sample in the window.
      const zs = t.z.slice(start, end + 1);
      let lo = Math.min(...zs), hi = Math.max(...zs);
      if (hi - lo < 8) { const m = (hi + lo) / 2; lo = m - 4; hi = m + 4; }
      const padZ = (hi - lo) * 0.12;
      lo -= padZ; hi += padZ;
      const dx = k => padL + ((k - start) / Math.max(1, nWin - 1)) * inner;
      const dyz = z => dy0 + 8 + (1 - (z - lo) / (hi - lo)) * (detH - 20);
      const base = dy0 + detH;
      svg.append(s('rect', { x: padL - 1, y: dy0, width: inner + 2, height: detH, class: 'src-det-bg' }));
      svg.append(s('text', { x: padL - 6, y: dyz(Math.max(...zs)) + 3, 'text-anchor': 'end', class: 'src-ax', text: fmt.num(Math.max(...zs)) }));
      svg.append(s('text', { x: padL - 6, y: dyz(Math.min(...zs)) + 3, 'text-anchor': 'end', class: 'src-ax', text: fmt.num(Math.min(...zs)) }));
      svg.append(s('text', { x: 4, y: dy0 + 10, class: 'src-ax', text: 'm' }));
      const sp = inner / Math.max(1, nWin - 1);
      for (let k = start; k <= end; k++) {
        const x = dx(k), y = dyz(t.z[k]);
        svg.append(s('line', { x1: x, y1: y, x2: x, y2: base, class: 'src-stem' }));
        const bx0 = Math.max(padL, x - sp / 2), bx1 = Math.min(padL + inner, x + sp / 2 + 0.3);
        svg.append(s('rect', { x: bx0, y: base + 1, width: Math.max(0, bx1 - bx0), height: band, class: `src-lv lv-${lv[k]}` }));
      }
      let pd = '';
      for (let k = start; k <= end; k++) pd += `${k === start ? 'M' : 'L'}${dx(k).toFixed(1)},${dyz(t.z[k]).toFixed(1)}`;
      svg.append(s('path', { d: pd, class: 'src-det-line' }));
      for (let k = start; k <= end; k++) svg.append(s('circle', { cx: dx(k), cy: dyz(t.z[k]), r: 3.4, class: `src-sample lv-${lv[k]}` }));
      // Under the band: a dimension mark between the first two samples on the left, the window's
      // distance range on the right.
      const ay = base + band + 15;
      const mx0 = dx(start), mx1 = dx(start + 1), my = ay - 4;
      svg.append(s('path', { d: `M${mx0},${my - 4} V${my + 4} M${mx0},${my} H${mx1} M${mx1},${my - 4} V${my + 4}`, class: 'src-dim' }));
      svg.append(s('text', { x: mx1 + 5, y: ay, class: 'src-dim-t', text: `${fmt.num(step)} m` }));
      svg.append(s('text', { x: W - padR, y: ay, 'text-anchor': 'end', class: 'src-ax', text: `${fmt.mRange(fromM, toM)} from the upslope end` }));
      plot.replaceChildren(svg);

      // Context strip: click or drag to move the window.
      const moveTo = ev => {
        const r = plot.getBoundingClientRect();
        const x = (ev.clientX - r.left) * (W / r.width);
        const k = Math.round(((x - padL) / inner) * (t.z.length - 1) - nWin / 2);
        start = Math.max(0, Math.min(maxStart, k));
        draw();
      };
      svg.addEventListener('pointerdown', ev => {
        const r = plot.getBoundingClientRect();
        if ((ev.clientY - r.top) * (W / r.width) > ctxH + 4) return;
        ev.preventDefault();
        moveTo(ev);
        const mv = e2 => moveTo(e2);
        const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
        addEventListener('pointermove', mv);
        addEventListener('pointerup', up);
        addEventListener('pointercancel', up);
      });

      // Text: what the window shows.
      const names = [];
      for (let k = start; k <= end; k++) {
        const label = lv[k] === 'none' ? 'outside any appellation' : lv[k] === 'regional' ? `regional ${nm[k] || 'Bourgogne'}` : nm[k] || util.LEVELS[lv[k]].label;
        if (!names.includes(label)) names.push(label);
      }
      title.replaceChildren(h('b', { text: t.title }), h('span', { class: 'src-sub', text: ` · ${fmt.num(t.z.length)} samples over ${fmt.num(t.length_m)} m` }));
      readout.textContent = `The window holds samples ${fmt.num(start + 1)} to ${fmt.num(end + 1)}, from ${fmt.num(fromM)} to ${fmt.num(toM)} m along the section. Its first sample lies ${fmt.m(t.z[start])} above sea level and its last ${fmt.m(t.z[end])}. The ground under it is classed as ${listJoin(names)}.`;
    }

    const fh = figHead(4, 'One cross-section, sample by sample');
    const fig = h('figure', { class: 'src-fig src-tx', attrs: { 'aria-labelledby': fh.id, 'aria-describedby': capId } },
      fh.el,
      h('p', { id: capId, class: 'src-fig-cap', text: `Every dot is one sample, ${fmt.num(T[0].step_m)} m apart, coloured by the classification of the ground beneath it.` }),
      group, title, plot,
      h('div', { class: 'field src-range-field' }, rangeLabel, range),
      readout);
    // Draw once the element has a width, and again on resize.
    const ro = new ResizeObserver(util.debounce(() => draw(), 120));
    requestAnimationFrame(() => { draw(); ro.observe(plot); });
    return fig;
  }

  /* ---------- Climate index table with a season timeline ---------- */
  function doy(d, mon) { const mi = MONTHS.indexOf(mon); return MONTH_DAYS.slice(0, mi).reduce((a, b) => a + b, 0) + d; }
  function indexTable(clim) {
    const A0 = doy(1, 'Mar'), A1 = doy(30, 'Nov') + 1;
    const pos = v => `${(100 * (v - A0) / (A1 - A0)).toFixed(3)}%`;
    const months = MONTHS.slice(2, 11);
    const axis = h('div', { class: 'src-cal-axis', attrs: { 'aria-hidden': 'true' } },
      months.map(mo => h('span', { style: { left: pos(doy(1, mo)) }, text: mo })));
    const rows = Object.entries(clim.indices).map(([key, ix]) => {
      const m = /(\d+) (\w{3}) to (\d+) (\w{3})/.exec(ix.period || '');
      const bar = h('div', { class: 'src-cal', attrs: { 'aria-hidden': 'true' } },
        months.map(mo => h('i', { style: { left: pos(doy(1, mo)) } })),
        m ? h('span', { class: 'src-cal-bar', style: { left: pos(doy(+m[1], m[2])), width: `${(100 * (doy(+m[3], m[4]) + 1 - doy(+m[1], m[2])) / (A1 - A0)).toFixed(3)}%` } }) : null);
      return h('tr', {},
        h('th', { attrs: { scope: 'row' } }, h('span', { class: 'src-ix-label', text: ix.label }), h('span', { class: 'mono src-sub src-ix-key', text: key })),
        h('td', { class: 'src-ix-when' }, bar, h('span', { class: 'src-ix-period', text: ix.period })),
        h('td', { class: 'src-ix-def', text: ix.definition || '' }),
        h('td', { class: 'mono src-ix-unit', text: ix.unit }));
    });
    const table = h('table', { class: 'src-table src-ix' },
      h('caption', {}, h('span', { class: 'src-fig-no', text: 'Table S.1' }), ' The climate indices, when in the year each is measured, and how.'),
      h('thead', {}, h('tr', {},
        h('th', { attrs: { scope: 'col' }, text: 'Index' }),
        h('th', { attrs: { scope: 'col' }, class: 'src-ix-when' }, h('span', { class: 'visually-hidden', text: 'Period' }), axis),
        h('th', { attrs: { scope: 'col' }, text: 'Definition' }),
        h('th', { attrs: { scope: 'col' }, text: 'Unit' }))),
      h('tbody', {}, rows));
    return h('div', { class: 'src-ix-wrap' }, table);
  }

  function sitesTable(clim) {
    const ll = (lat, lng) => h('span', { class: 'src-llw' }, h('span', { class: 'src-ll', text: `${c4.format(lat)}° N` }), h('span', { class: 'src-ll', text: `${c4.format(lng)}° E` }));
    const cols = ['Site', 'Region', 'Commune centre', 'ERA5-Land grid point', 'Model height'];
    const table = h('table', { class: 'src-table num-table src-sites' },
      h('caption', {}, h('span', { class: 'src-fig-no', text: 'Table S.2' }), ' The climate sites, the ERA5-Land grid point Open-Meteo returned for each, and the height of the point in Open-Meteo’s 90 m elevation model.'),
      h('thead', {}, h('tr', {}, cols.map((t, j) => h('th', { attrs: { scope: 'col' }, class: j === 4 ? 'r' : '', text: t })))),
      h('tbody', {}, clim.sites.map(x => h('tr', {},
        h('th', { attrs: { scope: 'row' } }, h('span', { class: 'src-site', text: x.name }), h('span', { class: 'src-site-region', text: x.region })),
        h('td', { class: 'src-site-reg', dataset: { label: cols[1] }, text: x.region }),
        h('td', { class: 'num', dataset: { label: cols[2] } }, ll(x.lat, x.lng)),
        h('td', { class: 'num', dataset: { label: cols[3] } }, ll(x.grid_lat, x.grid_lng)),
        h('td', { class: 'r num', dataset: { label: cols[4] }, text: fmt.m(x.grid_elevation) })))));
    return scroller('src-scroll src-sites-wrap', 'Climate sites', table);
  }

  function attributionLink(html) {
    const m = /href="([^"]+)"[^>]*>([^<]+)</.exec(html || '');
    return m ? h('p', { class: 'src-attr' }, ext(m[1], m[2])) : null;
  }

  function citations(clim) {
    const cites = (clim.meta && clim.meta.citation) || [];
    if (!cites.length) return null;
    const link = str => {
      const m = /(https:\/\/doi\.org\/\S+)$/.exec(str);
      return m ? [str.slice(0, m.index), ext(m[1], m[1].replace('https://doi.org/', 'doi:'), 'mono')] : str;
    };
    // Where a reference names a dataset differently from the catalogue title kept in the
    // bibliography (matched by DOI), say so next to it.
    const parts = sources.flatMap(x => x.parts || []).filter(p => p.doi);
    const om = byId.get('open-meteo');
    const omQuotes = ((om && om.notes) || []).map(n => n.quote).filter(Boolean);
    const diffs = [];
    cites.forEach(c => {
      const m = /doi\.org\/(\S+)$/i.exec(c);
      const p = m && parts.find(x => x.doi.toLowerCase() === m[1].toLowerCase());
      if (!p || c.includes(p.name)) return;
      const short = p.name.split(' hourly')[0];
      diffs.push(h('p', { class: 'caveat src-cite-note' },
        omQuotes.includes(c) ? `The ${short} reference is worded as Open-Meteo suggests it. ` : '',
        'The ', ext(p.url, 'Climate Data Store'), ` lists the same DOI under the title “${p.name}”, which the bibliography uses.`));
    });
    const k = clim.meta.huglin_k_source;
    return h('div', { class: 'src-cite' },
      h('p', { class: 'eyebrow', text: 'Cite the climate data' }),
      h('ul', {}, cites.map(c => h('li', {}, link(c))),
        k && k.document ? h('li', {}, `${k.document}. `, ext(k.url, host(k.url), 'mono')) : null),
      diffs,
      attributionLink(clim.meta.attribution_html));
  }

  /* ================= III. Known limits ================= */
  function renderLimits(idx, vil, clim, errBox) {
    const groups = [];
    let n = 0;
    const item = (text, tag, tagHref, extra) => h('li', { class: 'src-limit' },
      h('span', { class: 'src-limit-no display-num', attrs: { 'aria-hidden': 'true' }, text: String(++n) }),
      h('div', {}, text instanceof Node ? text : h('p', {}, text), extra || null,
        h('p', { class: 'src-limit-src' }, tagHref ? ext(tagHref, tag) : tag)));
    const original = (quote, lang, label) => h('details', { class: 'disclosure src-orig' },
      h('summary', { text: label || (lang === 'fr' ? 'Read the French original' : 'Read the original') }), h('p', { attrs: { lang }, text: quote }));

    // Parcel data
    const parcel = [];
    const inao = byId.get('inao');
    const notice = inao && (inao.notes || []).find(x => x.label === 'INAO notice');
    if (notice) parcel.push(item(notice.translation, 'INAO, on data.gouv.fr, translated', notice.source, original(notice.quote, notice.lang)));
    if (idx) {
      // The caveat from data/README.md, with the climat count read from index.json. The clause
      // about the commune of Chablis is the README's. It is checked against the Chablis region file
      // only if another plate has already loaded that file, so this part never downloads it.
      const nChab = idx.features.filter(f => f.kind === 'climat' && f.region === 'chablis').length;
      const para = h('p');
      const write = outside => para.replaceChildren(`INAO’s digital delimitation does not yet name every climat. In Chablis only ${fmt.num(nChab)} premier cru climats are digitised by name${outside ? ', all outside the commune of Chablis itself' : ''}. Several climat names nest (Morgeot contains Les Brussonnes, La Boudriotte, etc.) and some ground carries two names (Meursault premier cru Blagny and Blagny premier cru are the same land, for white and red wine respectively).`);
      write(true);
      parcel.push(item(para, 'data/README.md', 'data/README.md'));
      const file = new URL('data/terroir-chablis.geojson', location.href).href;
      const verify = () => data.region('chablis').then(g => {
        const cl = g.features.filter(f => f.properties.kind === 'climat');
        write(cl.length > 0 && cl.every(f => !(f.properties.communes || []).some(c => c === 'Chablis' || c === '89068')));
      }).catch(() => {});
      if ('PerformanceObserver' in window) {
        try {
          const po = new PerformanceObserver(list => {
            if (list.getEntries().some(e => e.name === file)) { po.disconnect(); verify(); }
          });
          po.observe({ type: 'resource', buffered: true });
        } catch { /* the check stays optional */ }
      }
    }
    if (vil) {
      const planted = (vil.notes || []).find(x => /planted vineyard/.test(x));
      if (planted) parcel.push(item(planted, 'data/villages.json', 'data/villages.json'));
    }
    groups.push(['The parcel data', parcel, 0]);

    // The fact-check behind the white-wine flags
    const check = [];
    const cdc = byId.get('inao-cdc');
    const fc = cdc && cdc.fact_check;
    const note = label => cdc && (cdc.notes || []).find(x => x.label === label);
    const draft = note('Draft status');
    if (fc && draft) {
      const years = [fc.drafts_2010 ? `${fmt.num(fc.drafts_2010)} dated 2010` : null, fc.drafts_2016 ? `${fmt.num(fc.drafts_2016)} dated 2016` : null].filter(Boolean);
      check.push(item(`The ${fmt.num(fc.files)} cahier files read by the fact-check are drafts that INAO published for a national opposition procedure${years.length ? `, ${listJoin(years)}` : ''}. Each opens with a warning that it does not prejudge the final wording.`,
        'INAO cahier des charges, translated', draft.source,
        [h('p', { class: 'src-limit-q', text: `“${draft.translation}”` }), original(draft.quote, draft.lang)]));
    }
    const f = fc && fc.in_force;
    const example = note('A text in force');
    if (f) check.push(item(`On ${date(f.checked)}, the INAO product pages of ${f.later_text_listed === f.pages ? `all ${fmt.num(f.pages)}` : `${fmt.num(f.later_text_listed)} of the ${fmt.num(f.pages)}`} appellations listed a cahier published later than the draft, between ${f.first_year} and ${f.last_year}.`,
      'INAO product pages', f.source,
      example ? [h('p', { class: 'src-limit-q', text: `For Chablis, “${example.translation}”` }), original(example.quote, example.lang, 'Read the Chablis entry in French')] : null));
    const recheck = inForceText(fc, idx);
    if (recheck) check.push(item(recheck, fc.record));
    const legal = note('Legal value');
    if (legal) check.push(item('An INAO product page adds that only the texts published in the Journal officiel have legal value.', 'INAO, translated', legal.source, original(legal.quote, legal.lang)));
    if (fc && fc.special_rules) check.push(item(`The white-wine flag is set once for each appellation. The fact-check record also holds ${fmt.num(fc.special_rules)} special rules quoted from the cahiers, which the build does not apply.`, fc.record));
    if (idx) {
      const w = whiteTally(idx);
      if (w.unknown) check.push(item(`${fmt.num(w.unknown)} of ${fmt.num(w.total)} mapped shapes carry no verified white-wine flag in this build. The data files leave their flag empty, which means not verified.`, 'data/README.md', 'data/README.md'));
    }
    groups.push(['The fact-check', check, 0]);

    // Terrain and geology
    const terr = [];
    const ign = byId.get('ign-basemaps');
    const shade = ign && (ign.notes || []).find(x => x.label === 'Display only');
    if (shade) terr.push(item(shade.text, 'This atlas, from 02_terrain.py'));
    const brgm = byId.get('brgm');
    const scale = brgm && (brgm.notes || []).find(x => x.label === 'Scale warning');
    if (scale) terr.push(item(scale.translation, 'BRGM, translated', scale.source, original(scale.quote, scale.lang)));
    groups.push(['The terrain and geology layers', terr, 1]);

    // Climate. Field names are set as code, and the one Table S.2 shows gets a pointer to it.
    if (clim && clim.meta && clim.meta.caveats) {
      groups.push(['The climate record', clim.meta.caveats.map(c => item(
        h('p', {}, codeify(c), /\bgrid_elevation\b/.test(c) ? ' It is the Model height column of Table S.2.' : ''),
        'data/climate.json', 'data/climate.json')), 1]);
    }

    counts[2].textContent = n;
    // Plain groups under a heading. Only the four parts of the plate are named regions.
    const col = c => h('div', { class: 'src-limit-col' }, groups.filter(([, items, k]) => items.length && k === c).map(([title, items]) =>
      h('div', { class: 'src-limit-group' }, h('h4', { text: title }), h('ol', {}, items))));
    bLimits.append(
      h('p', { class: 'src-intro', text: 'The limits the build itself records, plus the notices of the data publishers. Each keeps its source.' }),
      ...[errBox, h('div', { class: 'src-limits' }, col(0), col(1))].filter(Boolean));
    return groups.filter(([, items]) => items.length).map(([title]) => title);
  }

  /* ================= IV. Rebuild ================= */
  function renderRebuild() {
    // The INAO file to fetch before step 01, as listed in data/sources.json and scripts/README.md.
    const inao = byId.get('inao');
    const zip = inao && inao.download;
    // The long URL is broken after slashes with backslash-newline, which POSIX shells remove
    // inside double quotes, so the block stays readable and still runs as pasted.
    const wrapUrl = (url, max = 52) => url.split(/(?<=\/)/).reduce((lines, part) => {
      const last = lines.length - 1;
      if (lines[last].length + part.length > max && lines[last].length > 10) lines.push(part); else lines[last] += part;
      return lines;
    }, ['']).join('\\\n');
    const cmd = ['python3 -m venv .venv', '.venv/bin/pip install -r scripts/requirements.txt',
      ...(zip ? ['mkdir -p data/raw/inao', `curl -L -o data/raw/delim.zip \\\n  "${wrapUrl(zip)}"`, 'unzip data/raw/delim.zip -d data/raw/inao'] : []),
      ...STEPS.map(x => `.venv/bin/python scripts/${x.script}`)].join('\n');
    const status = h('span', { class: 'src-copy-status', attrs: { role: 'status', 'aria-live': 'polite' } });
    const copyBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Copy the commands' });
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(cmd);
        status.textContent = 'Copied.';
      } catch {
        const range = document.createRange();
        range.selectNodeContents(pre);
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
        status.textContent = 'Selected. Press Ctrl+C or Cmd+C to copy.';
      }
      setTimeout(() => { status.textContent = ''; }, 3000);
    });
    const pre = h('pre', { class: 'src-cmd', dataset: { scrollLabel: 'Commands, in order' } }, h('code', { text: cmd }));
    if (scrollRO) scrollRO.observe(pre);
    const list = h('ol', { class: 'src-pipe' }, STEPS.map(x => h('li', {},
      h('div', { class: 'src-pipe-head' },
        h('span', { class: 'src-pipe-no display-num', attrs: { 'aria-hidden': 'true' }, text: x.script.slice(0, 2) }),
        h('code', { class: 'src-pipe-name', text: x.script }),
        x.needs.length ? h('span', { class: 'src-sub', text: `after ${x.needs.join(', ')}` }) : h('span', { class: 'src-sub', text: 'no prerequisite step' })),
      h('p', { text: x.line }),
      h('div', { class: 'src-io' },
        h('span', { class: 'src-io-k', text: 'Reads' }), h('span', { class: 'src-io-v' }, x.reads.map(r => h('code', { text: r }))),
        h('span', { class: 'src-io-k', text: 'Writes' }), h('span', { class: 'src-io-v' }, x.writes.map(r => h('code', { text: r })))))));
    bRebuild.append(
      h('p', { class: 'src-intro' }, `The build is ${fmt.num(STEPS.length)} Python scripts, run in order from the repository root with the project virtual environment. They need geopandas, shapely, pyogrio, pyproj, numpy, pandas, requests and matplotlib, as listed in `, h('code', { text: 'scripts/requirements.txt' }), '.'),
      h('div', { class: 'src-rebuild' },
        list,
        h('div', { class: 'src-rebuild-side' },
          h('div', { class: 'src-cmd-bar' }, h('p', { class: 'eyebrow', text: 'In the terminal' }), copyBtn),
          pre, status,
          h('p', { class: 'note' }, zip ? ['The commands before step 01 download the INAO shapefile from data.gouv.fr', inao.download_bytes ? `, ${fmt.num(inao.download_bytes / 1e6)} MB,` : '', ' and unzip it into ', h('code', { text: 'data/raw/inao/' }), '.'] : ['Before step 01, unzip the INAO shapefile from data.gouv.fr into ', h('code', { text: 'data/raw/inao/' }), '.'], ' Step 03 takes commune names from ', h('code', { text: 'data/raw/geoapi/communes_*.json' }), ', lists saved from geo.api.gouv.fr that no script downloads. Without them the commune fields hold INSEE codes instead of names.'),
          h('p', { class: 'caveat', text: 'Steps 02, 04 and 06 call remote services and cache what they receive, so later runs read the cache instead of the network.' }))));
  }
}
