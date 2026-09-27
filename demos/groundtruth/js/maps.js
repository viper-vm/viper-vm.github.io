// Groundtruth · two synchronised MapLibre maps that make every compare mode possible:
// A (below) and B (above). Swipe clips B to one side, Lens clips it to a circle,
// Split puts them side by side, Blink flickers B. Single mode shows only A.

import { tileUrl } from "./wayback.js";

const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
const OFM = "https://tiles.openfreemap.org/planet";
const DEM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const NAME = ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name"]];

// Labels come from OpenFreeMap. They are added after the map loads so a slow or
// unavailable label server can never block the imagery (the whole point of the app).
const HALO = { "text-color": "#f4f6f8", "text-halo-color": "rgba(6,8,11,0.85)", "text-halo-width": 1.4, "text-halo-blur": 0.4 };
const LABEL_LAYERS = [
  { id: "lbl-water", type: "symbol", source: "ofm", "source-layer": "water_name", minzoom: 9,
    layout: { "text-field": NAME, "text-font": ["Noto Sans Italic"], "text-size": 12, "text-letter-spacing": 0.1 },
    paint: { ...HALO, "text-color": "#bfe6ff" } },
  { id: "lbl-road", type: "symbol", source: "ofm", "source-layer": "transportation_name", minzoom: 14,
    layout: { "symbol-placement": "line", "text-field": NAME, "text-font": ["Noto Sans Regular"], "text-size": 11 },
    paint: { ...HALO, "text-color": "#e9edf1" } },
  { id: "lbl-aero", type: "symbol", source: "ofm", "source-layer": "aerodrome_label", minzoom: 10,
    layout: { "text-field": NAME, "text-font": ["Noto Sans Bold"], "text-size": 12 },
    paint: { ...HALO, "text-color": "#ffe2a8" } },
  { id: "lbl-place-minor", type: "symbol", source: "ofm", "source-layer": "place", minzoom: 11,
    filter: ["in", ["get", "class"], ["literal", ["village", "suburb", "neighbourhood", "hamlet", "quarter"]]],
    layout: { "text-field": NAME, "text-font": ["Noto Sans Regular"], "text-size": 11.5 },
    paint: HALO },
  { id: "lbl-place", type: "symbol", source: "ofm", "source-layer": "place", minzoom: 4.4,
    filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
    layout: { "text-field": NAME, "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 4, 11, 10, 15] },
    paint: HALO },
];

function baseStyle() {
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {},
    layers: [{ id: "bg", type: "background", paint: { "background-color": "#0b0e12" } }],
  };
}

const LABEL_IDS = LABEL_LAYERS.map((l) => l.id);

/** Imagery always sits under labels and overlays. */
const imageryBefore = (map) => (map.getLayer(LABEL_IDS[0]) ? LABEL_IDS[0] : map.getLayer("measure-fill") ? "measure-fill" : undefined);

// Wayback tiles are requested through "wbk://release/z/x/y". Missing zoom levels come
// back as 404s (without CORS headers), which MapLibre would render as holes; instead
// we serve the matching quarter of the nearest parent tile.
let protocolReady = false;
function registerWaybackProtocol() {
  if (protocolReady) return;
  protocolReady = true;
  maplibregl.addProtocol("wbk", async (params, abort) => {
    const [r, z, x, y] = params.url.slice(6).split("/").map(Number);
    for (let dz = 0; dz <= 4 && z - dz >= 0; dz++) {
      const n = 1 << dz, px = x >> dz, py = y >> dz;
      let res;
      try { res = await fetch(tileUrl(r, z - dz, px, py), { signal: abort.signal }); }
      catch (e) { if (abort.signal.aborted) throw e; continue; }
      if (!res.ok) continue;
      if (dz === 0) return { data: await res.arrayBuffer() };
      const bmp = await createImageBitmap(await res.blob());
      const size = 256 / n;
      const c = new OffscreenCanvas(256, 256);
      const ctx = c.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bmp, (x - px * n) * size, (y - py * n) * size, size, size, 0, 0, 256, 256);
      bmp.close();
      const blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.92 });
      return { data: await blob.arrayBuffer() };
    }
    throw new Error("tile unavailable");
  });
}

function makeMap(container, view, interactive = true) {
  registerWaybackProtocol();
  return new maplibregl.Map({
    container,
    style: baseStyle(),
    center: view.c,
    zoom: view.z,
    maxZoom: 20,
    minZoom: 2,
    attributionControl: false,
    interactive,
    fadeDuration: 150,
    dragRotate: true,
    pitchWithRotate: true,
    canvasContextAttributes: { preserveDrawingBuffer: false },
  });
}

function whenSourceLoaded(map, id, timeout = 2500) {
  return new Promise((resolve) => {
    if (map.getSource(id) && map.isSourceLoaded(id)) return resolve(true);
    let done = false;
    const finish = (ok) => { if (done) return; done = true; map.off("sourcedata", on); clearTimeout(t); resolve(ok); };
    const on = (e) => { if (e.sourceId === id && map.isSourceLoaded(id)) finish(true); };
    const t = setTimeout(() => finish(false), timeout);
    map.on("sourcedata", on);
  });
}

export class MapPair {
  constructor({ stage, view }) {
    this.stage = stage;
    this.elA = stage.querySelector("#mapA");
    this.elB = stage.querySelector("#mapB");
    this.mapA = makeMap(this.elA, view);
    this.mapB = makeMap(this.elB, view);
    this.mode = "single";
    this.frames = { A: null, B: null };
    this.layers = { A: [], B: [] }; // recent imagery layer ids per map (newest last)
    this.labels = true;
    this.terrain = false;
    this.ready = Promise.all([this.mapA, this.mapB].map((m) => new Promise((r) => m.once("load", r))));
    this.ready.then(() => {
      for (const m of [this.mapA, this.mapB]) {
        try {
          m.addSource("ofm", { type: "vector", url: OFM, attribution: "Labels © OpenStreetMap contributors · OpenFreeMap" });
          for (const l of LABEL_LAYERS) m.addLayer({ ...l, layout: { ...l.layout, visibility: this.labels ? "visible" : "none" } });
        } catch (e) { console.warn("labels unavailable", e); }
        m.addSource("measure", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: "measure-fill", type: "fill", source: "measure", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#ffd166", "fill-opacity": 0.16 } });
        m.addLayer({ id: "measure-line", type: "line", source: "measure", filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": "#ffd166", "line-width": 2.2, "line-dasharray": [2, 1.2] } });
        m.addLayer({ id: "measure-pt", type: "circle", source: "measure", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 4.5, "circle-color": "#0b0e12", "circle-stroke-color": "#ffd166", "circle-stroke-width": 2 } });
      }
    });

    // keep the two cameras locked together
    let syncing = false;
    const sync = (src, dst) => () => {
      if (syncing || this.mode === "single") return;
      syncing = true;
      dst.jumpTo({ center: src.getCenter(), zoom: src.getZoom(), bearing: src.getBearing(), pitch: src.getPitch() });
      syncing = false;
    };
    this.mapA.on("move", sync(this.mapA, this.mapB));
    this.mapB.on("move", sync(this.mapB, this.mapA));
    this.mapA.on("moveend", () => this.terrain && setTimeout(() => this.reclamp(), 400));

    this.divider = stage.querySelector(".swipe");
    this.lens = stage.querySelector(".lens");
    this.swipeX = 0.5;
    this.lensR = 150;
    this.lensPos = null;
    this.bindSwipe();
    this.bindLens();
  }

  /** The map the user is looking at (for camera reads, markers, clicks). */
  get main() { return this.mapA; }
  maps() { return this.mode === "single" || this.mode === "grid" ? [this.mapA] : [this.mapA, this.mapB]; }

  // ---------- imagery ----------
  async setFrame(which, frame, { fade = 350 } = {}) {
    await this.ready;
    const map = which === "A" ? this.mapA : this.mapB;
    this.frames[which] = frame;
    if (!frame) return;
    const id = `img-${frame.src}-${frame.key}`;
    const list = this.layers[which];
    if (!map.getSource(id)) {
      map.addSource(id, { type: "raster", tiles: [frame.mapTiles || frame.tiles], tileSize: 256, maxzoom: frame.maxzoom ?? 18, attribution: frame.attribution });
    }
    const before = imageryBefore(map);
    if (!map.getLayer(id)) {
      map.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": 0, "raster-opacity-transition": { duration: fade, delay: 0 }, "raster-fade-duration": 120 } }, before);
    } else {
      map.setLayoutProperty(id, "visibility", "visible");
      map.moveLayer(id, before);
    }
    const idx = list.indexOf(id);
    if (idx >= 0) list.splice(idx, 1);
    list.push(id);
    const token = (map._gtToken = (map._gtToken || 0) + 1);
    await whenSourceLoaded(map, id, fade ? 2500 : 600);
    if (token !== map._gtToken) return; // superseded by a newer request
    map.setPaintProperty(id, "raster-opacity-transition", { duration: fade, delay: 0 });
    map.setPaintProperty(id, "raster-opacity", 1);
    // retire older layers once the new one has faded in; keep a few sources warm
    setTimeout(() => {
      if (token !== map._gtToken) return;
      for (const old of list.slice(0, -1)) {
        if (!map.getLayer(old)) continue;
        map.setPaintProperty(old, "raster-opacity-transition", { duration: 0, delay: 0 });
        map.setPaintProperty(old, "raster-opacity", 0);
        map.setLayoutProperty(old, "visibility", "none");
      }
      while (list.length > 6) {
        const gone = list.shift();
        if (map.getLayer(gone)) map.removeLayer(gone);
        if (map.getSource(gone)) map.removeSource(gone);
      }
    }, fade + 60);
  }

  // ---------- compare modes ----------
  setMode(mode) {
    const prev = this.mode;
    this.mode = mode;
    const st = this.stage;
    st.dataset.mode = mode;
    this.elB.style.clipPath = "";
    this.elB.style.opacity = "";
    if (mode === "swipe") this.applySwipe();
    if (mode === "lens") this.applyLens();
    const needsResize = prev === "split" || mode === "split";
    if (mode !== "single" && mode !== "grid") {
      const c = this.mapA;
      this.mapB.jumpTo({ center: c.getCenter(), zoom: c.getZoom(), bearing: c.getBearing(), pitch: c.getPitch() });
    }
    clearInterval(this.blinkTimer);
    if (mode === "blink") {
      let on = true;
      this.blinkTimer = setInterval(() => {
        on = !on;
        this.elB.style.opacity = on ? "1" : "0";
        st.dataset.blink = on ? "b" : "a";
      }, this.blinkMs || 850);
      st.dataset.blink = "b";
    }
    requestAnimationFrame(() => {
      if (needsResize || mode !== "single") { this.mapA.resize(); this.mapB.resize(); }
    });
    if (needsResize) setTimeout(() => { this.mapA.resize(); this.mapB.resize(); }, 60);
  }

  applySwipe() {
    const w = this.stage.clientWidth;
    const px = Math.round(this.swipeX * w);
    this.elB.style.clipPath = `inset(0 0 0 ${px}px)`;
    this.divider.style.left = `${px}px`;
  }

  bindSwipe() {
    const handle = this.divider;
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      const rect = this.stage.getBoundingClientRect();
      const move = (ev) => {
        this.swipeX = Math.max(0.02, Math.min(0.98, (ev.clientX - rect.left) / rect.width));
        this.applySwipe();
      };
      const up = () => { handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up); };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    });
    handle.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        this.swipeX = Math.max(0.02, Math.min(0.98, this.swipeX + (e.key === "ArrowLeft" ? -0.02 : 0.02)));
        this.applySwipe();
      }
    });
    new ResizeObserver(() => { if (this.mode === "swipe") this.applySwipe(); if (this.mode === "lens") this.applyLens(); }).observe(this.stage);
  }

  /** Animate the swipe divider across the view — the "reveal" when a project opens. */
  sweep(ms = 1600) {
    if (this.mode !== "swipe") return;
    const t0 = performance.now();
    const from = 0.9, to = 0.5;
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      this.swipeX = from + (to - from) * ease(t);
      this.applySwipe();
      if (t < 1 && this.mode === "swipe") requestAnimationFrame(step);
    };
    this.swipeX = from;
    this.applySwipe();
    requestAnimationFrame(step);
  }

  applyLens() {
    const w = this.stage.clientWidth, hgt = this.stage.clientHeight;
    const p = this.lensPos || { x: w / 2, y: hgt / 2 };
    this.elB.style.clipPath = `circle(${this.lensR}px at ${p.x}px ${p.y}px)`;
    this.lens.style.transform = `translate(${p.x - this.lensR}px, ${p.y - this.lensR}px)`;
    this.lens.style.width = this.lens.style.height = `${this.lensR * 2}px`;
  }

  bindLens() {
    this.stage.addEventListener("pointermove", (e) => {
      if (this.mode !== "lens") return;
      const r = this.stage.getBoundingClientRect();
      this.lensPos = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.applyLens();
    });
    this.stage.addEventListener("wheel", (e) => {
      if (this.mode !== "lens" || !(e.shiftKey || e.altKey)) return;
      e.preventDefault();
      e.stopPropagation();
      this.lensR = Math.max(50, Math.min(420, this.lensR * (e.deltaY > 0 ? 0.92 : 1.08)));
      this.applyLens();
    }, { capture: true, passive: false });
  }

  setLensRadius(r) { this.lensR = r; this.applyLens(); }

  // ---------- camera ----------
  view() {
    const m = this.mapA;
    const c = m.getCenter();
    return { c: [c.lng, c.lat], z: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() };
  }

  flyTo(view, opts = {}) {
    const target = { center: view.c, zoom: view.z, bearing: view.bearing ?? 0, pitch: this.terrain ? 55 : view.pitch ?? 0 };
    this.mapA.flyTo({ ...target, speed: 1.4, curve: 1.5, essential: true, ...opts });
  }

  jumpTo(view) {
    this.mapA.jumpTo({ center: view.c, zoom: view.z, bearing: view.bearing ?? 0, pitch: view.pitch ?? 0 });
  }

  // ---------- extras ----------
  async setLabels(on) {
    this.labels = on;
    await this.ready;
    for (const m of [this.mapA, this.mapB]) for (const id of LABEL_IDS) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  }

  async setTerrain(on) {
    await this.ready;
    this.terrain = on;
    for (const m of [this.mapA, this.mapB]) {
      if (on && !m.getSource("dem")) {
        m.addSource("dem", { type: "raster-dem", tiles: [DEM], encoding: "terrarium", tileSize: 256, maxzoom: 14, attribution: "Elevation: AWS Terrain Tiles" });
      }
      m.setTerrain(on ? { source: "dem", exaggeration: 1.25 } : null);
    }
    this.mapA.easeTo({ pitch: on ? 58 : 0, bearing: on ? this.mapA.getBearing() || -12 : 0, duration: 900 });
    if (on) {
      // Elevation data arrives after the camera starts tilting; re-clamp once it has.
      await Promise.all([this.mapA, this.mapB].map((m) => whenSourceLoaded(m, "dem", 6000)));
      setTimeout(() => this.reclamp(), 950);
    }
  }

  /**
   * MapLibre quirk: an animated easeTo/flyTo over terrain freezes the centre
   * elevation and never unfreezes it. If the elevation tiles arrive after the
   * animation (they usually do the first time 3D is switched on), the camera stays
   * at sea level — underground in the Himalaya — and the map renders black.
   * jumpTo({ elevation }) is MapLibre's public way to set it, keeping centre & zoom.
   */
  reclamp(tries = 8) {
    if (!this.terrain) return;
    const retry = (ms) => tries > 0 && setTimeout(() => this.reclamp(tries - 1), ms);
    if (this.mapA.isMoving() || this.mapB.isMoving()) return retry(400); // never cut a tilt short
    const m = this.mapA; // only A animates; B mirrors A's camera and stays unfrozen
    if (!m.getTerrain()) return;
    const ground = m.queryTerrainElevation(m.getCenter());
    if (ground == null) return retry(600); // elevation tiles not in yet
    if (Math.abs(m.getCenterElevation() - ground) > 30) m.jumpTo({ elevation: ground });
  }

  async setMeasure(fc) {
    await this.ready;
    for (const m of [this.mapA, this.mapB]) m.getSource("measure")?.setData(fc);
  }

  resize() { this.mapA.resize(); this.mapB.resize(); }
}
