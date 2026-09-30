// Procedural WebAudio sound: engine idle/load, tyre rolling, collisions,
// gear & parking-brake clicks, mistake chime. No audio files.
// Kept deliberately soft: a low, rounded engine hum (no raw sawtooth buzz), quiet tyre rumble.
export class CarAudio {
  constructor() { this.ctx = null; this.enabled = true; }

  start() {
    if (this.ctx || !this.enabled) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = 0.5; this.master.connect(c.destination);
    const len = c.sampleRate * 2;
    // white noise (short effects) and brown noise (smooth rumble)
    const white = c.createBuffer(1, len, c.sampleRate), w = white.getChannelData(0);
    for (let i = 0; i < len; i++) w[i] = Math.random() * 2 - 1;
    this.noise = white;
    const brown = c.createBuffer(1, len, c.sampleRate), b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
    const loop = (buf) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };

    // engine: soft tones at the firing frequency and its low harmonics + a little brown-noise rumble,
    // through a gentle low-pass, pulsed at the firing frequency like a 4-cylinder at idle
    this.engLP = c.createBiquadFilter(); this.engLP.type = 'lowpass'; this.engLP.frequency.value = 200; this.engLP.Q.value = 0.4;
    this.engAM = c.createGain(); this.engAM.gain.value = 0.75;
    this.engGain = c.createGain(); this.engGain.gain.value = 0;
    this.engLP.connect(this.engAM); this.engAM.connect(this.engGain); this.engGain.connect(this.master);
    this.lfo = c.createOscillator(); this.lfo.frequency.value = 25;
    const depth = this.lfoDepth = c.createGain(); depth.gain.value = 0; this.lfo.connect(depth); depth.connect(this.engAM.gain); this.lfo.start();
    this.tones = [['sine', 1, 0.5], ['triangle', 2, 1.0], ['sine', 4, 0.5], ['sine', 6, 0.15]].map(([type, m, amp]) => {
      const o = c.createOscillator(); o.type = type; const g = c.createGain(); g.gain.value = amp;
      o.connect(g); g.connect(this.engLP); o.start(); return { o, m, g, amp };
    });
    const rumble = c.createGain(); rumble.gain.value = 0.35; loop(brown).connect(rumble); rumble.connect(this.engLP);

    // tyres on asphalt: low brown-noise band, grows with speed
    this.roadFilter = c.createBiquadFilter(); this.roadFilter.type = 'lowpass'; this.roadFilter.frequency.value = 300; this.roadFilter.Q.value = 0.5;
    this.roadGain = c.createGain(); this.roadGain.gain.value = 0;
    loop(brown).connect(this.roadFilter); this.roadFilter.connect(this.roadGain); this.roadGain.connect(this.master);
  }

  resume() { this.ctx?.resume?.(); }
  suspend() { this.ctx?.suspend?.(); }
  setEnabled(v) { this.enabled = v; if (this.master) this.master.gain.value = v ? 0.5 : 0; }

  burst(freq, dur, gain, q = 2, type = 'bandpass') {
    if (!this.ctx) return;
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); const t = c.currentTime;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }
  tone(freq, dur, gain, delay = 0) {
    if (!this.ctx) return;
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), t = c.currentTime + delay;
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  click() { this.burst(1800, 0.03, 0.12, 3); }
  thump() { this.burst(90, 0.3, 0.6, 1, 'lowpass'); this.burst(600, 0.1, 0.1, 1); }
  ratchet() { for (let i = 0; i < 5; i++) setTimeout(() => this.burst(2600, 0.02, 0.07, 6), i * 35); }
  chime() { this.tone(784, 0.6, 0.09); this.tone(587, 0.8, 0.09, 0.22); }
  success() { this.tone(523, 0.35, 0.07); this.tone(659, 0.35, 0.07, 0.14); this.tone(784, 0.6, 0.07, 0.28); }

  update(V) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const on = V.engineOn;
    const rpm = on ? 750 + V.throttle * 2200 + Math.min(Math.abs(V.v), 12) * 80 : 0;
    const f0 = Math.max(rpm / 60 * 2, 1);        // 4-cylinder firing frequency
    for (const { o, m } of this.tones) o.frequency.setTargetAtTime(f0 * m, t, 0.12);
    this.lfo.frequency.setTargetAtTime(f0, t, 0.12);
    // near idle the firing frequency (~25 Hz) is too low to be heard as a tone: the pulse and the 1st tone
    // sound like rapid clicking, so both fade out below ~2000 rpm and only the smooth hum stays
    const pulse = Math.min(1, Math.max(0, (rpm - 1100) / 900));
    this.lfoDepth.gain.setTargetAtTime(0.25 * pulse, t, 0.12);
    this.tones[0].g.gain.setTargetAtTime(this.tones[0].amp * pulse, t, 0.12);
    this.engLP.frequency.setTargetAtTime(260 + V.throttle * 420 + rpm * 0.03, t, 0.15);
    this.engGain.gain.setTargetAtTime(on ? 0.07 + V.throttle * 0.06 : 0, t, 0.25);
    const sp = Math.abs(V.v);
    this.roadGain.gain.setTargetAtTime(Math.min(0.05, sp * 0.012), t, 0.2);
    this.roadFilter.frequency.setTargetAtTime(220 + sp * 40, t, 0.2);
  }
}
