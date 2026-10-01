// Rustavi Driving Exam — application bootstrap and main loop.
import * as THREE from 'three';
import { Simulation } from './sim/simulation.js';
import { AutoDriver } from './sim/driver.js';
import { courses, defaultCourse } from './courses/index.js';
import { VEHICLE } from './config/vehicle.js';
import { examRules } from './config/examRules.js';
import { buildWorld3D } from './render/world3d.js';
import { buildCar, LAYER } from './render/car3d.js';
import { Mirrors } from './render/mirrors.js';
import { TrainingOverlay } from './render/overlays3d.js';
import { Input } from './input.js';
import { CarAudio } from './audio/audio.js';
import { UI } from './ui/ui.js';

const $ = (s) => document.querySelector(s);
const store = { get(k, d) { try { const v = localStorage.getItem('rustavi.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('rustavi.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } } };

// ------------------------------------------------------------------ renderer & scene
const canvas = $('#view');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  document.body.innerHTML = '<div style="padding:24px;font:16px sans-serif;color:#fff">ამ ბრაუზერში WebGL მიუწვდომელია, ამიტომ 3D სიმულატორი ვერ ჩაირთვება</div>';
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const course = courses[defaultCourse];
const sim = new Simulation({ course, rules: examRules, vehicleParams: VEHICLE, mode: 'training' });
const world3d = buildWorld3D(scene, sim.world);
const car = buildCar(VEHICLE);
scene.add(car.group);

const camera = new THREE.PerspectiveCamera(VEHICLE.CAMERA_FOV, window.innerWidth / window.innerHeight, 0.03, 900);
for (const l of Object.values(LAYER)) camera.layers.enable(l);
car.group.add(camera);
const extCam = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 900);
for (const l of Object.values(LAYER)) extCam.layers.enable(l);
scene.add(extCam);
const menuCam = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 1, 1500);   // main-menu backdrop
menuCam.layers.set(LAYER.WORLD); menuCam.layers.enable(LAYER.EXTERIOR);

const lowGfx = /[?&]lowgfx/.test(location.search);   // used by automated tests (software WebGL)
const settings = {
  selfCenter: store.get('selfCenter', true), audio: store.get('audio', true), shadows: lowGfx ? false : store.get('shadows', true),
  mirror: lowGfx ? 0.5 : store.get('mirror', 1), sens: store.get('sens', 1),
};
if (lowGfx) renderer.setPixelRatio(1);
const mirrors = new Mirrors(renderer, car.group, car.mirrorGlass, VEHICLE, settings.mirror);
const training = new TrainingOverlay(scene, sim.world, car, VEHICLE);
const input = new Input(canvas);
const audio = new CarAudio();
const ui = new UI(sim);
const demo = new AutoDriver(sim.vehicle);

const app = { menu: true, running: false, paused: false, mode: store.get('mode', 'training'), demo: false, ext: false, minimap: true, hud: true, resultShown: false };
const head = { yaw: 0, pitch: -0.12, targetYaw: null };
const orbit = { yaw: 0, pitch: 0.5 };   // outside view (V): mouse orbits the camera around the car; yaw 0 = behind it

// ------------------------------------------------------------------ menu
function selectMode(m) { app.mode = m; document.querySelectorAll('button.mode').forEach((b) => b.classList.toggle('selected', b.dataset.mode === m)); store.set('mode', m); }
selectMode(app.mode);
document.querySelectorAll('button.mode').forEach((b) => b.addEventListener('click', () => selectMode(b.dataset.mode)));
const bindOpt = (id, key, apply) => {
  const el = $(id);
  if (el.type === 'checkbox') el.checked = settings[key]; else el.value = settings[key];
  el.addEventListener('change', () => { settings[key] = el.type === 'checkbox' ? el.checked : +el.value; store.set(key, settings[key]); apply?.(settings[key]); });
};
bindOpt('#opt-selfcenter', 'selfCenter');
bindOpt('#opt-audio', 'audio', (v) => audio.setEnabled(v));
bindOpt('#opt-shadows', 'shadows', (v) => { renderer.shadowMap.enabled = v; scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true)); }); });
bindOpt('#opt-mirror', 'mirror', (v) => mirrors.setQuality(v));
bindOpt('#opt-sens', 'sens');
renderer.shadowMap.enabled = settings.shadows;
audio.setEnabled(settings.audio);

$('#start').addEventListener('click', startDrive);
function startDrive() {
  sim.setMode(app.mode);
  app.menu = false; app.running = true; app.paused = false; app.resultShown = false; app.demo = false;
  sim.paused = false;                // "restart exam" from the pause menu used to leave the physics paused
  app.ext = false; orbit.yaw = 0; orbit.pitch = 0.5;
  head.yaw = 0; head.pitch = -0.12;
  $('#menu').classList.add('hidden'); $('#result').classList.add('hidden'); $('#pause').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  input.enabled = true;
  audio.start(); audio.resume();
  canvas.requestPointerLock?.()?.catch?.(() => {});
  ui.toast(app.mode === 'training' ? '<b>ვარჯიში</b><br>მიჰყევით მითითებებს' : '<b>გამოცდა დაიწყო</b><br>დაიძარით', 'info', 6000);
}
// Leave the drive completely: stop the sound, end the run, clear pop-ups. Start begins a new run.
function showMenu() {
  app.menu = true; app.running = false; app.paused = false; app.demo = false; app.resultShown = false;
  sim.paused = false; sim.restartExam();
  input.enabled = false; input.keys.clear(); document.exitPointerLock?.();
  audio.suspend();
  $('#toasts').replaceChildren();
  $('#menu').scrollTop = 0;
  $('#menu').classList.remove('hidden'); $('#pause').classList.add('hidden'); $('#result').classList.add('hidden'); $('#hud').classList.add('hidden');
}
function setPaused(p) {
  if (!app.running || app.resultShown) return;
  if (p) ui.renderCheckpoints(sim.exam.checkpointList, restoreCheckpoint);
  app.paused = p; sim.paused = p;
  $('#pause').classList.toggle('hidden', !p);
  if (p) document.exitPointerLock?.(); else canvas.requestPointerLock?.()?.catch?.(() => {});
}
function act(a) {
  if (a === 'resume') setPaused(false);
  else if (a === 'restart-ex') { if (sim.restartExercise()) { input.releaseHeld(); ui.toast('<b>დაბრკოლება თავიდან იწყება</b><br>მანქანა დგას მიმდინარე დაბრკოლების წინ', 'info'); } setPaused(false); }
  else if (a === 'restart-exam') { startDrive(); }
  else if (a === 'menu') showMenu();
}
document.querySelectorAll('#pause button, #result button').forEach((b) => b.addEventListener('click', () => act(b.dataset.act)));

// Restore a saved checkpoint (pause card, result sheet). Works in training and in the exam.
function restoreCheckpoint(key) {
  const cp = sim.exam.checkpoints.get(key);
  if (!sim.restoreCheckpoint(key)) return;
  app.resultShown = false; app.demo = false; input.enabled = true; input.releaseHeld();
  $('#result').classList.add('hidden');
  head.targetYaw = 0;
  setPaused(false);
  ui.toast(`<b>აღდგენილია: ${ui.cpLabel(cp)}</b><br>მანქანა დგას P-ზე, ჩართული სადგომი მუხრუჭით. ჩართეთ D (F) და მოხსენით სადგომი მუხრუჭი (Space)`, 'info', 8000);
}

// ------------------------------------------------------------------ exam events
sim.exam.on((type, data) => {
  if (!app.running) return;
  if (type === 'mistake') { ui.mistake(data, sim.exam.mode); audio.chime(); }
  else if (type === 'elementDone') {
    const n = sim.rules.elements[data.id].nameKa;
    if (data.status === 'completed') { ui.toast(`<b>${n}</b><br>დაბრკოლება შესრულებულია`, 'good', 3500); audio.success(); }
    else ui.toast(`<b>${n}</b><br>დაბრკოლება ვერ შესრულდა`, '', 5000);
  } else if (type === 'allElementsDone') ui.toast('<b>ექვსივე დაბრკოლება შესრულებულია</b><br>დაბრუნდით დასაწყისში, გაჩერდით და ჩართეთ სადგომი მუხრუჭი', 'info', 8000);
  else if (type === 'checkpoint' && data.kind === 'after') ui.toast(`<b>საკონტროლო წერტილი შენახულია</b><br>${ui.cpLabel(data)}. თავიდან გასავლელად დააჭირეთ Esc-ს`, 'info', 4000);
  else if (type === 'engage' && sim.exam.mode === 'training') ui.toast(`<b>${sim.rules.elements[data.id].nameKa}</b> — ადგილი ${data.station}. დრო აითვლება (2:00).`, 'info', 3000);
  else if (type === 'finished') setTimeout(() => {
    if (!app.running || sim.exam.state !== 'finished') return;
    app.resultShown = true; input.enabled = false; document.exitPointerLock?.();
    ui.renderCheckpoints(sim.exam.checkpointList, restoreCheckpoint); ui.showResult(data);
  }, 1200);
});

// ------------------------------------------------------------------ discrete actions
function handleAction(a) {
  const V = sim.vehicle, training = sim.exam.mode === 'training';
  if (a === 'pause') { if (app.resultShown) return; setPaused(!app.paused); return; }
  if (!app.running || app.paused) return;
  const gearKey = { gearD: 'D', gearR: 'R', gearN: 'N', gearP: 'P' }[a];
  if (gearKey) { if (V.requestGear(gearKey)) audio.click(); else ui.toast(`ჯერ გააჩერეთ მანქანა, შემდეგ ჩართეთ ${gearKey}.`, 'info', 2500); return; }
  if (a === 'gearUp' || a === 'gearDown') {
    const order = ['P', 'R', 'N', 'D']; const i = order.indexOf(V.gear) + (a === 'gearUp' ? -1 : 1);
    if (i >= 0 && i < 4) { if (V.requestGear(order[i])) audio.click(); } return;
  }
  if (a === 'parkingBrake') { V.parkingBrake = !V.parkingBrake; audio.ratchet(); }
  else if (a === 'restartExercise') { if (sim.restartExercise()) { input.releaseHeld(); ui.toast('<b>დაბრკოლება თავიდან იწყება</b>', 'info'); } }
  else if (a === 'hud') { app.hud = !app.hud; }
  else if (a === 'camera') app.ext = !app.ext;
  else if (a === 'minimap' && training) app.minimap = !app.minimap;
  else if (a === 'demo' && training) { app.demo = !app.demo; ui.toast(app.demo ? '<b>მართავს ინსტრუქტორი</b><br>უყურეთ საჭეს, პედლებს და სარკეებს. მართვის კონტროლის დასაბრუნებლად დააჭირეთ G-ს' : 'ინსტრუქტორი გამოირთო, მართავთ თქვენ', 'info', 4000); }
}

// ------------------------------------------------------------------ loop
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = extCam.aspect = menuCam.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix(); extCam.updateProjectionMatrix(); menuCam.updateProjectionMatrix();
});

let last = performance.now(), t = 0, uiTimer = 0;
const eye = VEHICLE.EYE;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now; t += dt;
  if (app.menu) {   // main menu: the drive is stopped; slow aerial fly-around of the ground as a backdrop
    input.takeActions(); input.takeLook();
    training3d(null, false);
    const B = sim.world.bounds, cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2, a = t * 0.025;
    menuCam.position.set(cx + Math.cos(a) * 100, 75, cz + Math.sin(a) * 100);
    menuCam.lookAt(cx, 0, cz);
    car.update(sim.vehicle, t);
    renderer.render(scene, menuCam);
    return;
  }
  for (const a of input.takeActions()) handleAction(a);
  const V = sim.vehicle;
  const training = sim.exam.mode === 'training';

  // head / mouse look
  const look = input.takeLook();
  if (app.ext) {          // outside view: the mouse turns the camera around the car instead of the driver's head
    orbit.yaw += look.dx * 0.0022 * settings.sens;
    orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + look.dy * 0.0022 * settings.sens, 0.08, 1.35);
    look.dx = look.dy = 0;
  }
  if (look.dx || look.dy) head.targetYaw = null;
  head.yaw = THREE.MathUtils.clamp(head.yaw + look.dx * 0.0022 * settings.sens, -2.6, 2.6);
  head.pitch = THREE.MathUtils.clamp(head.pitch - look.dy * 0.0022 * settings.sens, -1.05, 0.6);
  if (head.targetYaw !== null) { head.yaw += (head.targetYaw - head.yaw) * Math.min(1, dt * 10); head.pitch += (-0.12 - head.pitch) * Math.min(1, dt * 10); if (Math.abs(head.yaw) < 0.002) head.targetYaw = null; }

  if (app.running && !app.paused) {
    let guidance = null;
    if (training || app.demo) guidance = sim.updateGuidance();
    const drivingKeys = input.keys.size > 0;
    if (app.demo && drivingKeys) { app.demo = false; ui.toast('ინსტრუქტორი გამოირთო, მართავთ თქვენ', 'info', 2500); }
    let vin;
    if (app.demo && guidance) { const a = guidance.ready ? guidance.readyAction : guidance; vin = demo.drive(a, 1 / 60); }
    else vin = input.vehicleInput(settings.selfCenter);
    sim.advance(dt, () => (app.demo && guidance ? demo.drive(guidance.ready ? guidance.readyAction : guidance, 1 / 120) : vin));
    if (V.contacts.some((c) => c.isNew)) audio.thump();
    training3d(guidance, training);
  } else training3d(null, false);

  car.update(V, t);
  world3d.updateShadow({ x: V.x, z: V.z });
  audio.update(V);

  // driver head position (lean when looking to the side / back). Looking far back over a shoulder the
  // torso turns too: the head rises and moves towards that side, so poles seen through the rear side
  // windows are not hidden behind the passenger seat.
  const sy = Math.sin(head.yaw), back = THREE.MathUtils.clamp((Math.abs(head.yaw) - 1.4) / 0.6, 0, 1);
  camera.position.set(eye.x - Math.abs(sy) * 0.06 - (Math.abs(head.yaw) > 1.6 ? 0.08 : 0), eye.y + (Math.abs(head.yaw) > 1.8 ? 0.04 : 0) + back * 0.06, eye.z + sy * 0.13 + Math.sign(head.yaw) * back * 0.12);
  camera.rotation.set(head.pitch, -Math.PI / 2 - head.yaw, 0, 'YXZ');
  const seatFade = head.yaw > 0 ? back : 0;
  car.passengerSeat.opacity = 1 - 0.8 * seatFade; car.passengerSeat.depthWrite = seatFade === 0;
  const fov = input.zoom ? 30 : VEHICLE.CAMERA_FOV;          // hold right mouse button: lean in / zoom (mirror checks)
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 10); camera.updateProjectionMatrix(); }

  let cam = camera;
  if (app.ext) {
    const c = V.center(), dist = input.zoom ? 6 : 10;   // right mouse button: closer
    const a = V.heading + Math.PI + orbit.yaw, h = Math.cos(orbit.pitch) * dist;
    extCam.position.set(c.x + Math.cos(a) * h, V.y + 0.8 + Math.sin(orbit.pitch) * dist, c.z + Math.sin(a) * h);
    extCam.lookAt(c.x, V.y + 0.8, c.z);
    cam = extCam;
  }
  if (window.__sim?.viewCam) cam = window.__sim.viewCam;
  if (cam === camera || window.__sim?.viewCam) mirrors.render(scene);
  renderer.render(scene, cam);

  // DOM updates at ~12 Hz
  uiTimer += dt;
  if (uiTimer > 0.08) {
    uiTimer = 0;
    if (app.running) {
      ui.updateStatus();
      ui.updateGuide(sim.guidance, training && app.hud);
      ui.updateTelemetry(V);
      ui.drawMinimap(V, sim.guidance, training && app.minimap && app.hud);
      $('#lockhint').classList.toggle('hidden', input.locked || app.paused || app.resultShown);
      $('#hud-status').classList.toggle('hidden', !app.hud);
      ui.updateKeys({ training, ext: app.ext, demo: app.demo, minimap: app.minimap }, app.hud);
    }
  }
}
function training3d(g, show) {
  training.setVisible(show && app.hud);
  if (show) training.update(g, sim.vehicle, t);
}
requestAnimationFrame(frame);

// test hook (used by the automated browser test)
window.__sim = { sim, app, startDrive, handleAction, THREE, renderer, scene, camera, head, orbit, mirrors, car, audio, viewCam: null };
