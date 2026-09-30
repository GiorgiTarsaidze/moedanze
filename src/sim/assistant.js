// Training assistant: combines route guidance between elements with the element coaches, and
// resolves "reference stickers" — points on a mirror or window where a course object appears at
// the geometrically ideal moment for the next action (computed from the real car/eye/mirror
// geometry, exactly how instructors place reference marks in a real car).

import { EXERCISES } from './exercises/index.js';
import { locateTarget, worldToLocal, mirrorCamera, projectLocal, eyeBearing } from './optics.js';
import { dist } from './math2d.js';

export class Assistant {
  constructor({ course, world, vehicle, exam }) {
    this.course = course; this.world = world; this.vehicle = vehicle; this.exam = exam;
    this.coaches = {};
    for (const [id, def] of Object.entries(EXERCISES)) {
      this.coaches[id] = def.module.createCoach({ vehicle, dims: world.dims, stations: world.elements[id].stations, course });
    }
    this.stickerCache = new Map();
    this.reset();
  }

  // parked = the car was just placed in P with the parking brake on (restart / checkpoint)
  reset(parked = false) {
    this.elementId = null; this.legDone = false; this.parked = parked;
    for (const c of Object.values(this.coaches)) c.reset();
  }

  legPath(name) { return this.world.routeLegs[name]; }

  update(time) {
    const V = this.vehicle, ex = this.exam;
    if (ex.state === 'finished') return { title: 'გამოცდა დასრულდა', text: 'იხილეთ შედეგების ფურცელი.', stop: true };
    // leaving the start position
    if (!ex.movedOff) {
      return { title: 'სტარტი', text: 'ფეხი მუხრუჭზე: ჩართეთ D (F), მოხსენით სადგომი მუხრუჭი (Space) და დაიძარით.',
        stop: true, gear: 'D', handbrake: false, ready: V.gear === 'D' && !V.parkingBrake,
        path: this.legPath(this.course.legFor[ex.sequence[0]]), readyAction: { path: this.legPath(this.course.legFor[ex.sequence[0]]), speed: 2.0, gear: 'D' } };
    }
    if (this.parked) {
      if (V.gear === 'D' && !V.parkingBrake) this.parked = false;
      else return { title: 'დაძვრა', text: 'ფეხი მუხრუჭზე: ჩართეთ D (F) და მოხსენით სადგომი მუხრუჭი (Space).', stop: true, gear: 'D', handbrake: false };
    }
    if (ex.state === 'finishing') {
      const d = dist(V.center(), this.course.route.finish.p);
      return { title: 'ფინიში', text: 'ყველა ელემენტი შესრულებულია. მიდით ფინიშამდე მარცხენა გზაზე და გაჩერდით.', readout: `${d.toFixed(0)} მ`,
        path: this.legPath('toFinish'), speed: 2.2, gear: 'D', showRoute: true };
    }
    const id = ex.currentId;
    const ev = ex.evaluator;
    if (id !== this.elementId) { this.elementId = id; this.legDone = false; this.coaches[id]?.reset(); }
    const name = ex.elementName(id);
    if (!ev) return null;
    const leg = this.legPath(this.course.legFor[id]);
    if (ev.status === 'waiting' && !this.legDone && leg) {
      const end = leg[leg.length - 1];
      if (dist({ x: V.x, z: V.z }, end) < 4.5 || dist(V.frontBumper(), end) < 2.0) this.legDone = true;
      else {
        return { title: `შემდეგი: ${name}`, text: `მიდით ელემენტამდე ${ex.numberOf(id)} — ${name}. მიჰყევით ისრებს.`,
          path: leg, speed: 2.4, gear: 'D', showRoute: true, leg: true };
      }
    }
    const g = this.coaches[id].update(V, ev, time);
    if (!g) return { title: name, text: 'გააგრძელეთ.', path: leg, speed: 1.5, gear: 'D' };
    if (g.sticker) g.stickerResolved = this.resolveSticker(g.sticker);
    return g;
  }

  resolveSticker(s) {
    // `reverse`: mirror view the sticker is for (right mirror dips in R); default = in reverse
    const reverse = s.reverse ?? true, key = s.id + reverse + JSON.stringify(s.pose);
    let r = this.stickerCache.get(key);
    if (!r) {
      const target = { x: s.target.x, y: 0.55, z: s.target.z };
      r = { id: s.id, ...locateTarget(s.pose, target, { views: s.views, reverse }), target };
      this.stickerCache.set(key, r);
    }
    // live position of the target in the same view (for the alignment indicator)
    const V = this.vehicle;
    const pose = { x: V.x, z: V.z, heading: V.heading, y: 0 };
    const pl = worldToLocal(pose, r.target);
    let live;
    if (r.view === 'eye') { const b = eyeBearing(pl); live = { yaw: b.yaw, pitch: b.pitch, visible: true }; }
    else {
      const pr = projectLocal(mirrorCamera(r.view, { reverse: V.gear === 'R' }), pl);
      live = { u: 1 - pr.u, v: pr.v, visible: pr.inside };
    }
    const aligned = r.view === 'eye' ? Math.abs(live.yaw - r.yaw) < 0.03 : live.visible && Math.abs(live.u - r.u) < 0.04;
    return { ...r, live, aligned };
  }
}
