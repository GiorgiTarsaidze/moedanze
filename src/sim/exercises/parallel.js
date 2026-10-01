// Exercise 1 — Parallel parking (პარალელური პარკირება)
//
// Station frame: origin = kerb line at the comb stop line, f = travel direction (south at Rustavi),
// b = to the right (towards the kerb). The kerb is b = 0, the road b < 0.
//   parking space : a in [-(FZ+LS), -FZ], b in [-W, 0]   (outer line dashed = entry side)
//   front zone    : a in [-FZ, 0],       b in [-W, 0]   (outer line solid)
//   comb stop line: a = 0, b in [-STOP, 0]
// The candidate stops before the comb line, reverses into the space behind on the right,
// stops completely inside, applies the parking brake, then pulls out forward.

import { makeFrame, toLocal, toWorld, line, dashed, L, tyreTouches, allInsideRect, fractionInsideRect,
  relHeading, bodyOutline, StandstillTracker, DirectionTracker, ElementEvaluator } from './common.js';
import { DEG, clamp } from '../math2d.js';
import { worldToLocal, mirrorCamera, projectLocal } from '../optics.js';

export function buildStation(st, dims) {
  const LS = dims.PARALLEL_SPACE_LENGTH, W = dims.PARALLEL_SPACE_WIDTH, FZ = dims.PARALLEL_FRONT_ZONE;
  const STOP = dims.PARALLEL_STOPLINE_LENGTH, lw = dims.LINE_WIDTH;
  const frame = makeFrame(st.o, st.f);
  const a0 = -(FZ + LS), a1 = -FZ;
  const g = {
    id: st.id, frame, LS, W, FZ, a0, a1,
    space: { a0, a1, b0: -W, b1: 0 },
    // boundary lines that must not be crossed by tyres
    lines: [
      { name: 'უკანა ხაზი', a: toWorld(frame, a0, 0), b: toWorld(frame, a0, -W) },
      { name: 'წინა ხაზი', a: toWorld(frame, a1, 0), b: toWorld(frame, a1, -W) },
      { name: 'წინა ზონის ხაზი', a: toWorld(frame, a1, -W), b: toWorld(frame, 0, -W) },
      { name: 'სდექ-ხაზი', a: toWorld(frame, 0, 0), b: toWorld(frame, 0, -STOP), width: 0.3 },
    ],
    // poles just outside the lines: 2 on the road side (bay corners), 3 evenly along the kerb side, 1 behind
    // the rear line. Seen in the left mirror while reversing at full right lock from the inner-pole turning point
    // they appear in the order road-rear, rear-edge, kerb-rear: the kerb-rear one is "the 3rd pole" (~45°).
    posts: [
      { p: toWorld(frame, a0 - 0.18, -W - 0.18), name: 'უკანა ჯოხი', role: 'roadRear' },
      { p: toWorld(frame, a1 + 0.18, -W - 0.18), name: 'წინა ჯოხი', role: 'roadFront' },
      { p: toWorld(frame, a1 - dims.PARALLEL_KERB_POLE_INSET, 0.18), name: 'ბორდიურის წინა ჯოხი', role: 'kerbFront' },
      { p: toWorld(frame, (a0 + a1) / 2, 0.18), name: 'ბორდიურის შუა ჯოხი', role: 'kerbMid' },
      { p: toWorld(frame, a0 + dims.PARALLEL_KERB_POLE_INSET, 0.18), name: 'ბორდიურის უკანა ჯოხი', role: 'kerbRear' },
      { p: toWorld(frame, a0 - 0.18, -W / 2), name: 'უკანა კიდის ჯოხი', role: 'rearEdge' },
    ],
    markings: [
      line(L(frame, [[a0, 0], [a0, -W]]), lw),
      line(L(frame, [[a1, 0], [a1, -W]]), lw),
      dashed(L(frame, [[a0, -W], [a1, -W]]), lw, 0.5, 0.4),
      line(L(frame, [[a1, -W], [0, -W]]), lw),
      line(L(frame, [[0, 0], [0, -STOP]]), 0.3),
      ...[3.5, 4.3, 5.2, 6.1].filter((b) => b < STOP).map((b) => line(L(frame, [[0, -b], [-0.6, -b]]), 0.12)),
    ],
  };
  g.posts.forEach((p, i) => { p.id = `parallel-${st.id}-post${i}`; });
  return g;
}

export class ParallelEvaluator extends ElementEvaluator {
  constructor(ctx, stations) {
    super('parallel', ctx);
    this.stations = stations;
    this.still = new StandstillTracker();
    this.dir = new DirectionTracker();
    this.parkEval = null;
    this.handbrakeDuringStop = false;
  }

  update(veh, dt, time) {
    const st = this.still.update(veh.v, dt);
    if (this.status === 'waiting') return this.tryEngage(veh, st, time);
    if (this.status !== 'active') return;
    const g = this.station, f = g.frame;
    this.dir.update(veh.v, dt);
    const outline = bodyOutline(veh);
    const inFrac = fractionInsideRect(f, outline, g.a0, g.a1, -g.W, 0.3);
    const exitPhase = this.phase === 'exit';

    // tyres on boundary lines / contacts with posts & kerb
    const wheels = veh.wheels();
    for (const ln of g.lines) {
      if (tyreTouches(wheels, ln.a, ln.b, ln.width || this.ctx.dims.LINE_WIDTH).length) {
        this.penalize(exitPhase ? 'markingOrPostOnExit' : 'markingOrPostInZone', ln.name);
      }
    }
    for (const c of this.newContacts(veh)) this.penalize(exitPhase ? 'markingOrPostOnExit' : 'markingOrPostInZone', c.label);

    // Standstill evaluation once the car has reversed into the space (every stop re-evaluates:
    // the last stop before pulling out is the final position).
    this.maxFrac = Math.max(this.maxFrac || 0, inFrac);
    if (st > 0.5 && this.maxFrac > 0.3 && inFrac > 0.3 && !exitPhase) {
      if (this.phase !== 'parked') this.handbrakeDuringStop = false;
      this.phase = 'parked';
      const inside = allInsideRect(f, outline, g.a0 + 0.06, g.a1 - 0.06, -g.W + 0.06, 0.15)
        && !g.lines.slice(0, 3).some((ln) => tyreTouches(wheels, ln.a, ln.b, this.ctx.dims.LINE_WIDTH).length);
      if (veh.parkingBrake) this.handbrakeDuringStop = true;
      this.parkEval = { inside, handbrake: this.handbrakeDuringStop, heading: relHeading(f, veh.heading) };
    } else if (this.phase === 'parked' && Math.abs(veh.v) > 0.05) {
      this.phase = 'manoeuvre';
    } else if (this.phase === 'positioned' && veh.v < -0.05) this.phase = 'manoeuvre';

    // exit: moving forward with part of the body across the outer (entry) line
    if (!exitPhase && veh.v > 0.05 && this.maxFrac > 0.3) {
      const across = outline.some((p) => toLocal(f, p).b < -g.W);
      if (across) {
        this.phase = 'exit';
        const pe = this.parkEval || { inside: false, handbrake: false };
        if (!pe.inside) this.penalize('notFullyInside');
        if (!pe.handbrake) this.penalize('noParkingBrake');
        const ex = this.rules.excessiveCorrections;
        if (ex && ex.enabled && this.dir.changes > ex.maxDirectionChanges) this.penalize('excessiveCorrections', `${this.dir.changes} გასწორება`);
      }
    }
    if (this.phase === 'exit') {
      const out = outline.every((p) => toLocal(f, p).b < -g.W - 0.05);
      if (out) this.complete();
    }
    // drove away without parking
    const fb = toLocal(f, veh.frontBumper());
    if (!this.parkEval && this.maxFrac < 0.3 && fb.a > 12) this.fail('notPerformed');

    this.info = { station: g.id, phase: this.phase, inside: this.parkEval?.inside, handbrake: this.parkEval?.handbrake,
      corrections: this.dir.changes, frontToStopLine: -fb.a };
  }

  tryEngage(veh, stillTime, time) {
    for (const g of this.stations) {
      const f = g.frame;
      const fb = toLocal(f, veh.frontBumper());
      const c = toLocal(f, veh.center());
      const rel = Math.abs(relHeading(f, veh.heading));
      const alongside = c.b > -7.5 && c.b < -2.2 && rel < 30 * DEG;
      if (alongside && (stillTime > 0.1 || veh.v < -0.03) && fb.a > -4.5 && fb.a < 3.5) {
        this.engage(g, time); this.phase = 'positioned';
        if (fb.a > 0.0) this.penalize('stopLineCrossed', `${fb.a.toFixed(2)} მ-ით გადასცდა`);
        return;
      }
      if (fractionInsideRect(f, bodyOutline(veh), g.a0, g.a1, -g.W, 0.3) > 0.25) { this.engage(g, time); this.phase = 'manoeuvre'; return; }
    }
  }

  skipped(veh) {
    // drove past every bay (continued along the road, or turned off beyond the bays)
    return this.stations.every((st) => {
      const c = toLocal(st.frame, veh.center());
      return toLocal(st.frame, veh.rearBumper()).a > 4 || (c.b < -10 && c.a > -20);
    });
  }
}

// ------------------------------------------------------------------------------------------
// Coach — the driving-school method with the bay's poles as references:
//  1. drive past the bay and stop when the inner (kerb-side) front pole is in the middle of the right
//     rear side window (yellow dot = where it must be for this lane);
//  2. full right lock, reverse until the 3rd pole (kerb-side rear) appears in the left mirror (~45°);
//  3. straighten, reverse until the left rear wheel reaches the bay line;
//  4. full left lock, reverse until the car is parallel; parking brake once it fits.
// ------------------------------------------------------------------------------------------
export function createCoach(env) {
  const { vehicle: V } = env;
  const P = V.P, R = V.D.MIN_REAR_AXLE_RADIUS * 1.02;
  const MAXS = V.D.MAX_STEERING_WHEEL_ANGLE * 0.98;
  const gap = 0.75;                                  // lateral gap to the line while approaching
  const laneB = (g) => -g.W - gap - P.CAR_WIDTH / 2;
  const DOT = 42 * DEG;                              // turn at which the 3rd pole is fully inside the left mirror
  const MARGIN = 0.12;                               // "fits": whole body this far inside the lines
  let step = 'approach', t0 = 0, g = null;

  // rear axle `a` at which the inner (kerb-side) front pole is seen in the middle of the right rear side
  // window, for a car with its rear axle at lateral b
  function turnA(b) {
    const p = toLocal(g.frame, post('kerbFront')), E = P.EYE, w = P.RIGHT_REAR_WINDOW_DEG;
    return p.a - E.x - (p.b - b - E.z) / Math.tan((w.front + w.rear) / 2 * DEG);
  }
  const post = (role) => g.posts.find((p) => p.role === role).p;

  return {
    id: 'parallel',
    jump(s) { step = s; },
    get step() { return step; },
    reset() { step = 'approach'; g = null; },
    update(veh, ev, time) {
      if (!g) g = ev.station || env.stations[0];
      if (step === 'approach' && ev.status === 'active' && ev.station) g = ev.station;
      const f = g.frame;
      const ra = toLocal(f, { x: veh.x, z: veh.z });
      const rel = relHeading(f, veh.heading);
      const r = -rel / DEG;                            // degrees turned towards the kerb
      const still = Math.abs(veh.v) < 0.03;
      const go = (s) => { step = s; t0 = time; };
      const kerbFront = post('kerbFront'), pole3 = post('kerbRear');  // 3rd pole to appear in the left mirror
      const laneNow = Math.round(ra.b * 20) / 20;     // the lane the car is in (for the reference dot)
      const tA = turnA(laneNow), d = ra.a - tA;        // d > 0: past the turning point
      const turnDot = { id: 'par-turn', target: kerbFront, pose: poseAt(g, tA, laneNow, 0), views: [] };
      const lw = toLocal(f, veh.wheels()[2]);          // left rear wheel
      const outline = bodyOutline(veh).map((p) => toLocal(f, p));
      const rearOut = g.a0 + MARGIN - Math.min(...outline.map((l) => l.a));   // > 0: rear over the rear line
      const frontOut = Math.max(...outline.map((l) => l.a)) - (g.a1 - MARGIN);
      const fits = rearOut <= 0 && frontOut <= 0 && Math.min(...outline.map((l) => l.b)) >= -g.W + MARGIN && Math.max(...outline.map((l) => l.b)) <= 0.1;

      switch (step) {
        case 'approach': {
          if (d > -0.15 && still) { go(d > 0.35 ? 'backUp' : 'toReverse'); break; }
          return { step, title: 'მიუახლოვდით პარკირების ადგილს',
            text: 'გაიარეთ ადგილის გასწვრივ, ხაზიდან დაახლოებით 0.7–1 მ-ში. გაჩერდით, როცა ადგილის შიდა (ბორდიურის მხარის) წინა ჯოხი მარჯვენა უკანა ფანჯრის შუაში გამოჩნდება — ყვითელ წერტილთან.',
            readout: `მობრუნების წერტილამდე ${Math.max(0, -d).toFixed(1)} მ`, gear: 'D',
            track: { frame: f, b: laneB(g) }, speed: clamp(-d * 0.9, 0, 2.2), stop: d > -0.15,
            ghost: ghost(g, tA, laneB(g)),                 // ghost car = rear axle at the turning point
            sticker: turnDot, focus: kerbFront };
        }
        case 'backUp':
          if (d <= 0.15 && still) { go('lockRight'); break; }
          return { step, title: 'გადასცდით მობრუნების წერტილს', text: 'ჩართეთ R და საჭე სწორად ნელა იმოძრავეთ უკან, სანამ შიდა წინა ჯოხი მარჯვენა უკანა ფანჯრის შუაში (ყვითელ წერტილთან) არ მოვა.',
            readout: `${Math.max(0, d).toFixed(2)} მ`, gear: 'R', steer: 0, speed: clamp(d * 0.8, 0.12, 0.8), stop: d <= 0.15,
            sticker: turnDot, focus: kerbFront };
        case 'toReverse':
          if (veh.gear === 'R') { go('lockRight'); break; }
          return { step, title: 'ჩართეთ უკუსვლა', text: 'დააჭირეთ მუხრუჭს და ჩართეთ R.', gear: 'R', stop: true, sticker: turnDot, focus: kerbFront };
        case 'lockRight':
          if (veh.steerWheel >= MAXS) { go('arcRight'); break; }
          return { step, title: 'საჭე ბოლომდე მარჯვნივ', text: 'მოაბრუნეთ საჭე ბოლომდე მარჯვნივ (მანქანა დგას).', gear: 'R', steer: 1, stop: true };
        case 'arcRight': {
          const pr = projectLocal(mirrorCamera('left'), { ...worldToLocal({ x: veh.x, z: veh.z, heading: veh.heading }, pole3), y: 0.6 });
          const seen = pr.inside && 1 - pr.u < 0.96;     // fully inside the left mirror, not on its edge
          const done = seen || r >= 52;
          if (done && still) { go('center1'); break; }
          return { step, title: 'შედით ადგილზე', text: 'ნელა იმოძრავეთ უკუსვლით, საჭე ბოლომდე მარჯვნივ. გაჩერდით, როცა მარცხენა სარკეში მესამე ჯოხი (ბორდიურის მხარის უკანა ჯოხი) გამოჩნდება.',
            readout: seen ? 'ჯოხი სარკეშია — გაჩერდით' : `კუთხე ${r.toFixed(0)}°`, gear: 'R', steer: 1, speed: clamp((45 - r) * 0.06, 0.12, 0.7), stop: done,
            sticker: { id: 'par-3rd', target: pole3, pose: poseAt(g, tA - R * Math.sin(DOT), laneNow + R * (1 - Math.cos(DOT)), -DOT), views: ['left'] }, focus: pole3 };
        }
        case 'center1':
          // ±25° of steering wheel: a keyboard tap moves it 20–40°; left uncorrected the car still parks cleanly
          if (Math.abs(veh.steerWheel) < 0.44) { go('reverseToLine'); break; }
          return { step, title: 'გაასწორეთ საჭე', text: 'დააბრუნეთ საჭე შუა მდგომარეობაში.', gear: 'R', steer: 0, stop: true,
            readout: `საჭე: ${Math.abs(veh.steerWheel / DEG).toFixed(0)}° ${veh.steerWheel > 0 ? 'მარჯვნივ' : 'მარცხნივ'}` };
        case 'reverseToLine': {
          const toLine = -g.W - lw.b;                     // > 0: left rear wheel still outside the bay line
          if (toLine <= 0.05 && still) { go('lockLeft'); break; }
          return { step, title: 'უკუსვლა პირდაპირ', text: 'იმოძრავეთ უკუსვლით პირდაპირ, სანამ მარცხენა უკანა საბურავი ადგილის ხაზზე არ დადგება.',
            readout: `საბურავი ხაზამდე ${Math.max(0, toLine).toFixed(2)} მ`, gear: 'R', steer: 0,
            speed: clamp(toLine * 1.2, 0.12, 0.7), stop: toLine <= 0.05, highlight: [g.lines[2]] };
        }
        case 'lockLeft':
          if (veh.steerWheel <= -MAXS) { go('arcLeft'); break; }
          return { step, title: 'საჭე ბოლომდე მარცხნივ', text: 'მოაბრუნეთ საჭე ბოლომდე მარცხნივ.', gear: 'R', steer: -1, stop: true };
        case 'arcLeft':
          if (r <= 1.5 && still) { go('center2'); break; }
          return { step, title: 'გასწორდით ბორდიურის პარალელურად', text: 'ნელა იმოძრავეთ უკუსვლით, საჭე ბოლომდე მარცხნივ, სანამ მანქანა ბორდიურის პარალელური არ გახდება.',
            readout: `კუთხე ${Math.max(0, r).toFixed(1)}°`, gear: 'R', steer: -1, speed: clamp(r * 0.05, 0.1, 0.6), stop: r <= 1.5 };
        case 'center2':
          if (Math.abs(veh.steerWheel) < 0.44) { go('adjust'); break; }
          return { step, title: 'გაასწორეთ საჭე', text: 'დააბრუნეთ საჭე შუა მდგომარეობაში.', gear: veh.gear, steer: 0, stop: true,
            readout: `საჭე: ${Math.abs(veh.steerWheel / DEG).toFixed(0)}° ${veh.steerWheel > 0 ? 'მარჯვნივ' : 'მარცხნივ'}` };
        case 'adjust': {
          // only if the car does not fit yet: move until the whole body is inside the lines
          if (fits && still) { go('handbrake'); break; }
          if (fits) return { step, title: 'გაჩერდით', text: 'მანქანა ადგილზეა — გაჩერდით.', stop: true, steer: 0 };
          const back = frontOut > 0;
          return { step, title: 'დადექით ადგილზე', text: back ? 'წინა ნაწილი ჯერ ადგილის გარეთაა — ცოტა იმოძრავეთ უკუსვლით, საჭე სწორად.' : 'უკანა ნაწილი ხაზს სცდება — ცოტა წაიწიეთ წინ, საჭე სწორად.',
            readout: `${Math.max(frontOut, rearOut).toFixed(2)} მ`, gear: back ? 'R' : 'D', steer: 0, speed: clamp(Math.max(frontOut, rearOut) + 0.1, 0.1, 0.4) };
        }
        case 'handbrake':
          if (veh.parkingBrake && time - t0 > 1.5) { go('exitPrep'); break; }
          return { step, title: 'სადგომი მუხრუჭი', text: 'ბოლომდე გაჩერდით და ჩართეთ სადგომი მუხრუჭი (Space).', stop: true, handbrake: true };
        case 'exitPrep':
          if (veh.gear === 'D' && !veh.parkingBrake) { go('lockExit'); break; }
          return { step, title: 'მოემზადეთ გასასვლელად', text: 'ჩართეთ D (F) და მოხსენით სადგომი მუხრუჭი (Space).', stop: true,
            gear: 'D', handbrake: false };
        case 'lockExit':
          if (veh.steerWheel <= -MAXS) { go('exitArc'); break; }
          return { step, title: 'საჭე ბოლომდე მარცხნივ', text: 'დაძვრამდე მოაბრუნეთ საჭე ბოლომდე მარცხნივ.', gear: 'D', steer: -1, stop: true };
        case 'exitArc':
          if (r >= 28) { go('exitStraight'); break; }        // nose 28° out towards the road
          return { step, title: 'გამოდით ადგილიდან', text: 'ნელა დაიძარით, საჭე ბოლომდე მარცხნივ.', gear: 'D', steer: -1, speed: 0.8 };
        case 'exitStraight': {
          if (ev.status !== 'active') { go('done'); break; }
          return { step, title: 'ჩადექით ზოლში', text: 'გაასწორეთ საჭე და გააგრძელეთ გზა.', gear: 'D',
            track: { frame: f, b: laneB(g) - 0.4, lookahead: 5 }, speed: 1.2 };
        }
        default:
          return null;
      }
      return this.update(veh, ev, time);
    },
  };
}

const ghost = (g, a, b, rel = 0) => ({ frame: g.frame, a, b, rel });

function poseAt(g, aRA, bRA, rel) {
  const p = toWorld(g.frame, aRA, bRA);
  return { x: p.x, z: p.z, heading: Math.atan2(g.frame.f.z, g.frame.f.x) + rel };
}
