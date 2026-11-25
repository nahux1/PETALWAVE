// efectos con la música: el fondo late con los golpes (bombo / graves) de lo que suena.
// sacudida, pulso (zoom), destello y viñeta; opcional, que tiemblen un poco las ventanas.
// Liviano: detecta los golpes con el analizador que ya usa el visualizador y solo mueve capas del fondo
// (translate/scale/opacity, que la placa de video resuelve sola). Se apaga en pausa, minimizado, en modo mini,
// en máximo rendimiento y con "sin animaciones" de Petalwave. Tiene su propio interruptor en ajustes y en la galería.
import { $, bus } from './core.js';
import { engine } from './audio.js';
import { E as C, perf } from './custom.js';

let raf = 0, last = 0, avg = 0, level = 0, kick = 0, lastBeat = 0, dir = [0, 0], freq = null, active = false;
const recent = [];   // energía de los últimos ~150 ms (para ver los saltos)

function els() { return { wp: $('#wp'), fx: $('#bgfx'), shell: $('#shell'), flash: $('#mfxFlash'), vig: $('#mfxVig') }; }

function wanted() {
  const c = C();
  if (!c.mfxOn || perf() === 'maximo' || document.hidden) return false;
  const b = document.body.classList;
  if (b.contains('mini') || b.contains('noanim')) return false;
  if (!(c.mfxShake || c.mfxZoom || c.mfxFlash || c.mfxVig)) return false;
  return !engine.paused && !!engine.analyser;
}

function reset() {
  const e = els();
  for (const el of [e.wp, e.fx, e.shell]) if (el) { el.style.translate = ''; el.style.scale = ''; }
  if (e.flash) e.flash.style.opacity = '0';
  if (e.vig) e.vig.style.opacity = '0';
  kick = 0; level = 0;
}

function frame(now) {
  raf = 0;
  if (!wanted()) { if (active) { active = false; reset(); } return; }
  active = true;
  const dt = Math.min(0.1, (now - (last || now)) / 1000); last = now;
  const a = engine.analyser;
  if (!freq || freq.length !== a.frequencyBinCount) freq = new Uint8Array(a.frequencyBinCount);
  a.getByteFrequencyData(freq);
  // energía de los graves (bombo, bajo): las primeras bandas del espectro
  const n = Math.max(3, Math.round(freq.length * 0.012));
  let e = 0; for (let i = 1; i <= n; i++) e += freq[i]; e /= n;
  // el analizador da decibeles (0-255): un golpe es un salto rápido de los graves, no un valor alto
  avg = avg ? avg + (e - avg) * Math.min(1, dt * 2.2) : e;          // promedio de ~0,5 s
  while (recent.length && now - recent[0][0] > 150) recent.shift();
  const low = recent.length ? Math.min(...recent.map((x) => x[1])) : e;
  recent.push([now, e]);
  level += (Math.max(0, Math.min(1, (e - avg + 6) / 30)) - level) * Math.min(1, dt * 12);
  const c = C(), amt = (c.mfxAmt ?? 60) / 100;
  const jump = e - low;
  if (jump > 13 && e > 90 && e >= avg - 4 && now - lastBeat > 200) {
    lastBeat = now;
    kick = Math.min(1, 0.4 + (jump - 13) / 22);
    const ang = Math.random() * Math.PI * 2; dir = [Math.cos(ang), Math.sin(ang)];
  }
  kick = Math.max(0, kick - dt * 4.2);                               // dura ~ un cuarto de segundo
  const motion = true;
  const ex = els();
  // sacudida + pulso sobre el fondo (wallpaper y efecto animado)
  let tx = 0, ty = 0, sc = 1;
  if (motion && c.mfxShake && kick > 0.02) {
    const k = kick * kick * 14 * amt, jit = (Math.random() - 0.5) * kick * 5 * amt;
    tx = dir[0] * k + jit; ty = dir[1] * k + (Math.random() - 0.5) * kick * 5 * amt;
  }
  if (motion && c.mfxZoom) sc = 1 + (level * 0.018 + kick * 0.035) * amt;
  const tr = tx || ty ? `${tx.toFixed(1)}px ${ty.toFixed(1)}px` : '';
  const scs = sc !== 1 ? sc.toFixed(4) : '';
  for (const el of [ex.wp, ex.fx]) if (el) { el.style.translate = tr; el.style.scale = scs; }
  // las ventanas tiemblan menos (para poder leer)
  if (ex.shell) ex.shell.style.translate = motion && c.mfxShake && c.mfxWin && (tx || ty) ? `${(tx * 0.3).toFixed(1)}px ${(ty * 0.3).toFixed(1)}px` : '';
  if (ex.flash) ex.flash.style.opacity = c.mfxFlash ? (kick * 0.32 * amt).toFixed(3) : '0';
  if (ex.vig) ex.vig.style.opacity = c.mfxVig ? (0.25 + level * 0.35 + kick * 0.4 * amt).toFixed(3) : '0';
  raf = requestAnimationFrame(frame);
}

export function syncMusicFx() {
  if (wanted()) { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }
  else { if (raf) { cancelAnimationFrame(raf); raf = 0; } if (active) { active = false; reset(); } }
}

export function initMusicFx() {
  for (const ev of ['eng:state', 'custom', 'perf', 'prefs']) bus.on(ev, syncMusicFx);
  document.addEventListener('visibilitychange', syncMusicFx);
  new MutationObserver(syncMusicFx).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  syncMusicFx();
}
