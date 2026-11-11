# PETALWAVE
Reproductor de musica 
Qué tiene que hacer el usuario:

En GitHub toca Code → Download ZIP.
Extrae el zip con clic derecho → Extraer todo.
Hace doble clic en Empezar.bat.

Ese archivo nuevo, Empezar.bat, se encarga del resto:

Revisa si faltan Node.js, yt-dlp, ffmpeg y Python, y los instala con winget.
Crea petalwave.exe con build.bat.
Deja un acceso directo petalwave en el escritorio, para usar desde la segunda vez.
Abre la app. Si no logra crear la ventana, la abre en el navegador.

Fallos típicos que ya cubre:

Si abrió el .bat sin extraer el zip, le avisa que primero tiene que extraerlo.
Si Windows no tiene winget, le da los links de descarga manual de los tres programas.
Si lo recién instalado no se reconoce todavía, le pide abrir Empezar.bat otra vez.
