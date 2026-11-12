// Spotify: inicio de sesión OFICIAL (OAuth con PKCE, Web API) para leer tus playlists y canciones guardadas,
// y links públicos (track/álbum/playlist) sin sesión. petalwave NO descarga audio de Spotify (tiene DRM):
// busca cada canción en YouTube Music y de ahí se escucha online o se descarga.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JsonStore, normalize, Limiter } = require('./util');

const SCOPES = 'playlist-read-private playlist-read-collaborative user-library-read user-read-private';
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

class Spotify {
  constructor({ dataDir, port, ytm, broadcast }) {
    Object.assign(this, { ytm, broadcast });
    this.redirectUri = `http://127.0.0.1:${port}/spotify/callback`;
    this.store = new JsonStore(path.join(dataDir, 'spotify.json'), () => ({}));
    this.matches = new JsonStore(path.join(dataDir, 'spotify-match.json'), () => ({}));
    this.pkce = null;
    this.matchQ = new Limiter(3);
  }

  status() {
    const d = this.store.data;
    return { configured: !!d.clientId, clientId: d.clientId || '', connected: !!(d.token && d.token.refresh), user: d.user || null, redirectUri: this.redirectUri };
  }
  setClientId(id) {
    id = String(id || '').trim();
    if (!/^[0-9a-f]{32}$/i.test(id)) throw new Error('El Client ID de Spotify tiene 32 caracteres (letras y números). Copialo del panel de tu app.');
    if (this.store.data.clientId !== id) this.store.data.token = null;
    this.store.data.clientId = id;
    this.store.save(true);
  }
  logout() { this.store.data.token = null; this.store.data.user = null; this.store.save(true); this.broadcast('spotify', this.status()); }

  // ---------- OAuth (PKCE: no hace falta guardar un "secret") ----------
  loginUrl() {
    const d = this.store.data;
    if (!d.clientId) throw new Error('Primero pegá el Client ID de tu app de Spotify.');
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    this.pkce = { verifier, state, at: Date.now() };
    const q = new URLSearchParams({ client_id: d.clientId, response_type: 'code', redirect_uri: this.redirectUri, code_challenge_method: 'S256', code_challenge: challenge, state, scope: SCOPES });
    return 'https://accounts.spotify.com/authorize?' + q;
  }
  async callback(params) {
    if (params.get('error')) throw new Error('Spotify canceló el inicio de sesión: ' + params.get('error'));
    if (!this.pkce || params.get('state') !== this.pkce.state || Date.now() - this.pkce.at > 15 * 60e3) throw new Error('El inicio de sesión venció. Volvé a tocar "conectar con Spotify".');
    const body = new URLSearchParams({ grant_type: 'authorization_code', code: params.get('code'), redirect_uri: this.redirectUri, client_id: this.store.data.clientId, code_verifier: this.pkce.verifier });
    this.pkce = null;
    await this.tokenRequest(body);
    try { const me = await this.api('/me'); this.store.data.user = { name: me.display_name || me.id, id: me.id, product: me.product }; this.store.save(true); } catch {}
    this.broadcast('spotify', this.status());
  }
  async tokenRequest(body) {
    const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('Spotify rechazó el token: ' + (j.error_description || j.error || r.status));
    const old = this.store.data.token || {};
    this.store.data.token = { access: j.access_token, refresh: j.refresh_token || old.refresh, exp: Date.now() + (j.expires_in || 3600) * 1000 };
    this.store.save(true);
  }
  async access() {
    const t = this.store.data.token;
    if (!t || !t.refresh) { const e = new Error('No iniciaste sesión en Spotify.'); e.auth = true; throw e; }
    if (Date.now() > t.exp - 60e3) await this.tokenRequest(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: this.store.data.clientId }));
    return this.store.data.token.access;
  }
  async api(p, retry = true) {
    const tok = await this.access();
    const r = await fetch(p.startsWith('http') ? p : 'https://api.spotify.com/v1' + p, { headers: { Authorization: 'Bearer ' + tok } });
    if (r.status === 401 && retry) { this.store.data.token.exp = 0; return this.api(p, false); }
    if (r.status === 429) throw new Error('Spotify limitó los pedidos por un rato (límite del modo desarrollo). Probá en unos minutos.');
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error((j.error && j.error.message) || 'error ' + r.status); e.status = r.status; throw e; }
    return j;
  }
  async pages(first, max = 2000) {
    const out = []; let url = first;
    while (url && out.length < max) { const j = await this.api(url); out.push(...(j.items || [])); url = j.next; }
    return out;
  }

  // ---------- listas ----------
  async playlists() {
    const items = await this.pages('/me/playlists?limit=50', 500);
    return items.filter(Boolean).map((p) => ({ id: p.id, name: p.name, owner: p.owner && p.owner.display_name, count: (p.tracks || p.items || {}).total || 0, thumb: (p.images && p.images[0] && p.images[0].url) || '' }));
  }
  static track(t) {
    if (!t || t.type === 'episode') return null;
    return { id: t.id, name: t.name, artists: (t.artists || []).map((a) => a.name), album: t.album ? t.album.name : '', duration: Math.round((t.duration_ms || 0) / 1000), isrc: t.external_ids && t.external_ids.isrc, thumb: t.album && t.album.images && t.album.images[0] ? t.album.images[0].url : '' };
  }
  async list(kind, id) {
    let items, title = '', thumb = '';
    if (kind === 'liked') {
      title = 'Canciones que te gustan';
      // la Web API cambió en 2026: probar el endpoint nuevo y el anterior
      try { items = await this.pages('/me/tracks?limit=50', 3000); }
      catch (e) { items = await this.pages('/me/library?types=track&limit=50', 3000); }
      items = items.map((x) => x.track || x.item || x);
    } else if (kind === 'playlist') {
      const meta = await this.api(`/playlists/${id}?fields=name,images`).catch(() => ({}));
      title = meta.name || 'playlist'; thumb = meta.images && meta.images[0] ? meta.images[0].url : '';
      try { items = await this.pages(`/playlists/${id}/items?limit=100`, 3000); }
      catch (e) { items = await this.pages(`/playlists/${id}/tracks?limit=100`, 3000); }
      items = items.map((x) => x.item || x.track || x);
    } else throw new Error('lista desconocida');
    return { title, thumb, tracks: items.map(Spotify.track).filter(Boolean) };
  }

  // link público de Spotify (track, álbum o playlist): con sesión usa la API; sin sesión, la página pública "embed"
  static parseUrl(url) {
    const m = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|playlist)\/([A-Za-z0-9]{22})/.exec(String(url));
    return m ? { type: m[1], id: m[2] } : null;
  }
  async fromUrl(url) {
    const p = Spotify.parseUrl(url);
    if (!p) throw new Error('No es un link de Spotify de canción, álbum o playlist.');
    if (this.status().connected) {
      try {
        if (p.type === 'track') { const t = await this.api('/tracks/' + p.id); return { title: t.name, thumb: '', tracks: [Spotify.track(t)] }; }
        if (p.type === 'album') {
          const a = await this.api('/albums/' + p.id);
          const ts = (a.tracks.items || []).map((t) => Spotify.track({ ...t, album: { name: a.name, images: a.images } }));
          return { title: a.name, thumb: a.images && a.images[0] ? a.images[0].url : '', tracks: ts.filter(Boolean) };
        }
        return await this.list('playlist', p.id);
      } catch (e) { if (e.auth) throw e; /* algunos endpoints están restringidos en modo desarrollo: probar la página pública */ }
    }
    return this.embed(p);
  }
  async embed(p) {
    const r = await fetch(`https://open.spotify.com/embed/${p.type}/${p.id}`, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'es,en' } });
    if (!r.ok) throw new Error('Spotify no devolvió ese link (' + r.status + '). ¿Es público?');
    const html = await r.text();
    const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
    if (!m) throw new Error('No pude leer la página de Spotify (cambió el formato).');
    const ent = (((JSON.parse(m[1]).props || {}).pageProps || {}).state || {}).data;
    const e = ent && ent.entity;
    if (!e) throw new Error('Spotify no mostró el contenido de ese link (puede ser privado).');
    const img = (e.visualIdentity && e.visualIdentity.image && e.visualIdentity.image[0] && e.visualIdentity.image[0].url) || (e.coverArt && e.coverArt.sources && e.coverArt.sources[0] && e.coverArt.sources[0].url) || '';
    if (p.type === 'track') {
      return { title: e.name || e.title, thumb: img, tracks: [{ id: p.id, name: e.name || e.title, artists: (e.artists || []).map((a) => a.name), album: '', duration: Math.round((e.duration || 0) / 1000), thumb: img }] };
    }
    const list = (e.trackList || []).map((t) => ({ id: (t.uri || '').split(':').pop(), name: t.title, artists: String(t.subtitle || '').split(/,\s*/).filter(Boolean), album: p.type === 'album' ? e.name || e.title : '', duration: Math.round((t.duration || 0) / 1000), thumb: img }));
    return { title: e.name || e.title, thumb: img, tracks: list, partial: p.type === 'playlist' && list.length >= 100 };
  }

  // ---------- buscar cada canción en YouTube Music ----------
  async matchOne(t) {
    const key = t.isrc || t.id || normalize((t.artists || [])[0] + ' ' + t.name);
    const c = this.matches.data[key];
    if (c !== undefined && (c || Date.now() - (this.matches.data['_miss:' + key] || 0) < 7 * 864e5)) return c || null;
    const art = (t.artists || [])[0] || '';
    const want = normalize(t.name), wantA = normalize(art);
    const score = (r) => {
      let s = 0;
      const rt = normalize(r.title), ra = normalize((r.artists || []).join(' '));
      if (rt === want) s += 5; else if (rt.includes(want) || want.includes(rt)) s += 3;
      if (wantA && ra.includes(wantA)) s += 4;
      if (t.duration && r.duration) { const d = Math.abs(t.duration - r.duration); s += d <= 2 ? 3 : d <= 6 ? 1.5 : d > 25 ? -4 : 0; }
      if (/live|en vivo|karaoke|instrumental|cover|remix|sped|slowed|8d/i.test(r.title) && !/live|en vivo|karaoke|instrumental|cover|remix|sped|slowed|8d/i.test(t.name)) s -= 2.5;
      return s;
    };
    let best = null;
    for (const filter of ['songs', 'videos']) {
      const res = await this.ytm.call('search', { q: `${art} ${t.name}`.trim(), filter, limit: 6 }, { cacheMs: 30 * 60e3 }).catch(() => []);
      for (const r of res || []) { if (!r.videoId) continue; const s = score(r); if (!best || s > best.s) best = { s, r }; }
      if (best && best.s >= 8) break;     // buena coincidencia en "canciones": no hace falta buscar videos
    }
    const out = best && best.s >= 5 ? { videoId: best.r.videoId, title: best.r.title, artists: best.r.artists, album: best.r.album, duration: best.r.duration, thumb: best.r.thumb, type: best.r.type, score: Math.round(best.s * 10) / 10 } : null;
    this.matches.data[key] = out;
    if (!out) this.matches.data['_miss:' + key] = Date.now();
    this.matches.save();
    return out;
  }
  async match(tracks) {
    return Promise.all((tracks || []).slice(0, 60).map((t) => this.matchQ.run(() => this.matchOne(t))));
  }
}

module.exports = { Spotify };
