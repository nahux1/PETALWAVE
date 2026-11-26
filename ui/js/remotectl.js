// control remoto desde el celular (solo Windows): la PC le cuenta al servidor chico qué suena, y hace lo que pide el celular
import { P, api, bus, toast, coverUrl, esc, modal } from './core.js';
import { engine } from './audio.js';
import * as player from './player.js';
import { T } from './data.js';
import { isLiked, likeCurrent } from './likes.js';

const isAndroid = !!window.PetalwaveNative;
let on = false, pushT = 0;

function state() {
  const t = player.current(), S = player.S;
  const next = [];
  for (let i = S.qi + 1; i < S.queue.length && next.length < 15; i++) { const x = T(S.queue[i]); if (x) next.push({ i, title: x.title, artist: x.artist || '' }); }
  return t ? {
    id: t.id, title: t.title, artist: t.artist || '', album: t.album || '', playing: !engine.paused, pos: engine.time || 0, dur: engine.duration || t.duration || 0,
    vol: Math.min(1, (P.get('vol') || {}).master ?? 1), liked: isLiked(t.id), shuffle: !!S.shuffle, repeat: S.repeat, hasCover: true, cover: coverUrl(t.id, 600), next,
  } : { title: '', playing: false, next };
}
function push() {
  if (!on) return;
  clearTimeout(pushT);
  pushT = setTimeout(() => api.post('/api/remote/state', { state: state() }).catch(() => {}), 250);
}

function exec(c) {
  if (c === 'toggle') return player.toggle();
  if (c === 'play') { if (engine.paused) player.toggle(); return; }
  if (c === 'pause') { if (!engine.paused) player.toggle(); return; }
  if (c === 'next') return player.next();
  if (c === 'prev') return player.prev();
  if (c === 'like') return likeCurrent();
  if (c === 'shuffle') return player.toggleShuffle();
  if (c === 'repeat') return player.toggleRepeat();
  if (c.startsWith('seek:')) { engine.seek(+c.slice(5)); return push(); }
  if (c.startsWith('vol:')) { player.setVol(+c.slice(4)); return push(); }
  if (c.startsWith('jump:')) return player.jump(+c.slice(5));
}

export async function remoteStatus() { try { return await api.get('/api/remote'); } catch { return { on: false, urls: [] }; } }
export async function setRemote(want, regen = false) {
  const s = await api.post('/api/remote/config', { on: !!want, regen });
  on = !!s.on;
  push();
  return s;
}

// QR para abrir el control desde el celular (la clave va después de #, así no viaja en los pedidos)
export async function showRemoteQr() {
  const s = await remoteStatus();
  if (!s.on) return toast('activá primero el control remoto', { kind: 'warn' });
  if (!s.urls.length) return toast('esta PC no está conectada a una red WiFi o de cable', { kind: 'warn' });
  const url = s.urls[0] + '#k=' + s.token;
  let svg = '';
  try {
    const { loadScript } = await import('./share.js');
    const qrcode = await loadScript('/ui/vendor/qrcode.js', 'qrcode');
    const qr = qrcode(0, 'M'); qr.addData(url, 'Byte'); qr.make();
    svg = qr.createSvgTag({ cellSize: 5, margin: 3, scalable: true });
  } catch (e) { svg = `<div class="warn">${esc(e.message)}</div>`; }
  await modal({
    title: '📱 control remoto',
    html: `<div class="qrbox">${svg}</div>
      <p class="m">Escaneá el código con la cámara del celular (tiene que estar en la misma WiFi que esta PC). Se abre una página para manejar Petalwave: play, siguiente, volumen, ♥ y la cola. Guardala en la pantalla de inicio para tenerla a mano.</p>
      <p class="m">Si Windows pregunta por el firewall, permití el acceso en <b>redes privadas</b>.</p>
      ${s.urls.length > 1 ? `<p class="m">Otras direcciones de esta PC: ${s.urls.slice(1).map(esc).join(' · ')}</p>` : ''}`,
    actions: [{ label: 'cambiar la clave', fn: async () => { await setRemote(true, true); toast('clave nueva: los celulares que ya estaban tienen que escanear de nuevo'); return true; } }, { label: 'listo', primary: true, value: true }],
  });
}

export async function initRemote() {
  if (isAndroid) return;
  bus.on('sse:remote', (d) => { if (d && typeof d.cmd === 'string') exec(d.cmd); });
  for (const ev of ['np', 'eng:state', 'eng:seek', 'queue', 'like', 'modes']) bus.on(ev, push);
  setInterval(() => { if (on && !engine.paused) push(); }, 10000);
  const s = await remoteStatus();
  on = !!s.on;
  push();
}
