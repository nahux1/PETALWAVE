// reconocer canciones ("¿qué suena?") con AudD (https://audd.io), usando la clave de AudD de cada usuario.
// La interfaz graba unos segundos con el micrófono y los manda acá; este módulo los reenvía a AudD.
// La clave se guarda en data/audd.json (solo tu usuario de Windows puede leerla) y nunca vuelve a la interfaz.
'use strict';
const path = require('path');
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

module.exports = { Recognizer };
