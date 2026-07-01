// ============================================================
//  GameRegistry — the extension point.
//  Each game module calls register({...}) once at import time.
//  The lobby, router, analytics and strategy engine all read the
//  registry, so ADDING A GAME = new games/*.js + one register()
//  call + an import in app.js. Nothing else needs to change.
//
//  A game definition:
//    {
//      id, name, tagline, icon (lucide), accent (css color),
//      category, houseEdge,
//      logic: {
//        floatsNeeded(params) -> int,
//        resolve(floats, params) -> {
//          multiplier, won:boolean, payout, detail, meta
//        },
//        // optional: strategy support
//        strategy: {
//          params: [ {key,label,type,default,min,max,step,options} ],
//          defaultParams() -> params,
//          // maps a strategy "unit bet" run into resolve() params
//        }
//      },
//      create(ctx) -> GameInstance  // builds the interactive UI
//    }
// ============================================================

const _games = new Map();

export const registry = {
  register(def) {
    if (!def || !def.id) throw new Error('registry.register: missing id');
    if (_games.has(def.id)) {
      console.warn(`[registry] "${def.id}" already registered — overwriting`);
    }
    _games.set(def.id, def);
    return def;
  },
  get(id) {
    return _games.get(id) || null;
  },
  has(id) {
    return _games.has(id);
  },
  all() {
    return [..._games.values()];
  },
  ids() {
    return [..._games.keys()];
  },
};
