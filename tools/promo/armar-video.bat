@echo off
chcp 65001 >nul
title Petalwave - video promocional
cd /d "%~dp0..\.."
echo Armando el video vertical con las capturas de docs\capturas...
where node >nul 2>nul
if errorlevel 1 ( set NODE=release\petalwave\runtime\node.exe ) else ( set NODE=node )
%NODE% tools\promo\make-promo.js
if errorlevel 1 ( echo. & echo No se pudo armar el video. & pause & exit /b 1 )
echo.
echo Listo: carpeta promo\petalwave-promo.mp4 (el texto para publicar esta en tools\promo\texto-para-publicar.txt)
explorer promo
pause
