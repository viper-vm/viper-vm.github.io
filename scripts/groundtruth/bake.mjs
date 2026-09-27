#!/usr/bin/env node
// Groundtruth · pre-computes the satellite capture history of every curated project
// so the app opens instantly. Safe to re-run any time: it only rewrites captures.json.
//
//   node scripts/groundtruth/bake.mjs            # all projects
//   node scripts/groundtruth/bake.mjs chenab,t2  # only ids containing "chenab" or "t2"

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadReleases, historyAt, pool } from "../../demos/groundtruth/js/wayback.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dataDir = path.join(root, "demos/groundtruth/data");
const filters = (process.argv[2] || "").split(",");

const { projects } = JSON.parse(await readFile(path.join(dataDir, "projects.json"), "utf8"));
let existing = {}, previous = {};
try {
  previous = JSON.parse(await readFile(path.join(dataDir, "captures.json"), "utf8"));
  existing = previous.projects || {};
} catch {}

const releases = await loadReleases();
const newest = releases[releases.length - 1];
console.log(`${releases.length} Wayback releases, newest ${newest.date} (#${newest.r})`);

const todo = projects.filter((p) => filters.some((f) => p.id.includes(f)));
const results = await pool(
  todo.map((p) => async () => {
    const [lng, lat] = p.focus || p.view.c;
    const t0 = Date.now();
    try {
      const h = await historyAt({ releases, lng, lat, z: p.scanZ || 16 });
      const span = h.frames.length ? `${(h.frames[0].cd || h.frames[0].rd)} → ${(h.frames.at(-1).cd || h.frames.at(-1).rd)}` : "—";
      console.log(`✓ ${p.id.padEnd(22)} ${String(h.frames.length).padStart(2)} captures  ${span}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      return [p.id, h];
    } catch (e) {
      console.log(`✗ ${p.id}: ${e.message} — keeping previous data`);
      return [p.id, existing[p.id]];
    }
  }),
  4
);

const out = { generated: new Date().toISOString().slice(0, 10), latest: newest.date, projects: { ...existing } };
for (const [id, h] of results) if (h) out.projects[id] = h;
// keep the file byte-identical when nothing changed, so the monthly job doesn't commit noise
if (previous.latest === out.latest && JSON.stringify(previous.projects) === JSON.stringify(out.projects)) out.generated = previous.generated;
await writeFile(path.join(dataDir, "captures.json"), JSON.stringify(out) + "\n");
console.log(`wrote captures.json (${Object.keys(out.projects).length} projects)`);
