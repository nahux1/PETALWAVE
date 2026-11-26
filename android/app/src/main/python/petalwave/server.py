# Petalwave para Android: servidor interno (reemplaza al server.js de Windows).
# Sirve la misma interfaz (www/) y responde las mismas rutas /api/…, usando yt-dlp y ytmusicapi
# en Python. No hay ffmpeg: el audio se baja en m4a (AAC) tal cual viene de YouTube y los videos
# se arman uniendo video H.264 + audio AAC con MediaMuxer de Android (Muxer.kt).
import hashlib
import hmac
import http.client
import json
import os
import re
import shutil
import threading
import time
import traceback
import unicodedata
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
WWW = os.path.join(HERE, "www")
APP_VERSION = "0.0.0"
ON_ANDROID = False
try:
    from java import jclass  # noqa: F401  (Chaquopy)
    ON_ANDROID = True
except Exception:  # noqa: BLE001
    jclass = None

AUDIO_EXT = {".mp3", ".flac", ".wav", ".ogg", ".oga", ".opus", ".m4a", ".aac", ".weba"}
VIDEO_EXT = {".mp4", ".m4v", ".webm", ".3gp", ".mkv"}
AUDD = None
TOKEN = ""   # clave del servidor interno (la elige la app de Android al arrancar)

MIME = {".mp3": "audio/mpeg", ".flac": "audio/flac", ".wav": "audio/wav", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".opus": "audio/ogg",
        ".m4a": "audio/mp4", ".aac": "audio/aac", ".weba": "audio/webm", ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm",
        ".3gp": "video/3gpp", ".mkv": "video/x-matroska", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2"}
YT_CATEGORIES = {"music", "people & blogs", "entertainment", "film & animation", "gaming", "comedy", "education", "howto & style", "news & politics",
                 "nonprofits & activism", "pets & animals", "science & technology", "sports", "travel & events", "autos & vehicles"}

D = {}           # rutas: data, music, video, cookies
S = None         # ajustes (JsonStore)
clients = []     # conexiones SSE
clients_lock = threading.Lock()


def sha(s):
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:16]


def norm(s):
    s = unicodedata.normalize("NFD", str(s or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"\((official|lyric|lyrics|audio|video|visualizer|music video|hd|hq|4k)[^)]*\)|\[(official|lyric|lyrics|audio|video|visualizer|hd|hq|4k)[^\]]*\]", "", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


class JsonStore:
    def __init__(self, file, default):
        self.file = file
        self.lock = threading.Lock()
        try:
            with open(file, encoding="utf-8") as f:
                self.data = json.load(f)
        except Exception:  # noqa: BLE001
            self.data = default()
        self._t = None

    def save(self, now=False):
        if now:
            return self._write()
        if self._t:
            self._t.cancel()
        self._t = threading.Timer(0.5, self._write)
        self._t.daemon = True
        self._t.start()

    def _write(self):
        with self.lock:
            tmp = self.file + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.data, f, ensure_ascii=False)
            os.replace(tmp, self.file)


def broadcast(kind, data):
    msg = ("event: %s\ndata: %s\n\n" % (kind, json.dumps(data, ensure_ascii=False))).encode("utf-8")
    with clients_lock:
        dead = []
        for c in clients:
            try:
                c.wfile.write(msg)
                c.wfile.flush()
            except Exception:  # noqa: BLE001
                dead.append(c)
        for c in dead:
            clients.remove(c)


# ======================= biblioteca (música del teléfono) =======================
class Library:
    def __init__(self):
        self.store = JsonStore(os.path.join(D["data"], "library.json"), lambda: {"tracks": [], "extra": []})
        self.tracks = {t["id"]: t for t in self.store.data.get("tracks", [])}
        self.progress = {"scanning": False, "done": 0, "total": 0}
        self.scanning = False
        self.again = False
        self.lock = threading.Lock()

    def folders(self):
        return [f for f in S.data.get("folders", []) if os.path.isdir(f)]

    def walk(self, root, out, depth=0):
        if depth > 8:
            return
        try:
            for e in os.scandir(root):
                if e.name.startswith("."):
                    continue
                if e.is_dir(follow_symlinks=False):
                    if e.name.lower() in ("android", ".thumbnails", "cache"):
                        continue
                    self.walk(e.path, out, depth + 1)
                else:
                    ext = os.path.splitext(e.name)[1].lower()
                    if ext in AUDIO_EXT or ext in VIDEO_EXT:
                        out.append(e.path)
        except OSError:
            pass

    def scan(self):
        with self.lock:
            if self.scanning:
                self.again = True
                return
            self.scanning = True
        threading.Thread(target=self._scan, daemon=True).start()

    def _scan(self):
        try:
            found = []
            for f in self.folders():
                self.walk(f, found)
            extra = [f for f in self.store.data.get("extra", []) if os.path.exists(f)]
            self.store.data["extra"] = extra
            have = {os.path.abspath(f).lower() for f in found}
            found += [f for f in extra if os.path.abspath(f).lower() not in have]
            seen, todo = set(), []
            for file in found:
                tid = sha(os.path.abspath(file).lower())
                seen.add(tid)
                try:
                    st = os.stat(file)
                except OSError:
                    continue
                old = self.tracks.get(tid)
                if old and old.get("size") == st.st_size and old.get("mtime") == int(st.st_mtime * 1000):
                    continue
                todo.append((tid, file, st, old))
            removed = 0
            for tid in list(self.tracks):
                if tid not in seen:
                    del self.tracks[tid]
                    removed += 1
            self.progress = {"scanning": True, "done": 0, "total": len(todo)}
            broadcast("scan", self.progress)
            last = time.time()
            for tid, file, st, old in todo:
                self.tracks[tid] = self.build(tid, file, st, old)
                self.progress["done"] += 1
                if time.time() - last > 0.4:
                    last = time.time()
                    broadcast("scan", self.progress)
            self.progress = {"scanning": False, "done": len(todo), "total": len(todo)}
            if todo or removed:
                self.store.data["tracks"] = list(self.tracks.values())
                self.store.save()
            broadcast("scan", self.progress)
            broadcast("library", {"count": len(self.tracks), "changed": len(todo) + removed})
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        finally:
            with self.lock:
                self.scanning = False
                again, self.again = self.again, False
            if again:
                self.scan()

    def build(self, tid, file, st, old=None):
        base, ext = os.path.splitext(os.path.basename(file))
        ext = ext.lower()
        tags, dur, bitrate, codec, srate, ch, has_cover = {}, 0, 0, "", 0, 0, False
        try:
            import mutagen
            m = mutagen.File(file)
            if m is not None:
                info = getattr(m, "info", None)
                dur = float(getattr(info, "length", 0) or 0)
                bitrate = int((getattr(info, "bitrate", 0) or 0) / 1000)
                srate = int(getattr(info, "sample_rate", 0) or 0)
                ch = int(getattr(info, "channels", 0) or 0)
                codec = str(getattr(info, "codec", "") or "")
                has_cover = cover_bytes(m) is not None
            e = mutagen.File(file, easy=True)
            if e is not None and e.tags:
                for k, v in e.tags.items():
                    tags[k.lower()] = v[0] if isinstance(v, list) and v else v
            if m is not None and m.tags:   # comentario / purl con el ID de YouTube
                for k in ("\xa9cmt", "COMM::eng", "comment", "purl", "----:com.apple.iTunes:purl"):
                    v = m.tags.get(k) if hasattr(m.tags, "get") else None
                    if v:
                        tags.setdefault("comment", str(v[0] if isinstance(v, list) else v))
        except Exception:  # noqa: BLE001
            pass
        fa, ft = "", base
        if " - " in base:
            fa, ft = base.split(" - ", 1)
        yt = None
        for s in (tags.get("comment", ""), tags.get("website", "")):
            mm = re.search(r"(?:v=|youtu\.be/|yt:)([\w-]{11})", str(s))
            if mm:
                yt = mm.group(1)
                break
        y = re.search(r"(\d{4})", str(tags.get("date", "") or ""))
        num = lambda v: int(str(v).split("/")[0]) if str(v or "").split("/")[0].isdigit() else None  # noqa: E731
        genre = str(tags.get("genre", "") or "").strip()
        return {
            "id": tid, "path": file, "folder": os.path.dirname(file), "name": os.path.basename(file), "ext": ext[1:],
            "size": st.st_size, "mtime": int(st.st_mtime * 1000),
            "added": (old or {}).get("added") or int(st.st_mtime * 1000),
            "title": str(tags.get("title") or ft or base).strip(), "artist": str(tags.get("artist") or tags.get("albumartist") or fa or "").strip(),
            "albumArtist": str(tags.get("albumartist", "") or "").strip(), "album": str(tags.get("album", "") or "").strip(),
            "genre": "" if genre.lower() in YT_CATEGORIES else genre, "year": int(y.group(1)) if y else None,
            "trackNo": num(tags.get("tracknumber")), "discNo": num(tags.get("discnumber")),
            "duration": dur, "bitrate": bitrate, "codec": codec, "sampleRate": srate, "channels": ch,
            "video": ext in VIDEO_EXT and ext != ".weba", "hasCover": has_cover or ext in VIDEO_EXT, "hasLyricsTag": False, "ytId": yt,
        }

    def add_file(self, file, keep=False):
        try:
            st = os.stat(file)
        except OSError:
            return None
        if keep:
            ex = self.store.data.setdefault("extra", [])
            if os.path.abspath(file).lower() not in {os.path.abspath(x).lower() for x in ex}:
                ex.append(os.path.abspath(file))
        tid = sha(os.path.abspath(file).lower())
        t = self.build(tid, file, st, self.tracks.get(tid))
        self.tracks[tid] = t
        self.store.data["tracks"] = list(self.tracks.values())
        self.store.save()
        broadcast("library", {"count": len(self.tracks), "changed": 1, "added": tid})
        media_scan(file)
        return t


def cover_bytes(m):
    try:
        tags = m.tags
        if tags is None:
            return None
        if "covr" in tags and tags["covr"]:
            return bytes(tags["covr"][0])
        for k in list(tags.keys()):
            if str(k).startswith("APIC"):
                return tags[k].data
        pics = getattr(m, "pictures", None)
        if pics:
            return pics[0].data
        if "metadata_block_picture" in tags:
            import base64
            from mutagen.flac import Picture
            return Picture(base64.b64decode(tags["metadata_block_picture"][0])).data
    except Exception:  # noqa: BLE001
        pass
    return None


def media_scan(path):
    """avisa a Android que hay un archivo nuevo (así aparece en la galería y en otras apps de música)"""
    if not ON_ANDROID:
        return
    try:
        jclass("com.petalwave.app.Bridge").scanFile(path)
    except Exception:  # noqa: BLE001
        pass


def cover_file(t):
    dst = os.path.join(D["data"], "covers", t["id"] + ".jpg")
    if os.path.exists(dst):
        return dst
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    data = None
    try:
        import mutagen
        m = mutagen.File(t["path"])
        data = cover_bytes(m) if m is not None else None
    except Exception:  # noqa: BLE001
        pass
    if data:
        with open(dst, "wb") as f:
            f.write(data)
        return dst
    if t.get("video") and ON_ANDROID:   # cuadro del video con MediaMetadataRetriever
        try:
            if jclass("com.petalwave.app.Bridge").videoFrame(t["path"], dst):
                return dst
        except Exception:  # noqa: BLE001
            pass
    for n in ("cover.jpg", "folder.jpg", "Cover.jpg", "Folder.jpg", "front.jpg", "cover.png"):
        f = os.path.join(t["folder"], n)
        if os.path.exists(f):
            return f
    return None


# ======================= estadísticas y playlists =======================
def day_key(ts):
    return time.strftime("%Y-%m-%d", time.localtime(ts))


def main_artist(t):
    return re.split(r"\s*(?:,|&| feat\.? | ft\.? | x | y )\s*", (t.get("albumArtist") or t.get("artist") or ""), flags=re.I)[0].strip()


class Stats:
    def __init__(self):
        self.store = JsonStore(os.path.join(D["data"], "stats.json"), lambda: {"tracks": {}, "days": {}, "log": []})

    def record(self, b):
        t = LIB.tracks.get(b.get("id"))
        try:
            sec = float(b.get("seconds") or 0)
            float(b.get("duration") or 0)
        except (TypeError, ValueError):
            return
        if not t or sec <= 0:
            return
        dur = float(b.get("duration") or t.get("duration") or 0)
        sec = min(sec, (dur or sec) + 5, 6 * 3600)
        d = self.store.data
        s = d["tracks"].setdefault(t["id"], {"plays": 0, "seconds": 0, "first": int(time.time() * 1000), "last": 0, "skips": 0})
        s["seconds"] += sec
        counted = b.get("completed") or sec >= min(30, dur * 0.5 or 30)
        if counted:
            s["plays"] += 1
            s["last"] = int(time.time() * 1000)
            d["log"].append([int(time.time() * 1000), t["id"], round(sec)])
            d["log"] = d["log"][-8000:]
        elif sec < 15:
            s["skips"] += 1
        k = day_key(time.time())
        d["days"][k] = d["days"].get(k, 0) + sec
        self.store.save()

    def counts(self):
        return {k: v["plays"] for k, v in self.store.data["tracks"].items()}

    def summary(self, rng):
        now = time.time() * 1000
        year0 = time.mktime((time.localtime().tm_year, 1, 1, 0, 0, 0, 0, 0, -1)) * 1000
        since = now - 7 * 864e5 if rng == "week" else now - 30 * 864e5 if rng == "month" else year0 if rng == "year" else 0
        d = self.store.data
        log = [e for e in d["log"] if e[0] >= since]
        pt, pa, pb, secs = {}, {}, {}, 0
        for _, tid, sec in log:
            t = LIB.tracks.get(tid)
            if not t:
                continue
            secs += sec
            x = pt.setdefault(tid, {"id": tid, "plays": 0, "seconds": 0}); x["plays"] += 1; x["seconds"] += sec
            a = main_artist(t) or "—"
            x = pa.setdefault(a, {"name": a, "plays": 0, "seconds": 0, "cover": tid}); x["plays"] += 1; x["seconds"] += sec
            if t.get("album"):
                k = t["album"] + "\0" + (t.get("albumArtist") or t.get("artist") or "")
                x = pb.setdefault(k, {"name": t["album"], "artist": t.get("albumArtist") or t.get("artist"), "plays": 0, "seconds": 0, "cover": tid}); x["plays"] += 1; x["seconds"] += sec
        top = lambda m: sorted(m.values(), key=lambda v: (-v["plays"], -v["seconds"]))[:15]  # noqa: E731
        chart = []
        if rng in ("all", "year"):
            months = {}
            yr = str(time.localtime().tm_year)
            for k, v in d["days"].items():
                if rng == "year" and not k.startswith(yr):
                    continue
                months[k[:7]] = months.get(k[:7], 0) + v
            chart = [{"label": k, "seconds": round(months[k])} for k in sorted(months)[-12:]]
        else:
            n = 7 if rng == "week" else 30
            for i in range(n - 1, -1, -1):
                k = day_key(time.time() - i * 86400)
                chart.append({"label": k[5:], "seconds": round(d["days"].get(k, 0))})
        return {"range": rng, "plays": len(log), "seconds": round(secs), "totalSeconds": round(sum(d["days"].values())), "distinct": len(pt), "artists": len(pa),
                "topTracks": top(pt), "topArtists": top(pa), "topAlbums": top(pb), "chart": chart}

    def similar(self, seed_id, n=25):
        import random
        seed = LIB.tracks.get(seed_id)
        if not seed:
            return []
        sa, sg, salb = norm(main_artist(seed)), norm(seed.get("genre")), norm(seed.get("album"))
        out = []
        for t in LIB.tracks.values():
            if t["id"] == seed_id or t.get("video"):
                continue
            s = 0.0
            a = norm(main_artist(t))
            if sa and a == sa:
                s += 3
            elif sa and sa in norm(t.get("artist")):
                s += 2
            if salb and norm(t.get("album")) == salb:
                s += 1.5
            if sg and norm(t.get("genre")) == sg:
                s += 1.5
            if s > 0:
                out.append((s + random.random() * 0.5, t["id"]))
        out.sort(reverse=True)
        return [x[1] for x in out[:n]]

    def auto(self):
        import random
        lib = [t for t in LIB.tracks.values() if not t.get("video")]
        st = self.store.data["tracks"]
        out = []
        top = sorted([t for t in lib if st.get(t["id"], {}).get("plays")], key=lambda t: -st[t["id"]]["plays"])[:50]
        if top:
            out.append({"id": "auto:top", "name": "🔥 Más escuchadas", "desc": "tus canciones con más reproducciones", "tracks": [t["id"] for t in top]})
        rec = sorted(lib, key=lambda t: -(t.get("added") or 0))[:50]
        if rec:
            out.append({"id": "auto:recent", "name": "✦ Recién agregadas", "desc": "lo último que entró a la biblioteca", "tracks": [t["id"] for t in rec]})
        never = [t["id"] for t in lib if not st.get(t["id"], {}).get("plays")]
        if len(never) >= 3:
            random.shuffle(never)
            out.append({"id": "auto:never", "name": "◌ Sin escuchar", "desc": "canciones que todavía no reproduciste", "tracks": never[:50]})
        return out


# gustos: señales de escucha para las recomendaciones (las calcula la interfaz, ui/js/taste.js)
TASTE_KINDS = {"play", "skip", "like", "unlike", "nope", "pl", "seed"}


def clean_event(e):
    if not isinstance(e, dict) or e.get("k") not in TASTE_KINDS:
        return None
    now = int(time.time() * 1000)

    def s(k, n):
        v = e.get(k)
        return None if v is None else str(v)[:n]

    def num(k):
        try:
            return int(round(float(e.get(k))))
        except (TypeError, ValueError):
            return None
    out = {"t": min(now, num("t") or now), "k": e["k"], "id": s("id", 40), "a": s("a", 120), "ti": s("ti", 200), "g": s("g", 60),
           "y": num("y"), "s": num("s"), "d": num("d")}
    if re.fullmatch(r"[\w-]{11}", str(e.get("yt") or "")):
        out["yt"] = e["yt"]
    return {k: v for k, v in out.items() if v is not None}


# ---------- ¿qué suena? (AudD, con la clave de cada usuario) ----------
def audd_status():
    t = (AUDD.data.get("token") or "") if AUDD else ""
    return {"configured": bool(t), "hint": ("…" + t[-4:]) if t else ""}


def shazam_recognize(sig, samplems):
    """huella propia (ui/js/fingerprint.js) → catálogo de Shazam, como SongRec. Solo viaja la huella."""
    import base64
    import uuid
    try:
        raw = base64.b64decode(str(sig or ""), validate=True)
    except Exception:  # noqa: BLE001
        raise ValueError("Huella de audio inválida")
    if len(raw) < 56 or len(raw) > 200000 or int.from_bytes(raw[:4], "little") != 0xCAFE2580:
        raise ValueError("Huella de audio inválida")
    try:
        ms = max(1000, min(20000, int(round(float(samplems)))))
    except (TypeError, ValueError):
        ms = 10000
    now = int(time.time() * 1000)
    body = {"geolocation": {"altitude": 300, "latitude": 45, "longitude": 2},
            "signature": {"samplems": ms, "timestamp": now, "uri": "data:audio/vnd.shazam.sig;base64," + base64.b64encode(raw).decode()},
            "timestamp": now, "timezone": "America/Argentina/Buenos_Aires"}
    url = ("https://amp.shazam.com/discovery/v5/en/US/android/-/tag/%s/%s?sync=true&webv3=true&sampling=true&connected="
           "&shazamapiversion=v3&sharehub=true&video=v3" % (str(uuid.uuid4()).upper(), uuid.uuid4()))
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={
        "Content-Type": "application/json", "Content-Language": "en_US",
        "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 11; Pixel 4 Build/RQ3A.210805.001.A1)"})
    try:
        r = json.loads(urllib.request.urlopen(req, timeout=20).read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        raise RuntimeError("No se pudo consultar el reconocedor (¿sin internet?): %s" % e)
    x = r.get("track")
    if not x or not r.get("matches"):
        return {"found": False}
    meta = {}
    for s in x.get("sections") or []:
        for m in s.get("metadata") or []:
            meta[str(m.get("title") or "").lower()] = m.get("text") or ""
    im = x.get("images") or {}
    link = x.get("url") or ""
    return {"found": True, "title": x.get("title") or "", "artist": x.get("subtitle") or "", "album": meta.get("album", ""),
            "year": str(meta.get("released", ""))[:4], "label": meta.get("label", ""), "timecode": "",
            "link": link if link.startswith("https://") else "", "art": im.get("coverarthq") or im.get("coverart") or "", "by": "huella"}


def audd_recognize(audio, mime):
    token = AUDD.data.get("token") or ""
    if not token:
        raise LookupError("Falta tu clave de AudD: ajustes → cuentas → reconocer canciones")
    ext = "ogg" if "ogg" in mime else "m4a" if re.search(r"mp4|aac|m4a", mime) else "wav" if "wav" in mime else "webm"
    bnd = "----petalwave" + hashlib.md5(audio[:64] + str(time.time()).encode()).hexdigest()
    parts = []
    for k, v in (("api_token", token), ("return", "apple_music,spotify")):
        parts.append(("--%s\r\nContent-Disposition: form-data; name=\"%s\"\r\n\r\n%s\r\n" % (bnd, k, v)).encode())
    parts.append(("--%s\r\nContent-Disposition: form-data; name=\"file\"; filename=\"muestra.%s\"\r\nContent-Type: %s\r\n\r\n" % (bnd, ext, mime)).encode() + audio + b"\r\n")
    parts.append(("--%s--\r\n" % bnd).encode())
    req = urllib.request.Request("https://api.audd.io/", data=b"".join(parts), headers={"Content-Type": "multipart/form-data; boundary=" + bnd, "User-Agent": "Petalwave-Android"})
    try:
        r = json.loads(urllib.request.urlopen(req, timeout=30).read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        raise RuntimeError("No se pudo hablar con AudD (¿sin internet?): %s" % e)
    if r.get("status") == "error":
        code = (r.get("error") or {}).get("error_code")
        msg = ("Tu clave de AudD no es válida o se terminaron las consultas gratis" if code in (900, 901)
               else "Se terminaron las consultas de tu clave de AudD" if code == 902
               else "El audio grabado no sirvió: probá de nuevo más cerca del parlante" if code in (300, 400)
               else (r.get("error") or {}).get("error_message") or "AudD devolvió un error")
        raise RuntimeError(msg)
    x = r.get("result")
    if not x:
        return {"found": False}
    am, sp = x.get("apple_music") or {}, x.get("spotify") or {}
    art = ((am.get("artwork") or {}).get("url") or "").replace("{w}", "600").replace("{h}", "600")
    if not art:
        imgs = (sp.get("album") or {}).get("images") or []
        art = imgs[0].get("url", "") if imgs else ""
    return {"found": True, "title": x.get("title") or "", "artist": x.get("artist") or "", "album": x.get("album") or "",
            "year": str(x.get("release_date") or "")[:4], "label": x.get("label") or "", "timecode": x.get("timecode") or "",
            "link": x.get("song_link") or "", "art": art}


def playlist_op(b):
    items = PL.data["items"]
    now = int(time.time() * 1000)
    ok = lambda i: isinstance(i, str) and (re.fullmatch(r"[0-9a-f]{16}", i) or re.fullmatch(r"yt_[\w-]{11}", i))  # noqa: E731
    if b.get("create"):
        p = {"id": "p" + format(now, "x"), "name": str(b["create"].get("name") or "nueva playlist")[:80], "tracks": [i for i in b["create"].get("tracks") or [] if ok(i)], "created": now, "updated": now}
        items.append(p)
        PL.save()
        return p
    # "me gusta" propio de petalwave: una playlist fija (id "liked") que funciona sin cuenta
    if b.get("like"):
        lk = next((x for x in items if x["id"] == "liked"), None)
        if not lk:
            lk = {"id": "liked", "name": "Me gusta", "liked": True, "tracks": [], "created": now, "updated": now}
            items.insert(0, lk)
        i = str(b["like"].get("id") or "")
        if not ok(i):
            raise ValueError("Esa canción no se puede marcar")
        lk["tracks"] = [x for x in lk["tracks"] if x != i]
        if b["like"].get("on", True) is not False:
            lk["tracks"].insert(0, i)
        lk["updated"] = now
        PL.save()
        return lk
    p = next((x for x in items if x["id"] == b.get("id")), None)
    if not p:
        raise ValueError("No existe esa playlist")
    if p["id"] == "liked" and (b.get("delete") or b.get("rename")):
        raise ValueError('"Me gusta" no se puede borrar ni renombrar')
    if b.get("rename"):
        p["name"] = str(b["rename"])[:80]
    for i in ([b["add"]] if isinstance(b.get("add"), str) else b.get("add") or []):
        if ok(i) and i not in p["tracks"]:
            p["tracks"].append(i)
    if b.get("remove"):
        r = set([b["remove"]] if isinstance(b["remove"], str) else b["remove"])
        p["tracks"] = [i for i in p["tracks"] if i not in r]
    if isinstance(b.get("set"), list):
        p["tracks"] = [i for i in b["set"] if ok(i)]
    if b.get("delete"):
        PL.data["items"] = [x for x in items if x is not p]
    p["updated"] = now
    PL.save()
    return {"deleted": True} if b.get("delete") else p


# ======================= YouTube Music (ytmusicapi) =======================
_ytm_lock = threading.Lock()
_ytm_cache = {}
thumbs = {}


def ytm(method, params=None, cache=0):
    from petalwave import ytm_bridge as yb
    key = method + json.dumps(params or {}, sort_keys=True)
    hit = _ytm_cache.get(key)
    if cache and hit and time.time() - hit[0] < cache:
        return hit[1]
    with _ytm_lock:
        yb.set_cookies(D["cookies"]) if yb.COOKIES != D["cookies"] else None
        r = getattr(yb, "m_" + method)(params or {})
    if cache:
        _ytm_cache[key] = (time.time(), r)
    return r


def annotate(lst):
    by_yt, by_key = {}, {}
    for t in LIB.tracks.values():
        if t.get("ytId"):
            by_yt[t["ytId"]] = t["id"]
        by_key.setdefault(norm(t["title"]), []).append(t)
    for it in lst or []:
        if not isinstance(it, dict) or not it.get("videoId"):
            continue
        if it.get("thumb"):
            thumbs[it["videoId"]] = it["thumb"]
        local = by_yt.get(it["videoId"])
        if not local:
            ar = norm((it.get("artists") or [""])[0])
            for t in by_key.get(norm(it.get("title")), []):
                if not ar or ar in norm(t.get("artist")) or ar in norm(t.get("name")):
                    local = t["id"]
                    break
        it["local"] = local
    return lst


def annotate_list(o):
    if isinstance(o, dict) and o.get("tracks"):
        annotate(o["tracks"])
    return o


# ======================= streaming online =======================
_streams = {}
_stream_lock = threading.Lock()


def ydl_opts(extra=None):
    o = {"quiet": True, "no_warnings": True, "noprogress": True, "js_runtimes": {}, "socket_timeout": 20}
    if os.path.exists(D["cookies"]):
        o["cookiefile"] = D["cookies"]
    o.update(extra or {})
    return o


def stream_cached(vid):
    d = os.path.join(D["data"], "stream-cache")
    for ext in ("m4a", "webm", "mp4"):
        f = os.path.join(d, vid + "." + ext)
        if os.path.exists(f):
            return f
    return None


def offline_max():
    try:
        return max(100, min(100000, int(S.data.get("offlineMaxMB") or 500))) * 1024 * 1024
    except (TypeError, ValueError):
        return 500 * 1024 * 1024


def stream_prune():
    d = os.path.join(D["data"], "stream-cache")
    try:
        fl = sorted((os.path.join(d, n) for n in os.listdir(d)), key=os.path.getmtime)
        total = sum(os.path.getsize(x) for x in fl)
        for x in fl:
            if total <= offline_max():
                break
            total -= os.path.getsize(x)
            os.remove(x)
    except OSError:
        pass


# ---- sin internet ----
_net = {"at": 0, "ok": True}
_net_lock = threading.Lock()


def net_online(force=False):
    """¿hay internet? (YouTube Music responde). Se pregunta como mucho cada 20 s"""
    with _net_lock:
        if not force and time.time() - _net["at"] < 20:
            return _net["ok"]
        ok = False
        for host in ("music.youtube.com", "www.google.com"):
            try:
                c = http.client.HTTPSConnection(host, timeout=4)
                c.request("HEAD", "/generate_204")
                ok = c.getresponse().status < 500
                c.close()
                if ok:
                    break
            except Exception:  # noqa: BLE001
                continue
        _net.update(at=time.time(), ok=ok)
        return ok


_save_q = []
_save_lock = threading.Lock()
_saving = {"id": None}


def offline_list():
    d = os.path.join(D["data"], "stream-cache")
    ids, size = [], 0
    try:
        for n in os.listdir(d):
            m = re.fullmatch(r"([\w-]{11})\.(m4a|webm|mp4)", n)
            if m:
                ids.append(m.group(1))
                try:
                    size += os.path.getsize(os.path.join(d, n))
                except OSError:
                    pass
    except OSError:
        pass
    return {"ids": ids, "bytes": size, "maxMB": offline_max() // 1048576, "saving": len(_save_q) + (1 if _saving["id"] else 0), "online": _net["ok"]}


def offline_save(ids):
    n = 0
    with _save_lock:
        for i in ids or []:
            if isinstance(i, str) and re.fullmatch(r"[\w-]{11}", i) and not stream_cached(i) and i not in _save_q and i != _saving["id"]:
                _save_q.append(i)
                n += 1
        del _save_q[:-300]
        start = _saving["id"] is None and bool(_save_q)
        if start:
            _saving["id"] = "…"
    if start:
        threading.Thread(target=_save_pump, daemon=True).start()
    return n


def _save_pump():
    while True:
        with _save_lock:
            if not _save_q:
                _saving["id"] = None
                return
            vid = _save_q.pop(0)
            _saving["id"] = vid
        try:
            if net_online():
                stream_file(vid)
            else:
                with _save_lock:
                    _save_q.clear()
        except Exception:  # noqa: BLE001
            pass


def offline_remove(ids, everything=False):
    d = os.path.join(D["data"], "stream-cache")
    n = 0
    if everything:
        with _save_lock:
            _save_q.clear()
    try:
        for f in os.listdir(d):
            if everything or f[:11] in (ids or []):
                try:
                    os.remove(os.path.join(d, f))
                    n += 1
                except OSError:
                    pass
    except OSError:
        pass
    return n


def stream_file(vid):
    """baja la canción entera: cuando YouTube rechaza el enlace directo o para escucharla sin internet"""
    f = stream_cached(vid)
    if f:
        return f
    import yt_dlp
    d = os.path.join(D["data"], "stream-cache")
    os.makedirs(d, exist_ok=True)
    o = ydl_opts({"format": "bestaudio[ext=m4a]/bestaudio/best[acodec!=none]", "outtmpl": os.path.join(d, vid + ".%(ext)s"),
                  "nopart": True, "fixup": "never", "updatetime": False})
    with yt_dlp.YoutubeDL(o) as y:
        y.download(["https://music.youtube.com/watch?v=" + vid])
    f = stream_cached(vid)
    if not f:
        raise RuntimeError("YouTube no entregó el audio")
    stream_prune()
    return f


_resolving = {}
_resolving_lock = threading.Lock()


def resolve(vid, force=False):
    c = _streams.get(vid)
    if c and not force and c["exp"] - time.time() > 600:
        return c
    # la misma canción pedida dos veces a la vez (preparada al tocarla + el play): una sola búsqueda
    with _resolving_lock:
        lk = _resolving.setdefault(vid, threading.Lock())
    with lk:
        c = _streams.get(vid)
        if c and not force and c["exp"] - time.time() > 600:
            return c
        return _resolve(vid)


def _resolve(vid):
    import yt_dlp
    err = None
    for alt in (None, {"youtube": {"player_client": ["tv", "mweb", "web_safari"]}}):
        try:
            o = ydl_opts({"format": "bestaudio[ext=m4a]/bestaudio/best[acodec!=none]/best"})
            if alt:
                o["extractor_args"] = alt
            with yt_dlp.YoutubeDL(o) as y:
                info = y.extract_info("https://music.youtube.com/watch?v=" + vid, download=False)
            url = info.get("url")
            if url:
                q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
                exp = int((q.get("expire") or [time.time() + 5 * 3600])[0])
                c = {"url": url, "exp": exp, "headers": info.get("http_headers") or {}, "mime": (q.get("mime") or ["audio/mp4"])[0]}
                _streams[vid] = c
                return c
        except Exception as e:  # noqa: BLE001
            err = e
    raise RuntimeError(str(err or "no se pudo obtener el audio")[:300])


# ======================= letras =======================
NOISE = re.compile(r"[(\[][^)\]]*(official|video|audio|lyric|letra|visuali[sz]er|music video|\bmv\b|\bhd\b|\b4k\b|remaster|clip)[^)\]]*[)\]]", re.I)
EDIT = re.compile(r"[(\[][^)\]]*(slowed|reverb|sped|speed ?up|nightcore|bass ?boost|8d)[^)\]]*[)\]]|\b(slowed( \+ reverb)?|sped up|nightcore)\b", re.I)


def candidates(title, artist):
    artist = re.sub(r"\s*-\s*topic$|vevo$", "", artist or "", flags=re.I).strip()
    t = NOISE.sub("", title or "")
    edited = bool(EDIT.search(t))
    t = re.sub(r"\s{2,}", " ", EDIT.sub("", t)).strip()
    t = re.sub(r"\s+(ft\.?|feat\.?|prod\.?)\s.*$", "", t, flags=re.I).strip()
    out = []
    parts = re.split(r"\s+[-–—]\s+", t)
    if len(parts) >= 2:
        out += [(parts[1], parts[0]), (parts[0], parts[1])]
    out.append((t, re.split(r",|&| x | feat", artist)[0].strip() if artist else ""))
    return out[:4], edited


def rescale(text, k):
    if not k or abs(k - 1) < 0.04:
        return text

    def f(m):
        ms = int(((int(m.group(1)) * 60 + int(m.group(2))) * 1000 + int((m.group(3) or "0").ljust(3, "0")[:3])) * k)
        return "[%02d:%02d.%02d]" % (ms // 60000, (ms // 1000) % 60, (ms % 1000) // 10)
    return re.sub(r"\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]", f, text)


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Petalwave-Android"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode("utf-8"))


def lyrics(tid, meta):
    if tid.startswith("yt_"):
        t = {"id": tid, "ytId": tid[3:], "title": meta.get("title", ""), "artist": meta.get("artist", ""), "duration": float(meta.get("duration") or 0)}
    else:
        t = LIB.tracks.get(tid)
        if not t:
            return {"error": "No existe esa canción"}
        base = os.path.splitext(t["path"])[0]
        for ext in (".lrc", ".txt"):
            if os.path.exists(base + ext):
                txt = open(base + ext, encoding="utf-8", errors="replace").read()
                return {"source": "archivo " + os.path.basename(base + ext), "synced": bool(re.search(r"\[\d{1,2}:\d{2}", txt)), "text": txt}
    cache = os.path.join(D["data"], "lyrics", "a-" + re.sub(r"[^\w-]", "_", tid) + ".json")
    if os.path.exists(cache):
        try:
            c = json.load(open(cache, encoding="utf-8"))
            if c.get("text") or time.time() - c.get("at", 0) < 3 * 86400:
                return c if c.get("text") else {"none": True, "online": True, "ytm": True}
        except Exception:  # noqa: BLE001
            pass
    cands, edited = candidates(t["title"], t.get("artist"))
    res = None
    plain = None
    if S.data.get("lyricsYtm", True) is not False:
        try:
            c0 = cands[0] if cands else (t["title"], t.get("artist", ""))
            r = ytm("lyrics", {"videoId": t.get("ytId"), "q": (c0[0] + " " + c0[1]).strip()})
            if r and r.get("text"):
                txt = rescale(r["text"], t["duration"] / r["duration"]) if r.get("synced") and r.get("matched") and edited and r.get("duration") and t.get("duration") else r["text"]
                cur = {"source": r["source"], "synced": bool(r.get("synced")), "text": txt}
                if cur["synced"]:
                    res = cur
                else:
                    plain = cur
        except Exception:  # noqa: BLE001
            pass
    if not res and S.data.get("lyricsOnline", True) is not False:
        try:
            d = round(t.get("duration") or 0)
            hit = None
            for ti, ar in cands:
                q = {"track_name": ti}
                if ar:
                    q["artist_name"] = ar
                arr = get_json("https://lrclib.net/api/search?" + urllib.parse.urlencode(q)) or []
                arr = [x for x in arr if (x.get("syncedLyrics") or x.get("plainLyrics")) and not x.get("instrumental")]
                if arr:
                    arr.sort(key=lambda x: (0 if x.get("syncedLyrics") else 40) + (min(60, abs((x.get("duration") or 0) - d)) if d and not edited else 0))
                    hit = arr[0]
                    break
            if hit:
                txt = hit.get("syncedLyrics") or hit.get("plainLyrics")
                if hit.get("syncedLyrics") and edited and d and hit.get("duration"):
                    txt = rescale(txt, d / hit["duration"])
                cur = {"source": "LRCLIB · %s — %s" % (hit.get("artistName"), hit.get("trackName")), "synced": bool(hit.get("syncedLyrics")), "text": txt}
                if cur["synced"] or not plain:
                    res = cur
        except Exception:  # noqa: BLE001
            pass
    res = res or plain
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    json.dump({**(res or {}), "at": time.time()}, open(cache, "w", encoding="utf-8"), ensure_ascii=False)
    return res or {"none": True, "online": True, "ytm": True, "ytId": bool(t.get("ytId"))}


# ======================= descargas =======================
ACTIVE = {"en cola", "iniciando", "descargando", "procesando", "reintentando"}


class Downloads:
    def __init__(self):
        self.hist = JsonStore(os.path.join(D["data"], "downloads.json"), lambda: {"items": []})
        for it in self.hist.data["items"]:
            if it.get("status") in ACTIVE:
                it["status"] = "interrumpido"
        self.jobs = {}
        self.queue = []
        self.next = int(time.time())
        self.lock = threading.Lock()

    def public(self, j):
        return {k: v for k, v in j.items() if k not in ("log", "_cancel")}

    def list(self):
        return {"active": [self.public(j) for j in self.jobs.values() if j["status"] in ACTIVE], "history": self.hist.data["items"][:300]}

    def emit(self, j):
        broadcast("dl", self.public(j))

    def log(self, j, line):
        j["log"].append(line)
        j["log"] = j["log"][-120:]
        broadcast("dllog", {"id": j["id"], "line": line, "status": j["status"]})

    def add(self, url, fmt, quality, playlist):
        with self.lock:
            self.next += 1
            jid = str(self.next)
        video = fmt == "mp4"
        j = {"id": jid, "url": url, "format": fmt, "quality": quality, "playlist": bool(playlist), "dest": D["video"] if video and S.data.get("videoToDownloads", True) else D["music"],
             "kind": "video" if video else "audio", "status": "en cola", "created": int(time.time() * 1000), "started": None, "ended": None,
             "title": url, "percent": 0, "speed": "", "eta": "", "size": "", "downloaded": "", "fmtInfo": "", "item": 0, "items": 0,
             "files": [], "skipped": 0, "error": "", "log": [], "_cancel": False}
        self.jobs[jid] = j
        self.queue.append(j)
        self.emit(j)
        self.pump()
        return j

    def running(self):
        return sum(1 for j in self.jobs.values() if j["status"] in ("iniciando", "descargando", "procesando", "reintentando"))

    def pump(self):
        mx = max(1, min(4, int(S.data.get("concurrency") or 2)))
        while self.queue and self.running() < mx:
            j = self.queue.pop(0)
            j["status"] = "iniciando"
            threading.Thread(target=self.run, args=(j,), daemon=True).start()

    def cancel(self, jid):
        j = self.jobs.get(jid)
        if not j or j["status"] not in ACTIVE:
            return False
        j["_cancel"] = True
        if j in self.queue:
            self.queue.remove(j)
            self.finish(j, "cancelado")
        return True

    def retry(self, jid):
        old = self.jobs.get(jid) or next((x for x in self.hist.data["items"] if x["id"] == jid), None)
        if not old:
            return None
        return self.add(old["url"], old["format"], old.get("quality", ""), old.get("playlist"))

    def finish(self, j, status, err=""):
        j["status"] = status
        j["error"] = err or j.get("error", "")
        j["ended"] = int(time.time() * 1000)
        if status == "completado":
            j["percent"] = 100
        rec = {k: j[k] for k in ("id", "url", "title", "format", "quality", "playlist", "dest", "status", "created", "ended", "files", "error", "size", "fmtInfo")}
        items = self.hist.data["items"]
        items[:] = [x for x in items if x["id"] != j["id"]]
        items.insert(0, rec)
        del items[300:]
        self.hist.save()
        self.emit(j)
        self.pump()

    def hook(self, j):
        def h(d):
            if j["_cancel"]:
                import yt_dlp
                raise yt_dlp.utils.DownloadCancelled("cancelado")
            if d.get("status") == "downloading":
                tot = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                got = d.get("downloaded_bytes") or 0
                j.update(status="descargando", percent=round(100 * got / tot, 1) if tot else 0,
                         speed=(fmt_size(d.get("speed")) + "/s") if d.get("speed") else "", eta=fmt_eta(d.get("eta")),
                         size=fmt_size(tot), downloaded=fmt_size(got))
                now = time.time()
                if now - j.get("_last", 0) > 0.3:
                    j["_last"] = now
                    self.emit(j)
        return h

    def run(self, j):
        try:
            import yt_dlp
            os.makedirs(j["dest"], exist_ok=True)
            entries = [j["url"]]
            if j["playlist"] and "list=" in j["url"]:
                with yt_dlp.YoutubeDL(ydl_opts({"extract_flat": "in_playlist"})) as y:
                    info = y.extract_info(j["url"], download=False)
                entries = ["https://music.youtube.com/watch?v=" + e["id"] for e in (info.get("entries") or []) if e and e.get("id")][:200]
                j["items"] = len(entries)
                j["title"] = "playlist · " + str(info.get("title") or "")
            ok = 0
            for i, u in enumerate(entries):
                if j["_cancel"]:
                    break
                j["item"] = i + 1
                try:
                    self.one(j, u)
                    ok += 1
                except Exception as e:  # noqa: BLE001
                    if j["_cancel"]:
                        break
                    j["error"] = str(e).replace("ERROR: ", "")[:400]
                    self.log(j, "ERROR: " + j["error"])
            if j["_cancel"]:
                self.finish(j, "cancelado")
            elif ok:
                self.finish(j, "completado")
            else:
                self.finish(j, "error", j["error"] or "no se pudo descargar")
        except Exception as e:  # noqa: BLE001
            self.finish(j, "error", str(e)[:400])

    def one(self, j, url):
        import yt_dlp
        tmp = os.path.join(D["data"], "tmp", j["id"])
        os.makedirs(tmp, exist_ok=True)
        try:
            alts = [None, {"youtube": {"player_client": ["tv", "mweb", "web_safari"]}}]
            last = None
            for a, alt in enumerate(alts):
                try:
                    return self._one(j, url, tmp, alt)
                except yt_dlp.utils.DownloadCancelled:
                    raise
                except Exception as e:  # noqa: BLE001
                    last = e
                    if a < len(alts) - 1 and re.search(r"bot|429|403|Sign in|not available|po.?token", str(e), re.I):
                        j["status"] = "reintentando"
                        self.log(j, "Petalwave: probando otro cliente de YouTube…")
                        continue
                    raise
            raise last
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def _one(self, j, url, tmp, alt):
        import yt_dlp
        base = {"progress_hooks": [self.hook(j)], "paths": {"home": tmp, "temp": tmp}, "outtmpl": "%(id)s.%(ext)s", "noplaylist": True,
                "windowsfilenames": True, "trim_file_name": 150}
        if alt:
            base["extractor_args"] = alt
        with yt_dlp.YoutubeDL(ydl_opts(base)) as y:
            info = y.extract_info(url, download=False)
        if j["_cancel"]:   # cancelado mientras se conectaba: no empezar a bajar
            raise yt_dlp.utils.DownloadCancelled("cancelado")
        title = info.get("track") or info.get("title") or "video"
        artist = info.get("artist") or info.get("creator") or info.get("uploader") or ""
        artist = re.sub(r"\s*-\s*Topic$", "", artist.split(",")[0]).strip()
        j["title"] = (artist + " — " + title) if artist and not j["playlist"] else (j["title"] if j["playlist"] else title)
        self.emit(j)
        safe = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", ((artist + " - ") if artist and j["kind"] == "audio" else "") + title).strip()[:150] or info["id"]
        if j["kind"] == "audio":
            o = dict(base, format="bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio")
            with yt_dlp.YoutubeDL(ydl_opts(o)) as y:
                r = y.extract_info(url, download=True)
            src = y.prepare_filename(r)
            ext = os.path.splitext(src)[1].lower()
            if ext == ".webm":
                ext = ".weba"   # webm de solo audio: con esta extensión Android lo trata como música
            dst = unique(os.path.join(j["dest"], safe + ext))
            j["status"] = "procesando"
            self.emit(j)
            shutil.move(src, dst)
            j["fmtInfo"] = "origen: %s %sk (#%s)" % (r.get("acodec", "").split(".")[0], int(r.get("abr") or 0), r.get("format_id"))
            tag_audio(dst, info, title, artist)
        else:
            h = int(j["quality"]) if str(j["quality"]).isdigit() else 1080
            fv = "bv*[ext=mp4][vcodec^=avc1][height<=%d]/bv*[ext=mp4][height<=%d]" % (h, h)
            merged = None
            if ON_ANDROID:
                try:
                    with yt_dlp.YoutubeDL(ydl_opts(dict(base, format=fv, outtmpl="v.%(ext)s"))) as y:
                        rv = y.extract_info(url, download=True)
                        vf = y.prepare_filename(rv)
                    with yt_dlp.YoutubeDL(ydl_opts(dict(base, format="ba[ext=m4a]/ba[acodec^=mp4a]", outtmpl="a.%(ext)s"))) as y:
                        ra = y.extract_info(url, download=True)
                        af = y.prepare_filename(ra)
                    j["status"] = "procesando"
                    self.emit(j)
                    out = os.path.join(tmp, "out.mp4")
                    if jclass("com.petalwave.app.Muxer").merge(vf, af, out):
                        merged = out
                        j["fmtInfo"] = "origen: %sp %s + %s" % (rv.get("height"), (rv.get("vcodec") or "").split(".")[0], (ra.get("acodec") or "").split(".")[0])
                except yt_dlp.utils.DownloadCancelled:
                    raise
                except Exception as e:  # noqa: BLE001
                    self.log(j, "video en alta calidad no disponible (" + str(e)[:120] + "): uso 360p")
            if not merged:   # sin unir: el mp4 combinado (360p) que trae audio y video juntos
                with yt_dlp.YoutubeDL(ydl_opts(dict(base, format="b[ext=mp4]/b", outtmpl="c.%(ext)s"))) as y:
                    rc = y.extract_info(url, download=True)
                    merged = y.prepare_filename(rc)
                j["fmtInfo"] = "origen: %sp (#%s)" % (rc.get("height"), rc.get("format_id"))
            dst = unique(os.path.join(j["dest"], safe + ".mp4"))
            shutil.move(merged, dst)
        j["files"].append(os.path.basename(dst))
        broadcast("dlfile", {"id": j["id"], "file": os.path.basename(dst)})
        self.log(j, "guardado: " + dst)
        LIB.add_file(dst, keep=True)
        return dst


def unique(p):
    if not os.path.exists(p):
        return p
    b, e = os.path.splitext(p)
    i = 1
    while os.path.exists("%s (%d)%s" % (b, i, e)):
        i += 1
    return "%s (%d)%s" % (b, i, e)


def tag_audio(path, info, title, artist):
    """sin ffmpeg: título, artista, álbum, carátula y el ID de YouTube se escriben con mutagen"""
    try:
        if not path.lower().endswith(".m4a"):
            return
        from mutagen.mp4 import MP4, MP4Cover
        m = MP4(path)
        m["\xa9nam"] = [title]
        if artist:
            m["\xa9ART"] = [artist]
        if info.get("album"):
            m["\xa9alb"] = [info["album"]]
        if info.get("release_year") or info.get("upload_date"):
            m["\xa9day"] = [str(info.get("release_year") or info["upload_date"][:4])]
        m["\xa9cmt"] = ["https://www.youtube.com/watch?v=" + info["id"]]
        th = info.get("thumbnail")
        if th:
            data = urllib.request.urlopen(urllib.request.Request(th, headers={"User-Agent": "Petalwave"}), timeout=10).read()
            m["covr"] = [MP4Cover(data, imageformat=MP4Cover.FORMAT_PNG if data[:4] == b"\x89PNG" else MP4Cover.FORMAT_JPEG)]
        m.save()
    except Exception:  # noqa: BLE001
        traceback.print_exc()


def fmt_size(n):
    if not n:
        return ""
    for u in ("B", "KiB", "MiB", "GiB"):
        if n < 1024:
            return "%.1f%s" % (n, u) if u != "B" else "%d%s" % (n, u)
        n /= 1024
    return "%.1fTiB" % n


def fmt_eta(s):
    if not s:
        return ""
    s = int(s)
    return "%d:%02d" % (s // 60, s % 60)


# ======================= servidor HTTP =======================
def support_url(u):
    """link para donar (botón "apoyar Petalwave"): solo https y de plataformas de donación conocidas"""
    try:
        x = urllib.parse.urlparse(str(u or ""))
    except Exception:  # noqa: BLE001
        return ""
    host = (x.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    ok = host in ("cafecito.app", "mpago.la", "link.mercadopago.com.ar", "mercadopago.com.ar", "ko-fi.com", "buymeacoffee.com",
                  "liberapay.com", "paypal.me", "paypal.com", "patreon.com") or (host == "github.com" and x.path.startswith("/sponsors/"))
    return x.geturl() if x.scheme == "https" and ok else ""


def update_info(force=False):
    try:
        m = get_json("https://github.com/nahux1/PETALWAVE/releases/latest/download/latest.json")
        a = m.get("android") or {}
        latest = a.get("version") or ""
        def v(x):
            return [int(p) if p.isdigit() else 0 for p in str(x).split(".")]
        apk = {"url": a.get("url"), "sha256": a.get("sha256"), "size": a.get("size")} if a.get("url") and re.fullmatch(r"[a-f0-9]{64}", str(a.get("sha256") or "")) else None
        return {"current": APP_VERSION, "latest": latest or APP_VERSION, "hasUpdate": bool(latest) and v(latest) > v(APP_VERSION), "canAuto": False, "apk": apk,
                "page": a.get("url") or "https://github.com/nahux1/PETALWAVE/releases/latest", "notes": m.get("notes", ""), "title": "Petalwave " + (latest or APP_VERSION),
                "support": support_url(m.get("support")),
                "supportLinks": [{"name": str(x.get("name") or "")[:30], "url": support_url(x.get("url"))} for x in (m.get("supportLinks") or [])[:4]
                                 if isinstance(x, dict) and x.get("name") and support_url(x.get("url"))]}
    except Exception as e:  # noqa: BLE001
        return {"current": APP_VERSION, "error": "no se pudo consultar GitHub: " + str(e)[:120]}


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def send_json(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b)

    def body(self, raw=False):
        data = self._raw
        if raw:
            return data
        try:
            v = json.loads(data.decode("utf-8") or "{}")
            return v if isinstance(v, dict) else {}   # solo objetos: null, listas o textos no sirven
        except Exception:  # noqa: BLE001
            return {}

    def send_file(self, path, mime=None, cache="no-cache"):
        try:
            size = os.path.getsize(path)
        except OSError:
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        mime = mime or MIME.get(os.path.splitext(path)[1].lower(), "application/octet-stream")
        rng = self.headers.get("Range")
        start, end = 0, size - 1
        if rng and rng.startswith("bytes="):
            a, _, b = rng[6:].partition("-")
            if a:
                start = int(a)
                end = int(b) if b else size - 1
            elif b:
                start = max(0, size - int(b))
            end = min(end, size - 1)
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", "bytes */%d" % size)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            self.send_response(206)
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        else:
            self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Cache-Control", cache)
        self.end_headers()
        if self.command == "HEAD":
            return
        with open(path, "rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(256 * 1024, left))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    return
                left -= len(chunk)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        self.route("GET")

    def do_POST(self):
        self.route("POST")

    def do_DELETE(self):
        self.route("DELETE")

    # ---------- seguridad del servidor interno ----------
    # Solo responde a la ventana de Petalwave:
    # - clave secreta (TOKEN) que la app le pasa a su WebView como cookie y a sus propios pedidos como encabezado:
    #   otras apps del teléfono no la conocen, así que no pueden usar el servidor;
    # - Host / Sec-Fetch-Site / Origin: frenan páginas web abiertas en el navegador del teléfono.
    def denied(self):
        port = self.server.server_address[1]
        hosts = {"127.0.0.1:%d" % port, "localhost:%d" % port}
        if (self.headers.get("Host") or "").lower() not in hosts:
            return "host"
        site = self.headers.get("Sec-Fetch-Site")
        if site and site not in ("same-origin", "none"):
            return "sitio"
        origin = (self.headers.get("Origin") or "").lower()
        if origin and origin not in {"http://" + h for h in hosts}:
            return "origen"
        # la clave se pide en todo /api (ajustes, sesión, descargas…); la música y las carátulas no la necesitan
        if TOKEN and self.path.startswith("/api/"):
            got = self.headers.get("X-Petalwave-Token") or ""
            if not got:
                for part in (self.headers.get("Cookie") or "").split(";"):
                    k, _, v = part.strip().partition("=")
                    if k == "pwt":
                        got = v
            if not hmac.compare_digest(got.encode(), TOKEN.encode()):
                return "clave"
        return None

    # encabezados de seguridad en todas las respuestas (los mismos que en la versión de Windows)
    SEC_HEADERS = {
        "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: data:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
        "Cross-Origin-Opener-Policy": "same-origin",
    }

    def end_headers(self):
        for k, v in self.SEC_HEADERS.items():
            self.send_header(k, v)
        super().end_headers()

    def route(self, M):
        # se lee el pedido completo siempre: si una ruta no usa los datos y quedan sin leer,
        # arruinan el pedido siguiente que llega por la misma conexión
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = -1
        if n < 0 or n > 600 * 1024 * 1024:   # nada de pedidos gigantes (el fondo de video más grande permitido ronda los 300 MB)
            self.send_response(413)
            self.send_header("Content-Length", "0")
            self.end_headers()
            self.close_connection = True
            return
        self._raw = self.rfile.read(n) if n else b""
        why = self.denied()
        if why:
            b = ("petalwave: pedido rechazado (" + why + ")").encode("utf-8")
            self.send_response(403)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)
            return
        try:
            self._route(M)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            try:
                self.send_json(500, {"error": str(e)[:300]})
            except Exception:  # noqa: BLE001
                pass

    def _route(self, M):
        u = urllib.parse.urlparse(self.path)
        p = urllib.parse.unquote(u.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}

        # ---------- interfaz ----------
        if p in ("/", "/index.html"):
            return self.send_file(os.path.join(WWW, "index.html"), "text/html; charset=utf-8")
        if p in ("/icon.png", "/favicon.ico"):
            return self.send_file(os.path.join(WWW, "icon.png"), "image/png", "max-age=86400")
        if p.startswith("/ui/"):
            f = os.path.normpath(os.path.join(WWW, p.lstrip("/")))
            if not f.startswith(WWW + os.sep):
                return self.send_json(403, {"error": "no"})
            return self.send_file(f)

        # ---------- estado / ajustes ----------
        if p == "/api/status":
            return self.send_json(200, {"ytdlp": True, "ffmpeg": True, "ffprobe": True, "out": D["music"], "platform": "android", "android": True,
                                        "cookiesTxt": os.path.exists(D["cookies"]), "cookieExpired": False, "version": APP_VERSION,
                                        "formats": {"audio": {"m4a": {}, "mp3": {}, "opus": {}}, "video": ["1080", "720", "480", "360"]}})
        if p == "/api/sys":
            return self.send_json(200, sys_stats())
        if p == "/api/update" and M == "GET":
            return self.send_json(200, update_info())
        if p == "/api/update/apply":
            return self.send_json(400, {"error": "en Android la actualización se instala con la APK nueva"})
        if p == "/api/quit":
            return self.send_json(200, {"ok": True})
        if p == "/api/stream":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            self.wfile.write(b"retry: 2000\n\n")
            self.wfile.flush()
            with clients_lock:
                clients.append(self)
            while True:   # mantener viva la conexión
                time.sleep(25)
                try:
                    with clients_lock:
                        self.wfile.write(b": ping\n\n")
                        self.wfile.flush()
                except Exception:  # noqa: BLE001
                    with clients_lock:
                        if self in clients:
                            clients.remove(self)
                    return
        # ---------- sin internet ----------
        if p == "/api/net" and M == "GET":
            return self.send_json(200, {"online": net_online(q.get("force") == "1")})
        if p == "/api/offline" and M == "GET":
            return self.send_json(200, offline_list())
        if p == "/api/offline/save" and M == "POST":
            b = self.body()
            return self.send_json(200, {"queued": offline_save((b.get("ids") or [])[:500] if isinstance(b.get("ids"), list) else [])})
        if p == "/api/offline/remove" and M == "POST":
            b = self.body()
            return self.send_json(200, {"removed": offline_remove(b.get("ids") if isinstance(b.get("ids"), list) else [], b.get("all") is True)})
        if p == "/api/offline/config" and M == "POST":
            b = self.body()
            try:
                if b.get("maxMB"):
                    S.data["offlineMaxMB"] = max(100, min(100000, int(float(b["maxMB"]))))
                    S.save()
                    stream_prune()
            except (TypeError, ValueError):
                pass
            return self.send_json(200, offline_list())
        if p == "/api/settings" and M == "GET":
            return self.send_json(200, S.data)
        if p == "/api/settings" and M == "POST":
            b = self.body()
            if isinstance(b.get("ui"), dict):
                merged = {**S.data.get("ui", {}), **{k: v for k, v in b["ui"].items() if isinstance(k, str) and len(k) <= 64}}
                if len(json.dumps(merged)) > 1024 * 1024:
                    return self.send_json(413, {"error": "ajustes demasiado grandes"})
                S.data["ui"] = merged
            for k in ("lyricsOnline", "lyricsYtm", "videoToDownloads"):
                if isinstance(b.get(k), bool):
                    S.data[k] = b[k]
            try:
                if b.get("concurrency"):
                    S.data["concurrency"] = max(1, min(4, int(float(b["concurrency"]))))
            except (TypeError, ValueError):
                pass
            S.save()
            return self.send_json(200, S.data)

        # ---------- biblioteca ----------
        if p == "/api/library" and M == "GET":
            return self.send_json(200, {"tracks": list(LIB.tracks.values()), "plays": ST.counts(), "scan": LIB.progress, "folders": S.data.get("folders", [])})
        if p == "/api/library/rescan":
            LIB.scan()
            return self.send_json(200, {"ok": True})
        if p == "/api/library/folders" and M == "POST":
            b = self.body()
            norm = lambda x: os.path.normpath(str(x)).rstrip("/")  # noqa: E731
            if b.get("add"):
                d = norm(b["add"])
                if not os.path.isdir(d):
                    return self.send_json(400, {"error": "No se puede leer esa carpeta (" + d + "). Dale permiso a Petalwave para la música o elegí otra."})
                S.data["foldersHidden"] = [x for x in S.data.get("foldersHidden", []) if norm(x) != d]
                if not any(norm(x) == d for x in S.data["folders"]):
                    S.data["folders"].append(d)
                    if d not in S.data.setdefault("foldersExtra", []):
                        S.data["foldersExtra"].append(d)
            if b.get("remove"):
                d = norm(b["remove"])
                if d == norm(D["music"]):
                    return self.send_json(400, {"error": "Es la carpeta donde se guardan tus descargas: no se puede quitar"})
                S.data["folders"] = [x for x in S.data["folders"] if norm(x) != d]
                S.data["foldersExtra"] = [x for x in S.data.get("foldersExtra", []) if norm(x) != d]
                if d not in S.data.setdefault("foldersHidden", []):
                    S.data["foldersHidden"].append(d)
            S.save(True)
            LIB.scan()
            return self.send_json(200, {"folders": S.data["folders"]})
        if p == "/api/library/folders":
            return self.send_json(200, {"folders": S.data.get("folders", [])})
        if p == "/api/library/duplicates":
            return self.send_json(200, {"groups": []})
        m = re.fullmatch(r"/media/([0-9a-f]{16})", p)
        if m:
            t = LIB.tracks.get(m.group(1))
            return self.send_file(t["path"]) if t else self.send_json(404, {"error": "no existe"})
        m = re.fullmatch(r"/cover/([0-9a-f]{16})", p)
        if m:
            t = LIB.tracks.get(m.group(1))
            f = cover_file(t) if t else None
            if not f:
                self.send_response(404)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            return self.send_file(f, "image/png" if f.lower().endswith(".png") else "image/jpeg", "max-age=3600")
        m = re.fullmatch(r"/api/track/([0-9a-f]{16})", p)
        if m:
            t = LIB.tracks.get(m.group(1))
            return self.send_json(200, {**t, "plays": ST.counts().get(t["id"], 0)}) if t else self.send_json(404, {"error": "no existe"})
        m = re.fullmatch(r"/api/track/([0-9a-f]{16})/trash", p)
        if m and M == "POST":
            t = LIB.tracks.get(m.group(1))
            if t:
                try:
                    os.remove(t["path"])
                except OSError as e:
                    return self.send_json(400, {"error": str(e)})
                LIB.tracks.pop(t["id"], None)
                LIB.store.data["tracks"] = list(LIB.tracks.values())
                LIB.store.save()
                broadcast("library", {"count": len(LIB.tracks), "changed": 1})
            return self.send_json(200, {"ok": True})
        m = re.fullmatch(r"/api/lyrics/(yt_[\w-]{11}|[0-9a-f]{16})", p)
        if m:
            if M == "POST":
                t = LIB.tracks.get(m.group(1))
                if not t:
                    return self.send_json(404, {"error": "no existe"})
                txt = self.body(raw=True).decode("utf-8", "replace")
                open(os.path.splitext(t["path"])[0] + ".lrc", "w", encoding="utf-8").write(txt)
                return self.send_json(200, {"source": "archivo", "synced": True, "text": txt})
            return self.send_json(200, lyrics(m.group(1), q))
        if p == "/api/playlists" and M == "GET":
            return self.send_json(200, {"items": PL.data["items"]})
        if p == "/api/playlists" and M == "POST":
            try:
                return self.send_json(200, playlist_op(self.body()))
            except ValueError as e:
                return self.send_json(400, {"error": str(e)})
        if p == "/api/recognize/sig" and M == "POST":
            b = self.body() or {}
            try:
                return self.send_json(200, shazam_recognize(b.get("sig"), b.get("samplems")))
            except ValueError as e:
                return self.send_json(400, {"error": str(e)})
            except Exception as e:  # noqa: BLE001
                return self.send_json(502, {"error": str(e)})
        if p == "/api/recognize/config" and M == "GET":
            return self.send_json(200, audd_status())
        if p == "/api/recognize/config" and M == "POST":
            t = str(self.body().get("token") or "").strip()
            if t and not re.fullmatch(r"[A-Za-z0-9]{16,64}", t):
                return self.send_json(400, {"error": "Esa no parece una clave de AudD (son letras y números, la copiás de dashboard.audd.io)"})
            AUDD.data["token"] = t
            AUDD.save(True)
            return self.send_json(200, audd_status())
        if p == "/api/recognize" and M == "POST":
            audio = self.body(raw=True)
            if len(audio) < 2000 or len(audio) > 5 * 1024 * 1024:
                return self.send_json(400, {"error": "La grabación salió vacía: revisá el micrófono" if len(audio) < 2000 else "Grabación demasiado larga"})
            mime = (self.headers.get("Content-Type") or "audio/webm").split(";")[0]
            if not (mime.startswith("audio/") or mime == "video/webm"):
                return self.send_json(400, {"error": "Formato de audio no soportado"})
            try:
                return self.send_json(200, audd_recognize(audio, mime))
            except LookupError as e:
                return self.send_json(412, {"error": str(e), "needToken": True})
            except Exception as e:  # noqa: BLE001
                return self.send_json(502, {"error": str(e)})
        if p == "/api/taste" and M == "GET":
            return self.send_json(200, {"events": TASTE.data["events"]})
        if p == "/api/taste" and M == "POST":
            evs = [e for e in (clean_event(x) for x in (self.body().get("events") or [])[:200]) if e]
            TASTE.data["events"].extend(evs)
            TASTE.data["events"] = TASTE.data["events"][-6000:]
            TASTE.save()
            return self.send_json(200, {"ok": True, "n": len(evs)})
        if p == "/api/taste" and M == "DELETE":
            # ?only=listens: solo el historial de escuchas (play/skip); sin nada: todo el perfil de gustos
            if q.get("only") == "listens":
                TASTE.data["events"] = [e for e in TASTE.data["events"] if e.get("k") not in ("play", "skip")]
            else:
                TASTE.data["events"] = []
            TASTE.save(True)
            return self.send_json(200, {"ok": True})
        if p == "/api/autoplaylists":
            return self.send_json(200, {"items": ST.auto()})
        m = re.fullmatch(r"/api/similar/([0-9a-f]{16})", p)
        if m:
            return self.send_json(200, {"ids": ST.similar(m.group(1), int(q.get("n") or 25))})
        if p == "/api/stats/play" and M == "POST":
            ST.record(self.body())
            return self.send_json(200, {"ok": True})
        if p == "/api/stats":
            return self.send_json(200, ST.summary(q.get("range") or "month"))

        # ---------- descargas ----------
        if p == "/api/downloads" and M == "GET":
            return self.send_json(200, DL.list())
        if p == "/api/downloads" and M == "POST":
            b = self.body()
            urls = [str(x).strip() for x in ([b["urls"]] if isinstance(b.get("urls"), str) else b.get("urls") or [b.get("url")]) if x and re.match(r"https?://", str(x).strip())]
            if not urls:
                return self.send_json(400, {"error": "URL inválida"})
            fmt = b.get("format") if b.get("format") in ("mp3", "m4a", "opus", "mp4") else "m4a"
            ids = [DL.add(x, fmt, str(b.get("quality") or ""), b.get("playlist"))["id"] for x in urls[:200]]
            return self.send_json(200, {"ids": ids})
        m = re.fullmatch(r"/api/downloads/(\d+)/(cancel|retry|log)", p)
        if m:
            jid, act = m.groups()
            if act == "cancel":
                return self.send_json(200, {"ok": DL.cancel(jid)})
            if act == "retry":
                j = DL.retry(jid)
                return self.send_json(200, {"id": j["id"]}) if j else self.send_json(404, {"error": "no existe"})
            j = DL.jobs.get(jid)
            return self.send_json(200, {"log": j["log"] if j else []})
        if p == "/api/downloads/history" and M == "DELETE":
            rid = q.get("id")
            DL.hist.data["items"] = [x for x in DL.hist.data["items"] if (rid and x["id"] != rid) or (not rid and x.get("status") in ACTIVE)]
            DL.hist.save()
            return self.send_json(200, DL.list())

        # ---------- YouTube Music ----------
        if p.startswith("/api/ytm/"):
            try:
                if p == "/api/ytm/status":
                    return self.send_json(200, ytm("status"))
                if p == "/api/ytm/search" and not (q.get("q") or "").strip():
                    return self.send_json(200, {"items": []})
                if p == "/api/ytm/search":
                    flt = q.get("filter") if q.get("filter") in ("songs", "videos", "albums", "playlists") else "songs"
                    return self.send_json(200, {"items": annotate(ytm("search", {"q": q.get("q", "")[:200], "filter": flt, "limit": 30}, 600))})
                if p == "/api/ytm/liked":
                    return self.send_json(200, annotate_list(ytm("liked", {"limit": int(q.get("limit") or 1000)}, 60)))
                if p == "/api/ytm/playlists":
                    return self.send_json(200, {"items": ytm("playlists", {}, 60)})
                if p == "/api/ytm/history":
                    return self.send_json(200, {"items": annotate(ytm("history", {}, 30))})
                # Explorar: rankings del país, géneros y estados de ánimo (sin cuenta)
                if p == "/api/ytm/explore":
                    country = (q.get("country") or "ZZ").upper() if re.fullmatch(r"[A-Za-z]{2}", q.get("country") or "") else "ZZ"
                    return self.send_json(200, ytm("explore", {"country": country}, 21600))
                if p == "/api/ytm/mood":
                    params = q.get("params") or ""
                    if not re.fullmatch(r"[\w%=-]{4,200}", params):
                        return self.send_json(400, {"error": "categoría inválida"})
                    country = (q.get("country") or "ZZ").upper() if re.fullmatch(r"[A-Za-z]{2}", q.get("country") or "") else "ZZ"
                    return self.send_json(200, ytm("mood", {"params": params, "country": country}, 21600))
                if p == "/api/ytm/songs":
                    ids = list(dict.fromkeys(x for x in (q.get("ids") or "").split(",") if re.fullmatch(r"[\w-]{11}", x)))[:200]
                    return self.send_json(200, annotate_list(ytm("songs", {"ids": ids}, 3600)))
                m = re.fullmatch(r"/api/ytm/(playlist|album|radio)/([\w-]+)", p)
                if m:
                    kind, i = m.groups()
                    prm = {"playlist": {"id": i, "limit": 1000}, "album": {"browseId": i}, "radio": {"videoId": i, "limit": 50}}[kind]
                    return self.send_json(200, annotate_list(ytm(kind, prm, 600)))
                if p == "/api/ytm/rate" and M == "POST":
                    b = self.body()
                    r = ytm("rate", {"videoId": b.get("videoId"), "rating": "INDIFFERENT" if b.get("rating") == "INDIFFERENT" else "LIKE"})
                    _ytm_cache.clear()
                    return self.send_json(200, r)
            except PermissionError as e:
                return self.send_json(401, {"error": str(e), "auth": True})
            except Exception as e:  # noqa: BLE001
                return self.send_json(502, {"error": str(e)[:300]})
            return self.send_json(404, {"error": "no existe"})

        # ---------- streaming online ----------
        m = re.fullmatch(r"/stream/([\w-]{11})", p)
        if m:
            vid = m.group(1)
            cf = stream_cached(vid)
            if cf:
                if q.get("prefetch"):
                    return self.send_json(200, {"ok": True, "cached": True})
                rg = self.headers.get("Range") or ""
                if not rg or rg.startswith("bytes=0-"):
                    try:
                        os.utime(cf, None)
                    except OSError:
                        pass
                return self.send_file(cf, "audio/webm" if cf.endswith(".webm") else "audio/mp4")
            if vid not in _streams and not net_online():
                return self.send_json(503, {"error": "sin internet: esta canción no está guardada", "offline": True})
            try:
                c = resolve(vid)
            except Exception as e:  # noqa: BLE001
                _net["at"] = 0
                return self.send_json(502, {"error": str(e)})
            if q.get("prefetch"):
                # preparar la siguiente: si YouTube rechaza el enlace, bajarla ya para que suene enseguida
                try:
                    pu = urllib.parse.urlparse(c["url"])
                    pc = http.client.HTTPSConnection(pu.netloc, timeout=15)
                    pc.request("GET", pu.path + ("?" + pu.query if pu.query else ""), headers={"Range": "bytes=0-0"})
                    st = pc.getresponse().status
                    pc.close()
                    if st in (403, 410):
                        stream_file(vid)
                except Exception:  # noqa: BLE001
                    pass
                return self.send_json(200, {"ok": True})
            cf = stream_cached(vid)
            if cf:
                return self.send_file(cf, "audio/webm" if cf.endswith(".webm") else "audio/mp4")
            return self.proxy(vid, c)
        m = re.fullmatch(r"/ytcover/([\w-]{11})", p)
        if m:
            vid = m.group(1)
            f = os.path.join(D["data"], "covers", "yt_" + vid + ".jpg")
            if not os.path.exists(f):
                for url in [thumbs.get(vid), "https://i.ytimg.com/vi/%s/hqdefault.jpg" % vid]:
                    if not url:
                        continue
                    try:
                        data = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Petalwave"}), timeout=10).read()
                        os.makedirs(os.path.dirname(f), exist_ok=True)
                        open(f, "wb").write(data)
                        break
                    except Exception:  # noqa: BLE001
                        continue
            return self.send_file(f, "image/jpeg", "max-age=86400")

        # ---------- sesión, fondo, y lo que todavía no está en Android ----------
        if p == "/api/cookies" and M == "POST":
            txt = self.body(raw=True).decode("utf-8", "replace")
            n = len([ln for ln in txt.splitlines() if "youtube.com" in ln])
            if not n:
                return self.send_json(400, {"error": "ese archivo no tiene cookies de youtube.com"})
            open(D["cookies"], "w", encoding="utf-8").write(txt)
            _ytm_cache.clear()
            broadcast("cookies", {"has": True, "expired": False})
            return self.send_json(200, {"ok": True, "count": n})
        if p == "/api/cookies" and M == "DELETE":
            try:
                os.remove(D["cookies"])
            except OSError:
                pass
            _ytm_cache.clear()
            broadcast("cookies", {"has": False, "expired": False})
            return self.send_json(200, {"ok": True})
        wp = [os.path.join(D["data"], "wallpaper." + e) for e in ("jpg", "png", "webp", "gif", "mp4", "webm")]
        if p == "/wallpaper":
            f = next((x for x in wp if os.path.exists(x)), None)
            return self.send_file(f) if f else self.send_json(404, {})
        if p == "/api/wallpaper" and M == "GET":
            f = next((x for x in wp if os.path.exists(x)), None)
            ext = os.path.splitext(f)[1][1:] if f else None
            return self.send_json(200, {"has": bool(f), "ext": ext, "kind": None if not f else "video" if ext in ("mp4", "webm") else "gif" if ext == "gif" else "image", "size": os.path.getsize(f) if f else 0})
        if p == "/api/wallpaper" and M == "POST":
            data = self.body(raw=True)
            if not data:
                return self.send_json(400, {"error": "El archivo llegó vacío"})
            # el selector de Android a veces no manda el tipo: se mira el contenido del archivo
            h = data[:16]
            ext = ("jpg" if h[:3] == bytes.fromhex("ffd8ff") else "png" if h[:4] == bytes.fromhex("89504e47") else "gif" if h[:4] == b"GIF8"
                   else "webp" if h[:4] == b"RIFF" and h[8:12] == b"WEBP" else "webm" if h[:4] == bytes.fromhex("1a45dfa3")
                   else "mp4" if h[4:8] == b"ftyp" and h[8:12] not in (b"heic", b"heix", b"mif1", b"msf1", b"avif") else None)
            if not ext:
                ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/webm": "webm"}.get((self.headers.get("Content-Type") or "").split(";")[0])
            if not ext:
                heic = h[4:8] == b"ftyp"
                return self.send_json(400, {"error": "Formato no soportado" + (" (HEIC/AVIF): elegí una foto JPG o PNG" if heic else ": usá JPG, PNG, WEBP, GIF, MP4 o WEBM")})
            for x in wp:
                if os.path.exists(x):
                    os.remove(x)
            open(os.path.join(D["data"], "wallpaper." + ext), "wb").write(data)
            return self.send_json(200, {"ok": True})
        if p == "/api/wallpaper" and M == "DELETE":
            for x in wp:
                if os.path.exists(x):
                    os.remove(x)
            return self.send_json(200, {"ok": True})
        if p == "/api/sync" and M == "GET":
            return self.send_json(200, {"sources": [], "auto": 0, "format": "m4a", "quality": "", "state": {"running": False, "queue": [], "lastRun": 0, "lastResult": None}, "hasCookies": os.path.exists(D["cookies"]), "android": True})
        if p.startswith("/api/sync") or p == "/api/yt/inspect":
            return self.send_json(400, {"error": "La sincronización automática todavía no está en Android: usá la versión de Windows."})
        if p == "/api/spotify/status":
            return self.send_json(200, {"configured": False, "clientId": "", "connected": False, "user": None, "redirectUri": "", "android": True})
        if p.startswith("/api/spotify/"):
            return self.send_json(400, {"error": "Spotify todavía no está en Android: usá la versión de Windows."})
        if p in ("/api/open", "/api/import") or p.endswith("/reveal") or p.endswith("/meta"):
            return self.send_json(400, {"error": "Esto todavía no está en Android."})
        return self.send_json(404, {"error": "no existe"})

    def proxy(self, vid, c, retry=True):
        u = urllib.parse.urlparse(c["url"])
        conn = http.client.HTTPSConnection(u.netloc, timeout=30)
        hd = {k: v for k, v in (c.get("headers") or {}).items() if k.lower() in ("user-agent", "accept-language")}
        if self.headers.get("Range"):
            hd["Range"] = self.headers["Range"]
        conn.request("GET", u.path + ("?" + u.query if u.query else ""), headers=hd)
        r = conn.getresponse()
        if r.status in (403, 410) and retry:
            r.read()
            conn.close()
            return self.proxy(vid, resolve(vid, force=True), retry=False)
        if r.status in (403, 410):   # YouTube sigue rechazando el enlace: bajarla entera con yt-dlp y servirla del disco
            r.read()
            conn.close()
            try:
                f = stream_file(vid)
            except Exception as e:  # noqa: BLE001
                return self.send_json(502, {"error": str(e)[:200]})
            return self.send_file(f, "audio/webm" if f.endswith(".webm") else "audio/mp4")
        self.send_response(r.status)
        for k in ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"):
            if r.getheader(k):
                self.send_header(k, r.getheader(k))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            while True:
                chunk = r.read(64 * 1024)
                if not chunk:
                    break
                self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        finally:
            conn.close()


def sys_stats():
    try:
        mem = {}
        with open("/proc/meminfo") as fh:   # cerrar el archivo (antes quedaba abierto cada vez que se pedían los datos)
            for ln in fh:
                k, v = ln.split(":", 1)
                mem[k] = int(v.split()[0])
        tot, free = mem.get("MemTotal", 1), mem.get("MemAvailable", 0)
        return {"cpu": 0, "ram": round(100 * (1 - free / tot)), "ramUsed": (tot - free) // 1024, "ramTotal": tot // 1024, "host": "android", "appMem": 0}
    except Exception:  # noqa: BLE001
        return {"cpu": 0, "ram": 0, "ramUsed": 0, "ramTotal": 0, "host": "android", "appMem": 0}


httpd = None


def start(data_dir, music_dir, video_dir, version="0.0.0", port=37373, scan_dirs=None, token=""):
    """la llama MainActivity (Kotlin) al abrir la app; devuelve cuando el servidor ya escucha"""
    global S, LIB, ST, PL, DL, httpd, APP_VERSION, TOKEN, TASTE, AUDD
    if httpd:
        return port
    APP_VERSION = version
    TOKEN = str(token or "")
    D.update(data=data_dir, music=music_dir, video=video_dir, cookies=os.path.join(data_dir, "cookies.txt"))
    for d in (data_dir, music_dir, video_dir):
        os.makedirs(d, exist_ok=True)
    S = JsonStore(os.path.join(data_dir, "settings.json"), lambda: {})
    S.data.setdefault("ui", {})
    S.data.setdefault("concurrency", 2)
    S.data.setdefault("lyricsOnline", True)
    S.data.setdefault("lyricsYtm", True)
    S.data.setdefault("videoToDownloads", True)
    S.data["downloadDir"], S.data["videoDir"] = music_dir, video_dir
    # carpetas: la de descargas siempre + Música y Descargas del teléfono (salvo que las quites) + las que agregues
    hidden = set(S.data.get("foldersHidden", []))
    base = [music_dir] + [d for d in list(scan_dirs or []) if d not in hidden] + list(S.data.get("foldersExtra", []))
    S.data["folders"] = list(dict.fromkeys(d for d in base if d and os.path.isdir(d)))
    S.save()
    LIB, ST, DL = Library(), Stats(), Downloads()
    PL = JsonStore(os.path.join(data_dir, "playlists.json"), lambda: {"items": []})
    TASTE = JsonStore(os.path.join(data_dir, "taste.json"), lambda: {"events": []})
    AUDD = JsonStore(os.path.join(data_dir, "audd.json"), lambda: {"token": ""})
    httpd = ThreadingHTTPServer(("127.0.0.1", port), H)
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    threading.Timer(3.0, LIB.scan).start()   # la interfaz primero; las canciones nuevas se buscan enseguida
    return port


if __name__ == "__main__":   # para probar en la PC: python -m petalwave.server
    import sys
    base = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.expanduser("~"), "petalwave-android-test")
    start(os.path.join(base, "data"), os.path.join(base, "Music"), os.path.join(base, "Movies"), "0.0.0-pc", int(os.environ.get("PORT", "37373")), token=os.environ.get("PW_TOKEN", ""))
    print("Petalwave Android (prueba) en http://127.0.0.1:%s" % os.environ.get("PORT", "37373"), flush=True)
    while True:
        time.sleep(3600)
