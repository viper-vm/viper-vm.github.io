// Plumb — making and updating projects: store the files, record the revision, read it, tie its
// findings to the issue history, and keep the card's summary and picture current.

import { putFile, saveProject, getProject, putCache, getSettings } from './store.js';
import { analyseRevision, ENGINE, optsKey, kindOf, SAMPLE_URL } from './engine.js';
import { newProject, newRevision, reconcile, attach, summarize, log, currentRev } from './model.js';
import { thumb } from './thumbs.js';

/** Store raw files ({name, bytes}) and return their descriptors. */
export async function storeFiles(files) {
  const out = [];
  for (const f of files) {
    const kind = f.kind || kindOf(f.name, f.bytes);
    if (!kind) throw new Error(`${f.name} doesn't look like a DWG or DXF drawing.`);
    out.push(await putFile({ name: f.name, bytes: f.bytes, kind }));
  }
  return out;
}

/** Office defaults for a new revision: layer roles and room types learnt from earlier imports. */
export async function defaultOpts(layerNames = []) {
  const s = await getSettings();
  const roles = Object.entries(s.layerRoles || {}).filter(([l]) => !layerNames.length || layerNames.includes(l));
  const types = Object.entries(s.roomTypes || {});
  return { roles, types };
}

/**
 * After a revision has been read: link issues to the history, refresh the summary and picture,
 * log it, save. `result` may come from the wizard (already computed).
 */
export async function adopt(project, rev, result, { first = false } = {}) {
  const change = reconcile(project, rev, result);
  number(result);
  project.current = rev.id;
  project.summary = summarize(result, project);
  rev.summary = project.summary;
  try { project.thumb = thumb(result, { k: busiestPair(result), w: 360, h: 225 }); } catch { /* keep the old picture */ }
  if (first) log(project, `Created from ${rev.files.map((f) => f.name).join(', ')} · ${result.floors.length} floor plans`);
  else log(project, `${rev.label} uploaded · ${change.added.length} new, ${change.resolved.length} resolved`);
  const { sheet, ...cached } = result; // the whole-sheet preview is only for the import wizard
  putCache(`${project.id}:${rev.id}:a:${ENGINE}:${optsKey(rev.opts)}`, cached).catch(() => {});
  await saveProject(project);
  return change;
}

/** The floor pair with the most issues — the most telling picture of the building. */
export function busiestPair(result) {
  if (result.floors.length < 2) return 0;
  const n = new Array(result.floors.length).fill(0);
  for (const i of result.issues) n[i.upper] += i.severity === 'high' ? 3 : 1;
  let best = 1;
  n.forEach((v, k) => { if (k > 0 && v > n[best]) best = k; });
  return best;
}

/** A new project from files the user dropped, read straight away (no wizard). */
export async function quickProject({ name, city, files }, onStage) {
  const stored = await storeFiles(files);
  const project = newProject({ name, city });
  const rev = newRevision(project, stored, await defaultOpts());
  project.revisions.push(rev);
  const result = await analyseRevision(project, rev, { onStage });
  await adopt(project, rev, result, { first: true });
  return project;
}

/** The sample building, as a project of its own. */
export async function sampleProject(onStage) {
  onStage && onStage('Opening the sample building…');
  const res = await fetch(SAMPLE_URL);
  if (!res.ok) throw new Error('Couldn’t load the sample drawing.');
  const bytes = new Uint8Array(await res.arrayBuffer());
  const p = await quickProject({ name: 'Riverside Residency', city: 'Ahmedabad', files: [{ name: 'riverside-residency.dxf', bytes }] }, onStage);
  p.sample = true;
  p.client = 'Sample project';
  await saveProject(p);
  return p;
}

/** Open a project for a page: the project, its current revision, and that revision's analysis. */
export async function openProject(id, onStage) {
  const project = await getProject(id);
  if (!project) throw new Error('This project isn’t on this device. It may have been deleted, or made in another browser.');
  const rev = currentRev(project);
  if (!rev) throw new Error('This project has no drawings yet.');
  const result = await analyseRevision(project, rev, { onStage });
  attach(project, result);
  number(result);
  project.openedAt = Date.now();
  saveProject(project).catch(() => {});
  return { project, rev, result };
}

/** Issues are numbered 1…n in severity order, the same everywhere (pins, lists, reports). */
export function number(result) { result.issues.forEach((iss, i) => { iss.n = i + 1; }); return result; }
