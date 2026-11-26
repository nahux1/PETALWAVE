@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
rem Volver a una copia de respaldo (las que guarda tools\respaldar.bat).
rem Antes de cambiar nada guarda una copia de como esta todo ahora, asi que siempre se puede volver atras.
cd /d "%~dp0.."

git remote get-url respaldo >nul 2>&1 || git remote add respaldo https://github.com/nahux1/PETALWAVE-respaldo.git
echo Buscando las copias en GitHub...
git fetch respaldo --tags --quiet

echo.
echo  Copias guardadas (la ultima abajo de todo):
echo.
set N=0
for /f %%t in ('git tag --list "respaldo-*" --sort=creatordate') do (
  set /a N+=1
  set "T!N!=%%t"
  echo   !N!. %%t
)
for /f %%t in ('git tag --list "v*" --sort=creatordate') do (
  set /a N+=1
  set "T!N!=%%t"
  echo   !N!. %%t  ^(version publicada^)
)
if %N%==0 ( echo  No hay copias todavia: usa tools\respaldar.bat & pause & exit /b 1 )
echo.
set /p ELEGIDA= Numero de la copia a la que queres volver (Enter para cancelar):
if "%ELEGIDA%"=="" exit /b 0
set "TAG=!T%ELEGIDA%!"
if "%TAG%"=="" ( echo Ese numero no existe. & pause & exit /b 1 )

echo.
echo  Se van a poner los archivos como estaban en %TAG%.
echo  Primero se guarda una copia de como esta todo ahora.
set /p OK= ¿Seguro? (s/n):
if /i not "%OK%"=="s" exit /b 0

call "%~dp0respaldar.bat" <nul
git checkout %TAG% -- . || ( echo No se pudo restaurar. & pause & exit /b 1 )
echo.
echo  Listo: los archivos quedaron como en %TAG%.
echo  Si algo no te gusta, volve a correr este archivo y elegi la copia que se guardo recien.
pause
