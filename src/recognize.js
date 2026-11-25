// reconocer canciones ("¿qué suena?")
// 1) Propio, sin clave: la interfaz saca una huella del audio (ui/js/fingerprint.js, inspirado en SongRec) y acá se
//    consulta el catálogo de Shazam con esa huella, igual que SongRec. Solo viaja la huella, nunca la grabación.
//    Es un uso no oficial: si algún día deja de responder, queda AudD.
// 2) AudD (https://audd.io), opcional, con la clave de cada usuario: la interfaz manda la grabación y se reenvía a AudD.
//    La clave se guarda en data/audd.json (solo tu usuario de Windows puede leerla) y nunca vuelve a la interfaz.
'use strict';
const path = require('path');
const crypto = require('crypto');
const { JsonStore, privatize } = require('./util');

const API = 'https://api.audd.io/';

class Recognizer {
  constructor({ dataDir }) {
    this.file = path.join(dataDir, 'audd.json');
    this.store = new JsonStore(this.file, () => ({ token: '' }));
  }
  status() { const t = this.store.data.token || ''; return { configured: !!t, hint: t ? '…' + t.slice(-4) : '' }; }
  setToken(t) {
    t = String(t || '').trim();
    if (t && !/^[A-Za-z0-9]{16,64}$/.test(t)) throw new Error('Esa no parece una clave de AudD (son letras y números, la copiás de dashboard.audd.io)');
    this.store.data.token = t;
    this.store.save(true);
    privatize(this.file);
  }

  // huella propia → catálogo de Shazam (sin clave)
  async bySignature(sig, samplems) {
    const bytes = Buffer.from(String(sig || ''), 'base64');
    if (bytes.length < 56 || bytes.length > 200000 || bytes.readUInt32LE(0) !== 0xcafe2580) throw Object.assign(new Error('Huella de audio inválida'), { status: 400 });
    const ms = Math.max(1000, Math.min(20000, Math.round(+samplems) || 0));
    const now = Date.now();
    const body = { geolocation: { altitude: 300, latitude: 45, longitude: 2 }, signature: { samplems: ms, timestamp: now, uri: 'data:audio/vnd.shazam.sig;base64,' + bytes.toString('base64') }, timestamp: now, timezone: 'America/Argentina/Buenos_Aires' };
    const url = `https://amp.shazam.com/discovery/v5/en/US/android/-/tag/${crypto.randomUUID().toUpperCase()}/${crypto.randomUUID()}?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&video=v3`;
    let r;
    try {
      const res = await fetch(url, { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
        headers: { 'Content-Type': 'application/json', 'Content-Language': 'en_US', 'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 11; Pixel 4 Build/RQ3A.210805.001.A1)' } });
      if (!res.ok) throw new Error('respondió ' + res.status);
      r = await res.json();
    } catch (e) { throw new Error('No se pudo consultar el reconocedor (¿sin internet?): ' + e.message); }
    return parseShazam(r);
  }

  // audio: Buffer con unos segundos grabados (webm/ogg/mp4/wav)
  async recognize(audio, mime = 'audio/webm') {
    const token = this.store.data.token;
    if (!token) { const e = new Error('Falta tu clave de AudD: ajustes → cuentas → reconocer canciones'); e.code = 'NO_TOKEN'; throw e; }
    const form = new FormData();
    form.append('api_token', token);
    form.append('return', 'apple_music,spotify');
    form.append('file', new Blob([audio], { type: mime }), 'muestra.' + (/ogg/.test(mime) ? 'ogg' : /mp4|aac|m4a/.test(mime) ? 'm4a' : /wav/.test(mime) ? 'wav' : 'webm'));
    let r;
    try { r = await (await fetch(API, { method: 'POST', body: form, signal: AbortSignal.timeout(30000) })).json(); }
    catch (e) { throw new Error('No se pudo hablar con AudD (¿sin internet?): ' + e.message); }
    if (r.status === 'error') {
      const code = r.error && r.error.error_code;
      const msg = code === 900 || code === 901 ? 'Tu clave de AudD no es válida o se terminaron las consultas gratis'
        : code === 902 ? 'Se terminaron las consultas de tu clave de AudD'
        : code === 300 || code === 400 ? 'El audio grabado no sirvió: probá de nuevo más cerca del parlante'
        : (r.error && r.error.error_message) || 'AudD devolvió un error';
      throw new Error(msg);
    }
    const x = r.result;
    if (!x) return { found: false };
    const am = x.apple_music || {}, sp = x.spotify || {};
    const art = (am.artwork && am.artwork.url ? am.artwork.url.replace('{w}', '600').replace('{h}', '600') : '')
      || (((sp.album || {}).images || [])[0] || {}).url || '';
    return {
      found: true, title: x.title || '', artist: x.artist || '', album: x.album || '', year: String(x.release_date || '').slice(0, 4),
      label: x.label || '', timecode: x.timecode || '', link: x.song_link || '', art,
    };
  }
}

function parseShazam(r) {
  const x = r && r.track;
  if (!x || !(r.matches || []).length) return { found: false };
  const meta = {};
  for (const s of x.sections || []) for (const m of s.metadata || []) meta[String(m.title || '').toLowerCase()] = m.text || '';
  const im = x.images || {};
  return {
    found: true, title: x.title || '', artist: x.subtitle || '', album: meta.album || '', year: String(meta.released || '').slice(0, 4),
    label: meta.label || '', timecode: '', link: /^https:\/\//.test(x.url || '') ? x.url : '', art: im.coverarthq || im.coverart || '',
    by: 'huella',
  };
}

module.exports = { Recognizer, parseShazam };
