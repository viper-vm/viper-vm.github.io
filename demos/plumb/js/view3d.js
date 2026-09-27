// Plumb — the stack: every floor as a cut-away plate, pulled apart so you can see what
// continues from one floor to the next (columns, shafts, cores) and where it doesn't.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PALETTES, TYPE_COLOR, levelTag, floorName } from './style.js';

const FLOOR_H = 3.0;   // floor to floor (plans don't say; 3 m reads right)
const SLAB = 0.16;
const WALL_H = 1.2;    // walls cut at sill height, like a plan cut
const CORE = new Set(['duct', 'lift', 'stair']);

export class Stack3D {
  constructor(host, cb = {}) {
    this.host = host;
    this.cb = cb;
    this.theme = 'dark';
    this.explode = 0.45;
    this.spacing = this.targetSpacing();
    this.selected = null;
    this.data = null;
    this.floors = [];
    this.beacons = [];
    this.needs = true;
    this.tween = null;

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }));
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    host.appendChild(r.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.3, 5000);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.addEventListener('change', () => this.request());
    this.controls.addEventListener('start', () => { this.tween = null; this.request(); });

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4048, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(40, 90, 55);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xbfd6ff, 0.5);
    fill.position.set(-60, 30, -40);
    this.scene.add(fill);
    this.root = new THREE.Group();
    this.scene.add(this.root);

    this._pick();
    this._resize();
    new ResizeObserver(() => { this._resize(); this.request(); }).observe(host);
  }

  targetSpacing() { return FLOOR_H + this.explode * 7.5; }

  // ---------------------------------------------------------------- public
  setData(data) {
    this.data = data;
    this.build();
    this.fit(false);
  }
  setTheme(t) { this.theme = t; if (this.data) this.build(); this.request(); }
  setExplode(v) { this.explode = v; this.request(); }
  setSelected(id) {
    this.selected = id;
    const iss = id && this.data ? this.data.issues.find((i) => i.id === id) : null;
    const focus = iss ? new Set([iss.lower, iss.upper]) : null;
    this.floors.forEach((f, k) => f.setDim(focus ? !focus.has(k) : false));
    for (const b of this.beacons) {
      const on = b.iss.id === id;
      b.sprite.material.opacity = !id || on ? 1 : 0.35;
      b.stem.material.opacity = !id || on ? 0.9 : 0.2;
      b.big = on;
    }
    this.layout();
    this.request();
  }
  setDismissed(set) {
    for (const b of this.beacons) b.sprite.material.map = beaconTexture(b.iss, PALETTES[this.theme], set.has(b.iss.id));
    this.request();
  }
  focusIssue(iss) {
    if (!iss) return;
    const b = this.beacons.find((q) => q.iss.id === iss.id);
    if (!b) return;
    const p = b.sprite.position.clone();
    const target = new THREE.Vector3(p.x, p.y - (WALL_H + 1.2) - this.spacing * 0.5, p.z);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.y < 0.35) { dir.y = 0.5; dir.normalize(); }
    const dist = 26 + this.spacing * 1.2;
    this.flyTo(target, target.clone().add(dir.multiplyScalar(dist)));
  }
  fit(animate = true) {
    if (!this.data) return;
    const b = this.bbox();
    const size = new THREE.Vector3(), c = new THREE.Vector3();
    b.getSize(size); b.getCenter(c);
    const r = Math.max(size.x, size.y, size.z) * 0.5 + 4;
    const dist = r / Math.sin((this.camera.fov * Math.PI) / 360) * (this.camera.aspect < 1 ? 1.4 : 0.86);
    const dir = new THREE.Vector3(1.0, 0.72, 1.25).normalize();
    this.flyTo(c, c.clone().add(dir.multiplyScalar(dist)), animate);
  }
  renderNow() { this.frame(performance.now()); }
  request() {
    if (this._raf) return;
    this._raf = requestAnimationFrame((t) => { this._raf = 0; this.frame(t); });
  }

  // ---------------------------------------------------------------- frame
  frame(t) {
    let more = this.controls.update();
    const target = this.targetSpacing();
    if (Math.abs(this.spacing - target) > 0.005) {
      this.spacing += (target - this.spacing) * 0.18;
      if (Math.abs(this.spacing - target) < 0.01) this.spacing = target;
      this.layout();
      more = true;
    }
    if (this.tween) {
      const w = this.tween, u = Math.min(1, (t - w.t0) / w.dur), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      this.controls.target.lerpVectors(w.fromT, w.toT, e);
      this.camera.position.lerpVectors(w.fromP, w.toP, e);
      this.camera.lookAt(this.controls.target);
      if (u >= 1) this.tween = null;
      more = true;
    }
    for (const b of this.beacons) {
      const s = (b.big ? 34 : 25) * this.px;
      if (Math.abs(b.sprite.scale.x - s) > 1e-6) { b.sprite.scale.set(s, s, 1); }
    }
    for (const f of this.floors) { const a = f.label.userData.aspect; f.label.scale.set(13 * this.px * a, 13 * this.px, 1); }
    this.renderer.render(this.scene, this.camera);
    if (more) this.request();
  }
  flyTo(target, pos, animate = true) {
    if (!animate) {
      this.controls.target.copy(target); this.camera.position.copy(pos); this.camera.lookAt(target); this.tween = null;
      this.request();
      return;
    }
    this.tween = { fromT: this.controls.target.clone(), toT: target.clone(), fromP: this.camera.position.clone(), toP: pos.clone(), t0: performance.now(), dur: 700 };
    this.request();
  }
  _resize() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // sprites with sizeAttenuation off are sized in view units: this converts pixels to them
    this.px = 1 / ((h / 2) / Math.tan((this.camera.fov * Math.PI) / 360));
  }

  // ---------------------------------------------------------------- scene
  clear() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
    });
    this.root.clear();
    this.floors = [];
    this.beacons = [];
  }
  bbox() {
    const b = new THREE.Box3();
    const n = this.data.floors.length;
    for (let k = 0; k < n; k++) {
      const box = this.data.an[k].box, T = this.data.transforms[k];
      for (const [x, y] of [[box[0], box[1]], [box[2], box[3]]]) {
        b.expandByPoint(new THREE.Vector3(x + T.tx - this.cx, k * this.targetSpacing(), -(y + T.ty - this.cy)));
      }
    }
    b.expandByPoint(new THREE.Vector3(b.min.x, (n - 1) * this.targetSpacing() + FLOOR_H + 1, b.min.z));
    return b;
  }

  build() {
    this.clear();
    const d = this.data, pal = PALETTES[this.theme];
    this.scene.background = new THREE.Color(pal.sky);
    // centre on the first floor
    const b0 = d.an[0].box;
    this.cx = (b0[0] + b0[2]) / 2; this.cy = (b0[1] + b0[3]) / 2;

    const issueCols = new Map(); // "k:x:y" → severity
    const issueRooms = new Map(); // "k:roomId" → severity
    for (const iss of d.issues) {
      if (/column/.test(iss.kind)) issueCols.set(`${iss.upper}:${iss.at[0].toFixed(3)}:${iss.at[1].toFixed(3)}`, iss.severity);
      if (iss.rooms) {
        issueRooms.set(`${iss.upper}:${iss.rooms[0]}`, iss.severity);
        if (iss.rooms[1] !== undefined) issueRooms.set(`${iss.lower}:${iss.rooms[1]}`, iss.severity);
      }
    }

    d.floors.forEach((f, k) => {
      const an = d.an[k], geo = d.geometry[k], T = d.transforms[k];
      const g = new THREE.Group();
      g.rotation.x = -Math.PI / 2;
      g.userData.base = new THREE.Vector3(T.tx - this.cx, 0, this.cy - T.ty);
      const mats = [];
      const mat = (m) => { m.userData.base = { opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite }; mats.push(m); return m; };

      // slab (the floor plate itself)
      const slabMat = mat(new THREE.MeshStandardMaterial({ color: pal.slab, roughness: 1, metalness: 0 }));
      const edgeMat = mat(new THREE.LineBasicMaterial({ color: pal.slabEdge, transparent: true, opacity: 0.9 }));
      for (const L of an.outlines) {
        if (L.length < 3) continue;
        const shape = new THREE.Shape(L.map((p) => new THREE.Vector2(p[0], p[1])));
        const geom = new THREE.ExtrudeGeometry(shape, { depth: SLAB, bevelEnabled: false, curveSegments: 1 });
        const m = new THREE.Mesh(geom, slabMat);
        m.position.z = -SLAB;
        g.add(m);
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(geom, 30), edgeMat);
        e.position.z = -SLAB;
        g.add(e);
      }

      // room tiles, coloured by what the room is
      const tileMats = {};
      for (const r of an.rooms) {
        if (!r.poly || r.poly.length < 3) continue;
        const color = TYPE_COLOR[r.type] || TYPE_COLOR.unknown;
        const m = (tileMats[r.type] ||= mat(new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, transparent: true, opacity: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })));
        const shape = new THREE.Shape(r.poly.map((p) => new THREE.Vector2(p[0], p[1])));
        const tile = new THREE.Mesh(new THREE.ShapeGeometry(shape), m);
        tile.position.z = 0.012;
        g.add(tile);
        const sev = issueRooms.get(`${k}:${r.id}`);
        if (sev) {
          const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(r.poly.map((p) => new THREE.Vector3(p[0], p[1], 0.05))), mat(new THREE.LineBasicMaterial({ color: pal[sev], transparent: true, opacity: 1 })));
          g.add(ring);
        }
        // shafts and cores as glass prisms, so you can see them run up the building
        if (CORE.has(r.type)) {
          const pm = mat(new THREE.MeshStandardMaterial({ color: sev ? pal[sev] : color, transparent: true, opacity: sev ? 0.42 : 0.2, roughness: 0.4, depthWrite: false, side: THREE.DoubleSide }));
          const prism = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: FLOOR_H - SLAB - 0.02, bevelEnabled: false, curveSegments: 1 }), pm);
          prism.position.z = 0.02;
          prism.renderOrder = 2;
          g.add(prism);
        }
      }

      // walls, cut at sill height
      const wallMat = mat(new THREE.MeshStandardMaterial({ color: pal.wall, roughness: 0.75, metalness: 0, side: THREE.DoubleSide, transparent: true, opacity: 0.94 }));
      const walls = quads([geo.lines.wall, geo.lines.column], WALL_H);
      if (walls) g.add(new THREE.Mesh(walls, wallMat));
      const glass = quads([geo.lines.window], 0.9);
      if (glass) g.add(new THREE.Mesh(glass, mat(new THREE.MeshStandardMaterial({ color: pal.below, roughness: 0.3, side: THREE.DoubleSide, transparent: true, opacity: 0.45, depthWrite: false }))));
      const tops = topEdges(geo.lines.wall, WALL_H);
      if (tops) g.add(new THREE.LineSegments(tops, mat(new THREE.LineBasicMaterial({ color: pal.slabEdge, transparent: true, opacity: 0.8 }))));

      // columns, full storey height
      if (an.columns.length) {
        const cm = mat(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.05 }));
        const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), cm, an.columns.length);
        const M = new THREE.Matrix4(), col = new THREE.Color();
        const h = FLOOR_H - SLAB;
        an.columns.forEach((c, i) => {
          M.compose(new THREE.Vector3(c.x, c.y, h / 2), new THREE.Quaternion(), new THREE.Vector3(c.w, c.h, h));
          inst.setMatrixAt(i, M);
          const sev = issueCols.get(`${k}:${c.x.toFixed(3)}:${c.y.toFixed(3)}`);
          inst.setColorAt(i, col.set(sev ? pal[sev] : pal.column));
        });
        g.add(inst);
      }

      // floor name, off the left edge
      const label = textSprite(`${levelTag(f)}  ${floorName(f).toUpperCase()}`, pal);
      label.center.set(1, 0.5);
      label.userData.local = [an.box[0] - 1.2, (an.box[1] + an.box[3]) / 2];
      mat(label.material);
      this.root.add(label);

      this.root.add(g);
      const fl = {
        g, mats, label,
        setDim(dim) {
          for (const m of mats) {
            const b = m.userData.base;
            m.transparent = dim ? true : b.transparent;
            m.opacity = dim ? b.opacity * 0.12 : b.opacity;
            m.depthWrite = dim ? false : b.depthWrite;
            m.needsUpdate = true;
          }
        },
      };
      this.floors.push(fl);
    });

    // plumb lines: each column dropped to the floor below; red where nothing catches it
    const okPts = [], badPts = [];
    this.plumb = [];
    for (let k = 1; k < d.floors.length; k++) {
      const T = d.transforms[k];
      for (const c of d.an[k].columns) {
        const sev = issueCols.get(`${k}:${c.x.toFixed(3)}:${c.y.toFixed(3)}`);
        this.plumb.push({ k, x: c.x + T.tx - this.cx, z: -(c.y + T.ty - this.cy), bad: sev === 'high' });
      }
    }
    const mk = (color, opacity) => {
      const geom = new THREE.BufferGeometry();
      const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
      const l = new THREE.LineSegments(geom, m);
      this.root.add(l);
      return l;
    };
    this.plumbOk = mk(pal.muted, 0.55);
    this.plumbBad = mk(pal.high, 1);
    void okPts; void badPts;

    // beacons: one per issue, floating over the upper floor, with a stem down to the floor below
    d.issues.forEach((iss) => {
      const T = d.transforms[iss.upper], TL = d.transforms[iss.lower];
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: beaconTexture(iss, pal, false), depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true }));
      sprite.renderOrder = 10;
      sprite.userData.issue = iss;
      const stem = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: pal[iss.severity], transparent: true, opacity: 0.9, depthTest: false }));
      stem.renderOrder = 9;
      this.root.add(sprite, stem);
      this.beacons.push({ iss, sprite, stem, x: iss.at[0] + T.tx - this.cx, z: -(iss.at[1] + T.ty - this.cy), lx: iss.atLower[0] + TL.tx - this.cx, lz: -(iss.atLower[1] + TL.ty - this.cy), big: false });
    });

    // ground
    const b = d.an[0].box;
    const size = Math.max(b[2] - b[0], b[3] - b[1]) * 1.8 + 20;
    const grid = new THREE.GridHelper(size, Math.round(size / 2), pal.grid3dMajor, pal.grid3d);
    grid.material.transparent = true; grid.material.opacity = 0.9;
    grid.position.y = -SLAB - 0.02;
    this.root.add(grid);

    this.layout();
    if (this.selected) this.setSelected(this.selected);
  }

  /** Everything that depends on how far apart the floors are. */
  layout() {
    if (!this.data) return;
    const s = this.spacing;
    this.floors.forEach((f, k) => {
      const b = f.g.userData.base;
      f.g.position.set(b.x, k * s, b.z);
      const [lx, ly] = f.label.userData.local, T = this.data.transforms[k];
      f.label.position.set(lx + T.tx - this.cx, k * s + 0.3, -(ly + T.ty - this.cy));
    });
    const ok = [], bad = [];
    for (const p of this.plumb) {
      const top = p.k * s - SLAB, bot = (p.k - 1) * s + FLOOR_H - SLAB;
      if (top - bot < 0.05) continue;
      (p.bad ? bad : ok).push(p.x, top, p.z, p.x, p.bad ? (p.k - 1) * s : bot, p.z);
    }
    this.plumbOk.geometry.setAttribute('position', new THREE.Float32BufferAttribute(ok, 3));
    this.plumbBad.geometry.setAttribute('position', new THREE.Float32BufferAttribute(bad, 3));
    this.plumbOk.geometry.computeBoundingSphere(); this.plumbBad.geometry.computeBoundingSphere();
    for (const bc of this.beacons) {
      const y = bc.iss.upper * s + WALL_H + 1.5;
      bc.sprite.position.set(bc.x, y, bc.z);
      bc.stem.geometry.setFromPoints([new THREE.Vector3(bc.x, y, bc.z), new THREE.Vector3(bc.lx, bc.iss.lower * s + 0.03, bc.lz)]);
    }
  }

  _pick() {
    const el = this.renderer.domElement;
    let down = null;
    const ray = new THREE.Raycaster();
    const hit = (e) => {
      const r = el.getBoundingClientRect();
      const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(v, this.camera);
      const hits = ray.intersectObjects(this.beacons.map((b) => b.sprite), false);
      return hits.length ? hits[0].object.userData.issue : null;
    };
    el.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) { down = null; return; }
      down = null;
      const iss = hit(e);
      if (iss && this.cb.onPin) this.cb.onPin(iss);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.buttons) return;
      el.style.cursor = hit(e) ? 'pointer' : '';
    });
  }
}

/** Vertical quads over a set of 2D segments ([x1,y1,x2,y2,…] in plan coords, +z up). */
function quads(arrays, h) {
  let n = 0;
  for (const a of arrays) if (a) n += a.length / 4;
  if (!n) return null;
  const pos = new Float32Array(n * 18);
  let o = 0;
  for (const a of arrays) {
    if (!a) continue;
    for (let i = 0; i < a.length; i += 4) {
      const x1 = a[i], y1 = a[i + 1], x2 = a[i + 2], y2 = a[i + 3];
      if (Math.hypot(x2 - x1, y2 - y1) < 0.02) continue;
      pos.set([x1, y1, 0, x2, y2, 0, x2, y2, h, x1, y1, 0, x2, y2, h, x1, y1, h], o);
      o += 18;
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, o), 3));
  geom.computeVertexNormals();
  return geom;
}

function topEdges(a, h) {
  if (!a || !a.length) return null;
  const pos = new Float32Array((a.length / 4) * 6);
  for (let i = 0, o = 0; i < a.length; i += 4, o += 6) pos.set([a[i], a[i + 1], h, a[i + 2], a[i + 3], h], o);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return geom;
}

function beaconTexture(iss, pal, dismissed) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.beginPath(); x.arc(64, 64, 50, 0, Math.PI * 2);
  x.fillStyle = dismissed ? pal.bg : pal[iss.severity]; x.fill();
  x.lineWidth = 9; x.strokeStyle = dismissed ? pal.muted : pal.halo; x.stroke();
  x.fillStyle = dismissed ? pal.muted : iss.severity === 'high' ? '#fff' : '#111';
  x.font = "600 56px 'IBM Plex Mono', ui-monospace, monospace";
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(String(iss.n), 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function textSprite(text, pal) {
  const c = document.createElement('canvas');
  const fs = 44;
  const x = c.getContext('2d');
  x.font = `600 ${fs}px 'IBM Plex Mono', ui-monospace, monospace`;
  const w = Math.ceil(x.measureText(text).width) + 24;
  c.width = w; c.height = fs + 22;
  x.font = `600 ${fs}px 'IBM Plex Mono', ui-monospace, monospace`;
  x.fillStyle = pal.muted;
  x.textBaseline = 'middle';
  x.fillText(text, 12, c.height / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, sizeAttenuation: false }));
  sp.userData.aspect = c.width / c.height;
  return sp;
}
