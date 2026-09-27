// Plumb — the building as a 3D model, made from the 2D plans: every floor's walls stood up to
// full height, lintels over the doors, sills/glass/lintels in the windows, slabs, balcony
// parapets and a roof. Isolate a floor and slide the cut to look into it like a dollhouse;
// export the lot as GLB for SketchUp, Blender, Rhino or a viewer.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TYPE_COLOR, levelTag, floorName } from './style.js';

export const DEFAULT_HEIGHTS = { floor: 3.0, slab: 0.15, door: 2.1, sill: 0.9, head: 2.1, parapet: 1.05 };

const LOOK = {
  dark: { sky: 0x0b0d10, ground: 0x13171c, grid: 0x1c222a, gridMajor: 0x262d37, wall: 0xf1eee8, cut: 0x2e3440, slab: 0xc9c3b8, floor: 0xe6e0d4, glass: 0x9ccbe6, label: '#8a94a1' },
  light: { sky: 0xeeece6, ground: 0xe4e1d9, grid: 0xd9d5cc, gridMajor: 0xcac5b9, wall: 0xfbf9f5, cut: 0x3a3f47, slab: 0xcfc9bd, floor: 0xece6da, glass: 0x8cc4e4, label: '#6c737c' },
};

export class Model3D {
  constructor(host, cb = {}) {
    this.host = host;
    this.cb = cb;
    this.theme = 'dark';
    this.h = { ...DEFAULT_HEIGHTS };
    this.focus = -1;       // -1 = all floors, else show floors 0..focus
    this.cut = 1;          // fraction of the top visible storey kept (1 = no cut)
    this.roomColors = true;
    this.roof = true;
    this.data = null;
    this.mass = null;

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }));
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.localClippingEnabled = true;
    host.appendChild(r.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.2, 5000);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.addEventListener('change', () => this.request());
    this.controls.addEventListener('start', () => { this.tween = null; this.request(); });

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8a8478, 1.55);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff4e5, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.55);
    fill.position.set(-60, 40, -30);
    this.scene.add(fill);

    this.clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this._resize();
    new ResizeObserver(() => { this._resize(); this.request(); }).observe(host);
  }

  // ------------------------------------------------------------------ public
  setData(data, mass) { this.data = data; this.mass = mass; this.build(); this.fit(false); }
  setHeights(h) { this.h = { ...this.h, ...h }; if (this.data) { this.build(); } }
  setTheme(t) { this.theme = t; if (this.data) this.build(); this.request(); }
  setFocus(k) { this.focus = k; this.applyVisibility(); }
  setCut(v) { this.cut = v; this.applyVisibility(); }
  setRoomColors(on) { this.roomColors = on; if (this.data) this.build(); }
  setRoof(on) { this.roof = on; this.applyVisibility(); }
  request() { if (this._raf) return; this._raf = requestAnimationFrame((t) => { this._raf = 0; this.frame(t); }); }
  renderNow() { this.frame(performance.now()); }

  fit(animate = true) {
    if (!this.data) return;
    const b = new THREE.Box3(); // the building only — not the ground plane or grid
    for (const f of this.floors) if (f.g.visible) b.expandByObject(f.g);
    if (this.roofG && this.roofG.visible) b.expandByObject(this.roofG);
    if (b.isEmpty()) return;
    const size = new THREE.Vector3(), c = new THREE.Vector3();
    b.getSize(size); b.getCenter(c);
    const r = size.length() * 0.5 + 1;
    // fit the bounding sphere in whichever viewing angle is narrower (portrait stages are tall)
    const vf = (this.camera.fov * Math.PI) / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * this.camera.aspect);
    const dist = (r / Math.sin(Math.min(vf, hf) / 2)) * 0.92;
    const dir = new THREE.Vector3(-0.85, 0.75, 1.15).normalize();
    this.flyTo(c, c.clone().add(dir.multiplyScalar(dist)), animate);
  }

  /** The model (not the ground/grid) as a binary glTF. */
  async exportGLB() {
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const copy = this.root.clone(true);
    copy.traverse((o) => { o.visible = !o.userData.helper; }); // every floor and the roof; no labels, ground or poché
    return new Promise((resolve, reject) => new GLTFExporter().parse(copy, (glb) => resolve(new Blob([glb], { type: 'model/gltf-binary' })), reject, { binary: true, onlyVisible: true }));
  }

  // ------------------------------------------------------------------ frame
  frame(t) {
    let more = this.controls.update();
    if (this.tween) {
      const w = this.tween, u = Math.min(1, (t - w.t0) / w.dur), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      this.controls.target.lerpVectors(w.fromT, w.toT, e);
      this.camera.position.lerpVectors(w.fromP, w.toP, e);
      this.camera.lookAt(this.controls.target);
      if (u >= 1) this.tween = null;
      more = true;
    }
    this.renderer.render(this.scene, this.camera);
    if (more) this.request();
  }
  flyTo(target, pos, animate = true) {
    if (!animate) { this.controls.target.copy(target); this.camera.position.copy(pos); this.camera.lookAt(target); this.tween = null; this.request(); return; }
    this.tween = { fromT: this.controls.target.clone(), toT: target.clone(), fromP: this.camera.position.clone(), toP: pos.clone(), t0: performance.now(), dur: 650 };
    this.request();
  }
  _resize() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ scene
  clear() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
    });
    this.root.clear();
    this.floors = [];
  }

  build() {
    this.clear();
    const d = this.data, L = LOOK[this.theme], h = this.h;
    this.scene.background = new THREE.Color(L.sky);
    const b0 = d.an[0].box;
    this.cx = (b0[0] + b0[2]) / 2; this.cy = (b0[1] + b0[3]) / 2;
    const top = h.floor - h.slab; // wall top, relative to its floor
    const clip = [this.clip];
    const M = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, clippingPlanes: clip, ...extra });
    const wallM = M(L.wall), cutM = M(L.cut, { side: THREE.BackSide }), slabM = M(L.slab), floorM = M(L.floor, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    const glassM = new THREE.MeshStandardMaterial({ color: L.glass, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.38, depthWrite: false, clippingPlanes: clip });
    const typeM = {};
    const tint = (type) => (typeM[type] ||= M(new THREE.Color(TYPE_COLOR[type] || TYPE_COLOR.unknown).lerp(new THREE.Color(L.floor), 0.55), { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    const solid = (geom, mat, into) => {
      const m = new THREE.Mesh(geom, mat); m.castShadow = true; m.receiveShadow = true; into.add(m);
      const back = new THREE.Mesh(geom, cutM); back.userData.helper = true; into.add(back); // solid poché where the cut slices a wall
      return m;
    };
    const shape = (outer, holes = []) => {
      const s = new THREE.Shape(outer.map((p) => new THREE.Vector2(p[0], p[1])));
      for (const hh of holes) s.holes.push(new THREE.Path(hh.map((p) => new THREE.Vector2(p[0], p[1]))));
      return s;
    };
    const box = (len, t, zh, cx, cy, z0, ang, mat, into) => {
      if (len <= 0.01 || zh <= 0.01) return;
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, t, zh), mat);
      m.position.set(cx, cy, z0 + zh / 2); m.rotation.z = ang;
      m.castShadow = mat !== glassM; m.receiveShadow = true;
      into.add(m);
    };

    d.floors.forEach((f, k) => {
      const an = d.an[k], ms = this.mass[k], T = d.transforms[k], geo = d.geometry[k];
      const g = new THREE.Group();
      g.rotation.x = -Math.PI / 2;
      g.position.set(T.tx - this.cx, k * h.floor, this.cy - T.ty);
      // slab, with the lift and duct shafts left open
      const voids = an.rooms.filter((r) => (r.type === 'lift' || r.type === 'duct') && r.poly.length > 2);
      for (const Lp of an.outlines) {
        if (Lp.length < 3) continue;
        const holes = voids.filter((r) => inside(r.cx, r.cy, Lp)).map((r) => r.poly);
        const geom = new THREE.ExtrudeGeometry(shape(Lp, holes), { depth: h.slab, bevelEnabled: false, curveSegments: 1 });
        geom.translate(0, 0, -h.slab);
        solid(geom, slabM, g);
      }
      // floor finishes, tinted by what the room is
      for (const r of an.rooms) {
        if (!r.poly || r.poly.length < 3 || r.type === 'lift' || r.type === 'duct') continue;
        const m = new THREE.Mesh(new THREE.ShapeGeometry(shape(r.poly)), this.roomColors ? tint(r.type) : floorM);
        m.position.z = 0.004; m.receiveShadow = true;
        g.add(m);
      }
      // walls to the underside of the slab above; parapets round balconies
      for (const w of ms.walls) solid(new THREE.ExtrudeGeometry(shape(w.outer, w.holes), { depth: top, bevelEnabled: false, curveSegments: 1 }), wallM, g);
      for (const w of ms.parapets) solid(new THREE.ExtrudeGeometry(shape(w.outer, w.holes), { depth: h.parapet, bevelEnabled: false, curveSegments: 1 }), wallM, g);
      // lintels over doors
      for (const dr of ms.doors) {
        const len = Math.hypot(dr.x1 - dr.x0, dr.y1 - dr.y0);
        box(len + 0.02, dr.t, top - h.door, (dr.x0 + dr.x1) / 2, (dr.y0 + dr.y1) / 2, h.door, Math.atan2(dr.y1 - dr.y0, dr.x1 - dr.x0), wallM, g);
      }
      // windows: sill, glass, lintel
      for (const wn of ms.windows) {
        box(wn.len, wn.t, h.sill, wn.cx, wn.cy, 0, wn.ang, wallM, g);
        box(wn.len, 0.024, h.head - h.sill, wn.cx, wn.cy, h.sill, wn.ang, glassM, g);
        box(wn.len, wn.t, top - h.head, wn.cx, wn.cy, h.head, wn.ang, wallM, g);
      }
      // stair treads, as drawn
      const st = geo.lines.stair;
      if (st && st.length) {
        const pos = new Float32Array((st.length / 4) * 6);
        for (let i = 0, o = 0; i < st.length; i += 4, o += 6) pos.set([st[i], st[i + 1], 0.02, st[i + 2], st[i + 3], 0.02], o);
        const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: L.cut, clippingPlanes: clip })));
      }
      // floor label
      const lab = textSprite(`${levelTag(f)}  ${floorName(f).toUpperCase()}`, L.label);
      lab.userData.helper = true;
      lab.center.set(1, 0.5);
      lab.position.set(an.box[0] + T.tx - this.cx - 1.2, k * h.floor + 0.2, -((an.box[1] + an.box[3]) / 2 + T.ty - this.cy));
      this.root.add(g, lab);
      this.floors.push({ g, lab });
    });

    // roof over the top floor
    const kTop = d.floors.length - 1;
    this.roofG = new THREE.Group();
    this.roofG.rotation.x = -Math.PI / 2;
    const Tt = d.transforms[kTop];
    this.roofG.position.set(Tt.tx - this.cx, kTop * h.floor + top, this.cy - Tt.ty);
    for (const Lp of d.an[kTop].outlines) if (Lp.length > 2) solid(new THREE.ExtrudeGeometry(shape(Lp), { depth: h.slab, bevelEnabled: false, curveSegments: 1 }), slabM, this.roofG);
    this.root.add(this.roofG);

    // ground + sun sized to the building
    const bb = new THREE.Box3().setFromObject(this.root);
    const size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
    const R = Math.max(size.x, size.z) * 0.5 + 10;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(R * 6, R * 6), new THREE.MeshStandardMaterial({ color: L.ground, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(c.x, -h.slab - 0.01, c.z); ground.receiveShadow = true; ground.userData.helper = true;
    const grid = new THREE.GridHelper(R * 4, Math.round(R * 4), L.gridMajor, L.grid);
    grid.position.set(c.x, -h.slab - 0.005, c.z); grid.userData.helper = true;
    grid.material.transparent = true; grid.material.opacity = 0.6;
    this.root.add(ground, grid);
    this.sun.position.set(c.x + R * 0.9, size.y + R * 1.6, c.z + R * 0.7);
    this.sun.target.position.copy(c);
    const sc = this.sun.shadow.camera;
    sc.left = -R * 1.3; sc.right = R * 1.3; sc.top = R * 1.3; sc.bottom = -R * 1.3; sc.near = 1; sc.far = R * 6 + size.y * 3;
    sc.updateProjectionMatrix();
    this.applyVisibility();
  }

  /** Floors above the focus hidden; the cut plane slices the top visible storey. */
  applyVisibility() {
    if (!this.data) return;
    const n = this.data.floors.length, h = this.h;
    const topK = this.focus < 0 ? n - 1 : Math.min(this.focus, n - 1);
    this.floors.forEach((f, k) => { f.g.visible = k <= topK; f.lab.visible = k <= topK; });
    const cutting = this.cut < 0.999;
    this.roofG.visible = this.roof && topK === n - 1 && !cutting;
    this.clip.constant = cutting ? topK * h.floor + Math.max(0.2, this.cut * (h.floor - h.slab)) : 1e6;
    this.request();
  }
}

function inside(x, y, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function textSprite(text, color) {
  const c = document.createElement('canvas');
  const fs = 44, x = c.getContext('2d');
  x.font = `600 ${fs}px 'IBM Plex Mono', ui-monospace, monospace`;
  c.width = Math.ceil(x.measureText(text).width) + 24; c.height = fs + 22;
  x.font = `600 ${fs}px 'IBM Plex Mono', ui-monospace, monospace`;
  x.fillStyle = color; x.textBaseline = 'middle'; x.fillText(text, 12, c.height / 2 + 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  const hM = 0.55; // metres tall
  sp.scale.set((hM * c.width) / c.height, hM, 1);
  return sp;
}
