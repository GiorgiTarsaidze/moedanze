// Minimal 2D geometry helpers for the top-down simulation plane.
// Coordinates: x = east, z = south (same orientation as the PDF page: x right, y down).
// Heading psi: forward vector = (cos psi, sin psi). psi = 0 east, +PI/2 south, -PI/2 north.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const v2 = (x, z) => ({ x, z });
export const add = (a, b) => ({ x: a.x + b.x, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, z: a.z - b.z });
export const scale = (a, s) => ({ x: a.x * s, z: a.z * s });
export const dot = (a, b) => a.x * b.x + a.z * b.z;
export const cross = (a, b) => a.x * b.z - a.z * b.x;
export const len = (a) => Math.hypot(a.x, a.z);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const norm = (a) => { const l = len(a) || 1; return { x: a.x / l, z: a.z / l }; };
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
export const fromAngle = (psi) => ({ x: Math.cos(psi), z: Math.sin(psi) });
// Right-hand side of a direction (when facing f, right = (-f.z, f.x) in x-east/z-south coords)
export const rightOf = (f) => ({ x: -f.z, z: f.x });

export function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function pointSegDist(p, a, b) {
  const abx = b.x - a.x, abz = b.z - a.z;
  const l2 = abx * abx + abz * abz;
  let t = l2 > 0 ? ((p.x - a.x) * abx + (p.z - a.z) * abz) / l2 : 0;
  t = clamp(t, 0, 1);
  const cx = a.x + abx * t, cz = a.z + abz * t;
  return Math.hypot(p.x - cx, p.z - cz);
}

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (((a.z > p.z) !== (b.z > p.z)) && (p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x)) inside = !inside;
  }
  return inside;
}

export function segSegIntersect(p1, p2, p3, p4) {
  const d1 = cross(sub(p4, p3), sub(p1, p3));
  const d2 = cross(sub(p4, p3), sub(p2, p3));
  const d3 = cross(sub(p2, p1), sub(p3, p1));
  const d4 = cross(sub(p2, p1), sub(p4, p1));
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

// Oriented rectangle helpers --------------------------------------------------
// rect: { c: center, f: unit forward, hl: half length, hw: half width }
export function rectCorners(r) {
  const R = rightOf(r.f);
  const fx = r.f.x * r.hl, fz = r.f.z * r.hl, rx = R.x * r.hw, rz = R.z * r.hw;
  return [
    { x: r.c.x + fx - rx, z: r.c.z + fz - rz }, // front-left
    { x: r.c.x + fx + rx, z: r.c.z + fz + rz }, // front-right
    { x: r.c.x - fx + rx, z: r.c.z - fz + rz }, // rear-right
    { x: r.c.x - fx - rx, z: r.c.z - fz - rz }, // rear-left
  ];
}

// Distance from point to oriented rectangle (0 if inside)
export function pointRectDist(p, r) {
  const d = sub(p, r.c);
  const R = rightOf(r.f);
  const lf = dot(d, r.f), lr = dot(d, R);
  const ex = Math.max(Math.abs(lf) - r.hl, 0), ez = Math.max(Math.abs(lr) - r.hw, 0);
  return Math.hypot(ex, ez);
}

export function segRectIntersect(a, b, r) {
  if (pointRectDist(a, r) === 0 || pointRectDist(b, r) === 0) return true;
  const c = rectCorners(r);
  for (let i = 0; i < 4; i++) if (segSegIntersect(a, b, c[i], c[(i + 1) % 4])) return true;
  return false;
}

// Minimum distance between a segment and an oriented rectangle
export function segRectDist(a, b, r) {
  if (segRectIntersect(a, b, r)) return 0;
  const c = rectCorners(r);
  let m = Math.min(pointRectDist(a, r), pointRectDist(b, r));
  for (let i = 0; i < 4; i++) m = Math.min(m, pointSegDist(c[i], a, b));
  return m;
}

// Local frame helpers (used by exercise stations) ------------------------------
// frame: { o: origin, f: unit forward }. Local (a, b): a along f, b to the right.
export function makeFrame(o, f) {
  const F = norm(f);
  return { o, f: F, r: rightOf(F) };
}
export function toLocal(frame, p) {
  const d = sub(p, frame.o);
  return { a: dot(d, frame.f), b: dot(d, frame.r) };
}
export function toWorld(frame, a, b) {
  return { x: frame.o.x + frame.f.x * a + frame.r.x * b, z: frame.o.z + frame.f.z * a + frame.r.z * b };
}
export function headingOf(frame) { return Math.atan2(frame.f.z, frame.f.x); }

export function polygonArea(poly) {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += (poly[j].x + poly[i].x) * (poly[j].z - poly[i].z);
  return s / 2;
}

// Centripetal Catmull-Rom resampling of a polyline (for smooth route paths)
export function densify(pts, step = 0.25) {
  if (pts.length < 2) return pts.slice();
  const P = [ { x: 2 * pts[0].x - pts[1].x, z: 2 * pts[0].z - pts[1].z }, ...pts,
    { x: 2 * pts[pts.length - 1].x - pts[pts.length - 2].x, z: 2 * pts[pts.length - 1].z - pts[pts.length - 2].z } ];
  const out = [pts[0]];
  const tj = (ti, a, b) => ti + Math.pow(Math.hypot(b.x - a.x, b.z - a.z), 0.5) + 1e-9;
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
    const t0 = 0, t1 = tj(t0, p0, p1), t2 = tj(t1, p1, p2), t3 = tj(t2, p2, p3);
    const segLen = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const n = Math.max(2, Math.ceil(segLen / step));
    for (let k = 1; k <= n; k++) {
      const t = t1 + (t2 - t1) * k / n;
      const A1 = lerpT(p0, p1, t0, t1, t), A2 = lerpT(p1, p2, t1, t2, t), A3 = lerpT(p2, p3, t2, t3, t);
      const B1 = lerpT(A1, A2, t0, t2, t), B2 = lerpT(A2, A3, t1, t3, t);
      out.push(lerpT(B1, B2, t1, t2, t));
    }
  }
  return out;
}
function lerpT(a, b, ta, tb, t) {
  const u = (t - ta) / (tb - ta);
  return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u };
}
