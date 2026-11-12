// panel de volumen + ecualizador de 10 bandas (graves, agudos, balance, preamp, presets propios)
import { $, $$, P, bus, esc, toast, prompt2 } from './core.js';
import { engine, EQ_FREQS } from './audio.js';
import { setVol, toggleMute, setSongDb, current, applySound } from './player.js';

export const PRESETS = {
  'plano': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'bass boost': [7, 6, 5, 3, 1, 0, 0, 0, 0, 0],
  'phonk': [8, 7, 5, 2, 0, -1, 0, 1, 2, 2],
  'electrónica': [6, 5, 2, 0, -2, 1, 0, 2, 4, 5],
  'rock': [5, 4, 2, -1, -2, -1, 1, 3, 4, 5],
  'pop': [-1, 1, 3, 4, 3, 0, -1, -1, 1, 2],
  'voces': [-3, -2, -1, 1, 3, 4, 3, 2, 0, -1],
  'acústica': [3, 3, 2, 0, 1, 1, 2, 3, 2, 1],
  'agudos+': [0, 0, 0, 0, 0, 1, 3, 4, 5, 6],
  'noche': [2, 2, 1, 0, 0, -1, -2, -3, -4, -5],
};
const fmtDb = (d) => (d > 0 ? '+' : '') + d + ' dB';
const fLabel = (f) => (f >= 1000 ? f / 1000 + 'k' : String(f));

let open = false;
const pop = () => $('#volPop');

export function toggleVolPop(force) {
  open = force === undefined ? pop().hidden : force;
  pop().hidden = !open;
  if (!open) return;
  render();
  const r = $('#tVol').getBoundingClientRect();
  pop().style.top = r.bottom + 8 + 'px';
  pop().style.right = Math.max(8, innerWidth - r.right) + 'px';
  pop().style.left = '';
}
export function openEq() { toggleVolPop(true); setTimeout(() => { const s = $('#eqSec'); if (s) s.scrollIntoView({ block: 'start' }); }, 10); }

function render() {
  const v = P.get('vol'), eq = P.get('eq'), t = current();
  const custom = eq.custom || {};
  pop().innerHTML = `
    <div class="vrow"><b>volumen de petalwave</b><span class="sp"></span><span class="v" id="vpM">${v.muted ? 'mute' : Math.round(v.master * 100) + '%'}</span></div>
    <div class="vrow"><input type="range" data-vol min="0" max="150" step="1" value="${Math.round(v.master * 100)}"><button class="cb sm ${v.muted ? 'on' : ''}" id="vpMute">silenciar</button></div>
    <div class="m">0–150% · rueda del mouse o ↑/↓ · <kbd>m</kbd> silencia · por encima de 100% hay un limitador para que no distorsione</div>
    <div class="sec">esta canción</div>
    <div class="m" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t ? esc(t.title) : 'nada sonando'}</div>
    <div class="vrow"><input type="range" id="vpSong" min="-12" max="12" step="1" value="${t ? +v.perSong[t.id] || 0 : 0}" ${t ? '' : 'disabled'}><span class="v" id="vpSongV">${t ? fmtDb(+v.perSong[t.id] || 0) : '—'}</span><button class="cb sm" id="vpSongR" title="0 dB">↺</button></div>
    <label class="ck"><input type="checkbox" id="vpNorm" ${v.norm ? 'checked' : ''}> normalizar volumen <span class="m">(todas suenan parejas)</span></label>
    <div class="sec" id="eqSec">ecualizador <label class="ck"><input type="checkbox" id="eqOn" ${eq.on !== false ? 'checked' : ''}> activo</label></div>
    <div class="eqbands">${EQ_FREQS.map((f, i) => `<div class="eqb"><b id="eqV${i}">${eq.bands[i] > 0 ? '+' : ''}${eq.bands[i]}</b><input type="range" min="-12" max="12" step="1" value="${eq.bands[i]}" data-band="${i}"><span>${fLabel(f)}</span></div>`).join('')}</div>
    <div class="vrow"><span style="width:58px" class="m">preamp</span><input type="range" min="-12" max="6" step="1" value="${eq.preamp || 0}" data-eq="preamp"><span class="v" data-eqv="preamp">${fmtDb(eq.preamp || 0)}</span></div>
    <div class="vrow"><span style="width:58px" class="m">graves</span><input type="range" min="-12" max="12" step="1" value="${eq.bass || 0}" data-eq="bass"><span class="v" data-eqv="bass">${fmtDb(eq.bass || 0)}</span></div>
    <div class="vrow"><span style="width:58px" class="m">agudos</span><input type="range" min="-12" max="12" step="1" value="${eq.treble || 0}" data-eq="treble"><span class="v" data-eqv="treble">${fmtDb(eq.treble || 0)}</span></div>
    <div class="vrow"><span style="width:58px" class="m">balance</span><input type="range" min="-100" max="100" step="5" value="${Math.round((eq.balance || 0) * 100)}" data-eq="balance"><span class="v" data-eqv="balance">${balTxt(eq.balance || 0)}</span></div>
    <div class="sec">presets</div>
    <div class="presets">${Object.keys(PRESETS).map((k) => `<button class="cb sm ${eq.preset === k ? 'on' : ''}" data-pre="${esc(k)}">${esc(k)}</button>`).join('')}
      ${Object.keys(custom).map((k) => `<button class="cb sm ${eq.preset === k ? 'on' : ''}" data-cpre="${esc(k)}" title="clic derecho: borrar">★ ${esc(k)}</button>`).join('')}</div>
    <div class="vrow"><button class="cb sm" id="eqSave">guardar como preset…</button><button class="cb sm" id="eqReset">resetear</button></div>`;
  const q = (s) => pop().querySelector(s);
  q('#vpMute').onclick = () => { toggleMute(); render(); };
  q('#vpSong').oninput = (e) => { setSongDb(+e.target.value); q('#vpSongV').textContent = fmtDb(+e.target.value); };
  q('#vpSongR').onclick = () => { setSongDb(0); render(); };
  q('#vpNorm').onchange = (e) => { P.get('vol').norm = e.target.checked; P.save(); applySound(); toast(e.target.checked ? 'normalizar: on' : 'normalizar: off', { ms: 1400 }); };
  q('#eqOn').onchange = (e) => { eq.on = e.target.checked; save(); };
  $$('[data-band]', pop()).forEach((r) => (r.oninput = () => { const i = +r.dataset.band; eq.bands[i] = +r.value; eq.preset = ''; q('#eqV' + i).textContent = (r.value > 0 ? '+' : '') + r.value; save(true); }));
  $$('[data-eq]', pop()).forEach((r) => (r.oninput = () => {
    const k = r.dataset.eq; eq[k] = k === 'balance' ? +r.value / 100 : +r.value;
    pop().querySelector(`[data-eqv="${k}"]`).textContent = k === 'balance' ? balTxt(eq[k]) : fmtDb(eq[k]); save(true);
  }));
  $$('[data-pre]', pop()).forEach((b) => (b.onclick = () => { eq.bands = PRESETS[b.dataset.pre].slice(); eq.preset = b.dataset.pre; save(); render(); }));
  $$('[data-cpre]', pop()).forEach((b) => {
    b.onclick = () => { const c = custom[b.dataset.cpre]; Object.assign(eq, { bands: c.bands.slice(), bass: c.bass, treble: c.treble, preamp: c.preamp, preset: b.dataset.cpre }); save(); render(); };
    b.oncontextmenu = (e) => { e.preventDefault(); delete custom[b.dataset.cpre]; eq.custom = custom; save(); render(); toast('preset borrado'); };
  });
  q('#eqSave').onclick = async () => {
    const name = await prompt2('Guardar preset', 'Nombre del preset:', eq.preset && !PRESETS[eq.preset] ? eq.preset : '');
    if (!name) return;
    eq.custom = { ...custom, [name.slice(0, 24)]: { bands: eq.bands.slice(), bass: eq.bass, treble: eq.treble, preamp: eq.preamp } };
    eq.preset = name.slice(0, 24); save(); render(); toggleVolPop(true); toast('preset guardado ★');
  };
  q('#eqReset').onclick = () => { Object.assign(eq, { bands: PRESETS.plano.slice(), bass: 0, treble: 0, balance: 0, preamp: 0, preset: 'plano' }); save(); render(); };
}
const balTxt = (b) => (Math.abs(b) < 0.03 ? 'centro' : (b < 0 ? 'L ' : 'R ') + Math.round(Math.abs(b) * 100));
function save(light) {
  P.save();
  engine.setEq(P.get('eq'));
  if (!light) $$('[data-pre],[data-cpre]', pop()).forEach((b) => b.classList.toggle('on', (b.dataset.pre || b.dataset.cpre) === P.get('eq').preset));
}
bus.on('vol', () => { if (!open) return; const v = P.get('vol'); const m = $('#vpM'); if (m) m.textContent = v.muted ? 'mute' : Math.round(v.master * 100) + '%'; });
bus.on('np', () => { if (open) render(); });
document.addEventListener('mousedown', (e) => { if (open && !e.target.closest('#volPop,#tVol,.modal')) toggleVolPop(false); });
