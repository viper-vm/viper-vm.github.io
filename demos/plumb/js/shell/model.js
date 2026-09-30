// Plumb — projects, revisions and issue history. Pure functions (no storage, no DOM) so they
// can be tested in Node: the pages call these, then save the project.

import { KIND, levelTag, floorName } from '../style.js';
import { sheetPoint } from '../orient.js';

export const STATUSES = ['open', 'review', 'resolved', 'accepted'];
export const STATUS_LABEL = { open: 'Open', review: 'In review', resolved: 'Resolved', accepted: 'Accepted' };
export const PROJECT_STATUS = { concept: 'Concept', working: 'Working', approval: 'For approval', issued: 'Issued' };
export const CITIES = { 'IN-AMD': 'Ahmedabad' };
export const RULESETS = { 'IN-AMD': 'Gujarat CGDCR 2017 · Ahmedabad (AMC/AUDA)' };

const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function newProject({ name, client = '', city = 'Ahmedabad', region = 'IN-AMD' } = {}) {
  const now = Date.now();
  return {
    id: uid('p'), name: name || 'Untitled project', client, city, region, status: 'working',
    createdAt: now, updatedAt: now, openedAt: now, starred: false, archived: false,
    revisions: [], current: null, issueState: {}, activity: [], summary: null, thumb: null, heights: null,
  };
}

/** Rev A, Rev B … Rev Z, Rev AA … */
export function nextLabel(project) {
  const n = project.revisions.length;
  const letters = (i) => (i < 26 ? String.fromCharCode(65 + i) : letters(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
  return 'Rev ' + letters(n);
}

export function newRevision(project, files, opts = {}) {
  return { id: uid('r'), label: nextLabel(project), date: Date.now(), files, opts: { roles: [], types: [], nudges: {}, unitMM: null, floors: null, ...opts } };
}

export const currentRev = (p) => p.revisions.find((r) => r.id === p.current) || p.revisions[p.revisions.length - 1] || null;
export const prevRev = (p, rev) => { const i = p.revisions.findIndex((r) => r.id === rev.id); return i > 0 ? p.revisions[i - 1] : null; };

export function log(project, text) {
  project.activity.unshift({ at: Date.now(), text });
  project.activity.length = Math.min(project.activity.length, 60);
}

/** "G+3", "B+G+5", "G" */
export function storeys(floors) {
  if (!floors.length) return '—';
  const levels = floors.map((f) => f.level).filter((l) => l < 90);
  const below = levels.filter((l) => l < 0).length;
  const above = levels.filter((l) => l >= 1).length;
  return (below ? `B${below > 1 ? below : ''}+` : '') + 'G' + (above ? `+${above}` : '');
}

/** What the overview and cards show, from a packed analysis. */
export function summarize(result, project) {
  const open = { high: 0, medium: 0, low: 0 };
  let total = 0;
  for (const iss of result.issues) {
    const st = project ? stateOf(project, iss) : null;
    if (st && (st.status === 'resolved' || st.status === 'accepted')) continue;
    open[iss.severity]++; total++;
  }
  return {
    floors: result.floors.length,
    storeys: storeys(result.floors),
    rooms: result.an.reduce((a, x) => a + x.rooms.length, 0),
    columns: result.an.reduce((a, x) => a + x.columns.length, 0),
    footprint: result.an.reduce((a, x) => a + x.footprintArea, 0),
    perFloor: result.floors.map((f, k) => ({ tag: levelTag(f), name: floorName(f), title: f.title, area: result.an[k].footprintArea, rooms: result.an[k].rooms.length, columns: result.an[k].columns.length })),
    issues: { ...open, total, all: result.issues.length },
    unitMM: result.unit.mm, unitSource: result.unit.source,
    dims: result.geometry.reduce((a, g) => a + ((g.dims && g.dims.count) || 0), 0),
  };
}

// ------------------------------------------------------------------ issue history across revisions
const norm = (s) => String(s || '').toLowerCase().replace(/\bplan\b/g, '').replace(/\s+/g, ' ').trim();

/**
 * Where an issue is, in terms that survive a new revision: its kind, its floors and its place. The
 * place is kept twice: in the drawing's own coordinates (each file's, when floors come as separate
 * files, so adding or dropping a file moves nothing), and from the plan's corner, in case the plan
 * itself was moved in the drawing.
 */
export function whereOf(iss, result) {
  const U = result.floors[iss.upper], L = result.floors[iss.lower];
  const o = U.origin || [0, 0], box = U.sheetBox || U.box;
  const at = sheetPoint(U, iss.at[0], iss.at[1]); // where it is on the sheet, even on a floor read turned
  return {
    kind: iss.kind, upper: norm(U.title), lower: norm(L.title), lvU: U.level, lvL: L.level,
    at: [at[0] - o[0], at[1] - o[1]], rel: [at[0] - box[0], at[1] - box[1]],
  };
}

const near = (a, b) => !!(a && b) && Math.abs(a[0] - b[0]) < 0.6 && Math.abs(a[1] - b[1]) < 0.6;
// the same floors (by title, or by level when a floor was renamed) and the same place
function matches(st, w) {
  const floors = st.upper === w.upper || (st.lvU != null && st.lvU === w.lvU && st.lvL === w.lvL);
  return st.kind === w.kind && floors && (near(st.at, w.at) || near(st.rel, w.rel));
}

/** The saved state of this issue, if the project has seen it before. */
export function stateOf(project, iss) {
  if (iss.stateId && project.issueState[iss.stateId]) return project.issueState[iss.stateId];
  return null;
}

/**
 * Tie this revision's findings to the project's issue history: known issues keep their status,
 * new ones start open, ones that disappeared are marked resolved in this revision.
 * Sets iss.stateId on every issue. Returns what changed.
 */
export function reconcile(project, rev, result) {
  const states = project.issueState;
  const seen = new Set();
  const out = { added: [], resolved: [], reopened: [], kept: [] };
  for (const iss of result.issues) {
    const w = whereOf(iss, result);
    let id = Object.keys(states).find((k) => !seen.has(k) && matches(states[k], w));
    if (!id) {
      id = uid('i');
      states[id] = {
        id, ...w, title: iss.title, severity: iss.severity, status: 'open',
        assignee: (KIND[iss.kind] || {}).who || 'Architecture',
        found: rev.id, lastSeen: rev.id, resolvedIn: null, notes: [],
        history: [{ at: Date.now(), rev: rev.id, text: `Found in ${rev.label}` }],
      };
      out.added.push(id);
    } else {
      const st = states[id];
      if (st.lastSeen !== rev.id && st.status === 'resolved' && st.resolvedIn) {
        st.status = 'open'; st.resolvedIn = null;
        st.history.push({ at: Date.now(), rev: rev.id, text: `Back in ${rev.label}` });
        out.reopened.push(id);
      } else out.kept.push(id);
      Object.assign(st, { ...w, title: iss.title, severity: iss.severity, lastSeen: rev.id });
    }
    seen.add(id);
    iss.stateId = id;
  }
  // gone from this revision: resolved by the redesign (accepted ones just stay accepted)
  for (const [id, st] of Object.entries(states)) {
    if (seen.has(id) || st.lastSeen === rev.id) continue;
    if (st.status === 'open' || st.status === 'review') {
      st.status = 'resolved'; st.resolvedIn = rev.id;
      st.history.push({ at: Date.now(), rev: rev.id, text: `Not found in ${rev.label} — resolved` });
      out.resolved.push(id);
    }
  }
  return out;
}

/**
 * Re-reading the same revision with new options (a layer role, a unit, a floor order): keep the
 * history, add any finding that's new, but don't mark anything resolved — nothing was redrawn.
 */
export function attachOrAdd(project, rev, result) {
  attach(project, result);
  for (const iss of result.issues) {
    if (iss.stateId) continue;
    const id = uid('i');
    project.issueState[id] = {
      id, ...whereOf(iss, result), title: iss.title, severity: iss.severity, status: 'open',
      assignee: (KIND[iss.kind] || {}).who || 'Architecture', found: rev.id, lastSeen: rev.id, resolvedIn: null, notes: [],
      history: [{ at: Date.now(), rev: rev.id, text: `Found in ${rev.label}` }],
    };
    iss.stateId = id;
  }
}

/** Only attach ids (no status changes) — for re-reading the same revision with new options. */
export function attach(project, result) {
  const states = Object.values(project.issueState);
  for (const iss of result.issues) {
    const w = whereOf(iss, result);
    const st = states.find((s) => matches(s, w));
    if (st) iss.stateId = st.id;
  }
}

export function setStatus(project, id, status, note, revLabel) {
  const st = project.issueState[id];
  if (!st || st.status === status) return;
  st.status = status;
  if (status === 'resolved') st.resolvedIn = st.resolvedIn || st.lastSeen;
  if (status === 'open' || status === 'review') st.resolvedIn = null;
  st.history.push({ at: Date.now(), text: `${STATUS_LABEL[status]}${revLabel ? ` · ${revLabel}` : ''}${note ? ` — ${note}` : ''}` });
}
