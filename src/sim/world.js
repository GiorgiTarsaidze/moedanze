// Compiles a course definition into a simulation world: element geometry, static colliders
// (posts, fences, ramp walls, kerbed lawns), terrain height and aggregated road markings.

import { EXERCISES } from './exercises/index.js';
import { pointRectDist, segRectDist, pointInPolygon, pointSegDist, toLocal, densify } from './math2d.js';

function aabb(pts, pad = 0) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
  return { x0: x0 - pad, z0: z0 - pad, x1: x1 + pad, z1: z1 + pad };
}
const inBox = (b, p) => p.x >= b.x0 && p.x <= b.x1 && p.z >= b.z0 && p.z <= b.z1;
const boxOverlap = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.z0 <= b.z1 && a.z1 >= b.z0;

export class World {
  constructor(course) {
    this.course = course;
    this.dims = course.dims;
    this.elements = {};
    this.posts = [];
    this.segments = [];
    this.ramps = [];
    this.markings = [];
    this.contactMemory = new Map();

    for (const [id, def] of Object.entries(EXERCISES)) {
      const stations = (course.elements[id]?.stations || []).map((st) => def.module.buildStation(st, course.dims));
      this.elements[id] = { id, number: def.number, stations };
      for (const s of stations) {
        for (const p of s.posts || []) this.posts.push({ ...p, r: course.dims.POST_RADIUS, owner: id, station: s.id, label: p.name || 'ჯოხი' });
        for (const w of s.walls || []) this.segments.push({ a: w.a, b: w.b, t: 0.12, owner: id, id: `${id}-${s.id}-wall-${this.segments.length}`, label: w.name, kind: 'wall' });
        if (s.ramp) this.ramps.push(s.ramp);
        for (const m of s.markings || []) this.markings.push({ ...m, owner: id });
      }
    }
    // course-level markings
    const M = course.markings;
    for (const pts of M.solid) this.markings.push({ type: 'line', pts, width: course.dims.LINE_WIDTH });
    for (const d of M.dashed) this.markings.push({ type: 'line', pts: d.pts, width: d.width || course.dims.LINE_WIDTH, dash: d.dash, gap: d.gap, color: d.color });
    for (const z of M.zebras) this.markings.push({ type: 'zebra', x0: z.x, z0: z.z, x1: z.x1, z1: z.z1, stripes: z.stripes });
    for (const a of M.arrows) this.markings.push({ type: 'arrow', at: a.at, dir: a.dir, len: a.len, bend: 0 });

    // fences: ground perimeter, stadium, gates
    const ring = (poly, label, kind, t = 0.06) => {
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        this.segments.push({ a, b, t, label, kind, id: `${kind}-${this.segments.length}` });
      }
    };
    ring(course.boundary, 'მოედნის ღობე', 'fence');
    ring(course.stadium.fence, 'სტადიონის ღობე', 'fence');
    for (const gt of course.gates) this.segments.push({ a: gt.a, b: gt.b, t: 0.1, label: gt.label, kind: 'gate', id: `gate-${this.segments.length}` });
    for (const s of this.segments) s.box = aabb([s.a, s.b], s.t + 0.1);
    this.posts.forEach((p) => { p.box = aabb([p.p], p.r + 0.1); });

    this.lawns = course.lawns.map((poly, i) => ({ poly, box: aabb(poly), id: `lawn-${i}` }));
    this.bounds = aabb(course.boundary);
    this.routeLegs = Object.fromEntries(Object.entries(course.route.legs).map(([k, v]) => [k, densify(v, 0.25)]));
  }

  // ------------------------------------------------------------------ terrain
  heightAt(x, z) {
    for (const r of this.ramps) {
      const l = toLocal(r.frame, { x, z });
      if (l.a > r.a0 && l.a < r.a1 && Math.abs(l.b) <= r.hw + 0.02) return r.profile(l.a);
    }
    return 0;
  }

  // ------------------------------------------------------------------ collisions
  carContacts(veh, x, z, h) {
    const out = [];
    const rect = veh.bodyRect(x, z, h);
    const box = aabb(veh.corners(x, z, h), 0.2);
    const mirrors = veh.mirrorPoints(x, z, h);
    const t = veh.time;
    const push = (c) => {
      const last = this.contactMemory.get(c.id);
      c.isNew = last === undefined || t - last > 0.35;
      this.contactMemory.set(c.id, t);
      out.push(c);
    };
    for (const p of this.posts) {
      if (!boxOverlap(box, p.box)) continue;
      if (pointRectDist(p.p, rect) < p.r || mirrors.some((m) => Math.hypot(m.x - p.p.x, m.z - p.p.z) < p.r + 0.04)) {
        push({ id: p.id, kind: 'post', label: `შეჯახება: ${p.label}`, owner: p.owner, station: p.station, solid: true, at: p.p });
      }
    }
    for (const s of this.segments) {
      if (!boxOverlap(box, s.box)) continue;
      if (segRectDist(s.a, s.b, rect) < s.t || mirrors.some((m) => pointSegDist(m, s.a, s.b) < s.t + 0.02)) {
        push({ id: s.id, kind: s.kind, label: `შეჯახება: ${s.label}`, owner: s.owner, solid: true });
      }
    }
    // tyres against kerbs of the raised lawns (inner & outer tyre edge)
    const wheels = veh.wheels(x, z, h);
    const R = { x: -Math.sin(h), z: Math.cos(h) };
    const tw = veh.P.TIRE_WIDTH / 2;
    for (const lawn of this.lawns) {
      if (!boxOverlap(box, lawn.box)) continue;
      for (let i = 0; i < 4; i++) {
        const w = wheels[i];
        const e1 = { x: w.x + R.x * tw, z: w.z + R.z * tw }, e2 = { x: w.x - R.x * tw, z: w.z - R.z * tw };
        if (pointInPolygon(e1, lawn.poly) || pointInPolygon(e2, lawn.poly)) {
          push({ id: `${lawn.id}-w${i}`, kind: 'kerb', label: 'საბურავი მოხვდა ბორდიურს', solid: true, wheel: i });
          break;
        }
      }
    }
    return out;
  }

  // Vehicle pose inside the ground?
  inside(p) { return inBox(this.bounds, p); }
}
