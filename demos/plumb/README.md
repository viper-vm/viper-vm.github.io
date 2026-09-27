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
“FIRST FLOOR PLAN”), or one file per floor (`ground.dxf`, `first-floor.dwg`, `L2.dxf` …).

**Formats:** DWG (AutoCAD R13 → 2025, read with [LibreDWG](https://www.gnu.org/software/libredwg/)
via the `@mlightcad/libredwg-web` WebAssembly build — GPL-3.0, fetched from jsDelivr only the first
time a DWG is opened), DXF ASCII (R12 → 2018+) and binary DXF. Several files at once, in any mix.

## What it does

1. **Understands the drawing** — units (from `$INSUNITS`, else from door-swing radii), what each
   layer holds (AIA/NCS and common names, else what's drawn on it), every room from the linework
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

**Optional Claude assist** (your own Anthropic API key, called directly from the browser): *Ask Claude*
reads layer names and room labels the rules miss (office codes, other languages) and proposes
corrections you approve; *RFIs* drafts one request per consultant from the findings. Only names and
findings are sent, never geometry. Uses Claude Opus 5 with server-side refusal fallback.

Everything else runs locally in a Web Worker. Drawings never leave the computer.

## Files

```
index.html, css/app.css
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
js/ai.js          optional Claude assist (naming, RFIs)
samples/          riverside-residency.dxf (G+3, five planted problems)
tools/            make-sample.mjs (regenerates the sample), png.mjs (debug renderer)
test/             suite.mjs + fixtures.mjs (a second building drafted in the opposite style)
```

## Tests

```bash
node demos/plumb/test/suite.mjs
```

36 checks: the shipped sample must yield exactly its 9 planted issues; *Lakeview Court* (metres,
floors stacked vertically, walls as polylines on a meaningless layer name, door blocks inserted
rotated and mirrored, hatched columns, multi-line MTEXT tags, block-less DIMENSIONs, one floor drawn
off-grid) must yield exactly its 5 — as one file and as one file per floor; dimensions read from
blocks and rebuilt from points; a binary-DXF round trip gives identical results; the 3D model finds
every door, window and parapet; plus markup coordinates, level parsing and text anchoring.

Plumb is a coordination aid, not a structural or services design check.
