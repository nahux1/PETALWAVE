# Prueba del actualizador con release\latest.json: un paquete adulterado (debe rechazarse) y despues el bueno.
# Uso: powershell -ExecutionPolicy Bypass -File tools\test-update.ps1 -From 2.7.0 [-Work <carpeta temporal>]
param([Parameter(Mandatory)][string]$From, [string]$Work = (Join-Path $env:TEMP 'petalwave-updtest'))
$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $PSScriptRoot; $rel = Join-Path $src 'release'
if (Test-Path $Work) { Remove-Item -Recurse -Force $Work }
New-Item -ItemType Directory -Force $Work | Out-Null
Expand-Archive "$rel\petalwave-windows.zip" $Work -Force
$app = "$Work\petalwave"
"{ `"version`": `"$From`" }" | Set-Content "$app\version.json" -Encoding ascii
New-Item -ItemType Directory -Force "$app\data", "$app\descargas" | Out-Null
'{"miAjuste":"rosa"}' | Set-Content "$app\data\settings.json" -Encoding ascii
'cancion' | Set-Content "$app\descargas\mi cancion.mp3" -Encoding ascii
# manifiestos locales: el paquete se lee del disco (file:///)
$m = Get-Content "$rel\latest.json" -Raw | ConvertFrom-Json
$m.update.url = 'file:///' + ("$rel\petalwave-update.zip" -replace '\\', '/')
$good = "$Work\latest-local.json"; $bad = "$Work\latest-bad.json"
$m | ConvertTo-Json -Depth 5 | Set-Content $good -Encoding utf8
$m.update.sha256 = '0' * 64; $m | ConvertTo-Json -Depth 5 | Set-Content $bad -Encoding utf8
function Run($manifest) {
  $env:PORT = '3742'; $env:PW_UPDATE_MANIFEST = $manifest; $env:PW_UPDATE_NORESTART = '1'; $env:PW_UPDATE_LOCAL = ''
  $p = Start-Process "$app\runtime\node.exe" -ArgumentList 'server.js', '--no-open' -WorkingDirectory $app -WindowStyle Hidden -PassThru
  Start-Sleep 3
  $c = Invoke-RestMethod 'http://127.0.0.1:3742/api/update?force=1'
  "  consulta: tengo $($c.current) - hay $($c.latest) - por $($c.via) - sha256 $([bool]$c.sha256)"
  try { $a = Invoke-RestMethod -Method POST 'http://127.0.0.1:3742/api/update/apply'; "  preparado: $($a.version)" } catch { "  rechazado" }
  try { Invoke-WebRequest -Method POST 'http://127.0.0.1:3742/api/quit' -UseBasicParsing | Out-Null } catch {}
  for ($i = 0; $i -lt 30; $i++) { Start-Sleep 1; if ((Test-Path "$app\data\update\instalar.log") -and (Select-String "$app\data\update\instalar.log" -Pattern 'robocopy' -Quiet)) { break }; if (-not (Get-Process -Id $p.Id -ErrorAction SilentlyContinue) -and -not (Test-Path "$app\data\update\instalar.vbs")) { break } }
  Start-Sleep 1
  "  version instalada: " + ((Get-Content "$app\version.json" -Raw | ConvertFrom-Json).version)
}
'== paquete adulterado (SHA-256 que no coincide)'; Run $bad
'== paquete correcto'; Run $good
"ajustes intactos: " + ((Get-Content "$app\data\settings.json" -Raw) -match 'miAjuste') + " - musica intacta: " + (Test-Path "$app\descargas\mi cancion.mp3")
