# Plumb — does your building stack up?

**Live:** https://viper-vm.github.io/demos/plumb/

Plumb reads the 2D floor plans architects already draw (DXF) and checks what is supposed to
line up **between** floors — the problems that live between sheets, where nobody looks until
the site finds them:

| Check | What it flags |
|---|---|
| **Floating columns** | a column with no column under it (needs a transfer beam; an irregularity under IS 1893 and most seismic codes) |
| **Column offsets / growth** | columns that step sideways between floors (with the offset in mm), or get bigger going up |
| **Wet over dry** | toilets and kitchens above bedrooms and living rooms — drains through the ceiling, leaks into the room below |
| **Shafts & cores** | ducts, lift wells and stairs that jog or stop (with the shift in mm and % overlap) |
| **Overhangs** | slab beyond the floor below — balconies, cantilevers — with depth and area |

No BIM model needed. Drop one drawing with every plan laid out side by side (each titled like
“FIRST FLOOR PLAN”), or one file per floor (`ground.dxf`, `first-floor.dwg`, `L2.dxf`, and the
office shorthand common in India: `GF`, `FF`, `SF`, `TF`, `B1`, `4F`, also after the project's
name, e.g. `Riverside GF.dwg`).

Set up for **India, starting with Ahmedabad** (AMC/AUDA, Gujarat CGDCR 2017): mm or ft-in, m² and
ft² side by side, Indian room abbreviations, an area statement with RERA carpet area and FSI, and
bye-law checks against CGDCR 2017 Parts II and III.

## Pages

| Page | What it's for |
|---|---|
| `index.html` | Landing page: what it checks, the 3D model, revisions, files, privacy, FAQ; drop drawings or open the sample |
| `app/` | All projects: grid or list, search, starred/archived, status, the sample building |
| `app/import.html` | Import wizard: files → floors (the whole sheet with a box round each plan: drag to add, move, resize, nudge, split or delete; turn or mirror a floor drawn that way, with a suggestion when a floor fits the one below better turned; a note when one plan is two mirrored flats; order, rename, leave out, typical ×N) → units (with evidence) → layer roles (with *Ask AI*) → review. Also takes a new revision (`?project=`) |
| `app/project.html` | Project overview: open issues, the stack, most urgent, what changed since the last revision, hand-back files, floors, revisions, activity |
| `app/areas.html` | Area statement: built-up, FSI area (CGDCR 2017 §6.3.2 exemptions with their clauses: stairs and lifts with their walls, their landings up to 2x·x and 2x·2x, lofts up to 30%; mezzanines counted in full, as plans of their own or over a room), RERA carpet area (§2(k)), balconies, open terraces, common, shafts, walls, floor by floor and flat by flat (flats grouped round their kitchens, numbered 101, 102…, typed as BHK, renamable, rooms re-assignable); plot area, zone (Table 6.5, D1 AUDA) and FSI consumed; every space re-assignable; CSV and print |
| `app/rules.html` | Bye-law checks: CGDCR 2017 Part II (height by road, margins, FSI, parking, basement use) and Part III (storey, basement and stilt heights, stair width and tread, lifts, ventilation of rooms, baths and stairs, WC size, entrance door), NBC 2016 room sizes as good practice; road, plot and margins asked for; each rule with its clause and a plan of the rooms it's about; CSV and print |
| `app/issues.html` | Every issue across revisions: filters, a snapshot, status (open, in review, resolved, accepted), who it's for, notes, history, CSV/DXF, RFIs |
| `app/workspace.html` | Plan overlay, Stack and 3D model with collapsible panels; the model has a levels strip, view presets, one dock, section cut and issue pins |
| `app/settings.html` | Region, units, office storey heights, learnt layer standards and room names, AI key, theme, data on this device |
| `app/help.html` | Preparing drawings, supported files, what every check means, Ahmedabad and CGDCR 2017, shortcuts |

Projects are **local-first**: stored in the browser's IndexedDB (projects, the original drawing
files, cached analyses, settings). Every issue is matched across revisions by its kind, its floors
(by title, or by level when renamed) and its place (in each file's own coordinates, or from the
plan's corner if the plan was moved), so statuses and notes carry over and fixed issues are marked
resolved in the revision that fixed them.

**Formats:** DWG (AutoCAD R13 → 2025, read with [LibreDWG](https://www.gnu.org/software/libredwg/)
via the `@mlightcad/libredwg-web` WebAssembly build — GPL-3.0, fetched from jsDelivr only the first
time a DWG is opened), DXF ASCII (R12 → 2018+) and binary DXF. Several files at once, in any mix.

## What it does

1. **Understands the drawing** — units (`$INSUNITS`, cross-checked against the door swings and the
   size of the sheet, since files often say "inches" when drawn in metres), what each layer holds
   (AIA/NCS and common names in English, Spanish, French, German, Italian and Portuguese, else what's
   drawn on it: door swings, stair treads, glazing as close pairs of lines, walls as pairs 10–45 cm
   apart), objects in their own coordinate system (AutoCAD's mirrored "extrusion −Z" copies), the
   floors on a sheet (a border frame ignored, plans drawn close together pulled apart, and with no
   titles the order read from the stair arrows: UP on the lowest plan, DOWN on the top; elevations
   and sections beside the plans left out by their titles or because they show no doors, rooms or
   walls), wall openings closed however the window is drawn, room names in any script (Spanish and
   Chinese room words known), every room from the linework
   (door swings close openings; open-plan spaces split by their labels), room types from their names
   including abbreviations (`M.B.R.`, `T&B`, `W.C.`, `OTS`…), columns, ducts, lifts and stairs.
2. **Stacks the floors** — each floor is aligned on the one below by RANSAC over column pairs (the
   columns that *don't* match are the findings), with core/outline fallbacks and a hand-adjust mode.
3. **Checks** every floor pair cell by cell.
4. **Shows it** three ways:
   - **Overlay** — registration colours (floor below cyan, floor above violet; where they agree the
     lines add up to white). The ruler button shows the drawing's own **dimensions** — DIMENSION
     entities drawn from their blocks exactly as on the sheet (or rebuilt from their definition points),
     plus anything on dimension layers — with the dimension text as written (mm, m or ft-in).
   - **Stack** — an exploded 3D “X-ray” with plumb lines dropped from every column.
   - **Model** — the plans turned into a 3D building: walls to full height (the space between a
     wall's two lines becomes solid wall, however it was drawn), lintels over every door swing,
     sill + glass + lintel in every window, slabs with lift/duct shafts left open, low parapets round
     balconies, stair treads and a roof. Show the building up to any floor, slide a section cut
     through it like a dollhouse, set storey heights, tint rooms by type, and download a **.glb**
     (Blender, SketchUp with a glTF importer, Rhino 8, Windows 3D Viewer…).
5. **Hands it back** — a markups DXF (rings + tags on both floors, `PLUMB-*` layers, in the drawing's
   own units and coordinates — XREF it at 0,0), a CSV issue log, and a printable coordination report
   with a snapshot per issue.

**Optional AI assist** (your own Anthropic API key, saved in Settings, called directly from the browser): *Ask AI*
reads layer names and room labels the rules miss (office codes, other languages) and proposes
corrections you approve; *RFIs* drafts one request per consultant from the findings. Only names and
findings are sent, never geometry. Uses Anthropic’s API (Opus 5, with server-side refusal fallback).

Everything else runs locally in a Web Worker. Drawings never leave the computer.

## Files

```
index.html        landing page (css/landing.css, js/pages/landing.js, img/hero-*.webp)
app/*.html        the app's pages (css/base.css shared tokens + components, css/shell.css pages,
                  css/app.css workspace)
js/pages/         one script per page: library, import, project, issues, settings, help, landing
js/workspace.js   plan / stack / 3D model workspace
js/areas.js       area statements: RERA carpet area and FSI under CGDCR 2017 (pure)
js/rules.js       bye-law checks: CGDCR 2017 Parts II and III, NBC 2016 room sizes (pure)
js/orient.js      floors drawn turned or mirrored: read from a turned copy, mapped back to the sheet; fit and twin tests
js/shell/         store.js (IndexedDB), model.js (projects, revisions, issue history; pure), sheet.js (marking floors on the sheet),
                  engine.js (worker + caching), projects.js, thumbs.js, ui.js, icons.js
js/dxf.js         DXF reader (R12–2018: LINE/(LW)POLYLINE+bulges/ARC/CIRCLE/ELLIPSE/SPLINE/TEXT/MTEXT/
                  SOLID/HATCH/INSERT with nested, mirrored and arrayed blocks; paper space skipped)
js/recognize.js   units, layer roles, floor detection, per-floor rooms/columns/footprint (raster topology)
js/raster.js      occupancy grid, flood labelling, exact distance transform, contour tracing
js/checks.js      floor alignment + every vertical-coordination check
js/pipeline.js    one file or one file per floor → analysis
js/worker.js, js/pack.js   off-main-thread analysis, compact transferable results
js/view2d.js      registration overlay (canvas), pins, hover X-ray, hand alignment
js/view3d.js      three.js exploded stack
js/massing.js     plan → 3D parts: solid walls, parapets, door openings, windows (fine raster + contours)
js/model3d.js     three.js building model, section cut, heights, GLB export
js/dims.js        the drawing's dimensions per floor (from *D blocks, or rebuilt), unit-aware labels
js/dwg.js         DWG → DXF with LibreDWG (lazy-loaded WebAssembly)
js/export.js      markups DXF (R12), CSV, report; js/dxfwrite.js R12 writer
js/ai.js          optional AI assist (naming, RFIs)
samples/          riverside-residency.dxf (G+3, five planted problems)
tools/            make-sample.mjs (regenerates the sample), png.mjs (debug renderer)
test/             suite.mjs + fixtures.mjs (a second building drafted in the opposite style)
```

## Tests

```bash
node demos/plumb/test/suite.mjs
```

75 checks: the shipped sample must yield exactly its 9 planted issues; *Lakeview Court* (metres,
floors stacked vertically, walls as polylines on a meaningless layer name, door blocks inserted
rotated and mirrored, hatched columns, multi-line MTEXT tags, block-less DIMENSIONs, one floor drawn
off-grid) must yield exactly its 5 — as one file and as one file per floor; dimensions read from
blocks and rebuilt from points; a binary-DXF round trip gives identical results; the 3D model finds
every door, window and parapet; issue history across revisions (kept, resolved, reopened; floors
renamed, files added or dropped or reordered, plans moved); *Casa*, a sheet like the ones on free
plan sites (both storeys side by side 0.6 m apart in a border, no titles, metres saved as "inches",
mirrored sliding-door blocks, glazing and treads on code-named layers) must read as two floors with
the bathroom over the dining room, and, with its plans only 20 cm apart, read as one floor until two
boxes are marked by hand; area statements (Table 6.5 FSI values, walls split into partitions and
external walls, carpet area, exemptions with their clauses, apartments' stilt floors and common
areas, flats with their own carpet and balconies, landing allowances, lofts over 30% counted, mezzanines in FSI and carpet, re-assigned spaces, CSV); bye-law checks (the CGDCR tables, room widths, openings and what
they face, stair flights from their treads, margins, parking, lifts and heights failing when they
should, rules asking for what the plans can't show); plus markup coordinates, level parsing
(including `GF`/`FF`/`SF`/`TF` file names) and text anchoring.

Plumb is a coordination aid, not a structural or services design check.
