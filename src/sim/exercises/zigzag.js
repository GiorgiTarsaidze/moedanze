// Exercise 2 — Zigzag / slalom (ზიგზაგი)
//
// Station frame: origin = centre line at the stop line, f = direction of travel (north at Rustavi),
// b = to the right. Corridor b in [-W/2, W/2], a in [0, LEN]. A start post stands at the left end
// of the stop line (a = 0, b = 0). Centre posts at b = 0,
// a = FIRST + i * SPACING. A painted white arrow shows that the first post is passed on its left.

import { makeFrame, toLocal, toWorld, line, dashed, text, arrow, L, tyreTouches, relHeading,
  StandstillTracker, ElementEvaluator } from './common.js';
import { DEG, clamp } from '../math2d.js';

export function buildStation(st, dims) {
  const W = dims.ZIGZAG_WIDTH, hw = W / 2, lw = dims.LINE_WIDTH, LEN = st.length ?? dims.ZIGZAG_LENGTH;
  const frame = makeFrame(st.o, st.f);
  const postsA = Array.from({ length: dims.ZIGZAG_POSTS }, (_, i) => dims.ZIGZAG_FIRST_POST + i * dims.ZIGZAG_POST_SPACING);
  const heading = Math.atan2(st.f.z, st.f.x);
  const g = {
    id: st.id, frame, W, hw, LEN, postsA,
    lines: [
      { name: 'მარცხენა საზღვარი', a: toWorld(frame, 0, -hw), b: toWorld(frame, LEN, -hw) },
      { name: 'მარჯვენა საზღვარი', a: toWorld(frame, 0, hw), b: toWorld(frame, LEN, hw) },
    ],
    // weave posts, then the start post at the left end of the stop line (drawn on the map; not woven)
    posts: [...postsA.map((a, i) => ({ p: toWorld(frame, a, 0), name: `ჯოხი ${i + 1}`, a })), { p: toWorld(frame, 0, 0), name: 'სასტარტო ჯოხი', a: 0 }],
    markings: [
      line(L(frame, [[0, -hw], [LEN, -hw]]), lw),
      line(L(frame, [[0, hw], [LEN, hw]]), lw),
      dashed(L(frame, [[0, 0], [LEN, 0]]), lw, 1.0, 1.0),
      line(L(frame, [[0, 0], [0, hw]]), 0.3),
      text('სდექ', toWorld(frame, -1.2, hw / 2), heading, 0.8),
      arrow(toWorld(frame, 1.4, hw / 2 - 0.2), st.f, 3.6, -1),
    ],
  };
  g.posts.forEach((p, i) => { p.id = `zigzag-${st.id}-post${i}`; });
  return g;
}

export class ZigzagEvaluator extends ElementEvaluator {
  constructor(ctx, stations) {
    super('zigzag', ctx);
    this.stations = stations;
    this.still = new StandstillTracker();
    this.passed = 0; this.prevA = null; this.back = 0;
  }

  update(veh, dt, time) {
    const stillT = this.still.update(veh.v, dt);
    if (this.status === 'waiting') {
      for (const g of this.stations) {
        const fb = toLocal(g.frame, veh.frontBumper()), c = toLocal(g.frame, veh.center());
        if (fb.a > 0 && fb.a < 3 && Math.abs(c.b) < g.hw + 1 && Math.abs(relHeading(g.frame, veh.heading)) < 50 * DEG) {
          this.engage(g, time); this.phase = 'weaving'; this.prevA = c.a; break;
        }
      }
      return;
    }
    if (this.status !== 'active') return;
    const g = this.station, f = g.frame;
    const c = toLocal(f, veh.center());

    // posts passed in order: side check when the car's centre crosses each post
    while (this.passed < g.postsA.length && this.prevA < g.postsA[this.passed] && c.a >= g.postsA[this.passed]) {
      const i = this.passed;
      const needLeft = i % 2 === 0;       // 1st post on its left (car west of it), then alternate
      const ok = needLeft ? c.b < 0 : c.b > 0;
      if (!ok) this.penalize(i === 0 ? 'wrongStart' : 'notBetweenPosts', `ჯოხი ${i + 1}`);
      this.passed++;
    }
    this.prevA = Math.max(this.prevA, c.a);

    const wheels = veh.wheels();
    for (const ln of g.lines) if (tyreTouches(wheels, ln.a, ln.b, this.ctx.dims.LINE_WIDTH).length) this.penalize('markingOrPost', ln.name);
    for (const ct of this.newContacts(veh)) this.penalize('markingOrPost', ct.label);
    if (stillT > this.ctx.rules.stopDetectSeconds) this.penalize('stopped');
    if (veh.v < 0) this.back += -veh.v * dt;
    if (this.back > this.ctx.rules.reverseDistanceTolerance) this.penalize('reversed', `${this.back.toFixed(1)} მ`);
    if (!veh.engineOn) this.penalize('engineOff');

    if (c.a > g.postsA[g.postsA.length - 1] + 5) {
      if (this.passed < g.postsA.length) this.penalize('notBetweenPosts', 'ჯოხები გამოტოვებულია');
      this.complete();
    } else if (Math.abs(c.b) > g.hw + 2.5 || c.a < -6) this.fail('notPerformed');
    this.info = { station: g.id, postsPassed: this.passed, lateral: c.b };
  }

  skipped(veh) {
    return this.stations.some((g) => {
      const c = toLocal(g.frame, veh.center());
      return c.a > g.LEN && c.a < g.LEN + 30 && Math.abs(c.b) < g.hw + 6;
    });
  }
}

// ------------------------------------------------------------------------------------------
// Coach: rear-axle reference path, a cosine weave with its apexes level with the posts.
// ------------------------------------------------------------------------------------------
export function createCoach(env) {
  const A = 1.3;                                          // lateral amplitude of the rear axle (m)
  let g = null, path = null, step = 'approach';
  function buildPath() {
    const pts = [];
    const first = g.postsA[0], sp = g.postsA[1] - g.postsA[0], last = g.postsA[g.postsA.length - 1];
    for (let a = -8; a <= g.LEN + 2; a += 0.25) {
      let b;
      if (a < first - sp) b = A;
      else if (a <= last) b = -A * Math.cos(Math.PI * (a - first) / sp);
      else b = A;
      pts.push(toWorld(g.frame, a, b));
    }
    return pts;
  }
  return {
    id: 'zigzag',
    reset() { g = null; path = null; step = 'approach'; },
    update(veh, ev) {
      if (!g || (ev.station && ev.station !== g)) { g = ev.station || env.stations[0]; path = buildPath(); }
      const c = toLocal(g.frame, veh.center());
      const fb = toLocal(g.frame, veh.frontBumper());
      if (ev.status === 'waiting') {
        return { step: 'approach', title: 'ზიგზაგი: ვუახლოვდებით დაბრკოლებას', text: 'შედით ზოლის მარჯვენა ნახევარში. როგორც ისარი გიჩვენებთ, პირველ ჯოხს შემოუარეთ მარცხენა მხრიდან, შემდეგ იმოძრავეთ ჯოხებს შორის ზიგზაგით',
          readout: fb.a < 0 ? `სდექ-ხაზამდე ${(-fb.a).toFixed(1)} მ` : '', gear: 'D', path, speed: 1.6, showPath: true };
      }
      const next = g.postsA.find((a) => a > c.a);
      const idx = g.postsA.indexOf(next);
      const side = idx < 0 ? '' : (idx % 2 === 0 ? 'LEFT' : 'RIGHT');
      const steerHint = idx < 0 ? 'გაასწორეთ საჭე და გააგრძელეთ' : `შემდეგი: ჯოხი ${idx + 1} — დატოვეთ ${side === 'LEFT' ? 'მარჯვნივ' : 'მარცხნივ'} (შემოუარეთ ${side === 'LEFT' ? 'მარცხენა' : 'მარჯვენა'} მხრიდან).`;
      return { step: 'weave', title: 'ზიგზაგი', text: 'იმოძრავეთ შეუჩერებლად, არ გაჩერდეთ და არ ჩართოთ უკუსვლა. საჭე დროულად მოაბრუნეთ. ეცადეთ საჭის მობრუნება დაიწყოთ მაშინვე, როდესაც მანქანის ცხვირი ჯოხებს შორის შევა',
        hint: steerHint, gear: 'D', path, speed: 1.5, showPath: true, focus: idx >= 0 ? g.posts[idx].p : null };
    },
  };
}
