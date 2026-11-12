# ❀ petalwave

🌸〰️ Reproductor de música para Windows con estética de terminal / rice de Hyprland:
tu biblioteca, descargas de YouTube, YouTube Music y Spotify en mp3/mp4, letras sincronizadas,
ecualizador, visualizadores, temas y fondos animados.

## ⬇️ Descargar e instalar (sin saber nada de informática)

1. Entrá a **[Releases](../../releases/latest)** y descargá **`petalwave-windows.zip`** (está abajo, en "Assets").
2. Andá a tu carpeta **Descargas**, hacé **clic derecho** en el zip → **Extraer todo…** → **Extraer**.
3. Abrí la carpeta **petalwave** y hacé **doble clic** en **`petalwave.exe`** (el ícono de la flor).
4. Si aparece el cartel azul **"Windows protegió su PC"**: tocá **Más información** → **Ejecutar de todas formas**.
   Sale porque el programa es nuevo y no tiene firma digital paga; es normal.

No hay que instalar nada más: Node.js, yt-dlp, ffmpeg y Python ya vienen adentro.
Funciona en **Windows 10 y 11 de 64 bits**. Para un acceso directo: clic derecho en `petalwave.exe` →
*Mostrar más opciones* → *Enviar a* → *Escritorio*.

**Si tu PC es lenta:** tocá el botón **✦** de la barra hasta que diga **⚡ máximo rendimiento** (apaga efectos y gasta hasta un 27% menos de memoria).
**Iniciar sesión en YouTube / YouTube Music:** ajustes (5) → *cuentas* → *iniciar sesión con Google*.

**Lo básico:** `1` música · `2` descargas (pegá un link y listo, sin cookies) · `3` YouTube Music y Spotify ·
`5` ajustes (temas, diseño, fondos animados) · `espacio` play/pausa · `f` pantalla completa · `b` ver el fondo.

### 🔄 Actualizar
- **Desde la versión 2.4:** cuando sale una versión nueva aparece un botón **⬆** arriba a la derecha. Tocalo → **actualizar ahora**: petalwave baja solo lo nuevo, se cierra, se actualiza y se vuelve a abrir. Tu música y tus ajustes no se tocan.
- **Si tenés la 2.3** (no trae ese botón), una sola vez: cerrá petalwave (clic derecho en la flor ❀ junto al reloj → *Salir*), bajá el zip nuevo, **extraelo en la misma carpeta** donde lo tenías y elegí **"Reemplazar los archivos en el destino"**. No se pierde nada: el zip no trae tus canciones ni tus ajustes.

<details><summary>Problemas comunes</summary>

- **"No se encontró Node.js"**: no se extrajo todo el zip. Extraelo de nuevo (no lo abras desde adentro del zip).
- **La ventana queda en blanco**: instalá [Microsoft Edge WebView2](https://developer.microsoft.com/microsoft-edge/webview2) (Windows 11 ya lo trae).
- **Una descarga dice "not a bot"**: YouTube frenó tu conexión un rato. Esperá unos minutos o iniciá sesión en el workspace 3.
</details>

<details><summary>Para desarrolladores</summary>

Desde el código: instalá Node.js, `yt-dlp` y `ffmpeg` (`instalar.bat`), y corré `iniciar.bat` (navegador) o compilá
`petalwave.exe` con `build.bat` (usa el compilador C# que trae Windows y WebView2 de `lib/`).
YouTube Music necesita Python 3.12 y `pip install --target lib\py ytmusicapi`.
El zip de la Release además trae `runtime\node.exe`, `runtime\python\` (embebible), `bin\yt-dlp.exe`, `ffmpeg.exe` y `ffprobe.exe`.
</details>

## Workspaces (como en Hyprland)
| tecla | workspace | qué hay |
|---|---|---|
| `1` | música | biblioteca: canciones, artistas, álbumes, géneros, años, recientes, duplicados, playlists y mixes automáticos |
| `2` | descargas | terminal estilo nvim: cola, progreso, historial y log |
| `3` | sync | sincronizar YouTube Music e importar playlists |
| `4` | stats | estadísticas de escucha y recomendaciones |
| `5` | ajustes | temas, reproducción, visualizador, carpetas, descargas, letras, atajos y rendimiento |

## Reproductor
- Play/pausa, anterior/siguiente, ±10 s (`←`/`→`), ±30 s (`Shift+←/→`) y barra de progreso arrastrable con vista previa del tiempo.
- **Cola** reordenable arrastrando, **historial**, repetir (no / toda la cola / una canción) y aleatorio real, que no repite la canción actual.
- **Fundido entre canciones** (crossfade, configurable de 0 a 10 s) y pausas y saltos sin chasquidos.
- **Reanuda** la canción, la posición y la cola al abrir.
- **Radio**: arma una cola con canciones parecidas de tu biblioteca.
- Teclas multimedia y panel de Windows (Media Session), ícono en la bandeja y notificación al cambiar de canción.
- **Mini reproductor** (`Shift+M`, siempre visible), **modo compacto** (`k`) y **pantalla completa** (`f`, con letra sincronizada).

## Volumen y ecualizador (`v` / `e`)
- Volumen propio de 0 a 150% con limitador, ajuste por canción (±12 dB) y normalizador.
- **Ecualizador de 10 bandas** (31 Hz a 16 kHz) más preamp, graves, agudos y balance.
- Presets: plano, bass boost, phonk, electrónica, rock, pop, voces, acústica, agudos+ y noche. También podés guardar los tuyos.

## Visualizador (`z` cambia de modo)
Spectrum, waveform, circular, minimal (medidores L/R) y particles. Todos leen el **audio real** que está sonando, con límite de FPS (30 o 60), y se apagan solos en pausa.

## Biblioteca
- Escanea varias carpetas con subcarpetas (ajustes → biblioteca): mp3, flac, wav, ogg, opus, m4a, aac, mp4 y webm.
- Lee los metadatos con ffprobe en segundo plano y los guarda en `data/library.json`. Vigila las carpetas, así que lo nuevo aparece solo.
- Búsqueda instantánea (ignora acentos), filtros por formato y por audio o video, orden por columnas y lista virtualizada para miles de canciones.
- Selección múltiple (Ctrl/Shift), clic derecho para reproducir, poner después, agregar a la cola o a una playlist, editar etiquetas, mostrar en la carpeta o enviar a la papelera.
- **Playlists** guardadas automáticamente. Se arrastran canciones a una playlist de la barra lateral o a la cola.
- **Duplicados**: misma canción con duración parecida. Se pueden mandar a la papelera de Windows, que es recuperable.
- Arrastrá archivos de música a la ventana para importarlos (van a `descargas/importados`).

## Descargas (workspace 2)
- Uno o varios links (uno por línea), playlists y álbumes.
- Formatos: **mp3** (128 a 320), **m4a** (AAC sin recodificar), **opus** (la mejor calidad de YouTube) y **mp4** (360p a 4K).
- Cola con hasta 1 a 4 descargas simultáneas (ajustes). Muestra progreso, tamaño, velocidad, tiempo restante y formato de origen.
- Cancelar, reintentar, historial guardado y carpeta de destino elegible.

## YouTube Music con ytmusicapi (workspace 3)
petalwave usa **[ytmusicapi](https://ytmusicapi.readthedocs.io)** (librería de Python **no oficial**, instalada en `lib/py`, con Python 3.12) a través de un puente (`src/ytm_bridge.py`):
- **buscar** canciones, videos, álbumes y playlists de YouTube Music, con la marca "✓ la tenés" para lo que ya está en tu biblioteca y descarga con un clic o de todo lo que falta.
- **me gusta**, **mis playlists** e **historial** de tu cuenta: reproducir lo que tenés, bajar lo que falta, crear la playlist local o agregarla a la sync.
- **radio de YouTube Music**: clic derecho en una canción → *radio de YouTube Music*.
- **♥ me gusta** en YouTube Music desde el reproductor.
- **letras oficiales** (LyricFind / Musixmatch, las mismas de YouTube Music), sincronizadas cuando existen.

Cada canción descargada guarda su ID de YouTube, y así se conecta con YouTube Music. Búsqueda, radio y letras funcionan sin sesión. Me gusta, playlists e historial necesitan un `cookies.txt` **completo**: tiene que incluir `SID`, `SAPISID` y `LOGIN_INFO`, y el estado arriba te avisa si falta alguna.
Si YouTube cambia algo y deja de andar, actualizá con:
`%LOCALAPPDATA%\Programs\Python\Python312\python.exe -m pip install --upgrade --target lib\py ytmusicapi`

## Tu YouTube Music en el reproductor, sin descargar
Con la sesión iniciada, el workspace 1 tiene una sección **youtube music** con tus **me gusta** y todas tus **playlists**, que se sincronizan solas cada 5 minutos o con ⟳.
- Lo que ya tenés descargado suena desde el archivo. Lo demás suena **online** (☁ web): yt-dlp resuelve el audio con tu sesión (con Premium, AAC de 256 kbps) y pasa por el servidor local, así funcionan el ecualizador, el volumen, el fundido y el visualizador. No se guarda nada en el disco.
- La primera canción online tarda unos segundos en arrancar. Las siguientes se precargan y arrancan al instante.
- Las canciones online se pueden poner en la cola, en tus playlists locales, en radio o en me gusta, o descargar (una o "descargar las N online").
- En el workspace 3, el botón ▶ de cada resultado de búsqueda también la escucha online.
- Es un uso **no oficial** de YouTube Music con tu propia cuenta: si YouTube cambia algo puede fallar hasta actualizar yt-dlp (`winget upgrade yt-dlp.yt-dlp`). No esquiva DRM: lo que no está disponible para tu cuenta no suena.

## Spotify (workspace 3 → pestaña "spotify")
- **Iniciar sesión oficial** (OAuth de la Web API de Spotify): tu contraseña la escribís en la página de Spotify, en tu navegador.
  - Desde 2026 Spotify exige que cada persona cree su propia "app" en [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard), con cuenta **Premium**. La pestaña te guía en 3 pasos: crear la app, pegar la Redirect URI `http://127.0.0.1:3737/spotify/callback` y copiar el Client ID.
- Con la sesión iniciada ves tus **playlists** y tus **canciones guardadas**.
- **Links públicos** de canciones, álbumes y playlists funcionan **sin iniciar sesión**, en esa pestaña o pegados en descargas (workspace 2).
- **El audio nunca sale de Spotify**, porque tiene DRM. Cada canción se busca en **YouTube Music** comparando título, artista y duración, y desde ahí se escucha online, se descarga o se arma una playlist en petalwave.

## Mejoras inspiradas en lo que más se le critica a Spotify y YouTube Music
- **Ordenar cualquier lista** (playlists, YouTube Music, mixes, artistas, álbumes): al tocar una columna pasa por A→Z, Z→A y vuelve al orden original.
- **Temporizador para dormir** (☾): 15 a 90 minutos o al terminar la canción, con fundido suave del volumen.
- **Sin videos**: el filtro "solo audio" y el botón *sin videos* ocultan los videoclips y los videos subidos por usuarios en las listas de YouTube Music.
- "Reproducir después" pone la canción justo después de la actual, no al final de la cola. También hay multiselección y modo compacto.

## Sync e importar (workspace 3 → pestaña "sync e importar")
- **Sync**: tus "Me gusta" y las playlists que elijas se bajan solas, solo lo nuevo, a mano o cada 30 min a 6 h.
- **Importar playlist**: lee una playlist o álbum, marca las canciones que **ya tenés** y te deja crear la playlist local o bajar solo las que faltan.
- **Limitación:** YouTube Music no tiene una API pública oficial para la biblioteca personal. petalwave usa tu propia sesión (`cookies.txt`) con yt-dlp: lee lo mismo que ves en tu cuenta y no esquiva DRM ni restricciones.

### ¿Hacen falta cookies para descargar?
No. Cada descarga se intenta primero **sin cookies**; si YouTube la bloquea (anti-bots, 429, 403), petalwave reintenta solo con otros clientes de YouTube y, recién si eso falla y tenés sesión cargada, con tu sesión. Las cookies solo son obligatorias para listas privadas (tus "me gusta", "ver más tarde") y para me gusta/playlists/historial del workspace 3.

### "Sign in to confirm you're not a bot" / cookies vencidas
1. En Brave: extensión **"Get cookies.txt LOCALLY"** → Detalles → *Permitir en modo privado*.
2. Abrí una ventana privada, iniciá sesión en youtube.com y andá a `youtube.com/robots.txt`.
3. Exportá con la extensión y **cerrá la ventana privada sin usarla más**. Así las cookies no se vencen.
4. Arrastrá el `.txt` a petalwave.

## Letras (`l`)
No hace falta ningún archivo: petalwave busca la letra sola en **YouTube Music** (si el video no la tiene, busca la canción oficial) y en **LRCLIB**, una base abierta de letras sincronizadas. Funciona con canciones descargadas y con las que suenan online. Limpia los títulos de YouTube ("(Official Video)", "Artista - Tema", "【cover】"…) y en las versiones **slowed / sped up** estira las marcas de tiempo para que la letra siga sincronizada. Si tenés un `.lrc` o `.txt` con el mismo nombre del audio, ese tiene prioridad. Las dos fuentes online se apagan en ajustes → letras. Si la letra tiene marcas de tiempo, se resalta la línea actual, y con clic en una línea saltás a ese momento. También podés arrastrar un `.lrc` a la ventana.

## Temas (`t`)
Blood (negro, gris, blanco y rojo oscuro), Dark, Midnight, Cyberpunk, Monochrome y Petal (el rosa original). Con **colores de la carátula** (`c` o clic derecho en el tema) la interfaz toma los colores de lo que suena. Wallpaper propio: arrastrá una imagen.

## Personalizar (ajustes → workspace 5)
Si no te gusta cómo viene, cambialo. Todo se ve en vivo y cada opción tiene ↺ para volver a lo predeterminado.
- **Presets de diseño** con un clic: petalwave, minimal, terminal, vinilo, cine, zurdo y compacto.
- **Mis temas**: elegí 5 colores (acento, secundario, fondo, texto y wallpaper), la opacidad de las ventanas, pétalos y líneas CRT, y guardalo con nombre. Aparece junto a los demás temas y en la tecla `t`.
- **Diseño**: reproductor a la izquierda o a la derecha, ancho del panel, separación, bordes redondeados, desenfoque, opacidad de las ventanas, tamaño de toda la interfaz, fuente y altura de las filas.
- **Reproductor**: tamaño y forma de la carátula (redondeada, cuadrada o circular), **efecto vinilo** que gira mientras suena y el texto del título.
- **Qué se muestra**: visualizador, cola/letra, controles de la barra, cpu/ram, estado de yt-dlp y reloj.
- **Visualizador**: cantidad de barras, picos, reflejo y color (del tema, arcoíris o uno fijo).
- **Fondo**: pétalos y líneas de escaneo siempre, nunca o según el tema; oscurecer y desenfocar el wallpaper.
- **Pantalla completa** (`f`): fondo (carátula desenfocada, tu wallpaper con el fondo animado, degradado del tema o negro), desenfoque, brillo, visualizador propio (o el mismo del panel, o ninguno), su altura e intensidad y el tamaño de la carátula. Se cambia rápido con el engranaje ⚙ de arriba a la derecha. Las miniaturas de video con franjas negras se recortan solas.
- **Ver el fondo**: tecla `b` o el ojo 👁 de la barra esconden las ventanas y sacan el desenfoque (Esc o clic para volver). **Fondo nítido** deja el wallpaper claro también detrás de las ventanas.
- **Fondo animado**: aurora, ondas, estrellas, lluvia digital, bokeh o nebulosa, con los colores del tema, encima de tu wallpaper. Velocidad, intensidad, fluidez (30/60 fps), reaccionar a los graves y calmarse en pausa.
- **Wallpaper animado**: un **GIF** o un **video mp4 / webm** (sin sonido, en loop, hasta 300 MB) desde "elegir GIF o video" o con **shift + soltar** el video. Se puede pausar junto con la música y cambiar su velocidad. Se detiene solo con la ventana minimizada o en modo mini.
- **Exportar / importar** tu estilo en un `.json` para compartirlo, y **restaurar todo** (no borra tus temas).

## Atajos
Todos se cambian en ajustes → atajos. Por defecto: `espacio` play, `n`/`p` siguiente/anterior, `←`/`→` ±10 s, `↑`/`↓` volumen, `m` silencio, `r` repetir, `s` aleatorio, `/` buscar, `v` volumen, `e` ecualizador, `z` visualizador, `t` tema, `c` colores, `l` letra, `q` cola, `f` pantalla completa, `Shift+M` mini, `k` compacto, `Shift+R` radio, `1`–`5` workspaces.

## Datos
- `data/`: índice de la biblioteca, carátulas, letras, playlists, estadísticas, historial de descargas y ajustes.
- `cookies.txt`, `sync.json` y `sync-archive.txt`: sesión y sincronización de YouTube.
- `%LOCALAPPDATA%\petalwave`: perfil de la ventana y logs.

Usá petalwave con música propia, libre o con permiso del autor.

## Licencia
Código bajo **Apache 2.0** (ver `LICENSE`). El zip de la Release incluye Node.js (MIT), yt-dlp (Unlicense), FFmpeg (GPL), Python (PSF) y ytmusicapi (MIT), con sus licencias en la carpeta `licencias`.
