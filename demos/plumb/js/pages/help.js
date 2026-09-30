// Plumb — Help: getting a drawing ready, and what every check means.

import { injectIcons, rail, wireRail, $ } from '../shell/ui.js';

injectIcons();
const railEl = $('#rail');
railEl.innerHTML = rail('help');
wireRail(railEl);

const SECTIONS = [
  ['start', 'Getting started', `
    <p>Plumb reads the floor plans you already draw and checks what has to line up <em>between</em> floors: columns, wet areas, ducts, lifts, stairs and slab edges. It also turns the plans into a 3D building.</p>
    <ol>
      <li><b>New project</b> → choose your DWG or DXF files (or drop them anywhere).</li>
      <li>The import wizard shows the floors it found, the units, and what each layer holds. Fix anything that’s off; the defaults are usually right.</li>
      <li>The project overview shows what to check. Open the <b>Plan</b> to see each floor over the one below, or the <b>3D model</b>.</li>
      <li>When the drawings change, <b>Upload revision</b>. Plumb matches every issue across revisions and marks what got fixed.</li>
    </ol>
    <p class="note">Try the sample building first: it has five problems planted on purpose.</p>`],
  ['prepare', 'Preparing drawings', `
    <h3>Floor plans in one file</h3>
    <p>Lay the plans out side by side (or one above the other) in model space, with a title near each one: <code>STILT FLOOR PLAN</code>, <code>FIRST FLOOR PLAN</code>, <code>2ND FLOOR PLAN</code>, <code>TYPICAL FLOOR PLAN (3RD–7TH)</code>, <code>TERRACE PLAN</code>. Plumb reads the level from the title.</p>
    <h3>One file per floor</h3>
    <p>Name the files by floor: <code>ground.dwg</code>, <code>first-floor.dxf</code>, <code>L2.dxf</code>, <code>B1.dwg</code>, <code>terrace.dxf</code>. They’re lined up on their columns, so they don’t need to share an origin.</p>
    <h3>What helps recognition</h3>
    <ul>
      <li><b>Walls</b> on wall layers, closed at openings (a short line across each wall end).</li>
      <li><b>Doors</b> drawn with their swing (an arc), or as door blocks. Swings close the openings, so rooms become closed shapes.</li>
      <li><b>Columns</b> on a column layer, as hatched or closed rectangles or circles.</li>
      <li><b>Room names</b> as text inside each room: <code>BED ROOM</code>, <code>TOILET</code>, <code>KITCHEN</code>, <code>M.B.R.</code>, <code>T&amp;B</code>, <code>W.C.</code>, <code>OTS</code>. Open-plan areas can carry several names; Plumb splits them.</li>
      <li>Ducts drawn with the usual cross, lifts with a cross, stairs with treads.</li>
    </ul>
    <p>Layer names don’t have to follow any standard. Plumb reads them by name first, then by what’s drawn on them; you can correct any layer in the wizard, and it remembers your office’s names.</p>
    <h3>Marking floors by hand</h3>
    <p>The <b>Floors</b> step shows the whole sheet with a box round each plan Plumb found. If plans sit very close or touch, if a plan was missed, or if an elevation was taken for a plan, fix it there: <b>drag across a plan</b> to add a floor, drag a box to move it, pull its corners to resize, and press <kbd>Delete</kbd> to remove one. Put the floors in order with the arrows on each card. <b>Detect again</b> forgets your boxes.</p>`],
  ['formats', 'Supported files', `
    <ul>
      <li><b>DWG</b> from AutoCAD R13 to 2025 (and BricsCAD, ZWCAD, DraftSight, Revit and ArchiCAD exports). DWG is read with LibreDWG, which is downloaded once the first time you open a DWG.</li>
      <li><b>DXF</b>, text or binary, any version from R12.</li>
      <li>Several files at once, in any mix.</li>
    </ul>
    <p>Not yet: PDF, IFC, SketchUp, Rhino and scanned drawings. Export DWG or DXF from those tools for now.</p>`],
  ['checks', 'What each check means', `
    <h3>Floating column</h3>
    <p>A column with no column under it on the floor below. Its load needs a transfer beam, and seismic codes (IS 1893) treat a floating column as an irregularity. Found by matching every column’s footprint against the floor below after the floors are lined up.</p>
    <h3>Column shifted</h3>
    <p>A column that only partly sits on the one below. The report gives the offset in mm and how much of it bears; any step creates eccentricity for the structural engineer to design for.</p>
    <h3>Column gets bigger going up</h3>
    <p>An upper column wider than the one it sits on. Usually a drafting slip, occasionally deliberate.</p>
    <h3>Wet room over a dry room</h3>
    <p>A toilet or kitchen above a bedroom or living room. Drains run through the ceiling below and any leak lands there; it needs a sunken slab and a dropped ceiling, or a re-plan. Measured cell by cell, so the overlap area is exact.</p>
    <h3>Duct, lift or stair shifted or missing</h3>
    <p>Shafts and cores have to run straight. Plumb measures how much of each duct, lift well and staircase overlaps the one below and reports the shift in mm, or that nothing continues down.</p>
    <h3>Overhang</h3>
    <p>Floor plate beyond the floor below: balconies and cantilevers, with their depth and area. Over 1.8 m is flagged high.</p>
    <p class="note">These are coordination checks for the architect, not structural or services design. Treat every finding as a question for the right consultant.</p>`],
  ['model', 'The 3D model', `
    <p>Plumb stands every floor’s walls up to full height, puts lintels over door openings and sills, glass and lintels in windows, adds slabs (leaving lift and duct shafts open), low parapets round balconies, and a roof.</p>
    <ul>
      <li><b>Levels</b> (left): show the building up to a floor.</li>
      <li><b>Section</b>: slice through the top floor shown to look into it.</li>
      <li><b>Heights</b>: plans don’t carry heights, so set floor-to-floor, slab, door head, sill, window head and parapet. Office defaults are in Settings.</li>
      <li><b>Export .glb</b> for Blender, SketchUp (with a glTF importer), Rhino 8 or any glTF viewer.</li>
    </ul>`],
  ['dims', 'Dimensions', `<p>The ruler button in the plan shows the dimensions drawn in the file, with the numbers as written (mm, m or ft-in). Dimensions that are the same on both floors show in white; the ones that differ show in the floor’s colour.</p>`],
  ['issues', 'Issues and revisions', `
    <p>Each finding has a status: <b>Open</b>, <b>In review</b> (with a consultant), <b>Resolved</b>, or <b>Accepted as drawn</b>. Add notes as the conversation goes.</p>
    <p>When you upload a revision, every issue is matched to the same place on the same floors. Ones that disappear are marked resolved in that revision; ones that come back are reopened. The history shows it all.</p>
    <p>The markups DXF rings every open issue on both floors, in the drawing’s own units, on <code>PLUMB-*</code> layers. XREF or insert it at 0,0 over the drawing.</p>`],
  ['amd', 'Ahmedabad and CGDCR 2017', `
    <p>Plumb is set up for Ahmedabad first. Projects in the Ahmedabad Municipal Corporation and AUDA areas follow Gujarat’s Comprehensive General Development Control Regulations, CGDCR 2017.</p>
    <p><b>Area statement</b> (a project’s <b>Areas</b> page): RERA carpet area and FSI worked out from the plans, floor by floor. <b>Bye-law checks</b> (the <b>Bye-laws</b> page): the plans against CGDCR 2017 Parts II and III, with the clause beside every result.</p>`],
  ['areas', 'Area statements', `
    <p>A project’s <b>Areas</b> page works out, from the drawings: built-up area, the area counted towards FSI, RERA carpet area, balconies and verandahs, open terraces, common areas, shafts and walls, floor by floor and in total. Add the plot area and zone to see the FSI consumed against the base and maximum FSI.</p>
    <h3>RERA carpet area</h3>
    <p>Under the Real Estate Act 2016, §2(k): the net usable floor area, without the external walls, service shafts and the exclusive balcony, verandah and open terrace areas (stated separately), but with the internal partition walls. Plumb measures each room inside its walls and splits every wall between the spaces on its two sides; a wall with carpet on both sides is a partition.</p>
    <h3>FSI under CGDCR 2017</h3>
    <p>Built-up area on every floor, to the outer face of the walls, divided by the plot area. Not counted, under Part II §6.3.2: staircases with their intermediate landings, lifts with their wells, landings and walls, parking basements and hollow plinths, ramps, electric rooms, lofts up to 30% and pergolas. Balconies are not exempt. Base, chargeable and maximum FSI come from Table 6.5 for category D1 (AUDA) and can be changed.</p>
    <h3>What you decide</h3>
    <p>Plumb guesses what each space is from its name. Unnamed spaces wait for you (a terrace? a gap?), and anything can be re-assigned in the room list: room, balcony or verandah, open terrace, common area, staircase, lift, shaft, parking, electric room, pergola, or not counted. Choose <b>Bungalow</b> for one unit (its stair is part of the carpet area) or <b>Apartments</b> (stairs, lifts and lobbies are common).</p>
    <p class="note">Not yet: landing allowances beyond the stair and lift as drawn, lofts, mezzanines, and carpet area flat by flat. Check the zone and FSI against the TP scheme and the latest amendments before submitting.</p>`],
  ['rules', 'Bye-law checks', `
    <p>A project’s <b>Bye-laws</b> page checks the drawings against CGDCR 2017 as it applies in Ahmedabad (category D1, AUDA). Each rule shows its clause, what it needs, what Plumb measured and, when you open it, a small plan of each floor with the rooms it’s about. A result is <b>Fails</b>, <b>Check</b> (short of it where the regulation allows a mechanical alternative, or good practice only), <b>Needs information</b>, <b>Passes</b> or <b>Doesn’t apply</b>.</p>
    <h3>What’s checked</h3>
    <ul>
      <li><b>Part II, planning:</b> height against the road width (Table 6.23), road-side margin (6.24), side and rear margins (6.26), FSI within the maximum (6.5), parking (6.44: cars for a house by plinth area; a share of the FSI area for flats and other uses), no habitable rooms in a basement (6.8.4).</li>
      <li><b>Part III, performance:</b> storey heights (2.9 m for habitable floors), basement and hollow-plinth heights, staircase flight width and tread (Table 13.2), lifts above 10 m and 25 m (13.12), openings of habitable rooms (⅐ of the floor, and onto open space), bath and WC ventilation (0.25 m² to open-to-sky space), stair windows for houses, WC size (0.9 m²), the 900 mm entrance door.</li>
      <li><b>NBC 2016 room sizes</b>, shown as warnings: CGDCR sets no minimum room sizes, so these are good practice (habitable rooms 9.5 / 7.5 m², kitchens 5 m², baths 1.8 m², WCs 1.1 m²). Hide them if you don’t want them.</li>
    </ul>
    <h3>What it needs from you</h3>
    <p>Plans don’t show the site: add the road width, the plot area (shared with the area statement), the margins on your site plan, and parking that’s outside the building. Building height is worked out from the storeys and the model’s storey heights; enter the real height to the terrace to be exact.</p>
    <h3>How it measures</h3>
    <p>Room widths are the widest circle that fits, wall face to wall face. Openings are the gaps in walls: a door where there’s a swing, a window where lines cross the gap, otherwise an opening; the spaces on both sides tell what it opens onto. Windows are taken from sill to head height, as set in the model. Stair flights are measured from their tread lines, so the stair must be on a stair layer. Open-plan rooms (a kitchen, dining and living with no walls between) are checked as one room.</p>
    <p class="note">A checking aid, not an approval. Not yet: fire safety (Fire Prevention and Life Safety Measures Regulations 2016), risers (they need a section), lofts and mezzanines, OTS and courtyard sizes, common plot, margins between buildings. Check against the current amendments before you submit.</p>`],
  ['privacy', 'Privacy', `<p>Your drawings are read on your computer and stored only in this browser. Nothing is uploaded. The optional AI assist sends layer names, room labels and findings (never the drawing) to the AI provider with your own key.</p>`],
  ['keys', 'Keyboard shortcuts', `
    <ul>
      <li><kbd>2</kbd> plan · <kbd>3</kbd> stack · <kbd>M</kbd> 3D model</li>
      <li><kbd>D</kbd> dimensions · <kbd>F</kbd> fit · <kbd>H</kbd> hide panels (3D)</li>
      <li><kbd>J</kbd> / <kbd>K</kbd> next / previous issue · <kbd>Esc</kbd> clear the selection</li>
    </ul>`],
  ['faq', 'Questions', `
    <h3>It found no floor plans, or only one</h3><p>Mark them by hand in the Floors step: drag across each plan on the sheet. Titles with a level in them (see Preparing drawings) or one file per floor also help.</p>
    <h3>The rooms look wrong</h3><p>Usually a wall layer read as something else, or doors without swings. Fix the layer in the wizard (Layers step), or click a room in the plan to set its type.</p>
    <h3>The floors don’t line up</h3><p>Plumb aligns floors on their columns. If a floor has few columns, use <b>Adjust</b> in the plan to line it up by hand.</p>
    <h3>Can I move a project to another computer?</h3><p>Not yet; project export and cloud sync are planned.</p>`],
];

$('#page').innerHTML = `
  <div class="page-head"><div><h1>Help</h1><div class="sub">Getting drawings ready, and what every check means.</div></div></div>
  <div class="doc">
    <nav class="doc-toc" aria-label="Help topics">${SECTIONS.map(([id, t]) => `<a href="#${id}">${t}</a>`).join('')}</nav>
    <article class="doc-body">${SECTIONS.map(([id, t, body]) => `<h2 id="${id}">${t}</h2>${body}`).join('')}</article>
  </div>`;
