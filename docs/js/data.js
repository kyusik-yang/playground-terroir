// Data loading with a per-URL promise cache. Paths are relative to docs/.
// Schemas are documented in docs/data/README.md.

const cache = new Map();

export function json(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(path).then(r => {
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return r.json();
    }).catch(err => { cache.delete(path); throw err; }));
  }
  return cache.get(path);
}

export const index = () => json('data/index.json');
export const villages = () => json('data/villages.json');
export const overview = () => json('data/terroir-overview.geojson');
export const region = id => json(`data/terroir-${id}.geojson`);
export const transects = () => json('data/transects.json');
export const climate = () => json('data/climate.json');
export const sources = () => json('data/sources.json');

/** Look up one feature record from index.json by id. */
export async function feature(id) {
  const idx = await index();
  return idx.features.find(f => f.id === id) || null;
}

/** Look up one village profile by id. */
export async function village(id) {
  const v = await villages();
  return v.villages.find(x => x.id === id) || null;
}
