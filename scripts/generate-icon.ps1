# Original vector artwork mirrored from assets/pi-portable.svg. No external image tools required.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
New-Item -ItemType Directory -Force (Join-Path $root 'assets'), (Join-Path $root '.build') | Out-Null
$frames = @()
foreach ($size in @(16, 24, 32, 48, 64, 128, 256)) {
    $bitmap = [Drawing.Bitmap]::new($size, $size)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.ScaleTransform($size / 256.0, $size / 256.0)
    $tile = [Drawing.Drawing2D.GraphicsPath]::new()
    foreach ($arc in @(@(4,4,96,96,180), @(156,4,96,96,270), @(156,156,96,96,0), @(4,156,96,96,90))) {
        $tile.AddArc($arc[0], $arc[1], $arc[2], $arc[3], $arc[4], 90)
    }
    $tile.CloseFigure()
    $navy = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#101c2e'))
    $teal = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#133c40'))
    $white = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#f5fafc'))
    $outline = [Drawing.Pen]::new([Drawing.ColorTranslator]::FromHtml('#50e3b5'), 10)
    $outline.LineJoin = [Drawing.Drawing2D.LineJoin]::Round
    $shield = [Drawing.Drawing2D.GraphicsPath]::new()
    $shield.AddLines([Drawing.PointF[]]@([Drawing.PointF]::new(128,28), [Drawing.PointF]::new(214,62), [Drawing.PointF]::new(214,122)))
    $shield.AddBezier(214,122,214,169,181,207,128,230)
    $shield.AddBezier(128,230,75,207,42,169,42,122)
    $shield.AddLine(42,122,42,62)
    $shield.CloseFigure()
    $pi = [Drawing.Drawing2D.GraphicsPath]::new()
    $pi.AddLines([Drawing.PointF[]]@([Drawing.PointF]::new(78,84), [Drawing.PointF]::new(178,84), [Drawing.PointF]::new(178,101), [Drawing.PointF]::new(158,101), [Drawing.PointF]::new(158,150)))
    $pi.AddBezier(158,150,158,158,162,161,171,158)
    $pi.AddLine(171,158,171,175)
    $pi.AddBezier(171,175,150,179,140,177,140,151)
    $pi.AddLine(140,151,140,101)
    $pi.AddLine(140,101,115,101)
    $pi.AddBezier(115,101,115,131,109,156,96,175)
    $pi.AddLine(96,175,75,175)
    $pi.AddBezier(75,175,90,152,97,128,97,101)
    $pi.AddLine(97,101,78,101)
    $pi.CloseFigure()
    $graphics.FillPath($navy, $tile)
    $graphics.FillPath($teal, $shield)
    $graphics.DrawPath($outline, $shield)
    $graphics.FillPath($white, $pi)
    $stream = [IO.MemoryStream]::new()
    $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
    $frames += ,$stream.ToArray()
    if ($size -eq 256) { $bitmap.Save((Join-Path $root '.build/pi-portable-icon.png'), [Drawing.Imaging.ImageFormat]::Png) }
    foreach ($resource in @($stream,$pi,$shield,$outline,$white,$teal,$navy,$tile,$graphics,$bitmap)) { $resource.Dispose() }
}
$file = [IO.File]::Create((Join-Path $root 'assets/pi-portable.ico'))
$writer = [IO.BinaryWriter]::new($file)
try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$frames.Count)
    $offset = 6 + 16 * $frames.Count
    $sizes = @(16,24,32,48,64,128,256)
    for ($i = 0; $i -lt $frames.Count; $i++) {
        $dimension = if ($sizes[$i] -eq 256) { 0 } else { $sizes[$i] }
        $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
        $writer.Write([byte]0); $writer.Write([byte]0)
        $writer.Write([uint16]1); $writer.Write([uint16]32)
        $writer.Write([uint32]$frames[$i].Length); $writer.Write([uint32]$offset)
        $offset += $frames[$i].Length
    }
    foreach ($frame in $frames) { $writer.Write([byte[]]$frame) }
} finally { $writer.Dispose() }
Write-Output 'Generated assets/pi-portable.ico (16–256 px) and .build/pi-portable-icon.png.'
