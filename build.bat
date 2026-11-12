@echo off
rem Recompila petalwave.exe (usa el compilador C# que trae Windows + WebView2 de .\lib)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File build\make-icon.ps1
"%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /platform:x64 /optimize+ /win32icon:build\icon.ico /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Management.dll /r:lib\Microsoft.Web.WebView2.Core.dll /r:lib\Microsoft.Web.WebView2.WinForms.dll /out:petalwave.exe build\Launcher.cs
if errorlevel 1 (echo ERROR al compilar & pause & exit /b 1)
echo petalwave.exe listo.
