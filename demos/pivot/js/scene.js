// Pivot — 3D view. A dolls'-house model of the route (walls that face the camera
// disappear), the item, its planned path, the planner's search cloud and the pinch point.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const PALETTES = {
  light: {
    bg: 0xf1ede5, ground: 0xe7e1d6, grid: 0xd8d1c3, wall: 0xfbf9f5, wallEdge: 0x8b8374, wallTop: 0xcfc7b8,
    floorRoom: 0xe3cfae, floorHall: 0xe9e3d8, floorLift: 0xc9ccd1, floorDoor: 0xd6c3a2, step: 0xcfae80, ceiling: 0x9aa7c7,
    item: 0xff6a2b, itemDark: 0xd9531c, leg: 0x3d2b20, trail: 0x2b59c3, ghost: 0xff6a2b, pinch: 0xe5484d,
    cloudA: 0xff7a3d, cloudB: 0x3b6fe0, hemiSky: 0xffffff, hemiGround: 0xcbbfae, sun: 0xfff3e2, casing: 0xf4efe6,
  },
  dark: {
    bg: 0x16191e, ground: 0x1f242b, grid: 0x303842, wall: 0x737c8a, wallEdge: 0xc7cfdb, wallTop: 0x4a525e,
    floorRoom: 0x8f7355, floorHall: 0x5d6572, floorLift: 0x6c737e, floorDoor: 0x80684b, step: 0x9e7e58, ceiling: 0x8fa3dc,
    item: 0xff7a3d, itemDark: 0xd9531c, leg: 0x2a1f19, trail: 0x8fb1ff, ghost: 0xff7a3d, pinch: 0xff5c63,
    cloudA: 0xff8a52, cloudB: 0x7fa6ff, hemiSky: 0xd4dbe6, hemiGround: 0x2e2a26, sun: 0xffffff, casing: 0x828a97,
  },
};

export class Scene3D {
  constructor(host, labelHost) {
    this.host = host;
    this.labelHost = labelHost;
    this.dark = false;
    this.pal = PALETTES.light;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    host.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 5, 40000);
    this.camera.position.set(900, 1100, 1300);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 120;
    this.controls.maxDistance = 9000;
    this.controls.addEventListener('change', () => this.dirty());
    this.controls.addEventListener('start', () => { this.userOrbiting = true; });
    this.controls.addEventListener('end', () => { this.userOrbiting = false; });

    this.hemi = new THREE.HemisphereLight(this.pal.hemiSky, this.pal.hemiGround, 1.35);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(this.pal.sun, 1.55);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);
    // soft fill from the viewer's side so camera-facing walls don't go grey
    this.fill = new THREE.DirectionalLight(0xffffff, 0.55);
    this.fill.position.set(1, 0.55, 0.9);
    this.scene.add(this.fill);

    this.groundGroup = new THREE.Group();
    this.buildingGroup = new THREE.Group();
    this.itemGroup = new THREE.Group();
    this.pathGroup = new THREE.Group();
    this.cloudGroup = new THREE.Group();
    this.scene.add(this.groundGroup, this.buildingGroup, this.pathGroup, this.itemGroup, this.cloudGroup);

    this.levelGroups = new Map();
    this.labels = [];
    this.focusLevel = null;
    this.follow = false;
    this._needs = true;
    this._raf = 0;
    this._onFrame = null;
    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(host);
    this.resize();
    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
    this._buildGround();
  }

  dirty() { this._needs = true; }

  setTheme(dark) {
    this.dark = dark;
    this.pal = dark ? PALETTES.dark : PALETTES.light;
    this.scene.background = new THREE.Color(this.pal.bg);
    this.scene.fog = new THREE.Fog(this.pal.bg, 5000, 16000);
    this.hemi.color.set(this.pal.hemiSky);
    this.hemi.groundColor.set(this.pal.hemiGround);
    // three.js uses physical light units (≈ π × the old convention)
    this.hemi.intensity = dark ? 2.5 : 1.85;
    this.sun.intensity = dark ? 1.9 : 1.9;
    this.fill.intensity = dark ? 1.0 : 0.8;
    this._buildGround();
    if (this.world) this.setWorld(this.world, { keepCamera: true });
    if (this.item) this.setItem(this.item);
    if (this.pathData) this.setPath(this.pathData.dense, this.pathData.opts);
    this.dirty();
  }

  resize() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty();
  }

  _buildGround() {
    disposeGroup(this.groundGroup);
    const size = 30000;
    const tex = gridTexture(this.pal);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(size / 100, size / 100);
    tex.anisotropy = 4;
    // the texture already carries the ground colour; a white base keeps it from darkening twice
    const g = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 1, polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 8 }));
    g.rotation.x = -Math.PI / 2;
    g.position.y = -2;
    g.receiveShadow = true;
    this.groundGroup.add(g);
    this.scene.background = new THREE.Color(this.pal.bg);
  }

  // ---------------------------------------------------------------------------
  // Building

  setWorld(world, { keepCamera = false } = {}) {
    this.world = world;
    disposeGroup(this.buildingGroup);
    this.levelGroups.clear();
    this._clearLabels();
    const P = this.pal;
    const zones = world.zones;
    const outside = world.free.find((b) => b.kind === 'outside');
    const levelGroup = (lvl) => {
      if (!this.levelGroups.has(lvl)) {
        const g = new THREE.Group();
        g.userData.level = lvl;
        this.levelGroups.set(lvl, g);
        this.buildingGroup.add(g);
      }
      return this.levelGroups.get(lvl);
    };

    const buckets = new Map(); // key → {level, kind, pos:[], nrm:[]}
    const edges = new Map();   // level → [x,y,z,...]
    const push = (key, level, kind, face) => {
      const k = `${level}|${key}`;
      if (!buckets.has(k)) buckets.set(k, { level, key, kind, pos: [], nrm: [] });
      const b = buckets.get(k);
      const [c0, c1, c2, c3] = face.corners;
      const tri = face.sign > 0 ? [c0, c1, c2, c0, c2, c3] : [c0, c2, c1, c0, c3, c2];
      const n = [0, 0, 0]; n[face.axis] = face.sign;
      for (const c of tri) { b.pos.push(c[0], c[1], c[2]); b.nrm.push(n[0], n[1], n[2]); }
    };
    for (const f of world.faces) {
      const zk = f.zoneKind;
      const lvl = zones[f.zone].level;
      if (f.kind === 'ceiling') continue;
      if (zk === 'outside') {
        if (f.kind === 'floor') continue; // the ground plane covers it
        // only the building's front face, cut down to a low wall like an architect's model
        if (!(f.axis === 2 && f.sign > 0 && Math.abs(f.corners[0][2] - outside.min[2]) < 0.5)) continue;
        const cutY = 95;
        const y0 = Math.min(...f.corners.map((c) => c[1]));
        if (y0 >= cutY) continue;
        const cut = { ...f, corners: f.corners.map((c) => [c[0], Math.min(c[1], cutY), c[2]]) };
        push('facade', lvl, 'wall', cut);
        addEdge(edges, lvl, cut, false);
        continue;
      }
      if (f.kind === 'floor') {
        const key = zk === 'room' ? 'floorRoom' : zk === 'lift' ? 'floorLift' : zk === 'door' ? 'floorDoor' : 'floorHall';
        push(key, lvl, 'floor', f);
      } else {
        push('wall', lvl, 'wall', f);
        addEdge(edges, lvl, f, false);
      }
    }
    const makeMats = () => ({
      wall: new THREE.MeshStandardMaterial({ color: P.wall, roughness: 0.92, side: THREE.FrontSide }),
      facade: new THREE.MeshStandardMaterial({ color: P.wall, roughness: 0.92, side: THREE.DoubleSide }),
      floorRoom: new THREE.MeshStandardMaterial({ color: P.floorRoom, roughness: 0.8 }),
      floorHall: new THREE.MeshStandardMaterial({ color: P.floorHall, roughness: 0.85 }),
      floorLift: new THREE.MeshStandardMaterial({ color: P.floorLift, roughness: 0.45, metalness: 0.35 }),
      floorDoor: new THREE.MeshStandardMaterial({ color: P.floorDoor, roughness: 0.7 }),
    });
    const levelMats = new Map();
    const matFor = (lvl, key) => { if (!levelMats.has(lvl)) levelMats.set(lvl, makeMats()); return levelMats.get(lvl)[key]; };
    for (const b of buckets.values()) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
      const m = new THREE.Mesh(geo, matFor(b.level, b.key));
      m.receiveShadow = true;
      m.castShadow = false;
      m.userData.kind = b.kind;
      levelGroup(b.level).add(m);
    }
    for (const [lvl, arr] of edges) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr.floor, 3));
      const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: P.wallEdge, transparent: true, opacity: 0.85 }));
      levelGroup(lvl).add(lines);
      const geo2 = new THREE.BufferGeometry();
      geo2.setAttribute('position', new THREE.Float32BufferAttribute(arr.top, 3));
      const tops = new THREE.LineSegments(geo2, new THREE.LineBasicMaterial({ color: P.wallEdge, transparent: true, opacity: this.dark ? 0.3 : 0.5 }));
      levelGroup(lvl).add(tops);
    }

    // stairs, bulkheads and sloped ceilings
    const stepMats = new Map();
    const stairMats = (lvl) => {
      if (!stepMats.has(lvl)) stepMats.set(lvl, {
        step: new THREE.MeshStandardMaterial({ color: P.step, roughness: 0.7 }),
        ceil: new THREE.MeshStandardMaterial({ color: P.ceiling, roughness: 0.6, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide }),
        edge: new THREE.LineBasicMaterial({ color: P.ceiling, transparent: true, opacity: 0.9 }),
      });
      return stepMats.get(lvl);
    };
    for (const o of world.obstacles) {
      if (o.kind === 'wall' || o.hidden) continue;
      const zoneBox = world.free.find((b) => b.zone === o.zone);
      const lvl = o.level ?? 0;
      const { step: stepMat, ceil: ceilMat, edge: ceilEdge } = stairMats(lvl);
      if (o.kind === 'step' || o.kind === 'bulkhead') {
        const min = o.min.slice(), max = o.max.slice();
        if (zoneBox) {
          for (const a of [0, 2]) { min[a] = Math.max(min[a], zoneBox.min[a]); max[a] = Math.min(max[a], zoneBox.max[a]); }
          if (o.kind === 'bulkhead') max[1] = Math.min(max[1], min[1] + 22);
          if (o.kind === 'step') min[1] = Math.max(min[1], zoneBox.min[1] - 2);
        }
        const sx = max[0] - min[0], sy = max[1] - min[1], sz = max[2] - min[2];
        if (sx <= 0 || sy <= 0 || sz <= 0) continue;
        const geo = new THREE.BoxGeometry(sx, sy, sz);
        const mesh = new THREE.Mesh(geo, o.kind === 'step' ? stepMat : ceilMat);
        mesh.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
        mesh.receiveShadow = o.kind === 'step';
        mesh.castShadow = o.kind === 'step';
        levelGroup(lvl).add(mesh);
        if (o.kind === 'bulkhead') {
          const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), ceilEdge);
          e.position.copy(mesh.position);
          levelGroup(lvl).add(e);
        }
      } else if (o.kind === 'slope') {
        // draw the underside of the sloped ceiling, clipped to the stair width
        const R = o.R, c = o.c, h = o.h;
        const lat = [R[0], R[3], R[6]], nrm = [R[1], R[4], R[7]], alg = [R[2], R[5], R[8]];
        const w = zoneBox ? Math.min(h[0], (Math.abs(lat[0]) > 0.5 ? zoneBox.max[0] - zoneBox.min[0] : zoneBox.max[2] - zoneBox.min[2]) / 2) : h[0];
        const base = [c[0] - nrm[0] * h[1], c[1] - nrm[1] * h[1], c[2] - nrm[2] * h[1]];
        const pts = [];
        for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          pts.push(new THREE.Vector3(base[0] + lat[0] * w * su + alg[0] * h[2] * sv, base[1] + lat[1] * w * su + alg[1] * h[2] * sv, base[2] + lat[2] * w * su + alg[2] * h[2] * sv));
        }
        const geo = new THREE.BufferGeometry().setFromPoints([pts[0], pts[1], pts[2], pts[0], pts[2], pts[3]]);
        geo.computeVertexNormals();
        levelGroup(lvl).add(new THREE.Mesh(geo, ceilMat));
        const outline = new THREE.BufferGeometry().setFromPoints([pts[0], pts[1], pts[1], pts[2], pts[2], pts[3], pts[3], pts[0]]);
        levelGroup(lvl).add(new THREE.LineSegments(outline, ceilEdge));
      }
    }

    // door casings (decoration around each opening, on both wall faces)
    const casingMats = new Map();
    for (const b of world.free) {
      if (b.kind !== 'door') continue;
      const lvl = zones[b.zone].level;
      if (!casingMats.has(lvl)) casingMats.set(lvl, new THREE.MeshStandardMaterial({ color: P.casing, roughness: 0.6 }));
      const casingMat = casingMats.get(lvl);
      const sx = b.max[0] - b.min[0], sz = b.max[2] - b.min[2];
      const alongX = sx > sz; // opening spans x; wall runs along x; passage along z
      const W = alongX ? sx : sz, D = alongX ? sz : sx, H = b.max[1] - b.min[1];
      const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2, y0 = b.min[1];
      const t = 1.6, cw = 7;
      for (const side of [-1, 1]) {
        const off = side * (D / 2 + t / 2);
        const pieces = [
          [-(W / 2 + cw / 2), y0 + (H + cw) / 2, cw, H + cw],
          [W / 2 + cw / 2, y0 + (H + cw) / 2, cw, H + cw],
          [0, y0 + H + cw / 2, W, cw],
        ];
        for (const [u, y, pw, ph] of pieces) {
          const geo = new THREE.BoxGeometry(alongX ? pw : t, ph, alongX ? t : pw);
          const m = new THREE.Mesh(geo, casingMat);
          m.position.set(alongX ? cx + u : cx + off, y, alongX ? cz + off : cz + u);
          m.castShadow = false; m.receiveShadow = true;
          levelGroup(lvl).add(m);
        }
      }
    }

    // labels
    for (const l of world.labels) {
      const el = document.createElement('div');
      el.className = `lbl lbl-${l.kind}`;
      el.textContent = l.text;
      this.labelHost.appendChild(el);
      this.labels.push({ el, p: new THREE.Vector3(...l.p), level: zones[l.zone]?.level ?? 0, kind: l.kind });
    }

    // sun + shadow camera around the model
    const bb = world.bounds;
    const cx = (bb.min[0] + bb.max[0]) / 2, cz = (bb.min[2] + bb.max[2]) / 2;
    const span = Math.max(bb.max[0] - bb.min[0], bb.max[2] - bb.min[2]) / 2 + 200;
    this.sun.position.set(cx - span * 0.35, bb.max[1] + 1600, cz + span * 0.55);
    this.sun.target.position.set(cx, 0, cz);
    const sc = this.sun.shadow.camera;
    sc.left = -span * 1.3; sc.right = span * 1.3; sc.top = span * 1.3; sc.bottom = -span * 1.3;
    sc.near = 100; sc.far = bb.max[1] + 4000;
    sc.updateProjectionMatrix();

    this.applyLevels();
    if (!keepCamera) this.frameAll(false);
    this.dirty();
  }

  /** Show floors at or below the focus level (upper floors would hide the action). */
  setFocusLevel(level) {
    if (this.focusLevel === level) return;
    this.focusLevel = level;
    this.applyLevels();
    this.dirty();
  }

  applyLevels() {
    const f = this.focusLevel;
    const setDim = (obj, dim) => {
      obj.traverse((o) => {
        const m = o.material;
        if (!m) return;
        if (m.userData.base === undefined) m.userData.base = { opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite };
        const b = m.userData.base;
        m.transparent = dim ? true : b.transparent;
        m.opacity = dim ? b.opacity * 0.2 : b.opacity;
        m.depthWrite = dim ? false : b.depthWrite;
        m.needsUpdate = true;
      });
    };
    for (const [lvl, g] of this.levelGroups) {
      g.visible = f === null || lvl <= f;
      setDim(g, f !== null && lvl < f);
    }
    for (const l of this.labels) l.hidden = !(f === null || l.level === f);
    for (const o of this.pathGroup.children) {
      const lvl = o.userData.level ?? 0;
      o.visible = f === null || lvl <= f;
      if (o.userData.dimmable !== false) setDim(o, f !== null && lvl < f);
    }
  }

  frameAll(animate = true, bounds = null) {
    const bb = bounds || (this.world ? this.world.bounds : { min: [-300, 0, -300], max: [300, 250, 300] });
    const min = bb.min.slice(), max = bb.max.slice();
    // skip most of the driveway so the house fills the view
    if (!bounds && this.world) {
      const inner = this.world.free.filter((b) => b.kind !== 'outside');
      if (inner.length) {
        for (let i = 0; i < 3; i++) { min[i] = Math.min(...inner.map((b) => b.min[i])); max[i] = Math.max(...inner.map((b) => b.max[i])); }
        max[2] = Math.max(max[2], 160);
      }
    }
    const c = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2 * 0.6, (min[2] + max[2]) / 2);
    const r = Math.max(260, 0.5 * Math.hypot(max[0] - min[0], (max[1] - min[1]) * 0.7, max[2] - min[2]));
    const dist = r / Math.sin((this.camera.fov * Math.PI) / 360) * (this.camera.aspect < 1 ? 1.45 / Math.max(0.55, this.camera.aspect) : 1.02);
    const dir = new THREE.Vector3(0.62, 0.95, 0.9).normalize();
    const pos = c.clone().add(dir.multiplyScalar(dist));
    this._tween(pos, c, animate ? 700 : 0);
  }

  _tween(pos, target, ms) {
    if (!ms) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      this.dirty();
      return;
    }
    const p0 = this.camera.position.clone(), t0 = this.controls.target.clone(), start = performance.now();
    this._camTween = (now) => {
      const k = Math.min(1, (now - start) / ms), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.camera.position.lerpVectors(p0, pos, e);
      this.controls.target.lerpVectors(t0, target, e);
      this.controls.update();
      if (k >= 1) this._camTween = null;
      this.dirty();
    };
  }

  // ---------------------------------------------------------------------------
  // Item

  setItem(item) {
    this.item = item;
    const prev = this.itemMesh;
    const pos = prev ? prev.position.clone() : null, quat = prev ? prev.quaternion.clone() : null, vis = prev ? prev.visible : true;
    disposeGroup(this.itemGroup);
    this.itemMesh = buildItemMesh(item, this.pal, false);
    if (pos) { this.itemMesh.position.copy(pos); this.itemMesh.quaternion.copy(quat); this.itemMesh.visible = vis; }
    this.itemGroup.add(this.itemMesh);
    this.dirty();
  }

  setItemPose(pose) {
    if (!this.itemMesh || !pose) return;
    this.itemMesh.position.set(pose[0], pose[1], pose[2]);
    this.itemMesh.quaternion.set(pose[3], pose[4], pose[5], pose[6]);
    this.itemMesh.visible = true;
    if (this.follow && !this.userOrbiting) {
      const tgt = new THREE.Vector3(pose[0], pose[1], pose[2]);
      const delta = tgt.clone().sub(this.controls.target).multiplyScalar(0.12);
      this.controls.target.add(delta);
      this.camera.position.add(delta);
      this.controls.update();
    }
    this.dirty();
  }

  hideItem() { if (this.itemMesh) this.itemMesh.visible = false; this.dirty(); }

  /** Path trail, key-pose ghosts and pinch marker. */
  setPath(dense, opts = {}) {
    this.pathData = { dense, opts };
    disposeGroup(this.pathGroup);
    if (this.pinchLabel) { this.pinchLabel.el.remove(); this.labels = this.labels.filter((l) => l !== this.pinchLabel); this.pinchLabel = null; }
    if (!dense || !dense.length) { this.dirty(); return; }
    const P = this.pal;
    const levelAt = opts.levelAt || (() => 0);
    // trail (broken at lift rides and wherever it changes floor)
    let seg = [], segLevel = null;
    const flush = () => {
      if (seg.length > 1) {
        const g = new THREE.BufferGeometry().setFromPoints(seg);
        const l = new THREE.Line(g, new THREE.LineDashedMaterial({ color: P.trail, dashSize: 8, gapSize: 6, transparent: true, opacity: 0.8 }));
        l.computeLineDistances();
        l.userData.level = segLevel ?? 0;
        this.pathGroup.add(l);
      }
      seg = seg.length ? [seg[seg.length - 1]] : [];
    };
    for (let i = 0; i < dense.length; i++) {
      const lv = levelAt(dense[i].p);
      if (dense[i].t) { flush(); seg = []; }
      else if (segLevel !== null && lv !== segLevel) flush();
      segLevel = lv;
      if (i % 2 === 0 || i === dense.length - 1) seg.push(new THREE.Vector3(dense[i].p[0], dense[i].p[1], dense[i].p[2]));
    }
    flush();
    // ghosts at key poses
    for (const k of opts.ghosts || []) {
      const p = dense[k]?.p;
      if (!p) continue;
      const g = buildItemMesh(this.item, P, true);
      g.position.set(p[0], p[1], p[2]);
      g.quaternion.set(p[3], p[4], p[5], p[6]);
      g.userData.level = levelAt(p);
      g.userData.dimmable = false;
      this.pathGroup.add(g);
    }
    // pinch point
    if (opts.pinch && opts.pinch.point) {
      const pt = opts.pinch.point;
      const s = new THREE.Mesh(new THREE.SphereGeometry(4.2, 20, 14), new THREE.MeshBasicMaterial({ color: P.pinch }));
      s.position.set(pt[0], pt[1], pt[2]);
      s.userData.level = opts.pinchLevel ?? 0;
      s.userData.dimmable = false;
      this.pathGroup.add(s);
      const ring = new THREE.Mesh(new THREE.RingGeometry(8, 10.5, 40), new THREE.MeshBasicMaterial({ color: P.pinch, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
      ring.position.copy(s.position);
      ring.userData.pulse = true;
      ring.userData.level = opts.pinchLevel ?? 0;
      ring.userData.dimmable = false;
      this.pathGroup.add(ring);
      this.pinchRing = ring;
      const el = document.createElement('div');
      el.className = 'lbl lbl-pinch';
      el.textContent = opts.pinchText || 'Tightest';
      this.labelHost.appendChild(el);
      this.pinchLabel = { el, p: s.position.clone(), level: opts.pinchLevel ?? 0, kind: 'pinch' };
      this.labels.push(this.pinchLabel);
    }
    this.applyLevels();
    this.dirty();
  }

  showPinch(show) {
    this.pathGroup.visible = show;
    if (this.pinchLabel) this.pinchLabel.hidden = !show;
    this.dirty();
  }

  // ---------------------------------------------------------------------------
  // Search cloud (planner nodes streaming in)

  clearCloud() {
    disposeGroup(this.cloudGroup);
    const max = 60000;
    const geo = new THREE.BufferGeometry();
    this.cloudPos = new Float32Array(max * 3);
    this.cloudCol = new Float32Array(max * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.cloudPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.cloudCol, 3));
    geo.setDrawRange(0, 0);
    this.cloudN = 0;
    this.cloudMax = max;
    const mat = new THREE.PointsMaterial({ size: 5, vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false, sizeAttenuation: true });
    this.cloud = new THREE.Points(geo, mat);
    this.cloud.frustumCulled = false;
    this.cloudGroup.add(this.cloud);
    this.dirty();
  }

  addCloud(pts) {
    if (!this.cloud || !pts || !pts.length) return;
    const cA = new THREE.Color(this.pal.cloudA), cB = new THREE.Color(this.pal.cloudB);
    for (let i = 0; i + 3 < pts.length + 1; i += 4) {
      let k = this.cloudN;
      if (k >= this.cloudMax) k = Math.floor(Math.random() * this.cloudMax);
      else this.cloudN++;
      this.cloudPos[k * 3] = pts[i]; this.cloudPos[k * 3 + 1] = pts[i + 1]; this.cloudPos[k * 3 + 2] = pts[i + 2];
      const c = pts[i + 3] ? cB : cA;
      this.cloudCol[k * 3] = c.r; this.cloudCol[k * 3 + 1] = c.g; this.cloudCol[k * 3 + 2] = c.b;
    }
    const g = this.cloud.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.setDrawRange(0, this.cloudN);
    this.dirty();
  }

  fadeCloud(opacity) {
    if (this.cloud) { this.cloud.material.opacity = opacity; this.cloud.visible = opacity > 0.01; this.dirty(); }
  }

  // ---------------------------------------------------------------------------

  onFrame(fn) { this._onFrame = fn; }

  _loop(now) {
    this._raf = requestAnimationFrame(this._loop);
    if (this._camTween) this._camTween(now);
    const orbit = this.controls.update();
    if (this._onFrame) this._onFrame(now);
    if (this.pinchRing && this.pathGroup.visible) {
      const s = 1 + 0.35 * Math.sin(now / 260);
      this.pinchRing.scale.setScalar(s);
      this.pinchRing.lookAt(this.camera.position);
      this._needs = true;
    }
    if (!this._needs && !orbit) return;
    this._needs = false;
    this.renderer.render(this.scene, this.camera);
    this._placeLabels();
  }

  renderNow() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this._placeLabels();
  }

  _placeLabels() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    const v = new THREE.Vector3();
    for (const l of this.labels) {
      if (l.hidden || (this.hideDimLabels && l.kind !== 'pinch')) { l.el.style.display = 'none'; continue; }
      v.copy(l.p).project(this.camera);
      if (v.z > 1 || v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2) { l.el.style.display = 'none'; continue; }
      l.el.style.display = '';
      l.el.style.transform = `translate(-50%, -50%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
    }
  }

  _clearLabels() {
    for (const l of this.labels) l.el.remove();
    this.labels = [];
    this.pinchLabel = null;
  }

  snapshot(type = 'image/png') {
    this.renderNow();
    return this.renderer.domElement.toDataURL(type);
  }
}

// ---------------------------------------------------------------------------

function addEdge(edges, lvl, f, facade) {
  if (!edges.has(lvl)) edges.set(lvl, { floor: [], top: [] });
  const e = edges.get(lvl);
  // corners: vertical walls → find the bottom and top edges
  const ys = f.corners.map((c) => c[1]);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const bot = f.corners.filter((c) => Math.abs(c[1] - y0) < 0.01);
  const top = f.corners.filter((c) => Math.abs(c[1] - y1) < 0.01);
  if (bot.length === 2) e.floor.push(...bot[0], ...bot[1]);
  if (top.length === 2 && !facade) e.top.push(...top[0], ...top[1]);
}

function gridTexture(pal) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const col = new THREE.Color(pal.ground), line = new THREE.Color(pal.grid);
  g.fillStyle = `#${col.getHexString()}`;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = `#${line.getHexString()}`;
  g.lineWidth = 2;
  g.strokeRect(0, 0, 128, 128);
  g.globalAlpha = 0.5;
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 128); g.moveTo(0, 64); g.lineTo(128, 64); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const ITEM_TINTS = {
  base: 'item', back: 'item', arm: 'item', body: 'item', mattress: 'item', boxspring: 'item', cabinet: 'item',
  appliance: 'item', wood: 'item', carton: 'item', keys: 'itemDark', leg: 'leg',
};

/** Build a pretty mesh for the item from its collision parts (rounded, with cushions). */
export function buildItemMesh(item, pal, ghost) {
  const group = new THREE.Group();
  const mat = (key) => {
    const color = key === 'leg' ? pal.leg : key === 'itemDark' ? pal.itemDark : pal.item;
    if (ghost) return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false });
    return new THREE.MeshStandardMaterial({ color, roughness: key === 'leg' ? 0.55 : 0.88, metalness: 0 });
  };
  const mats = {};
  const getMat = (look) => { const k = ITEM_TINTS[look] || 'item'; return (mats[k] ||= mat(k)); };
  const seamMat = ghost ? null : new THREE.MeshStandardMaterial({ color: pal.itemDark, roughness: 0.9 });
  const isSofa = ['sofa', 'loveseat', 'armchair', 'sectional'].includes(item.type);
  const arms = item.parts.filter((p) => p.name.includes('arm') && !p.name.includes('chaise'));
  const addBox = (cx, cy, cz, sx, sy, sz, m, radius) => {
    const r = Math.max(0.2, Math.min(radius, Math.min(sx, sy, sz) / 2 - 0.05));
    const geo = new RoundedBoxGeometry(Math.max(0.5, sx), Math.max(0.5, sy), Math.max(0.5, sz), 3, r);
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = !ghost;
    mesh.receiveShadow = !ghost;
    group.add(mesh);
    return mesh;
  };
  for (const p of item.parts) {
    const [cx, cy, cz] = p.c, [hx, hy, hz] = p.h;
    const m = getMat(p.look);
    if (isSofa && (p.name === 'base' || p.name === 'back') && !ghost) {
      // split into cushions between the arms
      const armL = arms.find((a) => a.name === 'left arm'), armR = arms.find((a) => a.name === 'right arm');
      const x0 = armL ? armL.c[0] + armL.h[0] : cx - hx, x1 = armR ? armR.c[0] - armR.h[0] : cx + hx;
      const inner = x1 - x0;
      const n = inner > 150 ? 3 : inner > 95 ? 2 : 1;
      if (p.name === 'base') {
        const deck = hy * 2 * 0.55;
        addBox(cx, cy - hy + deck / 2, cz, hx * 2, deck, hz * 2, m, 3);
        const ch = hy * 2 - deck, gap = 1.2, cw = (inner - gap * (n - 1)) / n;
        for (let i = 0; i < n; i++) addBox(x0 + cw / 2 + i * (cw + gap), cy + hy - ch / 2, cz + 0.5, cw - 0.4, ch, hz * 2 - 1, m, 5);
        if (armL) addBox(armL.c[0], cy + hy - ch / 2, cz, armL.h[0] * 2, ch, hz * 2, m, 3);
        if (armR) addBox(armR.c[0], cy + hy - ch / 2, cz, armR.h[0] * 2, ch, hz * 2, m, 3);
      } else {
        const gap = 1.2, cw = (hx * 2 - gap * (n - 1)) / n;
        for (let i = 0; i < n; i++) addBox(cx - hx + cw / 2 + i * (cw + gap), cy, cz, cw, hy * 2, hz * 2, m, 5);
      }
      continue;
    }
    addBox(cx, cy, cz, hx * 2, hy * 2, hz * 2, m, p.look === 'leg' ? 1 : p.look === 'carton' || p.look === 'appliance' || p.look === 'cabinet' ? 1.5 : 4);
    if (!ghost && seamMat && (p.look === 'cabinet' || p.look === 'appliance')) {
      // a door seam on the front face
      addBox(cx, cy, cz + hz - 0.3, 0.8, hy * 2 - 6, 1, seamMat, 0.2);
    }
    if (!ghost && seamMat && p.look === 'carton') {
      addBox(cx, cy + hy - 0.2, cz, hx * 2 - 2, 0.8, 6, seamMat, 0.2);
    }
  }
  return group;
}

function disposeGroup(g) {
  for (let i = g.children.length - 1; i >= 0; i--) {
    const c = g.children[i];
    c.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
    });
    g.remove(c);
  }
}
