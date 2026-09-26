// Exercise 4 — Reverse parking into a box / garage (უკუსვლით პარკირება / გარაჟი)
//
// Station frame: origin = centre of the box entrance, f = travel direction along the road,
// b = into the box (the box is on the candidate's right). Box: a in [-W/2, W/2], b in [0, LEN].
// At Rustavi the boxes are the four hatched pockets cut into the kerbed lawns.

import { makeFrame, toLocal, toWorld, line, dashed, hatch, L, tyreTouches, allInsideRect, fractionInsideRect,
  relHeading, bodyOutline, StandstillTracker, DirectionTracker, RollTracker, ElementEvaluator } from './common.js';
import { DEG, clamp, wrapAngle } from '../math2d.js';

export function buildStation(st, dims) {
  const W = dims.GARAGE_WIDTH, LEN = dims.GARAGE_LENGTH, lw = dims.LINE_WIDTH;
  const frame = makeFrame(st.o, st.f);
  const h = W / 2;
  const g = {
    id: st.id, frame, W, LEN,
    box: { a0: -h, a1: h, b0: 0, b1: LEN },
    lines: [
      { name: 'გარაჟის გვერდითი ხაზი', a: toWorld(frame, -h + lw / 2, 0), b: toWorld(frame, -h + lw / 2, LEN) },
      { name: 'გარაჟის გვერდითი ხაზი', a: toWorld(frame, h - lw / 2, 0), b: toWorld(frame, h - lw / 2, LEN) },
      { name: 'გარაჟის ბოლო ხაზი', a: toWorld(frame, -h, LEN - lw / 2), b: toWorld(frame, h, LEN - lw / 2) },
    ],
    posts: [
      { p: toWorld(frame, -h - 0.2, -0.2), name: 'შესასვლელის ახლო ჯოხი' },
      { p: toWorld(frame, h + 0.2, -0.2), name: 'შესასვლელის შორეული ჯოხი' },
    ],
    markings: [
      line(L(frame, [[-h + lw / 2, 0], [-h + lw / 2, LEN - lw / 2], [h - lw / 2, LEN - lw / 2], [h - lw / 2, 0]]), lw),
      dashed(L(frame, [[-h, 0], [h, 0]]), 0.1, 0.4, 0.3),
      hatch(L(frame, [[-h, 0], [h, 0], [h, LEN], [-h, LEN]]), 0.9, 45, 0.06),
    ],
  };
  g.posts.forEach((p, i) => { p.id = `garage-${st.id}-post${i}`; });
  return g;
}

export class GarageEvaluator extends ElementEvaluator {
  constructor(ctx, stations) {
    super('garage', ctx);
    this.stations = stations;
    this.still = new StandstillTracker();
    this.dir = new DirectionTracker();
    this.roll = new RollTracker();
    this.parkEval = null;
  }

  update(veh, dt, time) {
    const st = this.still.update(veh.v, dt);
    if (this.status === 'waiting') return this.tryEngage(veh, st, time);
    if (this.status !== 'active') return;
    const g = this.station, f = g.frame, B = g.box;
    this.dir.update(veh.v, dt);
    const outline = bodyOutline(veh);
    const frac = fractionInsideRect(f, outline, B.a0, B.a1, B.b0, B.b1 + 0.3);

    if (this.phase !== 'exit' && !this.parkEval) {
      if (this.dir.reverseSegments > 1) this.penalize('multipleReverse', `უკუსვლა ${this.dir.reverseSegments}-ჯერ`);
      const rolled = this.roll.update(veh, dt);
      if (rolled > this.ctx.rules.rollTolerance) this.penalize('rolled', `${(rolled * 100).toFixed(0)} სმ`);
    }
    const wheels = veh.wheels();
    for (const ln of g.lines) if (tyreTouches(wheels, ln.a, ln.b, this.ctx.dims.LINE_WIDTH).length) this.penalize('markingOrPost', ln.name);
    for (const c of this.newContacts(veh)) this.penalize('markingOrPost', c.label);

    if (st > 0.5 && frac > 0.6 && this.phase !== 'exit') {
      this.phase = 'parked';
      const inside = allInsideRect(f, outline, B.a0 + 0.06, B.a1 - 0.06, B.b0, B.b1 - 0.06);
      this.parkEval = { inside, heading: relHeading(f, veh.heading) };
    }
    if (this.phase !== 'exit' && this.parkEval && veh.v > 0.05 && outline.some((p) => toLocal(f, p).b < 0)) {
      this.phase = 'exit';
      if (!this.parkEval.inside) this.penalize('notFullyInside');
      if (!veh.indicatorActive('right') && !veh.indicatorActive('left')) this.penalize('noIndicatorOnExit');
    }
    if (this.phase === 'exit' && outline.every((p) => toLocal(f, p).b < -0.2)) this.complete();
    const c = toLocal(f, veh.center());
    if (!this.parkEval && (Math.abs(c.a) > 16 || c.b < -9)) this.fail('notPerformed');
    this.info = { station: g.id, phase: this.phase, reverseMoves: this.dir.reverseSegments, inside: this.parkEval?.inside, inBox: frac };
  }

  tryEngage(veh, stillTime, time) {
    for (const g of this.stations) {
      const f = g.frame;
      const c = toLocal(f, veh.center());
      const rel = Math.abs(relHeading(f, veh.heading));
      if (veh.gear === 'R' && stillTime > 0.2 && c.a > g.W / 2 && c.a < g.W / 2 + 9 && c.b > -6.5 && c.b < -1.2 && rel < 35 * DEG) {
        this.engage(g, time); this.phase = 'positioned'; return;
      }
      if (fractionInsideRect(f, bodyOutline(veh), g.box.a0, g.box.a1, 0, g.box.b1) > 0.15) { this.engage(g, time); this.phase = 'manoeuvre'; return; }
    }
  }

  skipped(veh) {
    const last = this.stations[this.stations.length - 1];
    const c = toLocal(last.frame, veh.center());
    return c.a > 25 && c.b > -12 && c.b < 3;
  }
}

// ------------------------------------------------------------------------------------------
// Coach: stop past the box, one reverse arc at full lock into the box, straighten, reverse in.
// ------------------------------------------------------------------------------------------
export function createCoach(env) {
  const { vehicle: V } = env;
  const P = V.P, R = V.D.MIN_REAR_AXLE_RADIUS;
  // Approach gap (car side -> box entrance). A full-lock arc started with the rear axle at a = R
  // ends centred in the box. Its inner side clears the far post and the far box corner only if the
  // gap is ~1.5-2.3 m (measured on all four boxes); closer, the far corner is cut.
  const GAP = 1.8, GAP_MIN = 1.5, GAP_MAX = 2.3;
  const laneB = -(GAP + P.CAR_WIDTH / 2);
  const stopA = R;                                   // rear axle a at which to start the arc
  let step = 'approach', t0 = 0, g = null, arcStart = null;

  const pose = (a, b, rel) => { const p = toWorld(g.frame, a, b); return { x: p.x, z: p.z, heading: Math.atan2(g.frame.f.z, g.frame.f.x) + rel }; };

  return {
    id: 'garage',
    jump(s) { step = s; },
    get step() { return step; },
    reset() { step = 'approach'; g = null; arcStart = null; },
    update(veh, ev, time) {
      if (!g) g = ev.station || env.stations[0];
      const f = g.frame;
      const ra = toLocal(f, { x: veh.x, z: veh.z });
      const rel = relHeading(f, veh.heading);
      const still = Math.abs(veh.v) < 0.03;
      const go = (s) => { step = s; t0 = time; };
      const farPost = g.posts[1].p;
      const d = stopA - ra.a;                        // distance to the stopping point (+ = ahead)
      // Stop reference for the lane the car is actually in (like the parallel-parking sticker):
      // the mirror angle to the post depends on the gap, so a fixed sticker gave wrong stops.
      const gap = -ra.b - P.CAR_WIDTH / 2;
      const refB = Math.round(-(clamp(gap, GAP_MIN, GAP_MAX) + P.CAR_WIDTH / 2) * 20) / 20;
      const stopSticker = (reverse) => ({ id: 'gar-stop', target: farPost, pose: pose(stopA, refB, 0), views: ['right'], reverse });

      switch (step) {
        case 'approach': {
          if (d < 0.2 && still) { go(d < -0.25 ? 'backUp' : 'toReverse'); break; }
          const hint = gap < GAP_MIN - 0.05 ? 'ძალიან ახლოს ხართ გარაჟთან — გადაიწიეთ მარცხნივ, ხაზამდე დაახლოებით 1.8 მ. ახლოდან მობრუნებისას მანქანა შორეულ ჯოხს ან ხაზს მოედება.'
            : gap > GAP_MAX + 0.05 ? 'ძალიან შორს ხართ — მიუახლოვდით გარაჟს, ხაზამდე დაახლოებით 1.8 მ.' : '';
          return { step, title: 'მიუახლოვდით გარაჟს', text: 'გაიარეთ გარაჟის გასწვრივ, შესასვლელის ხაზიდან დაახლოებით 1.8 მ-ში (მოჩვენებითი მანქანა). გაჩერდით, როცა შესასვლელის შორეული ჯოხი მარჯვენა სარკეში ყვითელ ნიშანს მიაღწევს.',
            hint, readout: d < 12 ? `გაჩერების წერტილამდე ${Math.max(0, d).toFixed(1)} მ · ხაზამდე ${gap.toFixed(1)} მ` : '', gear: 'D', track: { frame: f, b: laneB },
            speed: clamp(d * 0.8, 0, 2.0), stop: d < 0.03, ghost: { frame: f, a: stopA, b: laneB, rel: 0 },
            sticker: stopSticker(false), focus: farPost };
        }
        case 'backUp':
          // stopped past the point: reverse straight back (same reverse move as the arc, no extra engagement)
          if (d > -0.05 && still) { go('lockRight'); break; }
          return { step, title: 'გადასცდით გაჩერების წერტილს', text: 'ჩართეთ R და საჭე სწორად ნელა იმოძრავეთ უკან, სანამ შორეული ჯოხი ყვითელ ნიშანს არ დაემთხვევა. შემდეგ გაჩერდით.',
            readout: `${Math.max(0, -d).toFixed(2)} მ`, gear: 'R', steer: 0, speed: clamp(-d * 0.8, 0.12, 0.6), stop: d > -0.05,
            sticker: stopSticker(true), focus: farPost };
        case 'toReverse':
          if (veh.gear === 'R') { go('lockRight'); break; }
          return { step, title: 'ჩართეთ უკუსვლა', text: 'დააჭირეთ მუხრუჭს და ჩართეთ R. მარჯვენა სარკე დაიხრება და გარაჟის ხაზს გაჩვენებთ.', gear: 'R', stop: true,
            sticker: stopSticker(veh.gear === 'R'), focus: farPost };
        case 'lockRight':
          if (veh.steerWheel >= V.D.MAX_STEERING_WHEEL_ANGLE * 0.98) { arcStart = ra; go('arc'); break; }
          return { step, title: 'საჭე ბოლომდე მარჯვნივ', text: 'დაძვრამდე მოაბრუნეთ საჭე ბოლომდე მარჯვნივ.', gear: 'R', steer: 1, stop: true,
            sticker: stopSticker(true), focus: farPost };
        case 'arc': {
          const r = -rel / DEG;
          if (r >= 89.3 && still) { go('center'); break; }
          const s = arcStart || ra;                  // the full-lock arc ends R back and R into the box
          return { step, title: 'შედით გარაჟში', text: 'ნელა იმოძრავეთ უკუსვლით, საჭე ბოლომდე მარჯვნივ. უყურეთ ორივე სარკეს: გარაჟის ხაზები მანქანის პარალელური უნდა გახდეს.',
            readout: `კუთხე ${r.toFixed(0)}° / 90°`, gear: 'R', steer: 1, speed: clamp((90 - r) * 0.03, 0.1, 0.7), stop: r >= 89.3,
            sticker: { id: 'gar-straight', target: toWorld(f, -g.W / 2, g.LEN), pose: pose(s.a - R, s.b + R, -Math.PI / 2), views: ['left', 'right'] } };
        }
        case 'center':
          // ±25° of steering wheel: a keyboard tap moves it 20–40°; left uncorrected the car still parks cleanly
          if (Math.abs(veh.steerWheel) < 0.44) { go('reverseIn'); break; }
          return { step, title: 'გაასწორეთ საჭე', text: 'დააბრუნეთ საჭე შუა მდგომარეობაში.', gear: 'R', steer: 0, stop: true,
            readout: `საჭე: ${Math.abs(veh.steerWheel / DEG).toFixed(0)}° ${veh.steerWheel > 0 ? 'მარჯვნივ' : 'მარცხნივ'}` };
        case 'reverseIn': {
          const rb = toLocal(f, veh.rearBumper()).b;
          const d = (g.LEN - 0.45) - rb;
          const lat = ra.a;                          // lateral offset in the box
          if (d < 0.05 && still) { go('stopped'); break; }
          return { step, title: 'შედით ბოლომდე', text: 'იმოძრავეთ უკუსვლით პირდაპირ, სანამ უკანა ნაწილი ბოლო ხაზამდე დაახლოებით 0.5 მ-ზე არ იქნება. თუ სარკეში ჩანს, რომ ერთ მხარეს მიიწევთ, ნაზად გაასწორეთ.',
            readout: `დარჩა ${Math.max(0, d).toFixed(2)} მ`, gear: 'R', steer: clamp(-lat * 1.2 + wrapAngle(rel + Math.PI / 2) * 2.0, -0.4, 0.4), speed: clamp(d * 0.6, 0.1, 0.6), stop: d < 0.05 };
        }
        case 'stopped':
          if (time - t0 > 1.5) { go('exitPrep'); break; }
          return { step, title: 'გაჩერდით გარაჟში', text: 'გაჩერდით. გასვლამდე მთელი მანქანა გარაჟის შიგნით უნდა იყოს.', stop: true, steer: 0 };
        case 'exitPrep':
          if (veh.gear === 'D' && veh.indicatorActive('right')) { go('exit'); break; }
          return { step, title: 'გამოდით გარაჟიდან', text: 'ჩართეთ მარჯვენა მოხვევის მაჩვენებელი (E) და D (F).', gear: 'D', indicator: 'right', stop: true };
        case 'exit': {
          const rbb = toLocal(f, veh.rearBumper()).b;  // rear bumper depth in the box
          if (rbb < -0.6) { go('turnOut'); break; }
          return { step, title: 'გამოსვლა', text: 'გამოდით გარაჟიდან პირდაპირ.', gear: 'D', steer: 0, speed: 1.0, indicator: 'right' };
        }
        case 'turnOut': {
          if (ev.status !== 'active' && Math.abs(rel) < 0.3) { go('done'); break; }
          if (Math.abs(rel) > 0.25) return { step, title: 'მოუხვიეთ მარჯვნივ', text: 'მოუხვიეთ მარჯვნივ და გააგრძელეთ გზა.', gear: 'D', steer: 1, speed: 1.0, indicator: 'right' };
          return { step, title: 'გააგრძელეთ', text: 'გააგრძელეთ გზა.', gear: 'D', track: { frame: f, b: laneB }, speed: 1.2, indicator: 'off' };
        }
        default: return null;
      }
      return this.update(veh, ev, time);
    },
  };
}
