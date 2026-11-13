// núcleo de la interfaz: utilidades, API, eventos en vivo, preferencias, puente con la ventana nativa y componentes base
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
};
export const fmtLong = (s) => {
  s = Math.round(s || 0);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
};
export const fmtSize = (b) => (b > 1e9 ? (b / 1073741824).toFixed(1) + ' GiB' : b > 1e6 ? (b / 1048576).toFixed(1) + ' MiB' : Math.round(b / 1024) + ' KiB');
export const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const ago = (t) => {
  if (!t) return 'nunca';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'recién' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`;
};
export const icon = (name, cls = '') => `<svg class="i ${cls}"><use href="#i-${name}"/></svg>`;
// pistas locales: id de 16 hex · pistas online de YouTube Music: "yt_<videoId>"
export const isRemote = (id) => typeof id === 'string' && id.startsWith('yt_');
// size: 't' (128 px, filas) o 'm' (256 px, tarjetas). Solo si "carátulas livianas" está activado (por defecto sí)
export const coverUrl = (id, size) => {
  const base = isRemote(id) ? `/ytcover/${id.slice(3)}` : `/cover/${id}`;
  return size && P.get('thumbs') !== false ? base + '?s=' + size : base;
};
// miniaturas de Google (YouTube Music): se piden directamente del tamaño en que se muestran
export const thumbUrl = (u, px = 120) => (u && P.get('thumbs') !== false ? String(u).replace(/=w\d+-h\d+[^&?#]*/, `=w${px}-h${px}-l90-rj`) : u);
export const mediaUrl = (id) => (isRemote(id) ? `/stream/${id.slice(3)}` : `/media/${id}`);

// ---------- API ----------
async function req(method, url, body, headers) {
  const opt = { method, headers: headers || {} };
  if (body !== undefined) {
    if (body instanceof Blob || typeof body === 'string') opt.body = body;
    else { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
  }
  const r = await fetch(url, opt);
  let j = null;
  try { j = await r.json(); } catch {}
  if (!r.ok) throw new Error((j && j.error) || `error ${r.status}`);
  return j;
}
export const api = {
  get: (u) => req('GET', u),
  post: (u, b = {}) => req('POST', u, b),
  del: (u) => req('DELETE', u),
  raw: (u, blob, headers) => req('POST', u, blob, headers),
};

// ---------- bus de eventos ----------
const handlers = new Map();
export const bus = {
  on(t, fn) { if (!handlers.has(t)) handlers.set(t, new Set()); handlers.get(t).add(fn); return () => handlers.get(t).delete(fn); },
  emit(t, d) { const h = handlers.get(t); if (h) for (const fn of [...h]) { try { fn(d); } catch (e) { console.error(t, e); } } },
};

// eventos del servidor (una sola conexión para todo)
export function connectStream() {
  const es = new EventSource('/api/stream');
  for (const t of ['dl', 'dllog', 'dlfile', 'scan', 'library', 'sync', 'cookies', 'spotify', 'update']) {
    es.addEventListener(t, (e) => { try { bus.emit('sse:' + t, JSON.parse(e.data)); } catch {} });
  }
  es.onopen = () => bus.emit('sse:open');
  return es;
}

// ---------- almacenamiento local seguro ----------
export const local = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ---------- preferencias (se guardan en el servidor: no se pierden si cambia la ventana) ----------
export const DEFAULT_SHORTCUTS = {
  toggle: 'Space', next: 'n', prev: 'p', fwd: 'ArrowRight', back: 'ArrowLeft', fwdLong: 'Shift+ArrowRight', backLong: 'Shift+ArrowLeft',
  volUp: 'ArrowUp', volDown: 'ArrowDown', mute: 'm', repeat: 'r', shuffle: 's', search: '/', vol: 'v', eq: 'e',
  full: 'f', mini: 'Shift+M', compact: 'k', theme: 't', dyn: 'c', viz: 'z', lyrics: 'l', queue: 'q', radio: 'Shift+R', peek: 'b',
  ws1: '1', ws2: '2', ws3: '3', ws4: '4', ws5: '5',
};
export const SHORTCUT_LABELS = {
  toggle: 'play / pausa', next: 'siguiente', prev: 'anterior', fwd: 'adelantar 10 s', back: 'retroceder 10 s', fwdLong: 'adelantar 30 s', backLong: 'retroceder 30 s',
  volUp: 'subir volumen', volDown: 'bajar volumen', mute: 'silenciar', repeat: 'repetir', shuffle: 'aleatorio', search: 'buscar', vol: 'panel de volumen', eq: 'ecualizador',
  full: 'pantalla completa', mini: 'mini reproductor', compact: 'modo compacto', theme: 'cambiar tema', dyn: 'colores de la carátula', viz: 'cambiar visualizador',
  lyrics: 'ver letra', queue: 'ver cola', radio: 'radio de la canción', peek: 'ver el fondo', ws1: 'música', ws2: 'descargas', ws3: 'sync', ws4: 'estadísticas', ws5: 'ajustes',
};
const DEFAULT_PREFS = {
  theme: 'blood', dyn: true, viz: 'spectrum', fps: 60, particles: 160, crossfade: 2, resume: true,
  notify: true, notifyToast: true, blur: true, anim: true, compact: false, sideTab: 'queue', ws: 'music',
  libView: 'songs', libSort: { key: 'added', dir: -1 },
  shortcuts: { ...DEFAULT_SHORTCUTS },
  vol: { master: 0.8, muted: false, norm: false, perSong: {} },
  eq: { on: true, preset: 'plano', bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bass: 0, treble: 0, balance: 0, preamp: 0, custom: {} },
  dl: { format: 'mp3', quality: '320', cookies: '', playlist: false },
};
let prefs = structuredClone(DEFAULT_PREFS);
const pushPrefs = debounce(() => api.post('/api/settings', { ui: prefs }).catch(() => {}), 800);
// al cerrar la ventana (o recargar) se manda lo pendiente en el momento, así no se pierde el último cambio
addEventListener('pagehide', () => { try { navigator.sendBeacon('/api/settings', new Blob([JSON.stringify({ ui: prefs })], { type: 'application/json' })); } catch {} });
export const P = {
  async load(server) {
    const saved = (server && server.ui && Object.keys(server.ui).length ? server.ui : null) || local.get('pw-prefs') || {};
    prefs = { ...structuredClone(DEFAULT_PREFS), ...saved };
    prefs.shortcuts = { ...DEFAULT_SHORTCUTS, ...(saved.shortcuts || {}) };
    prefs.vol = { ...DEFAULT_PREFS.vol, ...(saved.vol || {}) };
    prefs.eq = { ...DEFAULT_PREFS.eq, ...(saved.eq || {}) };
    prefs.dl = { ...DEFAULT_PREFS.dl, ...(saved.dl || {}) };
    if (!Array.isArray(prefs.eq.bands) || prefs.eq.bands.length !== 10) prefs.eq.bands = DEFAULT_PREFS.eq.bands.slice();
  },
  get: (k) => prefs[k],
  all: () => prefs,
  set(k, v) { prefs[k] = v; this.save(); },
  save() { local.set('pw-prefs', prefs); pushPrefs(); },
};

// ---------- puente con la ventana nativa (WebView2) ----------
const wv = window.chrome && window.chrome.webview;
const pending = new Map();
let reqN = 0;
if (wv) wv.addEventListener('message', (e) => {
  const m = String(e.data || '');
  if (m.startsWith('picked:')) {
    const rest = m.slice(7), i = rest.indexOf(':');
    const id = rest.slice(0, i), p = rest.slice(i + 1);
    const fn = pending.get(id); if (fn) { pending.delete(id); fn(p || null); }
  } else if (m.startsWith('cmd:')) bus.emit('host:cmd', m.slice(4));
  else if (m.startsWith('login:')) bus.emit('host:login', m.slice(6));
  else if (m.startsWith('win:')) bus.emit('host:win', m.slice(4));
});
export const host = {
  native: !!wv,
  send(msg) { if (wv) wv.postMessage(msg); },
  async pickFolder(title = 'Elegí una carpeta') {
    if (wv) return new Promise((ok) => { const id = String(++reqN); pending.set(id, ok); wv.postMessage(`pick:${id}:${title}`); });
    const p = await prompt2('Carpeta', 'Escribí la ruta completa de la carpeta:', '');
    return p || null;
  },
};

// ---------- avisos ----------
export function toast(msg, opts = {}) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + (opts.kind || '');
  el.innerHTML = (opts.img ? `<img src="${esc(opts.img)}" onerror="this.remove()">` : '') +
    (opts.sub ? `<div><div class="tt">${esc(msg)}</div><div class="ts">${esc(opts.sub)}</div></div>` : `<div>${esc(msg)}</div>`);
  box.appendChild(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, opts.ms || 2800);
}

// ---------- aviso flotante al usar atajos (icono + texto + barra opcional) ----------
export function osd(iconName, text, bar) {
  const el = $('#osd'); if (!el) return;
  el.querySelector('use').setAttribute('href', '#i-' + iconName);
  el.querySelector('span').textContent = text;
  el.classList.toggle('bar', bar != null);
  if (bar != null) el.querySelector('.osdbar b').style.width = Math.max(0, Math.min(100, bar)) + '%';
  el.classList.add('on');
  clearTimeout(osd.t); osd.t = setTimeout(() => el.classList.remove('on'), 850);
}

// ---------- ventana modal ----------
export function modal({ title, html, actions = [], onOpen, wide }) {
  return new Promise((done) => {
    const m = $('#modal'), box = $('#mbox');
    box.style.width = wide ? 'min(760px,calc(100vw - 30px))' : '';
    box.innerHTML = `<h3>${esc(title)}</h3><div class="mb">${html || ''}</div><div class="mact">${actions.map((a, i) => `<button class="${a.primary ? 'go' : 'cb'} ${a.danger ? 'danger' : ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>`;
    m.hidden = false;
    const close = (v) => { m.hidden = true; document.removeEventListener('keydown', key, true); done(v); };
    const key = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { const p = actions.findIndex((a) => a.primary); if (p >= 0) { e.preventDefault(); e.stopPropagation(); box.querySelector(`[data-i="${p}"]`).click(); } }
    };
    document.addEventListener('keydown', key, true);
    box.querySelectorAll('.mact button').forEach((b) => (b.onclick = async () => {
      const a = actions[+b.dataset.i];
      // un botón sin acción ("ahora no", "cancelar") siempre cierra y devuelve su valor;
      // uno con acción puede devolver false para que la ventana quede abierta (p. ej. mientras actualiza)
      if (!a.fn) return close(a.value === undefined ? true : a.value);
      const v = await a.fn(box);
      if (v !== false) close(v === undefined ? true : v);
    }));
    m.onclick = (e) => { if (e.target === m) close(null); };
    if (onOpen) onOpen(box);
    const f = box.querySelector('input,textarea,select'); if (f) setTimeout(() => f.focus(), 30);
  });
}
export function prompt2(title, label, value = '') {
  return modal({
    title, html: `<div class="m" style="margin-bottom:8px">${esc(label)}</div><input type="text" id="p2" style="width:100%" value="${esc(value)}">`,
    actions: [{ label: 'cancelar', value: null }, { label: 'aceptar', primary: true, fn: (b) => b.querySelector('#p2').value.trim() || null }],
  });
}
export function confirm2(title, text, okLabel = 'aceptar', danger = false) {
  return modal({ title, html: `<div>${text}</div>`, actions: [{ label: 'cancelar', value: false }, { label: okLabel, primary: true, danger, value: true }] });
}

// ---------- menú contextual (con submenús) ----------
let ctxOpen = null;
export function ctxMenu(x, y, items) {
  closeCtx();
  const root = build(items);
  place(root, x, y);
  ctxOpen = root;
  function build(list, sub) {
    const el = document.createElement('div');
    el.className = 'ctx' + (sub ? ' sub' : '');
    for (const it of list) {
      if (!it) continue;
      if (it.sep) { el.insertAdjacentHTML('beforeend', '<div class="sepx"></div>'); continue; }
      if (it.header) { el.insertAdjacentHTML('beforeend', `<div class="hd2">${esc(it.header)}</div>`); continue; }
      const b = document.createElement('button');
      if (it.danger) b.className = 'danger';
      b.innerHTML = (it.icon ? icon(it.icon) : '<svg class="i"></svg>') + `<span${it.raw ? " data-raw" : ""}>${esc(it.label)}</span>` + (it.sub ? '<span class="k">▸</span>' : it.key ? `<span class="k">${esc(it.key)}</span>` : '');
      if (it.sub) {
        b.onmouseenter = b.onclick = (e) => {
          e.stopPropagation();
          el.querySelectorAll('button.open').forEach((o) => o.classList.remove('open'));
          document.querySelectorAll('.ctx.sub').forEach((s) => s.remove());
          b.classList.add('open');
          const s = build(typeof it.sub === 'function' ? it.sub() : it.sub, true);
          const r = b.getBoundingClientRect();
          place(s, r.right + 2, r.top - 5, r.left);
        };
      } else {
        b.onmouseenter = () => { el.querySelectorAll('button.open').forEach((o) => o.classList.remove('open')); if (!sub) document.querySelectorAll('.ctx.sub').forEach((s) => s.remove()); };
        b.onclick = (e) => { e.stopPropagation(); closeCtx(); it.fn && it.fn(); };
      }
      el.appendChild(b);
    }
    document.body.appendChild(el);
    return el;
  }
  function place(el, x, y, altX) {
    const r = el.getBoundingClientRect();
    let left = x, top = y;
    if (left + r.width > innerWidth - 6) left = (altX != null ? altX - r.width - 2 : innerWidth - r.width - 6);
    if (top + r.height > innerHeight - 6) top = Math.max(6, innerHeight - r.height - 6);
    el.style.left = Math.max(6, left) + 'px'; el.style.top = top + 'px';
  }
}
export function closeCtx() {
  document.querySelectorAll('.ctx').forEach((c) => { if (c.id === 'ctx') c.hidden = true; else c.remove(); });
  ctxOpen = null;
}
addEventListener('mousedown', (e) => { if (ctxOpen && !e.target.closest('.ctx')) closeCtx(); });
addEventListener('keydown', (e) => { if (ctxOpen && e.key === 'Escape') closeCtx(); }, true);
addEventListener('blur', closeCtx);
addEventListener('resize', closeCtx);
