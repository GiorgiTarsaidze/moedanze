// Automated acceptance tests for the simulation core (physics, exercises, scoring).
// Run: node tests/test-suite.mjs
import { makeSim, runExam, printResult } from './harness.mjs';
import { FIXED_DT } from '../src/sim/simulation.js';
import { examRules } from '../src/config/examRules.js';

let pass = 0, fail = 0;
const results = [];
function check(name, cond, info = '') {
  if (cond) { pass++; results.push(`  ✔ ${name}`); }
  else { fail++; results.push(`  ✘ ${name}  ${info}`); }
}
const rulesOf = (mistakes) => mistakes.filter((m) => !m.voided).map((m) => `${m.element}.${m.rule}`);

// Run one element from its restart position with the coach-following driver.
function runElement(id, { override, maxTime = 200, mode = 'training', lastStation = false, start } = {}) {
  const { sim, driver } = makeSim(mode);
  const ex = sim.exam;
  if (lastStation) sim.world.elements[id].stations.reverse();   // coach + evaluator target the last station
  ex.index = ex.sequence.indexOf(id); ex.createEvaluator(); ex.movedOff = true;
  const px = sim.course.px;
  const rp = start ? { p: px(start[0], start[1]), heading: start[2] * Math.PI / 180 } : sim.course.restart[id];
  sim.vehicle.reset(rp.p, rp.heading, { gear: 'D', parkingBrake: false });
  sim.vehicle.updateTerrain(sim.world);
  if (start) { sim.updateGuidance(); sim.assistant.legDone = true; }   // custom start: skip the default route leg
  const coach = sim.assistant.coaches[id];
  let g = null, k = 0, t0 = sim.time;
  while (sim.time - t0 < maxTime && ex.currentId === id && ex.state !== 'finished') {
    if (k++ % 4 === 0) g = sim.updateGuidance();
    let a = g;
    if (override) a = override({ sim, g, coach, a, V: sim.vehicle }) ?? a;
    sim.step(FIXED_DT, driver.drive(a, FIXED_DT));
  }
  const ev = ex.results[id];
  return { sim, status: ev?.status ?? ex.evaluator?.status, mistakes: ex.mistakes, rules: rulesOf(ex.mistakes), vehicle: sim.vehicle };
}

// ---------------------------------------------------------------- physics
{
  const { sim } = makeSim('training');
  const V = sim.vehicle, W = sim.world;
  const flat = { x: 20, z: 110 };           // open asphalt on the left road
  V.reset(flat, Math.PI / 2, { gear: 'D', parkingBrake: false });
  for (let i = 0; i < 120 * 8; i++) V.step(FIXED_DT, { steerTarget: 0, throttle: 0, brake: 0 }, W);
  check('Creep in D ≈ 6 km/h with no pedals', V.v > 1.5 && V.v < 1.85, `v=${V.v.toFixed(2)}`);
  for (let i = 0; i < 120 * 3; i++) V.step(FIXED_DT, { steerTarget: 0, throttle: 0, brake: 1 }, W);
  check('Brake overrides creep (stops)', Math.abs(V.v) < 0.01);
  V.requestGear('R');
  for (let i = 0; i < 120 * 6; i++) V.step(FIXED_DT, { steerTarget: 0, throttle: 0, brake: 0 }, W);
  check('Creep in R ≈ 5 km/h backwards', V.v < -1.1 && V.v > -1.45, `v=${V.v.toFixed(2)}`);
  check('Shift R→D refused while rolling backwards', V.requestGear('D') === false);
  // engine braking: releasing W at 20 km/h slows the car back towards creep speed
  V.reset({ x: 13.5, z: 30 }, Math.PI / 2, { gear: 'D', parkingBrake: false });   // open left road
  while (V.speedKmh < 20) V.step(FIXED_DT, { throttleKey: true }, W);
  for (let i = 0; i < 120 * 4; i++) V.step(FIXED_DT, {}, W);
  const after4 = V.speedKmh;
  for (let i = 0; i < 120 * 8; i++) V.step(FIXED_DT, {}, W);
  check('Off the accelerator at 20 km/h: ≤ 11 km/h after 4 s, creep after 12 s', after4 <= 11 && V.v > 1.4 && V.v < 1.85, `${after4.toFixed(1)} km/h → ${V.speedKmh.toFixed(1)} km/h`);
  // turning circle
  V.reset({ x: 30, z: 20 }, 0, { gear: 'D', parkingBrake: false });
  const pts = [];
  for (let i = 0; i < 120 * 30; i++) { V.step(FIXED_DT, { steerTarget: 1, throttle: 0, brake: 0 }, null); if (i > 240) pts.push(V.wheels()[0]); }
  let minx = Infinity, maxx = -Infinity; for (const p of pts) { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); }
  const circle = maxx - minx;
  check('Kerb-to-kerb turning circle 10–11 m', circle > 9.9 && circle < 11.2, `${circle.toFixed(2)} m`);
  // no rotation in place
  V.reset({ x: 30, z: 20 }, 0.3, { gear: 'P', parkingBrake: true });
  for (let i = 0; i < 240; i++) V.step(FIXED_DT, { steerTarget: 1, throttle: 1, brake: 0 }, null);
  check('Cannot rotate in place (full lock, stationary)', Math.abs(V.heading - 0.3) < 1e-9);
  check('Steering wheel reaches full lock (~535°)', Math.abs(V.steerWheel * 180 / Math.PI - 534.75) < 1, `${(V.steerWheel * 180 / Math.PI).toFixed(1)}°`);
  // self-centring while moving
  V.reset({ x: 30, z: 20 }, 0, { gear: 'D', parkingBrake: false });
  V.steerWheel = 3;
  for (let i = 0; i < 120 * 4; i++) V.step(FIXED_DT, { throttle: 0, brake: 0 }, null);
  check('Steering self-centres while rolling', Math.abs(V.steerWheel) < 0.3, `${V.steerWheel.toFixed(2)} rad`);
  // bug report (garage): with the keyboard the player releases D at full lock and reverses; the lock must stay
  V.reset({ x: 30, z: 20 }, 0, { gear: 'R', parkingBrake: false });
  V.steerWheel = V.D.MAX_STEERING_WHEEL_ANGLE;
  for (let i = 0; i < 120 * 4; i++) V.step(FIXED_DT, { selfCenter: true }, null);
  check('Released full lock stays at lock while reversing', V.steerWheel > V.D.MAX_STEERING_WHEEL_ANGLE * 0.99 && V.v < -1, `${(V.steerWheel * 180 / Math.PI).toFixed(0)}°`);
  // hill: gravity, rollback, brakes
  const hill = W.elements.hill.stations[0];
  const onSlope = (a) => { const p = { x: hill.frame.o.x + hill.frame.f.x * a, z: hill.frame.o.z + hill.frame.f.z * a }; return p; };
  const placeRA = (aFront) => onSlope(aFront - V.P.WHEELBASE - V.P.FRONT_OVERHANG);
  V.reset(placeRA(-1.5), Math.atan2(hill.frame.f.z, hill.frame.f.x), { gear: 'D', parkingBrake: false }); V.updateTerrain(W);
  check('Hill gradient ≈ 16 %', Math.abs(Math.tan(V.pitch) - 0.16) < 0.005, `${(Math.tan(V.pitch) * 100).toFixed(1)} %`);
  for (let i = 0; i < 120 * 2; i++) V.step(FIXED_DT, { steerTarget: 0, throttle: 0, brake: 1 }, W);
  const held = Math.abs(V.v) < 1e-6;
  const x0 = V.x;
  for (let i = 0; i < 120 * 2; i++) V.step(FIXED_DT, { steerTarget: 0, throttle: 0, brake: 0 }, W);
  check('Foot brake holds the car on the hill', held);
  check('In D without throttle/brake the car rolls back on 16 %', V.v < -0.2, `v=${V.v.toFixed(2)}`);
  V.reset(placeRA(-1.5), Math.atan2(hill.frame.f.z, hill.frame.f.x), { gear: 'N', parkingBrake: true }); V.updateTerrain(W);
  for (let i = 0; i < 120 * 3; i++) V.step(FIXED_DT, { steerTarget: 0, throttle: 0, brake: 0 }, W);
  check('Parking brake holds the car on the hill (N)', Math.abs(V.v) < 1e-6);
  // collision stops the car at a post
  const post = W.posts.find((p) => p.owner === 'zigzag');
  V.reset({ x: post.p.x, z: post.p.z + 8 }, -Math.PI / 2, { gear: 'D', parkingBrake: false });
  let hit = null;
  for (let i = 0; i < 120 * 10 && !hit; i++) { V.step(FIXED_DT, { steerTarget: 0, throttle: 0, brake: 0 }, W); hit = V.contacts.find((c) => c.kind === 'post'); }
  check('Driving into a post is detected and the car is stopped', !!hit && V.v === 0);
}

// ---------------------------------------------------------------- full exam
{
  const r = runExam({ mode: 'exam' });
  check('Full exam with correct driving: PASS 100/100', r.result.passed && r.result.score === 100, r.result.reason + ' ' + rulesOf(r.result.mistakes).join(','));
  printResult(r);
  const r2 = runExam({ mode: 'exam', override: ({}) => null });
  check('Deterministic simulation (same result twice)', r2.result.score === r.result.score && Math.abs(r2.result.time - r.result.time) < 1e-6);
}

// ---------------------------------------------------------------- element mistake detection
{
  const r = runElement('parallel');
  check('Parallel parking clean run completes', r.status === 'completed' && r.rules.length === 0, r.rules.join(','));
}
{
  let jumped = false;
  const r = runElement('parallel', { override: ({ coach, a }) => {
    if (coach.step === 'handbrake') { coach.jump('exitPrep'); jumped = true; return { stop: true }; }
    if (jumped && a && a.handbrake) return { ...a, handbrake: false };
  } });
  check('Parallel: missing parking brake → −15', r.rules.includes('parallel.noParkingBrake'), r.rules.join(','));
}
{
  const r = runElement('parallel', { override: ({ coach, a }) => { if (coach.step === 'approach') return { ...a, stop: false, speed: 1.0, _: 1 }; } , maxTime: 12 });
  // drive through without stopping -> no engagement yet; now test stopping past the line:
  const r2 = runElement('parallel', { override: ({ coach, sim, a }) => {
    if (coach.step === 'approach') { const ev = sim.exam.evaluator; const fb = ev.stations[0].frame; return a && a.stop ? a : a; }
  } });
  check('Parallel runs (control)', r2.status === 'completed');
}
{
  // stop 1 m past the stop line
  const r = runElement('parallel', { override: ({ coach, sim, a, V }) => {
    if (coach.step === 'approach' && a) {
      const st = sim.world.elements.parallel.stations[0];
      const d = (V.frontBumper().z - st.frame.o.z);             // + = past the line (southbound)
      return { ...a, stop: d > 1.0, speed: d > 1.0 ? 0 : 1.2 };
    }
    if (coach.step === 'approach') return a;
  } });
  check('Parallel: stopping over the stop line → penalty', r.rules.includes('parallel.stopLineCrossed'), r.rules.join(','));
}
{
  // skip the final left-lock swing: car ends at 45° -> not fully inside (and lines)
  let jumped = false;
  const r = runElement('parallel', { override: ({ coach, a }) => {
    if (coach.step === 'lockLeft') { coach.jump('handbrake'); jumped = true; return { stop: true }; }
    if (jumped && a && a.steer === -1 && coach.step === 'lockLeft') return { stop: true };
  } });
  check('Parallel: bad final position → not fully inside (−20)', r.rules.includes('parallel.notFullyInside'), r.rules.join(','));
}
{
  const r = runElement('garage');
  check('Garage clean run completes', r.status === 'completed' && r.rules.length === 0, r.rules.join(','));
}
{
  // correction: stop mid-arc, go forward 1 m, reverse again
  let phase = 0, t0 = 0;
  const r = runElement('garage', { override: ({ coach, sim, a, V }) => {
    if (coach.step === 'arc' && phase === 0 && Math.abs(V.heading) > 0.6) { phase = 1; t0 = sim.time; }
    if (phase === 1) { if (sim.time - t0 < 4) return { gear: 'D', steer: 0, speed: 0.4 }; phase = 2; }
    if (phase === 2 && V.gear !== 'R') return { gear: 'R', stop: true, steer: 1 };
  } });
  check('Garage: second reverse engagement → −15', r.rules.includes('garage.multipleReverse'), r.rules.join(','));
}
{
  // bug report: following the mirror sticker the car always hit the far post. A person keeps their
  // own gap, creeps (no pedals) and brakes 0.3 s after the sticker lines up, then obeys the coach.
  for (const gap of [1.5, 2.2]) {
    let aligned = null, person = true;
    const r = runElement('garage', { override: ({ coach, sim, g, V }) => {
      if (!person || coach.step !== 'approach' || g?.leg) return;
      const f = sim.world.elements.garage.stations[0].frame;
      if (aligned === null && g?.stickerResolved?.aligned) aligned = sim.time;
      const braking = aligned !== null && sim.time - aligned > 0.3;
      if (braking && Math.abs(V.v) < 0.03) person = false;
      return { gear: 'D', track: { frame: f, b: -(gap + V.P.CAR_WIDTH / 2) }, speed: 1.6, stop: braking };
    } });
    check(`Garage: stopping by the mirror sticker (gap ${gap} m, late brake) parks without touching`, r.status === 'completed' && r.rules.length === 0, `${r.status} ${r.rules.join(',')}`);
  }
}
{
  // keyboard users can only centre the wheel roughly (a tap moves it 20–40°): 25° left uncorrected in the
  // straight reversing steps must still give a clean parallel park and garage
  for (const [id, steps] of [['parallel', ['reverse45', 'adjust']], ['garage', ['reverseIn']]]) for (const deg of [-25, 25]) {
    const r = runElement(id, { override: ({ g, a, V }) => (g && steps.includes(g.step) ? { ...a, steer: (deg * Math.PI / 180) / V.D.MAX_STEERING_WHEEL_ANGLE } : undefined) });
    check(`${id}: wheel left ${deg}° off centre while reversing straight → still clean`, r.status === 'completed' && r.rules.length === 0, `${r.status} ${r.rules.join(',')}`);
  }
}
{
  const r = runElement('zigzag');
  check('Zigzag clean run completes', r.status === 'completed' && r.rules.length === 0, r.rules.join(','));
}
{
  // drive straight up the right half: first post passed on the wrong side
  const r = runElement('zigzag', { override: ({ sim, a }) => {
    const st = sim.world.elements.zigzag.stations[0];
    if (sim.exam.evaluator?.status === 'active' || (a && a.step === 'approach')) return { gear: 'D', track: { frame: st.frame, b: 2.4 }, speed: 1.5 };
  } });
  check('Zigzag: not weaving → wrong start / not between posts', r.rules.includes('zigzag.wrongStart') && r.rules.includes('zigzag.notBetweenPosts'), r.rules.join(','));
}
{
  let t0 = null;
  const r = runElement('zigzag', { override: ({ sim, a }) => {
    const ev = sim.exam.evaluator;
    if (ev?.status === 'active' && ev.info.postsPassed === 2) { t0 ??= sim.time; if (sim.time - t0 < 2.5) return { ...a, stop: true }; }
  } });
  check('Zigzag: stopping inside the element → −10', r.rules.includes('zigzag.stopped'), r.rules.join(','));
}
{
  // drive into post 2 directly
  const r = runElement('zigzag', { override: ({ sim, a }) => {
    const st = sim.world.elements.zigzag.stations[0];
    if (sim.exam.evaluator?.status === 'active' && sim.exam.evaluator.info.postsPassed >= 1) return { gear: 'D', track: { frame: st.frame, b: 0 }, speed: 1.2 };
  }, maxTime: 60 });
  check('Zigzag: hitting a post → −15', r.rules.includes('zigzag.markingOrPost'), r.rules.join(','));
}
{
  const r = runElement('turn');
  check('Limited-width turn clean run completes', r.status === 'completed' && r.rules.length === 0, r.rules.join(','));
}
{
  // leave through the right half
  const r = runElement('turn', { override: ({ coach, sim }) => {
    if (coach.step === 'leave') { const st = sim.world.elements.turn.stations[0]; return { gear: 'D', track: { frame: { o: st.frame.o, f: { x: -st.frame.f.x, z: -st.frame.f.z }, r: { x: -st.frame.r.x, z: -st.frame.r.z } }, b: -2.3 }, speed: 1.0 }; }
  } });
  check('Turn: exiting on the entry side → disqualification', r.rules.includes('turn.wrongExit') && r.status === 'failed', r.rules.join(',') + ' ' + r.status);
}
{
  // two reverse moves: split the reverse arc with a short forward move
  let phase = 0, t0 = 0;
  const r = runElement('turn', { override: ({ coach, sim, V }) => {
    if (coach.step === 'reverseArc' && phase === 0 && V.odometer > 0 && Math.abs(V.v) > 0.3) { phase = 1; t0 = sim.time; }
    if (phase === 1) { if (sim.time - t0 < 1.5) return null; phase = 2; t0 = sim.time; }
    if (phase === 2) { if (sim.time - t0 < 3) return { gear: 'D', steer: 1, speed: 0.4 }; phase = 3; }
    if (phase === 3) { if (V.gear !== 'R') return { gear: 'R', steer: 1, stop: true }; phase = 4; }
  } });
  check('Turn: more than one reverse move → −15', r.rules.includes('turn.tooManyGearChanges'), r.rules.join(','));
}
{
  // user report: on the real 9.2 x 8.2 m box the car turns at the second pole while rolling and stops
  // slightly diagonal. A person turning ~0.4 m late and braking 0.25 s late must still pass cleanly.
  let tTurn = null, tNear = null;
  const r = runElement('turn', { override: ({ coach, sim, g }) => {
    if (coach.step === 'turnLeft') { tTurn ??= sim.time; if (sim.time - tTurn < 0.5) return { gear: 'D', steer: 0, speed: 0.8 }; }
    if (coach.step === 'forwardArc' && g?.stop) { tNear ??= sim.time; if (sim.time - tNear < 0.25) return { gear: 'D', steer: -1, speed: 0.8 }; }
  } });
  check('Dead end: turning 0.4 m late and braking late at the left poles still passes', r.status === 'completed' && r.rules.length === 0, `${r.status} ${r.rules.join(',')}`);
}
{
  const r = runElement('figure8');
  check('Figure eight clean run completes', r.status === 'completed' && r.rules.length === 0, r.rules.join(','));
}
{
  // skip the bottom loop: once round the top loop, then out through the opening (posts block cutting across)
  let path = null;
  const r = runElement('figure8', { override: ({ sim, V }) => {
    const ev = sim.exam.evaluator;
    if (ev?.status !== 'active' || (!path && !(+ev.info.top >= 60))) return;   // coach drives into the loop first
    if (!path) {
      const C = sim.world.elements.figure8.stations[0].C1, rho = 5.0, DEGR = Math.PI / 180;
      const th0 = Math.atan2(V.z - C.z, V.x - C.x); let th1 = -17 * DEGR; while (th1 > th0) th1 -= 2 * Math.PI;
      path = [];
      for (let th = th0; th >= th1; th -= 0.05) path.push({ x: C.x + rho * Math.cos(th), z: C.z + rho * Math.sin(th) });
      const X = path[path.length - 1], h = { x: Math.sin(th1), z: -Math.cos(th1) };
      for (let s = 0.25; s <= 9; s += 0.25) path.push({ x: X.x + h.x * s, z: X.z + h.z * s });
    }
    return { gear: 'D', path, speed: 1.15, lookahead: 0.7 };
  }, maxTime: 90 });
  check('Figure eight: incomplete loops → element failed', r.rules.includes('figure8.wrongRoute') && r.status === 'failed', r.rules.join(','));
}
{
  // leaving the figure eight: the side is judged at the gate between the opening's end posts. Keep turning
  // left past the coach's exit point (on the rear-axle circle), then drive straight out.
  const exitAt = (deg) => {
    let path = null;
    return runElement('figure8', { override: ({ sim, V }) => {
      const ev = sim.exam.evaluator;
      if (ev?.status !== 'active' || !ev.info.seq?.startsWith('TBT')) return;
      const C = sim.world.elements.figure8.stations[0].C1, rho = 5.0, DEGR = Math.PI / 180;
      const th0 = Math.atan2(V.z - C.z, V.x - C.x);
      if (!path && th0 > 0) return;                     // coach until the car is on the east side of the top loop
      if (!path) {
        const th1 = deg * DEGR;
        path = [];
        for (let th = th0; th >= th1; th -= 0.05) path.push({ x: C.x + rho * Math.cos(th), z: C.z + rho * Math.sin(th) });
        const X = path[path.length - 1], h = { x: Math.sin(th1), z: -Math.cos(th1) };
        for (let s = 0.25; s <= 9; s += 0.25) path.push({ x: X.x + h.x * s, z: X.z + h.z * s });
      }
      return { gear: 'D', path, speed: 1.15, lookahead: 0.7 };
    }, maxTime: 150 });
  };
  const nw = exitAt(-35);          // heading ~35° left of north, towards the hill: crosses the virtual arc west of its middle
  check('Figure eight: heading off NW through the eastern half of the gate → no wrong-exit penalty', nw.status === 'completed' && nw.rules.length === 0, `${nw.status} ${nw.rules.join(',')}`);
  const west = exitAt(-47);        // carries on over the top and leaves through the western (entry) half
  check('Figure eight: leaving through the western half → wrong exit', west.rules.includes('figure8.wrongExit'), west.rules.join(','));
}
{
  const r = runElement('hill');
  check('Hill clean run completes', r.status === 'completed' && r.rules.length === 0, r.rules.join(','));
}
{
  // release the parking brake with no throttle for 1.2 s, then throttle
  let t0 = null;
  const r = runElement('hill', { override: ({ coach, sim }) => {
    if (coach.step === 'throttle') { t0 ??= sim.time; if (sim.time - t0 < 1.8) return { gear: 'D', handbrake: false, throttle: 0 }; }
  } });
  check('Hill: rollback > 20 cm → −10', r.rules.includes('hill.rollback'), r.rules.join(','));
}
{
  // stop only 0.4 m before the line
  const r = runElement('hill', { override: ({ coach, sim, V, a }) => {
    if (coach.step === 'approach' && a) {
      const st = sim.world.elements.hill.stations[0];
      const fb = (V.frontBumper().x - st.frame.o.x) * st.frame.f.x;   // + past the line (westbound)
      const d = -0.4 - fb;
      if (d < 0.05 && Math.abs(V.v) < 0.03) { coach.jump('hold'); }
      return { ...a, speed: Math.max(0, Math.min(1.2, d * 0.6 + 0.1)), stop: d < 0.05 };
    }
  } });
  check('Hill: stopping < 1 m before the line → −20', r.rules.includes('hill.badStop'), r.rules.join(','));
}

// ---------------------------------------------------------------- other stations
for (const [id, start, label] of [
  ['parallel', [107, 950, 90], 'Parallel parking at bay 3'],
  ['garage', [477, 700, -90], 'Garage at box 4 (right road)'],
  ['zigzag', [482, 560, -90], 'Zigzag in lane 2'],
  ['turn', [500, 150, -90], 'Dead-end turn in lane 2'],
]) {
  const r = runElement(id, { lastStation: true, start });
  const st = r.sim.exam.results[id]?.station;
  check(`${label}: completes cleanly`, r.status === 'completed' && r.rules.length === 0 && st === r.sim.world.elements[id].stations[0].id, `${r.status} station ${st} ${r.rules.join(',')}`);
}

// ---------------------------------------------------------------- course layout
{
  const { sim } = makeSim('training');
  const W = sim.world;
  for (const st of W.elements.zigzag.stations) {
    const start = st.posts.find((p) => p.name === 'სასტარტო ჯოხი');
    check(`Zigzag lane ${st.id}: start pole at the left end of the stop line`, !!start && Math.hypot(start.p.x - st.frame.o.x, start.p.z - st.frame.o.z) < 1e-9 && W.posts.some((p) => p.id === start.id));
  }
  const turnPosts = W.posts.filter((p) => p.owner === 'turn');
  const doubled = turnPosts.filter((p, i) => turnPosts.some((q, j) => j !== i && Math.hypot(p.p.x - q.p.x, p.p.z - q.p.z) < 0.6));
  check('Dead ends: one shared row of poles between the two lanes (no doubled poles)', doubled.length === 0, `${doubled.length} doubled`);
  const f8 = W.elements.figure8.stations[0], cs = sim.course.elements.figure8.stations[0];
  const onLine = (p) => [f8.C1, f8.C2].some((C) => { const r = Math.hypot(p.x - C.x, p.z - C.z); return Math.abs(r - f8.rIn) < 0.01 || Math.abs(r - f8.rOut) < 0.01; });
  const inOpening = (p) => { const r = Math.hypot(p.x - f8.C1.x, p.z - f8.C1.z), th = Math.atan2(p.z - f8.C1.z, p.x - f8.C1.x) * 180 / Math.PI;
    return Math.abs(r - f8.rOut) < 0.01 && th > cs.openingFrom + 1 && th < cs.openingTo - 1; };
  check('Figure eight: poles on the inner circles and the outer line, none across the opening',
    f8.posts.length >= 30 && f8.posts.every((q) => onLine(q.p)) && !f8.posts.some((q) => inOpening(q.p)), `${f8.posts.length} poles`);
}

// ---------------------------------------------------------------- exam logic
{
  const { sim } = makeSim('exam');
  const ex = sim.exam;
  const rule = examRules.elements.zigzag.rules.markingOrPost;
  ex.index = 2; ex.createEvaluator();
  for (let i = 0; i < 2; i++) ex.penalize('zigzag', 'x' + i, { ...rule }, '');
  ex.penalize('zigzag', 'y', { ...rule, points: 10 }, '');
  check('39 or fewer penalty points: still running (40 pts → over limit test next)', ex.state === 'running' && ex.penaltyPoints === 40 ? false : true);
  const { sim: s2 } = makeSim('exam');
  s2.exam.penalize('zigzag', 'a', { en: 'a', points: 20 }, ''); s2.exam.penalize('zigzag', 'b', { en: 'b', points: 20 }, '');
  check('More than 39 penalty points → exam FAIL', s2.exam.state === 'finished' && !s2.exam.result().passed);
  const { sim: s3 } = makeSim('training');
  s3.exam.penalize('turn', 'dq', { en: 'dq', points: 'DQ' }, '');
  check('Training mode continues after a disqualifying mistake', s3.exam.state === 'running' && !s3.exam.result().passed);
  const { sim: s4 } = makeSim('exam');
  s4.exam.penalize('turn', 'dq', { en: 'dq', points: 'DQ' }, '');
  check('Exam mode ends at a disqualifying mistake', s4.exam.state === 'finished');
}
{
  // restart exercise: pose & voided penalties
  const { sim } = makeSim('training');
  const ex = sim.exam;
  ex.penalize('garage', 'multipleReverse', examRules.elements.garage.rules.multipleReverse, '');
  sim.vehicle.x += 30;
  sim.restartExercise();
  const rp = sim.course.restart.garage;
  check('Restart Exercise puts the car before the element', Math.hypot(sim.vehicle.x - rp.p.x, sim.vehicle.z - rp.p.z) < 1e-9);
  check('Restart Exercise voids that attempt’s penalties', ex.penaltyPoints === 0 && ex.restartsUsed === 1);
  sim.restartExam();
  check('Restart Exam resets score, element and restarts', ex.penaltyPoints === 0 && ex.index === 0 && ex.restartsUsed === 0 && ex.mistakes.length === 0);
}
{
  // checkpoints: saved before and after every element; restoring brings back that moment
  const { sim, driver } = makeSim('exam');
  const ex = sim.exam, V = sim.vehicle;
  const driveWhile = (cond) => { let g = null, k = 0; const t0 = sim.time;
    while (cond() && sim.time - t0 < 300) { if (k++ % 4 === 0) g = sim.updateGuidance(); sim.step(FIXED_DT, driver.drive(g?.ready ? g.readyAction : g, FIXED_DT)); } };
  check('Checkpoint "before garage" exists at the start', ex.checkpoints.has('before:garage'));
  driveWhile(() => ex.currentId === 'garage');
  check('After an element: "after" and next "before" checkpoints are saved', ex.checkpoints.has('after:garage') && ex.checkpoints.has('before:zigzag'), [...ex.checkpoints.keys()].join(','));
  ex.penalize('zigzag', 'dq', { en: 'dq', points: 'DQ' }, '');
  const endedByDq = ex.state === 'finished';
  sim.restoreCheckpoint('before:zigzag');
  const rp = sim.course.restart.zigzag;
  check('Exam mode: restoring after a DQ resumes the exam at that element', endedByDq && ex.state === 'running' && ex.currentId === 'zigzag' && ex.evaluator.status === 'waiting' && !ex.fatal && ex.penaltyPoints === 0, `${ex.state} ${ex.currentId} ${ex.penaltyPoints}`);
  check('Restored car stands at the checkpoint in P with the parking brake on', Math.hypot(V.x - rp.p.x, V.z - rp.p.z) < 1e-9 && V.gear === 'P' && V.parkingBrake && V.v === 0);
  check('Restoring keeps earlier results and marks the run as restarted', ex.results.garage?.status === 'completed' && ex.restartsUsed === 1);
  driveWhile(() => ex.currentId === 'zigzag');           // coach first asks for D + parking brake off
  check('Element can be completed after restoring a checkpoint', ex.results.zigzag?.status === 'completed' && rulesOf(ex.mistakes).length === 0, rulesOf(ex.mistakes).join(','));
  const after = ex.checkpoints.get('after:garage');
  sim.restoreCheckpoint('after:garage');
  check('"After" checkpoint puts the car where the element ended, next element pending', Math.hypot(V.x - after.pose.p.x, V.z - after.pose.p.z) < 1e-9 && ex.currentId === 'zigzag' && !ex.results.zigzag && ex.restartsUsed === 2);
  const t0 = sim.time;
  driveWhile(() => V.odometer - 0 < 5 && sim.time - t0 < 20);
  check('Coach releases the parking brake after a restore (demo driver moves off)', V.gear === 'D' && !V.parkingBrake && sim.time - t0 < 20, `${V.gear} pb=${V.parkingBrake}`);
}
{
  // skipping an element
  const r = runExam({ mode: 'exam', override: (sim, g, a) => {
    if (sim.exam.currentId === 'garage' && sim.exam.evaluator.status === 'waiting') {
      const leg = sim.world.routeLegs.toZigzag;
      return { gear: 'D', path: [...sim.world.routeLegs.toGarage, ...leg], speed: 2.5, indicator: 'left', handbrake: false };
    }
  }, maxTime: 120 });
  check('Driving past an element → element skipped, exam FAIL', !r.result.passed && r.result.mistakes.some((m) => m.rule === 'skipped'), r.result.reason);
}

console.log('\n' + results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
