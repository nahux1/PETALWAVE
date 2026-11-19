# Arma release\petalwave (portable, todo incluido), release\petalwave-windows.zip y release\petalwave-update.zip.
# Sin datos personales: nada de data\, descargas\, cookies, wallpaper ni sync.
# Uso: powershell -ExecutionPolicy Bypass -File tools\make-release.ps1
$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $PSScriptRoot
$rel = Join-Path $src 'release'
$out = Join-Path $rel 'petalwave'
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force $out, "$out\runtime", "$out\bin", "$out\licencias" | Out-Null

# codigo de la app
foreach ($f in 'server.js', 'index.html', 'README.md', 'CHANGELOG.md', 'petalwave.ico', 'build.bat', 'iniciar.bat', 'LICENSE', 'version.json') { Copy-Item "$src\$f" $out }
foreach ($d in 'ui', 'src', 'build') { Copy-Item "$src\$d" "$out\$d" -Recurse }
New-Item -ItemType Directory -Force "$out\lib" | Out-Null
Copy-Item "$src\lib\*.dll" "$out\lib"
Copy-Item "$src\lib\py" "$out\lib\py" -Recurse
Get-ChildItem "$out\lib\py" -Recurse -Directory -Filter __pycache__ | Remove-Item -Recurse -Force
Get-ChildItem "$out\src" -Recurse -Directory -Filter __pycache__ | Remove-Item -Recurse -Force

# petalwave.exe compilado con el launcher (busca runtime\node.exe)
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /platform:x64 /optimize+ "/win32icon:$src\build\icon.ico" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Management.dll "/r:$src\lib\Microsoft.Web.WebView2.Core.dll" "/r:$src\lib\Microsoft.Web.WebView2.WinForms.dll" "/out:$out\petalwave.exe" "$src\build\Launcher.cs"
if ($LASTEXITCODE) { throw 'no compilo petalwave.exe' }

# Node.js portable
Copy-Item 'C:\Program Files\nodejs\node.exe' "$out\runtime\node.exe"
Copy-Item 'C:\Program Files\nodejs\LICENSE' "$out\licencias\node-LICENSE.txt" -ErrorAction SilentlyContinue

# yt-dlp y ffmpeg (instalados con winget)
Copy-Item "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\yt-dlp.exe" "$out\bin\yt-dlp.exe"
$ffd = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe" -Directory | Select-Object -First 1
Copy-Item "$($ffd.FullName)\bin\ffmpeg.exe", "$($ffd.FullName)\bin\ffprobe.exe" "$out\bin"
Get-ChildItem $ffd.FullName -File | Where-Object Name -match 'LICENSE|README' | ForEach-Object { Copy-Item $_.FullName "$out\licencias\ffmpeg-$($_.Name)" }
Set-Content "$out\licencias\yt-dlp-LICENSE.txt" 'yt-dlp: The Unlicense (public domain) - https://github.com/yt-dlp/yt-dlp' -Encoding ascii
Copy-Item "$src\ui\fonts\LICENCIA.txt" "$out\licencias\fuentes-LICENCIA.txt"

# Python embebible (oficial de python.org) para YouTube Music (ytmusicapi)
$pyZip = Join-Path $rel 'python-embed.zip'
if (-not (Test-Path $pyZip)) { Invoke-WebRequest 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip' -OutFile $pyZip -UseBasicParsing }
Expand-Archive $pyZip "$out\runtime\python" -Force
Copy-Item "$out\runtime\python\LICENSE.txt" "$out\licencias\python-LICENSE.txt" -ErrorAction SilentlyContinue

# guia rapida en la carpeta
Copy-Item "$src\LEEME.txt" $out

# zip completo
$zip = Join-Path $rel 'petalwave-windows.zip'
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path $out -DestinationPath $zip -CompressionLevel Optimal
'{0:N0} MB carpeta - {1:N0} MB zip' -f ((Get-ChildItem $out -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), ((Get-Item $zip).Length / 1MB)

# paquete de actualizacion (solo la app + yt-dlp): lo usa el boton "actualizar" de petalwave 2.4+
$upd = Join-Path $rel 'upd'
if (Test-Path $upd) { Remove-Item -Recurse -Force $upd }
New-Item -ItemType Directory -Force (Join-Path $upd 'petalwave/bin') | Out-Null
$dst = Join-Path $upd 'petalwave'
foreach ($f in 'server.js', 'index.html', 'version.json', 'README.md', 'LEEME.txt', 'CHANGELOG.md', 'LICENSE', 'petalwave.ico', 'petalwave.exe', 'build.bat', 'iniciar.bat') { Copy-Item (Join-Path $out $f) $dst }
foreach ($d in 'ui', 'src', 'build', 'lib') { Copy-Item (Join-Path $out $d) (Join-Path $dst $d) -Recurse }
Copy-Item (Join-Path $out 'bin/yt-dlp.exe') (Join-Path $dst 'bin')
$uzip = Join-Path $rel 'petalwave-update.zip'
if (Test-Path $uzip) { Remove-Item $uzip }
Compress-Archive -Path $dst -DestinationPath $uzip -CompressionLevel Optimal
Remove-Item -Recurse -Force $upd
'actualizacion: {0:N0} MB' -f ((Get-Item $uzip).Length / 1MB)
