// Plumb — area statements: RERA carpet area and FSI under Gujarat's CGDCR 2017 (Ahmedabad,
// category D1 AUDA), measured from the analysed floors. Pure: no DOM, no storage.
//
// RERA Act 2016 §2(k): carpet area is the net usable floor area of an apartment, excluding external
// walls, service shafts, exclusive balcony or verandah area and exclusive open terrace area, but
// including the internal partition walls. Balconies and open terraces are stated separately.
// CGDCR 2017 Part II §6.3.2 lists the areas not counted towards FSI (staircases, lifts, parking…);
// balconies are not on that list, so they count.

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
    // walls: a partition has carpet on both sides; everything else of the floor's walls is outer
    const walls = an.walls || { total: 0, outside: 0, owned: [] };
    let partitions = 0;
    rooms.forEach((r) => {
      const o = walls.owned[r.i];
      if (!o || r.rera !== 'carpet') return;
      for (const [b, frac] of Object.entries(o.faces)) if (b !== 'out' && rooms[+b] && rooms[+b].rera === 'carpet') partitions += o.area * frac;
    });
    const pergola = sum((r) => r.use === 'pergola') + (an.patternArea || 0);
    const exempt = ['stair', 'lift', 'parking', 'electric'].map((u) => ({ use: u, label: USES[u].label, rule: USES[u].rule, area: sum((r) => r.use === u) })).filter((e) => e.area > 0.005);
    const builtUp = sum((r) => r.fsi === 'count' || r.fsi === 'exempt') + walls.total;
    const exemptArea = exempt.reduce((a, e) => a + e.area, 0);
    return {
      k, title: f.title, level: f.level, repeat, rooms,
      carpet: sum((r) => r.rera === 'carpet') + partitions,
      carpetRooms: sum((r) => r.rera === 'carpet'), partitions,
      balcony: sum((r) => r.rera === 'balcony'),
      terrace: sum((r) => r.rera === 'terrace'),
      common: sum((r) => r.use === 'common' || (building !== 'house' && (r.use === 'stair' || r.use === 'lift'))),
      shafts: sum((r) => r.use === 'shaft'),
      walls: walls.total, outerWalls: walls.total - partitions,
      builtUp, exempt, exemptArea, fsiArea: builtUp - exemptArea, pergola,
      review: rooms.filter((r) => r.use === 'review'),
    };
  });
  const total = (key) => floors.reduce((a, f) => a + f[key] * f.repeat, 0);
  const totals = {
    builtUp: total('builtUp'), exemptArea: total('exemptArea'), fsiArea: total('fsiArea'),
    carpet: total('carpet'), balcony: total('balcony'), terrace: total('terrace'), common: total('common'),
    shafts: total('shafts'), walls: total('walls'), pergola: total('pergola'),
    review: floors.reduce((a, f) => a + f.review.reduce((b, r) => b + r.area, 0) * f.repeat, 0),
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
  rows.push([], ['Floor', 'Room', 'Type', 'Area (m²)', 'Counts as', 'RERA', 'FSI', 'Rule'].map(q));
  for (const f of st.floors) for (const r of f.rooms) rows.push([q(f.title), q(r.name), q(r.type), f2(r.area), q(USES[r.use].label), q(r.rera), q(r.fsi), q(r.rule)]);
  return rows.map((r) => r.join(',')).join('\r\n') + '\r\n';
}
