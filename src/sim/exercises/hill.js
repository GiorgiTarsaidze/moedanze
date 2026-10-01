// Exercise 6 — Hill start (აღმართი)
//
// Station frame: origin = centre of the stop line, f = uphill travel direction (west at Rustavi),
// b = to the right. The ramp profile (heights along a) is part of the terrain:
//   incline  a in [crest - INCLINE, crest]  at HILL_GRADIENT (16 %)
//   plateau  a in [crest, crest + PLATEAU]
//   decline  a in [.., .. + DECLINE]
// with crest = +STOPLINE_BEFORE_CREST (the stop line is just below the crest).
// The car must stop on the incline with its front >= 1 m before the stop line, hold, then move off
// without rolling back more than 20 cm.

import { makeFrame, toLocal, toWorld, line, L, relHeading, StandstillTracker, ElementEvaluator } from './common.js';
import { DEG, clamp } from '../math2d.js';

export function buildStation(st, dims) {
  const frame = makeFrame(st.o, st.f);
  const hw = dims.HILL_LANE_WIDTH / 2;
  const crest = dims.HILL_STOPLINE_BEFORE_CREST;
  const inc0 = crest - dims.HILL_INCLINE;
  const H = dims.HILL_INCLINE * dims.HILL_GRADIENT;
  const plat1 = crest + dims.HILL_PLATEAU;
  const dec1 = plat1 + dims.HILL_DECLINE;
  const profile = (a) => {
    if (a <= inc0 || a >= dec1) return 0;
    if (a < crest) return (a - inc0) * dims.HILL_GRADIENT;
    if (a <= plat1) return H;
    return H * (1 - (a - plat1) / dims.HILL_DECLINE);
  };
  const aAtHeight = (h, rising) => rising ? inc0 + h / dims.HILL_GRADIENT : plat1 + (1 - h / H) * dims.HILL_DECLINE;
  const wallA0 = aAtHeight(0.15, true), wallA1 = aAtHeight(0.15, false);
  const heading = Math.atan2(st.f.z, st.f.x);
  return {
    id: st.id, frame, hw, crest, inc0, plat1, dec1, H, profile,
    ramp: { frame, hw, a0: inc0, a1: dec1, profile },
    // side walls where the ramp is raised (solid)
    walls: [
      { a: toWorld(frame, wallA0, -hw - 0.1), b: toWorld(frame, wallA1, -hw - 0.1), name: 'აღმართის კიდე' },
      { a: toWorld(frame, wallA0, hw + 0.1), b: toWorld(frame, wallA1, hw + 0.1), name: 'აღმართის კიდე' },
    ],
    posts: [],
    lines: [],
    stopLine: { a: toWorld(frame, 0, -hw), b: toWorld(frame, 0, hw) },
    markings: [
      { ...line(L(frame, [[0, -hw + 0.05], [0, hw - 0.05]]), 0.3), onRamp: true },
      { ...line(L(frame, [[inc0, -hw + 0.1], [dec1, -hw + 0.1]]), 0.12), onRamp: true },
      { ...line(L(frame, [[inc0, hw - 0.1], [dec1, hw - 0.1]]), 0.12), onRamp: true },
      { type: 'text', text: 'სდექ', at: toWorld(frame, -1.25, 0), heading, size: 0.8, onRamp: true },
    ],
  };
}

export class HillEvaluator extends ElementEvaluator {
  constructor(ctx, stations) {
    super('hill', ctx);
    this.stations = stations;
    this.still = new StandstillTracker();
    this.stop = null;         // qualifying stop { a (rear axle), front }
    this.maxRollback = 0;
  }

  update(veh, dt, time) {
    const g = this.stations[0], f = g.frame;
    const stillT = this.still.update(veh.v, dt);
    const ra = toLocal(f, { x: veh.x, z: veh.z });
    const fb = toLocal(f, veh.frontBumper());
    const rb = toLocal(f, veh.rearBumper());
    const inLane = Math.abs(ra.b) < g.hw + 0.5 && Math.abs(relHeading(f, veh.heading)) < 45 * DEG;
    if (this.status === 'waiting') {
      if (inLane && fb.a > g.inc0 + 0.3) { this.engage(g, time); this.phase = 'climb'; }
      return;
    }
    if (this.status !== 'active') return;
    const R = this.rules, cfg = this.ctx.rules.elements.hill;
    const onIncline = ra.a >= g.inc0 && fb.a <= g.crest;   // all four wheels on the 16 % incline

    if (this.phase === 'climb') {
      if (fb.a > 0) { this.penalize('badStop', 'სდექ-ხაზი გადაკვეთა გაჩერების გარეშე'); this.phase = 'over'; }
      else if (stillT > this.ctx.rules.stopDetectSeconds && onIncline) {
        const distToLine = -fb.a;
        const okMin = distToLine >= cfg.stopMinDistance - 1e-3;
        const okMax = cfg.stopMaxDistance == null || distToLine <= cfg.stopMaxDistance;
        this.stop = { a: ra.a, dist: distToLine, ok: okMin && okMax };
        if (!this.stop.ok) this.penalize('badStop', `გაჩერდა ხაზამდე ${distToLine.toFixed(2)} მ-ში`);
        this.phase = 'holding';
      }
    }
    if (this.phase === 'holding') {
      const back = this.stop.a - ra.a;
      this.maxRollback = Math.max(this.maxRollback, back);
      if (ra.a > this.stop.a + 0.5) this.phase = 'movingOff';
      if (stillT > 0.3 && Math.abs(back) < 0.02 && fb.a < 0) { /* still holding */ }
    }
    if (this.phase === 'holding' || this.phase === 'movingOff') {
      if (this.maxRollback > cfg.rollbackLimit) this.penalize('rollback', `${(this.maxRollback * 100).toFixed(0)} სმ`);
      if (this.maxRollback > cfg.severeRollbackLimit) this.penalize('severeRollback', `${this.maxRollback.toFixed(2)} მ`);
      // a second stop further up counts as a new hill start
      if (this.phase === 'movingOff' && stillT > this.ctx.rules.stopDetectSeconds && fb.a < 0 && onIncline) {
        this.stop = { a: ra.a, dist: -fb.a, ok: true }; this.phase = 'holding';
      }
    }
    if (rb.a > g.crest + 0.2) {
      if (!this.stop) this.penalize('badStop', 'აღმართზე არ გაჩერებულა');
      this.complete();
    } else if (ra.a < g.inc0 - 4 && this.phase !== 'climb') this.fail('severeRollback');
    this.info = { phase: this.phase, frontToLine: (-fb.a).toFixed(2), rollback: (this.maxRollback * 100).toFixed(0) + ' cm', stopDist: this.stop?.dist?.toFixed(2) };
  }

  skipped(veh) {
    const g = this.stations[0];
    const ra = toLocal(g.frame, { x: veh.x, z: veh.z });
    return ra.a > g.dec1 + 3 && Math.abs(ra.b) < 6;
  }
}

// ------------------------------------------------------------------------------------------
// Coach: stop 1.5 m before the line, secure with the parking brake, build throttle, release.
// ------------------------------------------------------------------------------------------
export function createCoach(env) {
  const g = env.stations[0];
  const f = g.frame;
  let step = 'approach', t0 = 0;
  const target = 1.5;               // metres front bumper -> stop line
  return {
    id: 'hill',
    jump(s) { step = s; },
    get step() { return step; },
    reset() { step = 'approach'; },
    update(veh, ev, time) {
      const fb = toLocal(f, veh.frontBumper());
      const still = Math.abs(veh.v) < 0.02;
      const go = (s) => { step = s; t0 = time; };
      const d = -target - fb.a;
      switch (step) {
        case 'approach':
          if (d < 0.04 && still) { go('hold'); break; }
          return { step, title: 'აღმართი', text: `ადით აღმართზე და გაჩერდით ისე, რომ წინა ნაწილი სდექ-ხაზამდე დაახლოებით ${target} მ-ში იყოს`,
            readout: `სდექ-ხაზამდე ${Math.max(0, -fb.a).toFixed(1)} მ`, gear: 'D', track: { frame: f, b: 0 }, speed: clamp(d * 0.6 + 0.15, 0, 1.6), stop: d < 0.04,
            ghost: { frame: f, a: -target - env.vehicle.P.WHEELBASE - env.vehicle.P.FRONT_OVERHANG, b: 0, rel: 0 }, highlight: [g.stopLine] };
        case 'hold':
          if (veh.parkingBrake && time - t0 > 1.6) { go('throttle'); break; }
          return { step, title: 'დაამუხრუჭეთ', text: 'მუხრუჭი არ აუშვათ და ჩართეთ სადგომი მუხრუჭი (Space).', stop: true, handbrake: true,
            readout: `წინა ნაწილი ხაზიდან ${(-fb.a).toFixed(2)} მ-შია` };
        case 'throttle':
          if (veh.throttle > 0.5) { go('release'); break; }
          return { step, title: 'მიეცით გაზს', text: 'აუშვით მუხრუჭის პედალს და დააჭირეთ გაზის პედალს, მანქანა ჯერ კიდევ სადგომ მუხრუჭზე უნდა იყოს', throttle: 0.55, handbrake: true, gear: 'D' };
        case 'release':
          if (!veh.parkingBrake && veh.v > 0.3) { go('climb'); break; }
          return { step, title: 'მოხსენით სადგომი მუხრუჭი', text: 'ახლა მოხსენით სადგომი მუხრუჭი (Space), გაზის პედალს არ აუშვათ', throttle: 0.55, handbrake: false, gear: 'D' };
        case 'climb':
          if (ev.status !== 'active') { go('done'); break; }
          return { step, title: 'დაძვრა', text: 'გადაიარეთ აღმართი და ნელა დაეშვით ქვემოთ', gear: 'D', track: { frame: f, b: 0 }, speed: 1.2 };
        default: return null;
      }
      return this.update(veh, ev, time);
    },
  };
}
