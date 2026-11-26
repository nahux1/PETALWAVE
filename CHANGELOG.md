# petalwave — registro de cambios

## 2.23.0 — modo DJ, radios, podcasts, letras sin internet y repetidas mejoradas
- **Modo DJ** (`ui/js/dj.js`):
  - Cada canción se decodifica a 11 kHz (`OfflineAudioContext`). De ahí sale la curva de golpes (subidas de energía, con más peso en los graves).
  - El tempo sale de una autocorrelación con preferencia por ~122 BPM y se afina comparando golpes a 16 pulsos. También se miden la fase del golpe, el primer sonido y la energía. Se guarda en `localStorage` `pw-dj` (v2).
  - Con tonos de prueba conocidos, el tempo da ±0,05 BPM y la fase ±10 ms.
  - En el cruce, `player.setTransition()` espera el próximo golpe y pasa `rate` y `startAt` a `engine.load()`. `playbackRate` usa `preservesPitch` y vuelve a 1 en 12 s.
  - Cada reproductor tiene un `lowshelf` de 180 Hz para cambiar los graves en el cruce. Cuando ya suenan las dos, `align()` mide el corrimiento y mueve la que entra.
  - Medido en canciones reales: 0 a 24 ms de diferencia. `djOrder()` ordena lo que queda de la cola por tempo (con mitad y doble) y energía.
- **Radios y podcasts** (`src/cast.js`, `server.py`, `ui/js/cast.js`):
  - `/cast/<clave>` sirve el audio o la imagen de una dirección registrada antes con `/api/cast/reg`, así no queda un proxy abierto. Se rechazan direcciones locales y privadas. Respeta `Range` y sigue redirecciones.
  - Otras rutas: `/api/cast/fetch` (feeds y JSON, hasta 8 MB, con el charset correcto), `/api/cast/meta/<clave>` (StreamTitle ICY) y `/api/cast/save|saved|remove` (capítulos en `data/podcasts`, servidos desde el disco).
  - Las radios salen de Radio Browser y los podcasts de Apple Podcasts (búsqueda, populares por país y lookup) más el RSS de cada uno.
  - Ids: `rd_<clave>` y `pc_<clave>` (`core.isCast`, `mediaUrl`, `coverUrl`). `NativeService.kt` también los entiende.
  - Siguiendo un podcast, cada 3 h se miran los capítulos nuevos y se guardan (con WiFi en Android). La posición de cada capítulo se guarda en `pw-podpos`.
  - Ni las radios ni los podcasts suman música a la cola infinita.
- **Letras sin internet:**
  - `?off=1` en `/api/lyrics` usa solo la caché, sin esperar a YouTube Music ni a LRCLIB.
  - En Android, un error de red ya no se guarda como "no hay letra".
  - `offline.js` pide la letra a los 20 s de cada canción y al guardar canciones. El botón "guardar letras de todo" está en la ventana ✈ y el contador de letras en `pw-lyr-saved`.
- **Repetidas** (`ui/js/tidy.js` `findDupes`/`bestOf`/`onlineTwins`):
  - Detección: nombres limpios, el mismo título con artista desconocido y duración casi igual, y unión con lo que encuentra el servidor.
  - Marca la mejor copia con ★. "Dejar solo la mejor" cambia las playlists antes de mandar el resto a la papelera, y hay un botón para cambiar las canciones online de las playlists por tus archivos.
- Textos nuevos en inglés y portugués (93). Pruebas automáticas: 27, con 3 nuevas de seguridad de `/cast`.

## 2.22.1 — arreglo: canciones online en el celular
- **Android (`server.py`):** `/stream/<id>` ya no llama a `net_online()` antes de resolver. Solo lo hace si `resolve()` falló, para responder 503 "sin internet" en vez de 502. `net_online()` prueba primero `http://connectivitycheck.gstatic.com/generate_204` (la de Android), con 8 s de espera en vez de 4.
- **PC (`src/stream.js`):** igual. `proxy`/`warm` cortan antes solo si la última prueba (menos de 20 s) dio sin internet; si no, intentan, y al fallar se vuelve a probar.
- **`ui/js/offline.js`:** pasa a "sin internet" con 2 fallos seguidos de `/api/net` o con `navigator.onLine === false`. Si el servidor no contesta, no cuenta como falta de internet.
- **`ui/js/theme.js`:** los colores de la carátula usan `coverUrl()` (las online están en `/ytcover/`; antes daba 404).
- Probado en el emulador con la 1.17.1: canciones online con internet, modo avión (503 en 2,7 s) y vuelta a la normalidad.

## 2.22.0 — idiomas, escuchar juntos, control remoto, alarma, karaoke, ordenar, Discord y Last.fm
- **Idiomas** (`ui/js/i18n.js` + `i18n-data.js`, ~1250 textos ES→EN/PT):
  - Se traduce al mostrarse, en el mismo recorrido de `caps.js`, que saltea títulos, artistas, letras y campos.
  - Hay plantillas para textos con números y prefijos ("conectado como …").
  - El idioma se guarda en `localStorage` `pw-lang`; si no hay, se toma `navigator.language`. Ajustes → idioma.
- **Escuchar juntos** (`ui/js/party.js`):
  - WebRTC DataChannel (STUN de Google y Cloudflare). La señal va por ntfy.sh con mensajes AES-GCM derivados del código de la sala (SHA-256).
  - El anfitrión manda `np` (ytId, posición, play) al cambiar y cada 5 s; los invitados reproducen `yt_<id>` y corrigen si se desfasan más de 2,5 s.
  - Chat retransmitido por el anfitrión. `/pedir` busca en YTM y hace `playNext`.
  - Se probó con dos copias: sincronía, chat y pedido.
- **Control remoto** (`src/remote.js` + `ui/remote.html` + `ui/js/remotectl.js`):
  - Servidor aparte en `0.0.0.0:3738` (el principal sigue en 127.0.0.1). La clave de 128 bits va en el `#` del QR, se compara en tiempo constante y hay bloqueo tras 10 fallos.
  - Expone `/r/state`, `/r/cmd` (lista blanca) y `/r/cover` (proxy de la portada). La interfaz manda el estado y recibe los comandos por SSE `remote`.
- **Alarma** (`ui/js/alarm.js`): días, fuente, subida de volumen, posponer.
  - Android: `AlarmManager.setAlarmClock` → `pw_cmd=alarm` con la clave del widget, y `setShowWhenLocked`/`setTurnScreenOn`. Permisos `USE_EXACT_ALARM` y `SCHEDULE_EXACT_ALARM` (≤32).
- **Karaoke palabra por palabra:** usa los tiempos `<mm:ss>` del LRC si vienen; si no, los estima por el largo de cada palabra (`.lw`, `--wp`).
- **Traducción de letras:** MyMemory (`autodetect|<idioma>`), en tramos de ≤480 caracteres, con caché de 60 canciones en `localStorage`.
- **Ordenar mi música** (`ui/js/tidy.js`): portadas que faltan (YTM), nombres desprolijos y duplicados. `Library.setCover()` usa ffmpeg con `attached_pic` sin recodificar. `POST /api/track/<id>/cover` acepta `{url}` (solo googleusercontent/ytimg/ggpht) o `{data}`.
- **Discord** (`src/discord.js`): IPC por `\\?\pipe\discord-ipc-N`, `SET_ACTIVITY` tipo 2 (escuchando), portada de YTM o i.ytimg. Necesita el Application ID del usuario.
- **Last.fm** (`ui/js/integrations.js` + `md5.js`): desde la interfaz (CORS permitido).
  - Usa `auth.getToken` → autorización → `auth.getSession`.
  - Hace `updateNowPlaying`, `scrobble` en tandas de 50 con cola sin conexión, y love/unlove con ♥.
- **Widget grande de Android** (`PlayerWidgetBig`, `widget_big.xml`): ♥ y aleatorio. La interfaz manda `liked`/`shuffle`.
- **CSP** `connect-src`: suma ws.audioscrobbler.com, ntfy.sh y api.mymemory.translated.net (Windows y Android).
- `tools/firmar-instalador.md`: opciones para firmar el instalador (SignPath, Certum, Azure).

## 2.21.0 — sin internet
- **Lo guardado = `data/stream-cache`** (la caché que ya existía para cuando YouTube rechaza el enlace). Límite configurable (`offlineMaxMB`; 1 GB en Windows y 500 MB en Android por defecto). LRU por mtime, que se renueva al empezar a sonar.
- **Servidores (Node y Android):**
  - `GET /api/net`: HEAD a `music.youtube.com/generate_204` o google, guardado 20 s.
  - `GET /api/offline` → `{ids, bytes, maxMB, saving}`.
  - `POST /api/offline/save|remove|config`: guarda de a una en segundo plano con yt-dlp.
  - `/stream/<id>` sin internet y sin guardar → 503 al instante (antes yt-dlp tardaba hasta un minuto en rendirse). `warm` tampoco intenta.
- **Android:** `/stream/<id>` ahora sirve lo guardado *antes* de resolver en YouTube (sin internet fallaba aunque estuviera guardada).
- **`ui/js/offline.js`:**
  - Estado de la red (`/api/net` cada 45 s, eventos `online`/`offline` y error de una canción online).
  - `isOffline()`, `playable(t)` y `offlineIds()`.
  - Pastilla `#tOff` y panel ✈ (contadores, escuchar todo mezclado, modo sin internet).
  - Filas `[data-warm]` apagadas (`.pw-nooff`) con un MutationObserver.
  - Auto-guardado a los 30 s (`offlineAuto`; en Android con datos, solo con `offlineWifi` apagado).
  - `saveOffline`/`removeOffline`.
- **`player.js`:** `setGate(fn)`. `start` y `next` saltean lo que no se puede escuchar, y si no queda nada se emite `ended-queue`.
- **Cola infinita sin internet:** sin radio ni recomendaciones online; solo biblioteca y lo guardado.
- **Biblioteca:** botón *✈ guardar sin internet* en listas de YTM y en el menú de canciones online. Ajustes → nueva sección *sin internet* (`#cfg-offline`, se abre con `bus.emit('open-settings', 'offline')`). Las descargas inteligentes no corren con el modo sin internet.

## 2.20.0 — MP3 o MP4 al descargar y cola infinita
- **`ui/js/dlpick.js`:** `chooseFormat(n, title)` abre un modal con MP3 (`dl.quality`, por defecto 320) o MP4 (`dl.vquality`, por defecto 1080p) y devuelve `{format, quality, cookies}`, o `null` si se cancela. "Recordar" guarda `dlAsk: false` + `dlPick`. Lo usan todas las descargas: biblioteca (lista y menú), YouTube Music, lo que falta de Spotify y *¿qué suena?*. Antes MP4 se forzaba a MP3.
- **Ajustes → descargas:** "preguntar MP3 o MP4 al descargar" y "si no pregunta, bajar en".
- **Cola infinita** (`topUpQueue` en `ui/js/app.js`): cuando quedan ≤2 canciones (`np`) o la cola termina (`ended-queue`) suma hasta 12. Las fuentes, en orden: radio de YTM de la canción actual (10 s) → `recsOnline` (12 s) → `recsLocal(40)` → al azar de la biblioteca. Evita las últimas 80 de la cola y 120 del historial, con una sola búsqueda a la vez. "Siguiente" en la última también suma (`player.next`). `addQueue(ids, {silent})` sin toast. Con `repeat` ≠ off no hace nada; `autoRecs` pasa a llamarse "cola infinita" en ajustes.

## 2.19.0 — canciones online más rápidas
- **Medido:** en Windows, encontrar el audio con `yt-dlp.exe` tardaba ~4 s por canción (~1 s solo en arrancar). El modo `player_skip=webpage` ahorraba 1,5 s, pero YouTube pide "no soy un robot" en algunas canciones, así que se descartó.
- **`src/resolve_bridge.py`:** proceso Python persistente con `yt_dlp` en memoria (en `lib/py`, misma versión que el exe). Atiende 3 canciones a la vez, con un YoutubeDL por hilo y por modo, y resuelve en ~1 s. `Streamer.resolveFast()` lo usa primero; si no está o falla, vuelve a `yt-dlp.exe`. Se cierra tras 15 minutos sin uso (~60 MB).
- **`YTM` (`src/ytm.js`)** sirve para cualquier puente Python (`script`, `need`, `args`).
- **Preparar al apuntar:** las canciones online tienen `data-warm="<id>"` (Explorar, Inicio, buscador, biblioteca). Con el mouse encima 300 ms o al apoyar el dedo se pide `?prefetch=1`, con hasta 2 a la vez. Con el mouse 4 s antes, el clic suena en 0,06 s.
- **Android:** `resolve()` con un candado por canción: el prefetch y el play de la misma canción comparten una sola búsqueda.

## 2.18.0 — mini reproductor nuevo y arreglo en Android
- **Mini reproductor** (`build/Launcher.cs` + `ui/js/app.js` + `index.html`):
  - `MainForm` intercepta SC_MINIMIZE: con `minimizeTo: 'mini'` la ventana se anima (cúbica, 340 ms) hasta una pastilla sin bordes, con esquinas redondeadas (DWM) y siempre visible.
  - Al pasar el mouse la interfaz manda `mini:grow`/`mini:shrink` y la ventana se anima a tarjeta y vuelta (arriba crece hacia abajo, abajo crece hacia arriba).
  - Posición: `miniPos` (6 lugares o `free`), y `mini:drag` mueve la ventana con WM_NCLBUTTONDOWN; solo cuenta si se movió. El punto libre se guarda en `data/mini.txt`.
  - La interfaz cambia de pastilla a tarjeta con `@media (min-height:140px)`. Doble clic vuelve a la ventana grande.
  - `/define:PWTEST` compila un launcher de prueba (puerto 3743, otra ventana única y otros datos) para probar con Petalwave abierto.
- **Android y apoyo** (lo que iba a ser la 2.17.1):
- **Android:** el `MediaSession` de `PlayerService` mandaba "toggle" tanto para `onPlay` como para `onPause`. Un "play" del sistema, los auriculares o el Bluetooth mientras la canción cargaba la pausaba (AbortError + salto). Ahora manda "play"/"pause", y la interfaz solo actúa si hace falta. Probado en el emulador con KEYCODE_MEDIA_PLAY/PAUSE/PLAY_PAUSE.
- **Reproductor:** un `play()` rechazado por AbortError o NotAllowedError queda en pausa en vez de contar como error y saltar.
- **Apoyar:** `supportLinks` (varios links) en `latest.json`, `tools/support.json` con Cafecito y Patreon, y `patreon.com` permitido en los dos servidores. También en la web y el README.

## 2.17.0 — instalador, web, feedback y apoyo
- **Instalador** (`build/Installer.cs` → `release/Instalar-Petalwave.exe` con `build/build-installer.bat`):
  - Baja `latest.json` → zip completo (solo de GitHub) y verifica el SHA-256, que ahora trae `full.sha256` en el manifiesto.
  - Instala en `%LOCALAPPDATA%\Programs\petalwave` (si ya existía, actualiza sin tocar `data/` ni `descargas/`), crea los accesos directos y se registra en "Aplicaciones instaladas".
  - `/uninstall` pregunta si borrar los datos. Para pruebas: `PW_INSTALL_ROOT` + `PW_INSTALL_MANIFEST` + `/silent`.
- **Página web** en `docs/` (GitHub Pages): video, capturas, descargas directas con nombres fijos (`latest/download/Instalar-Petalwave.exe`, `Petalwave-android.apk`) y preguntas frecuentes.
- **Errores e ideas:** formularios de GitHub (`.github/ISSUE_TEMPLATE`) y botones en ajustes → acerca de (con la versión completada).
- **Releases:** `tools/release-body.js` agrega un bloque estándar de descargas, `tools/notes/_plantilla.md` da el formato de las notas, y `tools/publicar.ps1` sube todo (también el APK con nombre fijo y el instalador).
- **Video promocional** de 30 s (11 diapositivas) y más capturas por sección.
- **`ui/js/support.js`:** botón "apoyar Petalwave" sin nada exclusivo.
  - El link viene en `latest.json` (`support`, desde `tools/support.json` al armar el manifiesto), así se cambia sin sacar versión.
  - Los dos servidores solo aceptan https de plataformas de donación conocidas (Cafecito, Mercado Pago, Ko-fi, GitHub Sponsors, PayPal…).
  - Recordatorios: nunca la primera semana, como mucho uno cada 60 días (después de actualizar o a las 100 horas escuchadas); se apagan con `supportAsk`. También aparece en "Tu año".
- **README:** capturas en `docs/capturas`.
- **Herramientas:**
  - `tools/descargas.bat`: descargas por versión.
  - `tools/promo/armar-video.bat`: video vertical para redes, con el texto para publicar en `tools/promo/texto-para-publicar.txt`.

## 2.16.0 — efectos con la música
- **`ui/js/musicfx.js`:** detecta los golpes con el analizador de graves.
  - El analizador da decibeles, así que un golpe es un salto de +13 o más sobre el mínimo de los últimos 150 ms, con 200 ms entre golpes.
  - Mueve `#wp` y `#bgfx` con `translate`/`scale` (sacudida, pulso) y la opacidad de `#mfxFlash`/`#mfxVig` (destello, viñeta). Opcional: `#shell` al 30%.
- **Preferencias:** `mfxOn`, `mfxShake`, `mfxZoom`, `mfxFlash`, `mfxVig`, `mfxWin`, `mfxAmt`. Interruptor también en la galería de fondos.
- **Se frena** en pausa, oculto, en modo mini, en máximo rendimiento y con "sin animaciones". No usa `prefers-reduced-motion` porque tiene su propio interruptor; muchos Windows lo tienen activado solo por rendimiento.

## 2.15.0 — historial y adaptación
- **Historial** (`ui/js/history.js`, vista `hist` de la biblioteca): escuchas y saltos de las señales de gustos, por día, con hora y cuánto sonó; filtros, búsqueda, volver a escuchar y borrar.
  - `DELETE /api/taste?only=listens` (los dos servidores) borra solo `play`/`skip`; `forgetListens()` en taste.js.
- **Adaptación** (`ui/js/adapt.js`):
  - `dominantLook()` busca en el perfil el estilo que domina (6 grupos) y propone tema + fondo. Pide al menos 6 positivos y un ganador claro.
  - Preferencia `adaptLook`: `suggest` | `auto` | `off`. Como máximo un cambio cada 3 días; nunca toca un fondo propio.
  - "Lo que más abrís": `recordNav()` anota las vistas abiertas (con olvido ×0,97) y Inicio muestra las 6 más usadas.
- Pruebas: borrar el historial deja los me gusta (24).

## 2.14.0 — fondos de pantalla incluidos
- **Galería** (`ui/js/wallgallery.js`): 9 escenas SVG generadas con los colores del tema (cerezo, montañas, atardecer, ciudad, mar, bosque, planeta, vinilo, degradado). Se rehacen al cambiar de tema.
- **Animados:** escena + efecto en vivo de `bgfx.js`. Efectos nuevos: `sakura`, `grid`, `fireflies`, `drizzle`, `snow` (también elegibles sueltos en "fondo animado").
- **Preferencia `wpPick`:** `auto` (el propio si hay; si no, "lluvia de pétalos"), `mine`, `none` o un id de la galería. Subir un fondo propio la pone en `mine`.
- El efecto elegido en "fondo animado" tiene prioridad sobre el del fondo incluido. En máximo rendimiento los incluidos quedan quietos.
- Galería en el botón de wallpaper, en ajustes → personalizar y en la bienvenida.

## 2.13.0 — Explorar y gustos
- **Explorar** (`ui/js/explore.js`, workspace `explore`): rankings por país, artistas populares y ánimos/géneros, sin cuenta.
  - Puente: `m_explore` y `m_mood` en `src/ytm_bridge.py`, con un lector de tarjetas propio (el `get_mood_playlists` de ytmusicapi se rompe con el diseño nuevo de YouTube).
  - Rutas `/api/ytm/explore?country=` (caché 6 h) y `/api/ytm/mood?params=&country=` (parámetros validados) en los dos servidores.
  - Se ordena por gustos: `affinity()` cruza el perfil con un mapa de estilos parecidos (`RELATED`, p. ej. phonk → energía/ejercicio).
- **Gustos desde el día uno:**
  - Paso "¿qué te gusta?" en la bienvenida y en ajustes → mis gustos (`askTaste`), con señales `seed` (peso 1,5).
  - *Descubrí* sin historial busca por géneros elegidos y, si falta, usa el ranking del país.
  - El inicio ordena sus secciones por uso (`P.homeUse`) y suma "Lo más escuchado".
- **Streaming:** si YouTube rechaza el enlace directo (403) recién resuelto, la canción se baja con yt-dlp a `data/stream-cache` (400 MB en Windows, 300 MB en Android) y se sirve con Range. La precarga (`?prefetch=1`) prueba el enlace y, si lo rechaza, la baja antes.
- **Reproductor:** un error de reproducción se cuenta una sola vez por canción (antes saltaba dos), y los avisos de una canción anterior (fin, error) se ignoran, así no se saltean varias seguidas.
- **¿Qué suena? propio:** `ui/js/fingerprint.js` arma la huella (FFT de 2048, picos en 4 bandas, mismo formato de firma que SongRec) y `/api/recognize/sig` la consulta sin clave en los dos servidores. AudD queda de respaldo si hay clave.
- **Gustos:** botón 👎 en el reproductor (`data-act="dislike"`, señal `nope` + siguiente) y ✕ "no me interesa" en las filas de recomendaciones.
- **Navegación:** opción `navKeyStyle` (números o letras H, E, B, L, D, I, E, C).
- **Memoria:** `/api/sys` suma todos los procesos de Petalwave (ventana, WebView2, Node, Python) sin contar al PowerShell que mide.
- **Volumen:** la barra se actualiza también al usar la ruedita.

## 2.12.0 — motor nativo (beta) y Android Auto
- **Android 1.7.0: motor nativo** (`NativeService.kt`, `ui/js/nativeengine.js`), opcional en ajustes → reproducción. Se activa con `PetalwaveNative.nativeEngine` y se aplica al reiniciar.
  - **Reproductor:** ExoPlayer (Media3 1.4.1) en un `MediaLibraryService`.
  - **Cola:** la interfaz manda la canción actual con hasta 20 anteriores y 80 siguientes (`nPlay`). Los cambios de cola se sincronizan sin cortar lo que suena (`nSync`).
  - **Estado:** el servicio avisa cada segundo y en cada cambio (`nstate:`). Si pasa solo a otra canción, la interfaz la adopta sin recargarla (`eng:advance`).
  - **Mismos controles que el motor de siempre**, así el resto de la interfaz no cambia.
  - **Ecualizador de Android:** las 10 bandas se interpolan a las bandas del teléfono.
  - **Visualizador:** usa el `Visualizer` de Android (necesita el permiso de micrófono).
  - **Sin** fundido ni volumen parejo por ahora.
- **Android Auto:** `MediaLibrarySession` con carpetas (me gusta, recién agregadas, playlists, todas). Al elegir una canción sigue el resto de la carpeta. El servicio arranca el servidor interno solo.
  - `onConnect` solo acepta a Petalwave, apps de confianza del sistema, Android Auto, el Asistente y Wear.
  - El manifiesto declara `automotive_app_desc` (media).
- **Cambiar de motor** apaga el otro servicio (antes quedaban dos notificaciones).
- **Arreglos encontrados probando en el emulador de Android 14:**
  - El ecualizador y el visualizador nativos no se conectaban: ExoPlayer crea la sesión de audio antes de que llegue el aviso.
  - El servidor de Android dejaba `/proc/meminfo` abierto en cada consulta.
- **Versión de prueba (debug):** permite inspeccionar la WebView desde la PC. La publicada no está marcada como depurable.

## 2.11.0 — comodidad
- **Bienvenida** (`ui/js/welcome.js`): 3 pasos la primera vez (tema, de dónde sale la música, consejos). No aparece si ya había música o escuchas.
- **Pantallas vacías** (`emptyState` en `core.js`) con botones para descargar, agregar carpeta o buscar; en biblioteca, recomendaciones, playlists y cola.
- **Celular:** deslizar una canción a la derecha la pone en la cola; a la izquierda le da ♥.
- **Cola:**
  - Hoja desde abajo en el celular (☰ en pantalla completa).
  - "Deshacer" al quitar o vaciar (avisos con botón).
  - Guardar como playlist.
  - Subir, bajar o "que suene después" desde el menú.
- **Temporizador:** baja el volumen de a poco los últimos 3 minutos. Nueva opción "al terminar el álbum".
- **Comodidad** (`ui/js/comfort.js`):
  - Letra karaoke (la línea se llena con `--lp`).
  - Tema automático de día y de noche.
  - Modo auto con botones gigantes y Wake Lock.
  - Ahorro de batería: con 20% o menos y sin cargar pasa a "máximo rendimiento" y vuelve al cargar; en Android usa `PetalwaveNative.battery()`.
- **Android 1.6.0:**
  - **Atajos del ícono** (`res/xml/shortcuts.xml`, `pw_go`): solo navegan. "¿Qué suena?" abre la pantalla y espera el toque, nunca graba sola.
  - **Actualizar desde la app** (`Updater.kt`):
    - baja el APK solo de GitHub y verifica el SHA-256 de `latest.json`;
    - instala con `PackageInstaller`;
    - el aviso del instalador solo se acepta mientras Petalwave espera su propia instalación y si es la confirmación del sistema.
  - **Arranque:** el servidor arranca en `App.onCreate`, el primer escaneo espera 3 s y hay una flor animada mientras carga.
- **Base de datos:** medido con 20.000 canciones, la biblioteca en JSON carga en 0,03 s y se busca en 0,02 s; no hace falta SQLite.
- **Pruebas automáticas** (`tools/probar.bat`, `tools/tests/run.js`):
  - Sintaxis de JS y Python y caracteres invisibles.
  - 17 pruebas de funciones y seguridad contra una copia aparte del servidor.
  - El ataque de `fuzz.js`.

## 2.10.0 — ¿qué suena?, Inicio, buscador único, celular más cómodo y seguridad
- **¿Qué suena?** (`ui/js/recognize.js`, `src/recognize.js`, tecla `w`): graba 8 s con el micrófono (MediaRecorder, opus) y el servidor los reenvía a AudD con la clave del usuario (`data/audd.json`, solo para tu usuario; nunca vuelve a la interfaz). Muestra título, artista, álbum y carátula, con escuchar (YouTube Music), me gusta, descargar y link, y un historial local. Pausa Petalwave mientras escucha. En Android pide RECORD_AUDIO recién al usarlo y el WebView solo concede el micrófono a la interfaz propia. `/api/recognize` acepta solo audio, de 2 KB a 5 MB.
- **Inicio** (`ui/js/home.js`, workspace `home`, tecla `0`, se abre por defecto): seguir escuchando, mixes, descubrí, playlists y recién agregadas, en filas de tarjetas.
- **Buscador único** (`ui/js/gsearch.js`, tecla `/`): biblioteca, artistas, playlists y YouTube Music en un mismo lugar, con teclado (↑ ↓ Enter) y búsquedas recientes.
- **Celular:** barra de navegación fija abajo con nombres; deslizar la barra de la canción hacia arriba abre el reproductor; en pantalla completa, a los costados cambia de canción y hacia abajo cierra; fondo con movimiento lento.
- **Ajustes** (`ui/js/cfgnav.js`): categorías y buscador que filtra secciones y opciones.
- Atajos: los símbolos que se escriben con Shift (como `/` en teclados en español) ya coinciden con el atajo.
- **Seguridad:**
  - CSP (solo scripts propios, `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer` y COOP en las dos versiones.
  - Windows: la ventana solo navega a su propia dirección exacta y solo acepta mensajes de la interfaz.
  - Android: WebView sin acceso a `file://` ni `content://`, Safe Browsing, límite de 600 MB por pedido y chequeo de carpeta estricto en `/ui/`.
- **Errores encontrados atacando los servidores** (1256 pedidos con datos rotos; ninguno los tiró abajo):
  - Un cuerpo que no es un objeto (`null`, una lista, un texto) daba error interno en 7 pedidos en Windows y en 6 en Android. Ahora se ignora.
  - Ajustes: una "carpeta" que no era texto con ruta completa creaba carpetas llamadas `123` o `[object Object]` y las descargas iban ahí. Ahora se rechaza.
  - Los ajustes de la interfaz aceptaban cientos de KB de basura que se cargaban al abrir. Ahora tienen nombres cortos y un límite de 1 MB.
  - Android: un número de descargas simultáneas o unos segundos que no eran números daban error interno.
  - Buscar con el texto vacío ya no le pregunta a YouTube.
  - Los datos de canciones repetidas se piden una sola vez (antes, 300 repetidas tardaban 17 s).
  - Un código de playlist pegado a mano importa como mucho 500 canciones.
- **Transiciones inteligentes:** hacen falta 3 s de silencio para pasar de canción (o 1,5 s solo en los últimos 8 s), para no cortar una pausa antes del final.
- **Buscador:** Esc lo cierra aunque el foco no esté en la caja.
- **Android (encontrado analizando el APK compilado):** cualquier otra app del teléfono podía manejar la música con el mensaje del widget o abriendo Petalwave con un comando. Ahora los botones del widget van a un receptor privado (`WidgetButtons`) y la pantalla principal solo hace caso a comandos con la clave privada de la app.

## 2.9.0 — mixes, descargas inteligentes, tu año, QR y widget
- **Volumen parejo** (`audio.js`): cada reproductor mide el RMS de su canción (sin contar silencios) con su propio analizador y ajusta una ganancia hacia −16 dBFS (entre −12 y +8 dB; hasta +3 dB los primeros 10 s si nunca se midió). La medida se guarda (`pw-loud`) y la próxima vez arranca ajustada.
- **Transiciones inteligentes:** salta más de 1 s de silencio al principio (en los primeros 8 s) y, con 1,5 s de silencio en el tramo final, pasa a la siguiente con el fundido. No actúa si moviste la barra.
- **Mixes** (`taste.js`): por momento del día (un perfil propio con las señales de esa franja horaria, mezclado con el general) y por momento (entrenar, relajarte, concentrarte), según estilos y con búsquedas en YouTube Music. Se descartan compilados de más de 10 min o tipo "hits 2021".
- **Descargas inteligentes** (`smartdl.js`): tus ♥ online y lo mejor de descubrí, hasta 10 cada 3 h y hasta el límite elegido. En Android, solo con WiFi por defecto (`PetalwaveNative.net()`). Si una canción online ya está en la biblioteca, el reproductor usa el archivo.
- **Tu año en Petalwave** (`wrapped.js`): imagen 1080×1920 con los colores del tema. Junta `/api/stats?range=year` (nuevo rango) con lo escuchado online. Se guarda o se copia en Windows; en Android se guarda en Imágenes/Petalwave o se comparte (`saveImage`).
- **Playlists por QR** (`share.js`): código `PW1.<nombre>.<ids>` de hasta unas 250 canciones, con qrcode-generator (MIT) y lector jsQR (Apache 2.0) o BarcodeDetector. `/api/ytm/songs` trae título y artista de los ids. En Android se pide la cámara solo al escanear.
- **Widget de Android** (`PlayerWidget`): carátula, canción y controles. Con la app cerrada, el botón abre Petalwave y hace la acción.

## 2.8.0 — recomendaciones según tus gustos
- **Petalwave aprende lo que te gusta** (`ui/js/taste.js`, el mismo en Windows y Android). Guarda señales de escucha en `data/taste.json`: escuchada entera +1, más de la mitad +0.5, saltada en los primeros segundos −1, me gusta +3, quitar me gusta −2, agregar a una playlist +1.5, "no me interesa" −3. Cada señal pierde la mitad de su peso cada 45 días.
- Con esas señales arma tu **perfil**: artistas, artistas invitados, género, estilo (slowed, phonk, remix, lofi, hardtekk…) y década. Sirve también para canciones que nunca escuchaste. Las reproducciones y los me gusta de antes cuentan desde el primer día.
- **Recomendadas** (biblioteca → para vos): tus canciones ordenadas por tu perfil, con menos peso a lo que sonó hace poco, un poco de azar del día para descubrir y como mucho 3 por artista. Cada una dice por qué ("porque escuchás…", "te gusta lo slowed").
- **Descubrí**: canciones nuevas de YouTube Music. Toma las radios de tus canciones favoritas y lo más escuchado de tus artistas, saca lo que ya tenés y lo que marcaste "no me interesa", y ordena con tu perfil. Suenan online sin descargar y se renueva cada 6 horas o con "buscar nuevas".
- **No me interesa** en el menú de cada recomendación.
- **Seguir con recomendaciones** cuando termina la cola (ajustes → reproducción, activado).
- Servidor: `GET/POST/DELETE /api/taste`. Solo acepta señales válidas y en Android pide la clave.

## 2.7.2 — seguridad del servidor local
- **El servidor local solo le responde a Petalwave.** Antes, una página web abierta en el navegador podía mandarle pedidos (cambiar ajustes, empezar descargas o actualizaciones). Ahora se rechaza (403) todo pedido que llegue con otro `Host` (frena el *DNS rebinding*), con `Sec-Fetch-Site` de otro sitio o con un `Origin` ajeno. Solo se exceptúa la vuelta del inicio de sesión de Spotify, que ya está protegida por `state` y PKCE.
- **Android 1.2.2:** además, una clave al azar por cada arranque (`X-Petalwave-Token` o la cookie `pwt`, `HttpOnly` y `SameSite=Strict`) para todo `/api`: otras apps del teléfono no pueden leer ni cambiar nada.
- **Actualizaciones:** solo se instalan si el paquete trae huella SHA-256 y coincide. Sin huella, el botón manda a bajar el zip a mano. Si se usa la API de GitHub de respaldo, se toma el `digest` que GitHub publica de cada archivo.
- **Tu sesión en disco:** en Windows, `cookies.txt` y la carpeta `data` (con `spotify.json`) quedan con permisos solo para tu usuario y el sistema (`icacls`). En Android ya estaban en el almacenamiento privado de la app y sin copia de seguridad.

## 2.7.1 — carpetas de la biblioteca
- **Android 1.2.1:** se pueden agregar y quitar carpetas de la biblioteca (antes el servidor de Android no lo permitía y las volvía a armar al abrir la app). **+ carpeta** abre el explorador de archivos del teléfono (`ACTION_OPEN_DOCUMENT_TREE`); sirve la memoria interna y la tarjeta SD. Las carpetas se recuerdan (`foldersExtra` / `foldersHidden`). Las rutas se muestran como *Teléfono › Music*.
- La carpeta donde se guardan las descargas no se quita en silencio: en Android queda fija y en Windows avisa si es la única.
- En el celular, una ruta larga ya no empuja el botón **quitar** fuera de la pantalla.
- Android: "cambiar" la carpeta de destino explica que las descargas van siempre a Música/Petalwave.

## 2.7.0 — me gusta, sesión en Android y fuentes incluidas
- **Me gusta propio** (`ui/js/likes.js`): el ♥ funciona siempre, en Windows y Android, con o sin cuenta. Guarda la canción en la playlist fija *Me gusta* (id `liked`, primera en la biblioteca, no se borra) y la vuelve a tocar para quitarla. Con sesión de YouTube Music también se marca allá (`LIKE` / `INDIFFERENT`). Tecla `h`, en el menú de cada canción, corazón en la lista, en la barra del celular y en la pantalla completa.
- **Android 1.2.0:** iniciar sesión con Google (`LoginActivity`): la página de Google dentro de la app; se guardan solo las cookies de youtube.com y se borran las del WebView. Sirve para tus me gusta, playlists e historial de YouTube Music y para descargar con tu cuenta.
- **Fuentes incluidas** (`ui/fonts`, licencia OFL): JetBrains Mono, Quicksand, Outfit y Fira Code andan sin internet y en Android. Ya no se carga nada de Google Fonts.
- Diseños nuevos: **pétalo** (suave y redondeado, Quicksand) y **moderno** (Outfit).
- Celular: la barra del reproductor muestra la carátula y una línea de progreso; las canciones usan todo el ancho.

## 2.6.5 — fondos en Android y la ✕ de descargas
- **Android 1.1.1:** elegir un fondo ya no da "failed to fetch". La interfaz lee el archivo completo antes de mandarlo (el WebView fallaba al mandar archivos `content://` directo), adivina el tipo por la extensión y reintenta una vez; el servidor reconoce el formato por el contenido (JPG, PNG, WEBP, GIF, MP4, WEBM) aunque el selector no mande el tipo, y explica si la foto es HEIC.
- La ✕ para cancelar una descarga responde al tocarla (`pointerdown`), aunque la lista se esté actualizando con el progreso. También en Windows.
- Diseño para celular: barra del reproductor fija abajo, ventanas translúcidas para que se vea el fondo y pantalla completa con la letra.
- Android: controles en la notificación y la pantalla bloqueada (anterior, play/pausa, siguiente, barra de tiempo y salir).

## 2.6.4 — mp4 que se abren en todos lados
- mp4: `-S vcodec:h264,res,acodec:m4a` para preferir H.264 + AAC; antes YouTube entregaba AV1, que muchos reproductores no abren. En 1440p/4K, donde no hay H.264, se usa el mejor disponible.
- Videos a la carpeta Descargas de Windows (`videoToDownloads` / `videoDir`, detectada del registro), con opción en ajustes → descargas.
- La biblioteca recuerda archivos sueltos fuera de sus carpetas (`store.data.extra`), así los videos bajados a Descargas siguen apareciendo aunque se reescanee; si se borran, desaparecen solos.

## 2.6.3 — arreglos
- `modal()`: los botones sin acción ("Ahora no", "Cancelar") cierran siempre; antes `value: false` dejaba la ventana abierta.
- "Petalwave" con mayúscula en el título, la bandeja, los avisos y la interfaz (`caps.js` lo aplica siempre, salvo en rutas y nombres de archivo).
- `caps.js` procesa los textos nuevos en el momento (antes esperaba un cuadro de pantalla, que se frena con la ventana oculta) y no capitaliza rutas.

## 2.6.2 — la ✕ minimiza a la bandeja
- `Launcher.cs`: la ✕ (o Alt+F4) esconde la ventana en la bandeja y la música sigue; "Salir" de la bandeja, actualizar o apagar Windows cierran de verdad. Clic en la flor la muestra. Aviso la primera vez.
- Una sola instancia (`Mutex` + evento con nombre): abrir petalwave.exe otra vez muestra la ventana que ya estaba.
- Opción en ajustes → reproducción (`closeToTray`, activada por defecto); la interfaz se la avisa a la ventana con `tray:1|0`.

## 2.6.1 — ordenar ajustes
- Las secciones de ajustes se ordenan manteniendo apretado su título y arrastrando (`ui/js/cfgsort.js`), con desplazamiento automático en los bordes. Se guarda en `P.cfgOrder` y se restablece junto con las ventanas; respeta el bloqueo.
- Las preferencias pendientes se mandan con `sendBeacon` al cerrar o recargar, así no se pierde el último cambio.

## 2.6 — mover ventanas
- Mantené apretada una ventana medio segundo y arrastrala (`ui/js/layout.js`): al costado cambia el orden, en cualquier otro lugar queda **flotando** (se agranda desde la esquina), y la ventana principal arrastrada al otro lado cambia el panel de lado. Doble clic en el título de una flotante la devuelve. Si quedan todas flotando, la lista ocupa todo el ancho.
- Se guarda en las preferencias; ajustes → tema → ventanas: **restablecer** y **bloquear** (para no moverlas sin querer).
- La ventana de cola y letra tiene título para poder agarrarla.

## 2.5.2 — actualizaciones sin error 403
- El actualizador ya no depende de la API de GitHub (60 consultas/hora por IP, que devolvía 403 en conexiones compartidas): lee `releases/latest/download/latest.json`, una descarga común publicada en cada Release con la versión, las notas y el tamaño y SHA-256 del paquete. La API queda de respaldo.
- La descarga se reintenta hasta 3 veces, se verifica el SHA-256 antes de instalar y, si falla, la ventana explica cómo actualizar a mano.

## 2.5.1 — carátulas livianas
- Opción **carátulas livianas en las listas** (ajustes → rendimiento, activada por defecto): las filas y tarjetas piden `/cover/:id?s=t|m` (128 / 256 px), que el servidor genera una vez con ffmpeg y guarda en `data/covers/thumbs`; las de YouTube Music se piden a Google en 120 px. El reproductor y la pantalla completa siguen en calidad completa. Medido: unos 35 MB menos con 26 canciones, y más con bibliotecas grandes.

## 2.5 — rendimiento, mayúsculas y cuentas
- **Modo rendimiento** (botón en la barra y ajustes → rendimiento): calidad / equilibrado / máximo. Máximo apaga el vidrio (backdrop-filter), no carga el video de fondo, apaga fondo animado y decoraciones y baja todo a 30 fps, sin tocar los ajustes guardados. Medido en frío: −108 MB sonando y −258 MB en pantalla completa.
- **Mayúscula inicial** en la interfaz (ajustes → tema, activada por defecto). Nunca cambia títulos, artistas, playlists, letras ni lo que escribís (`ui/js/caps.js`).
- **Cuentas**: sección en ajustes y botón en descargas para iniciar sesión con Google en YouTube y YouTube Music (una sola sesión para las dos), cambiar de cuenta o cerrar sesión, y opción de descargar con la sesión (calidad Premium).

## 2.4 — actualizaciones con un clic
- Botón ⬆ en la barra cuando hay versión nueva en GitHub y "buscar actualizaciones" en ajustes → acerca de. Baja `petalwave-update.zip` (app + yt-dlp nuevo), espera a que se cierre la app, reemplaza los archivos con robocopy sin tocar `data/`, `descargas/`, cookies ni wallpaper, y la vuelve a abrir (`src/update.js`).
- La ventana entiende la orden `quit` para cerrarse sola al instalar.
- Escribir rápido o mantener una tecla (vvvv, kkkk, bbbb) ya no dispara atajos: el buscador de YouTube Music conserva foco y texto al redibujarse, las letras justo después de escribir se ignoran y solo se repiten adelantar/volumen.

## 2.3 — fondos animados
- `ui/js/bgfx.js`: 6 efectos en canvas (aurora, ondas, estrellas, lluvia digital, bokeh, nebulosa) a baja resolución, con FPS limitado, colores del tema y graves del analizador. Se frena con la ventana oculta, en mini y sin animaciones.
- Wallpaper de GIF y de video (mp4/webm, hasta 300 MB) servido con Range; `GET /api/wallpaper` informa el tipo. Video teñido con el tema, pausable con la música y con velocidad propia.
- Ajustes → personalizar → "fondo animado" con vista previa de cada efecto.

## 2.2.1 — letras automáticas, descargas sin cookies y pulido de diseños
- Letras sin `.lrc`: YouTube Music (con búsqueda de la canción oficial si el video no tiene) + LRCLIB activado por defecto, para pistas locales y online (`/api/lyrics/yt_<id>?title&artist&duration`). Limpieza de títulos, candidatos "Artista - Tema", prioridad a la letra sincronizada y reescalado de tiempos en versiones slowed/sped up. Reintento sin marcas de tiempo cuando YouTube responde 400.
- Descargas: sin cookies → otros clientes (`player_client=tv,mweb,web_safari`) → sesión, automático. La ayuda de cookies aparece solo si fallan todos los intentos. El streaming también cae a modo sin cookies.
- Diseños: el panel lateral no pasa del 44% del ancho, la lista oculta álbum/▶/formato cuando queda angosta, controles del reproductor que se achican en vez de cortarse, título que entra con la carátula circular.

## 2.2 — personalización
- Nuevo módulo `ui/js/custom.js`: el diseño se guarda en `prefs.custom` (solo lo que difiere del predeterminado) y se aplica con variables CSS y clases en `body`.
- Editor de temas propios (`prefs.customThemes`): 5 colores → tema completo (`buildTheme` en `theme.js`), vista previa en vivo, editar y borrar.
- Presets de diseño, exportar/importar `petalwave-estilo.json` (validado al importar) y restaurar.
- Panel lateral a la izquierda, ancho, separación, bordes, desenfoque, opacidad, escala (zoom CSS con altura compensada), fuente y altura de filas.
- Carátula configurable (tamaño, forma, vinilo giratorio), título editable y paneles o módulos de la barra ocultables.
- Visualizador: cantidad de barras, picos, reflejo y color (tema, arcoíris o fijo). Fondo: pétalos o CRT forzados, oscurecer y desenfocar el wallpaper.

## 2.1 — YouTube Music con ytmusicapi
- Python 3.12.10 + ytmusicapi 1.12.3 (en `lib/py`). Puente persistente `src/ytm_bridge.py` ↔ `src/ytm.js`, con reinicio automático, timeout y caché.
- Sesión armada a partir de `cookies.txt` (autenticación "browser" de ytmusicapi). Se verifica de verdad con `get_account_info`, y si falla avisa qué cookies faltan.
- Workspace 3 con pestañas: buscar, me gusta, mis playlists, historial, radio, y sync e importar.
- Letras oficiales de YouTube Music, sincronizadas cuando existen, entre las letras locales y LRCLIB.
- ID de YouTube en cada pista (sacado de las etiquetas `purl`/`comment` de yt-dlp). El índice de la biblioteca pasó a la v4.
- ♥ me gusta en YouTube Music desde el reproductor, y "radio de YouTube Music" en el menú contextual.
- Nota: el lector de búsquedas de ytmusicapi 1.12.3 falla con `language="es"`, por eso se usa `en`; los nombres y las letras no cambian.

## 2.0 (reescritura modular)

### Auditoría de la versión 1.x: problemas encontrados y corregidos
| # | problema | corrección |
|---|---|---|
| 1 | Cada miniatura lanzaba un ffmpeg propio, todos a la vez (picos de CPU) | cola de carátulas con máximo 2 ffmpeg, caché en disco y en memoria de "sin carátula" |
| 2 | La biblioteca solo leía `descargas/`, sin subcarpetas y solo 4 formatos | escaneo de varias carpetas, recursivo, con 12 formatos y vigilancia de cambios |
| 3 | Los metadatos se leían al reproducir y se perdían al cerrar | índice persistente `data/library.json`, con ffprobe en paralelo limitado (3) |
| 4 | Corte seco al cambiar de canción | dos reproductores con fundido cruzado y rampas al pausar o saltar |
| 5 | El aleatorio podía repetir la misma canción y "anterior" saltaba al azar | cola real con historial y orden aleatorio estable |
| 6 | La barra de progreso solo aceptaba clic | arrastrable, con tiempo bajo el mouse y lo que ya cargó |
| 7 | `media.play()` sin manejo de errores | errores capturados: aviso y salto a la siguiente (máximo 3 seguidos) |
| 8 | El visualizador actualizaba el DOM 60 veces por segundo aun en pausa | bucles que se detienen en pausa o con la ventana oculta, y límite de FPS (0,1% de CPU en reposo) |
| 9 | Una descarga cancelada dejaba colgada la conexión SSE | un solo canal SSE para todo, con el estado completo en cada evento |
| 10 | Sin cola de descargas: N links = N yt-dlp en paralelo | cola con concurrencia de 1 a 4 configurable |
| 11 | Los trabajos terminados quedaban en memoria para siempre | se liberan a los 60 s y pasan al historial persistente |
| 12 | `readBody` sin límite de tamaño | límites de tamaño en todos los cuerpos y subidas por streaming a disco |
| 13 | `Range` mal parseado (`bytes=-N`, fuera de rango) | sufijos soportados y respuesta 416 para rangos inválidos |
| 14 | Ajustes guardados solo en el perfil del navegador (se perdieron al cambiar a WebView2) | preferencias guardadas también en el servidor (`data/settings.json`) |
| 15 | El servidor se cerraba a la fuerza y podía perder datos | `/api/quit`: cierre ordenado que guarda todo |
| 16 | Las categorías de YouTube ("Music", "People & Blogs") aparecían como género | se filtran |
| 17 | Un solo `index.html` de 1.200 líneas con variables globales | 13 módulos ES (`ui/js`) y 7 módulos de servidor (`src/`) |

### Nuevo
- Biblioteca: artistas, álbumes, géneros, años, recientes, duplicados, búsqueda instantánea, filtros, selección múltiple, menú contextual, edición de etiquetas, papelera e importación arrastrando archivos.
- Playlists propias (arrastrar para ordenar) y mixes automáticos: Para vos, Más escuchadas, Recién agregadas, Redescubrir, Sin escuchar, Mix de artista y por género.
- Radio de canciones similares (artista, álbum, género, año y canciones escuchadas juntas).
- Ecualizador de 10 bandas con preamp, graves, agudos, balance y presets propios.
- 5 visualizadores con audio real: spectrum, waveform, circular, minimal (VU L/R) y particles.
- Letras locales (.lrc o .txt), dentro del archivo, o en LRCLIB de forma opcional, con sincronización por línea.
- Estadísticas: tiempo escuchado, reproducciones, gráfico por día o mes, top de canciones, artistas y álbumes.
- 6 temas (Blood, Dark, Midnight, Cyberpunk, Monochrome, Petal) más colores por carátula.
- Descargas: formatos m4a y opus, varios links, cola, tamaño y formato de origen, carpeta de destino e historial con reintentar.
- YouTube Music: importar playlists comparando con la biblioteca y bajar solo lo que falta.
- Ventana: mini reproductor siempre visible, pantalla completa sin bordes, ícono en la bandeja con controles, notificaciones de Windows, selector de carpetas nativo, teclas multimedia y atajos configurables.

### Pruebas realizadas
- API: biblioteca (24 pistas), carátulas, rangos de audio, duplicados, similares, letras, estadísticas, playlists y descargas.
- Interfaz: sin errores en la consola; reproducción, fundido (0,29 → 0,70 de ganancia cruzada a los 0,7 s), los 5 visualizadores, ecualizador aplicado a los filtros reales, pantalla completa, menú contextual, búsqueda, artistas y playlists.
- Descargas: cola de 3 con 2 simultáneas; un MP3 real descargado, convertido y agregado a la biblioteca.
- Ventana nativa: arranque, mini (450×160 siempre visible), pantalla completa (1920×1080 sin bordes) y cierre ordenado.
- Consumo en pausa: 0,1% de CPU.
- **No probado:** descargas desde YouTube con cookies reales (necesitan tu sesión) y las letras online.
