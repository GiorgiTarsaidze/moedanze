// Builds the 3D examination ground from the compiled simulation world (1 unit = 1 metre).
// Everything is derived from the same data the physics uses, so what you see is what is scored.
import * as THREE from 'three';
import { asphaltTexture, grassTexture, concreteTexture, fenceTexture, postTexture, windowsTexture, roadTextTexture, signTexture } from './textures.js';

const MARK_Y = 0.008;

// ---- static merging: fewer draw calls (every object is drawn up to 5x per frame: view, 3 mirrors, shadows)
// Geometry with its transform baked in, as a non-indexed copy; optional UV scale replaces texture.repeat
// so pieces that only differed by repeat can share one material.
function baked(mesh, uvScale) {
  mesh.updateMatrixWorld(true);
  const g = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(mesh.matrixWorld);
  if (uvScale && g.attributes.uv) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvScale.x, uv.getY(i) * uvScale.y); }
  return g;
}
// Vertices of one material group of a non-indexed geometry
function groupSlice(g, grp) {
  const out = new THREE.BufferGeometry();
  for (const [n, a] of Object.entries(g.attributes)) out.setAttribute(n, new THREE.BufferAttribute(a.array.slice(grp.start * a.itemSize, (grp.start + grp.count) * a.itemSize), a.itemSize));
  return out;
}
function mergeGeos(list) {
  const out = new THREE.BufferGeometry();
  for (const n of Object.keys(list[0].attributes).filter((k) => list.every((g) => g.attributes[k]))) {
    const size = list[0].attributes[n].itemSize, arr = new Float32Array(list.reduce((s, g) => s + g.attributes[n].array.length, 0));
    let o = 0; for (const g of list) { arr.set(g.attributes[n].array, o); o += g.attributes[n].array.length; }
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  }
  return out;
}
function mergedMesh(geos, material, { cast = false, receive = false } = {}) {
  const m = new THREE.Mesh(mergeGeos(geos), material); m.castShadow = cast; m.receiveShadow = receive; return m;
}

export function buildWorld3D(scene, world, opts = {}) {
  const course = world.course;
  const root = new THREE.Group();
  root.name = 'world';
  scene.add(root);

  // ------------------------------------------------------------------ lights & sky
  scene.background = new THREE.Color(0xa9c8e4);
  scene.fog = new THREE.Fog(0xb9d2e8, 160, 520);
  const hemi = new THREE.HemisphereLight(0xdfeeff, 0x6b6450, 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3dd, 2.3);
  sun.position.set(-40, 80, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -35; sc.right = 35; sc.top = 35; sc.bottom = -35; sc.near = 1; sc.far = 200;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.add(sun); scene.add(sun.target);
  const skyGeo = new THREE.SphereGeometry(700, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x4f86c6) }, bottom: { value: new THREE.Color(0xd8e6f2) } },
    vertexShader: 'varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vp; void main(){ float h = clamp(normalize(vp).y*1.6, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, h), 1.0); }',
  });
  const sky = new THREE.Mesh(skyGeo, skyMat); sky.renderOrder = -1; root.add(sky);

  // ------------------------------------------------------------------ ground
  const B = world.bounds;
  const cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2, W = B.x1 - B.x0, H = B.z1 - B.z0;
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshLambertMaterial({ color: 0x8a8a70 }));
  outer.rotation.x = -Math.PI / 2; outer.position.set(cx, -0.03, cz); outer.receiveShadow = true; root.add(outer);
  const asphaltTex = asphaltTexture(); asphaltTex.repeat.set(W / 7, H / 7);
  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.95, metalness: 0 }));
  asphalt.rotation.x = -Math.PI / 2; asphalt.position.set(cx, 0, cz); asphalt.receiveShadow = true; root.add(asphalt);
  // street outside the fence (one mesh; texture repeat baked into the UVs)
  const streets = [];
  for (const [x, z, w, h] of [[B.x0 - 9, cz, 12, H + 40], [B.x1 + 9, cz, 12, H + 40], [cx, B.z0 - 9, W + 40, 12], [cx, B.z1 + 9, W + 40, 12]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h));
    m.rotation.x = -Math.PI / 2; m.position.set(x, -0.01, z); streets.push(baked(m, { x: w / 7, y: h / 7 }));
  }
  root.add(mergedMesh(streets, new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 1, color: 0xcfcfcf }), { receive: true }));

  // ------------------------------------------------------------------ lawns with kerbs
  const grass = grassTexture(); grass.repeat.set(0.25, 0.25);
  const concrete = concreteTexture(); concrete.repeat.set(0.5, 0.5);
  const lawnMat = new THREE.MeshStandardMaterial({ map: grass, roughness: 1 });
  const kerbMat = new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.9, color: 0xdedcd4 });
  const kh = world.dims.KERB_HEIGHT;
  const lawnParts = [[], []];                                 // [tops, kerb sides] of all lawns
  for (const poly of course.lawns) {
    const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, -p.z)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: kh, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    for (const grp of g.groups) lawnParts[grp.materialIndex].push(groupSlice(g, grp));
  }
  root.add(mergedMesh(lawnParts[0], lawnMat, { receive: true }), mergedMesh(lawnParts[1], kerbMat, { receive: true }));

  // ------------------------------------------------------------------ stadium
  const st = course.stadium;
  const flatPoly = (poly, color, y, mat) => {
    const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, -p.z)));
    const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat || new THREE.MeshLambertMaterial({ color })); m.position.y = y; m.receiveShadow = true; root.add(m); return m;
  };
  flatPoly(st.fence, 0x3f6b3c, 0.02);
  flatPoly(st.details.pitch, 0x3f8f3e, 0.03);
  flatPoly(st.details.court, 0xd9773a, 0.04);
  const extrude = (poly, h, mat) => {
    const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, -p.z)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false }); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; root.add(m); return m;
  };
  const bTex = windowsTexture(5); bTex.repeat.set(0.12, 0.12);
  extrude(st.details.building, 9, [new THREE.MeshLambertMaterial({ color: 0x9a968c }), new THREE.MeshLambertMaterial({ map: bTex })]);
  extrude(st.details.stand, 3.2, new THREE.MeshLambertMaterial({ color: 0x8e9396 }));
  buildFence(root, st.fence, st.fenceHeight, true);
  buildFence(root, course.boundary, 2.2, true);

  // gates (barriers), one mesh
  const arms = course.gates.map((gt) => {
    const len = Math.hypot(gt.b.x - gt.a.x, gt.b.z - gt.a.z);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.1));
    arm.position.set((gt.a.x + gt.b.x) / 2, 1.0, (gt.a.z + gt.b.z) / 2);
    arm.rotation.y = -Math.atan2(gt.b.z - gt.a.z, gt.b.x - gt.a.x);
    return baked(arm);                                      // stripeTexture() carries repeat.x = 2 itself
  });
  if (arms.length) root.add(mergedMesh(arms, new THREE.MeshLambertMaterial({ map: stripeTexture() }), { cast: true }));

  // ------------------------------------------------------------------ ramp (hill)
  for (const r of world.ramps) root.add(buildRamp(r, concrete));

  // ------------------------------------------------------------------ road markings
  root.add(buildMarkings(world));

  // ------------------------------------------------------------------ posts
  const posts = world.posts;
  if (posts.length) {
    const r = world.dims.POST_RADIUS, h = world.dims.POST_HEIGHT;
    const pGeo = new THREE.CylinderGeometry(r, r * 1.15, h, 12); pGeo.translate(0, h / 2 + 0.04, 0);
    const bGeo = new THREE.CylinderGeometry(0.17, 0.19, 0.05, 16); bGeo.translate(0, 0.025, 0);
    const pm = new THREE.InstancedMesh(pGeo, new THREE.MeshStandardMaterial({ map: postTexture(), roughness: 0.6 }), posts.length);
    const bm = new THREE.InstancedMesh(bGeo, new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.9 }), posts.length);
    const M = new THREE.Matrix4();
    posts.forEach((p, i) => { M.makeTranslation(p.p.x, world.heightAt(p.p.x, p.p.z), p.p.z); pm.setMatrixAt(i, M); bm.setMatrixAt(i, M); });
    pm.castShadow = true; root.add(pm, bm);
  }

  // ------------------------------------------------------------------ signs
  const signPoles = [];
  for (const s of course.signs) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 8));
    pole.position.y = 1.15; g.add(pole);
    const size = s.type === 'steep' ? 0.8 : 0.72;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: signTexture(s.type, s.text, s.sub), transparent: s.type === 'steep', alphaTest: 0.1, side: THREE.DoubleSide }));
    plate.position.y = 2.1 + size / 2 - 0.3; plate.position.z = 0.05; g.add(plate);
    g.position.set(s.at.x, kh, s.at.z);
    g.rotation.y = Math.atan2(s.face.x, s.face.z);
    root.add(g);
    signPoles.push(baked(pole)); g.remove(pole);
  }
  if (signPoles.length) root.add(mergedMesh(signPoles, new THREE.MeshStandardMaterial({ color: 0x9aa0a4, metalness: 0.5, roughness: 0.4 }), { cast: true }));

  // ------------------------------------------------------------------ trees & surroundings
  const trees = course.trees;
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 2.2, 6); trunkGeo.translate(0, 1.1, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1.7, 1); crownGeo.translate(0, 3.3, 0);
  const tm = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x5d4632 }), trees.length);
  const cm = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), trees.length);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), col = new THREE.Color();
  trees.forEach((t, i) => {
    const s = 0.8 + ((i * 37) % 10) / 20;
    P.set(t.x, kh, t.z); S.set(s, s * (0.9 + (i % 3) * 0.12), s); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i);
    M.compose(P, q, S); tm.setMatrixAt(i, M); cm.setMatrixAt(i, M);
    col.setHSL(0.26 + (i % 5) * 0.012, 0.42, 0.28 + (i % 4) * 0.03); cm.setColorAt(i, col);
  });
  tm.castShadow = cm.castShadow = true; root.add(tm, cm);
  const roofs = [];
  for (const [i, b] of course.outerBuildings.entries()) {
    const t = windowsTexture(i + 9); t.repeat.set(Math.max(1, b.w / 8), Math.max(1, b.h / 8));
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d));
    m.position.set(b.x + b.w / 2, b.h / 2, b.z + b.d / 2);
    const g = baked(m);                                     // box groups: 0,1 = ±x, 2,3 = ±y (roof/bottom), 4,5 = ±z
    root.add(mergedMesh([0, 1, 4, 5].map((k) => groupSlice(g, g.groups[k])), new THREE.MeshLambertMaterial({ map: t })));
    roofs.push(groupSlice(g, g.groups[2]), groupSlice(g, g.groups[3]));
  }
  if (roofs.length) root.add(mergedMesh(roofs, new THREE.MeshLambertMaterial({ color: 0x8a857c })));

  return { root, sun, hemi,
    updateShadow(center) { sun.position.set(center.x - 40, 80, center.z + 30); sun.target.position.set(center.x, 0, center.z); sun.target.updateMatrixWorld(); } };
}

function stripeTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 8; const g = c.getContext('2d');
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#fff' : '#d22'; g.fillRect(i * 16, 0, 16, 8); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.x = 2; return t;
}

function buildFence(root, poly, h, closed) {
  const n = closed ? poly.length : poly.length - 1;
  const panels = [], posts = [];
  const postGeo = new THREE.CylinderGeometry(0.03, 0.03, h + 0.1, 6);
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(L, h));
    m.position.set((a.x + b.x) / 2, h / 2, (a.z + b.z) / 2);
    m.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
    panels.push(baked(m, { x: L / 1.2, y: h / 1.2 }));
    const np = Math.ceil(L / 3);
    for (let k = 0; k <= np; k++) {
      const p = new THREE.Mesh(postGeo);
      p.position.set(a.x + (b.x - a.x) * k / np, (h + 0.1) / 2, a.z + (b.z - a.z) * k / np); posts.push(baked(p));
    }
  }
  root.add(mergedMesh(panels, new THREE.MeshLambertMaterial({ map: fenceTexture(), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide })));
  root.add(mergedMesh(posts, new THREE.MeshLambertMaterial({ color: 0x8c9296 })));
}

function buildRamp(r, concrete) {
  const pos = [], idx = [], uv = [];
  const f = r.frame.f, rt = r.frame.r, o = r.frame.o;
  const W = (a, b) => ({ x: o.x + f.x * a + rt.x * b, z: o.z + f.z * a + rt.z * b });
  const hw = r.hw + 0.12;
  const add = (p, y, u, v) => { pos.push(p.x, y, p.z); uv.push(u, v); return pos.length / 3 - 1; };
  const step = 0.25;
  const as = [];
  for (let a = r.a0; a < r.a1; a += step) as.push(a); as.push(r.a1);
  // top surface
  for (let i = 0; i < as.length - 1; i++) {
    const a0 = as[i], a1 = as[i + 1], h0 = r.profile(a0) + 0.003, h1 = r.profile(a1) + 0.003;
    const v0 = add(W(a0, -hw), h0, a0 / 2, 0), v1 = add(W(a0, hw), h0, a0 / 2, hw), v2 = add(W(a1, hw), h1, a1 / 2, hw), v3 = add(W(a1, -hw), h1, a1 / 2, 0);
    idx.push(v0, v2, v1, v0, v3, v2);
  }
  // side walls (with a 12 cm edge upstand)
  for (const side of [-1, 1]) {
    for (let i = 0; i < as.length - 1; i++) {
      const a0 = as[i], a1 = as[i + 1];
      const h0 = r.profile(a0) + (r.profile(a0) > 0.15 ? 0.12 : 0), h1 = r.profile(a1) + (r.profile(a1) > 0.15 ? 0.12 : 0);
      const p0 = W(a0, side * hw), p1 = W(a1, side * hw);
      const v0 = add(p0, 0, a0 / 2, 0), v1 = add(p1, 0, a1 / 2, 0), v2 = add(p1, h1, a1 / 2, h1), v3 = add(p0, h0, a0 / 2, h0);
      if (side > 0) idx.push(v0, v1, v2, v0, v2, v3); else idx.push(v0, v2, v1, v0, v3, v2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: concrete, color: 0x9d9d98, roughness: 0.95, side: THREE.DoubleSide }));
  m.receiveShadow = true; m.castShadow = true;
  return m;
}

// ---------------------------------------------------------------------- markings
export function buildMarkings(world) {
  const group = new THREE.Group();
  const buckets = new Map();   // color -> {pos, idx}
  const bucket = (color = 0xf2f2ec) => { if (!buckets.has(color)) buckets.set(color, { pos: [], idx: [] }); return buckets.get(color); };
  const Y = (x, z) => world.heightAt(x, z) + MARK_Y;
  const quad = (bk, a, b, c, d) => {
    const i = bk.pos.length / 3;
    for (const p of [a, b, c, d]) bk.pos.push(p.x, Y(p.x, p.z), p.z);
    bk.idx.push(i, i + 2, i + 1, i, i + 3, i + 2);
  };
  const strip = (bk, p, q, w) => {   // straight piece p->q of width w, subdivided to follow the terrain
    const L = Math.hypot(q.x - p.x, q.z - p.z); if (L < 1e-4) return;
    const dx = (q.x - p.x) / L, dz = (q.z - p.z) / L, nx = -dz * w / 2, nz = dx * w / 2;
    const n = Math.max(1, Math.ceil(L / 0.8));
    for (let k = 0; k < n; k++) {
      const s0 = L * k / n, s1 = L * (k + 1) / n;
      const A = { x: p.x + dx * s0, z: p.z + dz * s0 }, Bq = { x: p.x + dx * s1, z: p.z + dz * s1 };
      quad(bk, { x: A.x - nx, z: A.z - nz }, { x: Bq.x - nx, z: Bq.z - nz }, { x: Bq.x + nx, z: Bq.z + nz }, { x: A.x + nx, z: A.z + nz });
    }
  };
  const polyline = (bk, pts, w, dash, gap) => {
    if (!dash) { for (let i = 0; i < pts.length - 1; i++) strip(bk, pts[i], pts[i + 1], w); return; }
    let on = true, left = dash;
    for (let i = 0; i < pts.length - 1; i++) {
      let p = pts[i]; const q = pts[i + 1];
      let L = Math.hypot(q.x - p.x, q.z - p.z);
      while (L > 1e-6) {
        const s = Math.min(left, L);
        const t = s / L; const m = { x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t };
        if (on) strip(bk, p, m, w);
        p = m; L -= s; left -= s;
        if (left <= 1e-6) { on = !on; left = on ? dash : gap; }
      }
    }
  };
  const texts = [];
  for (const mk of world.markings) {
    const bk = bucket(mk.color);
    if (mk.type === 'line') polyline(bk, mk.pts, mk.width || 0.12, mk.dash, mk.gap);
    else if (mk.type === 'arc') {
      let span = mk.a1 - mk.a0; while (span <= 0) span += Math.PI * 2;
      const n = Math.max(8, Math.ceil(span * mk.r / 0.2));
      const pts = []; for (let k = 0; k <= n; k++) { const a = mk.a0 + span * k / n; pts.push({ x: mk.c.x + mk.r * Math.cos(a), z: mk.c.z + mk.r * Math.sin(a) }); }
      polyline(bk, pts, mk.width);
    } else if (mk.type === 'zebra') {
      const th = 0.42, gp = 0.42;
      if (mk.stripes === 'x') for (let z = mk.z0 + 0.1; z + th <= mk.z1; z += th + gp) quad(bk, { x: mk.x0, z }, { x: mk.x1, z }, { x: mk.x1, z: z + th }, { x: mk.x0, z: z + th });
      else for (let x = mk.x0 + 0.1; x + th <= mk.x1; x += th + gp) quad(bk, { x, z: mk.z0 }, { x: x + th, z: mk.z0 }, { x: x + th, z: mk.z1 }, { x, z: mk.z1 });
    } else if (mk.type === 'arrow') drawArrow(bk, mk, strip, quad);
    else if (mk.type === 'hatch') drawHatch(bk, mk, strip);
    else if (mk.type === 'text') texts.push(mk);
  }
  const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  for (const [color, bk] of buckets) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(bk.pos, 3));
    g.setIndex(bk.idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat(color)); m.receiveShadow = true; group.add(m);
  }
  for (const t of texts) {
    const w = t.size * 3.2, h = t.size;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: roadTextTexture(t.text), transparent: true, alphaTest: 0.3, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    const heading = t.heading;
    m.rotation.set(-Math.PI / 2, -Math.PI / 2 - heading, 0, 'YXZ');
    m.position.set(t.at.x, world.heightAt(t.at.x, t.at.z) + MARK_Y + 0.001, t.at.z);
    m.receiveShadow = true;
    group.add(m);
  }
  return group;
}

function drawArrow(bk, mk, strip, quad) {
  const d = mk.dir, L = mk.len, p = mk.at;
  const left = { x: d.z, z: -d.x };
  let tipBase, dir = d;
  if (mk.bend) {
    const mid = { x: p.x + d.x * L * 0.55, z: p.z + d.z * L * 0.55 };
    strip(bk, p, mid, 0.15);
    const ang = 0.6 * (mk.bend < 0 ? 1 : -1);
    dir = { x: d.x * Math.cos(ang) + left.x * Math.sin(ang), z: d.z * Math.cos(ang) + left.z * Math.sin(ang) };
    tipBase = { x: mid.x + dir.x * L * 0.18, z: mid.z + dir.z * L * 0.18 };
    strip(bk, mid, tipBase, 0.15);
  } else {
    tipBase = { x: p.x + d.x * L * 0.68, z: p.z + d.z * L * 0.68 };
    strip(bk, p, tipBase, 0.15);
  }
  const lf = { x: dir.z, z: -dir.x };
  const tip = { x: tipBase.x + dir.x * L * 0.32, z: tipBase.z + dir.z * L * 0.32 };
  const hw = 0.32;
  quad(bk, { x: tipBase.x + lf.x * hw, z: tipBase.z + lf.z * hw }, tip, tip, { x: tipBase.x - lf.x * hw, z: tipBase.z - lf.z * hw });
}

function drawHatch(bk, mk, strip) {
  const poly = mk.poly;
  const ang = mk.angle * Math.PI / 180;
  const e0 = { x: poly[1].x - poly[0].x, z: poly[1].z - poly[0].z };
  const base = Math.atan2(e0.z, e0.x) + ang;
  const dir = { x: Math.cos(base), z: Math.sin(base) }, n = { x: -dir.z, z: dir.x };
  const offs = poly.map((p) => p.x * n.x + p.z * n.z);
  const lo = Math.min(...offs), hi = Math.max(...offs);
  for (let c = lo + mk.spacing / 2; c < hi; c += mk.spacing) {
    const hits = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const da = a.x * n.x + a.z * n.z - c, db = b.x * n.x + b.z * n.z - c;
      if ((da > 0) !== (db > 0)) { const t = da / (da - db); hits.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }); }
    }
    if (hits.length >= 2) strip(bk, hits[0], hits[1], mk.width);
  }
}
