// Plate V: the village finder.
// Four questions, one at a time. Each answer adds the points that a village's curated
// profile assigns to that option (data/villages.json -> quiz). Ties are broken by how
// close the village's editorial flavour scores sit to a target implied by the style
// answer, then alphabetically. The result is shareable as ?finder=0-1-2-3.

const QUESTIONS = [
  {
    key: 'style', label: 'Style', title: 'What white wine style do you reach for?',
    options: [
      { label: 'Mineral & Crisp', desc: 'Steely, citrus-driven, clean finish' },
      { label: 'Rich & Buttery', desc: 'Golden, oaky, generous mouthfeel' },
      { label: 'Balanced & Textured', desc: 'Best of both worlds, with nuance' },
    ],
  },
  {
    key: 'budget', label: 'Budget', title: 'What’s your budget per bottle?',
    options: [
      { label: 'Everyday', price: '$15–30', desc: 'Reliable quality for regular drinking' },
      { label: 'Weekend', price: '$30–60', desc: 'Something special for a nice dinner' },
      { label: 'Splurge', price: '$60+', desc: 'Celebration-worthy or collector territory' },
    ],
  },
  {
    key: 'food', label: 'Food', title: 'What food will you be pairing?',
    options: [
      { label: 'Seafood', desc: 'Oysters, fish, shellfish, sushi' },
      { label: 'Comfort Food', desc: 'Roast chicken, pasta, creamy dishes' },
      { label: 'Cheese Board', desc: 'Aged, soft, or blue cheeses' },
      { label: 'Just Wine', desc: 'Sipping on its own, aperitif style' },
    ],
  },
  {
    key: 'level', label: 'Experience', title: 'How deep is your Burgundy experience?',
    options: [
      { label: 'Beginner', desc: 'New to Burgundy, want something approachable' },
      { label: 'Intermediate', desc: 'Know the basics, ready to explore' },
      { label: 'Advanced', desc: 'Familiar with terroir, seeking complexity' },
    ],
  },
];

// Tie-break targets on the editorial flavour axes, one per style answer.
// Axes a target leaves out do not count towards the distance.
const TARGETS = [
  { mineral: 100, citrus: 100, oak: 0 },
  { oak: 100, body: 100 },
  { mineral: 50, citrus: 50, oak: 50, body: 50 },
];

const ORDINAL = ['First', 'Second', 'Third'];
const CLOSEST = ['Closest', 'Second closest', 'Third closest'];
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen'];
const word = n => WORDS[n] || String(n);
const cap = str => str.charAt(0).toUpperCase() + str.slice(1);
const LETTERS = 'ABCD';

/** "A", "A and B", "A, B and C" (or "A, B or C" with conj 'or') */
function listJoin(items, conj = 'and') {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${conj} ${items[items.length - 1]}`;
}

export async function init(mount, ctx) {
  const { bus, data, util } = ctx;
  const { h, s, fmt, LEVELS } = util;

  const raw = await data.villages();
  const villages = (raw.villages || []).filter(v => v && v.quiz && v.flavor);
  if (!villages.length) throw new Error('no village profiles with finder weights');

  /* ---------- Derived constants, all from the data ---------- */
  const AXES = Object.keys(villages[0].flavor);
  const perQ = QUESTIONS.map(q => Math.max(...villages.flatMap(v => v.quiz[q.key] || [0])));
  const minW = Math.min(...villages.flatMap(v => QUESTIONS.flatMap(q => v.quiz[q.key] || [0])));
  const MAX = perQ.reduce((a, b) => a + b, 0);
  const N = villages.length;
  const regionOf = v => v.regionName || util.regionName(v.region);
  // Price bands as written in the profiles ("$$-$$$$"), shown with an en dash.
  const band = str => String(str || '').replace(/-/g, '–');
  const bandLens = villages.flatMap(v => String(v.priceRange || '').split('-')).map(x => x.trim().length).filter(Boolean);

  /* ---------- State ---------- */
  const state = { answers: [null, null, null, null], step: 0, view: 'quiz' };
  const complete = () => state.answers.every(a => a != null);
  const code = () => state.answers.join('-');

  /* ---------- Scoring ---------- */
  function distance(v, t) {
    const keys = Object.keys(t).filter(k => typeof v.flavor[k] === 'number');
    if (!keys.length) return 0;
    return Math.sqrt(keys.reduce((a, k) => a + (v.flavor[k] - t[k]) ** 2, 0) / keys.length);
  }
  function score(answers) {
    const target = answers[0] == null ? null : TARGETS[answers[0]];
    return villages.map(v => {
      const parts = QUESTIONS.map((q, i) => answers[i] == null ? null : ((v.quiz[q.key] || [])[answers[i]] ?? 0));
      const total = parts.reduce((a, p) => a + (p || 0), 0);
      return { v, parts, total, dist: target ? distance(v, target) : null, name: v.name };
    }).sort((a, b) => (b.total - a.total) || ((a.dist ?? 0) - (b.dist ?? 0)) || a.name.localeCompare(b.name, 'fr'))
      .map((r, i) => Object.assign(r, { rank: i + 1 }));
  }

  /* ---------- Skeleton ---------- */
  const live = h('p', { class: 'visually-hidden', attrs: { role: 'status', 'aria-live': 'polite' } });
  const announce = msg => { live.textContent = ''; requestAnimationFrame(() => { live.textContent = msg; }); };

  const stepsEl = h('ol', { class: 'fd-steps', attrs: { 'aria-label': 'Your answers' } });
  const formHost = h('div', { class: 'fd-form-host' });
  const tally = buildTally();
  const stage = h('div', { class: 'fd-stage' }, formHost, tally.el);
  const results = h('div', { class: 'fd-results', attrs: { hidden: true } });
  const root = h('div', { class: 'fd', dataset: { view: 'quiz' } }, stepsEl, stage, results, live);
  mount.replaceChildren(root);

  /* ---------- Progress ledger (doubles as the answer summary) ---------- */
  function renderSteps() {
    stepsEl.replaceChildren(...QUESTIONS.map((q, i) => {
      const a = state.answers[i];
      const opt = a == null ? null : q.options[a];
      const current = state.view === 'quiz' && i === state.step;
      const inner = [
        h('span', { class: 'fd-step-no', attrs: { 'aria-hidden': 'true' } },
          String(i + 1).padStart(2, '0'), opt ? checkIcon() : null),
        h('span', { class: 'fd-step-label', text: q.label }),
        h('span', { class: 'fd-step-answer' + (opt ? '' : ' is-empty') },
          opt ? [labelNodes(opt.label), opt.price ? h('span', { class: 'fd-step-price', text: ` ${opt.price}` }) : null] : 'Not answered yet'),
      ];
      const canJump = opt && !current;
      const body = canJump
        ? h('button', {
          class: 'fd-step-btn', attrs: { type: 'button' },
          on: { click: () => goTo(i, true) },
        }, h('span', { class: 'visually-hidden', text: 'Change ' }), inner)
        : h('div', { class: 'fd-step-btn' }, inner);
      return h('li', {
        class: 'fd-step' + (opt ? ' is-done' : ''),
        attrs: { 'aria-current': current ? 'step' : null },
      }, body);
    }));
  }

  // Render an option label with a styled ampersand.
  function labelNodes(label) {
    const parts = label.split('&');
    if (parts.length === 1) return label;
    return [parts[0], h('span', { class: 'fd-amp', text: '&' }), parts[1]];
  }

  /* ---------- One question ---------- */
  function renderQuestion({ focus = false, scroll = false } = {}) {
    const i = state.step;
    const q = QUESTIONS[i];
    const qid = `fd-q-${q.key}`;
    const last = i === QUESTIONS.length - 1;
    const n = q.options.length;

    const heading = h('h3', { class: 'fd-q', id: qid, attrs: { tabindex: '-1' }, text: q.title });
    const radios = [];
    const opts = h('div', { class: 'fd-options', dataset: { count: String(n) } },
      q.options.map((o, oi) => {
        const input = h('input', {
          class: 'fd-radio',
          attrs: {
            type: 'radio', name: `fd-${q.key}`, value: String(oi), id: `fd-${q.key}-${oi}`,
            'aria-labelledby': o.price ? `fd-${q.key}-${oi}-l fd-${q.key}-${oi}-p` : `fd-${q.key}-${oi}-l`,
            'aria-describedby': `fd-${q.key}-${oi}-d`,
          },
          checked: state.answers[i] === oi,
        });
        radios.push(input);
        return h('label', { class: 'fd-opt' + (state.answers[i] === oi ? ' is-checked' : ''), attrs: { for: `fd-${q.key}-${oi}` } },
          input,
          h('span', { class: 'fd-opt-top', attrs: { 'aria-hidden': 'true' } },
            h('span', { class: 'fd-opt-key', text: LETTERS[oi] }),
            h('span', { class: 'fd-opt-mark' })),
          h('span', { class: 'fd-opt-label', id: `fd-${q.key}-${oi}-l` }, labelNodes(o.label)),
          o.price ? h('span', { class: 'fd-opt-price num', id: `fd-${q.key}-${oi}-p`, text: o.price }) : null,
          h('span', { class: 'fd-opt-desc', id: `fd-${q.key}-${oi}-d`, text: o.desc }));
      }));

    const keysHint = h('p', { class: 'caveat fd-keys' },
      'Press ', h('kbd', { text: LETTERS[0] }), ' to ', h('kbd', { text: LETTERS[n - 1] }),
      ' to choose. ', h('kbd', { text: 'Enter' }), ' moves on.');
    const hint = h('p', { class: 'fd-hint', attrs: { id: 'fd-hint', 'aria-live': 'polite' } });
    const back = h('button', {
      class: 'btn btn-ghost fd-back', attrs: { type: 'button', hidden: i === 0 },
      on: { click: () => goTo(i - 1, true) },
    }, h('span', { attrs: { 'aria-hidden': 'true' }, text: '←' }), 'Back');
    const next = h('button', { class: 'btn fd-next', attrs: { type: 'submit' } },
      last ? 'See my villages' : 'Next', h('span', { attrs: { 'aria-hidden': 'true' }, text: '→' }));
    const toResults = (!last && complete())
      ? h('button', { class: 'link-btn fd-to-results', attrs: { type: 'button' }, on: { click: () => showResults(true) } }, 'Skip to results')
      : null;

    const syncNext = () => {
      const has = state.answers[i] != null;
      next.setAttribute('aria-disabled', String(!has));
      if (has) hint.textContent = '';
    };
    const choose = oi => {
      const r = radios[oi];
      if (!r) return;
      r.checked = true;
      r.focus();
      r.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const form = h('form', {
      class: 'fd-form', attrs: { novalidate: true, 'aria-labelledby': qid },
      on: {
        submit: e => {
          e.preventDefault();
          if (state.answers[i] == null) {
            hint.textContent = 'Choose one answer to continue.';
            radios[0]?.focus();
            return;
          }
          if (last) showResults(true); else goTo(i + 1, true);
        },
        change: e => {
          if (!e.target.classList.contains('fd-radio')) return;
          state.answers[i] = Number(e.target.value);
          opts.querySelectorAll('.fd-opt').forEach(l => l.classList.toggle('is-checked', l.contains(e.target)));
          // Keep the shareable link in step with the answers as they change.
          util.setParam('finder', complete() ? code() : null);
          syncNext();
          renderSteps();
          updateTally();
        },
        keydown: e => {
          if (e.altKey || e.ctrlKey || e.metaKey) return;
          // Enter on a chosen radio moves on, like pressing Next.
          if (e.key === 'Enter' && e.target.classList.contains('fd-radio')) {
            e.preventDefault();
            form.requestSubmit ? form.requestSubmit(next) : next.click();
            return;
          }
          // A to D (or 1 to 4) pick the matching answer while focus is in the question.
          if (e.key.length !== 1) return;
          const k = e.key.toUpperCase();
          const oi = /[1-9]/.test(k) ? Number(k) - 1 : LETTERS.indexOf(k);
          if (oi >= 0 && oi < n) { e.preventDefault(); choose(oi); }
        },
      },
    },
    h('fieldset', { class: 'fd-fieldset' },
      h('legend', { class: 'fd-legend' },
        h('span', { class: 'eyebrow fd-q-no', attrs: { 'aria-hidden': 'true' }, text: `Question ${i + 1} of ${QUESTIONS.length}` }),
        heading),
      opts),
    keysHint,
    h('div', { class: 'fd-nav' }, back, toResults, next, hint),
    h('p', { class: 'note fd-howto' },
      `Each answer gives every village between ${minW} and ${Math.max(...perQ)} points, as set in its curated profile. The running tally shows every village as you choose, and the results show the arithmetic.`));

    syncNext();
    formHost.replaceChildren(form);
    if (focus) focusEl(heading, stepsEl, scroll);
  }

  /* ---------- Running tally ---------- */
  // Each row is a fixed scale of MAX points. The points from each answered question form
  // one run, and a surface gap separates one question's run from the next.
  function buildTally() {
    const rows = new Map();
    const body = h('div', { class: 'fd-tally-body' });
    const groups = new Map();
    // Within a region, north to south by the latitude of the village's map marker, as on the villages plate.
    const byLat = [...villages].sort((a, b) => (b.marker?.[0] ?? 0) - (a.marker?.[0] ?? 0));
    for (const v of byLat) {
      if (!groups.has(v.region)) groups.set(v.region, []);
      groups.get(v.region).push(v);
    }
    const order = util.REGIONS.map(r => r.id).filter(id => groups.has(id))
      .concat([...groups.keys()].filter(id => !util.REGIONS.some(r => r.id === id)));
    for (const rid of order) {
      const vs = groups.get(rid);
      const list = h('ul', { class: 'fd-tally-list', attrs: { role: 'list' } });
      for (const v of vs) {
        const segs = QUESTIONS.map(() => h('span', { class: 'fd-seg' }));
        const track = h('span', { class: 'fd-track', attrs: { 'aria-hidden': 'true' } },
          Array.from({ length: MAX }, () => h('span', { class: 'fd-cell' })), segs);
        const rankEl = h('span', { class: 'fd-t-rank num', attrs: { 'aria-hidden': 'true' } });
        const totalEl = h('span', { class: 'fd-t-total num' });
        const srEl = h('span', { class: 'visually-hidden' });
        const li = h('li', { class: 'fd-t-row' },
          rankEl,
          h('span', { class: 'fd-t-name', text: v.name }),
          track, totalEl, srEl);
        li.addEventListener('pointerenter', evt => rowTip.enter(evt, v));
        li.addEventListener('pointermove', evt => rowTip.move(evt, v));
        li.addEventListener('pointerleave', () => rowTip.leave());
        rows.set(v.id, { li, segs, rankEl, totalEl, srEl });
        list.append(li);
      }
      body.append(h('div', { class: 'fd-tally-group' },
        h('p', { class: 'fd-tally-region', text: regionOf(vs[0]) }), list));
    }
    const caption = h('p', { class: 'caption fd-tally-cap' });
    const key = h('p', { class: 'fd-tally-key', attrs: { 'aria-hidden': 'true' } },
      h('span', { class: 'fd-k' }, h('span', { class: 'fd-k-mark fd-k-on' }), 'Earlier answers'),
      h('span', { class: 'fd-k' }, h('span', { class: 'fd-k-mark fd-k-cur' }), 'This question'),
      h('span', { class: 'fd-k' }, h('span', { class: 'fd-k-mark fd-k-empty' }), 'Not earned'));
    const foot = h('p', { class: 'caveat fd-tally-foot' });
    const el = h('figure', { class: 'fd-tally', attrs: { 'aria-labelledby': 'fd-tally-title' } },
      h('figcaption', {},
        h('div', { class: 'fig-head' },
          h('p', { class: 'fig-no', text: 'Fig. V.1' }),
          h('h3', { id: 'fd-tally-title', text: 'Running tally' })),
        caption, key),
      body,
      foot);
    return { el, rows, caption, foot };
  }

  // Hover detail for a tally row. The shared tooltip is visual only (aria-hidden), so the
  // finder announces nothing through it. Everything it shows, the total and the points from
  // each answered question, is also in the row's own text (srEl, set in updateTally).
  // Content is set once per row, then only repositioned as the pointer moves.
  const rowTip = (() => {
    let cur = null;
    const tipEl = () => document.querySelector('body > .tip');
    const place = evt => {
      const t = tipEl();
      if (!t) return;
      const pad = 14, r = t.getBoundingClientRect();
      let x = evt.clientX + pad, y = evt.clientY + pad;
      if (x + r.width > innerWidth - 8) x = evt.clientX - r.width - pad;
      if (y + r.height > innerHeight - 8) y = evt.clientY - r.height - pad;
      t.style.left = `${Math.max(8, x)}px`; t.style.top = `${Math.max(8, y)}px`;
    };
    return {
      enter(evt, v) {
        if (evt.pointerType === 'touch') return;
        const r = score(state.answers).find(x => x.v === v);
        if (!r) return;
        cur = v;
        const answered = QUESTIONS.map((q, i) => r.parts[i] == null ? null : `${q.label} +${r.parts[i]}`).filter(Boolean);
        util.tip.show(evt, h('span', {},
          h('b', { text: `${r.total} of ${MAX}` }), ` · ${r.name}`, h('br'),
          answered.length ? answered.join(', ') : 'No answers yet'));
      },
      move(evt, v) { if (cur === v) place(evt); },
      leave() { cur = null; util.tip.hide(); },
    };
  })();

  function updateTally() {
    const ranked = score(state.answers);
    const cur = state.step;
    const any = state.answers.some(a => a != null);
    for (const r of ranked) {
      const row = tally.rows.get(r.v.id);
      let at = 0;
      r.parts.forEach((p, qi) => {
        const seg = row.segs[qi];
        const len = p || 0;
        seg.style.setProperty('--a', String(at));
        seg.style.setProperty('--n', String(len));
        seg.classList.toggle('is-on', len > 0);
        seg.classList.toggle('is-cur', state.view === 'quiz' && qi === cur);
        at += len;
      });
      row.totalEl.textContent = String(r.total);
      const top = any && r.rank <= 3;
      row.rankEl.textContent = top ? String(r.rank) : '';
      row.li.classList.toggle('is-top', top);
      // The per-question points the hover tooltip shows, in text a screen reader reaches.
      const from = QUESTIONS.map((q, qi) => r.parts[qi] == null ? null : `${r.parts[qi]} for ${q.label}`).filter(Boolean);
      row.srEl.textContent = ` ${r.total === 1 ? 'point' : 'points'}${from.length ? `, ${listJoin(from)}` : ''}${top ? `, number ${r.rank} so far` : ''}`;
    }
    tally.caption.textContent = any
      ? `Points each village has earned so far, out of ${MAX}. Each answered question adds one run of points, in question order.`
      : `Every village starts at zero, out of a possible ${MAX}. Choose an answer to see the points move.`;
    tally.foot.textContent = any
      ? 'Villages are grouped by region and run north to south. The top three so far are numbered. Villages on equal points are ordered by how close their flavour scores sit to your style answer, then alphabetically.'
      : 'Villages are grouped by region and run north to south. Once you answer, the top three so far are numbered.';
  }

  /* ---------- Results ---------- */
  function showResults(focus) {
    if (!complete()) return;
    state.view = 'results';
    root.dataset.view = 'results';
    stage.hidden = true;
    results.hidden = false;
    util.setParam('finder', code());
    renderSteps();
    const ranked = renderResults();
    if (focus) {
      focusEl(results.querySelector('.fd-res-title'), stepsEl);
      announce(`Results ready. ${ranked[0].name} leads with ${ranked[0].total} of ${MAX} points.`);
    }
  }

  function renderResults() {
    const ranked = score(state.answers);
    const top = ranked.slice(0, 3);
    const styleOpt = QUESTIONS[0].options[state.answers[0]];
    const target = TARGETS[state.answers[0]];

    const copyBtn = h('button', { class: 'btn btn-sm fd-copy', attrs: { type: 'button' } },
      h('span', { class: 'fd-copy-icon' }, linkIcon()), h('span', { class: 'fd-copy-label', text: 'Copy link' }));
    const fallback = h('div', { class: 'fd-copy-fallback', attrs: { hidden: true } });
    copyBtn.addEventListener('click', () => copyLink(copyBtn, fallback));
    const restart = h('button', { class: 'btn btn-ghost btn-sm', attrs: { type: 'button' }, on: { click: restartQuiz } }, 'Start again');

    const head = h('div', { class: 'fd-res-head' },
      h('div', {},
        h('p', { class: 'eyebrow', text: 'Results' }),
        h('h3', { class: 'fd-res-title', attrs: { tabindex: '-1' }, text: 'Your three best matches' }),
        h('p', { class: 'caption fd-res-sub', text: `All ${word(N)} villages scored on your four answers, out of a possible ${MAX} points.` })),
      h('div', { class: 'fd-res-actions' }, copyBtn, restart, fallback));

    const cards = h('div', { class: 'fd-cards' }, top.map((r, i) => card(r, i, ranked, styleOpt, target)));

    const names = listJoin(top.map(r => r.name));
    const compareBtn = h('button', {
      class: 'btn btn-ghost btn-sm fd-compare',
      attrs: { type: 'button', 'aria-label': `Compare these three, ${names}` },
    }, compareIcon(), 'Compare these three');
    compareBtn.addEventListener('click', () => compareTop(top, compareBtn));
    const lo = Math.min(...bandLens), hi = Math.max(...bandLens);
    const bandNote = h('p', { class: 'caveat fd-band-note' },
      `Price bands are editorial and come from the village profiles, from ${'$'.repeat(lo)} to ${'$'.repeat(hi)}. The profiles do not say what a band costs, so the finder does not match bands to your budget answer.`);
    const cardsFoot = h('div', { class: 'fd-cards-foot' }, compareBtn, bandNote);

    results.replaceChildren(head, cards, cardsFoot, oneAway(ranked), method(styleOpt), allTable(ranked, styleOpt));
    return ranked;
  }

  function card(r, i, ranked, styleOpt, target) {
    const v = r.v;
    const lvl = LEVELS[v.topLevel] ? v.topLevel : 'village';
    const titleId = `fd-card-${v.id}`;

    const breakdown = h('ul', { class: 'fd-break', attrs: { role: 'list', 'aria-label': `Points for ${r.name} by question` } },
      QUESTIONS.map((q, qi) => h('li', { class: 'fd-break-row' },
        h('span', { class: 'fd-break-k', text: q.label }),
        h('span', { class: 'fd-pips', attrs: { 'aria-hidden': 'true' } },
          Array.from({ length: perQ[qi] }, (_, pi) => h('span', { class: 'fd-pip' + (pi < r.parts[qi] ? ' on' : '') }))),
        h('span', { class: 'fd-break-v num' }, `+${r.parts[qi]}`, h('span', { class: 'visually-hidden', text: ` of ${perQ[qi]}` })))));

    const facts = h('dl', { class: 'facts fd-facts' },
      h('div', {}, h('dt', { text: 'Region' }), h('dd', { class: 'is-text', text: regionOf(v) })),
      h('div', {}, h('dt', { text: 'Grape' }), h('dd', { class: 'is-text', text: v.grape || '' })),
      h('div', {}, h('dt', { text: 'Price band' }), h('dd', { text: band(v.priceRange) })),
      h('div', {}, h('dt', { text: 'Highest level' }),
        h('dd', { class: 'fd-level is-text' },
          h('span', { class: 'swatch', dataset: { level: lvl }, attrs: { 'aria-hidden': 'true' } }),
          h('span', { text: LEVELS[lvl].label }))));

    const seeMap = h('button', {
      class: 'btn btn-ghost btn-sm', attrs: { type: 'button', 'aria-label': `See it on the map, ${r.name}` },
    }, 'See it on the map');
    seeMap.addEventListener('click', () => revealOnMap(v, seeMap));
    const readProfile = h('button', {
      class: 'btn btn-sm', attrs: { type: 'button', 'aria-label': `Read the profile, ${r.name}` },
      on: {
        click: () => {
          // Scroll towards the plate first. The villages module refines it and focuses the card.
          util.scrollToId('villages');
          bus.emit('village:focus', { id: v.id, source: 'finder', reveal: 'card' });
        },
      },
    }, 'Read the profile');

    return h('article', { class: 'fd-card', dataset: { rank: String(i + 1) }, attrs: { 'aria-labelledby': titleId } },
      h('div', { class: 'fd-card-top' },
        h('p', { class: 'eyebrow', text: `${ORDINAL[i]} match` }),
        h('p', { class: 'fd-score' },
          h('span', { class: 'fd-score-v', text: String(r.total) }),
          h('span', { class: 'fd-score-k', text: `of ${MAX} points` }))),
      h('h4', { class: 'fd-card-name', id: titleId, text: r.name }),
      facts,
      h('div', { class: 'fd-card-col' }, breakdown, tieNote(r, ranked, styleOpt)),
      radar(v, target, styleOpt),
      h('div', { class: 'fd-card-actions' }, seeMap, readProfile));
  }

  function tieNote(r, ranked, styleOpt) {
    const group = ranked.filter(x => x.total === r.total);
    if (group.length < 2) {
      return h('p', { class: 'fd-tie caveat', text: `No tie. No other village scores ${r.total}.` });
    }
    const others = group.filter(x => x !== r).map(x => x.name);
    const shown = others.length > 3 ? [...others.slice(0, 2), `${word(others.length - 2)} other villages`] : others;
    const pos = group.indexOf(r);
    const d = `${fmt.num(r.dist, 1)} on the 0–100 scale`;
    const sameAs = group.filter(x => x !== r && Math.abs(x.dist - r.dist) < 1e-9).map(x => x.name);
    const tgt = `the ${styleOpt.label} target`;
    let second;
    if (sameAs.length) {
      second = `It sits at the same flavour distance as ${listJoin(sameAs)}, ${d}, so alphabetical order decides.`;
    } else if (group.length === 2) {
      second = pos === 0
        ? `Closer of the two to ${tgt}, at a flavour distance of ${d}.`
        : `Further of the two from ${tgt}, at a flavour distance of ${d}.`;
    } else {
      second = `${CLOSEST[pos] || `Number ${pos + 1} by closeness`} of the ${word(group.length)} to ${tgt}, at a flavour distance of ${d}.`;
    }
    return h('p', { class: 'fd-tie caveat' }, `Tied on ${r.total} points with ${listJoin(shown)}. ${second}`);
  }

  /* ---------- Flavour radar (editorial scores) ----------
     One neutral series, the same slate as the tally, so an editorial profile never reads as a
     classification level. The style target is a dashed ink line with hollow marks. */
  function radar(v, target, styleOpt) {
    const W = 260, H = 196, cx = 130, cy = 104, R = 62, n = AXES.length;
    const ang = i => (-90 + i * 360 / n) * Math.PI / 180;
    const pt = (i, val) => [cx + R * (val / 100) * Math.cos(ang(i)), cy + R * (val / 100) * Math.sin(ang(i))];
    const xy = p => p.map(x => x.toFixed(1)).join(',');
    const poly = vals => vals.map((val, i) => xy(pt(i, val))).join(' ');
    const vVals = AXES.map(k => v.flavor[k] ?? 0);
    const named = AXES.map(k => k in target);

    const svg = s('svg', {
      viewBox: `0 0 ${W} ${H}`, class: 'fd-radar-svg', 'aria-hidden': 'true', focusable: 'false',
    });
    [50, 100].forEach(ring => svg.append(s('polygon', { points: poly(AXES.map(() => ring)), class: 'fd-r-ring' })));
    AXES.forEach((_, i) => svg.append(s('line', { x1: cx, y1: cy, x2: pt(i, 100)[0].toFixed(1), y2: pt(i, 100)[1].toFixed(1), class: 'fd-r-axis' })));
    svg.append(s('polygon', { points: poly(vVals), class: 'fd-r-village' }));
    // The target is drawn only on the axes it scores. A line joins neighbouring scored
    // axes whose target is above zero, a target of zero is a lone mark at the centre,
    // and an axis the target leaves out gets no mark at all.
    for (const chain of targetChains(AXES.map((k, i) => named[i] && target[k] > 0))) {
      const pts = chain.map(i => xy(pt(i, target[AXES[i]]))).join(' ');
      if (chain.length > 1) svg.append(s(chain.closed ? 'polygon' : 'polyline', { points: pts, class: 'fd-r-target' }));
    }
    AXES.forEach((k, i) => {
      const [x, y] = pt(i, vVals[i]);
      svg.append(s('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 3.4, class: 'fd-r-dot' }));
    });
    AXES.forEach((k, i) => {
      if (!named[i]) return;
      const [x, y] = pt(i, target[k]);
      svg.append(s('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 3.2, class: 'fd-r-tmark' }));
    });
    // Axis labels with the village's value underneath.
    AXES.forEach((k, i) => {
      const a = ang(i);
      const lx = cx + (R + 14) * Math.cos(a), ly = cy + (R + 14) * Math.sin(a);
      const anchor = Math.abs(Math.cos(a)) < 0.2 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end';
      const top = Math.sin(a) < -0.5;
      const y0 = top ? ly - 12 : ly + (Math.sin(a) > 0.5 ? 4 : -2);
      const t = s('text', { x: lx.toFixed(1), y: y0.toFixed(1), 'text-anchor': anchor, class: 'fd-r-label' });
      t.append(s('tspan', { x: lx.toFixed(1), text: cap(k) }));
      t.append(s('tspan', { x: lx.toFixed(1), dy: 13, class: 'fd-r-val', text: String(vVals[i]) }));
      svg.append(t);
    });

    const tKeys = Object.keys(target);
    const unscored = AXES.filter(k => !(k in target));
    const alt = `${v.name} flavour scores, out of 100. ${AXES.map((k, i) => `${cap(k)} ${vVals[i]}`).join(', ')}. ` +
      `The ${styleOpt.label.replace('&', 'and')} target scores ${listJoin(tKeys.map(k => `${k} ${target[k]}`))}.` +
      (unscored.length ? ` It does not score ${listJoin(unscored, 'or')}.` : '');

    return h('figure', { class: 'fd-radar', attrs: { 'aria-label': `Flavour profile of ${v.name}` } },
      svg,
      h('p', { class: 'visually-hidden', text: alt }),
      h('figcaption', { class: 'fd-radar-cap' },
        h('span', { class: 'fd-radar-keys' },
          h('span', { class: 'fd-key' }, h('span', { class: 'fd-key-fill', attrs: { 'aria-hidden': 'true' } }), v.name),
          h('span', { class: 'fd-key' }, h('span', { class: 'fd-key-line', attrs: { 'aria-hidden': 'true' } }), 'Your style target, scored axes only')),
        h('span', { class: 'fd-radar-note', text: 'Editorial flavour scores, 0–100' })));
  }

  /** Runs of neighbouring scored axes around the radar. Returns arrays of axis indexes. */
  function targetChains(named) {
    const n = named.length;
    if (named.every(Boolean)) return [Object.assign([...named.keys()], { closed: true })];
    const chains = [];
    for (let i = 0; i < n; i++) {
      if (!named[i] || named[(i - 1 + n) % n]) continue;
      const chain = [];
      for (let j = i; named[j % n] && chain.length < n; j++) chain.push(j % n);
      chains.push(chain);
    }
    return chains;
  }

  /* ---------- One answer away: which single change would move the leader ---------- */
  function oneAway(ranked) {
    const leader = ranked[0];
    const rows = [];
    QUESTIONS.forEach((q, qi) => q.options.forEach((o, oi) => {
      if (oi === state.answers[qi]) return;
      const alt = state.answers.slice(); alt[qi] = oi;
      const top = score(alt)[0];
      if (top.v !== leader.v) rows.push({ q, qi, o, oi, top });
    }));
    const possible = QUESTIONS.reduce((a, q) => a + q.options.length - 1, 0);
    const intro = rows.length
      ? `Change a single answer and a different village takes first place. ${cap(word(rows.length))} of the ${word(possible)} possible single changes ${rows.length === 1 ? 'does' : 'do'} that. Choose one to try it.`
      : `None of the ${word(possible)} possible single changes of answer moves ${leader.name} out of first place.`;
    const list = h('ul', { class: 'fd-away-list', attrs: { role: 'list' } }, rows.map(r => h('li', {},
      h('button', {
        class: 'fd-away-row', attrs: { type: 'button' },
        on: {
          click: () => {
            state.answers[r.qi] = r.oi;
            showResults(false);
            focusEl(results.querySelector('.fd-res-title'), stepsEl);
            announce(`${r.q.label} changed to ${r.o.label.replace('&', 'and')}. ${r.top.name} now leads with ${r.top.total} of ${MAX} points.`);
          },
        },
      },
      h('span', { class: 'visually-hidden', text: 'Try ' }),
      h('span', { class: 'fd-away-q', text: r.q.label }),
      h('span', { class: 'fd-away-o' }, labelNodes(r.o.label)),
      h('span', { class: 'fd-away-arrow', attrs: { 'aria-hidden': 'true' }, text: '→' }),
      h('span', { class: 'visually-hidden', text: ' then ' }),
      h('span', { class: 'fd-away-v' }, h('span', { class: 'fd-away-name', text: r.top.name }), h('span', { class: 'fd-away-pts', text: ` leads with ${r.top.total} of ${MAX}` }))))));
    return h('section', { class: 'fd-away', attrs: { 'aria-labelledby': 'fd-away-title' } },
      h('div', { class: 'fd-away-head' },
        h('h4', { class: 'fd-method-title', id: 'fd-away-title', text: 'One answer away' }),
        h('p', { class: 'caption', text: intro })),
      rows.length ? list : null);
  }

  /* ---------- Method note ---------- */
  function method() {
    const tSentence = (t, oi) => {
      const o = QUESTIONS[0].options[oi];
      const keys = Object.keys(t);
      const vals = new Set(keys.map(k => t[k]));
      const body = vals.size === 1
        ? `${[...vals][0]} on ${listJoin(keys)}`
        : listJoin(keys.map(k => `${k} ${t[k]}`));
      return h('li', { class: oi === state.answers[0] ? 'is-yours' : '' },
        h('span', { class: 'fd-m-opt' }, labelNodes(o.label)), ' aims for ', body, '.',
        oi === state.answers[0] ? h('span', { class: 'fd-m-you', text: 'Your answer' }) : null);
    };
    return h('section', { class: 'fd-method', attrs: { 'aria-labelledby': 'fd-method-title' } },
      h('h4', { class: 'fd-method-title', id: 'fd-method-title', text: 'How the score works' }),
      h('div', { class: 'fd-method-cols' },
        h('div', {},
          h('p', {}, `Every village profile assigns each answer between ${minW} and ${Math.max(...perQ)} points. Your four answers add up to a score out of ${MAX}. Nothing else goes into it.`),
          h('p', {}, 'Villages often tie. A tie goes to the village whose flavour scores sit closest to the target set by your style answer, measured as the root mean square gap on the axes that target names, on the same 0–100 scale as the scores. If the distance is also equal, alphabetical order decides.')),
        h('div', {},
          h('ul', { class: 'fd-method-targets', attrs: { role: 'list' } }, TARGETS.map(tSentence)),
          h('p', { class: 'caveat', text: 'The points and the flavour scores are editorial and subjective. They come from the curated village profiles, not from measurement.' }))));
  }

  /* ---------- Full ranking, the table view ---------- */
  function allTable(ranked, styleOpt) {
    const th = (long, short, cls = '') => h('th', { class: cls, attrs: { scope: 'col' } },
      short ? [h('span', { class: 'fd-th-long', text: long }), h('abbr', { class: 'fd-th-short', attrs: { title: long }, text: short })] : long);
    const table = h('table', { class: 'fd-table' },
      h('caption', { class: 'caption' }, `Points per answer, total out of ${MAX}, and flavour distance to the ${styleOpt.label} target on the 0–100 scale. A lower distance is closer.`),
      h('thead', {}, h('tr', {},
        th('Rank', '#', 'fd-c-rank'), th('Village', null, 'fd-c-name'),
        ...QUESTIONS.map(q => th(q.label, q.label[0], 'fd-c-pt')),
        th('Total', null, 'fd-c-total'), th('Distance', 'Dist.', 'fd-c-dist'))),
      h('tbody', {}, ranked.map(r => h('tr', { class: r.rank <= 3 ? 'is-top' : '' },
        h('td', { class: 'fd-c-rank num', text: String(r.rank) }),
        h('th', { class: 'fd-c-name', attrs: { scope: 'row' } },
          h('span', { class: 'fd-t-vname', text: r.name }),
          h('span', { class: 'fd-t-vregion', text: regionOf(r.v) })),
        ...r.parts.map(p => h('td', { class: 'fd-c-pt num', text: String(p) })),
        h('td', { class: 'fd-c-total num' },
          h('span', { class: 'fd-bar', attrs: { 'aria-hidden': 'true' } }, h('span', { style: { width: `${(r.total / MAX) * 100}%` } })),
          h('span', { text: String(r.total) })),
        h('td', { class: 'fd-c-dist num', text: fmt.num(r.dist, 1) })))));
    return h('details', { class: 'disclosure fd-all' },
      h('summary', {}, h('span', { text: `All ${word(N)} villages, scored` }), h('span', { class: 'fd-sum-hint', text: 'Open the full ranking' })),
      h('div', { class: 'fd-table-wrap', attrs: { role: 'region', 'aria-label': 'Full ranking', tabindex: '0' } }, table));
  }

  /* ---------- Leaving the plate: map, profile, comparison ---------- */
  function revealOnMap(v, origin) {
    announce(`Showing ${v.name} on the map.`);
    util.scrollToId('map');
    bus.emit('village:focus', { id: v.id, source: 'finder', reveal: 'map' });
    // Follow the reader to the map. The map opens its summary panel once the region
    // file is in, so wait for that panel's heading, then move focus to it.
    const hasMap = !!document.querySelector('#map-app .atlas-panel');
    focusWhenReady(() => {
      const t = document.getElementById('atlas-panel-title');
      return t && !t.closest('[hidden]') && util.fold(t.textContent) === util.fold(v.name) ? t : null;
    }, () => focusHeading('map-title'), origin, hasMap ? 4000 : 0);
  }

  function compareTop(top, origin) {
    const ids = top.map(r => r.v.id);
    bus.emit('compare:change', { ids });
    announce(`The comparison now holds ${listJoin(top.map(r => r.name))}.`);
    // Land on the village profiles themselves, where the comparison tray sits pinned to
    // the bottom of the viewport, rather than on the figures that open the plate.
    const hasTray = !!document.querySelector('#villages-app .vl-tray');
    util.scrollToId(hasTray ? 'villages-app' : 'villages');
    focusWhenReady(() => document.querySelector('#villages-app .vl-tray:not([hidden]) .vl-tray-actions .btn:not([disabled])'),
      () => focusHeading('villages-title'), origin, hasTray ? 1500 : 0);
  }

  // Poll a frame at a time for an element another plate renders, then focus it without
  // scrolling (the plate handles its own scroll). Gives up if the reader moves focus first.
  function focusWhenReady(find, fallback, origin, timeout) {
    const t0 = performance.now();
    const tick = () => {
      const a = document.activeElement;
      if (origin && a !== origin && a !== document.body && a != null) return;
      const el = find();
      if (el) { el.focus({ preventScroll: true }); return; }
      if (performance.now() - t0 >= timeout) { fallback(); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function focusHeading(id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  }

  /* ---------- Share ---------- */
  async function copyLink(btn, fallback) {
    const url = `${location.origin}${location.pathname}?finder=${code()}#finder`;
    const label = btn.querySelector('.fd-copy-label');
    const icon = btn.querySelector('.fd-copy-icon');
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch { ok = false; }
    if (ok) {
      label.textContent = 'Link copied';
      icon.replaceChildren(checkIcon(14));
      btn.classList.add('is-done');
      announce('Link copied to the clipboard.');
      clearTimeout(btn._t);
      btn._t = setTimeout(() => {
        label.textContent = 'Copy link';
        icon.replaceChildren(linkIcon());
        btn.classList.remove('is-done');
      }, 2400);
    } else {
      const input = h('input', { class: 'input fd-copy-input', attrs: { type: 'text', readonly: true, 'aria-label': 'Link to these results' }, value: url });
      fallback.replaceChildren(h('p', { class: 'caveat', text: 'Copying was blocked. Select the link and copy it.' }), input);
      fallback.hidden = false;
      input.focus(); input.select();
      announce('Copying was blocked. The link is selected in a text field.');
    }
  }

  /* ---------- Navigation ---------- */
  function goTo(i, focus) {
    const fromResults = state.view === 'results';
    state.view = 'quiz';
    root.dataset.view = 'quiz';
    state.step = Math.max(0, Math.min(QUESTIONS.length - 1, i));
    results.hidden = true;
    stage.hidden = false;
    renderSteps();
    // Coming back from the long results view, always bring the ledger to the top so the
    // question and its buttons are in view.
    renderQuestion({ focus, scroll: fromResults });
    updateTally();
    if (focus) announce(`Question ${state.step + 1} of ${QUESTIONS.length}.`);
  }

  function restartQuiz() {
    state.answers = [null, null, null, null];
    util.setParam('finder', null);
    goTo(0, true);
  }

  // Focus a heading without letting it hide under the sticky nav.
  function focusEl(el, anchor, force = false) {
    if (!el) return;
    const navH = parseFloat(util.cssVar('--nav-h')) || 56;
    const top = anchor.getBoundingClientRect().top;
    if (force || top < navH + 8 || top > innerHeight * 0.55) {
      anchor.scrollIntoView({ block: 'start', behavior: util.reducedMotion() ? 'auto' : 'smooth' });
    }
    el.focus({ preventScroll: true });
  }

  function linkIcon() {
    return s('svg', { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': 'true', class: 'fd-icon', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round' },
      s('path', { d: 'M6.5 9.5l3-3M7 4.5l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7L10.7 8.2M9 11.5l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7L5.3 7.8' }));
  }
  function checkIcon(size = 12) {
    return s('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': 'true', class: 'fd-icon fd-check', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
      s('path', { d: 'M3.5 8.5l3 3 6-7' }));
  }
  function compareIcon() {
    return s('svg', { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': 'true', class: 'fd-icon', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4 },
      s('rect', { x: 1.5, y: 3, width: 3.5, height: 10, rx: 0.8 }),
      s('rect', { x: 6.25, y: 3, width: 3.5, height: 10, rx: 0.8 }),
      s('rect', { x: 11, y: 3, width: 3.5, height: 10, rx: 0.8 }));
  }

  /* ---------- Start: restore ?finder= if it is valid ---------- */
  const rawCode = ctx.params.get('finder');
  const fromUrl = parseCode(rawCode);
  if (fromUrl) {
    state.answers = fromUrl;
    state.step = QUESTIONS.length - 1;
    renderQuestion();
    updateTally();
    showResults(false);
  } else {
    if (rawCode != null) {
      util.setParam('finder', null);
      // Say why a shared link opens on the first question. The note goes once the reader answers.
      const note = h('p', { class: 'note fd-link-note', text: 'The answers in this link could not be read, so the finder starts from the first question.' });
      root.prepend(note);
      root.addEventListener('change', () => note.remove(), { once: true });
    }
    renderSteps();
    renderQuestion();
    updateTally();
  }
  if (rawCode != null && finderIsTheDeepLink()) keepInView();

  function parseCode(str) {
    if (!str || !/^\d+(-\d+){3}$/.test(str)) return null;
    const a = str.split('-').map(Number);
    return a.every((x, i) => x >= 0 && x < QUESTIONS[i].options.length) ? a : null;
  }

  // A ?finder= link should land on the finder unless the address points somewhere else too:
  // a village card or map feature (?village=, ?feature=) or a hash naming another part of the
  // page. The quiz writes ?finder= under whatever hash the reader had, so #top and #main do
  // not count. Without a hash of its own, a reload or a step back keeps the scroll position
  // the browser restores.
  function finderIsTheDeepLink() {
    if (ctx.params.get('village') || ctx.params.get('feature')) return false;
    let id = location.hash.slice(1);
    try { id = decodeURIComponent(id); } catch { /* keep the raw hash */ }
    if (id) {
      if (document.getElementById(id)?.closest('#finder')) return true;
      if (id !== 'top' && id !== 'main') return false;
    }
    const nav = performance.getEntriesByType?.('navigation')?.[0];
    return !nav || nav.type === 'navigate';
  }

  // Other plates above render later and can push the section down, so re-align once the
  // page settles, unless the reader has moved.
  function keepInView() {
    let moved = false;
    const stop = () => { moved = true; };
    ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(t => addEventListener(t, stop, { once: true, passive: true }));
    const align = () => { if (!moved) document.getElementById('finder')?.scrollIntoView({ block: 'start' }); };
    requestAnimationFrame(align);
    if (document.readyState === 'complete') setTimeout(align, 400);
    else addEventListener('load', () => setTimeout(align, 400), { once: true });
  }
}
