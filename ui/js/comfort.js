// comodidad: tema automático según la hora, modo auto (manejo), ahorro de batería y letra estilo karaoke
import { $, $$, P, bus, esc, icon, toast, coverUrl } from './core.js';
import { setTheme } from './theme.js';
import { setPerf, perf } from './custom.js';
import * as player from './player.js';
import { engine } from './audio.js';
import { isLiked, toggleLike } from './likes.js';

// ---------- tema automático: uno de día y otro de noche ----------
export const isDay = (h = new Date().getHours()) => h >= (+P.get('dayFrom') || 7) && h < (+P.get('nightFrom') || 20);
function autoTheme() {
  if (!P.get('autoTheme') || P.get('dyn')) return;   // con "colores de la carátula" manda la carátula
  const want = isDay() ? P.get('dayTheme') || 'petal' : P.get('nightTheme') || 'blood';
  if (P.get('theme') !== want) setTheme(want);
}

// ---------- ahorro de batería: con poca batería y sin cargar, modo máximo rendimiento ----------
let saved = null;
async function battery() {
  if (P.get('batterySaver') === false) return;
  let level = 1, charging = true;
  try {
    const nat = window.PetalwaveNative;
    if (nat && nat.battery) { const b = JSON.parse(nat.battery()); level = b.level; charging = b.charging; }
    else if (navigator.getBattery) { const b = await navigator.getBattery(); level = b.level; charging = b.charging; }
    else return;
  } catch { return; }
  if (level <= 0.2 && !charging && !saved && perf() !== 'maximo') {
    saved = perf(); setPerf('maximo');
    toast('batería baja: modo ahorro ⚡', { sub: 'sin efectos ni animaciones hasta que cargues', ms: 3500 });
  } else if (saved && (charging || level >= 0.3)) {
    setPerf(saved); saved = null;
    toast('volvió el modo normal ✦', { ms: 2000 });
  }
}

// ---------- modo auto (manejando): botones gigantes y pantalla simple ----------
let wake = null;
function carHtml() {
  const t = player.current();
  return `<button class="car-x" data-car="exit">${icon('x')} salir</button>
    <div class="car-np"><img src="${t ? coverUrl(t.id) : ''}" onerror="this.style.visibility='hidden'"><div><b>${esc(t ? t.title : 'nada sonando')}</b><span>${esc(t ? t.artist || '' : '')}</span></div></div>
    <div class="car-ctl">
      <button data-car="prev">${icon('prev')}</button>
      <button data-car="toggle" class="big">${icon(engine.paused ? 'play' : 'pause')}</button>
      <button data-car="next">${icon('next')}</button>
    </div>
    <div class="car-ctl small"><button data-car="like" class="${t && isLiked(t.id) ? 'on' : ''}">${icon('heart')}</button><button data-car="recog">${icon('mic')}</button></div>`;
}
function paintCar() { const c = $('#carmode'); if (c && !c.hidden) c.innerHTML = carHtml(); }
export async function toggleCar(force) {
  let c = $('#carmode');
  if (!c) {
    c = document.createElement('div'); c.id = 'carmode'; c.className = 'carmode'; c.hidden = true;
    document.body.appendChild(c);
    c.addEventListener('click', (e) => {
      const b = e.target.closest('[data-car]'); if (!b) return;
      const a = b.dataset.car;
      if (a === 'exit') return toggleCar(false);
      if (a === 'toggle') player.toggle(); if (a === 'next') player.next(); if (a === 'prev') player.prev();
      if (a === 'like') { const t = player.current(); if (t) toggleLike(t.id); }
      if (a === 'recog') bus.emit('recognize');
      setTimeout(paintCar, 250);
    });
  }
  const on = force === undefined ? c.hidden : force;
  c.hidden = !on;
  document.body.classList.toggle('car-on', on);
  if (on) {
    paintCar();
    try { wake = await navigator.wakeLock.request('screen'); } catch {}   // que la pantalla no se apague
    toast('modo auto: tocá "salir" para volver', { ms: 1800 });
  } else { try { wake && wake.release(); } catch {} wake = null; }
}

// ---------- letra estilo karaoke: la línea actual se va "llenando" mientras se canta ----------
// karaoke palabra por palabra: con los tiempos de la letra si los trae; si no, se reparten según el largo de cada
// palabra, en lo que dura cantar la línea (no en todo el hueco hasta la siguiente, que puede ser un solo de guitarra)
function wordTimes(a, end, n) {
  if (a.wt && a.wt.length === n) return a.wt;
  const ws = a.text.split(' ');
  const len = ws.map((w) => Math.max(1, w.replace(/[^\p{L}\p{N}]/gu, '').length) + 1.5);
  const total = len.reduce((x, y) => x + y, 0);
  const span = Math.max(0.6, Math.min(end - a.t - 0.15, total * 0.085 + 0.3));
  let acc = 0;
  return len.map((l) => { const t = a.t + (span * acc) / total; acc += l; return t; }).concat([a.t + span]);
}
export function karaoke(time, lines, box) {
  if (P.get('karaoke') === false || !lines || !box) return;
  const on = box.querySelector('.ln.on'); if (!on) return;
  const i = +on.dataset.l, a = lines[i], b = lines[i + 1];
  const end = b ? b.t : a.t + 5;
  const ws = on.querySelectorAll('.lw'); if (!ws.length) return;
  if (!a._wt || a._wt.n !== ws.length) { a._wt = wordTimes(a, end, ws.length); a._wt.n = ws.length; if (a._wt.length === ws.length) a._wt.push(end); }
  const wt = a._wt;
  let k = -1;
  for (let j = 0; j < ws.length; j++) if (wt[j] <= time) k = j;
  if (on.dataset.k !== String(k)) {
    on.dataset.k = String(k);
    ws.forEach((w, j) => { w.classList.toggle('sung', j < k); w.classList.toggle('now', j === k); });
  }
  if (k >= 0) { const p = Math.max(0, Math.min(1, (time - wt[k]) / Math.max(0.12, wt[k + 1] - wt[k]))); ws[k].style.setProperty('--wp', p.toFixed(3)); }
}

export function initComfort() {
  autoTheme(); setInterval(autoTheme, 60e3);
  battery(); setInterval(battery, 120e3);
  bus.on('prefs', (k) => { if (['autoTheme', 'dayTheme', 'nightTheme', 'dayFrom', 'nightFrom'].includes(k)) autoTheme(); if (k === 'karaoke') document.body.classList.toggle('karaoke', P.get('karaoke') !== false); });
  document.body.classList.toggle('karaoke', P.get('karaoke') !== false);
  bus.on('np', paintCar); bus.on('eng:state', paintCar); bus.on('like', paintCar);
  document.addEventListener('visibilitychange', async () => { if (!document.hidden && document.body.classList.contains('car-on')) { try { wake = await navigator.wakeLock.request('screen'); } catch {} } });
}
