// Examination state machine: element sequence, evaluators, penalties, general rules, time limits,
// restarts and the final PASS/FAIL result.

import { EXERCISES } from './exercises/index.js';
import { isFatal } from '../config/examRules.js';
import { pointInPolygon, dot, fromAngle, dist } from './math2d.js';

export class Exam {
  constructor({ course, world, vehicle, rules, mode = 'exam' }) {
    this.course = course; this.world = world; this.vehicle = vehicle; this.rules = rules;
    this.mode = mode;
    this.listeners = new Set();
    this.reset();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data) { for (const fn of this.listeners) fn(type, data); }

  reset() {
    this.time = 0;
    this.mistakes = [];
    this.results = {};
    this.index = 0;
    this.state = 'running';          // running | finishing | finished
    this.fatal = null;
    this.restartsUsed = 0;
    this.generalFired = new Set();
    this.movedOff = false;
    this.wrongWay = { dist: 0, zone: null };
    this.finishReason = '';
    const st = this.course.route.start;
    this.vehicle.reset(st.p, st.heading, { gear: 'P', parkingBrake: true });
    this.vehicle.updateTerrain(this.world);
    this.world.contactMemory.clear();
    this.startOdo = 0;
    this.createEvaluator();
    this.checkpoints = new Map();
    this.saveCheckpoint('before', this.currentId);
    this.emit('reset');
  }

  get sequence() { return this.course.sequence; }
  get currentId() { return this.sequence[this.index]; }
  get current() { return this.evaluator; }
  get penaltyPoints() { return this.mistakes.filter((m) => !m.voided).reduce((s, m) => s + (typeof m.points === 'number' ? m.points : 0), 0); }
  get score() { return this.rules.startPoints - this.penaltyPoints; }

  elementName(id) { const e = this.rules.elements[id]; return e ? e.nameKa : 'ზოგადი'; }

  createEvaluator() {
    const id = this.currentId;
    if (!id) { this.evaluator = null; return; }
    const def = EXERCISES[id];
    const ctx = {
      rules: this.rules, dims: this.world.dims, course: this.course, world: this.world,
      penalize: (el, key, rule, detail) => this.penalize(el, key, rule, detail),
      onEngage: (ev) => this.emit('engage', { id: ev.id, station: ev.station?.id }),
      onFinish: (ev) => this.onElementFinished(ev),
    };
    this.evaluator = new def.Evaluator(ctx, this.world.elements[id].stations);
    this.generalFired.clear();
    this.emit('element', { id, index: this.index });
  }

  penalize(elementId, key, rule, detail = '') {
    const m = {
      t: this.time, element: elementId, elementName: this.elementName(elementId), rule: key,
      text: rule.en, ka: rule.ka, points: rule.points, detail, official: rule.official !== false,
      attempt: this.restartsUsed,
    };
    this.mistakes.push(m);
    this.emit('mistake', m);
    if (isFatal(rule.points) && !this.fatal) {
      this.fatal = m;
      if (this.mode === 'exam' && this.rules.endExamOnDisqualification) this.finish('Disqualified: ' + rule.en);
    }
    if (this.mode === 'exam' && this.penaltyPoints > this.rules.maxPenaltyPoints && this.rules.endExamOnDisqualification && this.state === 'running') {
      this.finish(`More than ${this.rules.maxPenaltyPoints} penalty points`);
    }
  }

  generalRule(key, detail) {
    const rule = this.rules.general[key];
    if (!rule || rule.enabled === false) return;
    const tag = key + (rule.repeatable ? this.time : '');
    if (this.generalFired.has(tag)) return;
    this.generalFired.add(tag);
    this.penalize('general', key, rule, detail);
  }

  onElementFinished(ev) {
    const id = ev.id;
    this.results[id] = { status: ev.status, station: ev.station?.id, time: ev.startTime != null ? this.time - ev.startTime : 0, reason: ev.failReason };
    this.emit('elementDone', { id, status: ev.status });
    if (this.state !== 'running') return;
    this.index++;
    if (this.index >= this.sequence.length) {
      this.evaluator = null;
      this.state = 'finishing';
      this.emit('allElementsDone');
    } else this.createEvaluator();
    this.saveCheckpoint('after', id);
    if (this.currentId) this.saveCheckpoint('before', this.currentId);
  }

  finish(reason = '') {
    if (this.state === 'finished') return;
    this.state = 'finished';
    this.finishReason = reason;
    this.emit('finished', this.result());
  }

  // --------------------------------------------------------------------------------- update
  update(dt) {
    if (this.state === 'finished') return;
    this.time += dt;
    const V = this.vehicle;

    // moving off from the start: signal left
    if (!this.movedOff && V.odometer > 0.5) {
      this.movedOff = true;
      if (!V.indicatorActive('left') && V.time - V.indicatorOnTime > 6) this.generalRule('noIndicatorMoveOff');
    }

    // wrong direction on one-way sections
    const c = V.center();
    let zone = null;
    for (const o of this.course.route.oneWay) if (pointInPolygon(c, o.poly)) { zone = o; break; }
    if (zone && V.v > 0.3) {
      const along = dot(fromAngle(V.heading), zone.dir);
      if (along < -0.5) {
        this.wrongWay.dist += Math.abs(V.v) * dt;
        if (this.wrongWay.dist > 5 && this.wrongWay.zone !== zone) { this.wrongWay.zone = zone; this.generalRule('wrongDirection', zone.name); }
      } else if (along > 0.5) { this.wrongWay.dist = 0; }
    }
    if (!zone) this.wrongWay = { dist: 0, zone: null };

    const ev = this.evaluator;
    if (ev) {
      ev.update(V, dt, this.time);
      if (ev.status === 'active') {
        ev.elapsed = this.time - ev.startTime;
        if (ev.elapsed > this.rules.elementTimeLimitSec) {
          this.penalize(ev.id, 'overtime', { en: `Time limit (${this.rules.elementTimeLimitSec} s) exceeded`, ka: `გადაჭარბდა ელემენტის დროის ლიმიტს (${this.rules.elementTimeLimitSec} წმ)`, points: this.rules.overtimeResult, official: true }, '');
          ev.fail('overtime');
        }
      } else if (ev.status === 'waiting' && (ev.skipped(V) || this.atNextElement(c))) {
        this.penalize(ev.id, 'skipped', this.rules.general.skippedElement, 'ელემენტი არ შესრულებულა');
        ev.status = 'failed'; ev.failReason = 'skipped';
        this.onElementFinished(ev);
      }
      // contacts outside an active element
      if (this.evaluator === ev && ev.status === 'waiting') for (const ct of V.contacts) if (ct.isNew) this.generalRule('collision', ct.label);
    } else {
      for (const ct of V.contacts) if (ct.isNew) this.generalRule('collision', ct.label);
    }

    if (this.state === 'finishing') {
      const fin = this.course.route.finish;
      if (dist(c, fin.p) < fin.radius || (Math.abs(V.v) < 0.02 && V.parkingBrake) ) this.finish('Examination route completed');
    }
  }

  // The car arrived at the next element's station while the current one was never started.
  atNextElement(c) {
    const next = this.sequence[this.index + 1];
    if (!next) return false;
    return this.world.elements[next].stations.some((st) => dist(c, st.frame.o) < 5);
  }

  // --------------------------------------------------------------------------------- restarts
  restartExercise() {
    if (this.state === 'finished' && this.mode === 'exam') return false;
    const id = this.currentId || this.sequence[this.sequence.length - 1];
    if (!this.currentId) this.index = this.sequence.length - 1;
    // void the mistakes of the aborted attempt of this element
    for (const m of this.mistakes) if (m.element === id && m.attempt === this.restartsUsed) m.voided = true;
    this.restartsUsed++;
    delete this.results[id];
    if (this.fatal && this.fatal.element === id) this.fatal = this.mistakes.find((m) => !m.voided && isFatal(m.points)) || null;
    this.state = 'running';
    const rp = this.course.restart[id];
    this.vehicle.reset(rp.p, rp.heading, { gear: 'P', parkingBrake: true });
    this.vehicle.updateTerrain(this.world);
    this.world.contactMemory.clear();
    this.movedOff = true;
    this.createEvaluator();
    this.emit('restartExercise', { id });
    return true;
  }

  // --------------------------------------------------------------------------------- checkpoints
  // Saved before every element (car at the element's restart pose) and after it (car where the
  // element ended). Restoring brings back the exam state of that moment: element, results and
  // mistakes. The car is placed stopped, in P, with the parking brake on.
  saveCheckpoint(kind, id) {
    const V = this.vehicle;
    const pose = kind === 'before' ? this.course.restart[id] : { p: { x: V.x, z: V.z }, heading: V.heading };
    const cp = {
      key: `${kind}:${id}`, kind, element: id, order: this.sequence.indexOf(id) * 2 + (kind === 'after' ? 1 : 0),
      pose: { p: { x: pose.p.x, z: pose.p.z }, heading: pose.heading },
      snap: { time: this.time, index: this.index, state: this.state, mistakes: this.mistakes.map((m) => ({ ...m })), results: JSON.parse(JSON.stringify(this.results)) },
    };
    this.checkpoints.set(cp.key, cp);
    this.emit('checkpoint', cp);
  }

  get checkpointList() { return [...this.checkpoints.values()].sort((a, b) => a.order - b.order); }

  restoreCheckpoint(key) {
    const cp = this.checkpoints.get(key);
    if (!cp) return false;
    const s = cp.snap;
    this.time = s.time; this.index = s.index; this.state = s.state;
    this.mistakes = s.mistakes.map((m) => ({ ...m }));
    this.results = JSON.parse(JSON.stringify(s.results));
    this.fatal = this.mistakes.find((m) => !m.voided && isFatal(m.points)) || null;
    this.restartsUsed++;                 // counts like a restart: the result becomes unofficial
    this.movedOff = true;
    this.wrongWay = { dist: 0, zone: null };
    this.finishReason = '';
    this.vehicle.reset(cp.pose.p, cp.pose.heading, { gear: 'P', parkingBrake: true });
    this.vehicle.updateTerrain(this.world);
    this.world.contactMemory.clear();
    if (this.currentId) this.createEvaluator();
    else { this.evaluator = null; this.generalFired.clear(); }
    this.emit('checkpointRestored', cp);
    return true;
  }

  result() {
    const elements = this.sequence.map((id) => ({
      id, number: EXERCISES[id].number, name: this.elementName(id), nameEn: this.rules.elements[id].nameEn, nameKa: this.rules.elements[id].nameKa,
      status: this.results[id]?.status || (this.currentId === id ? 'incomplete' : 'not reached'),
      station: this.results[id]?.station,
      mistakes: this.mistakes.filter((m) => m.element === id && !m.voided),
    }));
    const general = this.mistakes.filter((m) => m.element === 'general' && !m.voided);
    const allDone = elements.every((e) => e.status === 'completed');
    const fatal = this.mistakes.find((m) => !m.voided && isFatal(m.points));
    const penalties = this.penaltyPoints;
    const passed = allDone && !fatal && penalties <= this.rules.maxPenaltyPoints;
    let reason = '';
    if (fatal) reason = `${fatal.elementName}: ${fatal.ka || fatal.text}`;
    else if (penalties > this.rules.maxPenaltyPoints) reason = `${penalties} საჯარიმო ქულა (მაქსიმუმი ${this.rules.maxPenaltyPoints})`;
    else if (!allDone) reason = 'ყველა ელემენტი არ შესრულებულა';
    return {
      passed, score: this.rules.startPoints - penalties, penalties, maxPenalty: this.rules.maxPenaltyPoints, reason,
      elements, general, mistakes: this.mistakes.filter((m) => !m.voided), mode: this.mode, restartsUsed: this.restartsUsed,
      time: this.time, finishReason: this.finishReason,
    };
  }
}
