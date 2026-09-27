// Groundtruth · exports: timelapse video (MP4 via WebCodecs, WebM fallback),
// still images, before/after pairs and contact-sheet posters. Every pixel comes
// from the tile compositor, so exports are identical on every device.

import { drawFrame, prefetch } from "./compositor.js";
import { decYear, fmtDate, fmtMonth } from "./util.js";

const MUXER = "https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/+esm";
const SERIF = '"Instrument Serif", Georgia, serif';
const SANS = '"Geist", "Helvetica Neue", Arial, sans-serif';
const MONO = '"Geist Mono", ui-monospace, Menlo, monospace';

export async function fontsReady() {
  try {
    await Promise.all([
      document.fonts.load(`italic 64px ${SERIF}`), document.fonts.load(`64px ${SERIF}`),
      document.fonts.load(`500 20px ${SANS}`), document.fonts.load(`20px ${MONO}`),
    ]);
  } catch {}
}

/** Largest w:h crop of the viewport → export view at the requested pixel size. */
export function exportView(mapView, viewport, outW, outH) {
  const crop = cropRect(viewport.w, viewport.h, outW / outH);
  return { lng: mapView.c[0], lat: mapView.c[1], zoom: mapView.z + Math.log2(outW / crop.w), width: outW, height: outH };
}

export function cropRect(vw, vh, aspect) {
  let w = vw, hgt = vw / aspect;
  if (hgt > vh) { hgt = vh; w = vh * aspect; }
  return { w, h: hgt, x: (vw - w) / 2, y: (vh - hgt) / 2 };
}

async function frameCanvas(frame, view) {
  const c = makeCanvas(view.width, view.height);
  await drawFrame(c.getContext("2d"), frame, view);
  return c;
}

function makeCanvas(w, hgt) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = hgt;
  return c;
}

// ---------- overlay ----------
function roundRect(ctx, x, y, w, hgt, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hgt, r);
  ctx.arcTo(x + w, y + hgt, x, y + hgt, r);
  ctx.arcTo(x, y + hgt, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 3 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}

/**
 * Paint the broadcast-style overlay. `pos` is a fractional frame index (0..n-1)
 * so the timeline marker glides during crossfades.
 */
export function drawOverlay(ctx, W, H, meta, frames, pos, opts = {}) {
  const k = Math.min(W, H) / 1080;
  const pad = Math.round(56 * k);
  const portrait = H > W * 1.2;
  const idx = Math.min(frames.length - 1, Math.round(pos));
  const f = frames[idx];

  // scrims
  let g = ctx.createLinearGradient(0, 0, 0, H * 0.28);
  g.addColorStop(0, "rgba(4,6,9,0.72)");
  g.addColorStop(1, "rgba(4,6,9,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H * 0.28);
  g = ctx.createLinearGradient(0, H * 0.58, 0, H);
  g.addColorStop(0, "rgba(4,6,9,0)");
  g.addColorStop(1, "rgba(4,6,9,0.86)");
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.58, W, H * 0.42);

  ctx.textBaseline = "alphabetic";
  // kicker + title
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = `500 ${Math.round(17 * k)}px ${MONO}`;
  ctx.letterSpacing = `${Math.round(3 * k)}px`;
  ctx.fillText("GROUNDTRUTH · FROM ORBIT", pad, pad + 14 * k);
  ctx.letterSpacing = "0px";
  ctx.fillStyle = "#fff";
  ctx.font = `${Math.round((portrait ? 64 : 58) * k)}px ${SERIF}`;
  const titleW = W - pad * 2;
  const words = String(meta.title || "").split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > titleW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  const lh = (portrait ? 66 : 60) * k;
  lines.slice(0, 2).forEach((l, i) => ctx.fillText(fitText(ctx, l, titleW), pad, pad + 14 * k + lh * (i + 1)));
  if (meta.place) {
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.font = `${Math.round(24 * k)}px ${SANS}`;
    ctx.fillText(meta.place, pad, pad + 14 * k + lh * Math.min(2, lines.length) + 36 * k);
  }

  // timeline bar
  const barY = H - pad - 30 * k;
  const x0 = pad, x1 = W - pad;
  const lo = Math.floor(decYear(frames[0].date)), hi = Math.floor(decYear(frames[frames.length - 1].date)) + 1;
  const X = (d) => x0 + ((d - lo) / Math.max(1, hi - lo)) * (x1 - x0);
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 2 * k;
  ctx.beginPath(); ctx.moveTo(x0, barY); ctx.lineTo(x1, barY); ctx.stroke();
  ctx.font = `${Math.round(16 * k)}px ${MONO}`;
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  const every = hi - lo > 10 ? 2 : 1;
  for (let y = lo; y <= hi; y++) {
    ctx.fillRect(X(y) - 0.75 * k, barY - 6 * k, 1.5 * k, 12 * k);
    if ((y - lo) % every === 0 && y < hi) ctx.fillText(String(y), X(y) + 4 * k, barY + 26 * k);
  }
  const pa = decYear(frames[Math.floor(pos)].date), pb = decYear(frames[Math.min(frames.length - 1, Math.ceil(pos))].date);
  const cur = pa + (pb - pa) * (pos - Math.floor(pos));
  ctx.strokeStyle = "#ffb547";
  ctx.lineWidth = 3 * k;
  ctx.beginPath(); ctx.moveTo(x0, barY); ctx.lineTo(X(cur), barY); ctx.stroke();
  for (const fr of frames) {
    ctx.beginPath();
    ctx.arc(X(decYear(fr.date)), barY, 4 * k, 0, Math.PI * 2);
    ctx.fillStyle = decYear(fr.date) <= cur + 0.001 ? "#ffb547" : "rgba(255,255,255,0.6)";
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(X(cur), barY, 9 * k, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();

  // big date
  const dateTxt = f.src === "s2" ? String(f.date).slice(0, 4) : fmtMonth(f.date);
  ctx.fillStyle = "#fff";
  ctx.font = `italic ${Math.round((portrait ? 150 : 128) * k)}px ${SERIF}`;
  const dateY = barY - (portrait ? 110 : 84) * k;
  ctx.fillText(dateTxt, pad - 4 * k, dateY);
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = `${Math.round(19 * k)}px ${MONO}`;
  ctx.fillText(fitText(ctx, f.sub || "", W - pad * 2), pad, dateY + 40 * k);

  // milestone caption: what happened since the previous capture
  const prev = frames[idx - 1];
  const since = (meta.milestones || []).filter((m) => m.d <= f.date && (!prev || m.d > prev.date));
  if (since.length && opts.captions !== false) {
    const m = since[since.length - 1];
    const txt = `${fmtDate(m.d)} — ${m.t}`;
    ctx.font = `500 ${Math.round(24 * k)}px ${SANS}`;
    const tw = Math.min(ctx.measureText(txt).width, W - pad * 2 - 70 * k);
    const bx = pad, by = dateY - (portrait ? 190 : 170) * k, bh = 52 * k;
    ctx.fillStyle = "rgba(10,12,16,0.82)";
    roundRect(ctx, bx, by, tw + 70 * k, bh, 12 * k);
    ctx.fill();
    ctx.fillStyle = "#ffb547";
    ctx.save();
    ctx.translate(bx + 26 * k, by + bh / 2);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-7 * k, -7 * k, 14 * k, 14 * k);
    ctx.restore();
    ctx.fillStyle = "#fff";
    ctx.fillText(fitText(ctx, txt, tw), bx + 48 * k, by + bh / 2 + 8 * k);
  }

  // credits
  ctx.font = `${Math.round(14 * k)}px ${MONO}`;
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.textAlign = "right";
  ctx.fillText(fitText(ctx, f.attribution || "", W * 0.62), W - pad, pad + 14 * k);
  ctx.fillText("viper-vm.github.io/demos/groundtruth", W - pad, pad + 36 * k);
  ctx.textAlign = "left";
}

// ---------- still images ----------
export async function exportStill({ frame, frames, view, meta, captions = true }) {
  await fontsReady();
  const c = makeCanvas(view.width, view.height);
  const ctx = c.getContext("2d");
  await drawFrame(ctx, frame, view);
  const list = frames?.length ? frames : [frame];
  drawOverlay(ctx, view.width, view.height, meta, list, Math.max(0, list.indexOf(frame)), { captions });
  return new Promise((r) => c.toBlob(r, "image/png"));
}

export async function exportBeforeAfter({ a, b, view, meta }) {
  await fontsReady();
  const W = view.width, H = view.height, half = Math.round(W / 2);
  const c = makeCanvas(W, H);
  const ctx = c.getContext("2d");
  const [ca, cb] = await Promise.all([frameCanvas(a, view), frameCanvas(b, view)]);
  ctx.drawImage(ca, 0, 0, half, H, 0, 0, half, H);
  ctx.drawImage(cb, half, 0, W - half, H, half, 0, W - half, H);
  const k = Math.min(W, H) / 1080;
  ctx.fillStyle = "#fff";
  ctx.fillRect(half - 2 * k, 0, 4 * k, H);
  const g = ctx.createLinearGradient(0, H * 0.7, 0, H);
  g.addColorStop(0, "rgba(4,6,9,0)");
  g.addColorStop(1, "rgba(4,6,9,0.8)");
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.7, W, H * 0.3);
  const pad = 48 * k;
  for (const [f, x, col] of [[a, pad, "#ffb547"], [b, half + pad, "#5ee0ff"]]) {
    ctx.fillStyle = col;
    ctx.font = `600 ${Math.round(18 * k)}px ${MONO}`;
    ctx.fillText(f === a ? "BEFORE" : "AFTER", x, H - pad - 96 * k);
    ctx.fillStyle = "#fff";
    ctx.font = `italic ${Math.round(88 * k)}px ${SERIF}`;
    ctx.fillText(f.src === "s2" ? f.date.slice(0, 4) : fmtMonth(f.date), x - 3 * k, H - pad - 22 * k);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `${Math.round(15 * k)}px ${MONO}`;
    ctx.fillText(fitText(ctx, f.sub || "", half - pad * 2), x, H - pad + 6 * k);
  }
  const tg = ctx.createLinearGradient(0, 0, 0, H * 0.2);
  tg.addColorStop(0, "rgba(4,6,9,0.7)");
  tg.addColorStop(1, "rgba(4,6,9,0)");
  ctx.fillStyle = tg;
  ctx.fillRect(0, 0, W, H * 0.2);
  ctx.fillStyle = "#fff";
  ctx.font = `${Math.round(50 * k)}px ${SERIF}`;
  ctx.fillText(fitText(ctx, meta.title || "", W - pad * 2), pad, pad + 40 * k);
  ctx.font = `${Math.round(14 * k)}px ${MONO}`;
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.textAlign = "right";
  ctx.fillText(fitText(ctx, `${b.attribution || ""} · viper-vm.github.io/demos/groundtruth`, W - pad * 2), W - pad, H - 18 * k);
  ctx.textAlign = "left";
  return new Promise((r) => c.toBlob(r, "image/png"));
}

export async function exportContactSheet({ frames, mapView, viewport, meta, onProgress }) {
  await fontsReady();
  const n = frames.length;
  const cols = n <= 4 ? 2 : n <= 9 ? 3 : 4;
  const rows = Math.ceil(n / cols);
  const cw = 520, chh = Math.round(cw * 0.75), gap = 18, pad = 56, head = 150, lab = 58, foot = 60;
  const W = pad * 2 + cols * cw + (cols - 1) * gap;
  const H = head + pad + rows * (chh + lab) + (rows - 1) * gap + foot;
  const c = makeCanvas(W, H);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#0a0c10";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = `500 16px ${MONO}`;
  ctx.fillText("GROUNDTRUTH · CONTACT SHEET", pad, pad + 4);
  ctx.fillStyle = "#fff";
  ctx.font = `60px ${SERIF}`;
  ctx.fillText(fitText(ctx, meta.title || "", W - pad * 2), pad, pad + 70);
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.font = `22px ${SANS}`;
  ctx.fillText(`${n} satellite captures · ${fmtMonth(frames[0].date)} → ${fmtMonth(frames[n - 1].date)}${meta.place ? " · " + meta.place : ""}`, pad, pad + 108);
  const crop = cropRect(viewport.w, viewport.h, cw / chh);
  const view = { lng: mapView.c[0], lat: mapView.c[1], zoom: mapView.z + Math.log2(cw / crop.w), width: cw, height: chh };
  for (let i = 0; i < n; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const x = pad + col * (cw + gap), y = head + pad + row * (chh + lab + gap);
    const cell = await frameCanvas(frames[i], view);
    ctx.drawImage(cell, x, y);
    ctx.fillStyle = "#fff";
    ctx.font = `italic 34px ${SERIF}`;
    ctx.fillText(frames[i].src === "s2" ? frames[i].date.slice(0, 4) : fmtDate(frames[i].date), x, y + chh + 36);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = `14px ${MONO}`;
    ctx.textAlign = "right";
    ctx.fillText(fitText(ctx, frames[i].sub || "", cw * 0.55), x + cw, y + chh + 34);
    ctx.textAlign = "left";
    onProgress?.((i + 1) / n);
  }
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = `14px ${MONO}`;
  ctx.fillText(fitText(ctx, `${frames[n - 1].attribution || ""} · viper-vm.github.io/demos/groundtruth`, W - pad * 2), pad, H - 26);
  return new Promise((r) => c.toBlob(r, "image/png"));
}

// ---------- timelapse video ----------
export async function videoSupport(width, height) {
  if (typeof VideoEncoder === "undefined") return { mp4: false, webm: typeof MediaRecorder !== "undefined" };
  for (const codec of ["avc1.640028", "avc1.4d0028", "avc1.42e028"]) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate: 8_000_000, framerate: 30 });
      if (r.supported) return { mp4: true, codec, webm: typeof MediaRecorder !== "undefined" };
    } catch {}
  }
  return { mp4: false, webm: typeof MediaRecorder !== "undefined" };
}

/**
 * frames: ordered frames; view: {lng,lat,zoom,width,height}
 * hold/fade in seconds. Returns { blob, ext }.
 */
export async function exportTimelapse({ frames, view, meta, hold = 1.1, fade = 0.5, captions = true, onProgress, signal }) {
  await fontsReady();
  const fps = 30, W = view.width, H = view.height;
  onProgress?.(0, "Fetching imagery…");
  let fetched = 0;
  await Promise.all(frames.map((f) => prefetch(f, view).then(() => onProgress?.((++fetched / frames.length) * 0.3, "Fetching imagery…"))));
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");

  // Pre-draw each capture once (as ImageBitmaps when available to keep memory sane).
  const stills = [];
  for (let i = 0; i < frames.length; i++) {
    const c = await frameCanvas(frames[i], view);
    stills.push(typeof createImageBitmap === "function" ? await createImageBitmap(c) : c);
    onProgress?.(0.3 + ((i + 1) / frames.length) * 0.2, "Composing frames…");
  }

  const holdF = Math.round(hold * fps), fadeF = Math.round(fade * fps);
  const segs = frames.map((_, i) => (i === frames.length - 1 ? holdF * 2 : holdF + fadeF));
  const total = segs.reduce((a, b) => a + b, 0);
  const out = makeCanvas(W, H);
  const ctx = out.getContext("2d");
  const paint = (n) => {
    let acc = 0, i = 0;
    while (i < segs.length - 1 && n >= acc + segs[i]) acc += segs[i++];
    const local = n - acc;
    const t = i < frames.length - 1 && local > holdF ? (local - holdF) / fadeF : 0;
    ctx.globalAlpha = 1;
    ctx.drawImage(stills[i], 0, 0);
    if (t > 0) {
      ctx.globalAlpha = t * t * (3 - 2 * t); // smoothstep crossfade
      ctx.drawImage(stills[i + 1], 0, 0);
      ctx.globalAlpha = 1;
    }
    drawOverlay(ctx, W, H, meta, frames, i + (t > 0 ? t * t * (3 - 2 * t) : 0), { captions });
  };

  const support = await videoSupport(W, H);
  if (support.mp4) {
    const { Muxer, ArrayBufferTarget } = await import(MUXER);
    const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: "avc", width: W, height: H }, fastStart: "in-memory" });
    let failure = null;
    const enc = new VideoEncoder({ output: (chunk, m) => muxer.addVideoChunk(chunk, m), error: (e) => (failure = e) });
    enc.configure({ codec: support.codec, width: W, height: H, bitrate: W * H > 1e6 ? 10_000_000 : 6_000_000, framerate: fps });
    for (let n = 0; n < total; n++) {
      if (signal?.aborted) { enc.close(); throw new DOMException("aborted", "AbortError"); }
      if (failure) throw failure;
      paint(n);
      const vf = new VideoFrame(out, { timestamp: Math.round((n * 1e6) / fps), duration: Math.round(1e6 / fps) });
      enc.encode(vf, { keyFrame: n % (fps * 2) === 0 });
      vf.close();
      // backpressure: wait for the encoder to drain ('dequeue' isn't throttled in background tabs)
      while (enc.encodeQueueSize > 8) await new Promise((r) => { enc.addEventListener?.("dequeue", r, { once: true }); setTimeout(r, 50); });
      if (n % 10 === 0) onProgress?.(0.5 + (n / total) * 0.5, "Encoding MP4…");
    }
    await enc.flush();
    muxer.finalize();
    stills.forEach((s) => s.close?.());
    onProgress?.(1, "Done");
    return { blob: new Blob([muxer.target.buffer], { type: "video/mp4" }), ext: "mp4" };
  }

  if (!support.webm) throw new Error("This browser can't record video. Try Chrome, Edge or Safari.");
  // Real-time fallback: record the canvas while we paint it.
  const stream = out.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  rec.start(250);
  const t0 = performance.now();
  for (let n = 0; n < total; n++) {
    if (signal?.aborted) { rec.stop(); throw new DOMException("aborted", "AbortError"); }
    paint(n);
    track.requestFrame?.();
    const due = t0 + ((n + 1) * 1000) / fps;
    await new Promise((r) => setTimeout(r, Math.max(0, due - performance.now())));
    if (n % 10 === 0) onProgress?.(0.5 + (n / total) * 0.5, "Recording video…");
  }
  rec.stop();
  await stopped;
  stills.forEach((s) => s.close?.());
  onProgress?.(1, "Done");
  const isMp4 = type.includes("mp4");
  return { blob: new Blob(chunks, { type: type || "video/webm" }), ext: isMp4 ? "mp4" : "webm" };
}
