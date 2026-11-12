# petalwave — registro de cambios

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
