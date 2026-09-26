// Training aids (trajectory ribbon, ghost stop position, highlighted boundaries, reference
// stickers) and the debug/calibration overlay. Training aids are hidden in Exam Mode.
import * as THREE from 'three';
import { LAYER } from './car3d.js';

const lineMat = (color, opacity = 1) => new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: true });

export class TrainingOverlay {
  constructor(scene, world, car, P) {
    this.scene = scene; this.world = world; this.car = car; this.P = P;
    this.group = new THREE.Group(); scene.add(this.group);
    this.ribbon = null; this.ribbonPath = null;
    const box = new THREE.BoxGeometry(P.CAR_LENGTH, 1.3, P.CAR_WIDTH);
    this.ghost = new THREE.LineSegments(new THREE.EdgesGeometry(box), lineMat(0x55e0ff, 0.9));
    this.ghostFill = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0x55e0ff, transparent: true, opacity: 0.12, depthWrite: false }));
    this.ghostG = new THREE.Group(); this.ghostG.add(this.ghost, this.ghostFill); this.group.add(this.ghostG);
    this.focus = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.04, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffd24a }));
    this.focus.rotation.x = Math.PI / 2; this.group.add(this.focus);
    this.hl = new THREE.Group(); this.group.add(this.hl); this.hlKey = '';
    // reference sticker (on mirror glass or along the eye ray)
    this.sticker = new THREE.Mesh(new THREE.CircleGeometry(0.0085, 20), new THREE.MeshBasicMaterial({ color: 0xffd24a, depthTest: false }));
    this.sticker.renderOrder = 10; this.sticker.layers.set(LAYER.MIRROR);
    this.stickerRing = new THREE.Mesh(new THREE.RingGeometry(0.012, 0.016, 24), new THREE.MeshBasicMaterial({ color: 0x46b074, depthTest: false }));
    this.stickerRing.renderOrder = 10; this.stickerRing.layers.set(LAYER.MIRROR);
    this.eyeSticker = new THREE.Mesh(new THREE.CircleGeometry(0.01, 20), new THREE.MeshBasicMaterial({ color: 0xffd24a, depthTest: false }));
    this.eyeSticker.renderOrder = 10; this.eyeSticker.layers.set(LAYER.MIRROR); car.group.add(this.eyeSticker);
    this.visible = true;
  }

  setVisible(v) { this.visible = v; this.group.visible = v; if (!v) { this.sticker.visible = false; this.stickerRing.visible = false; this.eyeSticker.visible = false; } }

  buildRibbon(pts, color, dashed) {
    if (this.ribbon) { this.group.remove(this.ribbon); this.ribbon.geometry.dispose(); }
    const pos = [], idx = [];
    const w = 0.22; let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const L = Math.hypot(q.x - p.x, q.z - p.z); acc += L;
      if (dashed && (acc % 2.4) > 1.2) continue;
      if (L < 1e-5) continue;
      const nx = -(q.z - p.z) / L * w / 2, nz = (q.x - p.x) / L * w / 2;
      const y0 = this.world.heightAt(p.x, p.z) + 0.03, y1 = this.world.heightAt(q.x, q.z) + 0.03;
      const k = pos.length / 3;
      pos.push(p.x - nx, y0, p.z - nz, q.x - nx, y1, q.z - nz, q.x + nx, y1, q.z + nz, p.x + nx, y0, p.z + nz);
      idx.push(k, k + 2, k + 1, k, k + 3, k + 2);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    this.ribbon = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
    this.group.add(this.ribbon);
  }

  update(guidance, vehicle, t) {
    if (!this.visible || !guidance) { this.eyeSticker.visible = false; this.sticker.visible = false; this.stickerRing.visible = false; if (this.group) this.ghostG.visible = this.focus.visible = false; return; }
    // path ribbon
    const path = guidance.path || null;
    if (path !== this.ribbonPath) {
      this.ribbonPath = path;
      if (path) this.buildRibbon(path, guidance.leg || guidance.showRoute ? 0x7fd6ff : 0x55e0ff, !!(guidance.leg || guidance.showRoute));
      else if (this.ribbon) { this.group.remove(this.ribbon); this.ribbon = null; }
    }
    // ghost stop position
    const gh = guidance.ghost;
    this.ghostG.visible = !!gh;
    if (gh) {
      const f = gh.frame; const hd = Math.atan2(f.f.z, f.f.x) + (gh.rel || 0);
      const ax = f.o.x + f.f.x * gh.a + f.r.x * gh.b, az = f.o.z + f.f.z * gh.a + f.r.z * gh.b;
      const along = (this.P.WHEELBASE + this.P.FRONT_OVERHANG - this.P.REAR_OVERHANG) / 2;
      const cx = ax + Math.cos(hd) * along, cz = az + Math.sin(hd) * along;
      this.ghostG.position.set(cx, this.world.heightAt(cx, cz) + 0.65, cz);
      this.ghostG.rotation.set(0, -hd, 0);
    }
    // focus post
    const fp = guidance.focus;
    this.focus.visible = !!fp;
    if (fp) { const s = 1 + 0.25 * Math.sin(t * 6); this.focus.scale.set(s, s, s); this.focus.position.set(fp.x, this.world.heightAt(fp.x, fp.z) + 0.06, fp.z); }
    // highlighted boundaries
    const key = (guidance.highlight || []).map((l) => `${l.a.x.toFixed(2)},${l.a.z.toFixed(2)}`).join('|');
    if (key !== this.hlKey) {
      this.hlKey = key; this.hl.clear();
      for (const l of guidance.highlight || []) {
        const L = Math.hypot(l.b.x - l.a.x, l.b.z - l.a.z);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(L, 0.3), new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }));
        m.rotation.set(-Math.PI / 2, -Math.atan2(l.b.z - l.a.z, l.b.x - l.a.x), 0, 'YXZ');
        const mx = (l.a.x + l.b.x) / 2, mz = (l.a.z + l.b.z) / 2;
        m.position.set(mx, this.world.heightAt(mx, mz) + 0.02, mz); this.hl.add(m);
      }
    }
    // reference sticker
    const st = guidance.stickerResolved;
    this.sticker.visible = this.stickerRing.visible = this.eyeSticker.visible = false;
    if (st) {
      if (st.view === 'eye') {
        const d = 0.75, cp = Math.cos(st.pitch);
        const E = this.P.EYE;
        this.eyeSticker.position.set(E.x + d * cp * Math.cos(st.yaw), E.y + d * Math.sin(st.pitch), E.z + d * cp * Math.sin(st.yaw));
        this.eyeSticker.lookAt(this.car.group.localToWorld(new THREE.Vector3(E.x, E.y, E.z)));
        this.eyeSticker.visible = true;
      } else {
        const glass = this.car.mirrorGlass[st.view];
        if (this.sticker.parent !== glass) { glass.add(this.sticker); glass.add(this.stickerRing); }
        const w = glass.geometry.parameters.width, h = glass.geometry.parameters.height;
        this.sticker.position.set((st.u - 0.5) * w, (0.5 - st.v) * h, 0.002);
        this.stickerRing.position.copy(this.sticker.position);
        this.sticker.visible = true;
        this.stickerRing.visible = !!st.aligned;
      }
    }
  }
}

export class DebugOverlay {
  constructor(scene, world, P) {
    this.world = world; this.P = P;
    this.group = new THREE.Group(); this.group.visible = false; scene.add(this.group);
    const seg = [];
    const push = (a, b, y = 0.05) => seg.push(a.x, world.heightAt(a.x, a.z) + y, a.z, b.x, world.heightAt(b.x, b.z) + y, b.z);
    // element boundaries & zones
    for (const el of Object.values(world.elements)) for (const s of el.stations) {
      for (const l of s.lines || []) push(l.a, l.b, 0.07);
      if (s.stopLine) push(s.stopLine.a, s.stopLine.b, 0.07);
      if (s.outerArcs) for (const a of s.outerArcs) { const n = 40; for (let k = 0; k < n; k++) { const t0 = a.a0 + (a.a1 - a.a0) * k / n, t1 = a.a0 + (a.a1 - a.a0) * (k + 1) / n; push({ x: a.c.x + a.r * Math.cos(t0), z: a.c.z + a.r * Math.sin(t0) }, { x: a.c.x + a.r * Math.cos(t1), z: a.c.z + a.r * Math.sin(t1) }, 0.07); } }
      if (s.opening) push(s.opening.a, s.opening.b, 0.3);
    }
    this.group.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(seg, 3)), lineMat(0xff3355)));
    // solid colliders (fences, walls, posts)
    const col = [];
    for (const s of world.segments) col.push(s.a.x, 0.6, s.a.z, s.b.x, 0.6, s.b.z);
    for (const p of world.posts) { const n = 10; for (let k = 0; k < n; k++) { const a0 = k / n * Math.PI * 2, a1 = (k + 1) / n * Math.PI * 2; const y = world.heightAt(p.p.x, p.p.z) + 0.5; col.push(p.p.x + p.r * Math.cos(a0), y, p.p.z + p.r * Math.sin(a0), p.p.x + p.r * Math.cos(a1), y, p.p.z + p.r * Math.sin(a1)); } }
    for (const l of world.lawns) for (let i = 0; i < l.poly.length; i++) { const a = l.poly[i], b = l.poly[(i + 1) % l.poly.length]; col.push(a.x, 0.2, a.z, b.x, 0.2, b.z); }
    this.group.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(col, 3)), lineMat(0xffa020)));
    // route legs (invisible checkpoints) & one-way zones & finish
    const rt = [];
    for (const leg of Object.values(world.routeLegs)) for (let i = 0; i < leg.length - 1; i += 2) { const a = leg[i], b = leg[Math.min(i + 1, leg.length - 1)]; rt.push(a.x, world.heightAt(a.x, a.z) + 0.1, a.z, b.x, world.heightAt(b.x, b.z) + 0.1, b.z); }
    for (const o of world.course.route.oneWay) for (let i = 0; i < o.poly.length; i++) { const a = o.poly[i], b = o.poly[(i + 1) % o.poly.length]; rt.push(a.x, 0.15, a.z, b.x, 0.15, b.z); }
    const fin = world.course.route.finish; for (let k = 0; k < 24; k++) { const a0 = k / 24 * Math.PI * 2, a1 = (k + 1) / 24 * Math.PI * 2; rt.push(fin.p.x + fin.radius * Math.cos(a0), 0.1, fin.p.z + fin.radius * Math.sin(a0), fin.p.x + fin.radius * Math.cos(a1), 0.1, fin.p.z + fin.radius * Math.sin(a1)); }
    this.group.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(rt, 3)), lineMat(0x40c8ff, 0.8)));
    // dynamic: vehicle footprint, wheel contacts, mirrors
    this.carLines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * 2 * 16), 3)), lineMat(0x00ff88));
    this.group.add(this.carLines);
    this.wheelDots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff00ff, depthTest: false }), 6);
    this.wheelDots.renderOrder = 5; this.group.add(this.wheelDots);
  }
  set visible(v) { this.group.visible = v; }
  get visible() { return this.group.visible; }
  update(V) {
    if (!this.group.visible) return;
    const c = V.corners(), a = this.carLines.geometry.attributes.position;
    const y = V.y + 0.08;
    let k = 0;
    const put = (p, q) => { a.setXYZ(k++, p.x, y, p.z); a.setXYZ(k++, q.x, y, q.z); };
    for (let i = 0; i < 4; i++) put(c[i], c[(i + 1) % 4]);
    const w = V.wheels(); put(w[0], w[1]); put(w[2], w[3]);
    const fa = V.frontAxle(), ra = { x: V.x, z: V.z }; put(ra, fa);
    const fl = V.local(V.P.WHEELBASE + 3, 0); put(fa, fl);
    while (k < a.count) a.setXYZ(k++, 0, -10, 0);
    a.needsUpdate = true;
    const M = new THREE.Matrix4();
    const pts = [...w, ...V.mirrorPoints()];
    pts.forEach((p, i) => { M.makeTranslation(p.x, V.y + 0.12, p.z); this.wheelDots.setMatrixAt(i, M); });
    this.wheelDots.instanceMatrix.needsUpdate = true;
  }
}
