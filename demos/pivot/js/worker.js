// Pivot — planning worker. Receives {world, item, opts}, streams progress, returns a plan.
import { planRoute } from './planner.js';

self.onmessage = (e) => {
  const { id, world, item, opts } = e.data;
  try {
    const res = planRoute(world, item, {
      ...opts,
      onProgress: (p) => self.postMessage({ id, ...p }),
    });
    self.postMessage({ id, type: 'result', res: slim(res) });
  } catch (err) {
    self.postMessage({ id, type: 'error', message: String(err && err.stack || err) });
  }
};

function slim(res) {
  if (!res.ok) return res;
  return {
    ok: true,
    stats: res.stats,
    natural: res.natural,
    path: res.path,
    dense: res.dense.map((n) => ({ p: n.pose, d: n.d, t: n.tele ? 1 : 0 })),
    clearance: {
      values: res.clearance.values,
      min: res.clearance.min,
      at: res.clearance.at,
      pinch: res.clearance.pinch ? {
        point: res.clearance.pinch.point, normal: res.clearance.pinch.normal,
        part: res.clearance.pinch.part, gap: res.clearance.pinch.gap, zone: res.clearance.pinch.zone,
      } : null,
    },
  };
}
