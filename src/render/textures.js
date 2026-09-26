// Procedural canvas textures (no external assets).
import * as THREE from 'three';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, repeat = 1, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function asphaltTexture() {
  const c = canvas(512, 512), g = c.getContext('2d'), r = rng(7);
  g.fillStyle = '#5d6163'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 26000; i++) {
    const v = 70 + r() * 60 | 0; g.fillStyle = `rgba(${v},${v + 2},${v + 4},${0.25 + r() * 0.4})`;
    g.fillRect(r() * 512, r() * 512, 1 + r() * 2, 1 + r() * 2);
  }
  for (let i = 0; i < 40; i++) { // patches / wear
    g.fillStyle = `rgba(${r() < 0.5 ? 40 : 110},${r() < 0.5 ? 42 : 112},${r() < 0.5 ? 45 : 114},0.05)`;
    g.beginPath(); g.ellipse(r() * 512, r() * 512, 20 + r() * 80, 10 + r() * 40, r() * 3, 0, Math.PI * 2); g.fill();
  }
  return tex(c, 1);
}

export function grassTexture() {
  const c = canvas(256, 256), g = c.getContext('2d'), r = rng(3);
  g.fillStyle = '#4f7d38'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const h = 80 + r() * 50 | 0; g.fillStyle = `rgba(${40 + r() * 40 | 0},${h + 40},${30 + r() * 25 | 0},0.5)`;
    g.fillRect(r() * 256, r() * 256, 1, 2 + r() * 3);
  }
  return tex(c, 1);
}

export function concreteTexture() {
  const c = canvas(128, 128), g = c.getContext('2d'), r = rng(11);
  g.fillStyle = '#b9b8b2'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 3000; i++) { const v = 150 + r() * 60 | 0; g.fillStyle = `rgba(${v},${v},${v - 4},0.35)`; g.fillRect(r() * 128, r() * 128, 1, 1); }
  return tex(c, 1);
}

export function fenceTexture() {
  const c = canvas(64, 64), g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(190,196,198,0.9)'; g.lineWidth = 2;
  for (let i = -64; i < 128; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.stroke(); g.beginPath(); g.moveTo(i + 64, 0); g.lineTo(i, 64); g.stroke(); }
  const t = tex(c, 1); return t;
}

export function postTexture() {
  const c = canvas(16, 128), g = c.getContext('2d');
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#f4f4f0' : '#e2522d'; g.fillRect(0, i * 16, 16, 16); }
  const t = tex(c, 1); t.wrapS = THREE.ClampToEdgeWrapping; return t;
}

export function windowsTexture(seed = 1) {
  const c = canvas(256, 256), g = c.getContext('2d'), r = rng(seed);
  g.fillStyle = '#c9c2b4'; g.fillRect(0, 0, 256, 256);
  for (let y = 8; y < 256; y += 32) for (let x = 8; x < 256; x += 32) {
    g.fillStyle = r() < 0.2 ? '#e8e2c8' : `rgb(${50 + r() * 30 | 0},${60 + r() * 30 | 0},${70 + r() * 30 | 0})`;
    g.fillRect(x, y, 18, 20);
    if (r() < 0.3) { g.fillStyle = '#a79f90'; g.fillRect(x - 3, y + 20, 24, 4); }
  }
  return tex(c, 1);
}

// Text painted on the road (e.g. "სდექ"), white on transparent
export function roadTextTexture(text) {
  const c = canvas(512, 160), g = c.getContext('2d');
  g.clearRect(0, 0, 512, 160);
  g.fillStyle = '#f4f4ee';
  g.font = '700 118px "Noto Sans Georgian", "Barlow Condensed", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 84);
  const t = tex(c, 1); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}

export function signTexture(type, text, sub) {
  const c = canvas(256, 256), g = c.getContext('2d');
  if (type === 'steep') {
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = '#d42b25'; g.beginPath(); g.moveTo(128, 10); g.lineTo(248, 226); g.lineTo(8, 226); g.closePath(); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(128, 46); g.lineTo(214, 204); g.lineTo(42, 204); g.closePath(); g.fill();
    g.fillStyle = '#111'; g.beginPath(); g.moveTo(66, 190); g.lineTo(190, 190); g.lineTo(190, 110); g.closePath(); g.fill();
    g.font = '700 40px "Barlow Condensed", sans-serif'; g.textAlign = 'center'; g.fillText(text, 110, 180);
  } else {
    g.fillStyle = '#1f5fa8'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#fff'; g.lineWidth = 8; g.strokeRect(10, 10, 236, 236);
    g.fillStyle = '#fff'; g.textAlign = 'center';
    g.font = '700 120px "Barlow Condensed", sans-serif'; g.fillText(text, 128, 140);
    g.font = '600 22px "Noto Sans Georgian", sans-serif';
    wrapText(g, sub || '', 128, 186, 220, 26);
  }
  const t = tex(c, 1); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}
function wrapText(g, text, x, y, maxW, lh) {
  const words = text.split(' '); let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (g.measureText(test).width > maxW && line) { g.fillText(line, x, y); line = w; y += lh; } else line = test;
  }
  g.fillText(line, x, y);
}
