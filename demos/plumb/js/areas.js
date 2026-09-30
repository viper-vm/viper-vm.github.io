// Plumb — area statements: RERA carpet area and FSI under Gujarat's CGDCR 2017 (Ahmedabad,
// category D1 AUDA), measured from the analysed floors. Pure: no DOM, no storage.
//
// RERA Act 2016 §2(k): carpet area is the net usable floor area of an apartment, excluding external
// walls, service shafts, exclusive balcony or verandah area and exclusive open terrace area, but
// including the internal partition walls. Balconies and open terraces are stated separately.
// CGDCR 2017 Part II §6.3.2 lists the areas not counted towards FSI (staircases and lifts with their
// walls and landings, lofts up to 30%, parking…); balconies are not on that list, so they count, and
// Part I 2.70 counts every mezzanine in FSI.

/** CGDCR 2017 Part II, Table 6.5: use control and F.S.I., category D1 AUDA. Chargeable FSI is at 40% of the jantri rate. */
export const ZONES = [
  { code: 'R1', name: 'Residential Zone I', base: 1.8, chargeable: 0.9, max: 2.7 },
  { code: 'R2', name: 'Residential Zone II', base: 1.2, chargeable: 0.6, max: 1.8 },
  { code: 'R3', name: 'Residential Zone III', base: 0.3, chargeable: 0, max: 0.3 },
  { code: 'C2', name: 'Commercial Zone', base: 1.8, chargeable: 0.9, max: 2.7 },
  { code: 'C5', name: 'Central Business District', base: 1.8, chargeable: 3.6, max: 5.4 },
  { code: 'TOZ', name: 'Transit Oriented Zone', base: 1.8, chargeable: 2.2, max: 4.0, note: 'Base FSI as per the base zone; the maximum in TOZ is 4.0.' },
  { code: 'RAH', name: 'Residential Affordable Housing', base: 1.8, chargeable: 0.9, max: 2.7, note: 'Chargeable FSI for RAH-1 only; base as per the base zone.' },
  { code: 'CW', name: 'Core Walled City', base: 2.0, chargeable: 0, max: 2.0 },
  { code: 'GM', name: 'Gamtal', base: 2.0, chargeable: 0, max: 2.0 },
  { code: 'GME', name: 'Gamtal Extension', base: 1.2, chargeable: 0, max: 1.2 },
  { code: 'KZ1', name: 'Knowledge and Institutional Zone', base: 1.8, chargeable: 0, max: 1.8 },
  { code: 'LZ', name: 'Logistics Zone', base: 1.0, chargeable: 0.5, max: 1.5 },
  { code: 'IZ1', name: 'Industrial Zone General', base: 1.0, chargeable: 0.8, max: 1.8, note: 'Chargeable FSI for commercial use.' },
  { code: 'IZ5', name: 'Industrial Zone Special', base: 1.0, chargeable: 0, max: 1.0 },
];
export const zoneOf = (code) => ZONES.find((z) => z.code === code) || ZONES[0];

export const BUILDINGS = { house: 'Bungalow / row house (one unit)', apartments: 'Apartments', commercial: 'Commercial' };

/**
 * What a space is, and how each rule treats it.
 *   rera: 'carpet' (inside the unit's carpet area) | 'balcony' | 'terrace' (stated separately) | 'none'
 *   fsi:  'count' (built-up, counted) | 'exempt' (built-up, not counted, see rule) | 'none' (not built-up)
 */
export const USES = {
  room: { label: 'Room', rera: 'carpet', fsi: 'count' },
  balcony: { label: 'Balcony / verandah', rera: 'balcony', fsi: 'count' },
  terrace: { label: 'Open terrace', rera: 'terrace', fsi: 'none' },
  common: { label: 'Common area', rera: 'none', fsi: 'count' },
  stair: { label: 'Staircase', rera: 'none', fsi: 'exempt', rule: 'CGDCR 6.3.2(6)' },
  lift: { label: 'Lift', rera: 'none', fsi: 'exempt', rule: 'CGDCR 6.3.2(7)' },
  shaft: { label: 'Shaft / duct', rera: 'none', fsi: 'count' },
  parking: { label: 'Parking', rera: 'none', fsi: 'exempt', rule: 'CGDCR 6.3.2(3), (4)' },
  electric: { label: 'Electric room', rera: 'none', fsi: 'exempt', rule: 'CGDCR 6.3.2(10)' },
  pergola: { label: 'Pergola', rera: 'none', fsi: 'none', rule: 'CGDCR 6.3.2(13)' },
  ignore: { label: 'Not counted', rera: 'none', fsi: 'none' },
  review: { label: 'Needs a decision', rera: 'none', fsi: 'none' },
};
export const USE_ORDER = ['room', 'balcony', 'terrace', 'common', 'stair', 'lift', 'shaft', 'parking', 'electric', 'pergola', 'ignore', 'review'];

/** RERA treatment, which for a staircase depends on whose it is: inside a house it's part of the unit. */
export const reraOf = (use, building) => (use === 'stair' && building === 'house' ? 'carpet' : USES[use] ? USES[use].rera : 'none');

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** A room's key that survives re-reading the same drawing: floor, name and place to the half metre. */
export const roomKey = (floor, room) => `${norm(floor.title)}|${norm(room.label || room.name)}|${Math.round(room.cx * 2) / 2},${Math.round(room.cy * 2) / 2}`;

/**
 * What a space most likely is, from its type and name. Unnamed spaces wait for a decision. In a
 * building of flats, rooms on a floor that's mostly parking (a stilt floor) belong to everyone.
 */
export function defaultUse(room, { building = 'house', covered = false, parkingFloor = false } = {}) {
  const n = norm(room.label || room.name);
  if (/pergol/.test(n)) return 'pergola';
  if (/electric|meter room|substation|\be\.?r\.?\b/.test(n)) return 'electric';
  switch (room.type) {
    case 'stair': return 'stair';
    case 'lift': return 'lift';
    case 'duct': return room.name === 'Shaft?' ? 'review' : 'shaft';
    case 'parking': return 'parking';
    case 'balcony': return /terrace/.test(n) && !/covered|roofed/.test(n) && !covered ? 'terrace' : 'balcony';
    case 'circulation': return building !== 'house' && /lobby|corridor|common|landing/.test(n) ? 'common' : 'room';
    case 'unknown': return 'review';
    default: return building !== 'house' && parkingFloor ? 'common' : 'room';
  }
}

/** Is this spot of floor k under floor k+1? (floors are aligned by their transforms) */
function underNext(result, k, x, y) {
  const an = result.an[k + 1];
  if (!an || !an.inside || !an.grid) return false;
  const T0 = result.transforms[k], T1 = result.transforms[k + 1];
  const g = an.grid;
  const i = Math.floor((x + T0.tx - T1.tx - g.x0) / g.res), j = Math.floor((y + T0.ty - T1.ty - g.y0) / g.res);
  return i >= 0 && j >= 0 && i < g.w && j < g.h && an.inside[j * g.w + i] === 1;
}
function coveredAbove(result, k, room) {
  if (!room.poly || room.poly.length < 3) return underNext(result, k, room.cx, room.cy);
  const pts = [[room.cx, room.cy], ...room.poly.filter((_, i) => i % Math.max(1, Math.floor(room.poly.length / 8)) === 0).map((p) => [(p[0] + room.cx) / 2, (p[1] + room.cy) / 2])];
  return pts.filter(([x, y]) => underNext(result, k, x, y)).length > pts.length / 2;
}

/** A room label that names a flat: “FLAT 101”, “Unit B”, “A-302”, “2 BHK”. */
const FLAT_NAME = /^\s*((flat|unit|apartment|apt|shop|office|suite)\b.*|[A-Z]{0,2}\s?-?\s?\d{3,4}|\d\s?bhk.*)\s*$/i;
/** Flats numbered the usual way: floor then flat — 101, 102 on the first floor, G01 on the ground, B101 below. */
const flatNumber = (level, n) => `Flat ${level > 0 ? level : level === 0 ? 'G' : `B${-level}`}${String(n + 1).padStart(2, '0')}`;

/**
 * The flats of one floor. Every flat has a kitchen, so each space joins the kitchen it reaches through
 * the fewest doors and openings (open-plan zones count as joined), walking through unnamed halls but
 * never through a common space (lobby, stair, lift, shafts): those separate one flat from the next.
 * Where no kitchen is reached, spaces joined directly make a flat. Balconies and terraces go with their flat. Each flat's carpet area is its rooms plus the
 * partitions between two of its own rooms (RERA §2(k)); walls to the next flat or the lobby are not
 * internal partitions. flatOf: your reassignments { roomKey: flatKey | 'none' }; names: { flatKey: name }.
 */
export function flatsOf(an, rooms, { flatOf = {}, names = {}, level = 1 } = {}) {
  const inFlat = (r) => r.rera === 'carpet' || r.rera === 'balcony' || r.rera === 'terrace';
  const walkable = (r) => inFlat(r) || r.use === 'review'; // an unnamed hall inside a flat still joins its rooms
  const byId = new Map(rooms.map((r) => [r.i, r]));
  const cOf = (r) => [an.rooms[r.i].cx, an.rooms[r.i].cy];
  // who opens onto whom: zones of one open-plan space, and doors and openings (not windows)
  const nb = new Map(rooms.map((r) => [r.i, new Set()]));
  const link = (a, b) => { if (a !== b) { nb.get(a).add(b); nb.get(b).add(a); } };
  const regionOf = new Map();
  for (const r of rooms) { const rg = an.rooms[r.i].region; if (regionOf.has(rg)) link(regionOf.get(rg), r.i); else regionOf.set(rg, r.i); }
  for (const o of an.openings || []) if (o.kind !== 'window' && byId.has(o.a) && byId.has(o.b)) link(o.a, o.b);
  const owner = new Map();
  // every flat has a kitchen: each space joins the kitchen it reaches through the fewest doorways,
  // never through a lobby, stair or lift (a tie goes to the nearer kitchen)
  const kitchens = rooms.filter((r) => r.type === 'kitchen' && r.rera === 'carpet');
  if (kitchens.length) {
    const dist = new Map(), q = [];
    for (const k of kitchens) { dist.set(k.i, 0); owner.set(k.i, k.i); q.push(k.i); }
    for (let h = 0; h < q.length; h++) {
      const c = q[h], d = dist.get(c), src = owner.get(c);
      for (const n of nb.get(c)) {
        const r = byId.get(n);
        if (!walkable(r)) continue;
        if (!dist.has(n)) { dist.set(n, d + 1); owner.set(n, src); q.push(n); }
        else if (dist.get(n) === d + 1 && owner.get(n) !== src) {
          const [x, y] = cOf(r), a = cOf(byId.get(src)), b = cOf(byId.get(owner.get(n)));
          if (Math.hypot(x - a[0], y - a[1]) < Math.hypot(x - b[0], y - b[1])) owner.set(n, src);
        }
      }
    }
  }
  // no kitchen reached: spaces joined directly (not through unnamed ones) make a flat of their own
  const parent = new Map(rooms.map((r) => [r.i, r.i]));
  const find = (i) => (parent.get(i) === i ? i : (parent.set(i, find(parent.get(i))), parent.get(i)));
  for (const r of rooms) if (inFlat(r) && !owner.has(r.i)) for (const n of nb.get(r.i)) { const o = byId.get(n); if (inFlat(o) && !owner.has(n)) parent.set(find(n), find(r.i)); }
  const groups = new Map();
  for (const r of rooms) {
    if (!inFlat(r) && !(r.use === 'review' && owner.has(r.i))) continue;
    const g = owner.has(r.i) ? 'k' + owner.get(r.i) : 'c' + find(r.i);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }
  // a flat has carpet in it (a balcony cut off from every flat joins the one it's next to)
  // (on a floor with kitchens, a space no kitchen reaches — its door wasn't found — goes to the nearest flat)
  const isFlat = ([id, g]) => (kitchens.length ? id[0] === 'k' : g.some((r) => r.rera === 'carpet'));
  let flats = [...groups.entries()].filter(isFlat).map(([id, g]) => {
    const anchor = id[0] === 'k' ? byId.get(+id.slice(1)) : g.slice().sort((p, q) => q.area - p.area)[0];
    return { key: anchor.key, rooms: g };
  });
  const loose = [...groups.entries()].filter((e) => !isFlat(e)).flatMap(([, g]) => g).filter(inFlat);
  for (const r of loose) {
    let best = null, bd = Infinity;
    for (const f of flats) for (const q of f.rooms) { const [x, y] = cOf(r), [u, v] = cOf(q), d = Math.hypot(x - u, y - v); if (d < bd) { bd = d; best = f; } }
    if (best && bd < 12) best.rooms.push(r);
  }
  // your reassignments
  const byKey = new Map(flats.map((f) => [f.key, f]));
  for (const r of rooms) {
    const want = flatOf[r.key];
    if (!want) continue;
    const from = flats.find((f) => f.rooms.includes(r));
    const to = want === 'none' ? null : byKey.get(want);
    if (want !== 'none' && !to) continue; // that flat isn't there any more
    if (from) from.rooms = from.rooms.filter((q) => q !== r);
    if (to) to.rooms.push(r);
  }
  flats = flats.filter((f) => f.rooms.length);
  // left to right, then top to bottom, as the plan reads
  const mid = (f) => { const c = f.rooms.map(cOf); return [c.reduce((a, p) => a + p[0], 0) / c.length, c.reduce((a, p) => a + p[1], 0) / c.length]; };
  flats.forEach((f) => { f.at = mid(f); });
  flats.sort((a, b) => (Math.abs(a.at[0] - b.at[0]) > 3 ? a.at[0] - b.at[0] : b.at[1] - a.at[1]));
  const walls = an.walls || { owned: [] };
  return flats.map((f, n) => {
    const ids = new Set(f.rooms.map((r) => r.i));
    const carpetIds = new Set(f.rooms.filter((r) => r.rera === 'carpet').map((r) => r.i));
    let partitions = 0;
    for (const r of f.rooms) {
      const o = walls.owned[r.i];
      if (!o || !carpetIds.has(r.i)) continue;
      for (const [b, frac] of Object.entries(o.faces)) if (b !== 'out' && carpetIds.has(+b)) partitions += o.area * frac;
    }
    const sum = (k) => f.rooms.reduce((a, r) => a + (r.rera === k ? r.area : 0), 0);
    const labelled = f.rooms.map((r) => String(r.label || '').trim()).find((t) => FLAT_NAME.test(t));
    const bedrooms = f.rooms.filter((r) => r.type === 'bedroom').length, kitchen = f.rooms.some((r) => r.type === 'kitchen');
    const carpetRooms = sum('carpet');
    return {
      key: f.key, n, name: names[f.key] || labelled || flatNumber(level, n), named: !!(names[f.key] || labelled),
      rooms: f.rooms.map((r) => r.i).filter((i) => ids.has(i)), kind: kitchen && bedrooms ? `${bedrooms} BHK` : kitchen ? '1 RK' : '',
      carpetRooms, partitions, carpet: carpetRooms + partitions, balcony: sum('balcony'), terrace: sum('terrace'),
      pending: f.rooms.filter((r) => r.use === 'review').length,
    };
  });
}

/**
 * Landings at floor level not counted towards FSI (CGDCR 2017 Part II §6.3.2):
 *   (6) a staircase's landing up to twice the width of the stair (x): its width plus 0.5x each side,
 *       taken here as 2x wide by x deep;
 *   (7), (8) a lift's landing 2x wide (the well with its walls, x, plus 0.5x each side) by 2x deep.
 * What's left out is the landing space actually there — lobbies, landings and passages opening onto the
 * stair or lift (common ones, in a building of flats) — up to those allowances. Stair widths come from
 * the treads where the flight was measured, else the smallest Table 13.2 allows.
 */
export function landingsOf(an, rooms, building) {
  const cores = rooms.filter((r) => r.use === 'stair' || r.use === 'lift');
  const none = { allowance: 0, space: 0, exempt: 0, cores: [], spaces: [] };
  if (!cores.length) return none;
  const res = (an.grid && an.grid.res) || an.res || 0.04;
  const byId = new Map(rooms.map((r) => [r.i, r]));
  const nb = new Map(rooms.map((r) => [r.i, new Set()]));
  const link = (a, b) => { if (a !== b && nb.has(a) && nb.has(b)) { nb.get(a).add(b); nb.get(b).add(a); } };
  const regionOf = new Map();
  for (const r of rooms) { const rg = an.rooms[r.i].region; if (regionOf.has(rg)) for (const o of regionOf.get(rg)) link(o, r.i); regionOf.set(rg, [...(regionOf.get(rg) || []), r.i]); }
  for (const o of an.openings || []) if (o.kind !== 'window') link(o.a, o.b);
  const out = cores.map((r) => {
    const room = an.rooms[r.i];
    if (r.use === 'stair') {
      const flights = (an.stairs || []).filter((q) => q.room === r.i);
      const x = flights.length ? Math.max(...flights.map((q) => q.width)) : building === 'house' ? 1.0 : 1.2;
      return { i: r.i, name: r.name, use: 'stair', x, measured: flights.length > 0, allow: 2 * x * x };
    }
    const [i0, j0, i1, j1] = room.bbox || [0, 0, 0, 0];
    const x = Math.max(i1 - i0 + 1, j1 - j0 + 1) * res + 0.3; // the well with its walls (15 cm each side)
    return { i: r.i, name: r.name, use: 'lift', x, measured: true, allow: 4 * x * x };
  });
  const landing = (r) => r.type === 'circulation' && r.fsi === 'count' && (building === 'house' || r.use === 'common');
  const spaces = new Set();
  for (const c of cores) for (const n of nb.get(c.i)) if (landing(byId.get(n))) spaces.add(n);
  const space = [...spaces].reduce((a, i) => a + byId.get(i).area, 0);
  const allowance = out.reduce((a, c) => a + c.allow, 0);
  return { allowance, space, exempt: Math.min(space, allowance), cores: out, spaces: [...spaces] };
}

/** A floor that's a mezzanine: titled so, or at a level between two floors (not a lower ground). */
export const isMezzFloor = (f) => /\bmezz/i.test(f.title || '') || (f.level > 0 && f.level % 1 !== 0);

/**
 * Mezzanines over rooms: marked in the drawing (“MEZZANINE ABOVE”) or added by you; the area is yours
 * if you gave one, else the outline round the note, measured. CGDCR Part I 2.70: a mezzanine's area is counted in FSI, all of it; Part III 13.1.8: no more
 * than 30% of the room it's in. Usable floor, so inside a unit it's carpet area too.
 */
function mezzOf(an, rooms, set = {}) {
  return rooms.filter((r) => (set[r.key] === false ? false : set[r.key] != null || !!an.rooms[r.i].mezz)).map((r) => {
    const v = set[r.key], yours = v && Number.isFinite(+v.area) && +v.area > 0 ? +v.area : null, measured = an.rooms[r.i].mezzArea ?? null;
    const area = yours ?? measured;
    return { i: r.i, key: r.key, name: r.name, roomArea: r.area, area, yours: yours != null, measured, limit: 0.3 * r.area, over: area ? Math.max(0, area - 0.3 * r.area) : 0, detected: !!an.rooms[r.i].mezz, carpet: r.rera === 'carpet' };
  });
}

/**
 * Lofts: marked in the drawing (“LOFT ABOVE”) or added by you. The area is yours if you gave one, else
 * the outline round the note, measured; up to 30% of the room below is free (§6.3.2(5)).
 */
function loftsOf(an, rooms, set = {}) {
  return rooms.filter((r) => (set[r.key] === false ? false : set[r.key] != null || !!an.rooms[r.i].loft)).map((r) => {
    const v = set[r.key], yours = v && Number.isFinite(+v.area) && +v.area > 0 ? +v.area : null, measured = an.rooms[r.i].loftArea ?? null;
    const area = yours ?? measured;
    const allowed = 0.3 * r.area;
    return { i: r.i, key: r.key, name: r.name, roomArea: r.area, area, yours: yours != null, measured, allowed, free: area ? Math.min(area, allowed) : 0, excess: area ? Math.max(0, area - allowed) : 0, detected: !!an.rooms[r.i].loft };
  });
}

/**
 * The area statement of an analysed building.
 * setup: { building: 'house'|'apartments'|'commercial', plot (m²) | null, zone, base, chargeable, max, uses: { [roomKey]: use } }
 */
export function areaStatement(result, setup = {}) {
  const building = setup.building || 'house';
  const z = zoneOf(setup.zone || 'R1');
  const base = num(setup.base, z.base), chargeable = num(setup.chargeable, z.chargeable), max = num(setup.max, z.max);
  const uses = setup.uses || {};
  const floors = result.floors.map((f, k) => {
    const an = result.an[k];
    const repeat = Math.max(1, f.repeat || 1);
    const all = an.rooms.reduce((a, r) => a + r.area, 0);
    const parkingFloor = all > 0 && an.rooms.reduce((a, r) => a + (r.type === 'parking' ? r.area : 0), 0) >= 0.4 * all;
    const rooms = an.rooms.map((r, i) => {
      const key = roomKey(f, r);
      const auto = defaultUse(r, { building, parkingFloor, covered: r.type === 'balcony' ? coveredAbove(result, k, r) : false });
      const use = USES[uses[key]] ? uses[key] : auto;
      return { i, key, name: r.name, label: r.label, type: r.type, area: r.area, use, auto, set: use !== auto, rera: reraOf(use, building), fsi: USES[use].fsi, rule: USES[use].rule || '' };
    });
    const sum = (pred) => rooms.reduce((a, r) => a + (pred(r) ? r.area : 0), 0);
    // walls: a partition has carpet on both sides; everything else of the floor's walls is outer. In
    // a building of flats only the partitions inside a flat count: a wall between two flats isn't one.
    const walls = an.walls || { total: 0, outside: 0, owned: [] };
    const flats = building === 'apartments' ? flatsOf(an, rooms, { flatOf: setup.flatOf || {}, names: setup.flatNames || {}, level: f.level ?? k }) : [];
    const flatOfRoom = new Map();
    flats.forEach((fl, n) => { for (const i of fl.rooms) flatOfRoom.set(i, n); });
    rooms.forEach((r) => { r.flat = flatOfRoom.has(r.i) ? flats[flatOfRoom.get(r.i)].key : null; });
    let partitions = 0;
    if (building === 'apartments') partitions = flats.reduce((a, fl) => a + fl.partitions, 0);
    else rooms.forEach((r) => {
      const o = walls.owned[r.i];
      if (!o || r.rera !== 'carpet') return;
      for (const [b, frac] of Object.entries(o.faces)) if (b !== 'out' && rooms[+b] && rooms[+b].rera === 'carpet') partitions += o.area * frac;
    });
    const pergola = sum((r) => r.use === 'pergola') + (an.patternArea || 0);
    // the stair and the lift are left out with their walls (§6.3.2(6), (7)), and their landings up to the allowances
    const wallsOf = (u) => rooms.reduce((a, r) => a + (r.use === u && walls.owned[r.i] ? walls.owned[r.i].area : 0), 0);
    const landings = landingsOf(an, rooms, building);
    const lofts = loftsOf(an, rooms, setup.lofts || {});
    const loftArea = lofts.reduce((a, l) => a + (l.area || 0), 0);
    // a mezzanine plan is a floor of its own (already measured); one marked over a room is added here
    const mezzFloor = isMezzFloor(f);
    const mezz = mezzFloor ? [] : mezzOf(an, rooms, setup.mezz || {});
    const mezzArea = mezz.reduce((a, m) => a + (m.area || 0), 0);
    const mezzCarpet = mezz.reduce((a, m) => a + (m.carpet && m.area ? m.area : 0), 0);
    for (const m of mezz) if (m.carpet && m.area) { const fl = flats.find((q) => q.rooms.includes(m.i)); if (fl) { fl.mezz = (fl.mezz || 0) + m.area; fl.carpet += m.area; } }
    const exempt = [
      ...['stair', 'lift'].map((u) => ({ use: u, label: `${USES[u].label}, with its walls`, short: u === 'stair' ? 'stairs' : 'lifts', rule: USES[u].rule, area: sum((r) => r.use === u) + wallsOf(u), walls: wallsOf(u) })),
      { use: 'landing', label: 'Stair and lift landings', short: 'landings', rule: 'CGDCR 6.3.2(6), (7)', area: landings.exempt },
      { use: 'loft', label: 'Lofts, up to 30% of their room', short: 'lofts', rule: 'CGDCR 6.3.2(5)', area: lofts.reduce((a, l) => a + l.free, 0) },
      ...['parking', 'electric'].map((u) => ({ use: u, label: USES[u].label, short: u === 'parking' ? 'parking' : 'electric rooms', rule: USES[u].rule, area: sum((r) => r.use === u) })),
    ].filter((e) => e.area > 0.005);
    const builtUp = sum((r) => r.fsi === 'count' || r.fsi === 'exempt') + walls.total + loftArea + mezzArea;
    const exemptArea = exempt.reduce((a, e) => a + e.area, 0);
    return {
      k, title: f.title, level: f.level, repeat, rooms, flats,
      carpet: sum((r) => r.rera === 'carpet') + partitions + mezzCarpet,
      carpetRooms: sum((r) => r.rera === 'carpet'), partitions,
      balcony: sum((r) => r.rera === 'balcony'),
      terrace: sum((r) => r.rera === 'terrace'),
      common: sum((r) => r.use === 'common' || (building !== 'house' && (r.use === 'stair' || r.use === 'lift'))),
      shafts: sum((r) => r.use === 'shaft'),
      walls: walls.total, outerWalls: walls.total - partitions,
      builtUp, exempt, exemptArea, fsiArea: builtUp - exemptArea, pergola, landings, lofts, loft: loftArea, mezz, mezzArea, mezzFloor,
      review: rooms.filter((r) => r.use === 'review'),
    };
  });
  // a mezzanine plan against the floor it overlooks (the nearest full floor below): 30% at most
  floors.forEach((f, k) => {
    if (!f.mezzFloor) return;
    const below = floors.slice(0, k).reverse().find((g) => !g.mezzFloor);
    const inside = (g) => g.rooms.reduce((a, r) => a + (r.fsi !== 'none' ? r.area : 0), 0);
    f.overlooks = below ? { k: below.k, title: below.title, area: inside(below), share: inside(f) / Math.max(1e-9, inside(below)) } : null;
  });
  const total = (key) => floors.reduce((a, f) => a + f[key] * f.repeat, 0);
  const totals = {
    builtUp: total('builtUp'), exemptArea: total('exemptArea'), fsiArea: total('fsiArea'),
    carpet: total('carpet'), balcony: total('balcony'), terrace: total('terrace'), common: total('common'),
    shafts: total('shafts'), walls: total('walls'), pergola: total('pergola'), loft: total('loft'),
    mezz: total('mezzArea') + floors.reduce((a, f) => a + (f.mezzFloor ? f.builtUp * f.repeat : 0), 0),
    review: floors.reduce((a, f) => a + f.review.reduce((b, r) => b + r.area, 0) * f.repeat, 0),
    flats: floors.reduce((a, f) => a + f.flats.length * f.repeat, 0),
  };
  const plot = num(setup.plot, null);
  const fsi = { zone: z, base, chargeable, max, plot };
  if (plot > 0) {
    fsi.consumed = totals.fsiArea / plot;
    fsi.baseArea = base * plot;
    fsi.maxArea = max * plot;
    fsi.chargeableUsed = Math.max(0, Math.min(totals.fsiArea, fsi.maxArea) - fsi.baseArea);
    fsi.over = Math.max(0, totals.fsiArea - fsi.maxArea);
    fsi.balance = fsi.maxArea - totals.fsiArea;
    fsi.status = totals.fsiArea <= fsi.baseArea + 1e-6 ? 'base' : fsi.over > 1e-6 ? 'over' : 'chargeable';
  }
  return { building, floors, totals, fsi };
}

/** Flats have a kitchen each: two or more on a floor is a building of flats. */
export function guessBuilding(result) {
  const most = Math.max(0, ...result.an.map((a) => a.rooms.filter((r) => r.type === 'kitchen').length));
  return most >= 2 ? 'apartments' : 'house';
}
/** The project's area setup (plot, zone, FSI, room uses), created with the zone's defaults on first use. */
export function areaSetup(P, result) {
  if (!P.areas) {
    const z = zoneOf('R1');
    P.areas = { building: guessBuilding(result), plot: null, zone: z.code, base: z.base, chargeable: z.chargeable, max: z.max, uses: {} };
  }
  P.areas.uses ||= {};
  return P.areas;
}

function num(v, d) { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? n : d; }

/** The statement as CSV (m², two decimals), floor by floor, then the rooms. */
export function statementCSV(st, { project = '', rev = '' } = {}) {
  const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '');
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const rows = [
    [q(`Area statement — ${project} ${rev}`.trim())], [],
    ['Floor', 'Times', 'Built-up (m²)', 'Not in FSI (m²)', 'FSI area (m²)', 'RERA carpet (m²)', 'Balcony / verandah (m²)', 'Open terrace (m²)', 'Common (m²)', 'Shafts (m²)', 'Walls (m²)', 'Pergola (m²)', 'Needs a decision (m²)'].map(q),
    ...st.floors.map((f) => [q(f.title), f.repeat, f2(f.builtUp), f2(f.exemptArea), f2(f.fsiArea), f2(f.carpet), f2(f.balcony), f2(f.terrace), f2(f.common), f2(f.shafts), f2(f.walls), f2(f.pergola), f2(f.review.reduce((a, r) => a + r.area, 0))]),
    [q('Total'), '', f2(st.totals.builtUp), f2(st.totals.exemptArea), f2(st.totals.fsiArea), f2(st.totals.carpet), f2(st.totals.balcony), f2(st.totals.terrace), f2(st.totals.common), f2(st.totals.shafts), f2(st.totals.walls), f2(st.totals.pergola), f2(st.totals.review)],
    [],
  ];
  const F = st.fsi;
  rows.push([q('Zone'), q(`${F.zone.code} — ${F.zone.name}`)], [q('Plot area (m²)'), f2(F.plot)], [q('FSI base / chargeable / maximum'), F.base, F.chargeable, F.max]);
  if (F.plot > 0) rows.push([q('FSI consumed'), F.consumed.toFixed(3)], [q('Balance to maximum (m²)'), f2(F.balance)]);
  if (st.floors.some((f) => f.landings.cores.length)) {
    rows.push([], ['Floor', 'Stair or lift', 'x (m)', 'Landing allowed (m²)', 'Landing space there (m²)', 'Not in FSI (m²)'].map(q));
    for (const f of st.floors) f.landings.cores.forEach((c, n) => rows.push([q(f.title), q(c.name), f2(c.x), f2(c.allow), n === 0 ? f2(f.landings.space) : '', n === 0 ? f2(f.landings.exempt) : '']));
  }
  if (st.floors.some((f) => f.lofts.length)) {
    rows.push([], ['Floor', 'Loft over', 'Room (m²)', 'Loft (m²)', 'Free up to 30% (m²)', 'Counted in FSI (m²)'].map(q));
    for (const f of st.floors) for (const l of f.lofts) rows.push([q(f.title), q(l.name), f2(l.roomArea), f2(l.area), f2(l.allowed), f2(l.excess)]);
  }
  if (st.floors.some((f) => f.mezz.length || f.mezzFloor)) {
    rows.push([], ['Floor', 'Mezzanine', 'Area (m²)', 'Of (m²)', 'Limit 30% (m²)', 'In FSI (m²)'].map(q));
    for (const f of st.floors) {
      if (f.mezzFloor) rows.push([q(f.title), q('The whole plan'), f2(f.builtUp), f2(f.overlooks ? f.overlooks.area : null), f2(f.overlooks ? 0.3 * f.overlooks.area : null), f2(f.builtUp)]);
      for (const m of f.mezz) rows.push([q(f.title), q(`Over ${m.name}`), f2(m.area), f2(m.roomArea), f2(m.limit), f2(m.area)]);
    }
  }
  if (st.floors.some((f) => f.flats.length)) {
    rows.push([], ['Floor', 'Times', 'Flat', 'Type', 'RERA carpet (m²)', 'Rooms (m²)', 'Internal walls (m²)', 'Balcony / verandah (m²)', 'Open terrace (m²)'].map(q));
    for (const f of st.floors) for (const fl of f.flats) rows.push([q(f.title), f.repeat, q(fl.name), q(fl.kind), f2(fl.carpet), f2(fl.carpetRooms), f2(fl.partitions), f2(fl.balcony), f2(fl.terrace)]);
  }
  rows.push([], ['Floor', 'Room', 'Type', 'Area (m²)', 'Counts as', 'RERA', 'FSI', 'Rule'].map(q));
  for (const f of st.floors) for (const r of f.rooms) rows.push([q(f.title), q(r.name), q(r.type), f2(r.area), q(USES[r.use].label), q(r.rera), q(r.fsi), q(r.rule)]);
  return rows.map((r) => r.join(',')).join('\r\n') + '\r\n';
}
