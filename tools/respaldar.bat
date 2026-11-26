@echo off
chcp 65001 >nul
setlocal
rem Copia de respaldo de Petalwave en GitHub (repositorio privado nahux1/PETALWAVE-respaldo).
rem - Guarda una "foto" de como esta el codigo AHORA, aunque tengas cambios sin guardar en git, como la etiqueta
rem   respaldo-AAAA-MM-DD-HHMM. Tus ramas y tu historial no se tocan.
rem - No sube tus datos, cookies, descargas ni la clave del APK (lo mismo que ignora .gitignore).
rem Para volver a una copia: tools\restaurar.bat
cd /d "%~dp0.."

git remote get-url respaldo >nul 2>&1 || git remote add respaldo https://github.com/nahux1/PETALWAVE-respaldo.git

for /f %%f in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd-HHmm"') do set FECHA=%%f
set TAG=respaldo-%FECHA%

rem foto del codigo tal como esta (incluye archivos nuevos y cambios sin commit), sin tocar tu indice ni tus ramas
set "GIT_INDEX_FILE=%TEMP%\pw-respaldo-index"
copy /y ".git\index" "%GIT_INDEX_FILE%" >nul
git add -A
for /f %%t in ('git write-tree') do set TREE=%%t
for /f %%c in ('git commit-tree %TREE% -p HEAD -m "respaldo %FECHA%"') do set FOTO=%%c
set GIT_INDEX_FILE=
del "%TEMP%\pw-respaldo-index" >nul 2>&1

if "%FOTO%"=="" (
  echo No se pudo armar la copia. ¿Esta instalado git?
  pause & exit /b 1
)
git tag %TAG% %FOTO%

echo Subiendo la copia a GitHub (privado)...
git push respaldo --all || goto :error
git push respaldo --tags || goto :error

echo.
echo  Listo: copia guardada como %TAG%
echo  https://github.com/nahux1/PETALWAVE-respaldo
echo.
pause
exit /b 0

:error
echo.
echo  No se pudo subir: revisa la conexion a internet o la sesion de GitHub (gh auth status).
pause
exit /b 1
