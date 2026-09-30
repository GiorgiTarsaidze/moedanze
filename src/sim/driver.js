// Path tracking and an automated driver that turns coach actions into the SAME control inputs a
// player produces (steering-wheel target at the human hand rate, pedals, gear selector, parking
// brake). Used by the automated tests and the optional "demo" in training mode.
// It never moves the car directly — all motion goes through the vehicle physics.

import { toLocal, wrapAngle, clamp, dot, sub, rightOf, fromAngle } from './math2d.js';

export class PathTracker {
  constructor(pts) { this.setPath(pts); }
  setPath(pts) {
    this.pts = pts; this.idx = 0;
    const n = pts.length;
    this.s = new Float64Array(n); this.th = new Float64Array(n); this.k = new Float64Array(n);
    for (let i = 1; i < n; i++) this.s[i] = this.s[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      this.th[i] = Math.atan2(b.z - a.z, b.x - a.x);
    }
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 3), i1 = Math.min(n - 1, i + 3);
      const ds = this.s[i1] - this.s[i0];
      this.k[i] = ds > 1e-6 ? wrapAngle(this.th[i1] - this.th[i0]) / ds : 0;
    }
  }
  nearest(p, window = 48) {
    let best = this.idx, bd = Infinity;
    const global = !this.acquired;
    this.acquired = true;
    const lo = global ? 0 : Math.max(0, this.idx - 8), hi = global ? this.pts.length - 1 : Math.min(this.pts.length - 1, this.idx + window);
    for (let i = lo; i <= hi; i++) {
      const d = (this.pts[i].x - p.x) ** 2 + (this.pts[i].z - p.z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    this.idx = best;
    return best;
  }
  remaining() { return this.s[this.s.length - 1] - this.s[this.idx]; }
  // curvature command for the rear axle (forward motion)
  command(veh, ahead = 1.0) {
    const p = { x: veh.x, z: veh.z };
    const i = this.nearest(p);
    const q = this.pts[i];
    const d = fromAngle(this.th[i]);
    const e = clamp(dot(sub(p, q), rightOf(d)), -1.2, 1.2);  // + = rear axle right of path
    const eh = wrapAngle(veh.heading - this.th[i]);
    // feed-forward: mean path curvature over a window ahead (anticipates the steering-rate limit)
    let j = i, sum = 0, n = 0;
    while (j < this.pts.length - 1 && this.s[j] - this.s[i] < ahead + 1.2) { if (this.s[j] - this.s[i] >= ahead - 0.6) { sum += this.k[j]; n++; } j++; }
    const kff = n ? sum / n : this.k[i];
    return clamp(kff - 0.45 * e - 1.3 * Math.sin(eh), -1, 1);
  }
}

// Curvature command to follow a straight line in a frame at lateral offset b (forward motion)
export function lineCommand(veh, frame, b) {
  const l = toLocal(frame, { x: veh.x, z: veh.z });
  const e = clamp(l.b - b, -1.2, 1.2);
  const eh = wrapAngle(veh.heading - Math.atan2(frame.f.z, frame.f.x));
  return clamp(-0.45 * e - 1.3 * Math.sin(eh), -1, 1);
}

export class AutoDriver {
  constructor(vehicle) {
    this.V = vehicle;
    this.tracker = null; this.trackerPath = null;
  }
  curvatureToSteer(k) {
    const V = this.V;
    const delta = Math.atan(k * V.P.WHEELBASE);
    return clamp(delta / V.P.MAX_STEERING_ANGLE, -1, 1);
  }
  // Returns the input object for vehicle.step and performs discrete actions (gear, brake, lights)
  drive(action, dt) {
    const V = this.V;
    const input = { steerTarget: 0, throttle: 0, brake: 1 };
    if (!action) return input;
    const still = Math.abs(V.v) < 0.03;

    // discrete controls
    if (action.handbrake !== undefined && V.parkingBrake !== action.handbrake && (still || !action.handbrake)) V.parkingBrake = action.handbrake;
    let gearOk = true;
    if (action.gear && V.gear !== action.gear) {
      gearOk = false;
      if (still) gearOk = V.requestGear(action.gear);
    }

    // steering
    if (action.steer !== undefined && action.steer !== null) input.steerTarget = action.steer;
    else if (action.path) {
      if (this.trackerPath !== action.path) { this.tracker = new PathTracker(action.path); this.trackerPath = action.path; }
      input.steerTarget = this.curvatureToSteer(this.tracker.command(V, action.lookahead ?? 1.0 + Math.abs(V.v) * 0.5));
    } else if (action.track) {
      input.steerTarget = this.curvatureToSteer(lineCommand(V, action.track.frame, action.track.b));
    } else input.steerTarget = V.steerWheel / V.D.MAX_STEERING_WHEEL_ANGLE;

    // pedals
    if (action.throttle !== undefined) { input.throttle = action.throttle; input.brake = 0; return input; }
    if (action.stop || !gearOk || !(action.speed > 0)) { input.throttle = 0; input.brake = Math.abs(V.v) > 0.4 ? 0.7 : 1; return input; }
    // wait for the wheel to reach a commanded full lock before moving (dry steering)
    if (action.steer !== undefined && Math.abs(action.steer * V.D.MAX_STEERING_WHEEL_ANGLE - V.steerWheel) > 0.15 && still) {
      input.brake = 1; return input;
    }
    const dir = V.gear === 'R' ? -1 : 1;
    const vDir = V.v * dir;
    const aDes = clamp(2.2 * (action.speed - vDir), -3, 1.2);
    const P = V.P, m = P.MASS;
    const vCreep = dir > 0 ? P.CREEP_SPEED_D : P.CREEP_SPEED_R;
    const creep = V.engineOn ? P.CREEP_FORCE * clamp(1 - vDir / vCreep, 0, 1) : 0;
    const engineBrake = V.engineOn ? P.ENGINE_BRAKE_FORCE * clamp((vDir - vCreep) / P.ENGINE_BRAKE_SPAN, 0, 1) : 0;
    const grav = -m * P.GRAVITY * Math.sin(V.pitch) * dir;
    const roll = P.ROLLING_RESISTANCE * m * P.GRAVITY * (vDir > 0.02 ? 1 : 0);
    const need = m * aDes - (creep - engineBrake + grav - roll);
    if (need > 0) { input.throttle = clamp(need / P.MAX_DRIVE_FORCE, 0, 1); input.brake = 0; }
    else { input.throttle = 0; input.brake = clamp(-need / P.MAX_BRAKE_FORCE, 0, 1); }
    return input;
  }
}
