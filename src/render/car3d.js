// Examination car: exterior (layer 1), cockpit interior (layer 2) and mirror glass (layer 3).
// Car-local axes: +X forward from the rear-axle centre, +Y up, +Z to the right (left-hand drive).
import * as THREE from 'three';

export const LAYER = { WORLD: 0, EXTERIOR: 1, INTERIOR: 2, MIRROR: 3 };

function setLayer(obj, layer) { obj.traverse((o) => o.layers.set(layer)); }

// Box spanning two points (pillars etc.)
function beam(a, b, w, d, mat) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, d), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return m;
}
function quadMesh(pts, mat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

export function buildCar(P) {
  const car = new THREE.Group(); car.name = 'car';
  const ext = new THREE.Group(), int = new THREE.Group(), glassG = new THREE.Group();
  car.add(ext, int, glassG);
  const L = P.WHEELBASE, R = P.WHEEL_RADIUS, hw = P.CAR_WIDTH / 2, Ro = P.REAR_OVERHANG, Fo = P.FRONT_OVERHANG;

  const paint = new THREE.MeshStandardMaterial({ color: 0xe9ebec, metalness: 0.35, roughness: 0.35 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x1d2023, roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fb4c2, transparent: true, opacity: 0.14, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });

  // ---------------------------------------------------------------- body (extruded side profile)
  const s = new THREE.Shape();
  const arch = (cx, from) => { for (let i = 0; i <= 12; i++) { const t = Math.PI - (Math.PI * i) / 12; s.lineTo(cx + 0.39 * Math.cos(t), 0.31 + 0.39 * Math.sin(t)); } };
  s.moveTo(-Ro, 0.32); s.lineTo(-0.42, 0.32); arch(0); s.lineTo(L - 0.42, 0.32); arch(L);
  s.lineTo(L + Fo - 0.08, 0.33); s.lineTo(L + Fo, 0.45); s.lineTo(L + Fo - 0.01, 0.62); s.lineTo(L + Fo - 0.12, 0.76);
  s.lineTo(L + 0.35, 0.86); s.lineTo(2.10, 0.965); s.lineTo(-0.25, 0.965); s.lineTo(-0.55, 0.955); s.lineTo(-0.80, 0.90); s.lineTo(-Ro, 0.78); s.lineTo(-Ro, 0.32);
  // The cabin must stay open (the driver sits inside), so the body is built from two thin side
  // panels carrying the full profile + a nose block + a tail block.
  const sideT = 0.07;
  for (const sgn of [-1, 1]) {
    const g = new THREE.ExtrudeGeometry(s, { depth: sideT - 0.02, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.012, bevelSegments: 1, curveSegments: 4 });
    g.translate(0, 0, sgn > 0 ? hw - sideT + 0.01 : -hw + 0.01);
    const m = new THREE.Mesh(g, paint); m.castShadow = true; ext.add(m);
  }
  const block = (pts) => {
    const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: P.CAR_WIDTH - 2 * sideT + 0.02, bevelEnabled: false });
    g.translate(0, 0, -(P.CAR_WIDTH - 2 * sideT + 0.02) / 2);
    const m = new THREE.Mesh(g, paint); m.castShadow = true; ext.add(m);
  };
  block([[2.02, 0.70], [L + 0.42, 0.70], [L + 0.42, 0.33], [L + Fo - 0.08, 0.33], [L + Fo, 0.45], [L + Fo - 0.01, 0.62], [L + Fo - 0.12, 0.76], [L + 0.35, 0.86], [2.10, 0.965], [2.02, 0.965]]);
  block([[-Ro, 0.32], [-0.42, 0.32], [-0.42, 0.70], [-0.22, 0.70], [-0.22, 0.965], [-0.55, 0.955], [-0.80, 0.90], [-Ro, 0.78]]);
  // bumpers / sills
  const bump = (x, w) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, P.CAR_WIDTH + 0.02), trim); m.position.set(x, 0.40, 0); ext.add(m); };
  bump(-Ro + 0.05, 0.14); bump(L + Fo - 0.05, 0.14);

  // greenhouse: roof, pillars, glass
  const pillar = paint;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.045, 1.34), paint); roof.position.set(0.82, 1.445, 0); roof.castShadow = true; ext.add(roof);
  for (const sgn of [-1, 1]) {
    ext.add(beam([2.08, 0.965, sgn * 0.80], [1.40, 1.43, sgn * 0.665], 0.075, 0.09, pillar));   // A
    ext.add(beam([0.97, 0.965, sgn * 0.85], [0.93, 1.43, sgn * 0.685], 0.09, 0.07, pillar));   // B
    ext.add(beam([-0.26, 0.955, sgn * 0.80], [0.26, 1.43, sgn * 0.665], 0.28, 0.08, pillar));  // C
    ext.add(beam([1.40, 1.43, sgn * 0.665], [0.26, 1.43, sgn * 0.665], 0.05, 0.06, pillar));   // roof rail
  }
  const gl = [];
  gl.push(quadMesh([[2.07, 0.97, -0.78], [2.07, 0.97, 0.78], [1.41, 1.425, 0.64], [1.41, 1.425, -0.64]], glass));
  gl.push(quadMesh([[-0.25, 0.96, 0.76], [-0.25, 0.96, -0.76], [0.25, 1.425, -0.64], [0.25, 1.425, 0.64]], glass));
  for (const sgn of [-1, 1]) {
    const z0 = sgn * 0.855, z1 = sgn * 0.69;
    gl.push(quadMesh([[2.02, 0.975, z0], [0.99, 0.975, z0], [0.95, 1.40, z1], [1.42, 1.40, z1]], glass));
    gl.push(quadMesh([[0.93, 0.975, z0], [-0.12, 0.97, z0], [0.30, 1.40, z1], [0.91, 1.40, z1]], glass));
  }
  for (const g of gl) ext.add(g);

  // lights
  const lamp = (color, emissive) => new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 0, roughness: 0.3 });
  const mk = (mat, x, y, z, w, h, d) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); ext.add(m); return m; };
  const head = lamp(0xf4f6f8, 0xffffff); head.emissiveIntensity = 0.15;
  mk(head, L + Fo - 0.07, 0.66, -0.58, 0.1, 0.1, 0.34); mk(head, L + Fo - 0.07, 0.66, 0.58, 0.1, 0.1, 0.34);
  const indL = lamp(0xcc8a2a, 0xffa31a), indR = lamp(0xcc8a2a, 0xffa31a);
  const brake = lamp(0x7a1612, 0xff2010), rev = lamp(0xdddddd, 0xffffff);
  mk(indL, L + Fo - 0.08, 0.64, -0.80, 0.08, 0.07, 0.12); mk(indR, L + Fo - 0.08, 0.64, 0.80, 0.08, 0.07, 0.12);
  mk(indL, -Ro + 0.02, 0.74, -0.76, 0.06, 0.07, 0.14); mk(indR, -Ro + 0.02, 0.74, 0.76, 0.06, 0.07, 0.14);
  mk(brake, -Ro + 0.02, 0.84, -0.64, 0.06, 0.09, 0.3); mk(brake, -Ro + 0.02, 0.84, 0.64, 0.06, 0.09, 0.3);
  mk(rev, -Ro + 0.02, 0.74, -0.52, 0.06, 0.06, 0.1); mk(rev, -Ro + 0.02, 0.74, 0.52, 0.06, 0.06, 0.1);

  // side mirrors (housings on the exterior, glass on the mirror layer)
  const M = P.MIRRORS;
  const mirrorGlass = {};
  const mkGlass = (name, w, h) => {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); // mirror image
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    m.name = name; mirrorGlass[name] = m; glassG.add(m); return m;
  };
  const eyeV = new THREE.Vector3(P.EYE.x, P.EYE.y, P.EYE.z);
  // mirror assembly: group oriented towards the driver's eye; glass in front, housing behind
  const mirrorAssembly = (name, pos, w, h, depth, parentExt) => {
    const grp = new THREE.Group(); grp.position.copy(pos);
    grp.lookAt(eyeV);                       // +Z towards the eye, no roll (car is at the origin while building)
    const housing = new THREE.Mesh(new THREE.BoxGeometry(w + 0.035, h + 0.035, depth), trim);
    housing.position.z = -depth / 2 - 0.004; grp.add(housing);
    (parentExt ? ext : int).add(grp);
    const g = mkGlass(name, w, h);
    g.position.copy(pos); g.quaternion.copy(grp.quaternion);
    return grp;
  };
  for (const side of ['left', 'right']) {
    const sgn = side === 'left' ? -1 : 1, m = M[side];
    const hz = sgn * (P.MIRROR_WIDTH / 2 - 0.1);
    const grp = mirrorAssembly(side, new THREE.Vector3(m.x, m.y, hz), m.w, m.h, 0.09, true);
    // arm from the door top to the back of the housing, so it never covers the glass from the eye
    grp.updateMatrixWorld();
    const armEnd = grp.localToWorld(new THREE.Vector3(0, -0.05, -0.07));
    const arm = beam([m.x + 0.04, 0.94, sgn * 0.85], armEnd.toArray(), 0.04, 0.04, trim); ext.add(arm);
    const rep = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.08), side === 'left' ? indL : indR); rep.position.set(m.x + 0.1, m.y - 0.07, hz + sgn * 0.05); ext.add(rep);
  }
  {
    const m = M.rear;
    mirrorAssembly('rear', new THREE.Vector3(m.x, m.y, m.z), m.w, m.h, 0.03, false);
    int.add(beam([m.x + 0.02, m.y + 0.03, m.z], [m.x + 0.1, 1.42, 0], 0.02, 0.02, trim));
  }

  // ---------------------------------------------------------------- wheels
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xa7adb2, metalness: 0.7, roughness: 0.35 });
  const wheels = [];
  const makeWheel = (x, z) => {
    const pivot = new THREE.Group(); pivot.position.set(x, R, z);
    const spin = new THREE.Group(); pivot.add(spin);
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(R, R, P.TIRE_WIDTH, 28), tyreMat); tyre.rotation.x = Math.PI / 2; tyre.castShadow = true; spin.add(tyre);
    const out = Math.sign(z);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 20), rimMat); rim.rotation.x = Math.PI / 2; rim.position.z = out * (P.TIRE_WIDTH / 2 + 0.005); spin.add(rim);
    for (let k = 0; k < 5; k++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.18, 0.02), trim);
      const a = (k / 5) * Math.PI * 2; sp.position.set(Math.cos(a) * 0.1, Math.sin(a) * 0.1, out * (P.TIRE_WIDTH / 2 + 0.016)); sp.rotation.z = a - Math.PI / 2; spin.add(sp);
    }
    ext.add(pivot); wheels.push({ pivot, spin });
  };
  makeWheel(L, -P.TRACK / 2); makeWheel(L, P.TRACK / 2); makeWheel(0, -P.TRACK / 2); makeWheel(0, P.TRACK / 2);

  // ---------------------------------------------------------------- interior
  const dash = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.85 });
  const dash2 = new THREE.MeshStandardMaterial({ color: 0x3b3f44, roughness: 0.8 });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x33373c, roughness: 0.95 });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); int.add(m); return m; };
  add(new THREE.BoxGeometry(0.42, 0.3, 1.64), dash, 2.07, 0.78, 0);                          // dashboard body
  add(new THREE.BoxGeometry(0.4, 0.04, 1.66), dash2, 2.1, 0.945, 0, 0, 0, -0.18);             // dash top
  add(new THREE.BoxGeometry(0.14, 0.14, 0.42), dash, 1.975, 1.0, -0.36, 0, 0, 0);               // cluster binnacle
  add(new THREE.BoxGeometry(0.17, 0.025, 0.44), dash, 1.95, 1.085, -0.36, 0, 0, -0.12);        // binnacle hood
  add(new THREE.BoxGeometry(0.6, 0.3, 0.24), dash, 1.55, 0.46, 0);                            // centre console
  add(new THREE.BoxGeometry(0.2, 0.2, 0.3), dash2, 1.95, 0.72, 0);                            // centre stack
  add(new THREE.BoxGeometry(2.6, 0.04, 1.66), dash, 0.85, 0.28, 0);                           // floor
  add(new THREE.BoxGeometry(0.3, 0.04, 1.5), dash2, -0.45, 0.95, 0);                          // parcel shelf
  for (const sgn of [-1, 1]) {
    add(new THREE.BoxGeometry(2.35, 0.6, 0.04), dash2, 0.87, 0.66, sgn * 0.835);              // door panels
    add(new THREE.BoxGeometry(2.35, 0.05, 0.08), dash, 0.87, 0.955, sgn * 0.815);             // window sill
    add(new THREE.BoxGeometry(0.5, 0.13, 0.5), seatMat, 1.0, 0.46, sgn * 0.36);               // seats
    add(new THREE.BoxGeometry(0.12, 0.66, 0.5), seatMat, 0.7, 0.82, sgn * 0.36, 0, 0, 0.2);
    add(new THREE.BoxGeometry(0.1, 0.16, 0.28), seatMat, 0.62, 1.24, sgn * 0.36, 0, 0, 0.2);
  }
  add(new THREE.BoxGeometry(0.5, 0.13, 1.3), seatMat, 0.05, 0.46, 0);                          // rear bench
  add(new THREE.BoxGeometry(0.12, 0.6, 1.3), seatMat, -0.22, 0.8, 0, 0, 0, 0.18);
  const headliner = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.01, 1.3), new THREE.MeshStandardMaterial({ color: 0x8d8a84, roughness: 1 }));
  headliner.position.set(0.82, 1.418, 0); int.add(headliner);

  // steering wheel
  const sw = new THREE.Group(); sw.position.set(1.66, 0.93, P.EYE.z);
  const tilt = new THREE.Group(); tilt.rotation.z = -22 * Math.PI / 180; sw.add(tilt);
  const yaw = new THREE.Group(); yaw.rotation.y = -Math.PI / 2; tilt.add(yaw);
  const spinW = new THREE.Group(); yaw.add(spinW);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x151719, roughness: 0.7 });
  spinW.add(new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.017, 10, 44), wheelMat));
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.07, 0.06, 20), wheelMat); hub.rotation.x = Math.PI / 2; hub.position.z = 0.02; spinW.add(hub);
  for (const a of [0, Math.PI, -Math.PI / 2]) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.03, 0.02), wheelMat); sp.position.set(Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0.01); sp.rotation.z = a; spinW.add(sp); }
  const topMark = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.022, 0.04), new THREE.MeshStandardMaterial({ color: 0xc8a13a, roughness: 0.5 }));
  topMark.position.set(0, 0.18, 0); spinW.add(topMark);
  int.add(sw);
  int.add(beam([1.97, 0.80, P.EYE.z], [1.70, 0.915, P.EYE.z], 0.06, 0.06, dash));             // column

  // instrument cluster & gear display (canvas textures)
  const clusterCanvas = document.createElement('canvas'); clusterCanvas.width = 512; clusterCanvas.height = 208;
  const clusterTex = new THREE.CanvasTexture(clusterCanvas); clusterTex.colorSpace = THREE.SRGBColorSpace; clusterTex.anisotropy = 4;
  const cluster = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.114), new THREE.MeshBasicMaterial({ map: clusterTex, toneMapped: false }));
  cluster.position.set(1.897, 1.02, P.EYE.z);
  cluster.lookAt(new THREE.Vector3(P.EYE.x, P.EYE.y, P.EYE.z).add(new THREE.Vector3(0, 0.0, 0)));
  int.add(cluster);
  const gearCanvas = document.createElement('canvas'); gearCanvas.width = 128; gearCanvas.height = 256;
  const gearTex = new THREE.CanvasTexture(gearCanvas); gearTex.colorSpace = THREE.SRGBColorSpace;
  const gearPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.14), new THREE.MeshBasicMaterial({ map: gearTex, toneMapped: false }));
  gearPlate.rotation.set(-Math.PI / 2, 0, -Math.PI / 2); gearPlate.position.set(1.55, 0.615, 0.06); int.add(gearPlate);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), wheelMat); knob.position.set(1.55, 0.7, -0.03); int.add(knob);
  int.add(beam([1.55, 0.61, -0.03], [1.55, 0.68, -0.03], 0.02, 0.02, trim));

  setLayer(ext, LAYER.EXTERIOR); setLayer(int, LAYER.INTERIOR); setLayer(glassG, LAYER.MIRROR);

  let lastDash = -1;
  return {
    group: car, ext, int, wheels, steeringWheel: spinW, mirrorGlass, knob,
    lights: { indL, indR, brake, rev },
    update(V, t) {
      car.position.set(V.x, V.y, V.z);
      car.rotation.set(V.roll, -V.heading, V.pitch, 'YZX');
      const wa = V.wheelAngles();
      wheels[0].pivot.rotation.y = -wa.left; wheels[1].pivot.rotation.y = -wa.right;
      for (const w of wheels) w.spin.rotation.z = -V.wheelSpin;
      spinW.rotation.z = -V.steerWheel;
      const blink = (t % 0.66) < 0.36;
      indL.emissiveIntensity = V.indicatorActive('left') && blink ? 2.2 : 0;
      indR.emissiveIntensity = V.indicatorActive('right') && blink ? 2.2 : 0;
      brake.emissiveIntensity = V.brake > 0.05 ? 2.0 : 0.25;
      rev.emissiveIntensity = V.gear === 'R' ? 1.6 : 0;
      const gx = { P: -0.05, R: -0.02, N: 0.01, D: 0.04 }[V.gear];
      knob.position.x = 1.55 - gx;
      if (t - lastDash > 1 / 15) { lastDash = t; drawCluster(clusterCanvas, V, blink); clusterTex.needsUpdate = true; drawGear(gearCanvas, V.gear); gearTex.needsUpdate = true; }
      return blink;
    },
  };
}

function drawCluster(c, V, blink) {
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  g.fillStyle = '#07090b'; g.fillRect(0, 0, W, H);
  // speed dial (0-140 km/h)
  const cx = 150, cy = 118, r = 86;
  g.lineWidth = 3; g.strokeStyle = '#3d4750';
  g.beginPath(); g.arc(cx, cy, r, Math.PI * 0.8, Math.PI * 2.2); g.stroke();
  g.fillStyle = '#c9d2d8'; g.font = '600 13px Barlow, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let v = 0; v <= 140; v += 20) {
    const a = Math.PI * 0.8 + (v / 140) * Math.PI * 1.4;
    g.strokeStyle = '#9aa6ae'; g.beginPath(); g.moveTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4)); g.lineTo(cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14)); g.stroke();
    g.fillText(String(v), cx + Math.cos(a) * (r - 28), cy + Math.sin(a) * (r - 28));
  }
  const kmh = V.speedKmh;
  const a = Math.PI * 0.8 + Math.min(kmh, 140) / 140 * Math.PI * 1.4;
  g.strokeStyle = '#ff5a36'; g.lineWidth = 4; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * (r - 10), cy + Math.sin(a) * (r - 10)); g.stroke();
  g.fillStyle = '#fff'; g.font = '700 30px Barlow, sans-serif'; g.fillText(kmh.toFixed(0), cx, cy + 44);
  g.font = '500 12px Barlow, sans-serif'; g.fillStyle = '#8b98a1'; g.fillText('კმ/სთ', cx, cy + 66);
  // gear
  const gears = ['P', 'R', 'N', 'D'];
  g.font = '700 30px Barlow, sans-serif';
  gears.forEach((gr, i) => { g.fillStyle = gr === V.gear ? '#ffd24a' : '#3d464e'; g.fillText(gr, 300 + i * 40, 104); });
  // indicators
  const arrow = (x, dir, on) => {
    g.fillStyle = on ? '#35e06a' : '#1b2a20';
    g.beginPath(); g.moveTo(x + dir * 22, 40); g.lineTo(x, 22); g.lineTo(x, 32); g.lineTo(x - dir * 16, 32); g.lineTo(x - dir * 16, 48); g.lineTo(x, 48); g.lineTo(x, 58); g.closePath(); g.fill();
  };
  arrow(300, -1, V.indicatorActive('left') && blink);
  arrow(440, 1, V.indicatorActive('right') && blink);
  // parking brake
  g.lineWidth = 3; g.strokeStyle = V.parkingBrake ? '#ff3b30' : '#2a1614'; g.fillStyle = g.strokeStyle;
  g.beginPath(); g.arc(370, 160, 20, 0, Math.PI * 2); g.stroke();
  g.font = '700 20px Barlow, sans-serif'; g.fillText('P', 370, 161);
  g.beginPath(); g.arc(370, 160, 27, -0.7, 0.7); g.stroke(); g.beginPath(); g.arc(370, 160, 27, Math.PI - 0.7, Math.PI + 0.7); g.stroke();
  // engine
  g.fillStyle = V.engineOn ? '#2a2410' : '#ffb020'; g.font = '700 14px Barlow, sans-serif'; g.fillText('ძრავი', 460, 160);
  g.fillStyle = '#5c6a73'; g.font = '500 13px Barlow, sans-serif'; g.fillText(`${(V.odometer / 1000).toFixed(2)} კმ`, 300, 190);
}

function drawGear(c, gear) {
  const g = c.getContext('2d');
  g.fillStyle = '#101214'; g.fillRect(0, 0, c.width, c.height);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 44px Barlow, sans-serif';
  ['P', 'R', 'N', 'D'].forEach((gr, i) => { g.fillStyle = gr === gear ? '#ffd24a' : '#525a60'; g.fillText(gr, 64, 36 + i * 60); });
}
