// Plumb — bye-law checks: the drawings against Gujarat's CGDCR 2017 (Ahmedabad, category D1 AUDA),
// Part II (planning) and Part III (performance), plus NBC 2016's room sizes as good practice (CGDCR
// sets none). Pure: no DOM, no storage. Every rule carries its clause, what it needs, what was
// measured and where; anything the plans can't show (the road, the plot, the margins) is asked for.
//
// Thresholds are read from the notified text (CGDCR 2017 Part II and Part III as published by UD&UHD
// Gujarat); a checking aid, never an approval.

import { areaStatement } from './areas.js';

/** CGDCR Table 6.3 building uses that change the rules. */
export const BUILDING_USES = {
  DW1: { label: 'Bungalow', long: 'Dwelling-1 · detached house' },
  DW2: { label: 'Row house', long: 'Dwelling-2 · semi-detached, row house, tenement' },
  DW3: { label: 'Apartments', long: 'Dwelling-3 · apartments, hostel' },
  M: { label: 'Commercial', long: 'Mercantile, business and other non-residential' },
};
const fromBuilding = { house: 'DW1', apartments: 'DW3', commercial: 'M' };
const isHouse = (u) => u === 'DW1' || u === 'DW2';

/** Table 6.23, D1 except GMC: the tallest building a road allows. */
export function heightForRoad(road) {
  if (!(road > 0)) return null;
  return road < 9 ? 10 : road < 12 ? 16.5 : road < 18 ? 30 : road < 36 ? 45 : 70;
}
/** Table 6.24, category D1: road-side margin by road width. */
export function roadMargin(road) {
  if (!(road > 0)) return null;
  return road <= 9 ? 2.5 : road <= 15 ? 3.0 : road < 18 ? 4.5 : road < 30 ? 6.0 : road < 45 ? 7.5 : 9.0;
}
/**
 * Table 6.26: rear and side margins. Dwelling-1 and 2 go by plot size; everything else by height.
 * Returns { rear, side, sides: 'one'|'both'|'any', text }.
 */
export function sideRear(use, plot, height) {
  if (isHouse(use)) {
    if (!(plot > 0)) return null;
    if (plot <= 25) return { rear: 0, side: 0, sides: 'none', text: 'none needed (G+1 only)' };
    if (plot <= 80) return { rear: 0, side: 1.0, sides: 'any', text: '1.0 m on any one side, rear included' };
    if (plot <= 150) return { rear: 0, side: 1.5, sides: 'any', text: '1.5 m on any one side, rear included' };
    if (plot <= 300) return { rear: 2.0, side: 1.5, sides: 'one', text: 'rear 2.0 m, 1.5 m on one side' };
    if (plot <= 500) return { rear: 3.0, side: 2.0, sides: 'both', text: 'rear 3.0 m, 2.0 m both sides' };
    return { rear: 3.0, side: 3.0, sides: 'both', text: 'rear 3.0 m, 3.0 m both sides' };
  }
  if (!(height > 0)) return null;
  const m = height <= 16.5 ? 3.0 : height <= 25 ? (plot > 0 && plot <= 750 ? 3.0 : 4.0) : height <= 45 ? 6.0 : 8.0;
  return { rear: m, side: m, sides: 'both', text: `${m.toFixed(1)} m rear and both sides` };
}
/** Table 13.2: staircase flight width, tread, riser. */
export function stairRule(use, height) {
  if (isHouse(use)) return { width: 1.0, tread: 0.25, riser: 0.2, row: '1a' };
  if (use === 'DW3') return height > 25 ? { width: 2.0, tread: 0.3, riser: 0.16, row: '1f' } : height > 12 ? { width: 1.5, tread: 0.25, riser: 0.18, row: '1c' } : { width: 1.2, tread: 0.25, riser: 0.18, row: '1b' };
  return height > 25 ? { width: 2.0, tread: 0.3, riser: 0.16, row: '2b' } : { width: 1.5, tread: 0.3, riser: 0.16, row: '2a' };
}
/** Table 6.44: car parking for a house, by plinth area of the unit. */
export function housePark(plinth) {
  if (!(plinth > 100)) return 0;
  return 1 + Math.ceil(Math.max(0, plinth - 300) / 100 - 1e-9);
}
const CAR = 2.5 * 5.5; // 13.2.2(1)

/** NBC 2016 Part 3, 8.1: minimum room sizes (good practice in Ahmedabad; CGDCR sets none). */
export const NBC = {
  habitable: { area: 7.5, width: 2.1, main: 9.5, mainWidth: 2.4 },
  kitchen: { area: 5.0, width: 1.8 },
  bath: { area: 1.8, width: 1.2 },
  wc: { area: 1.1, width: 0.9 },
  both: { area: 2.8, width: 1.2 },
};
const toiletKind = (name) => {
  const n = String(name || '').toLowerCase();
  const wc = /\bw\.?\s?c\b|water closet|powder|lav/.test(n), bath = /bath|shower/.test(n);
  return wc && !bath ? 'wc' : bath && !wc ? 'bath' : 'both';
};

const HABITABLE = new Set(['bedroom', 'living', 'kitchen']);
const OPEN_SIDE = new Set(['balcony']); // a verandah or balcony is the semi-open space of 13.4.1(1)

/** The project's check setup, filled in with what can be guessed. */
export function ruleSetup(P) {
  const s = P.rules || {};
  return {
    use: BUILDING_USES[s.use] ? s.use : fromBuilding[(P.areas && P.areas.building) || 'house'] || 'DW1',
    road: num(s.road), height: num(s.height), units: num(s.units), cars: num(s.cars), parking: num(s.parking),
    margins: { road: num(s.margins && s.margins.road), side: num(s.margins && s.margins.side), rear: num(s.margins && s.margins.rear) },
    nbc: s.nbc !== false,
  };
}
function num(v) { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) && n >= 0 ? n : null; }

const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
const m = (v) => `${f2(v)} m`, sq = (v) => `${f2(v)} m²`;

/**
 * Check a building. result: the packed analysis; setup: ruleSetup(P); areas: P.areas (plot, uses);
 * heights: the storey heights in use { floor, slab, door, sill, head }.
 * Returns { facts, groups: [{ id, title, rules }], counts }. A rule is
 * { id, clause, title, need, status: 'pass'|'fail'|'warn'|'need'|'na', value, note, items: [{ k, room, name, value, status }] }.
 */
export function checkBuilding(result, setup, { areas = {}, heights = {} } = {}) {
  const H = { floor: 3.0, slab: 0.15, door: 2.1, sill: 0.9, head: 2.1, ...heights };
  const use = setup.use;
  const st = areaStatement(result, { ...areas, building: use === 'DW3' ? 'apartments' : use === 'M' ? 'commercial' : 'house' });
  const floors = result.floors.map((f, k) => ({ f, k, an: result.an[k], st: st.floors[k], rep: Math.max(1, f.repeat || 1), level: f.level ?? k }));

  // ---- facts: storeys, height, units
  const roomsArea = (F) => F.an.rooms.reduce((a, r) => a + r.area, 0);
  const roofOnly = (F) => F.st.terrace > 0.5 * roomsArea(F);
  const above = floors.filter((F) => F.level >= 0 && !roofOnly(F));
  const storeys = above.reduce((a, F) => a + F.rep, 0);
  const autoHeight = storeys * H.floor;
  const height = setup.height ?? autoHeight;
  const kitchens = floors.reduce((a, F) => a + F.an.rooms.filter((r) => r.type === 'kitchen').length * F.rep, 0);
  const units = setup.units ?? (isHouse(use) ? (use === 'DW1' ? 1 : Math.max(1, kitchens)) : Math.max(1, kitchens));
  const ground = floors.find((F) => F.level === 0) || floors.find((F) => F.level >= 0) || floors[0];
  const facts = { use, storeys, height, autoHeight, heightSet: setup.height != null, units, unitsSet: setup.units != null, kitchens, plot: num(areas.plot), st };

  const R = (o) => ({ items: [], note: '', value: '', ...o });
  const planning = [], perf = [], nbc = [];

  // ================================================================ Part II · planning
  // 6.6 / Table 6.23: height against road width
  {
    const max = heightForRoad(setup.road);
    planning.push(R({
      id: 'height-road', clause: 'CGDCR II 6.6 · Table 6.23', title: 'Building height for the road it faces',
      need: max ? `≤ ${max} m on a ${setup.road} m road` : 'The road width decides the height allowed',
      status: max == null ? 'need' : height <= max + 1e-6 ? 'pass' : 'fail',
      value: `${f2(height)} m${facts.heightSet ? '' : ` (≈ ${storeys} storey${storeys === 1 ? '' : 's'} × ${f2(H.floor)} m)`}`,
      note: max == null ? 'Add the width of the road the plot abuts.' : max === 45 ? 'Up to 70 m on an 18 m or wider road in a high-density area (FSI above 3.5), within 200 m of the road.' : '',
    }));
  }
  // 6.7: margins (plans don't show the plot boundary: the provided margins are asked for)
  {
    const road = roadMargin(setup.road);
    const sr = sideRear(use, facts.plot, height);
    const byHeight = !isHouse(use) && sr ? sr.side : 0;
    const need = road == null ? null : Math.max(road, byHeight);
    const got = setup.margins.road;
    planning.push(R({
      id: 'margin-road', clause: 'CGDCR II 6.7.1 · Table 6.24', title: 'Road-side margin',
      need: need == null ? 'Set by the road width (and the height, whichever is more)' : `≥ ${m(need)}${byHeight > (road || 0) ? ' (by height)' : ''}`,
      status: need == null ? 'need' : got == null ? 'need' : got + 1e-6 >= need ? 'pass' : 'fail',
      value: got == null ? '' : `${m(got)} provided`,
      note: need == null ? 'Add the road width.' : got == null ? 'Plans don’t show the plot boundary: enter the margin on your site plan.' : '',
    }));
    const gs = setup.margins.side, gr = setup.margins.rear;
    const ok = sr && gs != null && gr != null && (sr.sides === 'any' ? Math.max(gs, gr) + 1e-6 >= sr.side : gs + 1e-6 >= sr.side && gr + 1e-6 >= sr.rear);
    planning.push(R({
      id: 'margin-side', clause: 'CGDCR II 6.7.2 · Table 6.26', title: 'Side and rear margins',
      need: sr ? sr.text : isHouse(use) ? 'Set by the plot area' : 'Set by the building height',
      status: !sr ? 'need' : sr.sides === 'none' ? 'pass' : gs == null || gr == null ? 'need' : ok ? 'pass' : 'fail',
      value: gs != null || gr != null ? `side ${gs != null ? m(gs) : '—'}, rear ${gr != null ? m(gr) : '—'}` : '',
      note: !sr ? (isHouse(use) ? 'Add the plot area.' : '') : sr.sides === 'none' ? '' : gs == null || gr == null ? 'Enter the smallest side and rear margins on your site plan.' : '',
    }));
  }
  // 6.2 / Table 6.5: FSI
  {
    const F = st.fsi;
    planning.push(R({
      id: 'fsi', clause: 'CGDCR II Table 6.5', title: 'FSI within the maximum',
      need: `≤ ${F.max} (${F.zone.code}; base ${F.base})`,
      status: !(F.plot > 0) ? 'need' : F.status === 'over' ? 'fail' : 'pass',
      value: F.plot > 0 ? `${F.consumed.toFixed(2)} consumed · ${sq(st.totals.fsiArea)}` : sq(st.totals.fsiArea) + ' of FSI area',
      note: !(F.plot > 0) ? 'Add the plot area.' : F.status === 'chargeable' ? `${sq(F.chargeableUsed)} of it is chargeable FSI.` : F.status === 'over' ? `${sq(F.over)} over the maximum.` : '',
      link: 'areas',
    }));
  }
  // 6.15 / Table 6.44: parking
  {
    const parkRooms = floors.flatMap((F) => F.st.rooms.filter((r) => r.use === 'parking').map((r) => ({ k: F.k, room: r.i, name: r.name, area: r.area * F.rep })));
    const measured = parkRooms.reduce((a, r) => a + r.area, 0);
    if (isHouse(use)) {
      const perGround = use === 'DW1' || setup.units == null ? Math.max(1, ground ? ground.an.rooms.filter((r) => r.type === 'kitchen').length : 1) : units;
      const plinth = ground ? ground.st.builtUp / (use === 'DW1' ? 1 : perGround) : 0;
      const req = housePark(plinth);
      const got = setup.cars ?? (measured > 0 ? Math.floor(measured / CAR + 1e-6) : null);
      planning.push(R({
        id: 'parking', clause: 'CGDCR II 6.15 · Table 6.44', title: 'Car parking',
        need: req === 0 ? 'None up to 100 m² of plinth area' : `${req} car${req > 1 ? 's' : ''} for ${sq(plinth)} of plinth area${use === 'DW2' ? ' per unit' : ''}`,
        status: req === 0 ? 'pass' : got == null ? 'need' : got >= req ? 'pass' : 'fail',
        value: got == null ? '' : `${got} car${got === 1 ? '' : 's'}${setup.cars == null ? ` (from ${sq(measured)} of parking at 2.5 × 5.5 m)` : ''}`,
        note: req > 0 && got == null ? 'It may be in the margin (allowed for Dwelling-1 and 2): enter how many cars fit.' : '',
        items: parkRooms.map((r) => ({ k: r.k, room: r.room, name: r.name, value: sq(r.area), status: 'pass' })),
      }));
    } else {
      const fsiArea = st.totals.fsiArea;
      const pct = use === 'DW3' ? 0.2 : !(facts.plot > 0) ? null : facts.plot <= 750 ? 0.3 : facts.plot <= 2000 ? 0.4 : 0.5;
      const req = pct == null ? null : pct * fsiArea;
      const got = setup.parking ?? (measured > 0 ? measured : null);
      planning.push(R({
        id: 'parking', clause: 'CGDCR II 6.15 · Table 6.44', title: 'Parking area',
        need: req == null ? 'A share of the utilised FSI, by plot size' : `≥ ${sq(req)} (${Math.round(pct * 100)}% of ${sq(fsiArea)} FSI area), ${use === 'DW3' ? '10' : '20'}% of it for visitors`,
        status: req == null ? 'need' : got == null ? 'need' : got + 1e-6 >= req ? 'pass' : 'fail',
        value: got == null ? '' : `${sq(got)}${setup.parking == null ? ' measured' : ''}`,
        note: req == null ? 'Add the plot area.' : got == null ? 'No parking in the plans: enter the parking area of the site plan.' : '',
        items: parkRooms.map((r) => ({ k: r.k, room: r.room, name: r.name, value: sq(r.area), status: 'pass' })),
      }));
    }
  }
  // 6.8.4(2): no habitable use in a basement
  {
    const base = floors.filter((F) => F.level < 0);
    const bad = base.flatMap((F) => F.an.rooms.filter((r) => HABITABLE.has(r.type)).map((r) => ({ k: F.k, room: r.id, name: r.name, value: sq(r.area), status: 'fail' })));
    planning.push(R({
      id: 'basement-use', clause: 'CGDCR II 6.8.4(2)', title: 'No habitable rooms in a basement',
      need: 'Parking, services, storage only', status: !base.length ? 'na' : bad.length ? 'fail' : 'pass',
      value: !base.length ? 'No basement' : bad.length ? `${bad.length} habitable room${bad.length > 1 ? 's' : ''}` : 'None', items: bad,
    }));
  }

  // ================================================================ Part III · performance
  const habitFloors = floors.filter((F) => F.level >= 0 && F.an.rooms.some((r) => HABITABLE.has(r.type)));
  perf.push(R({
    id: 'storey-height', clause: 'CGDCR III 13.1.7(1a)', title: 'Height of habitable storeys',
    need: '≥ 2.90 m floor to floor', status: !habitFloors.length ? 'na' : H.floor + 1e-6 >= 2.9 ? 'pass' : 'fail',
    value: `${m(H.floor)} floor to floor`, note: 'From the storey heights in the model (plans don’t carry heights).',
  }));
  {
    const base = floors.filter((F) => F.level < 0);
    const clear = H.floor - H.slab;
    perf.push(R({
      id: 'basement-height', clause: 'CGDCR III 13.1.7(7) · II 6.8.3', title: 'Clear height of a basement',
      need: '2.80–4.50 m clear', status: !base.length ? 'na' : clear >= 2.8 - 1e-6 && clear <= 4.5 + 1e-6 ? 'pass' : 'fail',
      value: base.length ? `${m(clear)} clear` : 'No basement',
    }));
    const stilt = ground && ground.level === 0 && ground.st.rooms.some((r) => r.use === 'parking') && ground.st.rooms.reduce((a, r) => a + (r.use === 'parking' ? r.area : 0), 0) >= 0.4 * roomsArea(ground);
    perf.push(R({
      id: 'hollow-plinth', clause: 'CGDCR III 13.1.5(2a)', title: 'Height of a hollow plinth (stilt)',
      need: '3.00–3.50 m, ground to the floor above', status: !stilt ? 'na' : H.floor >= 3.0 - 1e-6 && H.floor <= 3.5 + 1e-6 ? 'pass' : 'fail',
      value: stilt ? m(H.floor) : 'No stilt floor',
    }));
  }
  // 13.1.13 / Table 13.2: staircases
  {
    const S = stairRule(use, height);
    const flights = floors.flatMap((F) => F.an.stairs ? F.an.stairs.map((s) => ({ F, s })) : []);
    const stairRooms = floors.reduce((a, F) => a + F.an.rooms.filter((r) => r.type === 'stair').length, 0);
    const nameOf = (F, s) => (s.room >= 0 && F.an.rooms[s.room] ? F.an.rooms[s.room].name : 'Staircase');
    const items = flights.map(({ F, s }) => ({ k: F.k, room: s.room, name: nameOf(F, s), value: m(s.width), status: s.width + 0.02 >= S.width ? 'pass' : 'fail', box: s.box }));
    perf.push(R({
      id: 'stair-width', clause: `CGDCR III 13.1.13 · Table 13.2 (${S.row})`, title: 'Staircase flight width',
      need: `≥ ${m(S.width)} clear`, status: !flights.length ? (stairRooms ? 'need' : 'na') : items.some((i) => i.status === 'fail') ? 'fail' : 'pass',
      value: flights.length ? `narrowest ${m(Math.min(...flights.map((q) => q.s.width)))}` : stairRooms ? 'Treads not found' : 'No staircase',
      note: !flights.length && stairRooms ? 'The stair’s treads aren’t on a stair layer: mark that layer as Stair in the workspace.' : 'Measured along the treads, which may include the railing: the table’s width is clear of the railing.',
      items,
    }));
    const titems = flights.map(({ F, s }) => ({ k: F.k, room: s.room, name: nameOf(F, s), value: `${Math.round(s.going * 1000)} mm`, status: s.going + 0.005 >= S.tread ? 'pass' : 'fail', box: s.box }));
    perf.push(R({
      id: 'stair-tread', clause: `CGDCR III Table 13.2 (${S.row})`, title: 'Staircase tread',
      need: `≥ ${Math.round(S.tread * 1000)} mm; riser ≤ ${Math.round(S.riser * 1000)} mm`, status: !flights.length ? (stairRooms ? 'need' : 'na') : titems.some((i) => i.status === 'fail') ? 'fail' : 'pass',
      value: flights.length ? `shallowest ${Math.round(Math.min(...flights.map((q) => q.s.going)) * 1000)} mm` : '',
      note: `Risers need the section: at ${m(H.floor)} floor to floor, ≤ ${Math.round(S.riser * 1000)} mm means at least ${Math.ceil(H.floor / S.riser - 1e-9)} risers a storey.`,
      items: titems,
    }));
  }
  // 13.12: lifts
  {
    const lifts = Math.max(0, ...floors.map((F) => F.an.rooms.filter((r) => r.type === 'lift').length));
    let need = 0, why = '';
    if (!isHouse(use) && height > 10) {
      const upper = floors.filter((F) => F.level >= 3).reduce((a, F) => a + F.an.rooms.filter((r) => r.type === 'kitchen').length * F.rep, 0);
      const upperArea = floors.filter((F) => F.level >= 3).reduce((a, F) => a + F.st.builtUp * F.rep, 0);
      const byUse = use === 'M' ? Math.ceil(upperArea / 1000 - 1e-9) : Math.ceil(upper / 30 - 1e-9);
      need = Math.max(height > 25 ? 2 : 1, byUse);
      why = height > 25 ? ', one of them a fire lift' : '';
    }
    perf.push(R({
      id: 'lift', clause: 'CGDCR III 13.12.2', title: 'Lifts',
      need: need ? `≥ ${need} lift${need > 1 ? 's' : ''} above 10 m${why}` : isHouse(use) ? 'Not required for Dwelling-1 and 2' : 'Not required up to 10 m',
      status: !need ? 'na' : lifts >= need ? 'pass' : 'fail',
      value: `${lifts} lift${lifts === 1 ? '' : 's'} found`,
    }));
  }
  // 13.4: ventilation, per space (an open-plan kitchen, dining and living is one room)
  {
    const winH = Math.max(0, H.head - H.sill), doorH = H.door;
    const vItems = [], oItems = [], tItems = [], sItems = [];
    for (const F of floors) {
      const rooms = F.an.rooms, ops = F.an.openings || [];
      const groups = new Map();
      rooms.forEach((r) => { const g = groups.get(r.region) || []; g.push(r); groups.set(r.region, g); });
      const regionOf = (v) => (v >= 0 && rooms[v] ? rooms[v].region : null);
      for (const [region, g] of groups) {
        const ids = new Set(g.map((r) => r.id));
        const mine = ops.filter((o) => ids.has(o.a) !== ids.has(o.b) && (ids.has(o.a) || ids.has(o.b)));
        const other = (o) => (ids.has(o.a) ? o.b : o.a);
        const toOpen = mine.filter((o) => { const v = other(o); return v === -1 || (v >= 0 && OPEN_SIDE.has(rooms[v].type)); });
        const area = g.reduce((a, r) => a + r.area, 0);
        const name = g.map((r) => r.name).join(' / ');
        const first = g.slice().sort((p, q) => q.area - p.area)[0];
        const openA = mine.reduce((a, o) => a + o.w * (o.kind === 'window' ? winH : doorH), 0);
        const hab = g.some((r) => HABITABLE.has(r.type));
        if (hab) {
          vItems.push({ k: F.k, room: first.id, rooms: [...ids], name, value: `${sq(openA)} of ${sq(area / 7)}`, status: openA + 1e-6 >= area / 7 ? 'pass' : 'warn' });
          oItems.push({ k: F.k, room: first.id, rooms: [...ids], name, value: toOpen.length ? `${toOpen.length} opening${toOpen.length > 1 ? 's' : ''} out` : 'none found', status: toOpen.length ? 'pass' : 'warn' });
        }
        for (const r of g) {
          if (r.type === 'toilet') {
            const vent = ops.filter((o) => (o.a === r.id || o.b === r.id) && o.kind !== 'door').filter((o) => { const v = o.a === r.id ? o.b : o.a; return v === -1 || (v >= 0 && rooms[v].type === 'duct' && rooms[v].area >= 0.81 && regionOf(v) !== region); });
            const va = vent.reduce((a, o) => a + o.w * winH, 0);
            tItems.push({ k: F.k, room: r.id, name: r.name, value: vent.length ? sq(va) : 'no opening out', status: va + 1e-6 >= 0.25 ? 'pass' : 'warn' });
          }
          if (r.type === 'stair' && isHouse(use)) {
            const wa = toOpen.filter((o) => o.kind === 'window').reduce((a, o) => a + o.w * winH, 0);
            sItems.push({ k: F.k, room: r.id, name: r.name, value: sq(wa), status: wa + 1e-6 >= 1.2 ? 'pass' : 'warn' });
          }
        }
      }
    }
    const mech = 'Short of it is allowed with mechanical ventilation (exhaust fans, air conditioning) to NBC Part 8.';
    const agg = (items) => (!items.length ? 'na' : items.some((i) => i.status === 'warn') ? 'warn' : 'pass');
    perf.push(R({ id: 'vent-ratio', clause: 'CGDCR III 13.4.1(2)', title: 'Openings of habitable rooms', need: '≥ ⅐ of the floor area (doors, windows and ventilators)', status: agg(vItems), value: vItems.length ? `${vItems.filter((i) => i.status === 'pass').length} of ${vItems.length} rooms` : 'No habitable rooms', note: `Windows taken as ${m(H.sill)} sill to ${m(H.head)} head, doors as ${m(doorH)} high. ${mech}`, items: vItems }));
    perf.push(R({ id: 'vent-open', clause: 'CGDCR III 13.4.1(1)', title: 'Habitable rooms open to outside', need: 'A window or ventilator onto open space, a courtyard or a verandah', status: agg(oItems), value: oItems.length ? `${oItems.filter((i) => i.status === 'pass').length} of ${oItems.length} rooms` : '', note: `The open space must be at least ⅒ of the room’s floor area. ${mech}`, items: oItems }));
    perf.push(R({ id: 'vent-wc', clause: 'CGDCR III 13.4.4(2)', title: 'Bath and WC ventilation', need: '≥ 0.25 m² opening to open-to-sky space (0.9 × 0.9 m or more)', status: agg(tItems), value: tItems.length ? `${tItems.filter((i) => i.status === 'pass').length} of ${tItems.length}` : 'No baths or WCs', note: `An opening into a shaft counts when the shaft is at least 0.9 × 0.9 m. ${mech}`, items: tItems }));
    perf.push(R({ id: 'vent-stair', clause: 'CGDCR III 13.4.5(1)', title: 'Staircase windows (Dwelling-1 and 2)', need: '≥ 1.2 m² of windows at each floor, onto open air', status: isHouse(use) ? agg(sItems) : 'na', value: isHouse(use) ? (sItems.length ? `${sItems.filter((i) => i.status === 'pass').length} of ${sItems.length}` : 'No staircase') : 'Fire regulations apply instead', note: isHouse(use) ? mech : '', items: sItems }));
  }
  // 13.9.1: WC size
  {
    const items = floors.flatMap((F) => F.an.rooms.filter((r) => r.type === 'toilet').map((r) => ({ k: F.k, room: r.id, name: r.name, value: sq(r.area), status: r.area + 1e-6 >= 0.9 ? 'pass' : 'fail' })));
    perf.push(R({ id: 'wc-size', clause: 'CGDCR III 13.9.1', title: 'Water closet size', need: '≥ 0.90 m²; at least one per dwelling', status: !items.length ? 'need' : items.some((i) => i.status === 'fail') ? 'fail' : 'pass', value: items.length ? `${items.length} found, smallest ${sq(Math.min(...items.map((i) => parseFloat(i.value))))}` : 'None found', note: items.length ? '' : 'No bath or WC is named in the plans: name it (WC, Toilet, Bath) in the drawing, or set its type in the workspace.', items }));
  }
  // 13.1.6: entrance door (not for Dwelling-1 and 2)
  {
    let best = null;
    if (!isHouse(use) && ground) for (const o of ground.an.openings || []) if (o.kind === 'door' && (o.a === -1 || o.b === -1) && (!best || o.w > best.w)) best = o;
    perf.push(R({
      id: 'entrance', clause: 'CGDCR III 13.1.6(1)', title: 'Entrance door', need: '≥ 900 mm clear, no step', status: isHouse(use) ? 'na' : !best ? 'need' : best.w + 0.02 >= 0.9 ? 'pass' : 'fail',
      value: isHouse(use) ? 'Not required for Dwelling-1 and 2' : best ? `widest door out ${Math.round(best.w * 1000)} mm` : 'No door to outside found on the ground floor',
    }));
  }

  // ================================================================ NBC 2016 · room sizes (good practice)
  if (setup.nbc) {
    const sized = (types, rule) => floors.flatMap((F) => F.an.rooms.filter((r) => types(r)).map((r) => {
      const R2 = typeof rule === 'function' ? rule(r) : rule;
      const ok = r.area + 1e-6 >= R2.area && (r.width ?? 99) + 0.02 >= R2.width;
      return { k: F.k, room: r.id, name: r.name, value: `${sq(r.area)} · ${r.width != null ? m(r.width) : '—'} wide`, status: ok ? 'pass' : 'warn', need: `${sq(R2.area)} · ${m(R2.width)}` };
    }));
    const agg = (items) => (!items.length ? 'na' : items.some((i) => i.status === 'warn') ? 'warn' : 'pass');
    const hab = sized((r) => r.type === 'bedroom' || (r.type === 'living' && !/dining/i.test(r.name)), NBC.habitable);
    const big = floors.flatMap((F) => F.an.rooms.filter((r) => r.type === 'bedroom' || r.type === 'living')).some((r) => r.area >= NBC.habitable.main && (r.width ?? 99) + 0.02 >= NBC.habitable.mainWidth);
    nbc.push(R({ id: 'nbc-habitable', clause: 'NBC 2016 Part 3 · 8.1.1', title: 'Habitable room size', need: `≥ ${sq(NBC.habitable.area)}, ${m(NBC.habitable.width)} wide; one room ≥ ${sq(NBC.habitable.main)}, ${m(NBC.habitable.mainWidth)} wide`, status: hab.length ? (hab.some((i) => i.status === 'warn') || !big ? 'warn' : 'pass') : 'na', value: hab.length ? `${hab.filter((i) => i.status === 'pass').length} of ${hab.length}` : '', note: big || !hab.length ? '' : `No room reaches ${sq(NBC.habitable.main)} and ${m(NBC.habitable.mainWidth)}.`, items: hab }));
    const kit = sized((r) => r.type === 'kitchen', NBC.kitchen);
    nbc.push(R({ id: 'nbc-kitchen', clause: 'NBC 2016 Part 3 · 8.1.2', title: 'Kitchen size', need: `≥ ${sq(NBC.kitchen.area)}, ${m(NBC.kitchen.width)} wide`, status: agg(kit), value: kit.length ? `${kit.filter((i) => i.status === 'pass').length} of ${kit.length}` : '', note: '4.5 m² is enough with a separate store; a kitchen that is also the dining needs 7.5 m², 2.1 m wide.', items: kit }));
    const wet = sized((r) => r.type === 'toilet', (r) => NBC[toiletKind(r.name)]);
    nbc.push(R({ id: 'nbc-toilet', clause: 'NBC 2016 Part 3 · 8.1.4', title: 'Bath and WC size', need: `bath ${sq(NBC.bath.area)} · WC ${sq(NBC.wc.area)} · both ${sq(NBC.both.area)}`, status: agg(wet), value: wet.length ? `${wet.filter((i) => i.status === 'pass').length} of ${wet.length}` : '', note: 'Read from the name: “WC” or “powder” is a WC, “bath” a bathroom, anything else (“toilet”) both together. Widths are the widest circle that fits, so a shaft in a corner narrows the room.', items: wet }));
  }

  const groups = [
    { id: 'planning', title: 'Planning · CGDCR 2017 Part II', rules: planning },
    { id: 'performance', title: 'Performance · CGDCR 2017 Part III', rules: perf },
    ...(setup.nbc ? [{ id: 'nbc', title: 'Good practice · NBC 2016 room sizes', note: 'CGDCR sets no minimum room sizes; these are the National Building Code’s, shown as warnings.', rules: nbc }] : []),
  ];
  const counts = { pass: 0, fail: 0, warn: 0, need: 0, na: 0 };
  for (const g of groups) for (const r of g.rules) counts[r.status]++;
  return { facts, groups, counts };
}

/** The checks as CSV: one row per rule, then one per room that failed. */
export function checksCSV(res, { project = '', rev = '' } = {}) {
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const W = { pass: 'Pass', fail: 'Fail', warn: 'Check', need: 'Needs information', na: 'Doesn’t apply' };
  const rows = [[q(`Bye-law checks — ${project} ${rev}`.trim())], [], ['Group', 'Clause', 'Rule', 'Requirement', 'Result', 'Measured', 'Note'].map(q)];
  for (const g of res.groups) for (const r of g.rules) rows.push([g.title, r.clause, r.title, r.need, W[r.status], r.value, r.note].map(q));
  rows.push([], ['Rule', 'Space', 'Measured', 'Result'].map(q));
  for (const g of res.groups) for (const r of g.rules) for (const i of r.items) if (i.status !== 'pass') rows.push([r.title, i.name, i.value, W[i.status]].map(q));
  return rows.map((r) => r.join(',')).join('\r\n') + '\r\n';
}
