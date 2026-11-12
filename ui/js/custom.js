// personalización: cada usuario arma petalwave a su gusto (diseño, tipografía, paneles, carátula, fondo,
// visualizador y temas propios). Todo se guarda en las preferencias y se puede exportar/importar.
import { $, $$, P, bus, esc, debounce, toast, confirm2 } from './core.js';
import { allThemes, themeSrc, saveMyTheme, deleteMyTheme, previewTheme, applyTheme, setTheme } from './theme.js';

// opciones de la pantalla completa (la lista de modos del visualizador se repite acá para no importar viz.js en círculo)
export const FULL_BG = [['cover', 'carátula desenfocada'], ['wallpaper', 'mi wallpaper y fondo animado'], ['theme', 'degradado del tema'], ['black', 'negro']];
export const FULL_VIZ = [['spectrum', 'spectrum'], ['wave', 'waveform'], ['circle', 'circular'], ['minimal', 'minimal'], ['particles', 'particles'], ['same', 'el mismo que el panel'], ['off', 'ninguno']];
// lista de efectos (bgfx.js la importa de acá para no crear un import circular)
export const FX = [
  { id: 'none', name: 'ninguno' }, { id: 'aurora', name: 'aurora' }, { id: 'waves', name: 'ondas' },
  { id: 'stars', name: 'estrellas' }, { id: 'rain', name: 'lluvia digital' }, { id: 'bokeh', name: 'bokeh' },
  { id: 'nebula', name: 'nebulosa' },
];

export const DEF = {
  font: 'JetBrains Mono', fscale: 1,
  sideW: 420, sideLeft: false, gap: 12, radius: 8, blur: 18, winAlpha: 0,   // 0 = la opacidad del tema
  cover: 172, coverShape: 'rounded', vinyl: false, title: 'petalwave',
  showViz: true, showTabs: true, showSys: true, showDeps: true, showClock: true, showTopNp: true,
  rowH: 56,
  vizBars: 0, vizPeaks: true, vizReflect: true, vizColor: 'theme', vizCustom: '#ff4d8d',
  petals: 'theme', scan: 'theme', wpDim: 18, wpBlur: 0,
  // fondos animados (bgfx.js)
  sharpBg: false,
  // pantalla completa
  fullBg: 'cover', fullBlur: 50, fullDim: 32, fullViz: 'spectrum', fullVizH: 30, fullVizOp: 38, fullCover: 46,
  bgFx: 'none', bgSpeed: 1, bgOpacity: 90, bgReact: true, bgCalm: false, bgFps: 30, wpVidSync: false, wpRate: 1,
};
export const FONTS = ['JetBrains Mono', 'Cascadia Mono', 'Cascadia Code', 'Consolas', 'Fira Code', 'Source Code Pro', 'Courier New', 'Segoe UI', 'Bahnschrift', 'Georgia', 'system-ui'];

// presets de diseño listos para usar (parten siempre del diseño original)
export const LAYOUTS = {
  default: { name: 'petalwave', desc: 'el diseño original', v: {} },
  minimal: { name: 'minimal', desc: 'sin visualizador ni ruido', v: { showViz: false, showSys: false, showDeps: false, gap: 16, radius: 14, blur: 26, rowH: 50, cover: 150, petals: 'off', scan: 'off' } },
  terminal: { name: 'terminal', desc: 'cuadrado y denso, como una tty', v: { radius: 0, gap: 6, blur: 0, winAlpha: 92, rowH: 40, font: 'Consolas', coverShape: 'square', cover: 132, vizReflect: false } },
  vinilo: { name: 'vinilo', desc: 'carátula redonda que gira', v: { coverShape: 'circle', vinyl: true, cover: 200, radius: 14 } },
  cine: { name: 'cine', desc: 'panel ancho y carátula enorme', v: { sideW: 520, cover: 240, rowH: 60, fscale: 1.05 } },
  zurdo: { name: 'zurdo', desc: 'reproductor a la izquierda', v: { sideLeft: true } },
  compacto: { name: 'compacto', desc: 'entra más en pantalla', v: { rowH: 40, gap: 8, cover: 120, fscale: 0.92, sideW: 380 } },
};

export const C = () => ({ ...DEF, ...(P.get('custom') || {}) });
const saveSoon = debounce(() => P.save(), 400);
export function setC(k, v) {
  const c = { ...(P.get('custom') || {}) };
  if (v === undefined || v === DEF[k]) delete c[k]; else c[k] = v;
  P.all().custom = c;
  saveSoon();
  applyCustom();
}
export function setMany(obj, replace) {
  P.all().custom = replace ? { ...obj } : { ...(P.get('custom') || {}), ...obj };
  P.save();
  applyCustom();
}

// se aplica después del tema: pisa solo lo que el usuario cambió
export function applyCustom() {
  const c = C(), r = document.documentElement.style, b = document.body.classList;
  r.setProperty('--font', `"${c.font}","JetBrains Mono","Cascadia Mono",Consolas,monospace`);
  r.setProperty('--side-w', c.sideW + 'px');
  r.setProperty('--gap', c.gap + 'px');
  r.setProperty('--r', c.radius + 'px');
  r.setProperty('--r-sm', Math.round(c.radius * 0.62) + 'px');
  r.setProperty('--blur', c.blur + 'px');
  r.setProperty('--cover', c.cover + 'px');
  r.setProperty('--cover-r', c.coverShape === 'circle' ? '50%' : c.coverShape === 'square' ? '0px' : 'var(--r)');
  r.setProperty('--row-h', (c.rowH - 4) + 'px');
  r.setProperty('--wp-dim', c.wpDim + '%');
  r.setProperty('--wp-blur', c.wpBlur + 'px');
  r.setProperty('--win-a', String((c.winAlpha || 60) / 100));
  // escala: zoom de CSS, compensando la altura para que todo siga entrando en la ventana
  document.documentElement.style.zoom = c.fscale === 1 ? '' : String(c.fscale);
  document.documentElement.style.height = c.fscale === 1 ? '' : (100 / c.fscale).toFixed(3) + '%';
  b.toggle('win-u', !!c.winAlpha);
  b.toggle('side-left', !!c.sideLeft);
  b.toggle('hide-viz', !c.showViz);
  b.toggle('hide-tabs', !c.showTabs);
  b.toggle('hide-sys', !c.showSys);
  b.toggle('hide-deps', !c.showDeps);
  b.toggle('hide-clock', !c.showClock);
  b.toggle('hide-topnp', !c.showTopNp);
  b.toggle('vinyl', c.coverShape === 'circle' && !!c.vinyl);
  b.toggle('sharp-bg', !!c.sharpBg);
  // pantalla completa
  const full = $('#full'); if (full) full.dataset.bg = c.fullBg;
  r.setProperty('--full-blur', c.fullBlur + 'px');
  r.setProperty('--full-dim', String(c.fullDim / 100));
  r.setProperty('--full-viz-h', c.fullVizH + '%');
  r.setProperty('--full-viz-op', String(c.fullVizOp / 100));
  r.setProperty('--full-cover', c.fullCover + 'vh');
  overrideFx(c);
  const t = String(c.title || 'petalwave').trim().slice(0, 24) || 'petalwave';
  $$('.ttl').forEach((el) => (el.textContent = t.toUpperCase().split('').join(' ')));
  bus.emit('custom');
}
function overrideFx(c = C()) {
  if (c.petals !== 'theme') document.body.classList.toggle('petals', c.petals === 'on');
  if (c.scan !== 'theme') document.body.classList.toggle('scanlines', c.scan === 'on');
}
bus.on('theme', () => overrideFx());
bus.on('eng:state', (s) => { if (s !== 'wait') document.body.classList.toggle('is-playing', s === 'play'); });

// ---------- exportar / importar ----------
export function exportConfig() {
  const data = { petalwave: 'estilo', version: 1, custom: P.get('custom') || {}, customThemes: P.get('customThemes') || {}, theme: P.get('theme'), dyn: P.get('dyn'), viz: P.get('viz') };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'petalwave-estilo.json';
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
export async function importConfig(file) {
  let j;
  try { j = JSON.parse(await file.text()); } catch { throw new Error('el archivo no es un JSON válido'); }
  if (!j || j.petalwave !== 'estilo') throw new Error('ese archivo no es un estilo de petalwave');
  const clean = {};
  for (const [k, v] of Object.entries(j.custom || {})) if (k in DEF && typeof v === typeof DEF[k]) clean[k] = v;
  const themes = {};
  for (const [k, t] of Object.entries(j.customThemes || {})) if (/^u_[a-z0-9]+$/.test(k) && t && t.src && ['ac', 'sec', 'bg', 'fg'].every((x) => typeof t.src[x] === 'string')) themes[k] = t;
  P.all().customThemes = { ...(P.get('customThemes') || {}), ...themes };
  if (typeof j.viz === 'string') P.all().viz = j.viz;
  if (typeof j.theme === 'string' && allThemes()[j.theme]) { P.all().theme = j.theme; P.all().dyn = !!j.dyn; }
  setMany(clean, true);
  applyTheme(); bus.emit('theme:changed'); bus.emit('viz:mode', P.get('viz'));
}

// ---------- panel "personalizar" (dentro de ajustes) ----------
const tip = (txt) => `<i class="tipi" title="${esc(txt)}">i</i>`;
function row(k, label, sub, ctrl, more) {
  return `<div class="cfrow" data-row="${k}"><span>${label}${more ? tip(more) : ''}${sub ? `<span class="m">${sub}</span>` : ''}</span><span class="cctl">${ctrl}<button class="rs" data-rs="${k}" title="volver al predeterminado">↺</button></span></div>`;
}
const rng = (k, label, sub, min, max, step, unit, more) => row(k, label, sub, `<input type="range" data-c="${k}" min="${min}" max="${max}" step="${step}"> <b class="cv" data-cv="${k}" data-u="${unit}"></b>`, more);
const tgl = (k, label, sub, more) => row(k, label, sub, `<input type="checkbox" data-c="${k}">`, more);
const sel = (k, label, sub, opts, more) => row(k, label, sub, `<select data-c="${k}">${opts.map(([v, t]) => `<option value="${esc(String(v))}">${esc(t)}</option>`).join('')}</select>`, more);

export function customizerHtml() {
  const mine = Object.entries(allThemes()).filter(([, t]) => t.mine);
  return `
  <div class="cfgsec wide"><h3>✦ presets de diseño ${tip('Un clic cambia todo el diseño de una vez. Después podés ajustar cada cosa a mano abajo.')}</h3>
    <div class="lays">${Object.entries(LAYOUTS).map(([k, l]) => `<button class="lay" data-lay="${k}"><i class="lay-pv lay-${k}"><u></u><s></s></i><b>${esc(l.name)}</b><span class="m">${esc(l.desc)}</span></button>`).join('')}</div>
    <div class="cfrow"><span>compartir tu estilo<span class="m">diseño, temas propios y visualizador en un .json</span></span><span><button class="cb" id="kExp">exportar</button> <button class="cb" id="kImp">importar</button> <button class="cb danger" id="kReset">restaurar todo</button><input type="file" id="kFile" accept=".json,application/json" hidden></span></div>
  </div>
  <div class="cfgsec"><h3>✎ mis temas ${tip('Elegí 5 colores y petalwave arma el resto (bordes, fondos, degradados). Los cambios se ven en vivo.')}</h3>
    <div class="cfrow"><span>empezar desde<span class="m">copia los colores de un tema</span></span><select id="teBase">${Object.entries(allThemes()).map(([k, t]) => `<option value="${k}">${esc(t.name)}</option>`).join('')}</select></div>
    <div class="te-cols">
      ${[['ac', 'acento'], ['sec', 'secundario'], ['bg', 'fondo'], ['fg', 'texto'], ['wall', 'wallpaper']].map(([k, t]) => `<label class="te-c"><input type="color" data-te="${k}"><span>${t}</span></label>`).join('')}
    </div>
    <div class="cfrow"><span>opacidad de las ventanas</span><span><input type="range" min="15" max="100" step="1" data-te="alpha"> <b id="teAlphaV"></b></span></div>
    <label class="cfrow"><span>pétalos cayendo</span><input type="checkbox" data-te="petals"></label>
    <label class="cfrow"><span>líneas de escaneo (CRT)</span><input type="checkbox" data-te="scan"></label>
    <div class="cfrow"><span>nombre</span><input type="text" id="teName" maxlength="24" placeholder="mi tema"></div>
    <div class="cfrow"><span id="teState" class="m"></span><span><button class="cb" id="teDrop">descartar</button> <button class="go" id="teSave">guardar tema</button></span></div>
    ${mine.length ? `<div class="mythemes">${mine.map(([k, t]) => `<span class="myth"><button class="cb sm" data-use="${k}"><i class="dot" style="background:${t['--ac']}"></i>${esc(t.name)}</button><button class="cb sm" data-edit="${k}" title="editar">✎</button><button class="cb sm danger" data-del="${k}" title="borrar">✕</button></span>`).join('')}</div>` : ''}
  </div>
  <div class="cfgsec"><h3>▦ diseño</h3>
    ${sel('sideLeft', 'reproductor', 'de qué lado va el panel', [['false', 'a la derecha'], ['true', 'a la izquierda']])}
    ${rng('sideW', 'ancho del panel', '', 300, 640, 10, 'px')}
    ${rng('gap', 'separación', 'espacio entre ventanas', 0, 28, 1, 'px')}
    ${rng('radius', 'bordes redondeados', '0 = cuadrado', 0, 24, 1, 'px')}
    ${rng('blur', 'desenfoque', 'efecto vidrio detrás de las ventanas', 0, 40, 1, 'px')}
    ${rng('winAlpha', 'opacidad de las ventanas', 'tema = la que trae el tema', 0, 100, 1, '%', 'Más alto = ventanas más sólidas, se ve menos el fondo.')}
    ${rng('fscale', 'tamaño de la interfaz', 'escala todo (texto, botones, paneles)', 0.8, 1.3, 0.01, 'x')}
    ${sel('font', 'fuente', '', FONTS.map((f) => [f, f]), 'Si la fuente no está instalada en tu PC se usa JetBrains Mono / Consolas.')}
    ${rng('rowH', 'altura de las filas', 'en la lista de canciones', 36, 72, 2, 'px')}
  </div>
  <div class="cfgsec"><h3>◉ reproductor</h3>
    ${rng('cover', 'tamaño de la carátula', '', 90, 280, 2, 'px')}
    ${sel('coverShape', 'forma de la carátula', '', [['rounded', 'redondeada'], ['square', 'cuadrada'], ['circle', 'circular']])}
    ${tgl('vinyl', 'efecto vinilo', 'la carátula circular gira mientras suena')}
    <div class="cfrow" data-row="title"><span>texto del título<span class="m">el que aparece arriba de la canción</span></span><span class="cctl"><input type="text" data-c="title" maxlength="24" style="width:130px"><button class="rs" data-rs="title" title="volver al predeterminado">↺</button></span></div>
  </div>
  <div class="cfgsec"><h3>▤ qué se muestra</h3>
    ${tgl('showViz', 'visualizador', 'ventana con las barras')}
    ${tgl('showTabs', 'cola · historial · letra', 'ventana de pestañas del panel')}
    ${tgl('showTopNp', 'controles en la barra', 'play/anterior/siguiente arriba')}
    ${tgl('showSys', 'cpu y ram', 'en la barra de arriba')}
    ${tgl('showDeps', 'estado de yt-dlp / ffmpeg', 'en la barra de arriba')}
    ${tgl('showClock', 'reloj', 'en la barra de arriba')}
  </div>
  <div class="cfgsec"><h3>≋ estilo del visualizador</h3>
    ${sel('vizBars', 'cantidad de barras', 'modo spectrum', [[0, 'automático'], [16, '16'], [24, '24'], [32, '32'], [48, '48'], [64, '64'], [96, '96'], [128, '128']])}
    ${tgl('vizPeaks', 'picos', 'la rayita que cae despacio')}
    ${tgl('vizReflect', 'reflejo', 'barras espejadas abajo')}
    ${sel('vizColor', 'color', '', [['theme', 'del tema'], ['rainbow', 'arcoíris'], ['custom', 'uno fijo']])}
    <div class="cfrow" data-row="vizCustom"><span>color fijo<span class="m">si elegiste "uno fijo"</span></span><span class="cctl"><input type="color" data-c="vizCustom"><button class="rs" data-rs="vizCustom" title="volver al predeterminado">↺</button></span></div>
  </div>
  <div class="cfgsec"><h3>▧ fondo</h3>
    ${sel('petals', 'pétalos cayendo', '', [['theme', 'según el tema'], ['on', 'siempre'], ['off', 'nunca']])}
    ${sel('scan', 'líneas de escaneo', 'efecto monitor CRT', [['theme', 'según el tema'], ['on', 'siempre'], ['off', 'nunca']])}
    ${rng('wpDim', 'oscurecer el fondo', 'para leer mejor sobre wallpapers claros', 0, 85, 1, '%')}
    ${rng('wpBlur', 'desenfocar el wallpaper', '', 0, 30, 1, 'px')}
  </div>
  <div class="cfgsec"><h3>⛶ pantalla completa ${tip('Lo que se ve con la tecla f o al hacer clic en la carátula. También se cambia desde el engranaje ⚙ arriba a la derecha de la pantalla completa.')}</h3>
    ${sel('fullBg', 'fondo', '', FULL_BG)}
    ${rng('fullBlur', 'desenfoque de la carátula', 'solo con fondo "carátula"', 0, 100, 1, 'px')}
    ${rng('fullDim', 'brillo del fondo', '', 8, 90, 1, '%')}
    ${sel('fullViz', 'visualizador', '', FULL_VIZ)}
    ${rng('fullVizH', 'altura del visualizador', '', 10, 100, 1, '%')}
    ${rng('fullVizOp', 'intensidad del visualizador', '', 10, 100, 1, '%')}
    ${rng('fullCover', 'tamaño de la carátula', '', 24, 64, 1, 'vh')}
  </div>
  <div class="cfgsec"><h3>✺ fondo animado ${tip('Un efecto dibujado en vivo con los colores del tema, encima de tu wallpaper. También podés usar un GIF o un video (mp4 / webm) como wallpaper.')}</h3>
    ${tgl('sharpBg', 'fondo nítido', 'sin desenfoque: el wallpaper y el fondo animado se ven claros detrás de las ventanas', 'Apaga el efecto vidrio de las ventanas y el desenfoque del wallpaper. Para mirar el fondo sin ventanas: tecla b o el ojo de la barra.')}
    <div class="cfrow"><span>ver el fondo<span class="m">esconde las ventanas un momento · tecla b o el ojo 👁 de la barra</span></span><button class="cb" data-act="peek">ver ahora</button></div>
    <div class="fxs">${FX.map((f) => `<button class="fxb" data-fx="${f.id}"><i class="fxpv fx-${f.id}"></i><span>${esc(f.name)}</span></button>`).join('')}</div>
    ${rng('bgSpeed', 'velocidad', '', 0.2, 3, 0.1, 'x')}
    ${rng('bgOpacity', 'intensidad', 'qué tanto se nota el efecto', 10, 100, 1, '%')}
    ${tgl('bgReact', 'reacciona a la música', 'late con los graves')}
    ${tgl('bgCalm', 'más lento en pausa', 'se calma cuando no suena nada')}
    ${sel('bgFps', 'fluidez', '30 usa menos CPU', [[30, '30 fps'], [60, '60 fps']])}
    <div class="cfrow"><span>wallpaper animado<span class="m">GIF o video mp4 / webm en loop, sin sonido · también shift + soltar el video</span></span><span><button class="cb" id="kWpVid">elegir GIF o video</button></span></div>
    ${tgl('wpVidSync', 'pausar el video con la música', 'el video de fondo se mueve solo mientras suena algo')}
    ${rng('wpRate', 'velocidad del video', '', 0.25, 2, 0.05, 'x')}
  </div>`;
}

const fmt = (k, v, u) => (k === 'winAlpha' && !v ? 'tema' : k === 'fscale' ? Math.round(v * 100) + '%' : u === 'x' ? (+v).toFixed(2).replace(/0$/, '') + 'x' : v + (u || ''));
function syncControls(box) {
  const c = C();
  box.querySelectorAll('[data-c]').forEach((el) => {
    const k = el.dataset.c, v = c[k];
    if (el.type === 'checkbox') el.checked = !!v;
    else if (document.activeElement !== el) el.value = String(v);
  });
  box.querySelectorAll('[data-cv]').forEach((el) => (el.textContent = fmt(el.dataset.cv, c[el.dataset.cv], el.dataset.u)));
  box.querySelectorAll('[data-rs]').forEach((el) => (el.style.visibility = c[el.dataset.rs] === DEF[el.dataset.rs] ? 'hidden' : 'visible'));
  const cur = Object.entries(LAYOUTS).find(([, l]) => Object.keys(DEF).every((k) => (k in l.v ? l.v[k] : DEF[k]) === c[k]));
  box.querySelectorAll('[data-lay]').forEach((b) => b.classList.toggle('on', !!cur && b.dataset.lay === cur[0]));
  box.querySelectorAll('[data-fx]').forEach((b) => b.classList.toggle('on', b.dataset.fx === c.bgFx));
}

export function bindCustomizer(box, rerender) {
  syncControls(box);
  if (box._offCustom) box._offCustom();
  box._offCustom = bus.on('custom', () => { if (box.isConnected) syncControls(box); });
  box.querySelectorAll('[data-c]').forEach((el) => {
    const k = el.dataset.c;
    const val = () => {
      if (el.type === 'checkbox') return el.checked;
      const d = DEF[k];
      if (typeof d === 'number') return +el.value;
      if (typeof d === 'boolean') return el.value === 'true';
      return el.value;
    };
    el.addEventListener(el.type === 'range' || el.type === 'text' || el.type === 'color' ? 'input' : 'change', () => { setC(k, val()); syncControls(box); });
  });
  box.querySelectorAll('[data-rs]').forEach((b) => (b.onclick = () => { setC(b.dataset.rs, undefined); syncControls(box); }));
  box.querySelectorAll('[data-fx]').forEach((b) => (b.onclick = () => { setC('bgFx', b.dataset.fx); syncControls(box); }));
  $('#kWpVid').onclick = () => bus.emit('wallpaper:pick');
  box.querySelectorAll('[data-lay]').forEach((b) => (b.onclick = () => { setMany(LAYOUTS[b.dataset.lay].v, true); syncControls(box); toast('diseño ' + LAYOUTS[b.dataset.lay].name, { ms: 1400 }); }));
  $('#kExp').onclick = () => { exportConfig(); toast('estilo exportado: petalwave-estilo.json', { sub: 'queda en tu carpeta de descargas' }); };
  $('#kImp').onclick = () => $('#kFile').click();
  $('#kFile').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { await importConfig(f); toast('estilo importado'); rerender(); } catch (err) { toast(err.message, { kind: 'err' }); }
  };
  $('#kReset').onclick = async () => {
    if (!(await confirm2('Restaurar diseño', 'Vuelve todo el diseño a como venía de fábrica. <b>Tus temas propios no se borran.</b>', 'restaurar'))) return;
    setMany({}, true); syncControls(box); toast('diseño restaurado');
  };

  // ---------- editor de temas ----------
  let editing = null, draft = null, dirty = false;
  const fill = () => {
    box.querySelectorAll('[data-te]').forEach((el) => {
      const k = el.dataset.te;
      if (el.type === 'checkbox') el.checked = !!draft[k];
      else if (k === 'alpha') el.value = Math.round((draft.alpha ?? 0.6) * 100);
      else el.value = draft[k] || draft.ac;
    });
    $('#teAlphaV').textContent = Math.round((draft.alpha ?? 0.6) * 100) + '%';
    $('#teState').textContent = editing ? 'editando «' + (allThemes()[editing] || {}).name + '»' : dirty ? 'vista previa · sin guardar' : 'cambiá un color para ver la vista previa';
    $('#teSave').textContent = editing ? 'guardar cambios' : 'guardar tema';
  };
  const load = (key, asEdit) => { draft = themeSrc(key); editing = asEdit ? key : null; dirty = false; $('#teBase').value = key in allThemes() ? key : 'blood'; $('#teName').value = asEdit ? allThemes()[key].name : ''; fill(); };
  load(P.get('theme'), false);
  $('#teBase').onchange = (e) => { load(e.target.value, false); dirty = true; previewTheme(draft); fill(); };
  box.querySelectorAll('[data-te]').forEach((el) => el.addEventListener('input', () => {
    const k = el.dataset.te;
    draft[k] = el.type === 'checkbox' ? el.checked : k === 'alpha' ? +el.value / 100 : el.value;
    dirty = true; previewTheme(draft); fill();
  }));
  $('#teDrop').onclick = () => { applyTheme(); load(P.get('theme'), false); };
  $('#teSave').onclick = () => {
    const name = $('#teName').value.trim() || (editing ? allThemes()[editing].name : 'mi tema ' + (Object.keys(P.get('customThemes') || {}).length + 1));
    const key = saveMyTheme(editing, name, { ...draft });
    setTheme(key);
    toast('tema «' + name + '» guardado', { sub: 'aparece en la lista de temas y con la tecla t' });
    rerender();
  };
  box.querySelectorAll('[data-use]').forEach((b) => (b.onclick = () => setTheme(b.dataset.use)));
  box.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => { setTheme(b.dataset.edit); load(b.dataset.edit, true); $('#teName').focus(); }));
  box.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    const t = allThemes()[b.dataset.del];
    if (!(await confirm2('Borrar tema', `¿Borrar el tema <b>${esc(t.name)}</b>?`, 'borrar'))) return;
    deleteMyTheme(b.dataset.del); rerender();
  }));
}
