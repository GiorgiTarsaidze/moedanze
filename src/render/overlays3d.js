// Training aids (trajectory ribbon, ghost stop position, highlighted boundaries, reference
// stickers). Training aids are hidden in Exam Mode.
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
