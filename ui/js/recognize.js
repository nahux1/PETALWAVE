// ❀ ¿qué suena? — reconocer una canción con el micrófono (como hacen las apps de reconocimiento de música)
// Graba 8 segundos, los manda al servidor interno, que los reenvía a AudD con tu clave. Solo se graba cuando tocás.
import { $, api, bus, esc, icon, toast, local, P } from './core.js';
import { D, T, remoteTrack } from './data.js';
import { playList, current } from './player.js';
import { engine } from './audio.js';
import { toggleLike } from './likes.js';

const SECS = 8;
const HIST = 'pw-recog';
let rec = null, stream = null, raf = 0, resumeAfter = false;

function overlay() {
  let o = $('#recog');
  if (o) return o;
  o = document.createElement('div');
  o.id = 'recog'; o.className = 'recog'; o.hidden = true;
  o.innerHTML = `<div class="rc-box"><button class="ico rc-x" title="cerrar (esc)">${icon('x')}</button><div class="rc-main" id="rcMain"></div><div class="rc-hist" id="rcHist"></div></div>`;
  document.body.appendChild(o);
  o.querySelector('.rc-x').onclick = close;
  o.addEventListener('click', (e) => { if (e.target === o) close(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !o.hidden) { e.stopPropagation(); close(); } }, true);
  return o;
}

function stopMic() {
  cancelAnimationFrame(raf);
  try { if (rec && rec.state !== 'inactive') rec.stop(); } catch {}
  if (stream) for (const t of stream.getTracks()) t.stop();
  stream = null; rec = null;
}
export function close() {
  stopMic();
  const o = $('#recog'); if (o) o.hidden = true;
  if (resumeAfter) { resumeAfter = false; engine.play(); }
}

function paintHist() {
  const h = local.get(HIST, []) || [];
  $('#rcHist').innerHTML = h.length ? `<div class="rc-hh">reconocidas antes</div>` + h.slice(0, 8).map((x, i) => `<div class="rc-hi" data-h="${i}">${x.art ? `<img src="${esc(x.art)}" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">` : '<i>♪</i>'}<div><b>${esc(x.title)}</b><span>${esc(x.artist)} · ${new Date(x.at).toLocaleDateString()}</span></div></div>`).join('') : '';
  $('#rcHist').querySelectorAll('[data-h]').forEach((el) => (el.onclick = () => showResult(h[+el.dataset.h], true)));
}

// la canción reconocida en YouTube Music (para escucharla, bajarla o darle ♥)
async function findOnYtm(r) {
  if (r.videoId) return T('yt_' + r.videoId) || null;
  const own = D.tracks.find((t) => (t.title + ' ' + t.artist).toLowerCase().includes(r.title.toLowerCase()) && (t.artist || '').toLowerCase().includes(r.artist.split(/[,&]/)[0].trim().toLowerCase()));
  if (own) return own;
  const j = await api.get('/api/ytm/search?filter=songs&q=' + encodeURIComponent(r.artist + ' ' + r.title));
  const it = (j.items || []).find((x) => x.videoId);
  if (!it) return null;
  r.videoId = it.videoId;
  saveHist(r);
  return remoteTrack(it);
}
function saveHist(r) {
  const h = (local.get(HIST, []) || []).filter((x) => !(x.title === r.title && x.artist === r.artist));
  local.set(HIST, [r, ...h].slice(0, 50));
}

function showResult(r, fromHist) {
  const m = $('#rcMain');
  m.innerHTML = `<div class="rc-found">
      <div class="rc-art">${r.art ? `<img src="${esc(r.art)}" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<span>♪</span></div>
      <div class="rc-k">${fromHist ? 'reconocida el ' + new Date(r.at).toLocaleString() : '¡la encontré! ❀'}</div>
      <h2>${esc(r.title)}</h2><div class="rc-a">${esc(r.artist)}</div>
      <div class="m">${esc([r.album, r.year].filter(Boolean).join(' · '))}</div>
      <div class="rc-acts">
        <button class="go" data-a="play">${icon('play')} escuchar</button>
        <button class="cb" data-a="like">${icon('heart')} me gusta</button>
        <button class="cb" data-a="dl">${icon('dl')} descargar</button>
        ${r.link ? `<button class="cb" data-a="link">abrir link</button>` : ''}
        <button class="cb" data-a="again">${icon('radio')} otra</button>
      </div></div>`;
  m.querySelectorAll('[data-a]').forEach((b) => (b.onclick = async () => {
    const a = b.dataset.a;
    if (a === 'again') return listen();
    if (a === 'link') return window.open(r.link, '_blank');
    b.disabled = true;
    try {
      const t = await findOnYtm(r);
      if (!t) return toast('No la encontré en YouTube Music para ' + (a === 'dl' ? 'descargarla' : 'escucharla'), { kind: 'warn' });
      if (a === 'play') { resumeAfter = false; playList([t.id], 0); close(); }
      if (a === 'like') await toggleLike(t.id, true);
      if (a === 'dl') {
        if (!t.remote) return toast('Ya la tenés en tu biblioteca ✓');
        const d = P.get('dl') || {}; const format = d.format === 'mp4' || !d.format ? 'mp3' : d.format;
        await api.post('/api/downloads', { urls: ['https://music.youtube.com/watch?v=' + t.ytId], format, quality: format === 'mp3' ? d.quality || '320' : 'best', cookies: d.cookies || '' });
        toast('descargando ⇣', { sub: r.title });
      }
    } catch (e) { toast(e.message, { kind: 'err' }); } finally { b.disabled = false; }
  }));
}

function showToken(msg) {
  $('#rcMain').innerHTML = `<div class="rc-setup"><h3>Para reconocer canciones falta tu clave de AudD</h3>
    <div class="m">${esc(msg || '')}</div>
    <ol class="m"><li>Entrá a <a href="#" data-audd>dashboard.audd.io</a> y creá una cuenta gratis (no pide tarjeta).</li><li>Copiá tu <b>API token</b> y pegalo acá.</li></ol>
    <div class="rc-tok"><input id="rcTok" placeholder="pegá tu clave de AudD" autocomplete="off" spellcheck="false"><button class="go" id="rcTokOk">guardar</button></div>
    <div class="m">Las primeras 300 canciones son gratis. Solo se manda un fragmento de ${SECS} segundos cuando tocás "¿qué suena?".</div></div>`;
  $('#rcMain').querySelector('[data-audd]').onclick = (e) => { e.preventDefault(); window.open('https://dashboard.audd.io/', '_blank'); };
  $('#rcTokOk').onclick = async () => {
    try { await api.post('/api/recognize/config', { token: $('#rcTok').value }); toast('clave guardada ✓'); listen(); }
    catch (e) { toast(e.message, { kind: 'err' }); }
  };
}

function showMsg(title, sub, retry = true) {
  $('#rcMain').innerHTML = `<div class="rc-msg"><div class="rc-petal sad">❀</div><h3>${esc(title)}</h3><div class="m">${esc(sub || '')}</div>${retry ? `<div class="rc-acts"><button class="go" id="rcAgain">${icon('radio')} probar de nuevo</button></div>` : ''}</div>`;
  const b = $('#rcAgain'); if (b) b.onclick = listen;
}

export async function listen() {
  const o = overlay(); o.hidden = false; paintHist();
  stopMic();
  // el medidor de sonido se crea en el mismo toque (si se crea después del permiso del micrófono, el navegador puede no dejarlo arrancar)
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  ctx.resume().catch(() => {});
  // sin clave de AudD no tiene sentido grabar: se pide primero
  try { const st = await api.get('/api/recognize/config'); if (!st.configured) { ctx.close(); return showToken(''); } } catch {}
  // si Petalwave está sonando, se pausa (si no, reconoce su propia música) y vuelve al cerrar
  if (!engine.paused && current()) { resumeAfter = true; await engine.pause(); }
  const m = $('#rcMain');
  m.innerHTML = `<div class="rc-listen"><div class="rc-petal" id="rcPetal">❀</div><h3>escuchando…</h3><div class="m">acercá el celular o la PC a la música</div><div class="rc-bar"><i id="rcBar"></i></div></div>`;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true }, video: false });
  } catch (e) {
    ctx.close();
    return showMsg('No pude usar el micrófono', e.name === 'NotAllowedError' ? 'Dale permiso a Petalwave para usar el micrófono y probá de nuevo.' : e.message);
  }
  // nivel del micrófono para animar la flor (y avisar si no entra sonido)
  await ctx.resume().catch(() => {});
  const an = ctx.createAnalyser(); an.fftSize = 512; ctx.createMediaStreamSource(stream).connect(an);
  const buf = new Float32Array(an.fftSize); let peak = 0;
  const t0 = performance.now();
  const tick = () => {
    an.getFloatTimeDomainData(buf); let e = 0; for (const v of buf) e += v * v; const lvl = Math.sqrt(e / buf.length); peak = Math.max(peak, lvl);
    const pe = $('#rcPetal'); if (pe) pe.style.transform = `scale(${1 + Math.min(0.6, lvl * 6)}) rotate(${(performance.now() - t0) / 30}deg)`;
    const bar = $('#rcBar'); if (bar) bar.style.width = Math.min(100, (performance.now() - t0) / (SECS * 10)) + '%';
    raf = requestAnimationFrame(tick);
  };
  tick();
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
  const chunks = [];
  rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 128000 } : undefined);
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const done = new Promise((ok) => (rec.onstop = ok));
  rec.start();
  await new Promise((ok) => setTimeout(ok, SECS * 1000));
  if (!rec) { ctx.close(); return; }   // se cerró mientras escuchaba
  const metered = ctx.state === 'running';   // si el medidor no pudo arrancar, no se puede saber si hubo silencio: se manda igual
  stopMic(); await done; ctx.close();
  if (metered && peak < 0.003) return showMsg('No entró sonido por el micrófono', 'Revisá que el micrófono no esté silenciado o tapado.');
  const blob = new Blob(chunks, { type: (type || 'audio/webm').split(';')[0] });
  m.innerHTML = `<div class="rc-listen"><div class="rc-petal spin">❀</div><h3>buscando la canción…</h3></div>`;
  try {
    const r = await api.raw('/api/recognize', blob, { 'Content-Type': blob.type });
    if (!r.found) return showMsg('No la reconocí', 'Probá de nuevo más cerca del parlante, o en una parte con la voz o el estribillo.');
    r.at = Date.now();
    saveHist(r); paintHist();
    showResult(r);
    bus.emit('recognized', r);
  } catch (e) {
    if (/clave de AudD/.test(e.message) || e.needToken) return showToken(e.message);
    showMsg('No se pudo reconocer', e.message);
  }
}

// ajustes → cuentas
export async function auddSettings(el) {
  if (!el) return;
  let st = { configured: false };
  try { st = await api.get('/api/recognize/config'); } catch {}
  el.innerHTML = `<div class="cfrow"><span>reconocer canciones (AudD)<span class="m">${st.configured ? 'clave guardada ' + esc(st.hint) : 'pegá tu clave gratis de dashboard.audd.io (300 canciones gratis)'}</span></span>
    <span><input id="cAuddTok" placeholder="${st.configured ? 'cambiar clave' : 'clave de AudD'}" autocomplete="off" spellcheck="false" style="width:150px"> <button class="cb sm" id="cAuddOk">guardar</button>${st.configured ? ' <button class="cb sm danger" id="cAuddDel">quitar</button>' : ''}</span></div>`;
  el.querySelector('#cAuddOk').onclick = async () => { try { await api.post('/api/recognize/config', { token: el.querySelector('#cAuddTok').value }); toast('clave de AudD guardada ✓'); auddSettings(el); } catch (e) { toast(e.message, { kind: 'err' }); } };
  const del = el.querySelector('#cAuddDel'); if (del) del.onclick = async () => { await api.post('/api/recognize/config', { token: '' }); toast('clave quitada'); auddSettings(el); };
}

export function initRecognize() {
  bus.on('recognize', listen);
}
