// Pivot — item catalogue.
// Every item is modelled as a union of boxes ("parts") in its own frame:
//   +x = its right-hand end, +y = up, +z = its front. Origin = bounding-box centre.
// Parts drive collision; `look` hints drive the 3D rendering.

const P = (name, x0, y0, z0, x1, y1, z1, look = 'body') => ({ name, look, min: [x0, y0, z0], max: [x1, y1, z1] });

function sofaParts(p, chaise = null) {
  // Heights are measured with the legs on; unscrewing them lowers everything.
  const drop = p.legs ? 0 : Math.max(0, p.legH || 0);
  const W = p.W, D = p.D, H = p.H - drop;
  const leg = p.legs ? Math.max(0, p.legH) : 0;
  const seatTop = Math.max(leg + 12, Math.min(p.seatH - drop, H - 10));
  const armH = Math.max(seatTop, Math.min(p.armH - drop, H));
  const armW = Math.min(p.armW, W / 3);
  const backT = Math.min(p.backT, D / 2);
  const x0 = -W / 2, x1 = W / 2, z0 = -D / 2, z1 = D / 2;
  const parts = [
    P('base', x0, leg, z0, x1, seatTop, z1, 'base'),
    P('back', x0, seatTop, z0, x1, H, z0 + backT, 'back'),
  ];
  if (armW > 1 && armH > seatTop + 1) {
    parts.push(P('left arm', x0, seatTop, z0 + backT, x0 + armW, armH, z1, 'arm'));
    parts.push(P('right arm', x1 - armW, seatTop, z0 + backT, x1, armH, z1, 'arm'));
  }
  if (chaise) {
    const cw = Math.min(chaise.w, W), extra = Math.max(0, chaise.len - D);
    const cx0 = chaise.side === 'left' ? x0 : x1 - cw;
    parts.push(P('chaise', cx0, leg, z1, cx0 + cw, seatTop, z1 + extra, 'base'));
    if (armW > 1) {
      const ax0 = chaise.side === 'left' ? x0 : x1 - armW;
      parts.push(P('chaise arm', ax0, seatTop, z1, ax0 + armW, armH, z1 + extra, 'arm'));
    }
  }
  if (leg > 0.5) {
    const s = 5, zBack = z0 + 3, zFront = z1 - 3 - s;
    const spots = [[x0 + 3, zBack], [x1 - 3 - s, zBack], [x0 + 3, zFront], [x1 - 3 - s, zFront]];
    if (chaise && chaise.len > D) {
      const cw = Math.min(chaise.w, W), cx0 = chaise.side === 'left' ? x0 : x1 - cw;
      const zc = z1 + (chaise.len - D) - 3 - s;
      spots.push([cx0 + 3, zc], [cx0 + cw - 3 - s, zc]);
    }
    for (const [lx, lz] of spots) parts.push(P('leg', lx, 0, lz, lx + s, leg, lz + s, 'leg'));
  }
  return parts;
}

function boxParts(W, H, D, look = 'body') {
  return [P('body', -W / 2, 0, -D / 2, W / 2, H, D / 2, look)];
}

export const ITEM_TYPES = {
  sofa: {
    label: 'Sofa', group: 'Seating',
    fields: [
      ['W', 'Width', 'end to end, arms included'],
      ['D', 'Depth', 'front of the arm to the back'],
      ['H', 'Height', 'floor to top of the back'],
      ['seatH', 'Seat height', 'floor to top of the seat'],
      ['armH', 'Arm height', 'floor to top of the arm'],
      ['armW', 'Arm width', ''],
      ['backT', 'Back thickness', 'at seat level'],
      ['legH', 'Leg height', ''],
    ],
    toggles: [['legs', 'Legs attached', 'Most sofa legs unscrew — turn this off to see if that helps']],
    defaults: { W: 213, D: 94, H: 86, seatH: 46, armH: 64, armW: 22, backT: 24, legH: 12, legs: true },
    parts: (p) => sofaParts(p),
    names: { '+x': 'right arm', '-x': 'left arm', '+y': 'top', '-y': 'legs', '+z': 'seat front', '-z': 'back' },
  },
  loveseat: {
    label: 'Loveseat', group: 'Seating', like: 'sofa',
    defaults: { W: 160, D: 90, H: 84, seatH: 45, armH: 62, armW: 20, backT: 22, legH: 12, legs: true },
  },
  armchair: {
    label: 'Armchair', group: 'Seating', like: 'sofa',
    defaults: { W: 92, D: 90, H: 88, seatH: 45, armH: 64, armW: 20, backT: 22, legH: 12, legs: true },
  },
  sectional: {
    label: 'Chaise sectional', group: 'Seating',
    fields: [
      ['W', 'Width', 'end to end'],
      ['D', 'Depth', 'of the sofa part'],
      ['chaiseLen', 'Chaise length', 'front to back along the chaise'],
      ['chaiseW', 'Chaise width', ''],
      ['H', 'Height', 'floor to top of the back'],
      ['seatH', 'Seat height', ''],
      ['armH', 'Arm height', ''],
      ['legH', 'Leg height', ''],
    ],
    toggles: [['legs', 'Legs attached', ''], ['chaiseLeft', 'Chaise on the left', 'as you face the sofa']],
    defaults: { W: 250, D: 92, H: 84, seatH: 45, armH: 62, armW: 20, backT: 24, legH: 10, legs: true, chaiseLen: 160, chaiseW: 85, chaiseLeft: false },
    parts: (p) => sofaParts(p, { w: p.chaiseW, len: p.chaiseLen, side: p.chaiseLeft ? 'left' : 'right' }),
    names: { '+x': 'right end', '-x': 'left end', '+y': 'top', '-y': 'legs', '+z': 'seat front', '-z': 'back' },
  },
  mattress: {
    label: 'Mattress', group: 'Beds',
    fields: [['W', 'Length', ''], ['D', 'Width', ''], ['H', 'Thickness', '']],
    defaults: { W: 200, D: 150, H: 25 },
    parts: (p) => boxParts(p.W, p.H, p.D, 'mattress'),
    names: { '+x': 'foot end', '-x': 'head end', '+y': 'top', '-y': 'underside', '+z': 'side', '-z': 'side' },
    note: 'Foam mattresses flex a little. If the result is close, it will probably bend through.',
  },
  boxspring: {
    label: 'Box spring / bed base', group: 'Beds',
    fields: [['W', 'Length', ''], ['D', 'Width', ''], ['H', 'Height', '']],
    defaults: { W: 203, D: 152, H: 23 },
    parts: (p) => boxParts(p.W, p.H, p.D, 'boxspring'),
    names: { '+x': 'foot end', '-x': 'head end', '+y': 'top', '-y': 'underside', '+z': 'side', '-z': 'side' },
    note: 'Box springs are rigid. If it will not fit, look for a split (two-piece) version.',
  },
  wardrobe: {
    label: 'Wardrobe / almirah', group: 'Storage',
    fields: [['W', 'Width', ''], ['H', 'Height', ''], ['D', 'Depth', '']],
    defaults: { W: 91, H: 198, D: 51 },
    parts: (p) => boxParts(p.W, p.H, p.D, 'cabinet'),
    names: { '+x': 'right side', '-x': 'left side', '+y': 'top', '-y': 'bottom', '+z': 'doors', '-z': 'back panel' },
  },
  bookcase: {
    label: 'Bookcase / dresser', group: 'Storage',
    fields: [['W', 'Width', ''], ['H', 'Height', ''], ['D', 'Depth', '']],
    defaults: { W: 80, H: 202, D: 30 },
    parts: (p) => boxParts(p.W, p.H, p.D, 'cabinet'),
    names: { '+x': 'right side', '-x': 'left side', '+y': 'top', '-y': 'bottom', '+z': 'front', '-z': 'back panel' },
  },
  fridge: {
    label: 'Fridge', group: 'Appliances',
    fields: [['W', 'Width', ''], ['H', 'Height', ''], ['D', 'Depth', 'including handles']],
    toggles: [['layDown', 'OK to tilt past 45°', 'Most makers want fridges kept upright in transit']],
    defaults: { W: 70, H: 178, D: 72, layDown: false },
    parts: (p) => boxParts(p.W, p.H, p.D, 'appliance'),
    upright: (p) => (p.layDown ? null : 45),
    names: { '+x': 'right side', '-x': 'left side', '+y': 'top', '-y': 'bottom', '+z': 'doors', '-z': 'back' },
  },
  washer: {
    label: 'Washing machine', group: 'Appliances',
    fields: [['W', 'Width', ''], ['H', 'Height', ''], ['D', 'Depth', '']],
    toggles: [['layDown', 'OK to lay it down', '']],
    defaults: { W: 60, H: 85, D: 62, layDown: true },
    parts: (p) => boxParts(p.W, p.H, p.D, 'appliance'),
    upright: (p) => (p.layDown ? null : 45),
    names: { '+x': 'right side', '-x': 'left side', '+y': 'top', '-y': 'bottom', '+z': 'door', '-z': 'back' },
  },
  piano: {
    label: 'Upright piano', group: 'Other',
    fields: [['W', 'Width', ''], ['H', 'Height', ''], ['D', 'Depth', 'body, without the keyboard'], ['keyD', 'Keyboard overhang', 'how far the keys stick out'], ['keyY', 'Keyboard height', 'floor to underside of the keys']],
    defaults: { W: 150, H: 122, D: 50, keyD: 17, keyY: 62 },
    toggles: [['layDown', 'OK to lay it on its back', 'Movers usually keep pianos upright']],
    parts: (p) => [
      P('body', -p.W / 2, 0, -p.D / 2, p.W / 2, p.H, p.D / 2, 'wood'),
      P('keys', -p.W / 2 + 8, p.keyY, p.D / 2, p.W / 2 - 8, p.keyY + 14, p.D / 2 + p.keyD, 'keys'),
    ],
    upright: (p) => (p.layDown ? null : 60),
    names: { '+x': 'treble end', '-x': 'bass end', '+y': 'lid', '-y': 'base', '+z': 'keyboard', '-z': 'back' },
  },
  table: {
    label: 'Table / desk', group: 'Other',
    fields: [['W', 'Length', ''], ['D', 'Width', ''], ['H', 'Height', ''], ['topT', 'Top thickness', ''], ['legW', 'Leg thickness', '']],
    toggles: [['legs', 'Legs attached', 'Table legs usually come off']],
    defaults: { W: 180, D: 90, H: 75, topT: 4, legW: 7, legs: true },
    parts: (p) => {
      const parts = [P('top', -p.W / 2, p.H - p.topT, -p.D / 2, p.W / 2, p.H, p.D / 2, 'wood')];
      if (p.legs) {
        const s = p.legW, x0 = -p.W / 2 + 4, x1 = p.W / 2 - 4 - s, z0 = -p.D / 2 + 4, z1 = p.D / 2 - 4 - s;
        for (const [lx, lz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) parts.push(P('leg', lx, 0, lz, lx + s, p.H - p.topT, lz + s, 'wood'));
      }
      return parts;
    },
    names: { '+x': 'right end', '-x': 'left end', '+y': 'top', '-y': 'legs', '+z': 'long side', '-z': 'long side' },
  },
  tv: {
    label: 'TV in its box', group: 'Other',
    fields: [['W', 'Width', ''], ['H', 'Height', ''], ['D', 'Depth', '']],
    defaults: { W: 160, H: 100, D: 18 },
    parts: (p) => boxParts(p.W, p.H, p.D, 'carton'),
    onEdge: 30,
    names: { '+x': 'right end', '-x': 'left end', '+y': 'top', '-y': 'bottom', '+z': 'front', '-z': 'back' },
    note: 'Flat-panel TVs should never be laid flat, so Pivot keeps it on an edge.',
  },
  box: {
    label: 'Box / anything', group: 'Other',
    fields: [['W', 'Length', ''], ['H', 'Height', ''], ['D', 'Depth', '']],
    toggles: [['upright', 'Keep it upright', '']],
    defaults: { W: 120, H: 80, D: 60, upright: false },
    parts: (p) => boxParts(p.W, p.H, p.D, 'carton'),
    upright: (p) => (p.upright ? 20 : null),
    names: { '+x': 'right end', '-x': 'left end', '+y': 'top', '-y': 'bottom', '+z': 'front', '-z': 'back' },
  },
};

export function itemType(type) {
  const t = ITEM_TYPES[type] || ITEM_TYPES.sofa;
  if (!t.like) return t;
  const base = ITEM_TYPES[t.like];
  return { ...base, ...t, fields: t.fields || base.fields, toggles: t.toggles || base.toggles };
}

/**
 * Build the collision model: parts centred on the bounding box, plus metadata.
 * Returns { type, params, parts:[{name,look,c:[x,y,z],h:[hx,hy,hz]}], size:[x,y,z], radius, upright, onEdge, names }
 */
export function buildItem(spec) {
  const t = itemType(spec.type);
  const params = { ...t.defaults, ...(spec.params || {}) };
  const raw = t.parts(params);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of raw) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p.min[i]); max[i] = Math.max(max[i], p.max[i]); }
  const ctr = [0, 1, 2].map((i) => (min[i] + max[i]) / 2);
  const parts = raw
    .filter((p) => p.max[0] - p.min[0] > 0.1 && p.max[1] - p.min[1] > 0.1 && p.max[2] - p.min[2] > 0.1)
    .map((p) => ({
      name: p.name, look: p.look,
      c: [0, 1, 2].map((i) => (p.min[i] + p.max[i]) / 2 - ctr[i]),
      h: [0, 1, 2].map((i) => (p.max[i] - p.min[i]) / 2),
    }));
  let radius = 0;
  for (const p of parts) {
    for (let s = 0; s < 8; s++) {
      const x = p.c[0] + (s & 1 ? p.h[0] : -p.h[0]), y = p.c[1] + (s & 2 ? p.h[1] : -p.h[1]), z = p.c[2] + (s & 4 ? p.h[2] : -p.h[2]);
      radius = Math.max(radius, Math.hypot(x, y, z));
    }
  }
  return {
    type: spec.type in ITEM_TYPES ? spec.type : 'sofa',
    label: t.label,
    params,
    parts,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    offset: ctr, // bbox centre in the item's "floor" frame (y=0 at the bottom)
    radius,
    upright: t.upright ? t.upright(params) : null,
    onEdge: t.onEdge || null,
    names: t.names,
    note: t.note || '',
  };
}

/** Parse free-form dimension text such as "213 x 94 x 86 cm" or "W84" D37" H34"". */
export function parseDims(text) {
  if (!text) return null;
  const s = String(text).toLowerCase().replace(/,/g, '.').replace(/[×✕*]/g, 'x');
  const unit = /\b(mm)\b/.test(s) ? 0.1 : /\b(m|metre|meter)s?\b/.test(s) && !/cm/.test(s) ? 100 : /("|in\b|inch|inches|″)/.test(s) ? 2.54 : /(ft|feet|foot|')/.test(s) && !/"/.test(s) ? 30.48 : 1;
  const tagged = {};
  const re = /\b([wdhl])\w*\s*[:=]?\s*(\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(s))) tagged[m[1]] = parseFloat(m[2]) * unit;
  if (Object.keys(tagged).length >= 2) {
    return { W: tagged.w ?? tagged.l, D: tagged.d, H: tagged.h };
  }
  const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter((n) => n > 0);
  if (nums.length < 2) return null;
  const [a, b, c] = nums.map((n) => n * unit);
  // Retail convention: W × D × H
  return { W: a, D: b, H: c };
}
