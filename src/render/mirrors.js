// Real rendered mirrors: one render target + camera per mirror, positioned from the shared optics
// model (src/sim/optics.js) so training reference stickers match what the mirrors show.
import * as THREE from 'three';
import { mirrorCamera } from '../sim/optics.js';
import { LAYER } from './car3d.js';

export class Mirrors {
  constructor(renderer, carGroup, glassMeshes, P, quality = 1) {
    this.renderer = renderer; this.P = P; this.glass = glassMeshes;
    this.cams = {}; this.targets = {};
    this.carGroup = carGroup;
    this.setQuality(quality);
    for (const w of ['left', 'right', 'rear']) {
      const def = mirrorCamera(w, {}, P);
      const cam = new THREE.PerspectiveCamera(def.fov, def.aspect, 0.1, 450);
      cam.layers.set(LAYER.WORLD); cam.layers.enable(LAYER.EXTERIOR);
      carGroup.add(cam);
      this.cams[w] = cam;
      this.pose(w, false);
    }
    this.reverse = false;
  }

  setQuality(q) {
    const sizes = { left: [300, 182], right: [300, 182], rear: [520, 150] };
    for (const [w, [x, y]] of Object.entries(sizes)) {
      this.targets[w]?.dispose();
      const rt = new THREE.WebGLRenderTarget(Math.round(x * q), Math.round(y * q), { samples: q >= 1 ? 2 : 0 });
      this.targets[w] = rt;
      this.glass[w].material.map = rt.texture; this.glass[w].material.needsUpdate = true;
    }
  }

  pose(w, reverse) {
    const def = mirrorCamera(w, { reverse }, this.P);
    const cam = this.cams[w];
    const pos = new THREE.Vector3(def.pos.a, def.pos.y, def.pos.b);
    const dir = new THREE.Vector3(def.dir.a, def.dir.y, def.dir.b);
    const m = new THREE.Matrix4().lookAt(pos, pos.clone().add(dir), new THREE.Vector3(0, 1, 0));
    cam.position.copy(pos);
    cam.quaternion.setFromRotationMatrix(m);
  }

  render(scene, vehicle) {
    const rev = vehicle.gear === 'R';
    if (rev !== this.reverse) { this.reverse = rev; this.pose('right', rev); }
    const r = this.renderer;
    const prev = r.getRenderTarget();
    for (const w of ['left', 'right', 'rear']) {
      r.setRenderTarget(this.targets[w]);
      r.render(scene, this.cams[w]);
    }
    r.setRenderTarget(prev);
  }
}
