// Groundtruth · the capture timeline: one pip per satellite acquisition on a real
// date axis, milestone flags above it, and draggable A/B handles in compare modes.

import { h, decYear, fmtDate, clamp } from "./util.js";

const NS = "http://www.w3.org/2000/svg";
const s = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

export class Timeline {
  constructor(root, handlers) {
    this.root = root;
    this.on = handlers; // { select(i), setA(i), setB(i), milestone(m), thumb(frame) -> Promise<canvas> }
    this.frames = [];
    this.milestones = [];
    this.state = { mode: "single", cur: 0, a: 0, b: 0 };
    this.svg = s("svg", { class: "tl-svg", role: "group", "aria-label": "Capture timeline" });
    this.tip = h("div", { class: "tl-tip", hidden: true });
    root.append(this.svg, this.tip);
    new ResizeObserver(() => this.render()).observe(root);
    this.svg.addEventListener("pointerleave", () => this.hideTip());
  }

  setData(frames, milestones = []) {
    this.frames = frames;
    this.milestones = milestones;
    this.render();
  }

  setState(st) {
    Object.assign(this.state, st);
    this.render();
  }

  domain() {
    const ds = this.frames.map((f) => decYear(f.date));
    if (!ds.length) return [2014, 2027];
    let lo = Math.floor(Math.min(...ds));
    let hi = Math.max(Math.ceil(Math.max(...ds) + 0.001), 2026 + 1);
    if (hi - lo < 4) lo = hi - 4;
    return [lo, hi];
  }

  render() {
    const W = this.root.clientWidth, H = this.root.clientHeight || 78;
    if (!W) return;
    const svg = this.svg;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.replaceChildren();
    const padL = 14, padR = 14;
    const [lo, hi] = this.domain();
    const x = (d) => padL + ((decYear(d) - lo) / (hi - lo)) * (W - padL - padR);
    this.x = x;
    const trackY = Math.round(H * 0.52), labY = H - 6;

    // year grid
    const step = W / (hi - lo) < 42 ? (W / (hi - lo) < 22 ? 4 : 2) : 1;
    for (let y = lo; y <= hi; y++) {
      const xx = x(`${y}-01-01`);
      svg.append(s("line", { x1: xx, x2: xx, y1: trackY - 5, y2: trackY + 5, class: "tl-tick" }));
      if ((y - lo) % step === 0 && y < hi) svg.append(Object.assign(s("text", { x: xx + 3, y: labY, class: "tl-year" }), { textContent: y }));
    }
    svg.append(s("line", { x1: padL, x2: W - padR, y1: trackY, y2: trackY, class: "tl-track" }));

    const { mode, cur, a, b } = this.state;
    const compare = mode !== "single" && mode !== "grid";

    if (compare && this.frames[a] && this.frames[b]) {
      const xa = x(this.frames[a].date), xb = x(this.frames[b].date);
      svg.append(s("line", { x1: Math.min(xa, xb), x2: Math.max(xa, xb), y1: trackY, y2: trackY, class: "tl-range" }));
    } else if (this.frames[cur]) {
      svg.append(s("line", { x1: padL, x2: x(this.frames[cur].date), y1: trackY, y2: trackY, class: "tl-progress" }));
    }

    // milestones (only those inside the visible range)
    const inRange = this.milestones.filter((m) => decYear(m.d) >= lo && decYear(m.d) <= hi);
    for (const m of inRange) {
      const xx = x(m.d);
      const g = s("g", { class: "tl-ms", tabindex: 0, role: "button", "aria-label": `${fmtDate(m.d)}: ${m.t}` });
      g.append(s("line", { x1: xx, x2: xx, y1: 16, y2: trackY - 6, class: "tl-ms-stem" }));
      g.append(s("path", { d: `M${xx} 6 l5 5 -5 5 -5 -5z`, class: "tl-ms-dia" }));
      g.addEventListener("pointerenter", () => this.showTip(xx, `<b>${fmtDate(m.d)}</b><span>${m.t}</span>`, null, "ms"));
      g.addEventListener("pointerleave", () => this.hideTip());
      g.addEventListener("click", () => this.on.milestone?.(m));
      g.addEventListener("keydown", (e) => { if (e.key === "Enter") this.on.milestone?.(m); });
      svg.append(g);
    }

    // capture pips
    this.frames.forEach((f, i) => {
      const xx = x(f.date);
      const isCur = !compare && i === cur;
      const isA = compare && i === a, isB = compare && i === b;
      const g = s("g", { class: `tl-pip${isCur ? " is-cur" : ""}${isA ? " is-a" : ""}${isB ? " is-b" : ""}${f.approx ? " is-approx" : ""}`, tabindex: -1 });
      g.append(s("rect", { x: xx - 7, y: trackY - 14, width: 14, height: 28, class: "tl-hit" }));
      g.append(s("circle", { cx: xx, cy: trackY, r: isCur || isA || isB ? 6.5 : 4.5, class: "tl-dot" }));
      g.addEventListener("pointerenter", () => this.hoverFrame(i, xx));
      g.addEventListener("click", (e) => this.pick(i, e));
      svg.append(g);
    });

    // A/B handles
    if (compare) {
      for (const [key, idx] of [["A", a], ["B", b]]) {
        const f = this.frames[idx];
        if (!f) continue;
        const xx = x(f.date);
        const g = s("g", { class: `tl-handle tl-handle-${key.toLowerCase()}`, "aria-label": `Handle ${key}` });
        g.append(s("line", { x1: xx, x2: xx, y1: trackY - 22, y2: trackY + 8, class: "tl-handle-stem" }));
        g.append(s("rect", { x: xx - 9, y: trackY - 36, width: 18, height: 16, rx: 4, class: "tl-handle-flag" }));
        g.append(Object.assign(s("text", { x: xx, y: trackY - 24.5, class: "tl-handle-txt" }), { textContent: key }));
        g.addEventListener("pointerdown", (e) => this.drag(e, key));
        svg.append(g);
      }
    }
  }

  nearest(px) {
    let best = 0, bd = Infinity;
    this.frames.forEach((f, i) => {
      const d = Math.abs(this.x(f.date) - px);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  pick(i, e) {
    const { mode, a, b } = this.state;
    if (mode === "single" || mode === "grid") return this.on.select?.(i);
    if (e?.shiftKey) return this.on.setA?.(i);
    if (e?.altKey) return this.on.setB?.(i);
    // move whichever handle is closer in time; ties go to B
    const xi = this.x(this.frames[i].date);
    const da = Math.abs(this.x(this.frames[a].date) - xi), db = Math.abs(this.x(this.frames[b].date) - xi);
    (da < db ? this.on.setA : this.on.setB)?.(i);
  }

  drag(e, key) {
    e.preventDefault();
    const rect = this.svg.getBoundingClientRect();
    const move = (ev) => {
      const px = clamp(ev.clientX - rect.left, 0, rect.width) * (this.root.clientWidth / rect.width);
      const i = this.nearest(px);
      if ((key === "A" ? this.state.a : this.state.b) !== i) (key === "A" ? this.on.setA : this.on.setB)?.(i);
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  async hoverFrame(i, xx) {
    const f = this.frames[i];
    const title = f.approx ? f.label : fmtDate(f.date);
    this.showTip(xx, `<b>${title}</b><span>${f.sub || ""}</span>`, i);
    if (!this.on.thumb) return;
    const token = (this._tok = (this._tok || 0) + 1);
    const c = await this.on.thumb(f);
    if (token !== this._tok || !c || this.tip.hidden) return;
    const slot = this.tip.querySelector(".tl-tip-img");
    if (slot) { slot.replaceChildren(c); slot.classList.add("is-ready"); }
  }

  showTip(xx, html, frameIndex, kind = "pip") {
    const W = this.root.clientWidth;
    this.tip.hidden = false;
    this.tip.className = `tl-tip tl-tip-${kind}`;
    this.tip.innerHTML = (frameIndex != null ? `<div class="tl-tip-img"></div>` : "") + `<div class="tl-tip-txt">${html}</div>`;
    const tw = kind === "pip" ? 212 : 240;
    this.tip.style.left = `${clamp(xx - tw / 2, 0, W - tw)}px`;
    this.tip.style.width = `${tw}px`;
  }

  hideTip() {
    this._tok = (this._tok || 0) + 1;
    this.tip.hidden = true;
  }
}

