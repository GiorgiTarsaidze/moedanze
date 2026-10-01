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
    // poles on both long sides, just outside the lines, evenly spaced from the entrance corner to the back
    // corner (annex 4). near = the side the car passes first (its left when parked); near2 = its second pole.
    posts: Array.from({ length: dims.GARAGE_POLES_PER_SIDE }, (_, i) => LEN * i / (dims.GARAGE_POLES_PER_SIDE - 1)).flatMap((b, i) => [
      { p: toWorld(frame, -h - 0.2, b), name: i ? 'გარაჟის გვერდითი ჯოხი' : 'შესასვლელის ახლო ჯოხი', role: `near${i + 1}` },
      { p: toWorld(frame, h + 0.2, b), name: i ? 'გარაჟის გვერდითი ჯოხი' : 'შესასვლელის შორეული ჯოხი', role: `far${i + 1}` },
    ]),
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
// Coach — the driving-school method with the garage poles:
//  a. drive past the box ~2.4 m from its entrance line; stop when the far entrance pole is at the rear
//     edge of the right rear side window (yellow dot = where it must be for this lane);
//  b. full right lock, reverse until the car is straight in the box (both mirrors);
//  c. straighten, reverse until the left mirror passes the second pole on the left, then stop.
// A full-lock arc started with the rear axle at a = R ends straight in the middle of the box, and seen
// from the driver's seat the far pole is then at the rear edge of the rear side window when the gap is
// ~2.4 m (closer to the box it hides behind the rear pillar, further away it sits on the glass).
// ------------------------------------------------------------------------------------------
export function createCoach(env) {
  const { vehicle: V } = env;
  const P = V.P, R = V.D.MIN_REAR_AXLE_RADIUS;
  const GAP = 2.4, GAP_MIN = 2.0, GAP_MAX = 2.8;
  const laneB = -(GAP + P.CAR_WIDTH / 2);
  const stopA = R;                                   // rear axle a at which to start the arc
  let step = 'approach', t0 = 0, g = null, arcStart = null;

  const pose = (a, b, rel) => { const p = toWorld(g.frame, a, b); return { x: p.x, z: p.z, heading: Math.atan2(g.frame.f.z, g.frame.f.x) + rel }; };
  const post = (role) => g.posts.find((p) => p.role === role).p;

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
      const farPost = post('far1'), second = post('near2');
      const d = stopA - ra.a;                        // distance to the stopping point (+ = ahead)
      const gap = -ra.b - P.CAR_WIDTH / 2;
      const laneNow = Math.round(ra.b * 20) / 20;
      const stopDot = { id: 'gar-stop', target: farPost, pose: pose(stopA, laneNow, 0), views: [] };

      switch (step) {
        case 'approach': {
          const hit = env.aligned(stopDot);
          if ((d < 0.15 || hit) && still) { go(d < -0.35 && !hit ? 'backUp' : 'toReverse'); break; }
          const hint = gap < GAP_MIN ? 'გარაჟთან ძალიან ახლოს ხართ, გადაიწიეთ მარცხნივ, შესასვლელის ხაზამდე დაახლოებით 2.4 მ'
            : gap > GAP_MAX ? 'ძალიან შორს ხართ, მიუახლოვდით გარაჟს, შესასვლელის ხაზამდე დაახლოებით 2.4 მ' : '';
          return { step, title: 'მიუახლოვდით გარაჟს', text: 'გაიარეთ გარაჟის გასწვრივ, შესასვლელის ხაზიდან დაახლოებით 2.4 მ-ში. გაჩერდით, როცა შესასვლელის შორეული ჯოხი მარჯვენა უკანა ფანჯრის უკანა კიდესთან (ყვითელ წერტილთან) მივა',
            hint, readout: hit ? 'ყვითელი ნიშანი დაემთხვა! გაჩერდით' : d < 12 ? `გაჩერების წერტილამდე ${Math.max(0, d).toFixed(1)} მ · ხაზამდე ${gap.toFixed(1)} მ` : '', gear: 'D', track: { frame: f, b: laneB },
            speed: clamp(d * 0.8, 0, 2.0), stop: d < 0.15 || hit, ghost: { frame: f, a: stopA, b: laneB, rel: 0 },
            sticker: stopDot, focus: farPost };
        }
        case 'backUp':
          // stopped past the point: reverse straight back (same reverse move as the arc, no extra engagement)
        {
          const hit = env.aligned(stopDot);
          if ((d > -0.15 || hit) && still) { go('lockRight'); break; }
          return { step, title: 'გადასცდით გაჩერების წერტილს', text: 'ჩართეთ R, საჭე სწორად, ნელა იმოძრავეთ უკან, სანამ შორეული ჯოხი ყვითელ წერტილს არ დაემთხვევა. შემდეგ გაჩერდით',
            readout: hit ? 'ყვითელი ნიშანი დაემთხვა! გაჩერდით' : `${Math.max(0, -d).toFixed(2)} მ`, gear: 'R', steer: 0, speed: clamp(-d * 0.8, 0.12, 0.6), stop: d > -0.15 || hit,
            sticker: stopDot, focus: farPost };
        }
        case 'toReverse':
          if (veh.gear === 'R') { go('lockRight'); break; }
          return { step, title: 'ჩართეთ უკუსვლა', text: 'დააჭირეთ მუხრუჭს და ჩართეთ R', gear: 'R', stop: true, sticker: stopDot, focus: farPost };
        case 'lockRight':
          if (veh.steerWheel >= V.D.MAX_STEERING_WHEEL_ANGLE * 0.98) { arcStart = ra; go('arc'); break; }
          return { step, title: 'საჭე ბოლომდე მარჯვნივ', text: 'დაძვრამდე მოაბრუნეთ საჭე ბოლომდე მარჯვნივ', gear: 'R', steer: 1, stop: true };
        case 'arc': {
          const r = -rel / DEG;
          const s = arcStart || ra;                  // the full-lock arc ends R back and R into the box
          const straight = { id: 'gar-straight', target: toWorld(f, -g.W / 2, g.LEN), pose: pose(s.a - R, s.b + R, -Math.PI / 2), views: ['left', 'right'] };
          const hit = env.aligned(straight);
          if ((r >= 89.3 || hit) && still) { go('center'); break; }
          return { step, title: 'შედით გარაჟში', text: 'ნელა იმოძრავეთ უკუსვლით, საჭე ბოლომდე მარჯვნივ, სანამ ორივე სარკეში არ დაინახავთ, რომ მანქანა გარაჟში სწორად ჯდება (ხაზები მანქანის პარალელურია)',
            readout: hit ? 'ყვითელი ნიშანი დაემთხვა! გაჩერდით' : `კუთხე ${r.toFixed(0)}° / 90°`, gear: 'R', steer: 1, speed: clamp((90 - r) * 0.03, 0.1, 0.7), stop: r >= 89.3 || hit,
            sticker: straight };
        }
        case 'center':
          // ±25° of steering wheel: a keyboard tap moves it 20–40°; left uncorrected the car still parks cleanly
          if (Math.abs(veh.steerWheel) < 0.44) { go('reverseIn'); break; }
          return { step, title: 'გაასწორეთ საჭე', text: 'დააბრუნეთ საჭე შუა მდგომარეობაში', gear: 'R', steer: 0, stop: true,
            readout: `საჭე: ${Math.abs(veh.steerWheel / DEG).toFixed(0)}° ${veh.steerWheel > 0 ? 'მარჯვნივ' : 'მარცხნივ'}` };
        case 'reverseIn': {
          const mb = toLocal(f, veh.mirrorPoints()[0]).b, pb = toLocal(f, second).b;
          const d = pb - mb;                         // left mirror still this far before the second pole
          const lat = ra.a;                          // lateral offset in the box
          if (d < 0.05 && still) { go('stopped'); break; }
          return { step, title: 'შედით ბოლომდე', text: 'იმოძრავეთ უკუსვლით პირდაპირ. გაჩერდით, როცა მარცხენა ფანჯარაში დაინახავთ, რომ მარცხენა სარკემ მეორე ჯოხს გაასწრო. თუ სარკეში ჩანს, რომ ერთ მხარეს მიიწევთ, ნაზად გაასწორეთ',
            readout: `სარკე მეორე ჯოხამდე ${Math.max(0, d).toFixed(2)} მ`, gear: 'R', steer: clamp(-lat * 1.2 + wrapAngle(rel + Math.PI / 2) * 2.0, -0.4, 0.4), speed: clamp(d * 0.6, 0.1, 0.6), stop: d < 0.05,
            focus: second };
        }
        case 'stopped':
          if (time - t0 > 1.5) { go('exitPrep'); break; }
          return { step, title: 'გაჩერდით გარაჟში', text: 'გაჩერდით. გასვლამდე მთელი მანქანა გარაჟის შიგნით უნდა იყოს', stop: true, steer: 0 };
        case 'exitPrep':
          if (veh.gear === 'D') { go('exit'); break; }
          return { step, title: 'გამოდით გარაჟიდან', text: 'ჩართეთ D (F ღილაკზე)', gear: 'D', stop: true };
        case 'exit': {
          const rbb = toLocal(f, veh.rearBumper()).b;  // rear bumper depth in the box
          if (rbb < -0.6) { go('turnOut'); break; }
          return { step, title: 'გამოსვლა', text: 'გამოდით გარაჟიდან', gear: 'D', steer: 0, speed: 1.0 };
        }
        case 'turnOut': {
          if (ev.status !== 'active' && Math.abs(rel) < 0.3) { go('done'); break; }
          if (Math.abs(rel) > 0.25) return { step, title: 'მოუხვიეთ მარჯვნივ', text: 'მოუხვიეთ მარჯვნივ და გააგრძელეთ გზა.', gear: 'D', steer: 1, speed: 1.0 };
          return { step, title: 'გააგრძელეთ', text: 'გააგრძელეთ გზა', gear: 'D', track: { frame: f, b: laneB }, speed: 1.2 };
        }
        default: return null;
      }
      return this.update(veh, ev, time);
    },
  };
}
