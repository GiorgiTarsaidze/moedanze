// Exercise 5 — Figure eight (რვიანი)
//
// Two painted inner circles and an outer 8-shaped boundary (union of two discs) with a single
// opening in the outer line of the top loop. Direction of travel from the map arrows: top loop
// anticlockwise, bottom loop clockwise (as seen from above with north up). Entry through the
// right-hand (western) half of the opening, exit through the left-hand (eastern) half.
// Evaluation uses the actual tyre contact points against the painted circles/arcs, and the
// angle swept by the car around each loop centre (not checkpoints).

import { ElementEvaluator, StandstillTracker, arc, arrow } from './common.js';
import { DEG, clamp, wrapAngle, sub, len, segSegIntersect } from '../math2d.js';

const toDeg = (r) => r / DEG;
const ang = (c, p) => Math.atan2(p.z - c.z, p.x - c.x);

export function buildStation(st, dims) {
  const rIn = dims.FIG8_R_INNER, rOut = dims.FIG8_R_OUTER, lw = dims.LINE_WIDTH;
  const C1 = st.top, C2 = st.bottom;
  const d = len(sub(C2, C1));
  const ax = { x: (C2.x - C1.x) / d, z: (C2.z - C1.z) / d };
  const M = { x: (C1.x + C2.x) / 2, z: (C1.z + C2.z) / 2 };
  const h = Math.sqrt(Math.max(0, rOut * rOut - (d / 2) ** 2));
  const perp = { x: -ax.z, z: ax.x };
  const cuspA = { x: M.x + perp.x * h, z: M.z + perp.z * h }, cuspB = { x: M.x - perp.x * h, z: M.z - perp.z * h };
  const o0 = st.openingFrom * DEG, o1 = st.openingTo * DEG;
  const opening = { a: { x: C1.x + rOut * Math.cos(o0), z: C1.z + rOut * Math.sin(o0) }, b: { x: C1.x + rOut * Math.cos(o1), z: C1.z + rOut * Math.sin(o1) } };

  // outer arcs: parts of each outer circle not inside the other disc (and not the opening)
  const a1c = [ang(C1, cuspA), ang(C1, cuspB)], a2c = [ang(C2, cuspA), ang(C2, cuspB)];
  const outerArcs = [];
  const addArcs = (C, from, to, cut) => {
    // walk the circle from `from` to `to` (increasing angle) and split around the opening cut
    let a0 = from, a1 = to;
    while (a1 <= a0) a1 += Math.PI * 2;
    if (!cut) { outerArcs.push({ c: C, r: rOut, a0, a1 }); return; }
    let c0 = cut[0], c1 = cut[1];
    while (c0 < a0) { c0 += Math.PI * 2; c1 += Math.PI * 2; }
    if (c0 > a1) { outerArcs.push({ c: C, r: rOut, a0, a1 }); return; }
    outerArcs.push({ c: C, r: rOut, a0, a1: c0 });
    if (c1 < a1) outerArcs.push({ c: C, r: rOut, a0: c1, a1 });
  };
  // For each circle the exterior part runs from one cusp to the other the "long way" round.
  const pickLong = (C, pair, other) => {
    const [p, q] = pair;
    const mid = (p + q) / 2; // test which direction's midpoint lies outside the other disc
    const test = (m) => { const x = C.x + rOut * Math.cos(m), z = C.z + rOut * Math.sin(m); return Math.hypot(x - other.x, z - other.z) > rOut; };
    let lo = Math.min(p, q), hi = Math.max(p, q);
    return test((lo + hi) / 2) ? [lo, hi] : [hi, lo + Math.PI * 2];
  };
  const [t0, t1] = pickLong(C1, a1c, C2);
  const [b0, b1] = pickLong(C2, a2c, C1);
  addArcs(C1, t0, t1, [o0, o1]);
  addArcs(C2, b0, b1, null);

  const markings = [
    arc(C1, rIn, 0, Math.PI * 2, lw), arc(C2, rIn, 0, Math.PI * 2, lw),
    ...outerArcs.map((a) => arc(a.c, a.r, a.a0, a.a1, lw)),
  ];
  // direction arrows (as in the PDF): top loop anticlockwise, bottom loop clockwise
  const rMid = (rIn + rOut) / 2;
  const arrowAt = (C, th, cw) => {
    const p = { x: C.x + rMid * Math.cos(th), z: C.z + rMid * Math.sin(th) };
    const dir = cw ? { x: -Math.sin(th), z: Math.cos(th) } : { x: Math.sin(th), z: -Math.cos(th) };
    return arrow(p, dir, 1.8, 0);
  };
  markings.push(arrowAt(C1, -125 * DEG, false), arrowAt(C1, -15 * DEG, false), arrowAt(C2, -150 * DEG, true), arrowAt(C2, -10 * DEG, true));

  // Posts stand on the painted lines (MIA order 598, annex 4): around both inner circles and along the
  // outer line up to the opening, one at each waist corner; none across the opening.
  const SP = dims.FIG8_POST_SPACING, posts = [];
  const addPost = (p, name) => { if (!posts.some((q) => Math.hypot(q.p.x - p.x, q.p.z - p.z) < 0.5)) posts.push({ p, name }); };
  const onCircle = (C, r, t) => ({ x: C.x + r * Math.cos(t), z: C.z + r * Math.sin(t) });
  for (const C of [C1, C2]) {
    const n = Math.round((2 * Math.PI * rIn) / SP);
    for (let k = 0; k < n; k++) addPost(onCircle(C, rIn, (2 * Math.PI * k) / n), 'შიდა წრის ჯოხი');
  }
  for (const a of outerArcs) {
    const n = Math.max(1, Math.round(((a.a1 - a.a0) * a.r) / SP));
    for (let k = 0; k <= n; k++) addPost(onCircle(a.c, a.r, a.a0 + ((a.a1 - a.a0) * k) / n), 'გარე ხაზის ჯოხი');
  }
  posts.forEach((p, i) => { p.id = `figure8-${st.id}-post${i}`; });

  return { id: st.id, C1, C2, rIn, rOut, M, cuspA, cuspB, opening, outerArcs, markings, posts, lines: [],
    topDir: st.topDirection === 'cw' ? 1 : -1, botDir: st.bottomDirection === 'cw' ? 1 : -1, frame: { o: C1, f: { x: 1, z: 0 }, r: { x: 0, z: 1 } } };
}

// distance from a point to the nearest outer arc
function distToArcs(g, p) {
  let best = Infinity;
  for (const a of g.outerArcs) {
    let th = ang(a.c, p);
    while (th < a.a0) th += Math.PI * 2;
    while (th > a.a0 + Math.PI * 2) th -= Math.PI * 2;
    if (th <= a.a1) best = Math.min(best, Math.abs(Math.hypot(p.x - a.c.x, p.z - a.c.z) - a.r));
    else {
      const e0 = { x: a.c.x + a.r * Math.cos(a.a0), z: a.c.z + a.r * Math.sin(a.a0) };
      const e1 = { x: a.c.x + a.r * Math.cos(a.a1), z: a.c.z + a.r * Math.sin(a.a1) };
      best = Math.min(best, Math.hypot(p.x - e0.x, p.z - e0.z), Math.hypot(p.x - e1.x, p.z - e1.z));
    }
  }
  return best;
}
const inUnion = (g, p) => Math.hypot(p.x - g.C1.x, p.z - g.C1.z) < g.rOut || Math.hypot(p.x - g.C2.x, p.z - g.C2.z) < g.rOut;

export class Figure8Evaluator extends ElementEvaluator {
  constructor(ctx, stations) {
    super('figure8', ctx);
    this.stations = stations;
    this.still = new StandstillTracker();
    this.progress = { top: 0, bottom: 0, wrong: 0 };
    this.segments = [];     // sequence of loops visited: 'T', 'B'
    this.prevC = null; this.prevAng = null; this.back = 0;
  }

  // Where did the car centre cross the outer boundary? t in [0,1] along the opening
  // (0 = western/right end, 1 = eastern/left end) or null if it crossed a painted outer line.
  openingParam(g, p) {
    const st = this.ctx.course.elements.figure8.stations[0];
    const o0 = st.openingFrom * DEG, o1 = st.openingTo * DEG;
    const d1 = Math.hypot(p.x - g.C1.x, p.z - g.C1.z), d2 = Math.hypot(p.x - g.C2.x, p.z - g.C2.z);
    if (d2 < d1) return null;
    const th = ang(g.C1, p);
    const t = wrapAngle(th - o0) / wrapAngle(o1 - o0);
    return t >= -0.03 && t <= 1.03 ? clamp(t, 0, 1) : null;
  }

  update(veh, dt, time) {
    const g = this.stations[0];
    const stillT = this.still.update(veh.v, dt);
    const c = veh.center();
    const prev = this.prevC || c;
    this.prevC = c;

    if (this.status === 'waiting') {
      if (inUnion(g, c)) {
        this.engage(g, time); this.phase = 'loops';
        const t = this.openingParam(g, c);
        if (t === null || t > 0.5) this.penalize('wrongStart', t === null ? 'ღიობიდან არ შესულა' : 'შევიდა მარცხენა ნახევრიდან');
      }
      return;
    }
    if (this.status !== 'active') return;

    // tyres on the painted lines
    const wheels = veh.wheels();
    const tol = this.ctx.dims.LINE_WIDTH / 2 + 0.1;
    for (const w of wheels) {
      const d1 = Math.hypot(w.x - g.C1.x, w.z - g.C1.z), d2 = Math.hypot(w.x - g.C2.x, w.z - g.C2.z);
      if (d1 < g.rIn + tol || d2 < g.rIn + tol) { this.penalize('markingOrPost', 'შიდა წრე'); break; }
      const nearOpening = this.inOpeningSector(g, w);
      if (!nearOpening && (distToArcs(g, w) < tol || !inUnion(g, w))) { this.penalize('markingOrPost', 'გარე ხაზი'); break; }
    }
    for (const ct of this.newContacts(veh)) this.penalize('markingOrPost', ct.label);
    if (stillT > this.ctx.rules.stopDetectSeconds) this.penalize('stopped');
    if (veh.v < 0) this.back += -veh.v * dt;
    if (this.back > this.ctx.rules.reverseDistanceTolerance) this.penalize('reversed');
    if (!veh.engineOn) this.penalize('engineOff');

    // angular progress around the loop the car is in
    const d1 = Math.hypot(c.x - g.C1.x, c.z - g.C1.z), d2 = Math.hypot(c.x - g.C2.x, c.z - g.C2.z);
    const loop = d1 <= d2 ? 'T' : 'B';
    const C = loop === 'T' ? g.C1 : g.C2;
    const a = ang(C, c);
    if (this.prevAng && this.prevAng.loop === loop) {
      const da = wrapAngle(a - this.prevAng.a);
      const want = loop === 'T' ? g.topDir : g.botDir;         // +1 = clockwise (increasing page angle)
      const prog = da * want;
      if (prog > 0) this.progress[loop === 'T' ? 'top' : 'bottom'] += prog; else this.progress.wrong += -prog;
    }
    if (this.segments[this.segments.length - 1] !== loop) this.segments.push(loop);
    this.prevAng = { loop, a };
    if (this.progress.wrong > 70 * DEG) this.penalize('wrongRoute', 'წრე გაიარა არასწორი მიმართულებით');

    // leaving the figure eight
    if (!inUnion(g, c)) {
      const t = this.openingParam(g, c);
      const done = this.progress.top > 200 * DEG && this.progress.bottom > 270 * DEG && this.segments.join('').startsWith('TBT');
      if (!done) this.penalize('wrongRoute', `გამოვიდა ორივე წრის დასრულებამდე (ზედა ${toDeg(this.progress.top).toFixed(0)}°, ქვედა ${toDeg(this.progress.bottom).toFixed(0)}°)`);
      else if (t === null) this.penalize('wrongRoute', 'გამოვიდა გარე ხაზის გადაკვეთით');
      else if (t < 0.5) this.penalize('wrongExit', 'გამოვიდა ღიობის მარჯვენა ნახევრიდან');
      if (this.status === 'active') this.complete();
    }
    this.info = { top: toDeg(this.progress.top).toFixed(0), bottom: toDeg(this.progress.bottom).toFixed(0), seq: this.segments.join('') };
  }

  inOpeningSector(g, p) {
    const th = ang(g.C1, p);
    const d = Math.hypot(p.x - g.C1.x, p.z - g.C1.z);
    const o0 = this.ctx.course.elements.figure8.stations[0].openingFrom * DEG, o1 = this.ctx.course.elements.figure8.stations[0].openingTo * DEG;
    return d > g.rIn + 1 && wrapAngle(th - o0) >= -0.05 && wrapAngle(o1 - th) >= -0.05;
  }

  skipped(veh) {
    const hill = this.ctx.course.elements.hill.stations[0];
    return Math.hypot(veh.x - hill.o.x, veh.z - hill.o.z) < 6;
  }
}

// ------------------------------------------------------------------------------------------
// Coach: reference path for the rear axle (radius between the lines), built from tangent lines
// and arcs. Training shows it as a ribbon; steering advice comes from the path curvature.
// ------------------------------------------------------------------------------------------
export function buildFigure8Path(g, rho) {
  const pts = [];
  const C1 = g.C1, C2 = g.C2, M = g.M;
  const P = (C, th) => ({ x: C.x + rho * Math.cos(th), z: C.z + rho * Math.sin(th) });
  const lineTo = (a, b, step = 0.25) => { const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step)); for (let i = 1; i <= n; i++) pts.push({ x: a.x + (b.x - a.x) * i / n, z: a.z + (b.z - a.z) * i / n }); };
  const arcTo = (C, a0, a1, dir) => { // dir -1 = decreasing angle (anticlockwise on the map)
    let span = dir < 0 ? a0 - a1 : a1 - a0;
    while (span < 0) span += Math.PI * 2;
    const n = Math.ceil(span * rho / 0.25);
    for (let i = 1; i <= n; i++) pts.push(P(C, a0 + dir * span * i / n));
  };
  const beta = Math.acos(clamp(rho / Math.hypot(M.x - C1.x, M.z - C1.z), -1, 1));
  const aM1 = ang(C1, M), aM2 = ang(C2, M);
  const topDir = g.topDir, botDir = g.botDir;
  // tangent point on C1 leaving towards M with top direction: heading must point at M
  const pick = (C, aM, dir, towards) => {
    for (const s of [1, -1]) {
      const th = aM + s * beta;
      const T = P(C, th);
      const hd = dir > 0 ? { x: -Math.sin(th), z: Math.cos(th) } : { x: Math.sin(th), z: -Math.cos(th) };
      const v = towards ? sub(M, T) : sub(T, M);
      if (hd.x * v.x + hd.z * v.z > 0) return th;
    }
    return aM;
  };
  const thJ = -130 * DEG;          // entry: crosses the right half of the opening clear of its end post
  const J = P(C1, thJ);
  const hJ = topDir < 0 ? { x: Math.sin(thJ), z: -Math.cos(thJ) } : { x: -Math.sin(thJ), z: Math.cos(thJ) };
  const S0 = { x: J.x - hJ.x * 12, z: J.z - hJ.z * 12 };
  pts.push(S0); lineTo(S0, J);
  const T1 = pick(C1, aM1, topDir, true), T2 = pick(C2, aM2, botDir, false);
  arcTo(C1, thJ, T1, topDir);
  lineTo(P(C1, T1), P(C2, T2));
  const T3 = pick(C2, aM2, botDir, true), T4 = pick(C1, aM1, topDir, false);
  arcTo(C2, T2, T3, botDir);
  lineTo(P(C2, T3), P(C1, T4));
  const thX = -17 * DEG;           // exit: crosses the left half of the opening clear of its end post
  arcTo(C1, T4, thX, topDir);
  const X = P(C1, thX);
  const hX = topDir < 0 ? { x: Math.sin(thX), z: -Math.cos(thX) } : { x: -Math.sin(thX), z: Math.cos(thX) };
  lineTo(X, { x: X.x + hX.x * 9, z: X.z + hX.z * 9 });
  return pts;
}

export function createCoach(env) {
  const g = env.stations[0];
  const rho = 5.0;                  // rear-axle radius: nose ~0.4 m inside the outer posts, mirror clear of the inner ones
  const path = buildFigure8Path(g, rho);
  return {
    id: 'figure8',
    path,
    reset() {},
    update(veh, ev) {
      const info = ev.info || {};
      if (ev.status === 'waiting') {
        return { step: 'approach', title: 'რვიანი: მიახლოება', text: 'შედით ღიობის მარჯვენა (დასავლეთის) ნახევრიდან, ზედა წრეში. ღიობის ბოლო ჯოხს ნუ მიუახლოვდებით.',
          gear: 'D', path, speed: 1.6, showPath: true };
      }
      const t = +info.top || 0, b = +info.bottom || 0;
      let hint = 'ზედა წრე — საათის ისრის საწინააღმდეგოდ, საჭე მარცხნივ. მანქანის ცხვირი გარე ჯოხების გასწვრივ (~0.5 მ-ით შიგნით); შიდა წრეს ნუ მიეკვრით — უკანა საბურავი ჯოხებს მოედება.';
      if (info.seq === 'TB') hint = 'ქვედა წრე — საათის ისრის მიმართულებით, საჭე მარჯვნივ. ცხვირი გარე ჯოხების გასწვრივ; შიდა ჯოხებს მარჯვენა სარკე ნუ მიუახლოვდება.';
      if (info.seq?.startsWith('TBT')) hint = 'დაასრულეთ ზედა წრე და გამოდით ღიობის მარცხენა ნახევრიდან — ღიობის ბოლო ჯოხს ნუ მიუახლოვდებით.';
      return { step: 'loops', title: 'რვიანი', text: 'იმოძრავეთ ნელა და თანაბრად, ზოლის შუაში. არ გაჩერდეთ და არ ჩართოთ უკუსვლა.', hint,
        readout: `ზედა ${t}°  ქვედა ${b}°`, gear: 'D', path, speed: 1.15, showPath: true, lookahead: 0.7 };
    },
  };
}
