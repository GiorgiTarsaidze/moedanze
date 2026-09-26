// Shared helpers for examination elements: marking primitives, geometric tests on the real vehicle
// footprint / tyre contact points, and small trackers (standstill, direction changes).

import { makeFrame, toLocal, toWorld, pointSegDist, wrapAngle, headingOf, dist, fromAngle } from '../math2d.js';

export { makeFrame, toLocal, toWorld, headingOf };

// ------------------------------------------------------------------ marking primitives
export const line = (pts, width, extra = {}) => ({ type: 'line', pts, width, ...extra });
export const dashed = (pts, width, dash, gap, extra = {}) => ({ type: 'line', pts, width, dash, gap, ...extra });
export const arc = (c, r, a0, a1, width, extra = {}) => ({ type: 'arc', c, r, a0, a1, width, ...extra });
export const text = (str, at, heading, size = 0.9) => ({ type: 'text', text: str, at, heading, size });
export const arrow = (at, dir, len, bend = 0) => ({ type: 'arrow', at, dir, len, bend });
export const hatch = (poly, spacing = 0.6, angleDeg = 45, width = 0.08) => ({ type: 'hatch', poly, spacing, angle: angleDeg, width });

// Local-frame line helper: list of [a, b] pairs -> world points
export const L = (frame, pairs) => pairs.map(([a, b]) => toWorld(frame, a, b));

// ------------------------------------------------------------------ geometric tests
// Which tyres touch a painted segment (line of width w). Tyre = contact point +/- half tyre width.
export function tyreTouches(wheels, a, b, lineWidth, tyreHalfWidth = 0.1) {
  const tol = lineWidth / 2 + tyreHalfWidth;
  const hits = [];
  for (let i = 0; i < wheels.length; i++) if (pointSegDist(wheels[i], a, b) < tol) hits.push(i);
  return hits;
}

// Returns true if all points are inside the local rectangle a in [a0,a1], b in [b0,b1] (with tolerance)
export function allInsideRect(frame, pts, a0, a1, b0, b1, tol = 0) {
  return pts.every((p) => {
    const l = toLocal(frame, p);
    return l.a >= a0 - tol && l.a <= a1 + tol && l.b >= b0 - tol && l.b <= b1 + tol;
  });
}
export function anyInsideRect(frame, pts, a0, a1, b0, b1) {
  return pts.some((p) => {
    const l = toLocal(frame, p);
    return l.a >= a0 && l.a <= a1 && l.b >= b0 && l.b <= b1;
  });
}
export function fractionInsideRect(frame, pts, a0, a1, b0, b1) {
  let n = 0;
  for (const p of pts) { const l = toLocal(frame, p); if (l.a >= a0 && l.a <= a1 && l.b >= b0 && l.b <= b1) n++; }
  return n / pts.length;
}

// Car heading relative to a frame's forward direction (rad, + = rotated clockwise on the map)
export function relHeading(frame, heading) { return wrapAngle(heading - headingOf(frame)); }

// Dense body outline (corners + edge midpoints) for containment checks
export function bodyOutline(veh) {
  const c = veh.corners();
  const out = [];
  for (let i = 0; i < 4; i++) {
    const p = c[i], q = c[(i + 1) % 4];
    out.push(p, { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 });
  }
  return out;
}

// ------------------------------------------------------------------ trackers
export class StandstillTracker {
  constructor(speedThreshold = 0.05) { this.th = speedThreshold; this.t = 0; }
  update(v, dt) { this.t = Math.abs(v) < this.th ? this.t + dt : 0; return this.t; }
  get stopped() { return this.t > 0; }
}

// Counts movement direction changes and reverse engagements that actually produced motion.
export class DirectionTracker {
  constructor(minTravel = 0.12) {
    this.minTravel = minTravel;
    this.dir = 0; this.acc = 0; this.changes = 0; this.segments = [];
    this.fwd = 0; this.rev = 0;
  }
  update(v, dt) {
    const d = v * dt;
    if (d > 0) this.fwd += d; else this.rev -= d;
    const s = Math.sign(v);
    if (s === 0) return;
    if (s !== this.dir) {
      this.acc += Math.abs(d);
      if (this.acc >= this.minTravel) {
        if (this.dir !== 0) this.changes++;
        this.dir = s; this.acc = 0;
        this.segments.push(s > 0 ? 'F' : 'R');
      }
    } else this.acc = 0;
  }
  get reverseSegments() { return this.segments.filter((s) => s === 'R').length; }
  get forwardSegments() { return this.segments.filter((s) => s === 'F').length; }
}

// Track distance travelled against a selected gear direction (for "rolling" rules)
export class RollTracker {
  constructor() { this.run = 0; this.max = 0; }
  update(veh, dt) {
    const against = (veh.gear === 'D' && veh.v < 0) || (veh.gear === 'R' && veh.v > 0) || (veh.gear === 'N' && Math.abs(veh.v) > 0);
    if (against) { this.run += Math.abs(veh.v) * dt; this.max = Math.max(this.max, this.run); }
    else if (Math.abs(veh.v) > 0.05) this.run = 0;
    return this.max;
  }
}

// ------------------------------------------------------------------ evaluator base
export class ElementEvaluator {
  constructor(id, ctx) {
    this.id = id;
    this.ctx = ctx;
    this.status = 'waiting';     // waiting | active | completed | failed
    this.station = null;
    this.startTime = null;
    this.elapsed = 0;
    this.phase = 'approach';
    this.info = {};              // live info for UI / debug
    this.fired = new Set();
  }
  get rules() { return this.ctx.rules.elements[this.id].rules; }
  engage(station, time) {
    this.station = station; this.status = 'active'; this.startTime = time;
    this.ctx.onEngage?.(this);
  }
  // Apply a rule. Returns true if a penalty was recorded now.
  penalize(key, detail = '') {
    const rule = this.rules[key];
    if (!rule || rule.enabled === false) return false;
    const repeat = rule.repeatable ?? this.ctx.rules.defaultRepeatable;
    if (!repeat && this.fired.has(key)) return false;
    this.fired.add(key);
    this.ctx.penalize(this.id, key, rule, detail);
    if (rule.points === 'DQ' || rule.points === 'FAIL') this.fail(key);
    return true;
  }
  fail(reason) {
    if (this.status === 'failed' || this.status === 'completed') return;
    this.status = 'failed'; this.failReason = reason;
    this.ctx.onFinish?.(this);
  }
  complete() {
    if (this.status !== 'active') return;
    this.status = 'completed';
    this.ctx.onFinish?.(this);
  }
  // Contacts reported by the physics this tick that are new (debounced)
  newContacts(veh) { return veh.contacts.filter((c) => c.isNew); }
}

export function nearestStation(stations, p) {
  let best = null, bd = Infinity;
  for (const s of stations) { const d = dist(s.frame.o, p); if (d < bd) { bd = d; best = s; } }
  return best;
}

export { fromAngle, wrapAngle, dist };
