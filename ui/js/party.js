// escuchar juntos: una sala con código; el anfitrión elige la música y los demás escuchan lo mismo, sincronizado,
// cada uno en su casa, con chat y pedidos de canciones.
// - las PCs/celulares se conectan directo entre sí (WebRTC). Para presentarse usan ntfy.sh (servicio gratis de
//   mensajes), con los mensajes cifrados (AES-GCM) con el código de la sala: ntfy no puede leer nada.
// - cada uno escucha la canción desde YouTube Music en su propio Petalwave (no se reenvía audio).
import { P, api, bus, toast, modal, esc, prompt2, $ } from './core.js';
import { T, remoteTrack } from './data.js';
import { engine } from './audio.js';
import * as player from './player.js';

const NTFY = 'https://ntfy.sh/';
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let party = null;   // { role, code, me, name, key, topic, es, peers: Map, members: Map, chat: [] }

// ---------- cifrado y señal ----------
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function derive(code) {
  const raw = new TextEncoder().encode('petalwave-party:' + code.toUpperCase());
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', raw));
  const topic = 'pw' + [...h.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const key = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', new TextEncoder().encode('k:' + b64(h))), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { topic, key };
}
async function seal(obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, party.key, new TextEncoder().encode(JSON.stringify(obj))));
  const out = new Uint8Array(iv.length + ct.length); out.set(iv); out.set(ct, iv.length);
  return b64(out);
}
async function open(s) {
  try { const u = unb64(s); const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, party.key, u.slice(12)); return JSON.parse(new TextDecoder().decode(pt)); } catch { return null; }
}
const signal = async (obj) => fetch(NTFY + party.topic, { method: 'POST', body: await seal(obj), headers: { Cache: 'no', Firewall: 'no' } });
function listen(onMsg) {
  const es = new EventSource(NTFY + party.topic + '/sse');
  es.onmessage = async (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (m.event !== 'message' || !m.message) return; const o = await open(m.message); if (o) onMsg(o); };
  return es;
}
const waitIce = (pc) => new Promise((ok) => {
  if (pc.iceGatheringState === 'complete') return ok();
  const t = setTimeout(ok, 2500);
  pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); ok(); } });
});

// ---------- sala ----------
const code6 = () => { const r = crypto.getRandomValues(new Uint8Array(8)); return [...r].map((b) => ALPHA[b % ALPHA.length]).join('').replace(/^(.{4})/, '$1-'); };
const rid = () => b64(crypto.getRandomValues(new Uint8Array(6))).replace(/[^\w]/g, 'x');
export const inParty = () => !!party;
export const partyRole = () => party && party.role;

async function askName() {
  let n = P.get('partyName');
  if (!n) { n = await prompt2('Escuchar juntos', '¿Cómo te llamás? (lo ven los demás)', ''); if (!n) return null; n = n.trim().slice(0, 24); P.set('partyName', n); }
  return n;
}

export async function createParty() {
  const name = await askName(); if (!name) return;
  const code = code6();
  party = { role: 'host', code, me: 'h' + rid(), name, peers: new Map(), members: new Map(), chat: [], ...(await derive(code)) };
  party.members.set(party.me, name);
  party.es = listen(onHostSignal);
  renderPanel();
  sysMsg(`sala creada: pasales el código ${code} a tus amigos`);
  toast('👥 sala creada', { sub: 'código ' + code + ' · lo que pongas lo escuchan todos', ms: 4000 });
}

async function onHostSignal(m) {
  if (!party || party.role !== 'host' || m.t !== 'offer' || !m.from || party.peers.has(m.from)) return;
  if (party.peers.size >= 12) return;
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const peer = { pc, ch: null, name: String(m.name || 'alguien').slice(0, 24) };
  party.peers.set(m.from, peer);
  pc.ondatachannel = (e) => { peer.ch = e.channel; wire(m.from, peer); };
  pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) dropPeer(m.from); };
  await pc.setRemoteDescription(m.sdp);
  await pc.setLocalDescription(await pc.createAnswer());
  await waitIce(pc);
  await signal({ t: 'answer', to: m.from, sdp: pc.localDescription });
}

export async function joinParty(code) {
  code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})/, '$1-');
  if (code.length !== 9) return toast('el código tiene 8 letras y números (como ABCD-1234)', { kind: 'warn' });
  const name = await askName(); if (!name) return;
  party = { role: 'guest', code, me: 'g' + rid(), name, peers: new Map(), members: new Map(), chat: [], ...(await derive(code)) };
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const host = { pc, ch: pc.createDataChannel('party', { ordered: true }), name: 'anfitrión' };
  party.peers.set('host', host);
  wire('host', host);
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') { toast('no se pudo conectar directo con la sala', { kind: 'err', sub: 'algunas redes (de empresas, datos móviles) lo bloquean; probá con otra WiFi' }); leaveParty(true); } };
  let answered = false;
  party.es = listen(async (m) => { if (m.t === 'answer' && m.to === party.me && !answered) { answered = true; await pc.setRemoteDescription(m.sdp); } });
  renderPanel();
  sysMsg('buscando la sala ' + code + '…');
  await new Promise((r) => setTimeout(r, 1200));   // que la suscripción quede abierta antes de llamar
  await pc.setLocalDescription(await pc.createOffer());
  await waitIce(pc);
  await signal({ t: 'offer', from: party.me, name, sdp: pc.localDescription });
  setTimeout(() => { if (party && party.role === 'guest' && !answered) { toast('no encontré esa sala', { kind: 'err', sub: '¿el código está bien? ¿el que la creó sigue con Petalwave abierto?' }); leaveParty(true); } }, 25000);
}

function wire(id, peer) {
  const ch = peer.ch;
  ch.onopen = () => {
    if (!party) return;
    if (party.role === 'guest') { send(ch, { t: 'join', name: party.name }); party.es && party.es.close(); party.es = null; sysMsg('conectado a la sala ✓ · el anfitrión elige la música'); }
    else { party.members.set(id, peer.name); send(ch, { t: 'welcome', members: [...party.members.values()], chat: party.chat.slice(-30) }); hostNp(ch); broadcastMembers(); sysMsg(peer.name + ' entró', true); }
    renderPanel();
  };
  ch.onclose = () => { if (party && party.role === 'host') dropPeer(id); else if (party) { toast('se cerró la sala', { kind: 'warn' }); leaveParty(true); } };
  ch.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onPeer(id, peer, m); };
}
const send = (ch, o) => { try { if (ch && ch.readyState === 'open') ch.send(JSON.stringify(o)); } catch {} };
const toAll = (o, except) => { if (!party) return; for (const [id, p] of party.peers) if (id !== except) send(p.ch, o); };
function dropPeer(id) {
  if (!party) return;
  const p = party.peers.get(id); if (!p) return;
  party.peers.delete(id);
  try { p.pc.close(); } catch {}
  if (party.members.has(id)) { party.members.delete(id); sysMsg(p.name + ' se fue', true); broadcastMembers(); }
  renderPanel();
}
const broadcastMembers = () => toAll({ t: 'members', members: [...party.members.values()] });

// ---------- mensajes ----------
async function onPeer(id, peer, m) {
  if (!party) return;
  if (party.role === 'host') {
    if (m.t === 'join') { peer.name = String(m.name || peer.name).slice(0, 24); party.members.set(id, peer.name); broadcastMembers(); renderPanel(); }
    if (m.t === 'chat') chat(peer.name, m.text, true);
    if (m.t === 'req') request(peer.name, String(m.q || '').slice(0, 120));
    return;
  }
  if (m.t === 'welcome') { party.members = new Map(m.members.map((n, i) => [i, n])); party.chat = (m.chat || []).slice(-30); renderPanel(); }
  if (m.t === 'members') { party.members = new Map(m.members.map((n, i) => [i, n])); renderPanel(); }
  if (m.t === 'chat') { party.chat.push({ who: m.who, text: m.text, sys: m.sys }); renderChat(); if (!m.sys && m.who !== party.name) notifyChat(m.who, m.text); }
  if (m.t === 'np') follow(m);
}

// el anfitrión cuenta qué suena (al cambiar y cada 5 s)
function npMsg() {
  const t = player.current();
  if (!t) return { t: 'np', ytId: '' };
  return { t: 'np', ytId: t.ytId || '', title: t.title, artist: t.artist || '', dur: t.duration || engine.duration || 0, pos: engine.time || 0, playing: !engine.paused };
}
const hostNp = (ch) => send(ch, npMsg());
let warnedLocal = '';
async function follow(m) {
  party.npText = m.title ? `♪ ${m.title} — ${m.artist}` : 'el anfitrión no está reproduciendo nada';
  const box = $('#partyNp'); if (box) box.textContent = party.npText;
  if (!m.ytId) { if (m.title && warnedLocal !== m.title) { warnedLocal = m.title; toast('el anfitrión puso un archivo de su PC', { sub: '«' + m.title + '» no está en YouTube Music: no se puede escuchar juntos', kind: 'warn' }); } return; }
  const id = 'yt_' + m.ytId;
  if (!T(id)) remoteTrack({ videoId: m.ytId, title: m.title, artists: [m.artist], duration: m.dur });
  const cur = player.current();
  const want = (m.pos || 0) + 0.4;   // un poquito más por lo que tarda el mensaje
  if (!cur || cur.id !== id) { player.playList([id], 0); setTimeout(() => { if (Math.abs(engine.time - want) > 2) engine.seek(want + 1.5); if (!m.playing && !engine.paused) player.toggle(); }, 1500); return; }
  if (m.playing === engine.paused) player.toggle();
  if (m.playing && Math.abs(engine.time - want) > 2.5) engine.seek(want);
}

function chat(who, text, relay) {
  text = String(text || '').trim().slice(0, 300); if (!text) return;
  const msg = { t: 'chat', who, text };
  party.chat.push({ who, text }); renderChat();
  if (party.role === 'host') toAll(msg);
  if (who !== party.name) notifyChat(who, text);
  void relay;
}
function sysMsg(text, share) {
  if (!party) return;
  party.chat.push({ who: '', text, sys: true }); renderChat();
  if (share && party.role === 'host') toAll({ t: 'chat', who: '', text, sys: true });
}
function notifyChat(who, text) { if (!$('#party') || $('#party').classList.contains('min')) toast('💬 ' + who, { sub: text, ms: 3000 }); }

// pedidos: el anfitrión busca en YouTube Music y la pone después de la actual
async function request(who, q) {
  if (!q) return;
  try {
    const j = await api.get('/api/ytm/search?filter=songs&q=' + encodeURIComponent(q));
    const it = (j.items || []).find((x) => x.videoId);
    if (!it) { sysMsg(`${who} pidió «${q}», pero no la encontré`, true); return; }
    const t = T('yt_' + it.videoId) || remoteTrack(it);
    player.playNext([t.id]);
    sysMsg(`${who} pidió «${t.title}» — ${t.artist}: suena después de esta`, true);
  } catch { sysMsg(`${who} pidió «${q}» (no pude buscarla)`, true); }
}

export function leaveParty(quiet) {
  if (!party) return;
  if (party.role === 'host') toAll({ t: 'chat', who: '', text: 'el anfitrión cerró la sala', sys: true });
  for (const p of party.peers.values()) { try { p.ch && p.ch.close(); } catch {} try { p.pc.close(); } catch {} }
  try { party.es && party.es.close(); } catch {}
  party = null;
  renderPanel();
  if (!quiet) toast('saliste de la sala');
}

// ---------- panel ----------
function renderPanel() {
  let el = $('#party');
  if (!party) { if (el) el.remove(); $('#tParty') && $('#tParty').classList.remove('on'); return; }
  if (!el) { el = document.createElement('div'); el.id = 'party'; document.body.appendChild(el); }
  $('#tParty') && $('#tParty').classList.add('on');
  const host = party.role === 'host';
  el.innerHTML = `<header><b>👥 ${host ? 'tu sala' : 'en la sala'}</b><code title="copiar código">${esc(party.code)}</code><span class="sp"></span><button class="ico" data-pa="min" title="achicar">–</button><button class="ico" data-pa="leave" title="salir">✕</button></header>
    <div class="pbody">
      <div class="pmem">${[...party.members.values()].map((n) => `<span>${esc(n)}</span>`).join('') || '<span class="m">esperando…</span>'}</div>
      ${host ? '<div class="m">lo que pongas lo escuchan todos</div>' : `<div class="m" id="partyNp">${esc(party.npText || 'esperando al anfitrión…')}</div>`}
      <div class="pchat" id="partyChat"></div>
      <form class="pin"><input id="partyIn" maxlength="300" placeholder="${host ? 'escribí algo…' : 'escribí, o «/pedir canción» para pedir una'}" autocomplete="off"><button class="go" type="submit">↵</button></form>
    </div>`;
  el.querySelector('code').onclick = () => navigator.clipboard.writeText(party.code).then(() => toast('código copiado'));
  el.querySelector('[data-pa="leave"]').onclick = () => leaveParty();
  el.querySelector('[data-pa="min"]').onclick = () => el.classList.toggle('min');
  el.querySelector('form').onsubmit = (e) => {
    e.preventDefault();
    const inp = $('#partyIn'), text = inp.value.trim(); inp.value = '';
    if (!text) return;
    const req = /^\/(pedir|pido|p)\s+(.+)/i.exec(text);
    if (req) {
      if (host) return request(party.name, req[2]);
      send(party.peers.get('host').ch, { t: 'req', q: req[2] }); sysMsg('pediste «' + req[2] + '»'); return;
    }
    if (host) chat(party.name, text);
    else send(party.peers.get('host').ch, { t: 'chat', text });
  };
  renderChat();
}
function renderChat() {
  const c = $('#partyChat'); if (!c || !party) return;
  c.innerHTML = party.chat.slice(-60).map((m) => m.sys ? `<div class="psys">${esc(m.text)}</div>` : `<div><b>${esc(m.who)}</b> ${esc(m.text)}</div>`).join('');
  c.scrollTop = c.scrollHeight;
}

export async function openParty() {
  if (party) { const el = $('#party'); if (el) el.classList.remove('min'); return; }
  const r = await modal({
    title: '👥 escuchar juntos',
    html: `<p>Escuchen la misma música al mismo tiempo, cada uno en su casa, con chat.</p>
      <p class="m">El que crea la sala elige la música; los demás entran con el código y pueden pedir canciones. Cada uno la escucha desde YouTube Music en su Petalwave (las canciones que son archivos de tu PC no se pueden compartir).</p>
      <div class="cfrow"><span>tengo un código</span><input id="pcode" class="inp" style="width:130px;text-transform:uppercase" placeholder="ABCD-1234" maxlength="9"></div>`,
    actions: [{ label: 'cancelar', value: null }, { label: 'unirme', fn: (box) => 'join:' + box.querySelector('#pcode').value }, { label: 'crear una sala', primary: true, value: 'create' }],
  });
  if (r === 'create') createParty();
  else if (typeof r === 'string' && r.startsWith('join:')) joinParty(r.slice(5));
}

export function initParty() {
  // botón de la barra de arriba
  const at = $('[data-act="recognize"]');
  if (at && !$('#tParty')) {
    const b = document.createElement('button');
    b.className = 'mod ico'; b.id = 'tParty'; b.title = 'escuchar juntos (con amigos, cada uno en su casa)';
    b.innerHTML = '👥<span class="hide-m">juntos</span>';
    b.onclick = () => openParty();
    at.after(b);
  }
  // el anfitrión avisa qué suena
  let npT = 0;
  const push = () => { if (!party || party.role !== 'host') return; clearTimeout(npT); npT = setTimeout(() => toAll(npMsg()), 300); };
  for (const ev of ['np', 'eng:state', 'eng:seek']) bus.on(ev, push);
  setInterval(() => { if (party && party.role === 'host' && !engine.paused) toAll(npMsg()); }, 5000);
  addEventListener('beforeunload', () => leaveParty(true));
}
