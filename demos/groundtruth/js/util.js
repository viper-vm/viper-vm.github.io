// Groundtruth · small shared helpers (formatting, geo maths, storage, DOM).

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtDate = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MON[m - 1]} ${y}`;
};
export const fmtMonth = (iso) => {
  if (!iso) return "—";
  const [y, m] = iso.split("-").map(Number);
  return `${MON[m - 1]} ${y}`;
};
export const yearOf = (iso) => +String(iso).slice(0, 4);

/** Fractional year for placing dates on a linear axis. */
export function decYear(iso) {
  const [y, m = 1, d = 1] = iso.split("-").map(Number);
  const start = Date.UTC(y, 0, 1), end = Date.UTC(y + 1, 0, 1);
  return y + (Date.UTC(y, m - 1, d) - start) / (end - start);
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function haversineKm([lng1, lat1], [lng2, lat2]) {
  const R = 6371.0088, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Geodesic polygon area in m² (spherical excess, fine at city scales). */
export function polygonAreaM2(coords) {
  if (coords.length < 3) return 0;
  const R = 6378137, r = Math.PI / 180;
  let sum = 0;
  for (let i = 0; i < coords.length; i++) {
    const [x1, y1] = coords[i], [x2, y2] = coords[(i + 1) % coords.length];
    sum += (x2 - x1) * r * (2 + Math.sin(y1 * r) + Math.sin(y2 * r));
  }
  return Math.abs((sum * R * R) / 2);
}

export const fmtDist = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : km < 100 ? `${km.toFixed(2)} km` : `${Math.round(km)} km`);
export function fmtArea(m2) {
  const ha = m2 / 1e4;
  if (ha < 1) return `${Math.round(m2).toLocaleString("en-IN")} m²`;
  if (ha < 500) return `${ha.toFixed(ha < 10 ? 2 : 1)} ha · ${(ha * 2.47105).toFixed(0)} acres`;
  return `${(m2 / 1e6).toFixed(2)} km² · ${Math.round(ha * 2.47105).toLocaleString("en-IN")} acres`;
}

export const fmtCoord = ([lng, lat]) => `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lng).toFixed(4)}°${lng >= 0 ? "E" : "W"}`;

// localStorage that never throws (in-app webviews and private modes can block it).
const mem = new Map();
export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? (mem.has(key) ? mem.get(key) : fallback) : JSON.parse(v);
    } catch {
      return mem.has(key) ? mem.get(key) : fallback;
    }
  },
  set(key, value) {
    mem.set(key, value);
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
