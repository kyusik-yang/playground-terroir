// Plate IV, part one: the fifteen profiles side by side.
// Fig. IV.1 shows how each profile's delimited land splits into grand cru, premier cru and village land.
// Fig. IV.2 shows the elevation range of each level's land on one shared axis.
// Every number and every sentence is computed from data/villages.json at runtime.

import { h, fmt, LEVELS, REGIONS, regionName, aspectWord, tip, reducedMotion, whenVisible, debounce } from './util.js';
import { LV, northToSouth, levelParts, pctText, listText, countWord, cap1, radioSeg, tipAt, tipBody, levelName, dominantFacing, overlaps, noteOrigin, onPlateRegion } from './villages.js';

const total = v => v.stats?.area_ha?.total ?? 0;
/** Tick labels centre on their line, except at the two ends of the track where they align inwards. */
const tickClass = at => `hx-tick${at <= 0.5 ? ' is-start' : at >= 99.5 ? ' is-end' : ''}`;

/** Round up to a clean axis maximum and choose a tick step with four or five intervals. */
function niceAxis(x) {
  const e = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1))));
  for (const [m, n] of [[1, 4], [2, 4], [2.5, 5], [4, 4], [5, 5], [10, 4]]) {
    if (m * e >= x) return { max: m * e, step: (m * e) / n };
  }
  return { max: 10 * e, step: 2.5 * e };
}

export async function init(mount, ctx) {
  const { bus, data } = ctx;
  const doc = await data.villages();
  const V = [...doc.villages].sort(northToSouth);
  const N = V.length;
  const state = { unit: 'share', order: 'ns', region: 'all', current: null };

  /* ---------- Fig. IV.1 scale: a broken axis for villages far larger than the rest ---------- */
  const bySize = [...V].sort((a, b) => total(b) - total(a));
  let k = 0;
  while (k < bySize.length - 1 && total(bySize[k]) > 1.8 * total(bySize[k + 1])) k++;
  const outliers = new Set(bySize.slice(0, k).map(v => v.id));
  const haAxis = niceAxis(total(bySize[k]) || 1);
  const P = outliers.size ? 0.84 : 1;          // share of the track used for 0 to haAxis.max
  const BREAK_GAP = 0.07;                      // the cut between the scaled part and the stub
  const xHa = (v, x) => {
    if (!outliers.has(v.id) || x <= haAxis.max) return (x / haAxis.max) * P;
    return P + BREAK_GAP + (1 - P - BREAK_GAP) * ((x - haAxis.max) / (total(v) - haAxis.max));
  };

  /* ---------- Fig. IV.2 scale ---------- */
  const elevs = V.flatMap(v => LV.map(l => v.stats?.by_level?.[l.key]?.elev).filter(Boolean));
  const eLo = Math.floor(Math.min(...elevs.map(e => e[0])) / 50) * 50;
  const eHi = Math.ceil(Math.max(...elevs.map(e => e[2])) / 50) * 50;
  const xE = m => ((m - eLo) / (eHi - eLo)) * 100;
  const eTicks = [];
  for (let t = Math.ceil(eLo / 100) * 100; t <= eHi; t += 100) eTicks.push(t);

  /* ======================================================================
     Fig. IV.1: delimited land by level
     ====================================================================== */
  const unitSeg = radioSeg({
    label: 'Show', value: 'share',
    options: [{ value: 'share', text: 'Share of total' }, { value: 'ha', text: 'Hectares' }],
    onChange: v => { state.unit = v; renderArea(); },
  });
  const orderSeg = radioSeg({
    label: 'Order', value: 'ns',
    options: [{ value: 'ns', text: 'North to south' }, { value: 'area', text: 'Largest first' }],
    onChange: v => { state.order = v; layoutArea(); },
  });
  const areaAxis = h('div', { class: 'hx-axis', attrs: { 'aria-hidden': 'true' } }, h('span'), h('span', { class: 'hx-axis-track' }), h('span'));
  const areaBody = h('div', { class: 'hx-body' });
  const areaCap = h('figcaption', { class: 'hx-cap' });
  const areaRows = V.map(v => areaRow(v));

  const fig1 = h('figure', { class: 'hx-fig hx-fig-area is-pre', attrs: { 'aria-labelledby': 'hx1-title' } },
    figHead('Fig. IV.1', 'hx1-title', 'Delimited land by level',
      'Grand cru, premier cru and village land in each profile. The levels are exclusive, so each bar adds up to the whole.',
      [controlField('Show', unitSeg), controlField('Order', orderSeg)]),
    legend([...LV.map(l => h('li', {}, h('span', { class: 'swatch', dataset: { level: l.id } }), levelName(l.id)))]),
    areaAxis, areaBody, areaCap, areaTable());

  /* ======================================================================
     Fig. IV.2: where the land sits
     ====================================================================== */
  const elevAxis = h('div', { class: 'hx-axis hx-axis-elev', attrs: { 'aria-hidden': 'true' } },
    h('span'), h('span', { class: 'hx-axis-track' }, eTicks.map((t, i) => h('span', { class: tickClass(xE(t)), style: { left: `${xE(t)}%` }, text: i === eTicks.length - 1 ? `${fmt.num(t)} m` : fmt.num(t) }))));
  const elevBody = h('div', { class: 'hx-body' });
  const elevRows = V.map(v => elevRow(v));
  REGIONS.forEach(r => {
    const rows = elevRows.filter(x => x.v.region === r.id);
    if (!rows.length) return;
    elevBody.append(h('div', { class: 'hx-group', attrs: { role: 'group', 'aria-label': r.name } },
      h('p', { class: 'hx-group-name eyebrow', text: r.name }),
      h('ul', { class: 'hx-rows', attrs: { role: 'list' } }, rows.map(x => x.li))));
  });

  const fig2 = h('figure', { class: 'hx-fig hx-fig-elev', attrs: { 'aria-labelledby': 'hx2-title' } },
    figHead('Fig. IV.2', 'hx2-title', 'Where the land sits',
      'Elevation of each level’s land on one shared axis, grouped by region from north to south.', []),
    legend([
      ...LV.map(l => h('li', {}, h('span', { class: 'swatch', dataset: { level: l.id } }), levelName(l.id))),
      h('li', { class: 'hx-key-mean' }, h('span', { class: 'hx-key-dot' }), 'Mean'),
      h('li', { class: 'hx-key-range' }, h('span', { class: 'hx-key-bar' }), 'Lowest to highest')]),
    elevAxis, elevBody, h('figcaption', { class: 'hx-cap' }, elevSentences().map(t => h('p', { text: t }))), elevTable());

  // Profiles can share grand cru land (counted by commune), so some bars must not be added together.
  const shared = overlaps(V).map(({ a, b, g }) =>
    `The ${fmt.ha(g.area_ha)} of ${g.name} in the ${a.name} profile are also part of the ${b.name} profile. Their two bars overlap by that much and should not be added together.`);
  const notes = h('div', { class: 'hx-notes' },
    h('p', { class: 'eyebrow', text: 'Notes' }),
    ...[...(doc.notes || []), ...shared].map(n => h('p', { class: 'caveat', text: n })));

  mount.replaceChildren(h('div', { class: 'hx' }, h('div', { class: 'hx-figs' }, fig1, fig2), notes));

  renderArea();
  layoutArea();
  fitLabels();
  // Level names are printed inside segments that are wide enough, so they are re-fitted when the width changes.
  let lastW = 0;
  if ('ResizeObserver' in window) new ResizeObserver(debounce(() => { const w = trackWidth(); if (w !== lastW) { lastW = w; fitLabels(); } }, 120)).observe(areaBody);
  if (reducedMotion()) fig1.classList.remove('is-pre');
  else whenVisible(fig1, () => requestAnimationFrame(() => requestAnimationFrame(() => fig1.classList.remove('is-pre'))), '-15% 0px');

  /* ---------- Bus ---------- */
  bus.on('region:select', p => { if (p) setRegion(p.region); });
  bus.on('village:focus', p => { if (p) setCurrent(p.id); });
  // The village cards widened to All to show a card the region filter hid (not broadcast on the bus).
  onPlateRegion(setRegion);
  const lr = bus.last('region:select');
  if (lr) setRegion(lr.region);
  const lf = bus.last('village:focus');
  if (lf) setCurrent(lf.id);

  /* ======================================================================
     Builders
     ====================================================================== */
  function figHead(no, id, title, sub, controls) {
    return h('div', { class: 'fig-head hx-fig-head' },
      h('p', { class: 'fig-no', text: no }),
      h('h3', { id, text: title }),
      h('p', { class: 'hx-sub', text: sub }),
      controls.length ? h('div', { class: 'hx-controls' }, controls) : null);
  }

  function controlField(label, seg) {
    const id = `hx-l-${label.toLowerCase()}`;
    seg.el.removeAttribute('aria-label');
    seg.el.setAttribute('aria-labelledby', id);
    return h('div', { class: 'hx-control' }, h('span', { class: 'hx-control-k', id, text: label }), seg.el);
  }

  function legend(items) {
    return h('ul', { class: 'hx-legend', attrs: { role: 'list', 'aria-label': 'Legend' } }, items);
  }

  function focusRow(v, btn, figLabel) {
    noteOrigin(btn, figLabel);
    bus.emit('village:focus', { id: v.id, reveal: 'card', source: 'hierarchy' });
  }

  function wireRowTip(btn, body) {
    btn.addEventListener('focus', () => { if (btn.matches(':focus-visible')) tipAt(btn.querySelector('.hx-track, .hx-lanes') || btn, body()); });
    btn.addEventListener('blur', () => tip.hide());
  }

  /* ---------- Fig. IV.1 row ---------- */
  function areaRow(v) {
    const parts = levelParts(v).filter(p => p.ha > 0);
    const segs = parts.map(p => {
      // The short level name inside the segment is shown only when the segment is wide enough (fitLabels).
      const seg = h('span', { class: 'hx-seg', dataset: { level: p.id } }, h('span', { class: 'hx-seg-lbl', attrs: { 'aria-hidden': 'true' }, text: LEVELS[p.id].short }));
      seg.addEventListener('pointermove', e => tip.show(e, tipBody(v.name, [[fmt.ha(p.ha), `${p.word}, ${pctText(p.share)} of its delimited land`]])));
      seg.addEventListener('pointerleave', () => tip.hide());
      return seg;
    });
    const bar = h('span', { class: 'hx-bar' }, segs);
    const brk = h('span', { class: 'hx-break', hidden: true, style: { left: `${(P + BREAK_GAP / 2) * 100}%` } });
    const ticks = h('span', { class: 'hx-gridlines' });
    const track = h('span', { class: 'hx-track' }, ticks, bar, brk);
    // Past the break the bar is not to scale, so the level that runs past it is labelled directly.
    let past = null;
    if (outliers.has(v.id)) {
      let cum = 0;
      const cut = parts.filter(p => { cum += p.ha; return cum > haAxis.max; });
      past = h('span', { class: 'hx-past', hidden: true, attrs: { 'aria-hidden': 'true' } },
        `${listText(cut.map(p => `${fmt.ha(p.ha)} of ${p.word} land`))} past the break`);
    }
    const aria = `${v.name}, ${v.regionName}. ${fmt.ha(total(v))} delimited. ${parts.map(p => `${cap1(p.word)} ${fmt.ha(p.ha)}, ${pctText(p.share)}`).join('. ')}. Opens its profile card.`;
    const btn = h('button', { class: 'hx-hit', attrs: { type: 'button', 'aria-label': aria } },
      h('span', { class: 'hx-name', text: v.name }), track, h('span', { class: 'hx-val num', text: fmt.ha(total(v)) }), past);
    btn.addEventListener('click', () => focusRow(v, btn, 'Fig. IV.1'));
    // One level only: the total line would repeat the level line, so it is left out.
    wireRowTip(btn, () => tipBody(v.name, [...(parts.length > 1 ? [[fmt.ha(total(v)), 'delimited in all']] : []), ...parts.map(p => [fmt.ha(p.ha), `${p.word}, ${pctText(p.share)}`])]));
    const li = h('li', { class: 'hx-row', dataset: { id: v.id, region: v.region } }, btn);
    return { v, li, bar, segs, parts, brk, ticks, track, past, grow: [], lbl: [] };
  }

  function renderArea() {
    const share = state.unit === 'share';
    const ticks = share ? [0, 25, 50, 75, 100].map(t => ({ at: t, label: t === 100 ? '100%' : String(t) }))
      : Array.from({ length: Math.round(haAxis.max / haAxis.step) + 1 }, (_, i) => i * haAxis.step)
        .map((t, i, a) => ({ at: (t / haAxis.max) * P * 100, label: i === a.length - 1 ? `${fmt.num(t)} ha` : fmt.num(t) }));
    areaAxis.querySelector('.hx-axis-track').replaceChildren(...ticks.map(t => h('span', { class: tickClass(t.at), style: { left: `${t.at}%` }, text: t.label })));
    for (const r of areaRows) {
      r.ticks.replaceChildren(...ticks.map(t => h('span', { class: 'hx-gl', style: { left: `${t.at}%` } })));
      const t = total(r.v);
      // lbl: the share of the track where a segment's label can sit. Past the break the bar is squeezed,
      // so a segment that crosses it only counts the part drawn to scale.
      if (share) {
        r.frac = 1;
        r.grow = r.parts.map(p => p.share);
        r.lbl = r.parts.map(p => p.share / 100);
      } else {
        let c0 = 0;
        const cap = outliers.has(r.v.id) ? haAxis.max : Infinity;
        r.lbl = r.parts.map(p => { const a = c0; c0 += p.ha; return a >= cap ? 0 : xHa(r.v, Math.min(c0, cap)) - xHa(r.v, a); });
        r.frac = xHa(r.v, t);
        // Grow factors are normalised to sum to 100 (a sum below 1 would leave the bar part empty).
        let cum = 0;
        r.grow = r.parts.map(p => {
          const a = xHa(r.v, cum); cum += p.ha;
          return Math.max(0.01, ((xHa(r.v, cum) - a) / (r.frac || 1)) * 100);
        });
      }
      r.bar.style.width = `${r.frac * 100}%`;
      r.segs.forEach((seg, i) => { seg.style.flexGrow = String(r.grow[i]); });
      r.brk.hidden = share || !outliers.has(r.v.id);
      if (r.past) r.past.hidden = share;
    }
    areaCap.replaceChildren(...areaSentences().map(t => h('p', { text: t })));
    fitLabels();
  }

  /** Width of one bar track in pixels (all tracks share it). One layout read. */
  function trackWidth() {
    const t = areaRows.find(r => r.track.isConnected)?.track;
    return t ? t.clientWidth : 0;
  }

  /** Print GC, 1er or Vil. inside every segment wide enough to hold it, from the known proportions. */
  function fitLabels() {
    const w = trackWidth();
    if (!w) return;
    for (const r of areaRows) {
      r.segs.forEach((seg, i) => {
        const px = w * r.lbl[i] - 2;
        const need = LEVELS[r.parts[i].id].short.length * 6.8 + 10;
        seg.classList.toggle('has-lbl', px >= need);
      });
    }
  }

  function layoutArea() {
    if (state.order === 'area') {
      const rows = [...areaRows].sort((a, b) => total(b.v) - total(a.v));
      areaBody.replaceChildren(h('ul', { class: 'hx-rows', attrs: { role: 'list', 'aria-label': 'Profiles, largest first' } }, rows.map(r => r.li)));
    } else {
      areaBody.replaceChildren(...REGIONS.map(reg => {
        const rows = areaRows.filter(r => r.v.region === reg.id);
        return rows.length ? h('div', { class: 'hx-group', attrs: { role: 'group', 'aria-label': reg.name } },
          h('p', { class: 'hx-group-name eyebrow', text: reg.name }),
          h('ul', { class: 'hx-rows', attrs: { role: 'list' } }, rows.map(r => r.li))) : null;
      }));
    }
  }

  /* ---------- Fig. IV.2 row ---------- */
  function elevRow(v) {
    const lanes = LV.map(l => ({ ...l, st: v.stats?.by_level?.[l.key] })).filter(l => l.st && Array.isArray(l.st.elev));
    const laneEls = lanes.map(l => {
      const [lo, mean, hi] = l.st.elev;
      const range = h('span', { class: 'hx-range', dataset: { level: l.id }, style: { left: `${xE(lo)}%`, width: `${Math.max(0.6, xE(hi) - xE(lo))}%` } });
      const dot = h('span', { class: 'hx-dot', dataset: { level: l.id }, style: { left: `${xE(mean)}%` } });
      const trackEl = h('span', { class: 'hx-etrack' }, range, dot);
      const lane = h('span', { class: 'hx-lane', dataset: { level: l.id } }, h('span', { class: 'hx-lk', text: LEVELS[l.id].short }), trackEl);
      lane.addEventListener('pointermove', e => tip.show(e, laneTip(v, l)));
      lane.addEventListener('pointerleave', () => tip.hide());
      return lane;
    });
    const aria = `${v.name}, ${v.regionName}. ${lanes.map(l => `${cap1(l.word)} land from ${fmt.num(l.st.elev[0])} to ${fmt.num(l.st.elev[2])} metres, mean ${fmt.num(l.st.elev[1])} metres`).join('. ')}. Opens its profile card.`;
    const btn = h('button', { class: 'hx-hit hx-ehit', attrs: { type: 'button', 'aria-label': aria }, on: { click: () => focusRow(v, btn, 'Fig. IV.2') } },
      h('span', { class: 'hx-name', text: v.name }),
      h('span', { class: 'hx-lanes' },
        h('span', { class: 'hx-gridlines' }, eTicks.map(t => h('span', { class: 'hx-gl', style: { left: `${xE(t)}%` } }))),
        laneEls));
    wireRowTip(btn, () => tipBody(v.name, lanes.map(l => [fmt.mRange(l.st.elev[0], l.st.elev[2]), `${l.word}, mean ${fmt.m(l.st.elev[1])}`])));
    const li = h('li', { class: 'hx-row hx-erow', dataset: { id: v.id, region: v.region } }, btn);
    return { v, li, lanes };
  }

  function laneTip(v, l) {
    const [lo, mean, hi] = l.st.elev;
    const lines = [[fmt.mRange(lo, hi), `${l.word} land`], [fmt.m(mean), 'mean elevation']];
    if (l.st.slope != null) lines.push([fmt.deg(l.st.slope), 'mean slope']);
    const d = dominantFacing(l.st.aspect_hist);
    if (d) lines.push([pctText(d.share), `of its sloping ground faces ${aspectWord(d.label)}`]);
    return tipBody(v.name, lines);
  }

  /* ---------- Region and focus cross-links ---------- */
  function setRegion(region) {
    state.region = REGIONS.some(r => r.id === region) ? region : 'all';
    for (const li of mount.querySelectorAll('.hx-row')) li.classList.toggle('is-dim', state.region !== 'all' && li.dataset.region !== state.region);
  }

  function setCurrent(id) {
    state.current = id;
    for (const li of mount.querySelectorAll('.hx-row')) li.classList.toggle('is-current', li.dataset.id === id);
  }

  /* ======================================================================
     Generated sentences
     ====================================================================== */
  function areaSentences() {
    const P2 = V.map(v => ({ v, parts: levelParts(v) }));
    const lvl = (x, key) => x.parts.find(p => p.key === key).ha;
    const withGC = P2.filter(x => lvl(x, 'grand_cru') > 0);
    const withPC = P2.filter(x => lvl(x, 'premier_cru') > 0);
    const villageOnly = P2.filter(x => lvl(x, 'grand_cru') === 0 && lvl(x, 'premier_cru') === 0);
    const gcOnly = P2.filter(x => lvl(x, 'grand_cru') > 0 && lvl(x, 'premier_cru') === 0 && lvl(x, 'village') === 0);
    const classified = x => 100 - x.parts.find(p => p.key === 'village').share;
    const rest = P2.filter(x => !gcOnly.includes(x)).sort((a, b) => classified(b) - classified(a));
    const names = arr => listText(arr.map(x => x.v.name));

    if (state.unit === 'share') {
      const out = [`Grand cru land appears in ${countWord(withGC.length)} of the ${countWord(N)} profiles and premier cru land in ${countWord(withPC.length)}.`];
      if (villageOnly.length) out.push(`${names(villageOnly)} ${villageOnly.length === 1 ? 'has' : 'have'} village land only.`);
      const top = rest[0];
      if (top) {
        const lead = gcOnly.length ? `${names(gcOnly)} ${gcOnly.length === 1 ? 'is' : 'are'} profiled as grand cru land only. Among the rest, the` : 'The';
        out.push(`${lead} largest combined grand and premier cru share is in ${top.v.name}, at ${pctText(classified(top))} of its delimited land.`);
        const half = rest.filter(x => classified(x) > 50);
        if (half.length > 1) out.push(`That combined share is above half in ${names(half)}.`);
      }
      return out;
    }
    const big = bySize[0], small = bySize[bySize.length - 1];
    const out = [`${big.name} is the largest profile at ${fmt.ha(total(big))}, about ${fmt.num(total(big) / total(small))} times ${small.name}, the smallest at ${fmt.ha(total(small))}.`];
    if (outliers.size) {
      const ol = bySize.filter(v => outliers.has(v.id));
      out.push(`The ${ol.length === 1 ? 'bar' : 'bars'} for ${listText(ol.map(v => v.name))} ${ol.length === 1 ? 'is' : 'are'} broken at ${fmt.num(haAxis.max)} ha and not drawn to scale beyond the break. ${ol.length === 1 ? 'Its total is' : 'Their totals are'} printed at the right.`);
    }
    return out;
  }

  function elevSentences() {
    const alls = V.filter(v => v.stats?.all?.elev);
    const lo = alls.reduce((a, v) => (v.stats.all.elev[0] < a.stats.all.elev[0] ? v : a), alls[0]);
    const hi = alls.reduce((a, v) => (v.stats.all.elev[2] > a.stats.all.elev[2] ? v : a), alls[0]);
    const mean = (v, key) => v.stats?.by_level?.[key]?.elev?.[1];
    const pcVl = V.filter(v => mean(v, 'premier_cru') != null && mean(v, 'village') != null);
    const pcLower = pcVl.filter(v => mean(v, 'premier_cru') < mean(v, 'village'));
    const gcPc = V.filter(v => mean(v, 'grand_cru') != null && mean(v, 'premier_cru') != null);
    const gcLower = gcPc.filter(v => mean(v, 'grand_cru') < mean(v, 'premier_cru'));
    const lanes = V.flatMap(v => LV.filter(l => mean(v, l.key) != null).map(l => ({ v, l, m: mean(v, l.key) })));
    const topLane = lanes.reduce((a, x) => (x.m > a.m ? x : a), lanes[0]);
    const out = [];
    if (lo && hi) out.push(`The profiled land runs from ${fmt.m(lo.stats.all.elev[0])} in ${lo.name} to ${fmt.m(hi.stats.all.elev[2])} in ${hi.name}.`);
    if (pcVl.length) out.push(`In ${countWord(pcLower.length)} of the ${countWord(pcVl.length)} profiles with both premier cru and village land, the premier cru land sits lower on average.`);
    if (gcPc.length) out.push(`In ${countWord(gcLower.length)} of the ${countWord(gcPc.length)} profiles with both grand cru and premier cru land, the grand cru land sits lower on average.`);
    if (topLane) out.push(`The highest mean belongs to ${topLane.l.word} land in ${topLane.v.name}, at ${fmt.m(topLane.m)}.`);
    out.push('Each bar runs from the lowest to the highest 5 m elevation cell of that level’s land. The dot marks the mean.');
    return out;
  }

  /* ======================================================================
     Table views
     ====================================================================== */
  function tableWrap(summary, label, table) {
    return h('details', { class: 'disclosure hx-table' },
      h('summary', {}, summary),
      h('div', { class: 'hx-table-scroll', attrs: { tabindex: '0', role: 'region', 'aria-label': label } }, table));
  }

  function areaTable() {
    const head = ['Profile', 'Region', 'Grand cru', 'Premier cru', 'Village land', 'Total', 'Grand and premier cru share'];
    return tableWrap('Fig. IV.1 as a table', 'Fig. IV.1 data table', h('table', { class: 'hx-tbl' },
      h('thead', {}, h('tr', {}, head.map((t, i) => h('th', { scope: 'col', class: i > 1 ? 'is-num' : '', text: t })))),
      h('tbody', {}, V.map(v => {
        const p = levelParts(v);
        const cell = x => h('td', { class: 'is-num num', text: x > 0 ? fmt.ha(x) : '–' });
        return h('tr', {},
          h('th', { scope: 'row', text: v.name }), h('td', { text: regionName(v.region) }),
          cell(p[0].ha), cell(p[1].ha), cell(p[2].ha),
          h('td', { class: 'is-num num', text: fmt.ha(total(v)) }),
          h('td', { class: 'is-num num', text: pctText(p[0].share + p[1].share) }));
      }))));
  }

  function elevTable() {
    const head = ['Profile', 'Level', 'Lowest', 'Mean', 'Highest', 'Mean slope'];
    return tableWrap('Fig. IV.2 as a table', 'Fig. IV.2 data table', h('table', { class: 'hx-tbl' },
      h('thead', {}, h('tr', {}, head.map((t, i) => h('th', { scope: 'col', class: i > 1 ? 'is-num' : '', text: t })))),
      h('tbody', {}, elevRows.flatMap(r => r.lanes.map((l, i) => h('tr', {},
        i === 0 ? h('th', { scope: 'row', attrs: { rowspan: String(r.lanes.length) }, text: r.v.name }) : null,
        h('td', { text: levelName(l.id) }),
        h('td', { class: 'is-num num', text: fmt.m(l.st.elev[0]) }),
        h('td', { class: 'is-num num', text: fmt.m(l.st.elev[1]) }),
        h('td', { class: 'is-num num', text: fmt.m(l.st.elev[2]) }),
        h('td', { class: 'is-num num', text: fmt.deg(l.st.slope) })))))));
  }
}
