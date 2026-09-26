// Simulation facade: world + vehicle + exam + training assistant, stepped at a fixed rate.
// Contains no rendering code so it runs identically in the browser and in Node (tests).

import { World } from './world.js';
import { Vehicle } from './vehicle.js';
import { Exam } from './exam.js';
import { Assistant } from './assistant.js';
import { VEHICLE } from '../config/vehicle.js';
import { examRules } from '../config/examRules.js';

export const FIXED_DT = 1 / 120;

export class Simulation {
  constructor({ course, rules = examRules, vehicleParams = VEHICLE, mode = 'training' }) {
    this.course = course;
    this.rules = rules;
    this.world = new World(course);
    this.vehicle = new Vehicle(vehicleParams);
    this.exam = new Exam({ course, world: this.world, vehicle: this.vehicle, rules, mode });
    this.assistant = new Assistant({ course, world: this.world, vehicle: this.vehicle, exam: this.exam });
    this.acc = 0;
    this.time = 0;
    this.paused = false;
    this.guidance = null;
  }

  get mode() { return this.exam.mode; }
  setMode(mode) { this.exam.mode = mode; this.restartExam(); }

  restartExam() { this.exam.reset(); this.assistant.reset(); this.acc = 0; }
  restartExercise() { const ok = this.exam.restartExercise(); this.assistant.reset(true); return ok; }
  restoreCheckpoint(key) { const ok = this.exam.restoreCheckpoint(key); this.assistant.reset(true); this.acc = 0; return ok; }

  step(dt, input) {
    this.time += dt;
    this.vehicle.step(dt, input, this.world);
    this.exam.update(dt);
  }

  // advance by a real frame time with fixed sub-steps; `inputFn` is called per sub-step
  advance(frameDt, inputFn) {
    if (this.paused) return 0;
    this.acc += Math.min(frameDt, 0.1);
    let n = 0;
    while (this.acc >= FIXED_DT) {
      this.step(FIXED_DT, inputFn(FIXED_DT));
      this.acc -= FIXED_DT; n++;
    }
    return n;
  }

  updateGuidance() { this.guidance = this.assistant.update(this.time); return this.guidance; }
}
