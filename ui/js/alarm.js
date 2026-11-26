// alarma con música: a la hora que elijas empieza a sonar tu música, con el volumen subiendo de a poco.
// PC: Petalwave tiene que estar abierto (aunque sea en la bandeja) y la PC despierta.
// Android: además se programa una alarma del sistema, así suena aunque el celular esté bloqueado o Petalwave cerrado.
import { P, bus, toast, modal, esc, local } from './core.js';
import { D } from './data.js';
import { engine } from './audio.js';
import * as player from './player.js';

const nat = window.PetalwaveNative;
const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const alarmCfg = () => ({ on: false, time: '07:30', days: [1, 2, 3, 4, 5], source: 'liked', ramp: 3, snooze: 10, ...(P.get('alarm') || {}) });

// la próxima vez que va a sonar (Date) o null
export function nextAlarm(cfg = alarmCfg(), from = new Date()) {
  if (!cfg.on || !/^\d{1,2}:\d{2}$/.test(cfg.time)) return null;
  const [h, m] = cfg.time.split(':').map(Number);
  const snoozed = +local.get('pw-alarm-snooze', 0) || 0;
  if (snoozed > from.getTime()) return new Date(snoozed);
  for (let k = 0; k < 8; k++) {
    const d = new Date(from); d.setDate(d.getDate() + k); d.setHours(h, m, 0, 0);
    if (d <= from) continue;
    if (!cfg.days.length || cfg.days.includes(d.getDay())) return d;
  }
  return null;
}
export function describeAlarm(cfg = alarmCfg()) {
  const n = nextAlarm(cfg);
  if (!n) return 'apagada';
  const min = Math.round((n - Date.now()) / 60000);
  const left = min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
  return `${DAYS[n.getDay()]} ${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')} · en ${left}`;
}

function pickIds(src) {
  const liked = (D.playlists.find((p) => p.id === 'liked') || { tracks: [] }).tracks;
  let ids = [];
  if (src === 'liked') ids = liked;
  else if (src && src.startsWith('pl:')) ids = (D.playlists.find((p) => p.id === src.slice(3)) || { tracks: [] }).tracks;
  else if (src === 'last') ids = player.S.queue.slice();
  if (!ids.length) ids = liked.length ? liked : D.tracks.filter((t) => !t.video).map((t) => t.id);
  return ids.filter(Boolean);
}

let ramping = 0, ringing = false;
export async function ring() {
  if (ringing) return;
  ringing = true;
  local.set('pw-alarm-snooze', 0);
  const cfg = alarmCfg();
  const ids = pickIds(cfg.source);
  if (!ids.length) { ringing = false; return toast('⏰ alarma: no hay canciones para sonar', { kind: 'warn' }); }
  // el volumen arranca bajito y sube hasta el tuyo en "ramp" minutos
  const v = P.get('vol'), target = v.muted ? 0.6 : v.master || 0.6;
  engine.setVolume(0.02, false);
  player.playList(ids, Math.floor(Math.random() * ids.length), { shuffle: true });
  const t0 = Date.now(), dur = Math.max(0.2, +cfg.ramp || 3) * 60000;
  clearInterval(ramping);
  ramping = setInterval(() => {
    const k = Math.min(1, (Date.now() - t0) / dur);
    engine.setVolume(0.02 + (target - 0.02) * k * k, false);
    if (k >= 1) { clearInterval(ramping); ramping = 0; player.applySound(); }
  }, 1000);
  schedule();
  const now = new Date();
  const r = await modal({
    title: '⏰ ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'),
    html: `<p style="font-size:18px;margin:4px 0 10px">buenos días ❀</p><p class="m">${esc(player.current() ? player.current().title : '')}</p>`,
    actions: [{ label: `posponer ${cfg.snooze} min`, value: 'snooze' }, { label: 'listo, ya me levanté', value: 'ok', primary: true }],
  });
  ringing = false;
  clearInterval(ramping); ramping = 0;
  if (r === 'snooze') {
    await engine.pause();
    player.applySound();
    local.set('pw-alarm-snooze', Date.now() + (+cfg.snooze || 10) * 60000);
    toast(`vuelve a sonar en ${cfg.snooze} min ⏰`, { ms: 2000 });
    schedule();
  } else player.applySound();
}

// Android: alarma del sistema (despierta al celular aunque Petalwave esté cerrado)
function schedule() {
  const n = nextAlarm();
  try { if (nat && nat.alarm) nat.alarm(n ? String(n.getTime()) : '0'); } catch {}
  bus.emit('alarm', n);
}
export function setAlarm(cfg) {
  P.set('alarm', { ...alarmCfg(), ...cfg });
  local.set('pw-alarm-snooze', 0);
  schedule();
}

let firedFor = 0;
export function initAlarm() {
  schedule();
  // revisar cada 10 s (en la PC alcanza con que Petalwave esté abierto)
  setInterval(() => {
    const n = nextAlarm(alarmCfg(), new Date(Date.now() - 60000));   // la de hace menos de un minuto también cuenta
    if (!n) return;
    const t = n.getTime();
    if (Date.now() >= t && Date.now() - t < 60000 && firedFor !== t) { firedFor = t; ring(); }
  }, 10000);
  document.addEventListener('pw-cmd', (e) => { if (e.detail === 'alarm') ring(); });
}
export const DAY_NAMES = DAYS;
