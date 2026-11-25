@echo off
chcp 65001 >nul
title Petalwave - descargas
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  if exist "release\petalwave\runtime\node.exe" ( "release\petalwave\runtime\node.exe" tools\descargas.js ) else ( echo No encuentro Node.js. & pause & exit /b 1 )
) else (
  node tools\descargas.js
)
pause
