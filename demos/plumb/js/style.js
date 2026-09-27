// Plumb — shared vocabulary: colours, issue kinds, level tags. Colour is information here:
// cyan = the floor below, violet = the floor above, red/orange/slate = how much it matters.

export const PALETTES = {
  dark: {
    bg: '#0b0d10', grid: 'rgba(255,255,255,0.035)', gridMajor: 'rgba(255,255,255,0.07)',
    ink: '#e9ecef', muted: '#8a94a1', halo: '#0b0d10',
    below: '#35c4f5', above: '#d783ff', blend: 'lighter',
    high: '#ff4d57', medium: '#ff9d3a', low: '#8ea3bb', ok: '#3fcf8e',
    slab: '#2a3038', slabEdge: '#56606d', wall: '#c9d0d8', column: '#aab3be', sky: '#0b0d10', grid3d: '#161b21', grid3dMajor: '#222932',
  },
  light: {
    bg: '#f4f2ec', grid: 'rgba(0,0,0,0.04)', gridMajor: 'rgba(0,0,0,0.08)',
    ink: '#16191d', muted: '#6c737c', halo: '#f4f2ec',
    below: '#0aa6e2', above: '#b14ff0', blend: 'multiply',
    high: '#d9303b', medium: '#d9731a', low: '#5f7690', ok: '#178a58',
    slab: '#e7e4dc', slabEdge: '#aaa598', wall: '#c4c9cf', column: '#a9afb6', sky: '#eeece6', grid3d: '#e2dfd7', grid3dMajor: '#d3cfc4',
  },
};

/** Room types → colour (3D tiles, tooltips, the type picker). */
export const TYPE_COLOR = {
  toilet: '#3b9dff', kitchen: '#1fc2ae', bedroom: '#b69cff', living: '#e3c27a', circulation: '#7b8594',
  balcony: '#79c47f', stair: '#c9ced6', lift: '#c9ced6', duct: '#35c4f5', service: '#9aa0a8', parking: '#5f6670', unknown: '#59616c',
};
export const TYPE_LABEL = {
  toilet: 'Toilet / bath', kitchen: 'Kitchen / utility', bedroom: 'Bedroom', living: 'Living / dining', circulation: 'Lobby / passage',
  balcony: 'Balcony', stair: 'Staircase', lift: 'Lift', duct: 'Duct / shaft', service: 'Store / service', parking: 'Parking', unknown: 'Other',
};

export const ROLE_COLOR = {
  wall: '#d9dee4', column: '#ff9d3a', door: '#e3c27a', window: '#35c4f5', outline: '#b69cff', stair: '#c9ced6', lift: '#9aa0a8',
  duct: '#1fc2ae', furniture: '#6c7582', text: '#8a94a1', dim: '#5d6774', hatch: '#4a525d', grid: '#4a525d', other: '#3c434d',
};
export const ROLE_LABEL = {
  wall: 'Walls', column: 'Columns', door: 'Doors', window: 'Windows', outline: 'Slab / outline', stair: 'Stairs', lift: 'Lifts',
  duct: 'Ducts / shafts', furniture: 'Furniture', text: 'Text', dim: 'Dimensions', hatch: 'Hatch', grid: 'Grid', other: 'Ignored',
};

export const GROUPS = [
  { key: 'structure', label: 'Columns', icon: 'i-col' },
  { key: 'wet', label: 'Wet over dry', icon: 'i-drop' },
  { key: 'shafts', label: 'Shafts & cores', icon: 'i-shaft' },
  { key: 'cantilever', label: 'Overhangs', icon: 'i-cant' },
];
export const KIND = {
  'floating-column': { group: 'structure', icon: 'i-col', who: 'Structure' },
  'column-offset': { group: 'structure', icon: 'i-col', who: 'Structure' },
  'column-grows': { group: 'structure', icon: 'i-col', who: 'Structure' },
  'wet-over-dry': { group: 'wet', icon: 'i-drop', who: 'Plumbing' },
  'duct-offset': { group: 'shafts', icon: 'i-shaft', who: 'Plumbing' },
  'duct-missing': { group: 'shafts', icon: 'i-shaft', who: 'Plumbing' },
  'lift-offset': { group: 'shafts', icon: 'i-lift', who: 'Lifts' },
  'lift-missing': { group: 'shafts', icon: 'i-lift', who: 'Lifts' },
  'stair-offset': { group: 'shafts', icon: 'i-layers', who: 'Architecture' },
  'stair-missing': { group: 'shafts', icon: 'i-layers', who: 'Architecture' },
  cantilever: { group: 'cantilever', icon: 'i-cant', who: 'Structure' },
};
export const SEVERITIES = ['high', 'medium', 'low'];
export const SEV_LABEL = { high: 'Fix before issue', medium: 'Check', low: 'Note' };

/** Short tag for a floor: S, G, B1, L2, T… */
export function levelTag(f) {
  const t = String(f.title || '').toLowerCase();
  if (/stilt/.test(t)) return 'S';
  if (/basement|cellar/.test(t) || f.level < 0) return 'B' + Math.max(1, Math.round(-f.level));
  if (/ground/.test(t) || f.level === 0) return 'G';
  if (/mezz/.test(t)) return 'M';
  if (/upper roof/.test(t)) return 'UR';
  if (/terrace|roof/.test(t) || f.level >= 99) return 'T';
  if (/podium/.test(t)) return 'P';
  return 'L' + f.level;
}

/** "SECOND FLOOR PLAN" → "Second floor" */
export function floorName(f) {
  const s = String(f.title || '').replace(/\bplan\b/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : `Floor ${f.level}`;
}

export const fmtArea = (a) => (a >= 100 ? a.toFixed(0) : a.toFixed(1)) + ' m²';
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
