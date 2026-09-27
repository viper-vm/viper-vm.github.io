# Groundtruth — India's megaprojects, watched from orbit

A satellite time machine. Pick one of 33 curated megaprojects (Navi Mumbai Airport,
Atal Setu, the Chenab bridge, Khavda, Central Vista…) and scrub through every distinct
satellite capture of it since 2010. Or scan **any spot on Earth** and get the same.

**Live:** https://viper-vm.github.io/demos/groundtruth/

## What you can do

| | |
|---|---|
| **Six compare modes** | Single · Swipe (draggable divider) · Lens (spyglass that follows the cursor, Shift+scroll resizes) · Split · Blink · Contact sheet |
| **Real capture dates** | Every frame is labelled with the acquisition date, satellite and resolution (e.g. *12 Oct 2025 · WorldView-2 · 50 cm*) |
| **Milestones on the timeline** | Foundation stones, test flights, inaugurations — click one to jump to the first capture after it |
| **Two imagery sources** | Hi-res (Esri World Imagery Wayback, ~30–60 cm) and Sentinel-2 yearly cloud-free mosaics (10 m, 2016–2025) for huge sites like Khavda or Bhadla |
| **Explore anywhere** | Pan anywhere, press Scan: the archive is walked live and every distinct capture of that spot is listed |
| **Watchlist** | Star a project or spot; each time Esri publishes a new release, new captures are flagged (stored in your browser only) |
| **Export** | Timelapse video (MP4 via WebCodecs, WebM fallback) in 16:9 / 9:16 / 1:1 at 720p/1080p with date stamps & milestone captions; still images; before/after pairs; contact-sheet posters |
| **3D, measure, labels** | Terrain draping (great for the Himalayan sites), geodesic distance & area, OSM place labels |
| **In the news** | Headlines pulled from the India Infra Atlas feed; the Atlas links back with a "From orbit" button |
| **Shareable links** | The URL hash stores project/spot, mode, A/B frames and camera |

Keyboard: `←/→` step (moves B in compare; `Shift` moves A) · `Space` play · `1–6` modes ·
`T` 3D · `L` labels · `M` measure · `E` export · `/` search · `?` help.

## How the archive works

Esri republishes its World Imagery basemap roughly monthly and keeps every release since
Feb 2014 (196 as of Aug 2026). For a tile and a release, the `tilemap` endpoint says which
older release the pixels actually come from (`select`) plus the tile's byte size. Walking
that chain backwards from the newest release gives every distinct version of the tile;
identical byte sizes are de-duplicated. Each version's metadata layer then gives the real
acquisition date, sensor and resolution at the focus point — which is why some captures
predate 2014. Explore mode probes releases in parallel (sample every 12th release, then
close the gaps), which needs ~3 round trips instead of ~20.

## Files

```
index.html            shell (MapLibre from jsDelivr, fonts from Google)
css/app.css           the whole design system (dark "observatory")
js/app.js             controller: rail, routing, watchlist, news, export dialog
js/maps.js            MapPair: two synced MapLibre maps → every compare mode
js/timeline.js        SVG timeline with capture pips, milestones, A/B handles
js/wayback.js         archive client (browser + Node): releases, scans, metadata
js/compositor.js      draws any frame of any place from tiles onto a canvas
js/exporter.js        MP4/WebM timelapse, stills, before/after, contact sheet
data/projects.json    33 curated projects: facts, milestones, framing, keywords
data/captures.json    baked capture history per project (generated)
card.jpg              og:image
```

## Refreshing the baked captures

```bash
node scripts/groundtruth/bake.mjs            # all projects (~3 min)
node scripts/groundtruth/bake.mjs chenab,t2  # just some
```

`.github/workflows/groundtruth-bake.yml` runs this monthly. The app also checks for newer
archive releases on its own and merges fresh captures client-side, so the baked file is a
speed-up, not a dependency.

**Adding a project:** append to `data/projects.json` (`view` = map centre/zoom framed for
a ~1150 px wide map, `focus` = the spot whose history defines the timeline, `scanZ` =
tile zoom for the scan, `src` = `hires` or `s2`, optional `a` = release number of a
nicer default "before"), then run the bake for its id.

## Credits

Imagery: Esri World Imagery Wayback (Maxar/Vantor, Earthstar Geographics). Sentinel-2
cloudless by EOX IT Services — contains modified Copernicus Sentinel data (CC BY-NC-SA
4.0; 2016 CC BY 4.0). Labels © OpenStreetMap contributors via OpenFreeMap. Elevation: AWS
Terrain Tiles. Geocoding: Photon by Komoot. Project facts are compiled from public
reporting and may contain errors.
