# Proceso aparte (Windows) que deja yt-dlp cargado en memoria para encontrar el audio de las canciones online.
# Arrancar yt-dlp.exe para cada canción tarda ~4 s; con yt-dlp ya cargado acá, ~1 s.
# Lee pedidos JSON por stdin (uno por línea) y responde por stdout; atiende hasta 3 canciones a la vez.
# Si algo falla, el servidor vuelve a usar yt-dlp.exe como siempre (src/stream.js).
import json
import os
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "lib", "py"))
sys.stdout.reconfigure(encoding="utf-8")
sys.stdin.reconfigure(encoding="utf-8")

import yt_dlp  # noqa: E402

COOKIES = sys.argv[1] if len(sys.argv) > 1 else ""
NODE = sys.argv[2] if len(sys.argv) > 2 else ""
FORMAT = "bestaudio[format_id=141]/bestaudio[ext=m4a]/bestaudio/best[acodec!=none]/best"
_local = threading.local()
_out = threading.Lock()


def ydl(mode):
    """un YoutubeDL por hilo y por modo (no se comparten entre hilos); se rehace si cambia cookies.txt"""
    has = bool(COOKIES) and os.path.exists(COOKIES)
    key = (mode, os.path.getmtime(COOKIES) if has and mode == "cookies" else 0)
    cache = getattr(_local, "y", None)
    if cache is None:
        cache = _local.y = {}
    if key not in cache:
        o = {"quiet": True, "no_warnings": True, "noprogress": True, "format": FORMAT, "socket_timeout": 20, "noplaylist": True}
        if NODE:
            o["js_runtimes"] = {"node": {"path": NODE}}
        if mode == "cookies" and has:
            o["cookiefile"] = COOKIES
        if mode == "alt":
            o["extractor_args"] = {"youtube": {"player_client": ["tv", "mweb", "web_safari"]}}
        for k in [k for k in cache if k[0] == mode]:
            cache.pop(k, None)
        cache[key] = yt_dlp.YoutubeDL(o)
    return cache[key]


def handle(req):
    rid = req.get("id")
    try:
        p = req.get("params") or {}
        vid = str(p.get("id") or "")
        if not re.fullmatch(r"[\w-]{11}", vid):
            raise ValueError("id de YouTube inválido")
        mode = p.get("mode") if p.get("mode") in ("cookies", "plain", "alt") else "plain"
        info = ydl(mode).extract_info("https://music.youtube.com/watch?v=" + vid, download=False)
        out = {"id": rid, "result": {"url": info.get("url") or ""}}
    except Exception as e:  # noqa: BLE001
        out = {"id": rid, "error": (str(e) or e.__class__.__name__)[:600]}
    with _out:
        sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    pool = ThreadPoolExecutor(3)
    for raw in sys.stdin:
        raw = raw.strip().lstrip("﻿")
        if not raw:
            continue
        try:
            pool.submit(handle, json.loads(raw))
        except Exception:  # noqa: BLE001
            pass
