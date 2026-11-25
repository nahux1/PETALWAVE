# petalwave ↔ ytmusicapi (librería NO oficial de YouTube Music).
# Proceso persistente: lee pedidos JSON por stdin (uno por línea) y responde por stdout.
# La sesión se arma con el cookies.txt del usuario (su propia cuenta); sin cookies funciona en modo anónimo
# (búsqueda, letras y radio), y lo personal (me gusta, playlists, historial) necesita la sesión.
import json
import os
import sys
import time
import traceback

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "lib", "py"))
if __name__ == "__main__":   # como proceso aparte (Windows); importado desde Android no se toca la consola
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdin.reconfigure(encoding="utf-8")

from ytmusicapi import YTMusic  # noqa: E402
from ytmusicapi.helpers import initialize_headers  # noqa: E402

COOKIES = sys.argv[1] if __name__ == "__main__" and len(sys.argv) > 1 else os.path.join(ROOT, "cookies.txt")


def set_cookies(path):
    """Android: dónde está el cookies.txt de la sesión"""
    global COOKIES
    COOKIES = path
    _state.update(yt=None, mtime=None, auth=False, err="")
_state = {"yt": None, "anon": None, "mtime": None, "auth": False, "err": ""}


def cookie_header(path):
    """cookies.txt (Netscape) → encabezado Cookie con las de youtube.com"""
    pairs = {}
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            if line.startswith("#HttpOnly_"):
                line = line[len("#HttpOnly_"):]
            elif line.startswith("#") or not line.strip():
                continue
            parts = line.rstrip("\r\n").split("\t")
            if len(parts) < 7:
                continue
            domain, name, value = parts[0], parts[5], parts[6]
            if domain.lstrip(".").endswith("youtube.com"):
                pairs[name] = value
    return "; ".join(f"{k}={v}" for k, v in pairs.items()), pairs


def anon():
    if _state["anon"] is None:
        _state["anon"] = YTMusic(language="en")
    return _state["anon"]


def client(need_auth=False):
    """cliente con sesión si hay cookies.txt válido; si no, anónimo"""
    try:
        mtime = os.path.getmtime(COOKIES)
    except OSError:
        mtime = None
    if mtime != _state["mtime"]:
        _state.update(yt=None, mtime=mtime, auth=False, err="")
        if mtime is not None:
            try:
                header, pairs = cookie_header(COOKIES)
                if "__Secure-3PAPISID" not in pairs and "SAPISID" not in pairs:
                    raise ValueError("el cookies.txt no tiene la sesión de YouTube (__Secure-3PAPISID)")
                if "__Secure-3PAPISID" not in pairs:
                    header += f"; __Secure-3PAPISID={pairs['SAPISID']}"
                h = dict(initialize_headers())
                h.update({"cookie": header, "x-goog-authuser": "0", "authorization": "SAPISIDHASH 0_0", "x-origin": "https://music.youtube.com"})
                _state["yt"] = YTMusic(auth=h, language="en")
                _state["auth"] = True
            except Exception as e:  # noqa: BLE001
                _state["err"] = str(e)
    if need_auth and not _state["auth"]:
        raise PermissionError(_state["err"] or "Necesitás cargar cookies.txt (tu sesión de YouTube) para esto.")
    return _state["yt"] or anon()


def thumb(item):
    t = item.get("thumbnails") or []
    if not t:
        return ""
    best = max(t, key=lambda x: x.get("width", 0) or 0)
    url = best.get("url", "")
    # pedir la portada en alta resolución
    if "=w" in url:
        url = url.split("=w")[0] + "=w544-h544-l90-rj"
    return url


def secs(item):
    if item.get("duration_seconds"):
        return int(item["duration_seconds"])
    d = item.get("duration") or item.get("length") or ""
    try:
        n = 0
        for p in str(d).split(":"):
            n = n * 60 + int(p)
        return n
    except ValueError:
        return 0


def track(item):
    album = item.get("album")
    return {
        "videoId": item.get("videoId"),
        "title": item.get("title") or "",
        "artists": [a.get("name", "") for a in (item.get("artists") or []) if a],
        "album": album.get("name") if isinstance(album, dict) else (album or ""),
        "albumId": album.get("id") if isinstance(album, dict) else None,
        "duration": secs(item),
        "thumb": thumb(item),
        "type": item.get("resultType") or item.get("videoType") or "song",
        "likeStatus": item.get("likeStatus"),
        "available": item.get("isAvailable", True),
    }


KEY_COOKIES = ("SID", "HSID", "SSID", "APISID", "SAPISID", "LOGIN_INFO", "__Secure-3PSID", "__Secure-3PAPISID")


def m_status(p):
    y = client()
    out = {"auth": False, "error": _state["err"], "version": __import__("ytmusicapi").__version__, "account": None, "missing": []}
    try:
        _, pairs = cookie_header(COOKIES)
        out["missing"] = [k for k in KEY_COOKIES if k not in pairs]
    except OSError:
        out["error"] = "no hay cookies.txt cargado"
        return out
    if not _state["auth"]:
        return out
    # la prueba real: pedir los datos de la cuenta (si YouTube no reconoce la sesión, falla)
    try:
        info = y.get_account_info()
        out.update(auth=True, account={"name": info.get("accountName"), "handle": info.get("channelHandle"), "photo": info.get("accountPhotoUrl")}, error="")
    except Exception:  # noqa: BLE001
        miss = ", ".join(out["missing"])
        out["error"] = ("YouTube Music no reconoce la sesión: " + (f"al cookies.txt le faltan {miss}. " if miss else "las cookies vencieron. ")
                        + "Exportalo de nuevo desde youtube.com con la sesión iniciada.")
    return out


def m_search(p):
    flt = p.get("filter") or "songs"
    res = client().search(p["q"], filter=flt, limit=int(p.get("limit") or 20))
    out = []
    for r in res:
        rt = r.get("resultType")
        if rt in ("song", "video"):
            out.append(track(r))
        elif rt == "album":
            out.append({"type": "album", "browseId": r.get("browseId"), "playlistId": r.get("playlistId"), "title": r.get("title"),
                        "artists": [a.get("name", "") for a in (r.get("artists") or [])], "year": r.get("year"), "thumb": thumb(r)})
        elif rt == "playlist":
            out.append({"type": "playlist", "browseId": r.get("browseId"), "title": r.get("title"), "author": r.get("author"),
                        "count": r.get("itemCount"), "thumb": thumb(r)})
    return out


def m_album(p):
    a = client().get_album(p["browseId"])
    return {"title": a.get("title"), "artists": [x.get("name", "") for x in (a.get("artists") or [])], "year": a.get("year"),
            "playlistId": a.get("audioPlaylistId"), "thumb": thumb(a),
            "tracks": [dict(track(t), album=a.get("title"), thumb=thumb(a)) for t in a.get("tracks", [])]}


def m_liked(p):
    pl = client(True).get_liked_songs(limit=int(p.get("limit") or 500))
    return {"title": "Me gusta", "tracks": [track(t) for t in pl.get("tracks", [])]}


def m_playlists(p):
    return [{"playlistId": x.get("playlistId"), "title": x.get("title"), "count": x.get("count"), "thumb": thumb(x)}
            for x in client(True).get_library_playlists(limit=None)]


def m_playlist(p):
    pid = p["id"]
    if pid.startswith("VL"):
        pid = pid[2:]
    pl = client(_state["auth"]).get_playlist(pid, limit=int(p.get("limit") or 500))
    return {"title": pl.get("title"), "author": (pl.get("author") or {}).get("name") if isinstance(pl.get("author"), dict) else pl.get("author"),
            "thumb": thumb(pl), "tracks": [track(t) for t in pl.get("tracks", [])]}


def m_history(p):
    return [dict(track(t), played=t.get("played")) for t in client(True).get_history()]


def m_radio(p):
    wp = client().get_watch_playlist(videoId=p["videoId"], radio=True, limit=int(p.get("limit") or 40))
    return {"tracks": [track(t) for t in wp.get("tracks", []) if t.get("videoId") != p["videoId"]]}


def _lyrics_for(y, vid):
    wp = y.get_watch_playlist(videoId=vid, limit=1)
    bid = wp.get("lyrics")
    if not bid:
        return None
    # YouTube a veces rechaza el pedido con marcas de tiempo (HTTP 400): probar sin ellas y con el cliente anónimo
    for cli, ts in ((y, True), (anon(), True), (y, False), (anon(), False)):
        try:
            ly = cli.get_lyrics(bid, timestamps=ts)
            if ly and ly.get("lyrics"):
                return ly
        except Exception:  # noqa: BLE001
            continue
    return None


def m_lyrics(p):
    """letra por videoId; si ese video no tiene (subido por un usuario, versión slowed, etc.)
    busca la canción oficial con el título y el artista (q) y usa la de esa"""
    y = client()
    ly, matched, dur = None, False, 0
    if p.get("videoId"):
        ly = _lyrics_for(y, p["videoId"])
    if not ly and p.get("q"):
        for r in y.search(p["q"], filter="songs", limit=5)[:3]:
            vid = r.get("videoId")
            if not vid or vid == p.get("videoId"):
                continue
            ly = _lyrics_for(y, vid)
            if ly:
                matched, dur = True, secs(r)
                break
    if not ly:
        return None
    src = (ly.get("source") or "").replace("Source: ", "").replace("Fuente: ", "")
    if ly.get("hasTimestamps"):
        lines = []
        for ln in ly["lyrics"]:
            ms = int(ln.start_time)
            lines.append(f"[{ms // 60000:02d}:{(ms // 1000) % 60:02d}.{(ms % 1000) // 10:02d}]{ln.text}")
        return {"synced": True, "text": "\n".join(lines), "source": "YouTube Music" + (f" · {src}" if src else ""), "matched": matched, "duration": dur}
    return {"synced": False, "text": ly["lyrics"], "source": "YouTube Music" + (f" · {src}" if src else ""), "matched": matched, "duration": dur}


def m_rate(p):
    rating = p.get("rating", "LIKE")
    if rating not in ("LIKE", "DISLIKE", "INDIFFERENT"):
        raise ValueError("rating inválido")
    client(True).rate_song(p["videoId"], rating)
    return {"ok": True, "rating": rating}


def m_song(p):
    s = client().get_song(p["videoId"])
    v = s.get("videoDetails") or {}
    return {"videoId": v.get("videoId"), "title": v.get("title"), "author": v.get("author"), "duration": int(v.get("lengthSeconds") or 0),
            "thumb": (v.get("thumbnail") or {}).get("thumbnails", [{}])[-1].get("url", "")}


def m_songs(p):
    """título, artista, duración y carátula de una lista de videoIds (hasta 200), en paralelo"""
    from concurrent.futures import ThreadPoolExecutor
    ids = [i for i in (p.get("ids") or []) if isinstance(i, str) and len(i) == 11][:200]

    def one(vid):
        try:
            d = anon().get_song(vid).get("videoDetails") or {}
            th = (d.get("thumbnail") or {}).get("thumbnails") or []
            author = (d.get("author") or "").replace(" - Topic", "")
            return {"videoId": vid, "title": d.get("title") or "", "artists": [author] if author else [], "album": "",
                    "duration": int(d.get("lengthSeconds") or 0), "thumb": th[-1]["url"] if th else "", "type": d.get("musicVideoType") or "song"}
        except Exception:  # noqa: BLE001
            return {"videoId": vid, "title": "", "artists": [], "album": "", "duration": 0, "thumb": "", "type": "song", "available": False}
    with ThreadPoolExecutor(6) as ex:
        return {"tracks": list(ex.map(one, ids))}


# ---------- Explorar (sin cuenta): lo popular del país, géneros y estados de ánimo ----------
_explore = {}


def _loc_client(country):
    """cliente anónimo en español para un país (los rankings cambian según el país)"""
    c = _explore.get(country)
    if c is None:
        try:
            c = YTMusic(language="es", location=country if country != "ZZ" else "")
        except Exception:  # noqa: BLE001
            c = YTMusic(language="es")
        _explore[country] = c
    return c


def _thumb_url(ths):
    return ths[-1]["url"] if ths else ""


def _playlist_cards(o, out, seen):
    """busca tarjetas de playlists (browseId VL…) en la respuesta, sin depender de cómo YouTube las acomode"""
    if isinstance(o, dict):
        r = o.get("musicTwoRowItemRenderer")
        if r:
            bid = ""
            for path in (("navigationEndpoint", "browseEndpoint", "browseId"),):
                try:
                    x = r
                    for k in path:
                        x = x[k]
                    bid = x
                except Exception:  # noqa: BLE001
                    bid = ""
            if not bid:
                try:
                    bid = r["title"]["runs"][0]["navigationEndpoint"]["browseEndpoint"]["browseId"]
                except Exception:  # noqa: BLE001
                    bid = ""
            if bid.startswith("VL") and bid not in seen:
                seen.add(bid)
                th = (((r.get("thumbnailRenderer") or {}).get("musicThumbnailRenderer") or {}).get("thumbnail") or {}).get("thumbnails") or []
                out.append({"playlistId": bid[2:], "title": "".join(x.get("text", "") for x in (r.get("title") or {}).get("runs", [])),
                            "sub": "".join(x.get("text", "") for x in (r.get("subtitle") or {}).get("runs", [])), "thumb": _thumb_url(th)})
        for v in o.values():
            _playlist_cards(v, out, seen)
    elif isinstance(o, list):
        for v in o:
            _playlist_cards(v, out, seen)


def m_explore(p):
    country = str(p.get("country") or "ZZ").upper()[:2]
    y = _loc_client(country)
    out = {"country": country, "trending": [], "artists": [], "cats": {}}
    try:
        ch = y.get_charts(country=country)
    except Exception:  # noqa: BLE001  (país sin rankings: los globales)
        country, ch = "ZZ", _loc_client("ZZ").get_charts(country="ZZ")
        out["country"] = "ZZ"
    for v in ch.get("videos") or []:
        if v.get("playlistId"):
            out["trending"].append({"playlistId": v["playlistId"], "title": v.get("title", ""), "thumb": _thumb_url(v.get("thumbnails") or [])})
    for i, a in enumerate((ch.get("artists") or [])[:30]):
        out["artists"].append({"title": a.get("title", ""), "browseId": a.get("browseId"), "rank": a.get("rank") or i + 1,
                               "thumb": _thumb_url(a.get("thumbnails") or []), "subs": a.get("subscribers", "")})
    try:
        for name, items in y.get_mood_categories().items():
            out["cats"][name] = [{"title": c.get("title", ""), "params": c.get("params")} for c in items if c.get("params")]
    except Exception:  # noqa: BLE001
        pass
    return out


def m_mood(p):
    y = _loc_client(str(p.get("country") or "ZZ").upper()[:2])
    r = y._send_request("browse", {"browseId": "FEmusic_moods_and_genres_category", "params": p["params"]})
    out = []
    _playlist_cards(r, out, set())
    return {"playlists": out[:30]}


METHODS = {k[2:]: v for k, v in globals().items() if k.startswith("m_")}

if __name__ == "__main__":
    for raw in sys.stdin:
        raw = raw.strip().lstrip("﻿")
        if not raw:
            continue
        rid = None
        try:
            req = json.loads(raw)
            rid = req.get("id")
            fn = METHODS.get(req.get("method"))
            if not fn:
                raise ValueError("método desconocido: " + str(req.get("method")))
            t0 = time.time()
            res = fn(req.get("params") or {})
            out = {"id": rid, "result": res, "ms": int((time.time() - t0) * 1000)}
        except PermissionError as e:
            out = {"id": rid, "error": str(e), "auth": True}
        except Exception as e:  # noqa: BLE001
            msg = str(e) or e.__class__.__name__
            out = {"id": rid, "error": msg[:600], "trace": traceback.format_exc()[-800:]}
        sys.stdout.write(json.dumps(out, ensure_ascii=False, default=str) + "\n")
        sys.stdout.flush()
