// Central vehicle parameters. All units SI (metres, seconds, kilograms, radians unless noted).
// A compact examination-style hatchback/sedan (roughly Toyota Corolla / Hyundai Elantra class).
// Change these and every dependent system (physics, collision, rendering, reference points,
// training trajectories) updates automatically.

const DEG = Math.PI / 180;

export const VEHICLE = {
  // --- Body dimensions ---
  CAR_LENGTH: 4.35,
  CAR_WIDTH: 1.78,            // body width without mirrors
  MIRROR_WIDTH: 2.02,         // width across mirror housings
  CAR_HEIGHT: 1.46,
  WHEELBASE: 2.60,
  TRACK: 1.52,                // wheel centre-to-centre, used for wheel positions & Ackermann
  FRONT_OVERHANG: 0.88,       // front axle -> front bumper
  REAR_OVERHANG: 0.87,        // rear bumper -> rear axle  (0.88 + 2.60 + 0.87 = 4.35)
  WHEEL_RADIUS: 0.31,
  TIRE_WIDTH: 0.205,

  // --- Steering ---
  // Bicycle-equivalent maximum road-wheel angle. 34.5 deg with a 2.60 m wheelbase gives a
  // kerb-to-kerb turning circle of ~10.4 m (typical for this class of car).
  MAX_STEERING_ANGLE: 34.5 * DEG,
  STEERING_RATIO: 15.5,       // steering-wheel angle / road-wheel angle
  // Steering wheel turn rate when the player holds A/D (deg of steering wheel per second).
  STEER_RATE_DEG: 420,
  // Self-centring: steering wheel return rate (deg/s) at speeds >= SELF_CENTER_FULL_SPEED.
  SELF_CENTER_RATE_DEG: 300,
  SELF_CENTER_FULL_SPEED: 2.5, // m/s
  // None in reverse: caster trail then acts the other way, so a real wheel stays where it is left
  // (at 0.45 a released full lock unwound during a 90° reverse arc and the car missed the garage).
  SELF_CENTER_REVERSE_FACTOR: 0,

  // --- Mass & resistances ---
  MASS: 1330,                 // car + driver
  GRAVITY: 9.81,
  ROLLING_RESISTANCE: 0.015,
  DRAG_COEFF: 0.9,            // 0.5 * rho * Cd * A  (N per (m/s)^2)

  // --- Drivetrain (automatic transmission with torque converter) ---
  CREEP_SPEED_D: 1.75,        // m/s (~6.3 km/h) creep target on flat ground in D
  CREEP_SPEED_R: 1.35,        // m/s (~4.9 km/h) in R
  CREEP_FORCE: 1550,          // N at standstill. Less than m*g*sin(atan(0.16)) ~ 2060 N,
                              // so an unbraked car in D rolls back on the 16 % hill.
  MAX_DRIVE_FORCE: 4200,      // N at full throttle, low speed
  MAX_POWER: 55000,           // W, limits force at speed
  MAX_REVERSE_SPEED: 5.5,     // m/s (~20 km/h)
  THROTTLE_RISE: 1.6,         // pedal travel per second while W held (keyboard)
  THROTTLE_FALL: 4.0,
  // Engine braking off the throttle in D/R: the idling engine drags the car back down towards
  // creep speed (~0.8 m/s^2 at 20 km/h). Full force ENGINE_BRAKE_SPAN m/s above creep speed.
  ENGINE_BRAKE_FORCE: 900,    // N
  ENGINE_BRAKE_SPAN: 1.5,     // m/s

  // --- Brakes ---
  MAX_BRAKE_FORCE: 10500,     // N (~8 m/s^2)
  BRAKE_RISE: 3.0,            // pedal travel per second while S held
  BRAKE_FALL: 5.0,
  PARKING_BRAKE_FORCE: 5200,  // N, holds the car on >25 % grade
  // Shifting between D and R is refused above this speed (m/s)
  MAX_SHIFT_SPEED: 0.4,

  // --- Driver eye point (car-local: x forward from rear axle, y up from ground, z right) ---
  // Left-hand-drive car (Georgia drives on the right).
  EYE: { x: 1.22, y: 1.19, z: -0.36 },
  CAMERA_FOV: 64,             // vertical FOV in degrees for the driver camera
  // Windscreen seen from EYE: yaw (deg, + right) of the A-pillars' inner edges at dashboard height
  // (A-pillar bases in car3d.js at x 2.08, z ±0.80). A pole between them is "in the front window".
  WINDSCREEN_EDGE_DEG: { left: -25, right: 51 },

  // Mirror positions (car-local) & aim (yaw deg outward from straight back, pitch deg down).
  // x/y keep the whole glass visible from EYE through the side window: behind the A-pillar base
  // and above the dashboard / door sill (at x 2.02, y 1.02 the pillar and dash hid most of it).
  MIRRORS: {
    left:  { x: 1.75, y: 1.06, z: -1.00, yaw: 17, pitch: 4, fov: 24, w: 0.21, h: 0.13,
             // In R: same outer edge (poles far behind enter the mirror as before), but it reaches further in and
             // down (slightly squeezed, like a convex mirror) so the rear left tyre on the line is visible.
             reverse: { yaw: 13.5, pitch: 16.5, fov: 35, hfov: 45 } },
    right: { x: 1.75, y: 1.06, z:  1.00, yaw: 19, pitch: 6, fov: 26, w: 0.21, h: 0.13,
             reverseDipDeg: 6 },  // right mirror tilts down in R (common kerb-view feature)
    rear:  { x: 1.78, y: 1.33, z: -0.06, w: 0.24, h: 0.07, fov: 16 },
  },
};

// Derived values -------------------------------------------------------------
export function derived(v = VEHICLE) {
  const Rrear = v.WHEELBASE / Math.tan(v.MAX_STEERING_ANGLE);          // rear-axle centre radius
  const RouterFront = Math.hypot(Rrear + v.TRACK / 2, v.WHEELBASE);     // outer front wheel
  const RouterCorner = Math.hypot(Rrear + v.CAR_WIDTH / 2, v.WHEELBASE + v.FRONT_OVERHANG);
  return {
    MIN_REAR_AXLE_RADIUS: Rrear,
    TURNING_RADIUS: RouterFront,             // kerb-to-kerb radius (outer front wheel path)
    TURNING_CIRCLE: 2 * RouterFront,
    WALL_TO_WALL_RADIUS: RouterCorner,
    MAX_STEERING_WHEEL_ANGLE: v.MAX_STEERING_ANGLE * v.STEERING_RATIO,
  };
}
