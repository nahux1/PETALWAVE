// compartir playlists con un código QR (o un código de texto) entre usuarios de Petalwave
// El código lleva el nombre y los ids de YouTube de las canciones: el otro Petalwave arma la misma playlist
// con esas canciones online (y usa los archivos si ya las tiene descargadas).
// Formato: PW1.<nombre en base64url>.<id1><id2>… (cada id de YouTube tiene 11 caracteres)
import { $, esc, toast, modal } from './core.js';
import { D, T, plOp, remoteTrack, loadPlaylists } from './data.js';
import { api } from './core.js';

const MAX_BYTES = 2800;   // lo que entra cómodo en un QR (nivel de corrección L)
const b64u = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

function loadScript(src, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  return new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = src; s.onload = () => ok(window[globalName]); s.onerror = () => no(new Error('no se pudo cargar ' + src));
    document.head.appendChild(s);
  });
}

export function encodePlaylist(name, ids) {
  const yt = [...new Set(ids.map((id) => T(id)).filter((t) => t && t.ytId && /^[\w-]{11}$/.test(t.ytId)).map((t) => t.ytId))];
  const head = 'PW1.' + b64u(String(name || 'playlist').slice(0, 60)) + '.';
  const room = Math.floor((MAX_BYTES - head.length) / 11);
  const used = yt.slice(0, room);
  return { code: head + used.join(''), shared: used.length, skipped: ids.length - used.length };
}
export function decodePlaylist(code) {
  const m = /PW1\.([\w-]*)\.((?:[\w-]{11})+)/.exec(String(code || '').replace(/\s+/g, ''));
  if (!m) throw new Error('Ese no es un código de playlist de Petalwave');
  let name = 'playlist compartida';
  try { name = unb64u(m[1]) || name; } catch {}
  const ids = m[2].match(/[\w-]{11}/g) || [];
  return { name, ids };
}

// ---------- compartir ----------
export async function sharePlaylist(pid) {
  const p = D.playlists.find((x) => x.id === pid) || (pid === 'liked' ? { id: 'liked', name: 'Me gusta', tracks: [] } : null);
  if (!p) return;
  const { code, shared, skipped } = encodePlaylist(p.name, p.tracks);
  if (!shared) return toast('Esta playlist no tiene canciones de YouTube para compartir', { kind: 'warn', sub: 'solo se comparten canciones que existen en YouTube / YouTube Music' });
  let svg = '';
  try {
    const qrcode = await loadScript('/ui/vendor/qrcode.js', 'qrcode');
    const qr = qrcode(0, 'L'); qr.addData(code, 'Byte'); qr.make();
    svg = qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
  } catch (e) { svg = `<div class="warn">${esc(e.message)}</div>`; }
  await modal({
    title: 'Compartir «' + p.name + '»',
    html: `<div class="qrbox">${svg}</div>
      <div class="m" style="margin:8px 0">${shared} canciones${skipped ? ` · ${skipped} no se comparten (no están en YouTube o no entraron en el código)` : ''}</div>
      <div class="m">En el otro Petalwave: <b>mis playlists → importar</b> y escaneá este código con la cámara, o pegá el código de texto.</div>
      <textarea class="qrcode-txt" readonly rows="3">${esc(code)}</textarea>`,
    actions: [{ label: 'copiar código', fn: async (box) => { try { await navigator.clipboard.writeText(code); toast('código copiado'); } catch { box.querySelector('textarea').select(); document.execCommand('copy'); toast('código copiado'); } return false; } }, { label: 'listo', primary: true }],
    wide: false,
  });
}

// ---------- importar ----------
export async function importPlaylist(code) {
  const { name, ids } = decodePlaylist(code);
  if (!ids.length) throw new Error('El código no tiene canciones');
  toast(`importando «${name}»…`, { sub: `${ids.length} canciones`, ms: 2000 });
  // datos de las canciones (título, artista, carátula) desde YouTube Music, de a 50
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    try { const r = await api.get('/api/ytm/songs?ids=' + part.join(',')); for (const it of (r.tracks || r.items || [])) if (it.videoId) remoteTrack(it); }
    catch { for (const v of part) if (!T('yt_' + v)) remoteTrack({ videoId: v, title: 'canción de YouTube', artists: [] }); }
  }
  // si alguna ya está en tu biblioteca, se usa la tuya
  const local = new Map(D.tracks.filter((t) => t.ytId).map((t) => [t.ytId, t.id]));
  const tracks = ids.map((v) => local.get(v) || 'yt_' + v).filter((id) => T(id));
  const p = await plOp({ create: { name, tracks } });
  await loadPlaylists();
  toast(`playlist «${p.name}» importada ✓`, { sub: `${tracks.length} canciones` });
  return p;
}

export async function importDialog(onDone) {
  const canCam = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  const r = await modal({
    title: 'Importar playlist',
    html: `<div class="m" style="margin-bottom:8px">Pegá el código que te pasaron${canCam ? ' o escaneá el QR con la cámara' : ''}.</div>
      <textarea id="impCode" rows="3" placeholder="PW1.…" style="width:100%"></textarea>
      ${canCam ? '<div class="scanbox" id="scanBox" hidden><video id="scanVid" playsinline muted></video><div class="m" id="scanMsg">apuntá la cámara al código QR…</div></div>' : ''}`,
    actions: [
      ...(canCam ? [{ label: 'escanear QR', fn: (box) => { startScan(box); return false; } }] : []),
      { label: 'cancelar', value: null },
      { label: 'importar', primary: true, fn: (box) => box.querySelector('#impCode').value.trim() || false },
    ],
  });
  stopScan();
  if (!r || typeof r !== 'string') return;
  try { const p = await importPlaylist(r); if (onDone) onDone(p); } catch (e) { toast(e.message, { kind: 'err' }); }
}

// ---------- lector de QR con la cámara ----------
let stream = null, raf = 0;
async function startScan(box) {
  const wrap = box.querySelector('#scanBox'), vid = box.querySelector('#scanVid'), msg = box.querySelector('#scanMsg');
  wrap.hidden = false;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
  } catch (e) { msg.textContent = 'no se pudo abrir la cámara: ' + (e.name === 'NotAllowedError' ? 'dale permiso a Petalwave para usar la cámara' : e.message); return; }
  vid.srcObject = stream; await vid.play().catch(() => {});
  const det = 'BarcodeDetector' in window ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
  const jsQR = det ? null : await loadScript('/ui/vendor/jsQR.js', 'jsQR').catch(() => null);
  const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
  const loop = async () => {
    if (!stream) return;
    let text = null;
    try {
      if (det) { const r = await det.detect(vid); if (r[0]) text = r[0].rawValue; }
      else if (jsQR && vid.videoWidth) {
        const w = Math.min(640, vid.videoWidth), h = Math.round(vid.videoHeight * w / vid.videoWidth);
        cv.width = w; cv.height = h; cx.drawImage(vid, 0, 0, w, h);
        const r = jsQR(cx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
        if (r) text = r.data;
      }
    } catch {}
    if (text && /PW1\./.test(text)) {
      box.querySelector('#impCode').value = text;
      msg.textContent = '✓ código leído';
      stopScan();
      box.querySelector('.mact .go').click();
      return;
    }
    raf = requestAnimationFrame(loop);
  };
  loop();
}
function stopScan() {
  cancelAnimationFrame(raf);
  if (stream) { for (const t of stream.getTracks()) t.stop(); stream = null; }
}
