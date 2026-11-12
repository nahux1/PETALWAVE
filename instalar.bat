@echo off
echo Instalando yt-dlp y ffmpeg con winget...
winget install --id yt-dlp.yt-dlp -e --accept-source-agreements --accept-package-agreements
winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
echo.
echo Listo. Ahora ejecuta iniciar.bat
pause
