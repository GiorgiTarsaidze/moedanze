// Browser smoke test (Playwright + Chromium, software WebGL):
// loads the app, checks for console errors, drives with the keyboard, looks around, runs the
// complete exam with the demo driver inside the page and captures screenshots along the way.
// Usage: node scripts/serve.mjs 5173 &  node tests/browser-test.mjs [outDir]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/home/claude/.npm-global/lib/node_modules/playwright'); }

const out = process.argv[2] || 'tests/screenshots';
mkdirSync(out, { recursive: true });
const url = process.env.URL || 'http://localhost:5173/?lowgfx';
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|fonts\.g/.test(m.text())) errors.push(m.text()); if (m.type() === 'warning' && /GL_INVALID|WebGL/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png`, timeout: 180000 }); console.log('screenshot', name); };
const wait = (ms) => page.waitForTimeout(ms);
page.setDefaultTimeout(180000);

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__sim, null, { timeout: 30000 });
await wait(1500);
await shot('01-menu');

await page.click('button.mode[data-mode="training"]');
await page.click('#start');
await wait(2500);
await shot('02-start-first-person');

// keyboard driving: D (F), release parking brake, indicator, accelerate briefly
await page.keyboard.press('KeyF');
await page.keyboard.press('Space');
await page.keyboard.press('KeyQ');
await page.keyboard.down('KeyW'); await wait(1500); await page.keyboard.up('KeyW');
await page.keyboard.down('KeyA'); await wait(700); await page.keyboard.up('KeyA');
await wait(600);
const st1 = await page.evaluate(() => { const V = window.__sim.sim.vehicle; return { v: V.v, gear: V.gear, pb: V.parkingBrake, steer: V.steerWheel, odo: V.odometer, ind: V.indicator }; });
console.log('after keyboard driving', st1);
await shot('03-keyboard-driving');

// look at mirrors & around (head yaw/pitch as the mouse would set them)
const look = async (yaw, pitch, name) => { await page.evaluate(([y, p]) => { const h = window.__sim.head; h.yaw = y; h.pitch = p; h.targetYaw = null; }, [yaw, pitch]); await wait(700); await shot(name); };
await look(-0.95, -0.2, '04-look-left-mirror');
await look(0.85, -0.22, '05-look-right-mirror');
await look(0.0, 0.2, '06-look-rearview');
await look(-1.9, -0.1, '07-look-back-left');
await page.evaluate(() => { const h = window.__sim.head; h.yaw = 0; h.pitch = -0.12; }); await wait(800);

// run the complete examination with the demo driver inside the page, stopping at points of interest
const stops = [
  ['garage', 'reverseIn', '09-garage-reversing'],
  ['zigzag', 'weave', '10-zigzag'],
  ['turn', 'reverseArc', '11-deadend-turn'],
  ['figure8', 'loops', '12-figure8'],
  ['hill', 'hold', '13-hill-hold'],
  ['parallel', 'reverseStraight', '08a-parallel-reference-sticker'],
  ['parallel', 'arcLeft', '08-parallel-reversing'],
];
await page.evaluate(() => { const s = window.__sim; s.sim.restartExam(); s.app.demo = true; });
for (const [el, step, name] of stops) {
  const ok = await page.evaluate(async ([el, step]) => {
    const s = window.__sim, sim = s.sim;
    const { AutoDriver } = await import('./src/sim/driver.js');
    const d = new AutoDriver(sim.vehicle);
    let g = null;
    for (let i = 0; i < 120 * 400; i++) {
      if (i % 4 === 0) g = sim.updateGuidance();
      const a = g?.ready ? g.readyAction : g;
      sim.step(1 / 120, d.drive(a, 1 / 120));
      if (sim.exam.currentId === el && (g?.step === step)) {
        for (let k = 0; k < 120 * (step === 'reverseStraight' ? 0.6 : 1.2); k++) { if (k % 4 === 0) g = sim.updateGuidance(); sim.step(1 / 120, d.drive(g, 1 / 120)); }
        return true;
      }
      if (sim.exam.state === 'finished') return false;
    }
    return false;
  }, [el, step]);
  await page.evaluate(() => { window.__sim.app.demo = false; });
  // look where the action is
  const yaw = name.includes('sticker') ? 1.0 : { parallel: 0.85, garage: 0.85, zigzag: 0, turn: -0.9, figure8: -0.3, hill: 0 }[el];
  await page.evaluate((y) => { const h = window.__sim.head; h.yaw = y; h.pitch = -0.2; }, yaw);
  await wait(900);
  await shot(name + (ok ? '' : '-NOTREACHED'));
}
// finish the exam
const res = await page.evaluate(async () => {
  const s = window.__sim, sim = s.sim;
  const { AutoDriver } = await import('./src/sim/driver.js');
  const d = new AutoDriver(sim.vehicle);
  let g = null;
  for (let i = 0; i < 120 * 600 && sim.exam.state !== 'finished'; i++) {
    if (i % 4 === 0) g = sim.updateGuidance();
    const a = g?.ready ? g.readyAction : g;
    sim.step(1 / 120, d.drive(a, 1 / 120));
  }
  const r = sim.exam.result();
  return { passed: r.passed, score: r.score, reason: r.reason, elements: r.elements.map((e) => e.status) };
});
console.log('in-browser exam result', res);
await wait(2500);
await shot('14-result');

// exam mode: no training aids, outside view (V) allowed
await page.click('#result button[data-act="menu"]');
await page.click('button.mode[data-mode="exam"]');
await page.click('#start');
await wait(1500);
await page.keyboard.press('KeyV'); await wait(600);
const examFlags = await page.evaluate(() => ({ ext: window.__sim.app.ext, guideHidden: document.querySelector('#guide').classList.contains('hidden') }));
console.log('exam mode flags (ext must be true, guide hidden):', examFlags);
await shot('15-exam-mode');
await page.click('button.mode[data-mode="training"]').catch(() => {});

// training outside view
await page.keyboard.press('Escape'); await wait(300);
await page.click('#pause button[data-act="menu"]');
await page.click('button.mode[data-mode="training"]');
await page.click('#start'); await wait(1200);
await page.keyboard.press('KeyV'); await wait(1200);
await shot('16-training-external');

console.log('console errors:', errors.length ? errors : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
