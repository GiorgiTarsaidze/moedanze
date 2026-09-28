// DOM overlay: HUD, training guidance, mistake toasts, telemetry, minimap, result sheet.

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ptsLabel = (p) => (typeof p === 'number' ? `−${p}` : p === 'DQ' ? 'დისკვალიფიკაცია' : 'ჩაჭრა');
const STATUS_KA = { completed: 'შესრულდა', failed: 'ვერ შესრულდა', incomplete: 'დაუსრულებელი', 'not reached': 'არ მიუღწევია' };

export class UI {
  constructor(sim) {
    this.sim = sim;
    this.status = $('#hud-status'); this.guide = $('#guide'); this.toasts = $('#toasts');
    this.tele = $('#telemetry'); this.mini = $('#minimap');
    this.lockhint = $('#lockhint'); this.keys = $('#keys');
    this.showMinimap = true; this.lastStatus = '';
    this.buildMinimapBackground();
  }

  toast(html, kind = '', ms = 5000) {
    const d = document.createElement('div'); d.className = `toast ${kind}`; d.innerHTML = html;
    this.toasts.prepend(d);
    while (this.toasts.children.length > 5) this.toasts.lastChild.remove();
    setTimeout(() => d.remove(), ms);
  }
  mistake(m, mode) {
    const unoff = m.official ? '' : ' <span class="unofficial">(სიმულატორის წესი)</span>';
    this.toast(`<span class="pts">${ptsLabel(m.points)}</span><b>${esc(m.element === 'general' ? 'მარშრუტი' : this.sim.rules.elements[m.element]?.nameKa)}</b><br>${esc(m.ka || m.text)}${m.detail ? ` — ${esc(m.detail)}` : ''}${unoff}`, '', mode === 'training' ? 8000 : 5000);
  }

  // ------------------------------------------------------------------ checkpoints
  cpLabel(cp) { return `${this.sim.rules.elements[cp.element].nameKa} — ${cp.kind === 'before' ? 'დაწყებამდე' : 'დასრულების შემდეგ'}`; }
  // restore buttons in the pause card and on the result sheet
  renderCheckpoints(list, onRestore) {
    for (const box of document.querySelectorAll('.cp-list')) {
      box.innerHTML = '';
      for (const cp of list) {
        const b = document.createElement('button');
        b.innerHTML = `${esc(this.sim.rules.elements[cp.element].nameKa)} <span class="when">— ${cp.kind === 'before' ? 'დაწყებამდე' : 'დასრულების შემდეგ'}</span>`;
        b.addEventListener('click', () => onRestore(cp.key));
        box.append(b);
      }
    }
  }

  updateStatus() {
    const ex = this.sim.exam, mode = ex.mode;
    const id = ex.currentId;
    const cur = ex.evaluator;
    const rules = this.sim.rules.elements[id];
    const steps = ex.sequence.map((e, i) => {
      const r = ex.results[e]?.status;
      return `<i class="${r === 'completed' ? 'done' : r === 'failed' ? 'failed' : i === ex.index ? 'cur' : ''}"></i>`;
    }).join('');
    const tl = this.sim.rules.elementTimeLimitSec;
    const elapsed = cur && cur.status === 'active' ? cur.elapsed : 0;
    let title;
    if (ex.state === 'finishing') title = 'დაბრუნდით ფინიშზე';
    else if (ex.state === 'finished') title = 'დასრულდა';
    else title = `${ex.numberOf(id)}. ${rules.nameKa}`;
    const score = mode === 'training' ? `<span class="score">${ex.score} / 100</span>` : '<span>გამოცდა</span>';
    const timer = cur?.status === 'active' ? `${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, '0')} / ${tl / 60}:00` : (cur ? 'მიახლოება' : '');
    const html = `<div class="el">${esc(title)}</div><div class="row">${score}<span>${timer}</span></div><div class="steps">${steps}</div>`;
    if (html !== this.lastStatus) { this.status.innerHTML = html; this.lastStatus = html; }
  }

  updateGuide(g, show) {
    if (!show || !g) { this.guide.classList.add('hidden'); return; }
    this.guide.classList.remove('hidden');
    const set = (sel, v) => { const el = this.guide.querySelector(sel); if (el.textContent !== (v || '')) el.textContent = v || ''; };
    set('.g-title', g.title); set('.g-text', g.text); set('.g-hint', g.hint); set('.g-readout', g.readout);
    const st = this.guide.querySelector('.g-sticker');
    if (g.stickerResolved) {
      const s = g.stickerResolved;
      const where = s.view === 'eye' ? 'ყვითელი წერტილი მინაზე' : `ყვითელი ნიშანი ${{ left: 'მარცხენა', right: 'მარჯვენა' }[s.view]} სარკეში`;
      st.textContent = s.aligned ? 'ყვითელი ნიშანი დაემთხვა' : `ორიენტირი: ჯოხი → ${where}`;
      st.classList.toggle('aligned', !!s.aligned); st.classList.remove('hidden');
    } else st.classList.add('hidden');
  }

  updateTelemetry(V, blink) {
    const g = ['P', 'R', 'N', 'D'].map((x) => `<span class="${V.gear === x ? 'on' : ''}">${x}</span>`).join('');
    this.tele.innerHTML = `<span class="ind ${V.indicatorActive('left') && blink ? 'on' : ''}">◀</span><span class="spd">${V.speedKmh.toFixed(0)}</span><span>კმ/სთ</span><span class="gear">${g}</span><span class="pb ${V.parkingBrake ? 'on' : ''}">P</span><span class="ind ${V.indicatorActive('right') && blink ? 'on' : ''}">▶</span>`;
  }

  // small key panel while driving; training-only keys are hidden in the exam, active toggles highlighted
  updateKeys(s, show) {
    this.keys.classList.toggle('hidden', !show);
    if (!show) return;
    const k = (key, label, on) => `<span class="${on ? 'on' : ''}"><kbd>${key}</kbd>${label}</span>`;
    const html = k('V', 'ხედი გარედან', s.ext) + (s.training ? k('G', 'ინსტრუქტორი', s.demo) + k('M', 'რუკა', s.minimap) : '')
      + k('Esc', 'პაუზა', false);
    if (html !== this.lastKeys) { this.keys.innerHTML = html; this.lastKeys = html; }
  }

  // ------------------------------------------------------------------ minimap
  buildMinimapBackground() {
    const w = this.sim.world, B = w.bounds;
    const s = 1.55, pad = 5;
    this.mm = { s, pad, x0: B.x0, z0: B.z0 };
    this.mini.width = Math.ceil((B.x1 - B.x0) * s + pad * 2); this.mini.height = Math.ceil((B.z1 - B.z0) * s + pad * 2);
    const bg = document.createElement('canvas'); bg.width = this.mini.width; bg.height = this.mini.height;
    const g = bg.getContext('2d');
    const X = (p) => (p.x - B.x0) * s + pad, Z = (p) => (p.z - B.z0) * s + pad;
    g.fillStyle = '#44494c'; g.fillRect(pad, pad, (B.x1 - B.x0) * s, (B.z1 - B.z0) * s);
    const poly = (pts, fill) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(p), Z(p)) : g.moveTo(X(p), Z(p)))); g.closePath(); g.fillStyle = fill; g.fill(); };
    for (const l of w.course.lawns) poly(l, '#3f7a3a');
    poly(w.course.stadium.fence, '#2f5530');
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 0.8;
    for (const m of w.markings) {
      if (m.type === 'line') { g.beginPath(); m.pts.forEach((p, i) => (i ? g.lineTo(X(p), Z(p)) : g.moveTo(X(p), Z(p)))); g.stroke(); }
      if (m.type === 'arc') { g.beginPath(); g.arc(X(m.c), Z(m.c), m.r * s, m.a0, m.a1); g.stroke(); }
    }
    for (const r of w.ramps) { const f = r.frame; const pts = [[r.a0, -r.hw], [r.a1, -r.hw], [r.a1, r.hw], [r.a0, r.hw]].map(([a, b]) => ({ x: f.o.x + f.f.x * a + f.r.x * b, z: f.o.z + f.f.z * a + f.r.z * b })); poly(pts, 'rgba(200,190,160,0.6)'); }
    g.fillStyle = '#ff7a4a'; for (const p of w.posts) g.fillRect(X(p.p) - 1, Z(p.p) - 1, 2, 2);
    this.mmBg = bg;
  }

  drawMinimap(V, guidance, show) {
    this.mini.classList.toggle('hidden', !show);
    if (!show) return;
    const g = this.mini.getContext('2d'), { s, pad, x0, z0 } = this.mm;
    const X = (p) => (p.x - x0) * s + pad, Z = (p) => (p.z - z0) * s + pad;
    g.drawImage(this.mmBg, 0, 0);
    if (guidance?.path) { g.strokeStyle = '#7fd6ff'; g.lineWidth = 2; g.beginPath(); guidance.path.forEach((p, i) => (i ? g.lineTo(X(p), Z(p)) : g.moveTo(X(p), Z(p)))); g.stroke(); }
    const c = V.corners();
    g.fillStyle = '#ffd24a'; g.beginPath(); c.forEach((p, i) => (i ? g.lineTo(X(p), Z(p)) : g.moveTo(X(p), Z(p)))); g.closePath(); g.fill();
    const f = V.frontBumper(); g.fillStyle = '#e0524a'; g.beginPath(); g.arc(X(f), Z(f), 2.2, 0, Math.PI * 2); g.fill();
  }

  // ------------------------------------------------------------------ result sheet
  showResult(res) {
    const el = $('#result');
    const verdict = res.passed ? 'ჩაბარდა' : 'ვერ ჩაბარდა';
    const official = res.restartsUsed ? `<div class="unofficial">არაოფიციალური შედეგი: გამოყენებულია თავიდან დაწყება ან საკონტროლო წერტილი (${res.restartsUsed}).</div>` : '';
    const modeNote = res.mode === 'training' ? '<div class="unofficial">სავარჯიშო გავლა — ნამდვილ გამოცდაზე დისკვალიფიკაცია გამოცდას მაშინვე ასრულებს.</div>' : '';
    el.querySelector('.res-head').innerHTML = `<div class="verdict ${res.passed ? 'pass' : 'fail'}">${verdict}</div>
      <div class="meta"><div class="big">${res.score} / 100</div><div>${res.penalties} საჯარიმო ქულა · ლიმიტი ${res.maxPenalty} · ${Math.floor(res.time / 60)} წთ ${Math.floor(res.time % 60)} წმ</div>
      <div class="why">${esc(res.reason || 'ექვსივე ელემენტი შესრულებულია ლიმიტის ფარგლებში.')}</div>${official}${modeNote}</div>`;
    const item = (m) => `<li>${esc(m.ka || m.text)}${m.detail ? ` <span class="ka">(${esc(m.detail)})</span>` : ''}: <span class="p">${ptsLabel(m.points)}</span>${m.official ? '' : ' <span class="unofficial">სიმულატორის წესი</span>'}</li>`;
    const cards = res.elements.map((e) => {
      const list = e.mistakes.length
        ? `<ul>${e.mistakes.map(item).join('')}</ul>`
        : (e.status === 'completed' ? '<div class="ok">შესრულდა შეცდომების გარეშე</div>' : '');
      return `<div class="res-el"><h4>${e.number}. ${esc(e.nameKa)} <span class="st ${e.status}">${STATUS_KA[e.status] || e.status}${e.station ? ' · №' + e.station : ''}</span></h4>${list}</div>`;
    });
    if (res.general.length) cards.push(`<div class="res-el"><h4>ზოგადი <span class="st">მარშრუტი</span></h4><ul>${res.general.map(item).join('')}</ul></div>`);
    el.querySelector('.res-body').innerHTML = cards.join('');
    el.classList.remove('hidden');
  }
}
