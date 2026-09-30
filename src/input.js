// Keyboard / mouse / gamepad input -> vehicle input object + discrete actions.
export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.stale = new Set();            // keys held through a restart: ignored until released
    this.actions = [];                 // queued discrete actions
    this.look = { dx: 0, dy: 0 };
    this.canvas = canvas;
    this.locked = false;
    this.enabled = false;
    const map = {
      KeyF: 'gearD', KeyR: 'gearR', KeyN: 'gearN', KeyP: 'gearP', KeyZ: 'gearUp', KeyX: 'gearDown',
      Space: 'parkingBrake', KeyV: 'camera',
      KeyM: 'minimap', KeyG: 'demo', Escape: 'pause', Backspace: 'restartExercise', KeyH: 'hud',
    };
    const driving = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    window.addEventListener('keydown', (e) => {
      if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (driving.has(e.code) || map[e.code]) e.preventDefault();
      if (e.code === 'Escape') { this.actions.push('pause'); return; }
      if (!this.enabled) return;
      if (driving.has(e.code)) { if (!this.stale.has(e.code)) this.keys.add(e.code); }
      else if (map[e.code] && !e.repeat) this.actions.push(map[e.code]);
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); this.stale.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); this.stale.clear(); });
    canvas.addEventListener('click', () => { if (this.enabled && !this.locked) canvas.requestPointerLock?.()?.catch?.(() => {}); });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; this.lockTime = performance.now(); });
    document.addEventListener('mousemove', (e) => {
      // ignore the jump some browsers report right after pointer lock, and clamp spikes
      if (!this.locked || performance.now() - (this.lockTime || 0) < 250) return;
      this.look.dx += Math.max(-120, Math.min(120, e.movementX)); this.look.dy += Math.max(-120, Math.min(120, e.movementY));
    });
    canvas.addEventListener('mousedown', (e) => { if (e.button === 2) this.zoom = true; });
    window.addEventListener('mouseup', (e) => { if (e.button === 2) this.zoom = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.zoom = false;
  }

  // After the car is put back (restart, checkpoint) pedals and steering start from zero: a key that
  // is still held counts again only after it is released and pressed.
  releaseHeld() { for (const k of this.keys) this.stale.add(k); this.keys.clear(); }

  takeActions() { const a = this.actions; this.actions = []; return a; }
  takeLook() { const l = { ...this.look }; this.look.dx = 0; this.look.dy = 0; return l; }

  vehicleInput(selfCenter = true) {
    const k = this.keys;
    const inp = {
      throttleKey: k.has('KeyW') || k.has('ArrowUp'),
      brakeKey: k.has('KeyS') || k.has('ArrowDown'),
      steerLeft: k.has('KeyA') || k.has('ArrowLeft'),
      steerRight: k.has('KeyD') || k.has('ArrowRight'),
      selfCenter,
    };
    // gamepad (optional): left stick = steering wheel position, triggers = pedals
    const gp = navigator.getGamepads ? [...navigator.getGamepads()].find((g) => g && g.connected) : null;
    if (gp) {
      const sx = gp.axes[0] || 0, rt = gp.buttons[7]?.value || 0, lt = gp.buttons[6]?.value || 0;
      if (Math.abs(sx) > 0.06) inp.steerTarget = sx;
      if (rt > 0.03) inp.throttle = rt;
      if (lt > 0.03) inp.brake = lt;
    }
    return inp;
  }
}
