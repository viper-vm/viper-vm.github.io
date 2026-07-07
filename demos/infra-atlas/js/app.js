/* India Infra Atlas — application */
"use strict";

/* ---------------- Category & status meta ---------------- */
const CAT = {
  metro:    { label: "Metro & transit",     color: "#8b5cf6" },
  roads:    { label: "Roads & expressways", color: "#f59e0b" },
  rail:     { label: "Railways",            color: "#ea580c" },
  aviation: { label: "Aviation",            color: "#0ea5e9" },
  ports:    { label: "Ports & shipping",    color: "#2563eb" },
  energy:   { label: "Energy",              color: "#16a34a" },
  defense:  { label: "Defense",             color: "#e11d48" },
  tech:     { label: "Tech & industry",     color: "#d946ef" },
  water:    { label: "Water & urban",       color: "#0d9488" },
};
const STATUS = {
  announced:            { label: "Announced",          bg: "#37414d", fg: "#c3cdd8" },
  approved:             { label: "Approved",           bg: "#123a5e", fg: "#7cc0ff" },
  "under-construction": { label: "Under construction", bg: "#4d3a10", fg: "#ffce6b" },
  inaugurated:          { label: "Inaugurated",        bg: "#123f26", fg: "#6fe3a1" },
  operational:          { label: "Operational",        bg: "#0e4635", fg: "#5cd9b5" },
  test:                 { label: "Test",               bg: "#4d1420", fg: "#ff8fa3" },
  trial:                { label: "Trial",              bg: "#3a1d52", fg: "#d3a6ff" },
};

/* ---------------- State ---------------- */
const S = {
  items: [],            // all news items
  byId: new Map(),
  states: [],
  activeCats: new Set(),// empty = all
  status: "all",
  stateF: "all",
  query: "",
  tMin: 0, tMax: 0,     // dataset date range (ms)
  from: 0, to: 0,       // active date window (ms)
  selectedId: null,
  basemap: "streets",
  rail: false,
  t3d: false,
  tool: null,           // 'dist' | 'area' | 'mark'
  playTimer: null,
  set: { cluster: true, pinScale: true, corridors: true, pulse: true },
  marks: [],
  markMarkers: new Map(),
  measure: { pts: [], finished: false, labels: [] },
  mapReady: false, dataReady: false,
  hoverPopup: null, searchMarker: null, pulseMarker: null,
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const DAY = 86400000;

/* ---------------- Persistence ---------------- */
function loadLS(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } }
function saveLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
S.set = Object.assign(S.set, loadLS("infraAtlas:settings", {}));
S.marks = loadLS("infraAtlas:marks", []);
const ui = loadLS("infraAtlas:ui", {});
if (ui.theme) document.body.dataset.ui = ui.theme;
if (ui.basemap && ui.basemap !== "streets") S.basemap = ui.basemap;

/* ---------------- Formatting helpers ---------------- */
function fmtDate(d, y) {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: y === false ? undefined : "numeric" });
}
function fmtInv(cr) {
  if (cr == null || !isFinite(cr) || cr <= 0) return null;
  if (cr >= 100000) return "₹" + (cr / 100000).toFixed(cr % 100000 === 0 ? 0 : 2) + " lakh cr";
  return "₹" + Math.round(cr).toLocaleString("en-IN") + " cr";
}
function fmtKm(m) {
  if (m < 1000) return Math.round(m) + " m";
  return (m / 1000).toFixed(m < 100000 ? 2 : 0) + " km";
}
function fmtArea(m2) {
  if (m2 < 10000) return Math.round(m2).toLocaleString("en-IN") + " m²";
  if (m2 < 1e6) return (m2 / 10000).toFixed(2) + " ha";
  return (m2 / 1e6).toFixed(2) + " km²";
}
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function toast(msg, ms = 2600) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), ms);
}

/* ---------------- Geodesy ---------------- */
const R_EARTH = 6371008.8;
function haversine(a, b) { // [lng,lat]
  const toR = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toR, dLng = (b[0] - a[0]) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(s));
}
function pathLength(pts) { let d = 0; for (let i = 1; i < pts.length; i++) d += haversine(pts[i - 1], pts[i]); return d; }
function ringArea(pts) { // spherical approximation, [lng,lat][]
  if (pts.length < 3) return 0;
  const toR = Math.PI / 180; let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
    total += (p2[0] - p1[0]) * toR * (2 + Math.sin(p1[1] * toR) + Math.sin(p2[1] * toR));
  }
  return Math.abs(total * R_EARTH * R_EARTH / 2);
}

/* ---------------- Basemap styles ---------------- */
const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
function rasterStyle(id, tiles, attribution, maxzoom) {
  const sources = {}; sources[id] = { type: "raster", tiles, tileSize: 256, attribution, maxzoom: maxzoom || 18 };
  return { version: 8, glyphs: GLYPHS, sources, layers: [{ id, type: "raster", source: id }] };
}
const STYLES = {
  streets: "https://tiles.openfreemap.org/styles/liberty",
  satellite: rasterStyle("esri", ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    "Imagery © Esri, Maxar, Earthstar Geographics", 19),
  terrain: rasterStyle("otm", ["https://a.tile.opentopomap.org/{z}/{x}/{y}.png", "https://b.tile.opentopomap.org/{z}/{x}/{y}.png", "https://c.tile.opentopomap.org/{z}/{x}/{y}.png"],
    "© OpenStreetMap contributors, SRTM | style © OpenTopoMap (CC-BY-SA)", 16),
  dark: rasterStyle("carto", ["https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png", "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png", "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png", "https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"],
    "© OpenStreetMap contributors © CARTO", 19),
};

/* ---------------- Map init ---------------- */
const map = new maplibregl.Map({
  container: "map",
  style: STYLES[S.basemap] || STYLES.streets,
  center: [80.2, 22.8],
  zoom: 4.2,
  minZoom: 3.2,
  maxPitch: 72,
  hash: "map",
  attributionControl: { compact: true },
  maxBounds: [[40, -15], [125, 45]],
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
map.addControl(new maplibregl.FullscreenControl(), "top-right");
map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), "top-right");
map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-left");

map.on("style.load", () => { S.mapReady = true; restoreOverlays(); });
map.on("load", () => maybeReady());
map.on("error", (e) => { /* tile errors are common offline; keep console only */ console.warn("map error", e && e.error); });

/* ---------------- Data pipeline (client) ---------------- */
fetch("data/news.json")
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then((items) => {
    S.items = (items || []).filter((it) => it && it.location && isFinite(it.location.lat) && isFinite(it.location.lng));
    S.items.sort((a, b) => (a.date < b.date ? 1 : -1));
    S.items.forEach((it) => S.byId.set(it.id, it));
    const times = S.items.map((it) => +new Date(it.date + "T00:00:00")).filter(isFinite);
    S.tMin = Math.min(...times); S.tMax = Math.max(...times);
    S.from = S.tMin; S.to = S.tMax;
    S.states = [...new Set(S.items.map((it) => it.location.state).filter(Boolean))].sort();
    S.dataReady = true;
    buildStateSel(); buildTimeline(); applyFilters();
    maybeReady();
  })
  .catch((err) => {
    console.error(err);
    $("#feedList").innerHTML = `<div class="empty">Couldn't load the news dataset.<br>${esc(String(err))}</div>`;
    $("#loading").classList.add("done");
  });

function maybeReady() {
  if (!S.dataReady || !map.loaded()) return;
  $("#loading").classList.add("done");
  refreshMapData();
  const n = new URLSearchParams(location.search).get("n");
  if (n && S.byId.has(n)) selectItem(n, { fly: true });
}

/* ---------------- Filtering ---------------- */
function passes(it) {
  if (S.activeCats.size && !S.activeCats.has(it.category)) return false;
  if (S.status !== "all" && it.status !== S.status) return false;
  if (S.stateF !== "all" && it.location.state !== S.stateF) return false;
  const t = +new Date(it.date + "T00:00:00");
  if (t < S.from || t > S.to + DAY - 1) return false;
  if (S.query) {
    const q = S.query.toLowerCase();
    const hay = (it.title + " " + it.location.name + " " + it.location.state + " " + (it.project || "") + " " + (it.summary || "")).toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}
function filteredItems() { return S.items.filter(passes); }

function applyFilters() {
  const items = filteredItems();
  renderFeed(items);
  renderProjects(items);
  renderStats(items);
  refreshMapData(items);
  updateHisto();
}

/* ---------------- Map data layers ---------------- */
function pointsGeo(items) {
  return { type: "FeatureCollection", features: items.map((it) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [it.location.lng, it.location.lat] },
    properties: { id: it.id, cat: it.category, title: it.title, date: it.date,
      place: it.location.name + ", " + it.location.state, inv: it.investmentCr || 0, status: it.status },
  })) };
}
function corridorsGeo(items) {
  return { type: "FeatureCollection", features: items
    .filter((it) => Array.isArray(it.routePoints) && it.routePoints.length >= 2 && S.set.corridors)
    .map((it) => ({ type: "Feature",
      geometry: { type: "LineString", coordinates: it.routePoints },
      properties: { id: it.id, cat: it.category, title: it.title } })) };
}
const catColorExpr = ["match", ["get", "cat"], ...Object.entries(CAT).flatMap(([k, v]) => [k, v.color]), "#888"];

function addNewsLayers() {
  if (map.getSource("news")) return;
  map.addSource("news", { type: "geojson", data: pointsGeo([]), cluster: S.set.cluster, clusterMaxZoom: 9, clusterRadius: 44 });
  map.addSource("corridors", { type: "geojson", data: corridorsGeo([]) });
  map.addSource("sel", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

  map.addLayer({ id: "corridor-casing", type: "line", source: "corridors",
    paint: { "line-color": "#0b0e12", "line-width": 5, "line-opacity": 0.45 },
    layout: { "line-cap": "round", "line-join": "round" } });
  map.addLayer({ id: "corridor-line", type: "line", source: "corridors",
    paint: { "line-color": catColorExpr, "line-width": 2.6, "line-opacity": 0.9 },
    layout: { "line-cap": "round", "line-join": "round" } });
  map.addLayer({ id: "corridor-hl", type: "line", source: "corridors", filter: ["==", ["get", "id"], "___"],
    paint: { "line-color": "#4da3ff", "line-width": 7, "line-opacity": 0.35, "line-blur": 1.5 },
    layout: { "line-cap": "round", "line-join": "round" } });

  map.addLayer({ id: "news-cluster", type: "circle", source: "news", filter: ["has", "point_count"],
    paint: { "circle-color": "#4da3ff",
      "circle-radius": ["step", ["get", "point_count"], 15, 10, 19, 30, 25],
      "circle-opacity": 0.85, "circle-stroke-width": 2, "circle-stroke-color": "rgba(255,255,255,0.85)" } });
  map.addLayer({ id: "news-cluster-count", type: "symbol", source: "news", filter: ["has", "point_count"],
    layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Regular"], "text-size": 12, "text-allow-overlap": true },
    paint: { "text-color": "#ffffff" } });

  const radius = S.set.pinScale
    ? ["interpolate", ["linear"], ["get", "inv"], 0, 6, 5000, 8, 20000, 10.5, 60000, 13, 160000, 16]
    : 7;
  map.addLayer({ id: "news-point", type: "circle", source: "news", filter: ["!", ["has", "point_count"]],
    paint: { "circle-color": catColorExpr, "circle-radius": radius,
      "circle-stroke-width": 1.6, "circle-stroke-color": "rgba(255,255,255,0.92)", "circle-opacity": 0.95 } });

  map.addLayer({ id: "sel-ring", type: "circle", source: "sel",
    paint: { "circle-radius": 15, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#4da3ff", "circle-stroke-width": 3, "circle-stroke-opacity": 0.95 } });

  addMeasureLayers();
}

function addMeasureLayers() {
  if (map.getSource("meas")) return;
  map.addSource("meas", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "meas-fill", type: "fill", source: "meas", filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "fill-color": "#4da3ff", "fill-opacity": 0.14 } });
  map.addLayer({ id: "meas-line", type: "line", source: "meas", filter: ["==", ["geometry-type"], "LineString"],
    paint: { "line-color": "#4da3ff", "line-width": 2.5, "line-dasharray": [1.4, 1.2] } });
  map.addLayer({ id: "meas-pts", type: "circle", source: "meas", filter: ["==", ["geometry-type"], "Point"],
    paint: { "circle-radius": 4.5, "circle-color": "#fff", "circle-stroke-color": "#4da3ff", "circle-stroke-width": 2 } });
}

function ensureDem() {
  if (!map.getSource("dem")) map.addSource("dem", { type: "raster-dem",
    tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
    encoding: "terrarium", tileSize: 256, maxzoom: 13,
    attribution: "Elevation: AWS Terrain Tiles / Mapzen" });
  if (!map.getSource("demhs")) map.addSource("demhs", { type: "raster-dem",
    tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
    encoding: "terrarium", tileSize: 256, maxzoom: 13 });
}

function restoreOverlays() {
  try {
    if (S.rail && !map.getSource("orm")) {
      map.addSource("orm", { type: "raster",
        tiles: ["https://a.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png", "https://b.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png", "https://c.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png"],
        tileSize: 256, attribution: "Rail overlay © OpenRailwayMap (CC-BY-SA)", maxzoom: 19 });
      map.addLayer({ id: "orm", type: "raster", source: "orm", paint: { "raster-opacity": 0.8 } },
        map.getLayer("corridor-casing") ? "corridor-casing" : undefined);
    }
    addNewsLayers();
    if (S.t3d) {
      ensureDem();
      if (!map.getLayer("hillshade")) map.addLayer({ id: "hillshade", type: "hillshade", source: "demhs",
        paint: { "hillshade-exaggeration": 0.45 } }, "corridor-casing");
      map.setTerrain({ source: "dem", exaggeration: 1.4 });
    }
    refreshMapData();
    updateSelRing();
  } catch (e) { console.warn("overlay restore failed", e); }
}

function refreshMapData(items) {
  if (!S.mapReady || !S.dataReady) return;
  const list = items || filteredItems();
  const src = map.getSource("news"); if (src) src.setData(pointsGeo(list));
  const cs = map.getSource("corridors"); if (cs) cs.setData(corridorsGeo(list));
  updatePulse(list);
}

function rebuildNewsSource() {
  ["sel-ring", "news-point", "news-cluster-count", "news-cluster", "corridor-hl", "corridor-line", "corridor-casing", "meas-pts", "meas-line", "meas-fill"]
    .forEach((l) => { if (map.getLayer(l)) map.removeLayer(l); });
  ["news", "corridors", "sel", "meas"].forEach((s) => { if (map.getSource(s)) map.removeSource(s); });
  addNewsLayers();
  refreshMapData();
  updateSelRing();
}

function updatePulse(list) {
  if (S.pulseMarker) { S.pulseMarker.remove(); S.pulseMarker = null; }
  if (!S.set.pulse || !list || !list.length) return;
  const latest = list.reduce((a, b) => (a.date >= b.date ? a : b));
  const el = document.createElement("div");
  el.className = "pulse-el";
  el.style.setProperty("--pc", CAT[latest.category] ? CAT[latest.category].color : "#4da3ff");
  S.pulseMarker = new maplibregl.Marker({ element: el }).setLngLat([latest.location.lng, latest.location.lat]).addTo(map);
}

/* ---------------- Interactions on map ---------------- */
const hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14, maxWidth: "260px" });

map.on("click", (e) => {
  if (S.tool === "dist" || S.tool === "area") { measureClick(e.lngLat); return; }
  if (S.tool === "mark") { openMarkForm(e.lngLat); setTool(null); return; }
  const layers = ["news-point", "news-cluster", "corridor-line"].filter((l) => map.getLayer(l));
  if (!layers.length) return;
  const feats = map.queryRenderedFeatures(e.point, { layers });
  if (!feats.length) return;
  const f = feats.find((x) => x.layer.id === "news-point") || feats[0];
  if (f.layer.id === "news-cluster") {
    const src = map.getSource("news");
    Promise.resolve(src.getClusterExpansionZoom(f.properties.cluster_id))
      .then((z) => map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(z + 0.4, 14) }))
      .catch(() => map.easeTo({ center: f.geometry.coordinates, zoom: map.getZoom() + 2 }));
    return;
  }
  if (f.properties && f.properties.id) selectItem(f.properties.id, { fly: false });
});

map.on("dblclick", (e) => {
  if (S.tool === "dist" || S.tool === "area") { e.preventDefault(); measureFinish(); }
});

let hoverPending = false;
map.on("mousemove", (e) => {
  if (S.tool) { measureMove(e.lngLat); map.getCanvas().style.cursor = "crosshair"; return; }
  if (hoverPending) return;
  hoverPending = true;
  requestAnimationFrame(() => {
    hoverPending = false;
    const layers = ["news-point", "news-cluster", "corridor-line"].filter((l) => map.getLayer(l));
    if (!layers.length) return;
    const feats = map.queryRenderedFeatures(e.point, { layers });
    map.getCanvas().style.cursor = feats.length ? "pointer" : "";
    const f = feats.find((x) => x.layer.id === "news-point");
    if (f && window.matchMedia("(hover:hover)").matches) {
      const p = f.properties;
      hoverPopup.setLngLat(f.geometry.coordinates)
        .setHTML(`<div class="pop-t">${esc(p.title)}</div><div class="pop-m">${esc(p.place)} · ${fmtDate(p.date)}</div>`)
        .addTo(map);
    } else hoverPopup.remove();
  });
});
map.getCanvas().addEventListener("mouseleave", () => hoverPopup.remove());

/* ---------------- Selection & detail panel ---------------- */
function updateSelRing() {
  const src = map.getSource("sel"); if (!src) return;
  const it = S.byId.get(S.selectedId);
  src.setData(it ? { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [it.location.lng, it.location.lat] }, properties: {} }] } : { type: "FeatureCollection", features: [] });
  if (map.getLayer("corridor-hl")) map.setFilter("corridor-hl", ["==", ["get", "id"], (it && it.id) || "___"]);
}

function selectItem(id, opts = {}) {
  const it = S.byId.get(id); if (!it) return;
  S.selectedId = id;
  updateSelRing();
  renderDetail(it);
  $("#detail").classList.add("open");
  const u = new URL(location.href); u.searchParams.set("n", id); history.replaceState(null, "", u);
  $$(".news-row").forEach((r) => r.classList.toggle("sel", r.dataset.id === id));
  const row = document.querySelector(`.news-row[data-id="${CSS.escape(id)}"]`);
  if (row) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  if (opts.fly) zoomToItem(it);
}
function deselect() {
  S.selectedId = null; updateSelRing();
  $("#detail").classList.remove("open");
  const u = new URL(location.href); u.searchParams.delete("n"); history.replaceState(null, "", u);
  $$(".news-row.sel").forEach((r) => r.classList.remove("sel"));
}

function zoomToItem(it) {
  if (Array.isArray(it.routePoints) && it.routePoints.length >= 2) {
    const b = it.routePoints.reduce((bb, c) => bb.extend(c), new maplibregl.LngLatBounds(it.routePoints[0], it.routePoints[0]));
    b.extend([it.location.lng, it.location.lat]);
    map.fitBounds(b, { padding: { top: 90, bottom: 140, left: 60, right: 60 }, maxZoom: 12, duration: 1100 });
  } else {
    map.flyTo({ center: [it.location.lng, it.location.lat], zoom: Math.max(map.getZoom(), 10.2), duration: 1100 });
  }
}

function renderDetail(it) {
  const c = CAT[it.category] || { label: it.category, color: "#888" };
  const st = STATUS[it.status] || { label: it.status, bg: "#333", fg: "#ccc" };
  const inv = fmtInv(it.investmentCr);
  const related = S.items.filter((x) => x.project && it.project && x.project.trim().toLowerCase() === it.project.trim().toLowerCase() && x.id !== it.id);
  const cells = [
    inv ? `<div class="cell"><div class="l">Investment</div><div class="v" style="color:var(--ok)">${inv}</div></div>` : "",
    it.capacity ? `<div class="cell"><div class="l">Scale</div><div class="v">${esc(it.capacity)}</div></div>` : "",
    `<div class="cell"><div class="l">Location</div><div class="v" style="font-size:12.5px">${esc(it.location.name)}<br><span style="color:var(--muted);font-weight:500">${esc(it.location.state)}</span></div></div>`,
    `<div class="cell"><div class="l">Coordinates</div><div class="v" style="font-family:var(--mono);font-size:12px">${it.location.lat.toFixed(4)}, ${it.location.lng.toFixed(4)}</div></div>`,
  ].filter(Boolean).join("");
  $("#detail").innerHTML = `
    <div class="detail-head">
      <div class="cat-line">
        <span class="dot" style="background:${c.color}"></span>
        <span class="cname">${esc(c.label)}</span>
        <span class="badge" style="--sb:${st.bg};--sc:${st.fg}">${esc(st.label)}</span>
        <button class="iconbtn x" id="detClose" title="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="16"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      </div>
      <h2>${esc(it.title)}</h2>
      <div class="sub"><span>${fmtDate(it.date)}</span>${it.project ? `<span>·</span><span>${esc(it.project)}</span>` : ""}</div>
    </div>
    <div class="detail-body">
      <div class="kv">${cells}</div>
      <p class="sum">${esc(it.summary || "")}</p>
      ${it.benefits && it.benefits.length ? `<h4>Why it matters</h4><ul class="benefits">${it.benefits.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
      ${related.length ? `<h4>Project timeline · ${esc(it.project)}</h4><div class="rel">${related.map((r) => `
        <div class="u" data-id="${esc(r.id)}">${esc(r.title)}<small>${fmtDate(r.date)} · ${esc(STATUS[r.status] ? STATUS[r.status].label : r.status)}</small></div>`).join("")}</div>` : ""}
      ${it.sources && it.sources.length ? `<h4>Sources</h4><div class="srcs">${it.sources.map((s) => `
        <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 14a5 5 0 0 0 7.07 0l3.54-3.54a5 5 0 0 0-7.07-7.07L11.5 5.5"/><path d="M14 10a5 5 0 0 0-7.07 0l-3.54 3.54a5 5 0 0 0 7.07 7.07l2.05-2.12"/></svg>${esc(s.name)}</a>`).join("")}</div>` : ""}
    </div>
    <div class="detail-actions">
      <button class="btn primary" id="detZoom">Zoom to site</button>
      <a class="btn" target="_blank" rel="noopener" href="https://maps.apple.com/?ll=${it.location.lat},${it.location.lng}&q=${encodeURIComponent(it.location.name)}">Apple Maps</a>
      <a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${it.location.lat},${it.location.lng}">Google</a>
      <button class="btn" id="detShare">Copy link</button>
    </div>`;
  $("#detClose").onclick = deselect;
  $("#detZoom").onclick = () => zoomToItem(it);
  $("#detShare").onclick = () => {
    navigator.clipboard.writeText(location.href).then(() => toast("Link copied — opens the map focused on this story"));
  };
  $$("#detail .rel .u").forEach((el) => el.onclick = () => selectItem(el.dataset.id, { fly: true }));
}

/* ---------------- Sidebar: feed ---------------- */
function renderFeed(items) {
  const sort = $("#sortSel").value;
  const list = [...items];
  if (sort === "new") list.sort((a, b) => (a.date < b.date ? 1 : -1));
  if (sort === "old") list.sort((a, b) => (a.date > b.date ? 1 : -1));
  if (sort === "inv") list.sort((a, b) => (b.investmentCr || 0) - (a.investmentCr || 0));
  $("#feedCount").textContent = list.length + (list.length === 1 ? " story" : " stories");
  const el = $("#feedList");
  if (!list.length) { el.innerHTML = `<div class="empty">No stories match the current filters.<br>Widen the timeline or clear filters.</div>`; return; }
  el.innerHTML = list.map((it) => {
    const c = CAT[it.category] || { color: "#888" };
    const st = STATUS[it.status] || { label: it.status, bg: "#333", fg: "#ccc" };
    const inv = fmtInv(it.investmentCr);
    return `<button class="news-row${it.id === S.selectedId ? " sel" : ""}" data-id="${esc(it.id)}">
      <span class="dot" style="background:${c.color}"></span>
      <span style="min-width:0">
        <span class="t">${esc(it.title)}</span>
        <span class="m"><span>${fmtDate(it.date, false)}</span><span>${esc(it.location.name)}</span>${inv ? `<span class="inv">${inv}</span>` : ""}<span class="badge" style="--sb:${st.bg};--sc:${st.fg}">${esc(st.label)}</span></span>
      </span></button>`;
  }).join("");
  $$("#feedList .news-row").forEach((r) => r.onclick = () => selectItem(r.dataset.id, { fly: true }));
}

/* ---------------- Sidebar: projects ---------------- */
function renderProjects(items) {
  const groups = new Map();
  items.forEach((it) => {
    const key = (it.project || it.title).trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  });
  const projs = [...groups.values()].map((g) => {
    g.sort((a, b) => (a.date < b.date ? 1 : -1));
    return { name: g[0].project || g[0].title, items: g, latest: g[0].date,
      inv: g.reduce((s, x) => Math.max(s, x.investmentCr || 0), 0), cat: g[0].category };
  }).sort((a, b) => (a.latest < b.latest ? 1 : -1));
  const el = $("#projList");
  if (!projs.length) { el.innerHTML = `<div class="empty">Nothing here with the current filters.</div>`; return; }
  el.innerHTML = projs.map((p, i) => {
    const c = CAT[p.cat] || { color: "#888" };
    const inv = fmtInv(p.inv);
    return `<div class="proj-row" data-i="${i}">
      <div class="t"><span class="dot" style="background:${c.color}"></span>${esc(p.name)}</div>
      <div class="m">${p.items.length} update${p.items.length > 1 ? "s" : ""} · latest ${fmtDate(p.latest, false)}${inv ? " · " + inv : ""}</div>
      <div class="proj-updates">${p.items.map((u) => `<div class="u" data-id="${esc(u.id)}">${esc(u.title)}<small>${fmtDate(u.date)}</small></div>`).join("")}</div>
    </div>`;
  }).join("");
  $$("#projList .proj-row").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest(".u")) return;
      row.classList.toggle("open");
    });
  });
  $$("#projList .u").forEach((u) => u.onclick = () => selectItem(u.dataset.id, { fly: true }));
}

/* ---------------- Sidebar: stats ---------------- */
function renderStats(items) {
  const inv = items.reduce((s, x) => s + (x.investmentCr || 0), 0);
  const states = new Set(items.map((x) => x.location.state));
  const projects = new Set(items.map((x) => (x.project || x.title).toLowerCase()));
  const byCat = {}; const byState = {}; const bySt = {};
  items.forEach((x) => {
    byCat[x.category] = (byCat[x.category] || 0) + 1;
    byState[x.location.state] = (byState[x.location.state] || 0) + (x.investmentCr || 0);
    bySt[x.status] = (bySt[x.status] || 0) + 1;
  });
  const catRows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...catRows.map(([, n]) => n));
  const stRows = Object.entries(byState).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxSt = Math.max(1, ...stRows.map(([, v]) => v));
  $("#statsBody").innerHTML = `
    <div class="statgrid">
      <div class="statcard"><div class="v">${items.length}</div><div class="l">stories in view</div></div>
      <div class="statcard"><div class="v">${fmtInv(inv) || "—"}</div><div class="l">tracked investment</div></div>
      <div class="statcard"><div class="v">${states.size}</div><div class="l">states & UTs</div></div>
      <div class="statcard"><div class="v">${projects.size}</div><div class="l">projects</div></div>
    </div>
    <div class="bars">
      <h4>By category</h4>
      ${catRows.map(([k, n]) => `<div class="bar-row"><span class="lab">${esc(CAT[k] ? CAT[k].label : k)}</span><span class="track"><span class="fill" style="width:${(n / maxCat) * 100}%;--bc:${CAT[k] ? CAT[k].color : "#888"}"></span></span><span class="num">${n}</span></div>`).join("")}
      ${stRows.length ? `<h4>Top states by investment</h4>` + stRows.map(([k, v]) => `<div class="bar-row"><span class="lab">${esc(k)}</span><span class="track"><span class="fill" style="width:${(v / maxSt) * 100}%"></span></span><span class="num">${fmtInv(v)}</span></div>`).join("") : ""}
      <h4>By status</h4>
      ${Object.entries(bySt).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<div class="bar-row"><span class="lab">${esc(STATUS[k] ? STATUS[k].label : k)}</span><span class="track"><span class="fill" style="width:${(n / items.length) * 100}%;--bc:${STATUS[k] ? STATUS[k].fg : "#888"}"></span></span><span class="num">${n}</span></div>`).join("")}
    </div>`;
}

/* ---------------- Timeline ---------------- */
let histoBuckets = [];
function buildTimeline() {
  const fromEl = $("#tlFrom"), toEl = $("#tlTo");
  const days = Math.max(1, Math.round((S.tMax - S.tMin) / DAY));
  fromEl.max = toEl.max = days; fromEl.value = 0; toEl.value = days;
  const bucketCount = Math.min(60, Math.max(12, Math.round(days / 7)));
  histoBuckets = new Array(bucketCount).fill(0).map((_, i) => ({
    t0: S.tMin + (i * (S.tMax - S.tMin + DAY)) / bucketCount,
    t1: S.tMin + ((i + 1) * (S.tMax - S.tMin + DAY)) / bucketCount, n: 0 }));
  $("#histo").innerHTML = histoBuckets.map(() => `<div class="hb"></div>`).join("");
  const onSlide = () => {
    let f = +fromEl.value, t = +toEl.value;
    if (f > t) { [f, t] = [t, f]; }
    S.from = S.tMin + f * DAY; S.to = S.tMin + t * DAY;
    $$("#tlQuick button").forEach((b) => b.classList.remove("on"));
    applyFilters(); updateTlLabel();
  };
  fromEl.addEventListener("input", onSlide);
  toEl.addEventListener("input", onSlide);
  updateTlLabel();
}
function updateTlLabel() {
  $("#tlRange").textContent = new Date(S.from).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" }) +
    " → " + new Date(S.to).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
}
function updateHisto() {
  if (!histoBuckets.length) return;
  // histogram respects every filter except the date window
  const base = S.items.filter((it) => {
    if (S.activeCats.size && !S.activeCats.has(it.category)) return false;
    if (S.status !== "all" && it.status !== S.status) return false;
    if (S.stateF !== "all" && it.location.state !== S.stateF) return false;
    if (S.query) { const q = S.query.toLowerCase();
      if (!(it.title + " " + it.location.name + " " + (it.project || "")).toLowerCase().includes(q)) return false; }
    return true;
  });
  histoBuckets.forEach((b) => (b.n = 0));
  base.forEach((it) => {
    const t = +new Date(it.date + "T00:00:00");
    const i = histoBuckets.findIndex((b) => t >= b.t0 && t < b.t1);
    if (i >= 0) histoBuckets[i].n++;
  });
  const max = Math.max(1, ...histoBuckets.map((b) => b.n));
  const bars = $$("#histo .hb");
  histoBuckets.forEach((b, i) => {
    bars[i].style.height = Math.max(6, (b.n / max) * 100) + "%";
    bars[i].classList.toggle("in", b.t1 >= S.from && b.t0 <= S.to + DAY);
    bars[i].title = `${b.n} stories`;
  });
}
function setWindowDays(days) {
  if (!days) { S.from = S.tMin; S.to = S.tMax; }
  else { S.to = S.tMax; S.from = Math.max(S.tMin, S.tMax - days * DAY); }
  $("#tlFrom").value = Math.round((S.from - S.tMin) / DAY);
  $("#tlTo").value = Math.round((S.to - S.tMin) / DAY);
  applyFilters(); updateTlLabel();
}
$("#tlQuick").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  $$("#tlQuick button").forEach((x) => x.classList.remove("on"));
  b.classList.add("on");
  setWindowDays(+b.dataset.days);
});
$("#btnPlay").onclick = () => {
  if (S.playTimer) { stopPlay(); return; }
  $("#playIco").innerHTML = `<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>`;
  const start = S.tMin, end = S.tMax, steps = 30;
  let i = Math.max(1, Math.round(((S.to - start) / (end - start)) * steps));
  if (i >= steps) i = 1;
  S.from = start;
  S.playTimer = setInterval(() => {
    i++;
    S.to = start + ((end - start) * i) / steps;
    $("#tlFrom").value = 0;
    $("#tlTo").value = Math.round((S.to - S.tMin) / DAY);
    applyFilters(); updateTlLabel();
    if (i >= steps) stopPlay();
  }, 350);
};
function stopPlay() {
  clearInterval(S.playTimer); S.playTimer = null;
  $("#playIco").innerHTML = `<path d="M8 5v14l11-7z"/>`;
}

/* ---------------- Chips, selects, tabs ---------------- */
function buildChips() {
  const el = $("#catChips");
  el.innerHTML = `<button class="chip on" data-cat="all">All</button>` +
    Object.entries(CAT).map(([k, v]) => `<button class="chip" data-cat="${k}"><span class="dot" style="--cc:${v.color}"></span>${v.label}</button>`).join("");
  el.addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    const c = b.dataset.cat;
    if (c === "all") S.activeCats.clear();
    else { S.activeCats.has(c) ? S.activeCats.delete(c) : S.activeCats.add(c); }
    $$("#catChips .chip").forEach((x) => x.classList.toggle("on",
      x.dataset.cat === "all" ? S.activeCats.size === 0 : S.activeCats.has(x.dataset.cat)));
    applyFilters();
  });
}
function buildStateSel() {
  $("#stateSel").innerHTML = `<option value="all">All states</option>` + S.states.map((s) => `<option>${esc(s)}</option>`).join("");
}
$("#sortSel").onchange = () => renderFeed(filteredItems());
$("#statusSel").onchange = (e) => { S.status = e.target.value; applyFilters(); };
$("#stateSel").onchange = (e) => { S.stateF = e.target.value; applyFilters(); };

$("#tabs").addEventListener("click", (e) => {
  const t = e.target.closest(".tab"); if (!t) return;
  $$("#tabs .tab").forEach((x) => x.classList.toggle("on", x === t));
  const tab = t.dataset.tab;
  ["feed", "projects", "stats", "marks"].forEach((p) => {
    $("#panel" + p[0].toUpperCase() + p.slice(1)).style.display = p === tab ? "" : "none";
  });
  if (tab === "marks") renderMarksList();
});

/* ---------------- Basemap & overlays UI ---------------- */
$("#basemapSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  const bm = b.dataset.bm; if (bm === S.basemap) return;
  S.basemap = bm;
  $$("#basemapSeg button").forEach((x) => x.classList.toggle("on", x === b));
  saveLS("infraAtlas:ui", { theme: document.body.dataset.ui, basemap: bm });
  S.mapReady = false;
  map.setStyle(STYLES[bm], { diff: false });
});
$("#tglRail").onclick = () => {
  S.rail = !S.rail;
  $("#tglRail").classList.toggle("on", S.rail);
  if (S.rail) restoreOverlays();
  else { if (map.getLayer("orm")) map.removeLayer("orm"); if (map.getSource("orm")) map.removeSource("orm"); }
  if (S.rail) toast("Railway & metro tracks overlay on — zoom in to see lines, stations and electrification");
};
$("#tgl3d").onclick = () => {
  S.t3d = !S.t3d;
  $("#tgl3d").classList.toggle("on", S.t3d);
  if (S.t3d) {
    restoreOverlays();
    if (map.getPitch() < 25) map.easeTo({ pitch: 60, duration: 900 });
    toast("3D terrain on — tilt with right-drag or Ctrl+drag. Try the Himalayan projects.");
  } else {
    map.setTerrain(null);
    if (map.getLayer("hillshade")) map.removeLayer("hillshade");
    map.easeTo({ pitch: 0, duration: 700 });
  }
};

/* ---------------- Measure tools ---------------- */
function setTool(tool) {
  if (S.playTimer) stopPlay();
  if (tool && tool === S.tool) tool = null; // toggle off
  if ((S.tool === "dist" || S.tool === "area") && tool !== S.tool && !S.measure.finished) clearMeasure(false);
  S.tool = tool;
  $("#toolDist").classList.toggle("on", tool === "dist");
  $("#toolArea").classList.toggle("on", tool === "area");
  $("#toolMark").classList.toggle("on", tool === "mark");
  map.getCanvas().style.cursor = tool ? "crosshair" : "";
  if (tool === "dist" || tool === "area") {
    map.doubleClickZoom.disable();
    S.measure = { pts: [], finished: false, labels: S.measure.labels };
    showHint(tool === "dist" ? "Click points along a path — double-click to finish" : "Click the corners of an area — double-click to close");
  } else {
    map.doubleClickZoom.enable();
    if (!S.measure.pts.length) hideHint();
  }
  if (tool === "mark") showHint("Click anywhere on the map to drop your mark");
}
$("#toolDist").onclick = () => setTool("dist");
$("#toolArea").onclick = () => setTool("area");
$("#toolMark").onclick = () => setTool("mark");
$("#toolClear").onclick = () => { clearMeasure(true); toast("Measurements cleared"); };

function showHint(html) {
  const h = $("#measureHint");
  h.innerHTML = `<span>${html}</span><button class="mx" title="Close">✕</button>`;
  h.classList.add("show");
  h.querySelector(".mx").onclick = () => { clearMeasure(true); setTool(null); };
}
function hideHint() { $("#measureHint").classList.remove("show"); }

function measureClick(ll) {
  const pt = [ll.lng, ll.lat];
  if (S.measure.finished) { S.measure = { pts: [], finished: false, labels: S.measure.labels }; }
  const pts = S.measure.pts;
  if (pts.length && haversine(pts[pts.length - 1], pt) < 0.5) return; // dblclick dedupe
  pts.push(pt);
  drawMeasure(null);
  updateMeasureReadout();
}
function measureMove(ll) {
  if (S.measure.finished || !S.measure.pts.length) return;
  drawMeasure([ll.lng, ll.lat]);
}
function measureFinish() {
  if (S.measure.pts.length < 2) return;
  S.measure.finished = true;
  drawMeasure(null);
  updateMeasureReadout(true);
  setTool(null);
}
function drawMeasure(preview) {
  const src = map.getSource("meas"); if (!src) return;
  const pts = preview ? [...S.measure.pts, preview] : S.measure.pts;
  const feats = pts.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: p }, properties: {} }));
  if (pts.length >= 2) feats.push({ type: "Feature", geometry: { type: "LineString", coordinates: S.tool === "area" || (S.measure.finished && S.measure.area) ? [...pts, pts[0]] : pts }, properties: {} });
  if ((S.tool === "area" || S.measure.area) && pts.length >= 3)
    feats.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [[...pts, pts[0]]] }, properties: {} });
  if (S.tool === "area") S.measure.area = true;
  src.setData({ type: "FeatureCollection", features: feats });
}
function updateMeasureReadout(final) {
  const pts = S.measure.pts;
  S.measure.labels.forEach((m) => m.remove()); S.measure.labels = [];
  if (pts.length < 2) { if (!final) showHint((S.tool === "area" ? "Area" : "Distance") + ": add more points…"); return; }
  let text;
  if (S.measure.area || S.tool === "area") {
    const a = ringArea(pts), per = pathLength([...pts, pts[0]]);
    text = `Area <b>${fmtArea(a)}</b> · perimeter <b>${fmtKm(per)}</b>`;
  } else {
    text = `Distance <b>${fmtKm(pathLength(pts))}</b>`;
  }
  showHint(text + (final ? "" : " · double-click to finish"));
  const el = document.createElement("div");
  el.className = "measure-label";
  el.innerHTML = (S.measure.area || S.tool === "area") ? fmtArea(ringArea(pts)) : fmtKm(pathLength(pts));
  const anchor = pts[pts.length - 1];
  S.measure.labels.push(new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -10] }).setLngLat(anchor).addTo(map));
}
function clearMeasure(hide) {
  S.measure.labels.forEach((m) => m.remove());
  S.measure = { pts: [], finished: false, labels: [] };
  const src = map.getSource("meas"); if (src) src.setData({ type: "FeatureCollection", features: [] });
  if (hide) hideHint();
}

/* ---------------- Marks ---------------- */
const MARK_COLORS = ["#ff5d5d", "#ffb020", "#35c26e", "#4da3ff", "#b28dff", "#ff7ab8"];
function pinEl(color) {
  const el = document.createElement("div");
  el.className = "mark-pin-el";
  el.innerHTML = `<svg width="30" height="30" viewBox="0 0 24 24" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))"><path fill="${color}" stroke="#fff" stroke-width="1.2" d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z"/><circle cx="12" cy="9" r="2.6" fill="#fff"/></svg>`;
  return el;
}
function openMarkForm(ll, existing) {
  const mk = existing || { id: "mk-" + Date.now().toString(36), lat: ll.lat, lng: ll.lng, name: "", note: "", color: MARK_COLORS[3] };
  const div = document.createElement("div");
  div.className = "pop-form";
  div.innerHTML = `
    <input type="text" id="mkName" placeholder="Name this place" value="${esc(mk.name)}" maxlength="60" />
    <textarea id="mkNote" placeholder="Notes — why does this spot matter?" rows="2" maxlength="300">${esc(mk.note)}</textarea>
    <div class="colors">${MARK_COLORS.map((c) => `<button data-c="${c}" class="${c === mk.color ? "on" : ""}" style="background:${c}"></button>`).join("")}</div>
    <div style="display:flex;gap:6px"><button class="btn primary" id="mkSave" style="flex:1">Save</button><button class="btn" id="mkCancel">Cancel</button></div>`;
  const pop = new maplibregl.Popup({ closeOnClick: false, offset: 10, maxWidth: "260px" })
    .setLngLat([mk.lng, mk.lat]).setDOMContent(div).addTo(map);
  div.querySelectorAll(".colors button").forEach((b) => b.onclick = () => {
    mk.color = b.dataset.c;
    div.querySelectorAll(".colors button").forEach((x) => x.classList.toggle("on", x === b));
  });
  div.querySelector("#mkCancel").onclick = () => pop.remove();
  div.querySelector("#mkSave").onclick = () => {
    mk.name = div.querySelector("#mkName").value.trim() || "Unnamed mark";
    mk.note = div.querySelector("#mkNote").value.trim();
    const i = S.marks.findIndex((m) => m.id === mk.id);
    if (i >= 0) S.marks[i] = mk; else S.marks.push(mk);
    saveLS("infraAtlas:marks", S.marks);
    renderMark(mk); renderMarksList(); pop.remove();
    toast("Mark saved — it stays in this browser and can be exported");
  };
  setTimeout(() => div.querySelector("#mkName").focus(), 50);
}
function renderMark(mk) {
  const old = S.markMarkers.get(mk.id); if (old) old.remove();
  const el = pinEl(mk.color);
  const m = new maplibregl.Marker({ element: el, anchor: "bottom", draggable: true })
    .setLngLat([mk.lng, mk.lat]).addTo(map);
  m.on("dragend", () => {
    const p = m.getLngLat(); mk.lat = p.lat; mk.lng = p.lng;
    saveLS("infraAtlas:marks", S.marks); renderMarksList();
  });
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    const div = document.createElement("div");
    div.innerHTML = `<div class="pop-t">${esc(mk.name)}</div>${mk.note ? `<div class="pop-m">${esc(mk.note)}</div>` : ""}
      <div style="display:flex;gap:6px;margin-top:8px"><button class="btn" id="mkEdit" style="flex:1">Edit</button><button class="btn danger" id="mkDel">Delete</button></div>`;
    const pop = new maplibregl.Popup({ offset: 28, maxWidth: "240px" }).setLngLat([mk.lng, mk.lat]).setDOMContent(div).addTo(map);
    div.querySelector("#mkEdit").onclick = () => { pop.remove(); openMarkForm(null, mk); };
    div.querySelector("#mkDel").onclick = () => { pop.remove(); deleteMark(mk.id); };
  });
  S.markMarkers.set(mk.id, m);
}
function deleteMark(id) {
  S.marks = S.marks.filter((m) => m.id !== id);
  const mm = S.markMarkers.get(id); if (mm) mm.remove();
  S.markMarkers.delete(id);
  saveLS("infraAtlas:marks", S.marks);
  renderMarksList();
}
function renderMarksList() {
  const el = $("#marksList");
  if (!S.marks.length) { el.innerHTML = `<div class="empty">No marks yet.<br>Use <b>Add on map</b> (or the 📍 tool on the map edge) to pin places you're watching — a future metro depot, land near a new expressway interchange, anything.</div>`; return; }
  el.innerHTML = S.marks.map((m) => `
    <div class="mark-row">
      <span class="pin" style="background:${m.color}"></span>
      <span style="min-width:0"><span class="t" data-id="${esc(m.id)}">${esc(m.name)}</span>
      ${m.note ? `<div class="n">${esc(m.note)}</div>` : ""}
      <div class="n" style="font-family:var(--mono)">${m.lat.toFixed(4)}, ${m.lng.toFixed(4)}</div></span>
      <button class="del" data-id="${esc(m.id)}" title="Delete">✕</button>
    </div>`).join("");
  $$("#marksList .t").forEach((t) => t.onclick = () => {
    const mk = S.marks.find((m) => m.id === t.dataset.id);
    if (mk) map.flyTo({ center: [mk.lng, mk.lat], zoom: Math.max(map.getZoom(), 12) });
  });
  $$("#marksList .del").forEach((d) => d.onclick = () => deleteMark(d.dataset.id));
}
$("#btnAddMark").onclick = () => { setTool("mark"); toast("Click on the map to place your mark"); };
$("#btnExportMarks").onclick = () => {
  const blob = new Blob([JSON.stringify(S.marks, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "infra-atlas-marks.json"; a.click();
  URL.revokeObjectURL(a.href);
};
$("#btnImportMarks").onclick = () => $("#importFile").click();
$("#importFile").onchange = (e) => {
  const f = e.target.files[0]; if (!f) return;
  f.text().then((txt) => {
    try {
      const arr = JSON.parse(txt);
      if (!Array.isArray(arr)) throw new Error("not an array");
      let n = 0;
      arr.forEach((m) => {
        if (m && isFinite(m.lat) && isFinite(m.lng)) {
          m.id = m.id || "mk-" + Math.random().toString(36).slice(2);
          if (!S.marks.some((x) => x.id === m.id)) { S.marks.push(m); renderMark(m); n++; }
        }
      });
      saveLS("infraAtlas:marks", S.marks); renderMarksList();
      toast(`Imported ${n} mark${n === 1 ? "" : "s"}`);
    } catch { toast("That file doesn't look like exported marks"); }
  });
  e.target.value = "";
};
S.marks.forEach(renderMark);

/* ---------------- Search ---------------- */
const searchEl = $("#search"), resEl = $("#searchResults");
let searchTimer = null, geoAbort = null;
searchEl.addEventListener("input", () => {
  const q = searchEl.value.trim();
  S.query = ""; // typing searches, doesn't filter until chosen
  clearTimeout(searchTimer);
  if (q.length < 2) { resEl.classList.remove("open"); return; }
  renderLocalResults(q);
  searchTimer = setTimeout(() => geocode(q), 650);
});
searchEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const first = resEl.querySelector(".res");
    if (first) first.click();
  } else if (e.key === "Escape") { resEl.classList.remove("open"); searchEl.blur(); }
});
document.addEventListener("click", (e) => { if (!e.target.closest(".searchwrap")) resEl.classList.remove("open"); });

function renderLocalResults(q, places) {
  const ql = q.toLowerCase();
  const news = S.items.filter((it) =>
    (it.title + " " + it.location.name + " " + it.location.state + " " + (it.project || "")).toLowerCase().includes(ql)).slice(0, 6);
  let html = "";
  if (news.length) {
    html += `<div class="group">News</div>` + news.map((it) => `
      <button class="res" data-kind="news" data-id="${esc(it.id)}">
        <span class="dot" style="width:8px;height:8px;border-radius:50%;flex:none;background:${CAT[it.category] ? CAT[it.category].color : "#888"}"></span>
        <span style="min-width:0">${esc(it.title)}<small>${esc(it.location.name)} · ${fmtDate(it.date, false)}</small></span>
      </button>`).join("");
  }
  if (places && places.length) {
    html += `<div class="group">Places</div>` + places.map((p, i) => `
      <button class="res" data-kind="place" data-i="${i}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex:none;color:var(--muted)"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>
        <span style="min-width:0">${esc(p.name.split(",")[0])}<small>${esc(p.name.split(",").slice(1, 4).join(",").trim())}</small></span>
      </button>`).join("");
  } else if (!news.length) {
    html = `<div class="group">Searching places…</div>`;
  }
  resEl.innerHTML = html; resEl.classList.add("open");
  resEl._places = places || [];
  resEl.querySelectorAll(".res").forEach((r) => r.onclick = () => {
    resEl.classList.remove("open");
    if (r.dataset.kind === "news") { selectItem(r.dataset.id, { fly: true }); }
    else {
      const p = resEl._places[+r.dataset.i]; if (!p) return;
      if (S.searchMarker) S.searchMarker.remove();
      S.searchMarker = new maplibregl.Marker({ color: "#e11d48" }).setLngLat([+p.lon, +p.lat])
        .setPopup(new maplibregl.Popup({ offset: 20 }).setHTML(`<div class="pop-t">${esc(p.name.split(",")[0])}</div><div class="pop-m">${esc(p.name)}</div>`))
        .addTo(map);
      if (p.boundingbox) {
        const bb = p.boundingbox.map(Number); // [latMin, latMax, lonMin, lonMax]
        map.fitBounds([[bb[2], bb[0]], [bb[3], bb[1]]], { padding: 80, maxZoom: 13.5, duration: 1200 });
      } else map.flyTo({ center: [+p.lon, +p.lat], zoom: 11, duration: 1200 });
    }
  });
}
function geocode(q) {
  if (geoAbort) geoAbort.abort();
  geoAbort = new AbortController();
  fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=in&limit=5&accept-language=en&q=${encodeURIComponent(q)}`,
    { signal: geoAbort.signal, headers: { Accept: "application/json" } })
    .then((r) => r.json())
    .then((arr) => {
      if (searchEl.value.trim().toLowerCase() !== q.toLowerCase()) return;
      renderLocalResults(q, (arr || []).map((p) => ({ name: p.display_name, lat: p.lat, lon: p.lon, boundingbox: p.boundingbox })));
    })
    .catch(() => {});
}

/* ---------------- Topbar buttons, modals, theme ---------------- */
$("#btnSidebar").onclick = () => $("#sidebar").classList.toggle("hidden");
$("#btnTimeline").onclick = () => $("#timeline").classList.toggle("hidden");
$("#btnTheme").onclick = () => {
  const next = document.body.dataset.ui === "light" ? "dark" : "light";
  document.body.dataset.ui = next;
  saveLS("infraAtlas:ui", { theme: next, basemap: S.basemap });
};
function openModal(id) { $("#scrim").classList.add("open"); $(id).classList.add("open"); }
function closeModals() { $("#scrim").classList.remove("open"); $$(".modal").forEach((m) => m.classList.remove("open")); }
$("#btnHelp").onclick = () => openModal("#helpModal");
$("#btnSettings").onclick = () => openModal("#settingsModal");
$("#scrim").onclick = closeModals;
$$(".modal [data-close]").forEach((b) => b.onclick = closeModals);

["setCluster", "setPinScale", "setCorridors", "setPulse"].forEach((id) => {
  const key = id[3].toLowerCase() + id.slice(4);
  const el = $("#" + id);
  el.checked = !!S.set[key];
  el.onchange = () => {
    S.set[key] = el.checked;
    saveLS("infraAtlas:settings", S.set);
    if (key === "cluster" || key === "pinScale") rebuildNewsSource();
    else refreshMapData();
  };
});

/* ---------------- Keyboard ---------------- */
document.addEventListener("keydown", (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName);
  if (e.key === "Escape") {
    if (S.tool) { setTool(null); clearMeasure(true); return; }
    closeModals(); deselect(); resEl.classList.remove("open");
    return;
  }
  if (typing) return;
  if (e.key === "/") { e.preventDefault(); searchEl.focus(); searchEl.select(); }
  else if (e.key === "d") setTool("dist");
  else if (e.key === "a") setTool("area");
  else if (e.key === "t") $("#timeline").classList.toggle("hidden");
});

/* ---------------- Pulse CSS (injected) ---------------- */
const pulseCss = document.createElement("style");
pulseCss.textContent = `
.pulse-el{width:18px;height:18px;border-radius:50%;background:transparent;pointer-events:none;position:relative}
.pulse-el::before,.pulse-el::after{content:"";position:absolute;inset:0;border-radius:50%;border:2.5px solid var(--pc,#4da3ff);animation:atlasPulse 2.2s ease-out infinite}
.pulse-el::after{animation-delay:1.1s}
@keyframes atlasPulse{0%{transform:scale(.4);opacity:.9}80%{transform:scale(2.4);opacity:0}100%{transform:scale(2.4);opacity:0}}`;
document.head.appendChild(pulseCss);

/* ---------------- Boot the static UI ---------------- */
buildChips();
$$("#basemapSeg button").forEach((b) => b.classList.toggle("on", b.dataset.bm === S.basemap));
