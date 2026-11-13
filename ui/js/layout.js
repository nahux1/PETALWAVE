// mover ventanas: mantené apretado (medio segundo) sobre una ventana y arrastrala.
//  · soltala en la columna del costado → cambia de orden
//  · soltala en cualquier otro lugar → queda flotando ahí (se puede agrandar desde la esquina)
//  · arrastrá la ventana principal al otro lado → el panel cambia de lado
//  · doble clic en el título de una ventana flotante → vuelve a su lugar
// Se guarda en las preferencias (P.layout) y se restablece en ajustes → diseño.
import { $, $$, P, bus, toast, debounce } from './core.js';
import { C, setC } from './custom.js';

const WINS = { np: '#np', viz: '#vizWin', tabs: '#sideTabs' };
const NAMES = { np: 'reproductor', viz: 'visualizador', tabs: 'cola y letra', main: 'ventana principal' };
const HOLD_MS = 450, MOVE_TOL = 8;
const DEF = { order: ['np', 'viz', 'tabs'], float: {} };

const L = () => {
  const l = P.get('layout') || {};
  const order = (Array.isArray(l.order) ? l.order : []).filter((k) => WINS[k]);
  for (const k of DEF.order) if (!order.includes(k)) order.push(k);
  return { order, float: { ...(l.float || {}) } };
};
const save = (l) => { P.all().layout = l; P.save(); };
const saveSoon = debounce(save, 400);
const narrow = () => innerWidth < 980;
const keyOf = (el) => Object.keys(WINS).find((k) => el.matches(WINS[k])) || (el.id === 'wsa' ? 'main' : null);

let layer;   // contenedor de las ventanas flotantes
const ro = new ResizeObserver((ents) => {
  if (drag) return;
  const l = L(); let changed = false;
  for (const e of ents) {
    const k = keyOf(e.target); const f = k && l.float[k];
    if (!f || !e.target.classList.contains('floating')) continue;
    const r = e.target.getBoundingClientRect();
    if (Math.abs(r.width - f.w) > 2 || Math.abs(r.height - f.h) > 2) { f.w = Math.round(r.width); f.h = Math.round(r.height); changed = true; }
  }
  if (changed) saveSoon(l);
});

// dejar todo como dice P.layout
export function applyLayout() {
  const l = L(), side = $('#side');
  for (const k of l.order) {
    const el = $(WINS[k]); if (!el) continue;
    const f = !narrow() && l.float[k];
    if (f) {
      if (el.parentElement !== layer) layer.appendChild(el);
      el.classList.add('floating');
      const w = Math.min(f.w, innerWidth - 20), h = Math.min(f.h, innerHeight - 20);
      Object.assign(el.style, { width: w + 'px', height: h + 'px', left: Math.max(6, Math.min(f.x, innerWidth - w - 6)) + 'px', top: Math.max(56, Math.min(f.y, innerHeight - h - 6)) + 'px' });
      ro.observe(el);
    } else {
      el.classList.remove('floating'); ro.unobserve(el);
      for (const p of ['width', 'height', 'left', 'top', 'zIndex']) el.style[p] = '';
      side.appendChild(el);   // en orden: cada uno va al final, así quedan como en l.order
    }
  }
  const docked = l.order.filter((k) => !(l.float[k] && !narrow())).map((k) => $(WINS[k])).filter((el) => el && getComputedStyle(el).display !== 'none');
  document.body.classList.toggle('side-empty', docked.length === 0);
  bus.emit('layout');
}

// ---------- arrastre ----------
let hold = null, drag = null;
const INTERACTIVE = 'button,a,input,select,textarea,label,[draggable="true"],.seek,.vol,.row,.qrow,.yrow,.card,.ln,.kv,.cfgsec,.lnav,.lbody,.ylist,[contenteditable]';

function startHold(e) {
  if (e.button !== 0 || P.get('layoutLock') || narrow()) return;
  const win = e.target.closest('#np,#vizWin,#sideTabs,#wsa');
  if (!win) return;
  const onLabel = !!e.target.closest('.lbl');
  // en la ventana principal solo se agarra del título (adentro hay listas, botones, ajustes…)
  if (win.id === 'wsa' && !onLabel) return;
  if (!onLabel && e.target.closest(INTERACTIVE)) return;
  if (win.classList.contains('floating')) win.style.zIndex = String(++zTop);
  hold = { win, x: e.clientX, y: e.clientY, t: setTimeout(() => begin(e), HOLD_MS) };
  win.classList.add('w-hold');
}
function cancelHold() { if (hold) { clearTimeout(hold.t); hold.win.classList.remove('w-hold'); hold = null; } }
let zTop = 30;

function begin(e) {
  const win = hold.win; cancelHold();
  const target = win.id === 'wsa' ? win.querySelector('.ws:not([hidden])') || win : win;
  const r = target.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.className = 'w-ghost';
  ghost.innerHTML = `<b>${NAMES[keyOf(win)]}</b><span>${win.id === 'wsa' ? 'soltala del otro lado para cambiar el panel de lado' : 'soltala en el costado para ordenarla, o en cualquier lugar para dejarla flotando'}</span>`;
  Object.assign(ghost.style, { width: r.width + 'px', height: r.height + 'px', left: r.left + 'px', top: r.top + 'px' });
  document.body.appendChild(ghost);
  const ph = document.createElement('div'); ph.className = 'w-place';
  drag = { win, key: keyOf(win), ghost, ph, dx: hold ? 0 : e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height, x: e.clientX, y: e.clientY };
  drag.dx = e.clientX - r.left;
  document.body.classList.add('win-drag');
  win.classList.add('w-dragging');
  if (navigator.vibrate) navigator.vibrate(15);
  move(e);
}

// dónde caería la ventana si la soltás acá
function dropTarget(x, y, d = drag) {
  const side = $('#side'), sr = side.getBoundingClientRect(), shell = $('#shell').getBoundingClientRect();
  if (d.key === 'main') {
    const sideOnRight = !C().sideLeft;
    const swap = sideOnRight ? x > shell.left + shell.width * 0.62 : x < shell.left + shell.width * 0.38;
    return { type: swap ? 'swap' : 'none' };
  }
  const inSide = !document.body.classList.contains('side-empty')
    ? x >= sr.left - 40 && x <= sr.right + 40 && y >= sr.top - 20 && y <= sr.bottom + 20
    : (C().sideLeft ? x < shell.left + 120 : x > shell.right - 120);
  if (inSide) {
    const items = [...side.children].filter((c) => c !== d.win && c !== d.ph && c.classList.contains('w') && getComputedStyle(c).display !== 'none');
    let idx = items.length;
    for (let i = 0; i < items.length; i++) { const b = items[i].getBoundingClientRect(); if (y < b.top + b.height / 2) { idx = i; break; } }
    return { type: 'dock', idx, before: items[idx] || null };
  }
  return { type: 'float' };
}

function move(e) {
  if (hold && !drag) { if (Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > MOVE_TOL) cancelHold(); return; }
  if (!drag) return;
  e.preventDefault();
  drag.x = e.clientX; drag.y = e.clientY;
  const t = dropTarget(e.clientX, e.clientY);
  drag.ghost.style.left = e.clientX - drag.dx + 'px';
  drag.ghost.style.top = e.clientY - drag.dy + 'px';
  drag.ghost.dataset.t = t.type;
  if (t.type === 'dock') { const side = $('#side'); drag.ph.style.height = Math.min(drag.h, 120) + 'px'; t.before ? side.insertBefore(drag.ph, t.before) : side.appendChild(drag.ph); }
  else drag.ph.remove();
  $('#shell').dataset.swap = t.type === 'swap' ? '1' : '';
}

function end(cancel) {
  if (hold) cancelHold();
  if (!drag) return;
  const d = drag;
  const t = cancel ? { type: 'none' } : dropTarget(d.x, d.y, d);
  drag = null;
  d.ghost.remove(); d.ph.remove();
  document.body.classList.remove('win-drag'); d.win.classList.remove('w-dragging');
  $('#shell').dataset.swap = '';
  if (t.type === 'none') return;
  if (t.type === 'swap') { setC('sideLeft', !C().sideLeft); toast('panel del ' + (C().sideLeft ? 'lado izquierdo' : 'lado derecho'), { ms: 1400 }); return; }
  const l = L();
  if (t.type === 'dock') {
    delete l.float[d.key];
    const order = l.order.filter((k) => k !== d.key);
    const beforeKey = t.before ? keyOf(t.before) : null;
    order.splice(beforeKey ? order.indexOf(beforeKey) : order.length, 0, d.key);
    l.order = order;
  } else {
    const w = Math.max(260, Math.min(d.w, innerWidth - 40)), h = Math.max(140, Math.min(d.h, innerHeight - 80));
    l.float[d.key] = { x: Math.round(d.x - d.dx), y: Math.round(d.y - d.dy), w: Math.round(w), h: Math.round(h) };
    if (!P.get('layoutTip')) { P.set('layoutTip', 1); toast('ventana flotante', { sub: 'agrandala desde la esquina · doble clic en su título para devolverla', ms: 4000 }); }
  }
  save(l); applyLayout();
}

export function resetLayout() { save({ ...DEF, float: {} }); applyLayout(); toast('ventanas en su lugar original', { ms: 1500 }); }

export function initLayout() {
  layer = document.createElement('div'); layer.id = 'floatLayer'; document.body.appendChild(layer);
  document.addEventListener('pointerdown', startHold, true);
  addEventListener('pointermove', move, { passive: false });
  addEventListener('pointerup', () => end(false));
  addEventListener('pointercancel', () => end(true));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && drag) { e.stopPropagation(); end(true); } }, true);
  addEventListener('blur', () => end(true));
  // doble clic en el título de una ventana flotante: vuelve al costado
  document.addEventListener('dblclick', (e) => {
    const lbl = e.target.closest('.floating > .lbl'); if (!lbl) return;
    const k = keyOf(lbl.parentElement); const l = L(); delete l.float[k]; save(l); applyLayout();
  });
  for (const sel of [...Object.values(WINS), '#wsa']) { const lb = $(sel + ' > .lbl') || (sel === '#wsa' ? null : null); if (lb) lb.title = 'mantené apretado para mover esta ventana'; }
  $$('#wsa .ws > .lbl').forEach((lb) => (lb.title = 'mantené apretado para cambiar el panel de lado'));
  addEventListener('resize', debounce(applyLayout, 200));
  bus.on('custom', () => applyLayout());
  applyLayout();
}
