@echo off
rem arma release\Instalar-Petalwave.exe (instalador de un solo archivo que baja la ultima version de GitHub)
cd /d "%~dp0.."
if not exist release mkdir release
"%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /platform:anycpu /optimize+ /codepage:65001 /win32icon:build\icon.ico /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll /out:release\Instalar-Petalwave.exe build\Installer.cs
if errorlevel 1 ( echo No se pudo compilar el instalador. & exit /b 1 )
echo listo: release\Instalar-Petalwave.exe
