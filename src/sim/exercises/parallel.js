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
    posts: [
      { p: toWorld(frame, a0 - 0.18, -W - 0.18), name: 'უკანა ჯოხი' },
      { p: toWorld(frame, a1 + 0.18, -W - 0.18), name: 'წინა ჯოხი' },
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
        const recentLeft = veh.indicatorActive('left');
        if (!recentLeft) this.penalize('noIndicatorOnExit');
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
// Coach: contextual instructions + actions (used by Training Mode and the automated tests).
// Geometry: two reverse arcs at full lock (radius R of the rear axle) joined by a straight
// segment at 45 deg — the classic driving-school method, computed from the real vehicle.
// ------------------------------------------------------------------------------------------
export function createCoach(env) {
  const { vehicle: V, dims } = env;
  const P = V.P, R = V.D.MIN_REAR_AXLE_RADIUS * 1.02;
  const gap = 0.75;                                  // lateral gap to the line while approaching
  const laneB = (g) => -g.W - gap - P.CAR_WIDTH / 2;
  const rearGapTarget = 0.75;                        // final distance rear bumper -> rear line
  const finalRA = (g) => g.a0 + rearGapTarget + P.REAR_OVERHANG;
  const finalB = (g) => -g.W / 2 + 0.05;
  const theta = 45 * DEG;
  let step = 'approach', t0 = 0, g = null, plan = null;

  function computePlan(veh) {
    const f = g.frame;
    const ra = toLocal(f, { x: veh.x, z: veh.z });
    const delta = finalB(g) - ra.b;                 // lateral displacement needed (towards kerb)
    const arcs = 2 * R * (1 - Math.cos(theta));
    const S = Math.max(0, (delta - arcs) / Math.sin(theta));
    const along = 2 * R * Math.sin(theta) + S * Math.cos(theta);
    return { startRA: finalRA(g) + along, S, delta };
  }
  const ghost = (a, b, rel = 0) => ({ frame: g.frame, a, b, rel });

  return {
    id: 'parallel',
    jump(s) { step = s; },
    get step() { return step; },
    reset() { step = 'approach'; g = null; },
    update(veh, ev, time) {
      if (!g) g = ev.station || env.stations[0];
      const f = g.frame;
      const ra = toLocal(f, { x: veh.x, z: veh.z });
      const fb = toLocal(f, veh.frontBumper());
      const rel = relHeading(f, veh.heading);
      const still = Math.abs(veh.v) < 0.03;
      const go = (s) => { step = s; t0 = time; };
      const frontPost = g.posts[1].p, rearPost = g.posts[0].p;

      switch (step) {
        case 'approach': {
          if (ev.status === 'active' && ev.station) { g = ev.station; }
          const d = -0.45 - fb.a;
          if (d < 0.05 && still) { go('toReverse'); break; }
          return { step, title: 'მიუახლოვდით პარკირების ადგილს',
            text: 'გაიარეთ ადგილის გასწვრივ, ხაზიდან დაახლოებით 0.7–1 მ-ში. გაჩერდით ისე, რომ წინა ბამპერი სდექ-ხაზს არ გადასცდეს.',
            readout: `სდექ-ხაზამდე ${Math.max(0, d).toFixed(1)} მ`, gear: 'D',
            track: { frame: f, b: laneB(g) }, speed: clamp(d * 0.9, 0, 2.2), stop: d < 0.05,
            ghost: ghost(-0.45 - P.WHEELBASE - P.FRONT_OVERHANG, laneB(g)), highlight: [g.lines[3]] };
        }
        case 'toReverse':
          if (veh.gear === 'R') { plan = computePlan(veh); go('reverseStraight'); break; }
          return { step, title: 'ჩართეთ უკუსვლა', text: 'დააჭირეთ მუხრუჭს და ჩართეთ R.', gear: 'R', stop: true };
        case 'reverseStraight': {
          plan = plan || computePlan(veh);
          const d = ra.a - plan.startRA;
          if (d <= 0.02 && still) { go('lockRight'); break; }
          const idealPose = poseAt(g, plan.startRA, ra.b, 0);
          return { step, title: 'უკუსვლა პირდაპირ', text: 'ნელა იმოძრავეთ უკუსვლით, საჭე სწორად. უყურეთ მარჯვენა სარკეს.',
            hint: 'როცა ადგილის წინა ჯოხი მარჯვენა სარკეში ყვითელ ნიშანს მიაღწევს — გაჩერდით და საჭე ბოლომდე მოაბრუნეთ მარჯვნივ.',
            readout: `მობრუნების წერტილამდე ${Math.max(0, d).toFixed(2)} მ`, gear: 'R', steer: 0, speed: clamp(d * 0.8, 0.12, 0.8), stop: d <= 0.02,
            sticker: { id: 'par-lock-right', target: frontPost, pose: idealPose, views: ['right', 'rear'] }, focus: frontPost };
        }
        case 'lockRight':
          if (veh.steerWheel >= V.D.MAX_STEERING_WHEEL_ANGLE * 0.98) { go('arcRight'); break; }
          return { step, title: 'საჭე ბოლომდე მარჯვნივ', text: 'მოაბრუნეთ საჭე ბოლომდე მარჯვნივ (მანქანა დგას).', gear: 'R', steer: 1, stop: true };
        case 'arcRight': {
          const r = -rel / DEG;
          if (r >= 44.5 && still) { go('center1'); break; }
          return { step, title: 'შედით ადგილზე', text: 'ნელა იმოძრავეთ უკუსვლით, საჭე ბოლომდე მარჯვნივ, სანამ მანქანა ბორდიურთან 45° კუთხით არ დადგება.',
            hint: 'გაჩერდით, როცა შორეული (უკანა) ჯოხი მარცხენა სარკეში ყვითელ ნიშანს მიაღწევს.',
            readout: `კუთხე ${r.toFixed(0)}° / 45°`, gear: 'R', steer: 1, speed: clamp((45 - r) * 0.06, 0.12, 0.7), stop: r >= 44.5,
            sticker: { id: 'par-45', target: rearPost, pose: poseAt(g, plan.startRA - R * Math.sin(theta), laneB(g) + R * (1 - Math.cos(theta)), -theta), views: ['left', 'rear', 'right'] }, focus: rearPost };
        }
        case 'center1':
          // ±25° of steering wheel: a keyboard tap moves it 20–40°; left uncorrected the car still parks cleanly
          if (Math.abs(veh.steerWheel) < 0.44) { go('reverse45'); break; }
          return { step, title: 'გაასწორეთ საჭე', text: 'დააბრუნეთ საჭე შუა მდგომარეობაში.', gear: 'R', steer: 0, stop: true,
            readout: `საჭე: ${Math.abs(veh.steerWheel / DEG).toFixed(0)}° ${veh.steerWheel > 0 ? 'მარჯვნივ' : 'მარცხნივ'}` };
        case 'reverse45': {
          const th = Math.abs(rel);
          const switchB = finalB(g) - R * (1 - Math.cos(th));
          const d = switchB - ra.b;
          if (d <= 0.01 && still) { go('lockLeft'); break; }
          return { step, title: 'უკუსვლა პირდაპირ 45°-ზე', text: 'იმოძრავეთ უკუსვლით პირდაპირ, სანამ მანქანის მარჯვენა წინა კუთხე წინა ჯოხს არ ასცდება.',
            readout: `${Math.max(0, d / Math.sin(Math.max(th, 0.2))).toFixed(2)} მ`, gear: 'R', steer: 0,
            speed: clamp(d * 1.2, 0.12, 0.7), stop: d <= 0.01, focus: frontPost };
        }
        case 'lockLeft':
          if (veh.steerWheel <= -V.D.MAX_STEERING_WHEEL_ANGLE * 0.98) { go('arcLeft'); break; }
          return { step, title: 'საჭე ბოლომდე მარცხნივ', text: 'მოაბრუნეთ საჭე ბოლომდე მარცხნივ.', gear: 'R', steer: -1, stop: true };
        case 'arcLeft': {
          const r = -rel / DEG;
          if (r <= 0.8 && still) { go('center2'); break; }
          return { step, title: 'გასწორდით ბორდიურის პარალელურად', text: 'ნელა იმოძრავეთ უკუსვლით, საჭე ბოლომდე მარცხნივ, სანამ მანქანა ბორდიურის პარალელური არ გახდება.',
            readout: `კუთხე ${r.toFixed(1)}°`, gear: 'R', steer: -1, speed: clamp(r * 0.05, 0.1, 0.6), stop: r <= 0.8 };
        }
        case 'center2':
          if (Math.abs(veh.steerWheel) < 0.44) { go('adjust'); break; }
          return { step, title: 'გაასწორეთ საჭე', text: 'დააბრუნეთ საჭე შუა მდგომარეობაში.', gear: veh.gear, steer: 0, stop: true,
            readout: `საჭე: ${Math.abs(veh.steerWheel / DEG).toFixed(0)}° ${veh.steerWheel > 0 ? 'მარჯვნივ' : 'მარცხნივ'}` };
        case 'adjust': {
          const rb = toLocal(f, veh.rearBumper()).a - g.a0;           // rear gap
          const err = rb - rearGapTarget;
          if (Math.abs(err) < 0.2 && still) { go('handbrake'); break; }
          const gear = err > 0 ? 'R' : 'D';
          return { step, title: 'დადექით ადგილზე', text: err > 0 ? 'კიდევ ცოტა იმოძრავეთ უკუსვლით, საჭე სწორად.' : 'ცოტა წაიწიეთ წინ.',
            readout: `უკან დარჩა ${rb.toFixed(2)} მ`, gear, steer: 0, speed: clamp(Math.abs(err), 0.1, 0.4), stop: Math.abs(err) < 0.2 };
        }
        case 'handbrake':
          if (veh.parkingBrake && time - t0 > 1.5) { go('exitPrep'); break; }
          return { step, title: 'სადგომი მუხრუჭი', text: 'ბოლომდე გაჩერდით და ჩართეთ სადგომი მუხრუჭი (Space).', stop: true, handbrake: true };
        case 'exitPrep':
          if (veh.gear === 'D' && !veh.parkingBrake && veh.indicatorActive('left')) { go('lockExit'); break; }
          return { step, title: 'მოემზადეთ გასასვლელად', text: 'ჩართეთ მარცხენა მოხვევის მაჩვენებელი (Q), ჩართეთ D (F) და მოხსენით სადგომი მუხრუჭი (Space).', stop: true,
            indicator: 'left', gear: 'D', handbrake: false };
        case 'lockExit':
          if (veh.steerWheel <= -V.D.MAX_STEERING_WHEEL_ANGLE * 0.98) { go('exitArc'); break; }
          return { step, title: 'საჭე ბოლომდე მარცხნივ', text: 'დაძვრამდე მოაბრუნეთ საჭე ბოლომდე მარცხნივ.', gear: 'D', steer: -1, stop: true, indicator: 'left' };
        case 'exitArc': {
          const r = rel / DEG;
          if (r <= -28) { go('exitStraight'); break; }
          return { step, title: 'გამოდით ადგილიდან', text: 'ნელა დაიძარით, საჭე ბოლომდე მარცხნივ.', gear: 'D', steer: -1, speed: 0.8, indicator: 'left' };
        }
        case 'exitStraight': {
          if (ev.status !== 'active') { go('done'); break; }
          return { step, title: 'ჩადექით ზოლში', text: 'გაასწორეთ საჭე და გააგრძელეთ გზა.', gear: 'D',
            track: { frame: f, b: laneB(g) - 0.4, lookahead: 5 }, speed: 1.2, indicator: 'off' };
        }
        default:
          return null;
      }
      return this.update(veh, ev, time);
    },
  };
}

function poseAt(g, aRA, bRA, rel) {
  const p = toWorld(g.frame, aRA, bRA);
  return { x: p.x, z: p.z, heading: Math.atan2(g.frame.f.z, g.frame.f.x) + rel };
}
