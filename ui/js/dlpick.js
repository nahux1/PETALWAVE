// al descargar: ¿MP3 (solo audio) o MP4 (video)? Se puede recordar la elección (ajustes → descargas).
import { P, modal, esc } from './core.js';

const VQ = ['2160', '1440', '1080', '720', '480', '360'];
const pack = (f) => {
  const d = P.get('dl') || {};
  if (f === 'mp4') return { format: 'mp4', quality: VQ.includes(String(d.vquality)) ? String(d.vquality) : '1080', cookies: d.cookies || '' };
  return { format: 'mp3', quality: d.format === 'mp3' && /^(320|256|192|128)$/.test(String(d.quality)) ? String(d.quality) : '320', cookies: d.cookies || '' };
};

// devuelve { format, quality, cookies } o null si se canceló
export async function chooseFormat(n = 1, title = '') {
  if (P.get('dlAsk') === false) return pack(P.get('dlPick') === 'mp4' ? 'mp4' : 'mp3');
  const d = P.get('dl') || {};
  const a = pack('mp3'), v = pack('mp4');
  let remember = false;
  const read = (box) => { remember = !!(box.querySelector('#dlRem') || {}).checked; };
  const f = await modal({
    title: n > 1 ? `Descargar ${n} canciones` : 'Descargar',
    html: `${title ? `<div class="m" style="margin-bottom:10px">${esc(title)}</div>` : ''}
      <div class="dlpick">
        <div><b>🎵 MP3</b><span>solo audio · ${a.quality} kbps · para escuchar y llevar al celular</span></div>
        <div><b>🎬 MP4</b><span>video con sonido · hasta ${v.quality}p · si querés ver el videoclip</span></div>
      </div>
      <label class="dlpick-r"><input type="checkbox" id="dlRem"> recordar mi elección y no volver a preguntar <span class="m">(se cambia en ajustes → descargas)</span></label>`,
    actions: [
      { label: 'cancelar', value: null },
      { label: '🎬 MP4 (video)', fn: (box) => { read(box); return 'mp4'; } },
      { label: '🎵 MP3 (audio)', primary: true, fn: (box) => { read(box); return 'mp3'; } },
    ],
  });
  if (f !== 'mp3' && f !== 'mp4') return null;
  if (remember) { P.set('dlAsk', false); P.set('dlPick', f); }
  void d;
  return pack(f);
}
