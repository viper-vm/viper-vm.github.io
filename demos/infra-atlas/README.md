# India Infra Atlas 🛰️

A living map of India's infrastructure, technology, energy and defense news.
Every story is geocoded and pinned where the project actually is; corridors
(expressways, metro lines, rail routes) are drawn as alignments, not dots.
The dataset refreshes itself every morning via GitHub Actions.

**Live:** `/demos/infra-atlas/`

## Features

| Area | What you get |
|---|---|
| Map | MapLibre GL vector map — pan, zoom, rotate, tilt. Streets / Satellite (Esri) / Terrain (OpenTopoMap) / Dark basemaps |
| 3D | Real elevation (AWS terrain tiles) with hillshading — toggle **3D** and tilt over the Himalayas |
| Tracks | **Rail** toggle overlays actual railway + metro lines, stations, electrification (OpenRailwayMap) |
| News layer | Pins colored by category, sized by investment, clustered at low zoom; corridors drawn as routes |
| Detail | Click a pin → investment, capacity, status, benefits, sources, project timeline (related updates clubbed) |
| Timeline | Bottom bar: histogram + dual-handle date range + play button (watch the country build itself) |
| Tools | Distance measure, area measure, personal marks (named pins with notes, saved locally, import/export JSON) |
| Search | One box searches the news dataset *and* every place in India (Nominatim geocoding) |
| Sharing | `?n=<story-id>` deep links to a story; map position lives in the URL hash |
| Handoff | Every story has "Apple Maps" / "Google Maps" buttons that open the exact coordinates |

## How the daily update works

```
GitHub Actions cron (07:00 IST)
  └─ scripts/infra-atlas/fetch-news.mjs
       ├─ polls Google News RSS queries (roads, metro, rail, aviation/ports,
       │  energy, defence, semiconductors, water) + PIB
       ├─ dedupes against seen.json + news.json
       ├─ extracts: category (keywords), status, ₹ crore, capacity
       ├─ geocodes via data/gazetteer.json (202 Indian places, aliases included)
       ├─ optional: Claude API enrichment — clean summaries, precise site
       │  coordinates, benefits, corridor routePoints  (set ANTHROPIC_API_KEY
       │  in repo Settings → Secrets → Actions)
       ├─ located stories  → data/news.json  (the map reads this)
       ├─ unlocated stories → data/inbox.json (manual review)
       └─ commit + push  → GitHub Pages redeploys automatically
```

Run it manually anytime: **Actions → "Infra Atlas · daily news update" → Run workflow**,
or locally `node scripts/infra-atlas/fetch-news.mjs --dry-run`.

Without an API key the keyword+gazetteer heuristic still works (it found and
located 16 stories on its first live run); with a key, Claude reads each
headline like an analyst — better summaries, exact plant/corridor coordinates,
benefits and route lines. Cost is a few paise per story with Haiku.

## Data model (`data/news.json`)

```json
{
  "id": "2026-04-08-cabinet-approves-jaipur-metro-phase-2",
  "date": "2026-04-08",
  "title": "…", "summary": "…",
  "category": "metro|roads|rail|aviation|ports|energy|defense|tech|water",
  "status": "announced|approved|under-construction|inaugurated|operational|test|trial",
  "location": { "name": "Jaipur", "state": "Rajasthan", "lat": 26.885, "lng": 75.805 },
  "investmentCr": 13037.66, "capacity": "42.8 km, 36 stations",
  "benefits": ["…"], "project": "Jaipur Metro Phase 2",
  "sources": [{ "name": "PIB press release", "url": "…" }],
  "routePoints": [[75.778, 26.988], …]   // optional corridor alignment
}
```

Items sharing a `project` name are clubbed — the detail panel shows the whole
project timeline (e.g. approval → foundation → trial run → inauguration).

## Seed dataset

The first 50 stories (Oct 2025 – Jul 2026) were researched from credible
sources — PIB, The Hindu, Indian Express, Naval News, Metro Rail News, Adani
releases and others — the same primary sources that AIM Network, InfraTalks,
ET and Defense Matrix report from. Auto-collected entries can contain errors;
always check the linked source.

## Roadmap / future expansions

- [ ] **Inbox review UI** — approve/locate `inbox.json` stories from the browser
- [ ] **State/district choropleth** — investment heat by state, month by month
- [ ] **Compare mode** — two date windows side by side ("what changed this quarter?")
- [ ] **Watchlists** — follow a project/district and highlight new updates
- [ ] **RSS/email digest** — weekly "what got built near your marks"
- [ ] **GTFS metro layers** — official alignment shapefiles for operational metros
- [ ] **Defence layer polish** — test-range geofences, corridor ranges for missile tests
- [ ] **Video sources** — attach YouTube explainer links (AIM Network, InfraTalks…) per story
- [ ] **Offline PWA** — installable app with cached tiles for the last viewport
- [ ] **MapKit JS variant** — true Apple Maps basemap (needs Apple Developer account)

## Credits

MapLibre GL JS · OpenFreeMap (OSM) · Esri World Imagery · OpenTopoMap ·
AWS/Mapzen Terrain Tiles · OpenRailwayMap · Nominatim. News © respective
publishers, linked per story. Personal tracking tool; not an official record.
