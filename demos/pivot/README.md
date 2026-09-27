# Pivot — will it fit?

Rehearse the move before the movers come. Describe the item (a sofa with its real
seat/back/arm shape, a fridge that must stay upright, a box spring, a piano…) and walk the
route in — every door, hallway, turn, stair flight and lift. Pivot solves the
**piano mover's problem** for your actual home, in 3D, in your browser, and gives you:

- **A verdict you can trust** — it either finds a real collision-free motion, or says it couldn't.
- **The mover's playbook** — the exact sequence in plain words: *“Stand it on its left arm”,
  “Through the front door, back first”, “Pivot right in the hallway”, “Ride the lift up”*.
- **The tightest centimetre** — the pinch point is marked in 3D, and a colour strip under the
  timeline shows where the squeeze is.
- **What would help** — when it won't go, Pivot tests the usual remedies for you (legs off, the
  door off its hinges, bolt-on arms, tilting) and finds the largest size that *would* make it.
- **A mover's sheet** to print, and a link that reopens the exact item and route.

**Live:** https://viper-vm.github.io/demos/pivot/

## Why this is different

Furniture sites compare a few numbers (“if the doorway is wider than the diagonal depth…”). That
treats the sofa as a box and your home as a single doorway. Real deliveries fail at the
*combination* — a door that opens straight onto a narrow hallway, a landing with a low bulkhead,
a lift that is a few centimetres too shallow. Pivot models the whole route as one 3D space and
searches for an actual motion through it.

## How it works

| Piece | File | What it does |
|---|---|---|
| Route builder | `js/world.js` | Turns the steps (door, hallway, turn, stairs, lift, room) into free-space boxes, derives the walls from them on a rectilinear grid, adds stair treads, bulkheads and sloped soffits, lift “portals”, and guidance features. Non-adjacent spaces that would touch are separated by a wall. |
| Items | `js/items.js` | Each item is a union of boxes in its own frame — a sofa is base + back + two arms + legs, so its L-shaped profile can hook round a door frame like the real thing. |
| Geometry kernel | `js/geom.js` | Quaternions, separating-axis box tests (with penetration depth), a BVH over the walls. |
| Planner | `js/planner.js` | Bidirectional **RRT-Connect** in SE(3) with route-guided sampling, penetration-based *repair* and *retraction* (so trees slide along door jambs instead of stalling), lift teleports, and an exact nearest-neighbour KD-tree over a 7-D pose embedding. Paths are polished with continuous and orientation-only shortcuts, posture locking, and end simplification. |
| Carry postures | `js/app.js` | Several Web Workers race: one free search, and one each holding the item **upright**, **on its end** or **on its back** inside the building (it may tip freely outside and in the room) — the way movers actually carry things. The simplest successful plan wins. |
| Playbook | `js/playbook.js` | Reads the path: which of the item's axes is vertical (with hysteresis), which end leads, how much it turns about the vertical, where it is, and how tight it gets. |
| 3D view | `js/scene.js` | Three.js dolls'-house model (walls facing the camera vanish), per-floor focus, the animated item, ghosts at key poses, the search cloud while planning, the pinch marker. |

Search effort is budgeted in **collision checks, not seconds**, so a slow phone reaches the same
verdict as a fast laptop — it just takes longer.

Validated in Node against analytic limits: a rod around a 100 cm × 100 cm corner (theoretical
limit 267 cm once inflated) is solved at 265 cm and correctly refused at 272 cm; a sofa hooks
through a door its profile can't pass straight; every example solves reliably (6/6 seeds).
Re-run it with `node demos/pivot/test/suite.mjs` from the repo root.

## Limits (honest ones)

- A search that fails is not a mathematical proof. Very close “no”s deserve a professional.
- Rooms are boxes; skirting boards, radiators and door stops are up to your measurements.
- Soft items (foam mattresses) are treated as rigid — if it's close, it will probably bend through.
- Everything runs locally; nothing you type leaves the browser.

## Files

```
index.html          markup, icon sprite, help dialog
css/app.css         design system (light + dark)
js/app.js           state, editors, persistence (#p= link + localStorage), worker race, results
js/world.js         route → 3D world
js/items.js         item catalogue + dimension parser
js/geom.js          math kernel
js/planner.js       motion planner (pure JS, runs in workers or Node)
js/worker.js        worker entry
js/playbook.js      path → instructions
js/scene.js         Three.js rendering
js/examples.js      curated, pre-verified examples
test/suite.mjs      planner regression suite (Node)
```

`package.json` only marks the folder as ES modules so the planner can be tested in Node.
