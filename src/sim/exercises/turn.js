// Exercise 3 — Turning in a limited-width area / dead end (შეზღუდული სიგანის შემოსაბრუნებელი უბანი, ჩიხი)
//
// Station frame: origin = centre of the entrance (stop line), f = into the dead end (north at
// Rustavi), b = to the right. Zone: a in [0, DEPTH], b in [-W/2, W/2]. The stop line covers the
// right half (entry side); the car must leave through the left half, i.e. turned around, using
// only one reverse manoeuvre.

import { makeFrame, toLocal, toWorld, line, text, L, tyreTouches, relHeading, bodyOutline,
  DirectionTracker, ElementEvaluator } from './common.js';
import { DEG, clamp, wrapAngle } from '../math2d.js';
import { worldToLocal, eyeBearing, inWindscreen } from '../optics.js';

export function buildStation(st, dims) {
  const W = dims.TURN_WIDTH, hw = W / 2, Dp = dims.TURN_DEPTH, lw = dims.LINE_WIDTH;
  const frame = makeFrame(st.o, st.f);
  const heading = Math.atan2(st.f.z, st.f.x);
  const posts = [];
  // Side rows: `leftPosts: false` / `rightOffset` let two neighbouring lanes share one row of poles.
  const off = dims.TURN_POST_OFFSET, offR = st.rightOffset ?? off, left = st.leftPosts !== false, sp = dims.TURN_POST_SPACING;
  for (const a of dims.TURN_POSTS_A) {                     // the corner post closes each row
    if (left) posts.push({ p: toWorld(frame, a, -hw - off), name: 'მარცხენა კიდის ჯოხი' });
    posts.push({ p: toWorld(frame, a, hw + offR), name: 'მარჯვენა კიდის ჯოხი' });
  }
  for (let b = -hw + sp; b < hw - 0.5; b += sp) posts.push({ p: toWorld(frame, Dp + off, b), name: 'ბოლო ჯოხი' });
  if (left) posts.push({ p: toWorld(frame, Dp + off, -hw - off), name: 'კუთხის ჯოხი' });
  posts.push({ p: toWorld(frame, Dp + off, hw + offR), name: 'კუთხის ჯოხი' });
  posts.forEach((p, i) => { p.id = `turn-${st.id}-post${i}`; });
  const g = {
    id: st.id, frame, W, hw, D: Dp, posts,
    post2R: { a: dims.TURN_POSTS_A[1], p: toWorld(frame, dims.TURN_POSTS_A[1], hw + offR) },   // turning reference
    lines: [
      { name: 'მარცხენა კიდის ხაზი', a: toWorld(frame, 0, -hw), b: toWorld(frame, Dp, -hw) },
      { name: 'მარჯვენა კიდის ხაზი', a: toWorld(frame, 0, hw), b: toWorld(frame, Dp, hw) },
      { name: 'ბოლო ხაზი', a: toWorld(frame, Dp, -hw), b: toWorld(frame, Dp, hw) },
      { name: 'შესასვლელის ხაზი', a: toWorld(frame, 0, -hw), b: toWorld(frame, 0, hw), entrance: true },
    ],
    markings: [
      line(L(frame, [[0, -hw], [Dp, -hw], [Dp, hw], [0, hw]]), lw),
      line(L(frame, [[0, 0], [0, hw]]), 0.3),
      text('სდექ', toWorld(frame, -1.2, hw / 2), heading, 0.8),
    ],
  };
  return g;
}

export class TurnEvaluator extends ElementEvaluator {
  constructor(ctx, stations) {
    super('turn', ctx);
    this.stations = stations;
    this.dir = new DirectionTracker(0.1);
    this.minRel = 0;
    this.turned = false;
    this.fullyIn = false;
  }

  update(veh, dt, time) {
    if (this.status === 'waiting') {
      for (const g of this.stations) {
        const fb = toLocal(g.frame, veh.frontBumper()), c = toLocal(g.frame, veh.center());
        if (fb.a > 0 && fb.a < 4 && Math.abs(c.b) < g.hw + 1.5 && Math.abs(relHeading(g.frame, veh.heading)) < 60 * DEG) {
          this.engage(g, time); this.phase = 'entering';
          if (c.b < 0) this.penalize('wrongStart', 'შევიდა მარცხენა ნახევრიდან');
          break;
        }
      }
      return;
    }
    if (this.status !== 'active') return;
    const g = this.station, f = g.frame;
    this.dir.update(veh.v, dt);
    const outline = bodyOutline(veh);
    const loc = outline.map((p) => toLocal(f, p));
    const rel = relHeading(f, veh.heading);
    if (Math.abs(rel) > 150 * DEG) this.turned = true;
    if (loc.every((l) => l.a > 0.05)) this.fullyIn = true;

    if (this.dir.reverseSegments > 1) this.penalize('tooManyGearChanges', `უკუსვლა ${this.dir.reverseSegments}-ჯერ`);

    const wheels = veh.wheels();
    const turning = this.fullyIn && !this.turned;
    for (const ln of g.lines) {
      if (ln.entrance && !turning) continue;              // crossing the entrance is how you enter/leave
      if (tyreTouches(wheels, ln.a, ln.b, this.ctx.dims.LINE_WIDTH).length) this.penalize('markingOrPost', ln.name);
    }
    for (const ct of this.newContacts(veh)) this.penalize('markingOrPost', ct.label);

    // leaving the zone over the side / end boundaries -> disqualification
    const tol = 0.10;
    if (loc.some((l) => l.a > 0 && (l.b < -g.hw - tol || l.b > g.hw + tol || l.a > g.D + tol))) this.penalize('leftZone');

    // exit: the whole car back out over the entrance line
    if (this.fullyIn && loc.every((l) => l.a < -0.05)) {
      const c = toLocal(f, veh.center());
      if (!this.turned || Math.abs(rel) < 120 * DEG) this.penalize('notTurned');
      else if (c.b > 0) this.penalize('wrongExit', 'გამოვიდა შესასვლელი (მარჯვენა) მხრიდან');
      if (this.status === 'active') this.complete();
    } else if (!this.fullyIn && loc.every((l) => l.a < -1.0) && this.elapsedSinceEngage(time) > 2) {
      this.fail('notPerformed');
    }
    this.info = { station: g.id, reverseMoves: this.dir.reverseSegments, turned: this.turned, heading: (rel / DEG).toFixed(0) };
  }
  elapsedSinceEngage(time) { return time - this.startTime; }

  skipped(veh) {
    // reached the figure-eight area without entering a dead end
    const fig = this.ctx.course.elements.figure8.stations[0];
    const dx = veh.x - fig.top.x, dz = veh.z - fig.top.z;
    return Math.hypot(dx, dz) < 7;
  }
}

// ------------------------------------------------------------------------------------------
// Coach: 3-point turn with ONE reverse, as Georgian instructors teach it, checked in the simulator
// on the real-size box (9.2 x 8.2 m) with keyboard steering and brake-controlled ~3 km/h:
//  - enter in the right half without stopping (the stop line is only a waiting line);
//  - when the SECOND right pole appears in the right front window (the nose just past it) turn fully
//    left while rolling — works from 0.3 m before to 0.9 m past the pole, entering anywhere from the
//    middle of the right half to 0.4 m from the right poles;
//  - stop ~0.5 m before the LEFT poles: the car stands slightly diagonal (~70–83°). Stopping early
//    at the far line (~45°) leaves no room for the reverse;
//  - full right, R, reverse until the left side's first pole appears in the windscreen (~102°); D, full left, out.
// ------------------------------------------------------------------------------------------
export function createCoach(env) {
  const { vehicle: V, dims } = env;
  const P = V.P, NOSE = P.WHEELBASE + P.FRONT_OVERHANG;
  const PAST = 0.3, LEFT_GAP = 0.5, SLOW = 0.8;   // PAST: nose past the 2nd pole (window -0.3..0.9 m)
  let step = 'approach', g = null, t0 = 0;
  return {
    id: 'turn',
    jump(s) { step = s; },
    get step() { return step; },
    reset() { step = 'approach'; g = null; },
    update(veh, ev, time) {
      if (!g || (ev.station && ev.station !== g)) g = ev.station || env.stations[0];
      const f = g.frame;
      const ra = toLocal(f, { x: veh.x, z: veh.z });
      const fb = toLocal(f, veh.frontBumper());
      const rel = relHeading(f, veh.heading);
      let r = -rel / DEG; if (r < -90) r += 360;          // degrees turned to the left, 0..~200
      const still = Math.abs(veh.v) < 0.03;
      const loc = bodyOutline(veh).map((p) => toLocal(f, p));
      const go = (s) => { step = s; t0 = time; };
      const laneR = g.hw / 2, laneL = -g.hw / 2;
      const clearLeft = Math.min(...loc.map((l) => l.b + g.hw));
      const clearEnd = Math.min(...loc.map((l) => g.D - l.a));
      const clearRight = Math.min(...loc.map((l) => g.hw - l.b));
      const clearBack = Math.min(...loc.map((l) => l.a));
      const MAXS = V.D.MAX_STEERING_WHEEL_ANGLE * 0.98;
      const aTurn = g.post2R.a + PAST - NOSE;             // rear axle a where full left lock begins
      const post2 = g.post2R.p;
      // reverse stop cue: the left side's first pole (next to the entrance) appears in the windscreen
      // (the second lane shares the first lane's pole row, so take the nearest pole of either lane)
      const want1L = toWorld(f, dims.TURN_POSTS_A[0], -g.hw);
      const pole1L = env.stations.flatMap((st) => st.posts).reduce((best, p) => (Math.hypot(p.p.x - want1L.x, p.p.z - want1L.z) < Math.hypot(best.x - want1L.x, best.z - want1L.z) ? p.p : best), { x: 1e9, z: 1e9 });
      const pl1 = { ...worldToLocal({ x: veh.x, z: veh.z, heading: veh.heading }, pole1L), y: 0.8 };
      const pole1Seen = inWindscreen(pl1, P), toPillar = eyeBearing(pl1, P).yaw / DEG - P.WINDSCREEN_EDGE_DEG.left;
      const pose = (a, b) => { const p = toWorld(f, a, b); return { x: p.x, z: p.z, heading: Math.atan2(f.f.z, f.f.x) }; };
      switch (step) {
        case 'approach': {
          // reference dot for the lane the car is actually in, so "matched" means "at the turning point"
          const d = aTurn - ra.a, second = { id: 'turn-2nd', target: post2, pose: pose(aTurn, Math.round(ra.b * 20) / 20), views: [] };
          if (d <= 0) { go('turnLeft'); break; }
          const hit = env.aligned(second);            // green ~0.15 m before the point: the hint already says "now"
          return { step, title: 'ჩიხი: შესვლა', text: 'შედით ჩიხში მარჯვენა მხრიდან. სდექ-ხაზთან გაჩერება საჭირო არ არის, თუ ჩიხი თავისუფალია',
            hint: 'როცა მარჯვენა მხარის მეორე ჯოხი მარჯვენა წინა ფანჯარაში გამოჩნდება (ცხვირი ოდნავ გასცდება მას), გაუჩერებლად მოაბრუნეთ საჭე ბოლომდე მარცხნივ.',
            readout: hit ? 'საჭე ბოლომდე მარცხნივ' : fb.a > -6 ? `მობრუნების წერტილამდე ${d.toFixed(1)} მ` : '', gear: 'D', track: { frame: f, b: laneR },
            speed: ra.a < -4 ? 1.4 : SLOW, highlight: g.lines.slice(0, 3), focus: post2,
            sticker: second };
        }
        case 'turnLeft':
          if (veh.steerWheel <= -MAXS) { go('forwardArc'); break; }
          return { step, title: 'საჭე ბოლომდე მარცხნივ, გაუჩერებლად', text: 'ახლავე მოაბრუნეთ საჭე ბოლომდე მარცხნივ და ნელა განაგრძეთ მოძრაობა',
            gear: 'D', steer: -1, speed: SLOW, focus: post2 };
        case 'forwardArc': {
          const near = clearLeft < LEFT_GAP + 0.05 || clearEnd < 0.35;
          if (near && still) { go('toReverse'); break; }
          return { step, title: 'მიუახლოვდით მარცხენა ჯოხებს', text: 'საჭე ბოლომდე მარცხნივ, ნელა იმოძრავეთ წინ. გაჩერდით მარცხენა ჯოხებამდე, მანქანა ოდნავ დიაგონალურად დადგება',
            hint: still && r < 60 ? 'ჯერ ადრეა: ბოლო ხაზთან ნუ გაჩერდებით, განაგრძეთ მოძრაობა მარცხენა ჯოხებამდე, თორემ უკუსვლისთვის ადგილი არ დაგრჩებათ' : '',
            readout: `მარცხენა ხაზამდე ${clearLeft.toFixed(2)} მ · კუთხე ${r.toFixed(0)}°`, gear: 'D', steer: -1,
            speed: clamp(Math.min(clearLeft - LEFT_GAP, clearEnd - 0.35) * 0.8, 0.08, SLOW), stop: near, highlight: g.lines.slice(0, 3) };
        }
        case 'toReverse':
          if (veh.gear === 'R' && veh.steerWheel >= MAXS) { go('reverseArc'); break; }
          return { step, title: 'უკუსვლა, საჭე ბოლომდე მარჯვნივ', text: 'გაჩერებული მანქანით, მოაბრუნეთ საჭე ბოლომდე მარჯვნივ და ჩართეთ R. უკუსვლა მხოლოდ ერთხელ შეიძლება', gear: 'R', steer: 1, stop: true };
        case 'reverseArc': {
          const c = Math.min(clearRight, clearBack);
          const done = pole1Seen || c < 0.45;                // c: safety stop before the right / entrance side
          if (done && still) { go('toDrive'); break; }
          return { step, title: 'უკუსვლა', text: 'ნელა იმოძრავეთ უკუსვლით, საჭე ბოლომდე მარჯვნივ. გაჩერდით, როცა მარცხენა მხარის პირველი ჯოხი წინა მინაში გამოჩნდება',
            readout: pole1Seen ? 'ჯოხი წინა მინაშია, გაჩერდით' : `ჯოხი მინის მარცხენა მხრიდან ${Math.max(0, -toPillar).toFixed(0)}° · უკან დარჩა ${c.toFixed(2)} მ`, gear: 'R', steer: 1,
            speed: clamp(-toPillar * 0.03, 0.08, 0.6), stop: done, focus: pole1L };
        }
        case 'toDrive':
          if (veh.gear === 'D' && veh.steerWheel <= -MAXS) { go('driveOut'); break; }
          return { step, title: 'პირდაპირ, საჭე ბოლომდე მარცხნივ', text: 'ჩართეთ D (F) და მოაბრუნეთ საჭე ბოლომდე მარცხნივ (მანქანა გაჩერებულია)', gear: 'D', steer: -1, stop: true };
        case 'driveOut':
          if (r > 160) { go('leave'); break; }
          return { step, title: 'დაასრულეთ მობრუნება', text: 'იმოძრავეთ წინ, საჭე ბოლომდე მარცხნივ, სანამ მანქანა გასასვლელისკენ არ მიტრიალდება',
            readout: `კუთხე ${r.toFixed(0)}°`, gear: 'D', steer: -1, speed: SLOW };
        case 'leave':
          if (ev.status !== 'active') { go('done'); break; }
          return { step, title: 'გამოდით მარცხენა მხრიდან', text: 'გაასწორეთ საჭე და გამოდით ჩიხის მარცხენა მხრიდან', gear: 'D',
            track: { frame: { o: f.o, f: { x: -f.f.x, z: -f.f.z }, r: { x: -f.r.x, z: -f.r.z } }, b: -laneL }, speed: 1.2 };
        default: return null;
      }
      return this.update(veh, ev, time);
    },
  };
}
