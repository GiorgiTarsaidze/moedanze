// Headless test harness: drives the full simulation with the automated driver that follows the
// training coach — inputs go through the same vehicle physics a player uses.
import { Simulation, FIXED_DT } from '../src/sim/simulation.js';
import { AutoDriver } from '../src/sim/driver.js';
import { rustaviCourse } from '../src/courses/rustavi/course.js';
import { examRules } from '../src/config/examRules.js';

export function makeSim(mode = 'exam', rules = examRules) {
  const sim = new Simulation({ course: rustaviCourse, rules, mode });
  const driver = new AutoDriver(sim.vehicle);
  return { sim, driver };
}

// Run until finished. `override(sim, guidance, action)` may alter the action (to inject mistakes).
export function runExam({ mode = 'exam', maxTime = 1500, override, log = false, rules } = {}) {
  const { sim, driver } = makeSim(mode, rules);
  const trace = [];
  let lastStep = '', lastEl = '';
  let guidance = null;
  let k = 0;
  while (sim.exam.state !== 'finished' && sim.time < maxTime) {
    if (k++ % 4 === 0) guidance = sim.updateGuidance();
    let action = guidance?.ready ? guidance.readyAction : guidance;
    if (override) action = override(sim, guidance, action) ?? action;
    const input = driver.drive(action, FIXED_DT);
    sim.step(FIXED_DT, input);
    const el = sim.exam.currentId || 'finish';
    const st = (guidance?.step || guidance?.title || '');
    if (log && (st !== lastStep || el !== lastEl)) {
      const V = sim.vehicle;
      trace.push(`${sim.time.toFixed(1)}s [${el}/${sim.exam.evaluator?.status}] ${st}  pos=(${(V.x / rustaviCourse.metersPerPx).toFixed(0)},${(V.z / rustaviCourse.metersPerPx).toFixed(0)})px hdg=${(V.heading * 180 / Math.PI).toFixed(0)} v=${V.v.toFixed(2)} gear=${V.gear}`);
      lastStep = st; lastEl = el;
    }
  }
  return { sim, result: sim.exam.result(), trace };
}

export function printResult(r) {
  const res = r.result;
  console.log(`RESULT: ${res.passed ? 'PASS' : 'FAIL'}  score ${res.score}/100  penalties ${res.penalties}  time ${res.time.toFixed(0)} s  ${res.reason}`);
  for (const e of res.elements) {
    console.log(`  ${e.number}. ${e.name} [station ${e.station ?? '-'}]: ${e.status}`);
    for (const m of e.mistakes) console.log(`      - ${m.text} (${m.detail}) : ${m.points}`);
  }
  for (const m of res.general) console.log(`  general - ${m.text} (${m.detail}) : ${m.points}`);
}
