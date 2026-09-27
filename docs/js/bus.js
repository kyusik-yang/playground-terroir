// Tiny event bus shared by all modules. Remembers the last payload of each event so a
// module that initialises late can catch up with bus.last(name).
//
// Events used in the atlas:
//   'region:select'  { region: 'all' | 'chablis' | 'cote-de-beaune' | 'cote-chalonnaise' | 'maconnais', source }
//   'village:focus'  { id, source, reveal?: 'map' | 'card' }   id = village id from data/villages.json
//   'feature:focus'  { id, source }                            id = feature id from data/index.json
//   'transect:show'  { id, source }                            id = transect id from data/transects.json
//   'compare:change' { ids: [villageId, ...] }                 up to 3 ids
//   'theme:change'   { theme: 'light' | 'dark' }

const handlers = new Map();
const lastPayload = new Map();

export const bus = {
  on(name, fn) {
    if (!handlers.has(name)) handlers.set(name, new Set());
    handlers.get(name).add(fn);
    return () => handlers.get(name).delete(fn);
  },
  emit(name, payload = {}) {
    lastPayload.set(name, payload);
    for (const fn of handlers.get(name) || []) {
      try { fn(payload); } catch (err) { console.error(`[bus] ${name} handler failed`, err); }
    }
  },
  last(name) { return lastPayload.get(name); },
};
