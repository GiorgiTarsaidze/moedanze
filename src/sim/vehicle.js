// Low-speed vehicle model: kinematic bicycle (Ackermann) steering + longitudinal force balance
// with automatic-transmission creep, brakes, parking brake, rolling resistance, drag and gravity
// on slopes. Integrated at a fixed step by the simulation.
//
// Reference point: centre of the rear axle on the ground. At low speed tyre slip is negligible,
// so the rear axle moves along its heading and the yaw rate is v * tan(delta) / L. This makes the
// turning radius, rear-wheel cut-in and front overhang swing exactly those of the real car.

import { VEHICLE, derived } from '../config/vehicle.js';
import { fromAngle, rightOf, wrapAngle, clamp, DEG } from './math2d.js';

export const GEARS = ['P', 'R', 'N', 'D'];

export class Vehicle {
  constructor(params = VEHICLE) {
    this.P = params;
    this.D = derived(params);
    this.reset({ x: 0, z: 0 }, 0);
  }

  reset(pos, heading, opts = {}) {
    this.x = pos.x; this.z = pos.z;
    this.heading = heading;
    this.v = 0;                       // signed speed along heading (m/s), + forward
    this.steerWheel = 0;              // steering wheel angle (rad), + = right
    this.delta = 0;                   // bicycle road-wheel angle (rad)
    this.throttle = 0; this.brake = 0;
    this.gear = opts.gear ?? 'P';
    this.parkingBrake = opts.parkingBrake ?? true;
    this.engineOn = opts.engineOn ?? true;
    this.odometer = 0;                // total distance travelled (m)
    this.pitch = 0; this.roll = 0; this.y = 0;
    this.wheelSpin = 0;               // wheel rotation angle for rendering
    this.time = 0;
    this.lastShiftRefused = 0;
    this.contacts = [];               // contacts detected in the last step
    this.blocked = false;
    this.updateTerrain(null);
  }

  // ---------------------------------------------------------------- geometry
  get forward() { return fromAngle(this.heading); }
  get right() { return rightOf(this.forward); }
  get speedKmh() { return Math.abs(this.v) * 3.6; }

  // Car-local (along from rear axle, lateral to the right) -> world 2D
  local(a, b, x = this.x, z = this.z, h = this.heading) {
    const c = Math.cos(h), s = Math.sin(h);
    return { x: x + c * a - s * b, z: z + s * a + c * b };
  }

  bodyRect(x = this.x, z = this.z, h = this.heading) {
    const P = this.P;
    const along = (P.WHEELBASE + P.FRONT_OVERHANG - P.REAR_OVERHANG) / 2;
    return { c: this.local(along, 0, x, z, h), f: fromAngle(h), hl: P.CAR_LENGTH / 2, hw: P.CAR_WIDTH / 2 };
  }

  center() { return this.bodyRect().c; }
  frontBumper() { return this.local(this.P.WHEELBASE + this.P.FRONT_OVERHANG, 0); }
  rearBumper() { return this.local(-this.P.REAR_OVERHANG, 0); }
  frontAxle() { return this.local(this.P.WHEELBASE, 0); }

  // Body corners [FL, FR, RR, RL]
  corners(x = this.x, z = this.z, h = this.heading) {
    const P = this.P, hw = P.CAR_WIDTH / 2;
    return [
      this.local(P.WHEELBASE + P.FRONT_OVERHANG, -hw, x, z, h),
      this.local(P.WHEELBASE + P.FRONT_OVERHANG, hw, x, z, h),
      this.local(-P.REAR_OVERHANG, hw, x, z, h),
      this.local(-P.REAR_OVERHANG, -hw, x, z, h),
    ];
  }

  // Tyre contact points [FL, FR, RL, RR]
  wheels(x = this.x, z = this.z, h = this.heading) {
    const P = this.P, t = P.TRACK / 2;
    return [
      this.local(P.WHEELBASE, -t, x, z, h), this.local(P.WHEELBASE, t, x, z, h),
      this.local(0, -t, x, z, h), this.local(0, t, x, z, h),
    ];
  }

  mirrorPoints(x = this.x, z = this.z, h = this.heading) {
    const m = this.P.MIRRORS;
    return [this.local(m.left.x, -this.P.MIRROR_WIDTH / 2, x, z, h), this.local(m.right.x, this.P.MIRROR_WIDTH / 2, x, z, h)];
  }

  // Individual front wheel steering angles (Ackermann) for rendering
  wheelAngles() {
    const L = this.P.WHEELBASE, t = this.P.TRACK / 2;
    if (Math.abs(this.delta) < 1e-5) return { left: 0, right: 0 };
    const R = L / Math.tan(this.delta);   // signed, + = turning right
    return { left: Math.atan(L / (R + t)), right: Math.atan(L / (R - t)) };
  }

  // ---------------------------------------------------------------- controls

  requestGear(g) {
    if (!GEARS.includes(g) || g === this.gear) return true;
    const moving = Math.abs(this.v) > this.P.MAX_SHIFT_SPEED;
    const dirChange = (g === 'R' && this.v > this.P.MAX_SHIFT_SPEED) || (g === 'D' && this.v < -this.P.MAX_SHIFT_SPEED);
    if ((g === 'P' && moving) || dirChange) { this.lastShiftRefused = this.time; return false; }
    this.gear = g;
    return true;
  }

  // ---------------------------------------------------------------- terrain
  updateTerrain(world) {
    const P = this.P;
    if (!world) { this.pitch = 0; this.roll = 0; this.y = 0; this.wheelHeights = [0, 0, 0, 0]; return; }
    const w = this.wheels();
    const h = w.map((p) => world.heightAt(p.x, p.z));
    this.wheelHeights = h;
    const hf = (h[0] + h[1]) / 2, hr = (h[2] + h[3]) / 2;
    this.pitch = Math.atan2(hf - hr, P.WHEELBASE);            // + = nose up
    this.roll = Math.atan2(((h[0] + h[2]) - (h[1] + h[3])) / 2, P.TRACK); // + = left side higher
    this.y = hr;                                              // rear-axle ground height
  }

  // ---------------------------------------------------------------- simulation step
  step(dt, input, world) {
    const P = this.P;
    this.time += dt;

    // Steering wheel ------------------------------------------------------------
    const maxSW = this.D.MAX_STEERING_WHEEL_ANGLE;
    if (input.steerTarget != null) {
      // analog / automated steering: move the wheel toward the target at the maximum hand rate
      const target = clamp(input.steerTarget, -1, 1) * maxSW;
      const rate = P.STEER_RATE_DEG * DEG * dt;
      this.steerWheel += clamp(target - this.steerWheel, -rate, rate);
    } else {
      const dir = (input.steerRight ? 1 : 0) - (input.steerLeft ? 1 : 0);
      if (dir !== 0) {
        const rate = P.STEER_RATE_DEG * DEG;
        this.steerWheel += dir * rate * dt;
      } else if (input.selfCenter !== false) {
        // caster self-centring: proportional to speed, weaker in reverse
        let k = clamp(Math.abs(this.v) / P.SELF_CENTER_FULL_SPEED, 0, 1);
        if (this.v < 0) k *= P.SELF_CENTER_REVERSE_FACTOR;
        const ret = P.SELF_CENTER_RATE_DEG * DEG * k * dt;
        this.steerWheel -= clamp(this.steerWheel, -ret, ret);
      }
    }
    this.steerWheel = clamp(this.steerWheel, -maxSW, maxSW);
    this.delta = this.steerWheel / P.STEERING_RATIO;

    // Pedals (keyboard gives progressive pedal travel; analog sets it directly) ---------
    if (input.throttle != null) this.throttle = clamp(input.throttle, 0, 1);
    else this.throttle = clamp(this.throttle + (input.throttleKey ? P.THROTTLE_RISE : -P.THROTTLE_FALL) * dt, 0, 1);
    if (input.brake != null) this.brake = clamp(input.brake, 0, 1);
    else this.brake = clamp(this.brake + (input.brakeKey ? P.BRAKE_RISE : -P.BRAKE_FALL) * dt, 0, 1);
    if (input.brakeKey && input.brake == null) this.brake = Math.max(this.brake, 0.25); // immediate bite

    // Longitudinal forces ---------------------------------------------------------
    const m = P.MASS, g = P.GRAVITY;
    const v = this.v;
    let drive = 0;
    if (this.engineOn && (this.gear === 'D' || this.gear === 'R')) {
      const sgn = this.gear === 'D' ? 1 : -1;
      const vDir = v * sgn;                          // speed in the gear's direction
      const vCreep = this.gear === 'D' ? P.CREEP_SPEED_D : P.CREEP_SPEED_R;
      const creep = P.CREEP_FORCE * clamp(1 - vDir / vCreep, 0, 1);
      let thr = this.throttle * P.MAX_DRIVE_FORCE;
      if (vDir > 0.5) thr = Math.min(thr, this.throttle * P.MAX_POWER / vDir);
      if (this.gear === 'R' && vDir > P.MAX_REVERSE_SPEED) thr = 0;
      const engineBrake = P.ENGINE_BRAKE_FORCE * clamp((vDir - vCreep) / P.ENGINE_BRAKE_SPAN, 0, 1) * (1 - this.throttle);
      drive = sgn * (Math.max(creep, creep * (1 - this.throttle) + thr) - engineBrake);
    }
    const gravity = -m * g * Math.sin(this.pitch);
    const drag = -P.DRAG_COEFF * v * Math.abs(v);
    const active = drive + gravity + drag;
    let friction = P.ROLLING_RESISTANCE * m * g * Math.cos(this.pitch)
      + this.brake * P.MAX_BRAKE_FORCE
      + (this.parkingBrake ? P.PARKING_BRAKE_FORCE : 0);
    const parked = this.gear === 'P';
    let newV;
    if (parked) {
      newV = 0; // parking pawl locks the transmission
    } else if (Math.abs(v) < 0.02 && Math.abs(active) <= friction) {
      newV = 0; // static: friction holds the car
    } else {
      const dirFric = Math.abs(v) >= 0.02 ? Math.sign(v) : Math.sign(active);
      const a = (active - dirFric * friction) / m;
      newV = v + a * dt;
      if (Math.abs(v) >= 0.02 && Math.sign(newV) !== Math.sign(v) && Math.abs(active) <= friction) newV = 0;
    }

    // Integrate pose (kinematic bicycle) ------------------------------------------
    const vm = (v + newV) / 2;
    const horiz = vm * Math.cos(this.pitch);
    const nh = this.heading + (horiz * Math.tan(this.delta) / P.WHEELBASE) * dt;
    const hm = (this.heading + nh) / 2;
    const nx = this.x + Math.cos(hm) * horiz * dt;
    const nz = this.z + Math.sin(hm) * horiz * dt;

    // Collision test ---------------------------------------------------------------
    this.contacts = world ? world.carContacts(this, nx, nz, nh) : [];
    this.blocked = this.contacts.some((c) => c.solid);
    if (this.blocked) {
      this.v = 0; this.throttle = Math.min(this.throttle, 0.2);
    } else {
      const moved = Math.hypot(nx - this.x, nz - this.z);
      this.odometer += moved;
      this.wheelSpin += (vm * dt) / P.WHEEL_RADIUS;
      this.x = nx; this.z = nz; this.heading = wrapAngle(nh);
      this.v = newV;
    }
    this.updateTerrain(world);
  }

  // Serializable snapshot for debugging/tests
  snapshot() {
    return { x: this.x, z: this.z, heading: this.heading, v: this.v, gear: this.gear, steer: this.steerWheel,
      parkingBrake: this.parkingBrake, pitch: this.pitch };
  }
}
