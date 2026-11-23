// bienvenida la primera vez: 3 pasos cortos (tema, de dónde sale tu música, lo más útil). Pensada para quien no sabe de informática.
import { $, P, api, bus, esc, toast, host, modal } from './core.js';
import { D } from './data.js';
import { allThemes, setTheme } from './theme.js';

const sw = (t) => `<div class="sw">${['--deep', '--ac3', '--ac', '--ac2', '--fg'].map((k) => `<i style="background:${t[k]}"></i>`).join('')}</div>`;

async function stepTheme() {
  const th = allThemes();
  const keys = Object.keys(th).filter((k) => !th[k].mine).slice(0, 6);
  return modal({
    title: '❀ Bienvenido a Petalwave',
    html: `<div class="wl-sub">Tu música, tus descargas y canciones nuevas según tus gustos. Primero, elegí cómo querés que se vea:</div>
      <div class="wl-themes">${keys.map((k) => `<button class="th-card ${P.get('theme') === k ? 'on' : ''}" data-wt="${k}">${sw(th[k])}<b>${esc(th[k].name || k)}</b></button>`).join('')}</div>
      <div class="m">Lo podés cambiar cuando quieras en ajustes → apariencia.</div>`,
    onOpen: (box) => box.querySelectorAll('[data-wt]').forEach((b) => (b.onclick = () => { setTheme(b.dataset.wt); box.querySelectorAll('[data-wt]').forEach((x) => x.classList.toggle('on', x === b)); })),
    actions: [{ label: 'saltar todo', value: 'skip' }, { label: 'siguiente', primary: true, value: 'next' }],
  });
}

async function stepMusic() {
  return modal({
    title: '♫ ¿De dónde sale tu música?',
    html: `<div class="wl-opts">
      <button class="wl-opt" data-wo="dl"><b>⇣ Descargar de YouTube</b><span>pegás el link de una canción o playlist y listo</span></button>
      <button class="wl-opt" data-wo="folder"><b>📁 Ya tengo música</b><span>elegí la carpeta donde están tus canciones</span></button>
      ${host.canLogin ? '<button class="wl-opt" data-wo="login"><b>👤 Mi cuenta de YouTube Music</b><span>tus me gusta y playlists, para escuchar sin descargar</span></button>' : ''}
      <button class="wl-opt" data-wo="search"><b>🔍 Buscar y escuchar online</b><span>cualquier canción, sin descargar nada</span></button></div>`,
    onOpen: (box) => box.querySelectorAll('[data-wo]').forEach((b) => (b.onclick = async () => {
      const o = b.dataset.wo;
      if (o === 'folder') {
        const f = await host.pickFolder('Carpeta con tu música');
        if (f) { try { await api.post('/api/library/folders', { add: f }); toast('carpeta agregada: buscando canciones…'); b.classList.add('done'); } catch (e) { toast(e.message, { kind: 'err' }); } }
        return;
      }
      if (o === 'login') { bus.emit('ws', 'cfg'); import('./ytmui.js').then((m) => m.login()); }
      done(o);
      box.querySelector('.mact button').click();   // cerrar la ventana y llevar a donde eligió
    })),
    actions: [{ label: 'después', value: 'later' }, { label: 'siguiente', primary: true, value: 'next' }],
  });
}
let done = () => {};

async function stepTips() {
  return modal({
    title: '✦ Lo más útil',
    html: `<ul class="wl-tips">
      <li><b>❀ ¿qué suena?</b> reconoce la canción que está sonando cerca (tecla <kbd>w</kbd>).</li>
      <li><b>🔍 buscar</b> en tu música y en YouTube Music a la vez (tecla <kbd>/</kbd>).</li>
      <li><b>♥</b> en las canciones que te gustan: Petalwave aprende y te recomienda (Inicio → tus mixes).</li>
      <li><b>espacio</b> play/pausa · <b>f</b> pantalla completa · en el celular, deslizá la barra de abajo hacia arriba.</li></ul>`,
    actions: [{ label: 'empezar ❀', primary: true, value: 'end' }],
  });
}

export async function maybeWelcome() {
  if (P.get('onboarded')) return;
  // quien ya usaba Petalwave (tiene música o escuchas) no ve la bienvenida
  if (D.tracks.length || Object.keys(D.plays || {}).length) { P.set('onboarded', true); return; }
  let goto = null;
  done = (o) => { goto = o; };
  const a = await stepTheme();
  if (a !== 'skip' && a !== null) {
    const b = await stepMusic();
    if (!goto && b !== null) await stepTips();
  }
  P.set('onboarded', true);
  if (goto === 'dl') bus.emit('ws', 'dl');
  if (goto === 'search') bus.emit('gsearch');
}
