# Genera el logo de petalwave: una flor de cerezo (petal) atravesada por una onda de sonido (wave).
# Salida: icon.png (256 px, para la ventana y la web) e icon.ico (256/128/64/48/32/24/16, para el .exe).
Add-Type -AssemblyName System.Drawing
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$C = { param($a, $r, $g, $b) [System.Drawing.Color]::FromArgb($a, $r, $g, $b) }

function New-RoundRect([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90); $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90); $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure(); return $p
}

# pétalo de cerezo (con la muesca en la punta), base en (0,0) y punta hacia arriba
function New-Petal([single]$L) {
  $w = $L * 0.44
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddBezier([single]0, [single]0, [single](-$w * 0.95), [single](-$L * 0.18), [single](-$w * 1.1), [single](-$L * 0.78), [single](-$w * 0.34), [single](-$L * 0.99))
  $p.AddLine([single](-$w * 0.34), [single](-$L * 0.99), [single]0, [single](-$L * 0.84))
  $p.AddLine([single]0, [single](-$L * 0.84), [single]($w * 0.34), [single](-$L * 0.99))
  $p.AddBezier([single]($w * 0.34), [single](-$L * 0.99), [single]($w * 1.1), [single](-$L * 0.78), [single]($w * 0.95), [single](-$L * 0.18), [single]0, [single]0)
  $p.CloseFigure(); return $p
}

function New-IconPng([int]$s) {
  $small = $s -le 32
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.PixelOffsetMode = 'HighQuality'; $g.CompositingQuality = 'HighQuality'
  $pad = [single]($s * 0.03); $W = [single]($s - 2 * $pad)

  # ---- fondo: cuadrado redondeado ciruela → negro ----
  $bg = New-RoundRect $pad $pad $W $W ([single]($s * 0.2))
  $rect = New-Object System.Drawing.RectangleF $pad, $pad, $W, $W
  $bgb = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, (& $C 255 52 14 40), (& $C 255 10 4 8), 55.0
  $g.FillPath($bgb, $bg)
  $g.SetClip($bg)
  # brillo rosa detrás de la flor
  $cx = [single]($s * 0.5); $cy = [single]($s * 0.43)
  $glow = New-Object System.Drawing.Drawing2D.GraphicsPath
  $gr = [single]($s * 0.46)
  $glow.AddEllipse([single]($cx - $gr), [single]($cy - $gr), [single]($gr * 2), [single]($gr * 2))
  $gb = New-Object System.Drawing.Drawing2D.PathGradientBrush $glow
  $gb.CenterColor = (& $C 150 236 72 128); $gb.SurroundColors = @((& $C 0 236 72 128))
  $g.FillPath($gb, $glow)

  # ---- flor de cerezo: 5 pétalos ----
  $L = [single]($s * 0.31)
  for ($k = 0; $k -lt 5; $k++) {
    $petal = New-Petal $L
    $m = New-Object System.Drawing.Drawing2D.Matrix
    $m.Translate($cx, $cy); $m.Rotate([single]($k * 72))
    $petal.Transform($m)
    $pb = New-Object System.Drawing.Drawing2D.PathGradientBrush $petal
    $pb.CenterPoint = New-Object System.Drawing.PointF $cx, $cy
    $pb.CenterColor = (& $C 255 255 236 244)
    $pb.SurroundColors = @((& $C 255 242 120 168))
    $g.FillPath($pb, $petal)
    if (-not $small) {
      $pp = New-Object System.Drawing.Pen ((& $C 150 150 30 80)), ([single]($s / 160))
      $g.DrawPath($pp, $petal)
    }
  }
  # centro y estambres (hilitos finos con una gota en la punta, como en el cerezo)
  $cr = [single]($s * 0.05)
  if ($s -ge 48) {
    $sp = New-Object System.Drawing.Pen ((& $C 230 205 50 105)), ([single]($s / 170))
    $dot = New-Object System.Drawing.SolidBrush (& $C 255 214 62 118)
    for ($k = 0; $k -lt 10; $k++) {
      $a = ($k * 36 + 18 - 90) * [Math]::PI / 180
      $len = $cr * $(if ($k % 2) { 2.1 } else { 2.6 })
      $ex = $cx + [Math]::Cos($a) * $len; $ey = $cy + [Math]::Sin($a) * $len
      $g.DrawLine($sp, $cx, $cy, [single]$ex, [single]$ey)
      $dr = $s * 0.011
      $g.FillEllipse($dot, [single]($ex - $dr), [single]($ey - $dr), [single]($dr * 2), [single]($dr * 2))
    }
  }
  $g.FillEllipse((New-Object System.Drawing.SolidBrush (& $C 255 255 238 246)), [single]($cx - $cr), [single]($cy - $cr), [single]($cr * 2), [single]($cr * 2))

  # ---- onda de sonido que atraviesa la flor ----
  $pts = New-Object System.Collections.Generic.List[System.Drawing.PointF]
  $x0 = $s * 0.1; $x1 = $s * 0.9; $wy = $s * 0.69; $amp = $s * ($(if ($small) { 0.1 } else { 0.115 }))
  $cycles = $(if ($small) { 2.0 } else { 3.0 })
  $n = [Math]::Max(40, $s)
  for ($i = 0; $i -le $n; $i++) {
    $t = $i / $n
    $env = [Math]::Pow([Math]::Sin([Math]::PI * $t), 1.4)          # más fuerte en el centro, como un audio real
    $y = $wy - [Math]::Sin($t * [Math]::PI * 2 * $cycles) * $amp * $env
    $pts.Add((New-Object System.Drawing.PointF ([single]($x0 + ($x1 - $x0) * $t)), ([single]$y)))
  }
  $arr = $pts.ToArray()
  if (-not $small) {
    $glowPen = New-Object System.Drawing.Pen ((& $C 110 255 90 150)), ([single]($s * 0.075))
    $glowPen.LineJoin = 'Round'; $glowPen.StartCap = 'Round'; $glowPen.EndCap = 'Round'
    $g.DrawLines($glowPen, $arr)
  }
  $wavePen = New-Object System.Drawing.Pen ((& $C 255 255 244 249)), ([single]($s * $(if ($small) { 0.075 } else { 0.034 })))
  $wavePen.LineJoin = 'Round'; $wavePen.StartCap = 'Round'; $wavePen.EndCap = 'Round'
  $g.DrawLines($wavePen, $arr)

  # ---- borde fino ----
  $g.ResetClip()
  if (-not $small) {
    $bp = New-Object System.Drawing.Pen ((& $C 110 240 130 175)), ([single][Math]::Max(1, $s / 90))
    $g.DrawPath($bp, $bg)
  }
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  return ,$ms.ToArray()
}

# los tamaños chicos van como BMP (DIB 32 bits con alfa): Windows y .NET los leen siempre bien.
# (todos los tamaños en DIB: es el formato que acepta cualquier parte de Windows)
function To-Dib([byte[]]$png) {
  $img = [System.Drawing.Bitmap]::FromStream((New-Object System.IO.MemoryStream (, $png)))
  $s = $img.Width
  $rect = New-Object System.Drawing.Rectangle 0, 0, $s, $s
  $bd = $img.LockBits($rect, 'ReadOnly', [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $raw = New-Object byte[] ($bd.Stride * $s)
  [System.Runtime.InteropServices.Marshal]::Copy($bd.Scan0, $raw, 0, $raw.Length)
  $img.UnlockBits($bd); $img.Dispose()
  $maskRow = [int]([Math]::Ceiling($s / 32.0) * 4)
  $ms = New-Object System.IO.MemoryStream; $w = New-Object System.IO.BinaryWriter $ms
  $w.Write([uint32]40); $w.Write([int32]$s); $w.Write([int32]($s * 2)); $w.Write([uint16]1); $w.Write([uint16]32)
  $w.Write([uint32]0); $w.Write([uint32]($s * $s * 4 + $maskRow * $s)); $w.Write([int32]0); $w.Write([int32]0); $w.Write([uint32]0); $w.Write([uint32]0)
  for ($y = $s - 1; $y -ge 0; $y--) { $w.Write($raw, $y * $bd.Stride, $s * 4) }   # filas de abajo hacia arriba (BGRA)
  $w.Write((New-Object byte[] ($maskRow * $s)))                                       # máscara AND vacía (usa el alfa)
  $w.Flush(); return ,$ms.ToArray()
}

$sizes = 256, 128, 64, 48, 32, 24, 16
$pngs = @{}; foreach ($s in $sizes) { $pngs[$s] = New-IconPng $s }
[System.IO.File]::WriteAllBytes((Join-Path $here 'icon.png'), $pngs[256])
$data = @{}; foreach ($s in $sizes) { $data[$s] = To-Dib $pngs[$s] }

$out = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $out
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
foreach ($s in $sizes) {
  $d = $data[$s]; $dim = if ($s -ge 256) { 0 } else { $s }
  $bw.Write([byte]$dim); $bw.Write([byte]$dim); $bw.Write([byte]0); $bw.Write([byte]0)
  $bw.Write([uint16]1); $bw.Write([uint16]32); $bw.Write([uint32]$d.Length); $bw.Write([uint32]$offset)
  $offset += $d.Length
}
foreach ($s in $sizes) { $bw.Write($data[$s]) }
$bw.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $here 'icon.ico'), $out.ToArray())
Write-Host "icon.png e icon.ico generados"