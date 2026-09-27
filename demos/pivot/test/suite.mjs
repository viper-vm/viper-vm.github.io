// Pivot planner regression suite. Run from the repo root:  node demos/pivot/test/suite.mjs
// Checks analytic limits (a rod round a corner), fit / no-fit verdicts and every worked example.

const base = new URL('../js/', import.meta.url).href;
const { buildWorld } = await import(base + 'world.js');
const { buildItem } = await import(base + 'items.js');
const { planRoute } = await import(base + 'planner.js');
const { buildPlaybook } = await import(base + 'playbook.js');
const { EXAMPLES } = await import(base + 'examples.js');
const room = { t: 'room', w: 420, l: 420, h: 250 };
const corridor = (h) => ({ steps: [{ t: 'door', w: 100, h, d: 10 }, { t: 'hall', w: 100, l: 400, h }, { t: 'turn', dir: 'L' }, { t: 'hall', w: 100, l: 400, h }, { ...room, h }] });
const cases = [
  ['box through door', { steps: [{ t: 'door', w: 81, h: 203, d: 14 }, { t: 'hall', w: 100, l: 300, h: 250 }, room] }, { type: 'box', params: { W: 100, H: 60, D: 60 } }, true, null, {}],
  ['rod 265 corner (limit 267)', corridor(12), { type: 'box', params: { W: 265, H: 5, D: 5 } }, true, null, { margin: 0.5 }],
  ['rod 272 corner (impossible)', corridor(12), { type: 'box', params: { W: 272, H: 5, D: 5 } }, false, null, { margin: 0.5, budgetChecks: 400000 }],
  ['sofa 213 legs on, 81 door', { steps: [{ t: 'door', w: 81, h: 203, d: 14 }, room] }, { type: 'sofa' }, false, { k: 0, s: 0 }, { budgetChecks: 400000 }],
  ['sofa 213 legs off, 81 door', { steps: [{ t: 'door', w: 81, h: 203, d: 14 }, { t: 'hall', w: 100, l: 300, h: 250 }, room] }, { type: 'sofa', params: { legs: false } }, true, null, {}],
];
const natural = { 'front-door': { k: 0, s: 0 }, lift: { k: 0, s: 0 }, boxspring: { k: 2, s: 0 }, almirah: { k: 1, s: 1 }, fridge: null, piano: null };
for (const ex of EXAMPLES) {
  if (ex.id === 'friends') cases.push([`example ${ex.id}`, { steps: ex.route }, ex.item, false, { k: 0, s: 0 }, { budgetChecks: 400000 }]);
  else cases.push([`example ${ex.id}`, { steps: ex.route }, ex.item, true, natural[ex.id], {}]);
}
let fails = 0;
for (const [name, route, spec, expect, carry, opts] of cases) {
  const world = buildWorld(route), item = buildItem(spec);
  const t0 = Date.now();
  const r = planRoute(world, item, { seed: 3, carry, ...opts });
  const ms = Date.now() - t0;
  const ok = r.ok === expect;
  if (!ok) fails++;
  let extra = '';
  if (r.ok) {
    const pb = buildPlaybook(world, item, r.dense.map((n) => ({ p: n.pose, d: n.d, t: n.tele ? 1 : 0 })), r.clearance);
    extra = `gap ${r.clearance.min.toFixed(2)} · ${pb.steps.length} steps`;
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(30)} ${r.ok ? 'fits' : 'no  '} (expected ${expect ? 'fits' : 'no'})  ${String(ms).padStart(6)} ms  ${extra}`);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
