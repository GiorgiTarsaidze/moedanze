// Driver eye & mirror camera geometry shared by the renderer (actual mirror cameras) and the
// training system (reference stickers). Pure math, no three.js, so it can run headless.
//
// Car-local 3D axes: a = forward (from rear axle), y = up, b = right.

import { VEHICLE } from '../config/vehicle.js';

const DEG = Math.PI / 180;

function normalize3(v) { const l = Math.hypot(v.a, v.y, v.b) || 1; return { a: v.a / l, y: v.y / l, b: v.b / l }; }
function cross3(p, q) { // in (a, y, b) handedness matching world (x, y, z) with a->x, b->z
  return { a: p.y * q.b - p.b * q.y, y: p.b * q.a - p.a * q.b, b: p.a * q.y - p.y * q.a };
}
function dot3(p, q) { return p.a * q.a + p.y * q.y + p.b * q.b; }

// Mirror "camera" in car-local space: position, viewing direction, fov, aspect.
export function mirrorCamera(which, opts = {}, P = VEHICLE) {
  const m = P.MIRRORS[which];
  if (which === 'rear') {
    // interior mirror: virtual camera placed at the rear window looking straight back
    return { pos: { a: -0.35, y: 1.28, b: 0 }, dir: normalize3({ a: -1, y: -0.06, b: 0 }), fov: m.fov, aspect: m.w / m.h };
  }
  const side = which === 'left' ? -1 : 1;
  const pitch = (m.pitch + (opts.reverse && m.reverseDipDeg ? m.reverseDipDeg : 0)) * DEG;
  const yaw = m.yaw * DEG;
  const dir = normalize3({ a: -Math.cos(yaw) * Math.cos(pitch), y: -Math.sin(pitch), b: side * Math.sin(yaw) * Math.cos(pitch) });
  return { pos: { a: m.x - 0.01, y: m.y, b: side * (P.MIRROR_WIDTH / 2 - 0.1) }, dir, fov: m.fov, aspect: m.w / m.h };
}

// Project a car-local 3D point into a camera. Returns u,v in [0,1] (camera image, not mirrored),
// plus `inFront` and `inside` flags.
export function projectLocal(cam, p) {
  const d = { a: p.a - cam.pos.a, y: p.y - cam.pos.y, b: p.b - cam.pos.b };
  const f = cam.dir;
  const worldUp = { a: 0, y: 1, b: 0 };
  // camera right = f x up (in (a,y,b) mapped to (x,y,z) right-handed)
  const r = normalize3(cross3(f, worldUp));
  const u = cross3(r, f);
  const zc = dot3(d, f);
  if (zc <= 0.01) return { inFront: false, inside: false, u: 0, v: 0 };
  const xc = dot3(d, r), yc = dot3(d, u);
  const th = Math.tan((cam.fov * DEG) / 2);
  const nx = xc / (zc * th * cam.aspect), ny = yc / (zc * th);
  const uu = (nx + 1) / 2, vv = (1 - ny) / 2;
  return { inFront: true, inside: uu >= 0 && uu <= 1 && vv >= 0 && vv <= 1, u: uu, v: vv };
}

// World (x,y,z) -> car-local (a,y,b) for a vehicle pose (ignores pitch/roll, fine for references)
export function worldToLocal(pose, p) {
  const dx = p.x - pose.x, dz = p.z - pose.z;
  const c = Math.cos(pose.heading), s = Math.sin(pose.heading);
  return { a: c * dx + s * dz, y: (p.y ?? 0) - (pose.y ?? 0), b: -s * dx + c * dz };
}

export function eyeLocal(P = VEHICLE) { return { a: P.EYE.x, y: P.EYE.y, b: P.EYE.z }; }

// Direction from the driver's eye to a local point, as yaw (+ right) / pitch (+ up) in radians.
export function eyeBearing(p, P = VEHICLE) {
  const e = eyeLocal(P);
  const d = { a: p.a - e.a, y: p.y - e.y, b: p.b - e.b };
  return { yaw: Math.atan2(d.b, d.a), pitch: Math.atan2(d.y, Math.hypot(d.a, d.b)) };
}

// Which view shows a target best at a given pose. Mirrors are preferred for targets behind the
// driver (that is how parking references are taught), windows/windscreen otherwise.
export function locateTarget(pose, target, opts = {}, P = VEHICLE) {
  const pl = worldToLocal(pose, target);
  const order = opts.views || ['right', 'left', 'rear'];
  for (const w of order) {
    if (!['left', 'right', 'rear'].includes(w)) continue;
    const cam = mirrorCamera(w, opts, P);
    const pr = projectLocal(cam, pl);
    // shrink the usable area slightly so the sticker is not on the very edge
    if (pr.inFront && pr.u > 0.04 && pr.u < 0.96 && pr.v > 0.05 && pr.v < 0.95) {
      return { view: w, u: 1 - pr.u, v: pr.v, local: pl };   // u mirrored for display
    }
  }
  const b = eyeBearing(pl, P);
  return { view: 'eye', yaw: b.yaw, pitch: b.pitch, local: pl };
}
