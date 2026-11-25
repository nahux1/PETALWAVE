# publica la versión en GitHub (solo cuando ya está todo armado y probado)
# uso: powershell -ExecutionPolicy Bypass -File tools\publicar.ps1 -Apk 1.12.0
# Necesita: release\petalwave-windows.zip, petalwave-update.zip, latest.json, Petalwave-android-<Apk>.apk,
# Instalar-Petalwave.exe y tools\notes\<versión>.md. Sube también el APK con nombre fijo (Petalwave-android.apk)
# para que los links "latest/download/..." de la web y el README sirvan siempre.
param([Parameter(Mandatory = $true)][string]$Apk)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$v = (Get-Content version.json -Raw | ConvertFrom-Json).version
$notes = "tools\notes\$v.md"
$files = @('release\petalwave-windows.zip', 'release\petalwave-update.zip', 'release\latest.json', "release\Petalwave-android-$Apk.apk", 'release\Instalar-Petalwave.exe')
foreach ($f in @($notes) + $files) { if (-not (Test-Path $f)) { throw "falta $f" } }
if ((Get-Content release\latest.json -Raw | ConvertFrom-Json).version -ne $v) { throw 'latest.json no es de esta versión: corré make-manifest' }
Copy-Item "release\Petalwave-android-$Apk.apk" release\Petalwave-android.apk -Force
node tools\release-body.js $notes release\release-body.md
$dot = [char]0x00B7   # "·" (escrito así para que PowerShell 5 no lo rompa)
$title = "Petalwave $v $dot Android $Apk"
$first = (Get-Content $notes -Encoding UTF8 | Where-Object { $_ -match '^## ' } | Select-Object -First 1) -replace '^##\s*', ''
if ($first) { $title = "$title $dot $first" }
gh release create "v$v" @files release\Petalwave-android.apk -R nahux1/PETALWAVE --title $title --notes-file release\release-body.md --latest
