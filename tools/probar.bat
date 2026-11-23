@echo off
chcp 65001 >nul
title Petalwave - pruebas automaticas
rem Prueba Petalwave en una copia aparte (no toca tu musica ni tus ajustes). Doble clic para correrlo.
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  if exist "runtime\node.exe" ( set "NODE=runtime\node.exe" ) else ( echo No se encontro Node.js. & pause & exit /b 1 )
) else ( set "NODE=node" )
"%NODE%" tools\tests\run.js
echo.
pause
