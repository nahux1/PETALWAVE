// modo DJ: Petalwave mide el tempo (BPM), dónde cae cada golpe y la energía de cada canción, y con eso:
// - cruza las canciones con un fundido largo, entrando justo en el golpe y con la que entra al tempo de la que sale
//   (después vuelve sola a su velocidad, sin cambiar el tono); durante el cruce los graves no se pisan
// - "ordenar": acomoda lo que queda de la cola para que el ritmo y la energía cambien de a poco
// La medida se hace en tu equipo (se decodifica la canción a baja calidad) y se guarda: cada canción se mide una sola vez.
import { $$, bus, P, toast, local, mediaUrl } from './core.js';
import { T } from './data.js';
import * as player from './player.js';
import { engine } from './audio.js';
import { isOffline, playable } from './offline.js';
import { netType } from './smartdl.js';

const STORE = 'pw-dj';
const info = local.get(STORE, {}) || {};
let dirty = 0;
const save = () => { const k = Object.keys(info); if (k.length > 6000) for (const x of k.slice(0, k.length - 6000)) delete info[x]; local.set(STORE, info); };
export const djInfo = (id) => (info[id] && info[id].v === 2 ? info[id] : null);
export const djOn = () => player.djOn();
const canMeasure = (t) => t && !t.video && !t.isVideo && !t.cast && (!t.remote || !isOffline() || playable(t));

// ---------- medir una canción ----------
let chain = Promise.resolve();
const busy = new Map();
export function analyze(t) {
  if (!canMeasure(t)) return Promise.resolve(null);
  if (djInfo(t.id)) return Promise.resolve(info[t.id]);
  if (busy.has(t.id)) return busy.get(t.id);
  const job = chain.then(() => measure(t)).catch(() => null);   // de a una, para no trabar el equipo
  chain = job;
  busy.set(t.id, job);
  job.finally(() => busy.delete(t.id));
  return job;
}
async function measure(t) {
  if (djInfo(t.id)) return info[t.id];
  const r = await fetch(mediaUrl(t.id));
  if (!r.ok) return null;
  if (+r.headers.get('content-length') > 120e6) { r.body && r.body.cancel(); return null; }
  const buf = await r.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 11025);   // se decodifica a 11 kHz: alcanza para el ritmo y usa poca memoria
  const ab = await new Promise((ok, no) => { const p = ctx.decodeAudioData(buf, ok, no); if (p && p.catch) p.catch(no); });
  const res = compute(ab);
  if (!res) return null;
  info[t.id] = res;
  if (++dirty % 2 === 0) save(); else setTimeout(save, 3000);
  bus.emit('dj:info', t.id);
  return res;
}

// tempo por autocorrelación de los "golpes" (subidas de energía, más peso a los graves)
function compute(ab) {
  const sr = ab.sampleRate, n = ab.length;
  if (n < sr * 20) return null;
  const a = ab.getChannelData(0), b = ab.numberOfChannels > 1 ? ab.getChannelData(1) : null;
  const H = 128, F = Math.floor(n / H), fr = sr / H;
  const full = new Float32Array(F), low = new Float32Array(F);
  const al = 1 - Math.exp(-2 * Math.PI * 150 / sr);
  let lp = 0, sum = 0, lowSum = 0;
  for (let f = 0, i = 0; f < F; f++) {
    let e = 0, el = 0;
    for (const end = i + H; i < end; i++) { const x = b ? (a[i] + b[i]) * 0.5 : a[i]; lp += al * (x - lp); e += x * x; el += lp * lp; }
    full[f] = Math.sqrt(e / H); low[f] = Math.sqrt(el / H); sum += e; lowSum += el;
  }
  const on = new Float32Array(F);
  for (let f = 1; f < F; f++) on[f] = Math.max(0, low[f] - low[f - 1]) * 0.65 + Math.max(0, full[f] - full[f - 1]) * 0.35;
  // restar el promedio de alrededor (medio segundo): quedan los golpes
  const W = Math.round(fr * 0.25), o = new Float32Array(F);
  let acc = 0;
  for (let f = 0; f < F; f++) {
    acc += on[f]; if (f > 2 * W) acc -= on[f - 2 * W - 1];
    const c = f - W; if (c >= 0) o[c] = Math.max(0, on[c] - acc / (2 * W + 1));
  }
  const s0 = Math.floor(F * 0.08), s1 = Math.min(F - 1, s0 + Math.floor(fr * 150));
  const maxLag = Math.ceil(fr * 60 / 50) + 2;
  const ac = new Float32Array(maxLag + 1);
  for (let l = 10; l <= maxLag; l++) { let s = 0; for (let f = s0; f + l < s1; f++) s += o[f] * o[f + l]; ac[l] = s; }
  const at = (x) => { const i = Math.floor(x); if (i < 1 || i + 1 > maxLag) return 0; const k = x - i; return ac[i] * (1 - k) + ac[i + 1] * k; };
  let best = 0, bestS = -1, tot = 0, cnt = 0;   // eslint-disable-line prefer-const
  for (let bpm = 70; bpm <= 185; bpm += 0.25) {
    const lag = fr * 60 / bpm;
    const s = (at(lag) + 0.5 * at(lag * 2) + 0.25 * at(lag / 2) + 0.25 * at(lag * 1.5)) * Math.exp(-0.5 * (Math.log2(bpm / 122) / 0.75) ** 2);
    tot += s; cnt++;
    if (s > bestS) { bestS = s; best = bpm; }
  }
  if (!(bestS > 0)) return null;
  // afinar el tempo comparando golpes que están a 16 pulsos (un error chico se acumula y corre la fase)
  const corr = (l) => { let x = 0; for (let f = s0; f + l < s1; f++) x += o[f] * o[f + l]; return x; };
  const M = 16, c0 = Math.round((fr * 60 / best) * M);
  if (s1 - s0 > c0 * 2) {
    const v = new Map(); let bl = c0, bv = -1;
    for (let l = c0 - 6; l <= c0 + 6; l++) { const x = corr(l); v.set(l, x); if (x > bv) { bv = x; bl = l; } }
    const y1 = v.has(bl - 1) ? v.get(bl - 1) : corr(bl - 1), y3 = v.has(bl + 1) ? v.get(bl + 1) : corr(bl + 1), den = y1 - 2 * bv + y3;
    const off = den ? Math.max(-0.5, Math.min(0.5, (0.5 * (y1 - y3)) / den)) : 0;
    const fine = (fr * 60 * M) / (bl + off);
    if (Math.abs(fine - best) < 2) best = fine;
  }
  // ¿dónde cae el golpe? (fase dentro del compás de un pulso)
  const per = fr * 60 / best;
  let ph = 0, phS = -1;
  for (let p = 0; p < per; p += 0.5) {
    let s = 0; const k0 = Math.ceil((s0 - p) / per);
    for (let k = k0; ; k++) { const f = Math.round(p + k * per); if (f >= s1) break; s += o[f] + 0.5 * (o[f - 1] || 0) + 0.5 * (o[f + 1] || 0); }
    if (s > phS) { phS = s; ph = p; }
  }
  // primer sonido (para entrar sin silencio) y energía
  const mean = sum / n, thr = Math.sqrt(mean) * 0.08;
  let lead = 0; while (lead < F && full[lead] < thr) lead++;
  const db = 10 * Math.log10(mean + 1e-12);
  // energía: qué tan fuerte, cuántos golpes y qué tan rápida (0 = tranquila, 1 = a full)
  let os = 0, fs = 0; for (let f = s0; f < s1; f++) { os += o[f]; fs += full[f]; }
  const punch = os / (fs + 1e-9);
  const energy = 0.35 * clamp01((db + 26) / 16) + 0.4 * clamp01((punch - 0.01) / 0.05) + 0.25 * clamp01((best - 75) / 100);
  return { b: Math.round(best * 100) / 100, p: Math.round((ph / fr) * 1000) / 1000, l: Math.round((lead / fr) * 100) / 100, e: Math.round(energy * 100) / 100, k: Math.round(punch * 1e4) / 1e4, c: Math.round((bestS / (tot / cnt)) * 100) / 100, v: 2 };
}
const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const _compute = compute;   // para las pruebas

// ---------- pasar a la siguiente como un DJ ----------
function sameTempo(a, b) { let nb = b; for (const k of [2, 0.5]) if (Math.abs(Math.log2((b * k) / a)) < Math.abs(Math.log2(nb / a))) nb = b * k; return nb; }
function transition(id, fade) {
  if (!djOn()) return false;
  const cur = player.current(), S = player.S;
  if (!cur || cur.id !== id || cur.cast) return false;
  const nx = T(S.queue[S.qi + 1]);
  if (!nx || nx.cast || nx.video || nx.isVideo) return false;
  const a = djInfo(cur.id), b = djInfo(nx.id);
  let rate = 1, startAt = 0, wait = 0, lock = false;
  if (a && b) {
    const per = 60 / b.b;
    startAt = b.l > b.p ? b.p + Math.ceil((b.l - b.p) / per) * per : b.p;   // en un golpe, después del silencio del principio
    if (startAt > 12) startAt = 0;
    if (P.get('djTempo') !== false && a.c >= 1.12 && b.c >= 1.12) {
      const r = a.b / sameTempo(a.b, b.b);
      if (Math.abs(r - 1) <= 0.08) { rate = Math.round(r * 10000) / 10000; lock = true; }
      // arrancar en el próximo golpe de la que suena (lo fino se corrige cuando ya suenan las dos)
      const pa = 60 / a.b / (engine.rate || 1), since = (((engine.time - a.p) % (60 / a.b)) + 60 / a.b) % (60 / a.b) / (engine.rate || 1);
      wait = pa - since; while (wait < 0.02) wait += pa;
    }
  }
  const go = () => {
    const c = player.current(); if (!c || c.id !== id) return;
    const old = engine.active;
    player.next({ auto: true, fade, dj: { rate, startAt, dj: true } });
    if (lock && old) align(old, a, b, nx.id);
  };
  if (wait > 0.02 && wait < 3) setTimeout(go, wait * 1000); else go();
  return true;
}
// cuando ya suenan las dos: medir cuánto se corren los golpes y mover la que entra (todavía suena bajito)
function align(old, a, b, id) {
  const t0 = performance.now();
  const iv = setInterval(() => {
    const nw = engine.active, c = player.current();
    if (!c || c.id !== id || !nw || nw === old || performance.now() - t0 > 4000) return clearInterval(iv);
    if (nw.el.paused || nw.el.currentTime < 0.25 || old.el.paused) return;
    clearInterval(iv);
    const r = nw.el.playbackRate || 1, pa = 60 / a.b, pb = 60 / b.b;
    const nextA = pa - ((((old.el.currentTime - a.p) % pa) + pa) % pa) / (old.el.playbackRate || 1);
    const nextB = (pb - ((((nw.el.currentTime - b.p) % pb) + pb) % pb)) / r;
    const beat = pa / (old.el.playbackRate || 1);
    let d = nextB - nextA;                                  // >0: el golpe de la que entra llega tarde
    d = ((d % beat) + beat * 1.5) % beat - beat / 2;        // al golpe más cercano
    if (Math.abs(d) > 0.012) { try { nw.el.currentTime = nw.el.currentTime + d * r; } catch {} }
  }, 60);
}

// ---------- ordenar la cola ----------
export async function djOrder() {
  const S = player.S;
  const cur = player.current();
  const rest = S.queue.slice(S.qi + 1);
  if (rest.length < 3) return toast('hacen falta más canciones en la cola para ordenarlas', { ms: 1800 });
  const datos = netType() === 'datos';
  const todo = rest.map(T).filter((t) => canMeasure(t) && !djInfo(t.id)).filter((t, i, arr) => !t.remote || (!datos && arr.slice(0, i).filter((x) => x.remote).length < 15)).slice(0, 40);
  if (todo.length) {
    toast(`🎧 midiendo el ritmo de ${todo.length} canciones…`, { sub: 'se hace una sola vez por canción', ms: 2500 });
    let k = 0;
    for (const t of todo) { await analyze(t); if (++k % 5 === 0 && k < todo.length) toast(`🎧 midiendo… ${k}/${todo.length}`, { ms: 1200 }); }
  }
  const S2 = player.S;
  if (S2.queue[S2.qi] !== (cur && cur.id)) return;   // cambió la canción mientras medía: no tocar
  const rest2 = S2.queue.slice(S2.qi + 1);
  const known = rest2.filter((id) => djInfo(id)), unknown = rest2.filter((id) => !djInfo(id));
  let at = (cur && djInfo(cur.id)) || (known.length ? djInfo(known[0]) : null);
  if (!at || known.length < 2) return toast('no pude medir el ritmo de estas canciones', { kind: 'warn' });
  const cost = (x, y, tx, ty) => Math.abs(Math.log2(sameTempo(x.b, y.b) / x.b)) * 14 + Math.abs(x.e - y.e) * 3 + (tx && ty && tx._a === ty._a ? 0.6 : 0);
  const out = [], pool = known.slice();
  let prevT = cur;
  while (pool.length) {
    let bi = 0, bc = Infinity;
    for (let i = 0; i < pool.length; i++) { const c = cost(at, info[pool[i]], prevT, T(pool[i])); if (c < bc) { bc = c; bi = i; } }
    const id = pool.splice(bi, 1)[0]; out.push(id); at = info[id]; prevT = T(id);
  }
  player.restoreQueue([...S2.queue.slice(0, S2.qi + 1), ...out, ...unknown], S2.qi);
  toast(`🎧 cola ordenada: ${out.length} canciones`, { sub: unknown.length ? `${unknown.length} sin medir quedaron al final` : 'el ritmo y la energía cambian de a poco', ms: 2600 });
}

export function toggleDj(on = !P.get('dj')) {
  if (on && engine.native) return toast('el modo DJ necesita el motor de audio normal', { sub: 'ajustes → reproducción → apagá "motor nativo de Android"', kind: 'warn', ms: 3500 });
  P.set('dj', !!on);
  $$('[data-act="dj"]').forEach((b) => b.classList.toggle('on', !!on));
  toast(on ? '🎧 modo DJ' : 'modo DJ apagado', { sub: on ? `cruces de ${+P.get('djFade') || 8} s a tempo · ⇅ en la cola ordena por ritmo` : '', ms: 2200 });
  if (on) prepare();
  bus.emit('queue');
}
// medir la que suena y las dos siguientes (así el cruce ya tiene los datos)
function prepare() {
  if (!djOn()) return;
  const S = player.S;
  for (let k = 0; k <= 2; k++) { const t = T(S.queue[S.qi + k]); if (t && !(t.remote && netType() === 'datos' && k > 1)) analyze(t); }
}

export function initDj() {
  player.setTransition(transition);
  bus.on('np', () => setTimeout(prepare, 1500));
  bus.on('queue', () => { if (djOn()) setTimeout(prepare, 2500); });
  bus.on('dj:info', () => bus.emit('queue:paint'));
}
