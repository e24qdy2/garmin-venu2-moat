Add-Type -AssemblyName System.Drawing

$OutDir = Join-Path $PSScriptRoot "dist\store-assets"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function New-Color([int]$r, [int]$g, [int]$b) {
    return [System.Drawing.Color]::FromArgb(255, $r, $g, $b)
}

function Build-DeviceStoreIcon([string]$fileName, [string]$mode) {
    $bmp = New-Object System.Drawing.Bitmap 128, 128, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    # Use no anti-aliasing so the exact palette color count stays strictly within 2, 8, 16, or 64 colors!
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::SingleBitPerPixelGridFit
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor

    $cBlack   = New-Color 0 0 0
    $cWhite   = New-Color 255 255 255
    $cGreen   = New-Color 0 255 0
    $cCyan    = New-Color 0 255 255
    $cDarkGrn = New-Color 0 170 85
    $cNavy    = New-Color 0 42 85
    $cSlate   = New-Color 85 85 85
    $cYellow  = New-Color 255 255 0

    if ($mode -eq "2") {
        $cGreen   = $cWhite
        $cCyan    = $cWhite
        $cDarkGrn = $cWhite
        $cNavy    = $cBlack
        $cSlate   = $cWhite
        $cYellow  = $cWhite
    } elseif ($mode -eq "8") {
        $cDarkGrn = $cGreen
        $cNavy    = $cBlack
        $cSlate   = $cCyan
    }

    $bBlack   = New-Object System.Drawing.SolidBrush $cBlack
    $bWhite   = New-Object System.Drawing.SolidBrush $cWhite
    $bGreen   = New-Object System.Drawing.SolidBrush $cGreen
    $bCyan    = New-Object System.Drawing.SolidBrush $cCyan
    $bDarkGrn = New-Object System.Drawing.SolidBrush $cDarkGrn
    $bNavy    = New-Object System.Drawing.SolidBrush $cNavy

    $pCyan  = New-Object System.Drawing.Pen $cCyan, 3
    $pSlate = New-Object System.Drawing.Pen $cSlate, 2
    $pGreen = New-Object System.Drawing.Pen $cGreen, 4
    $pWhite = New-Object System.Drawing.Pen $cWhite, 2

    # 1. Pure Black Background
    $g.FillRectangle($bBlack, 0, 0, 128, 128)

    # 2. Inner Card / Shield Frame
    if ($mode -ne "2") {
        $g.FillRectangle($bNavy, 10, 10, 108, 108)
    }
    $g.DrawRectangle($pCyan, 10, 10, 107, 107)

    # 3. Candlestick / Moat Pillars
    $g.FillRectangle($bDarkGrn, 24, 68, 12, 32)
    $g.FillRectangle($bGreen,   44, 54, 12, 46)
    $g.FillRectangle($bCyan,    64, 42, 12, 58)
    $g.FillRectangle($bGreen,   84, 28, 12, 72)

    # 4. Upward Sparkline Trend Line
    $pts = @(
        (New-Object System.Drawing.Point 22, 62),
        (New-Object System.Drawing.Point 48, 46),
        (New-Object System.Drawing.Point 70, 50),
        (New-Object System.Drawing.Point 98, 22)
    )
    $g.DrawLines($pWhite, $pts)
    $g.FillRectangle($bWhite, 94, 18, 8, 8)

    # 5. "MOAT" Label at Bottom
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $font = New-Object System.Drawing.Font "Consolas", 13, ([System.Drawing.FontStyle]::Bold)
    $g.DrawString("MOAT", $font, $bWhite, 64, 100, $sf)

    $outPath = Join-Path $OutDir $fileName
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)

    # Count unique colors to verify strict compliance
    $colors = New-Object System.Collections.Generic.HashSet[int]
    for ($y = 0; $y -lt 128; $y++) {
        for ($x = 0; $x -lt 128; $x++) {
            [void]$colors.Add($bmp.GetPixel($x, $y).ToArgb())
        }
    }
    Write-Host "[OK] $fileName -> 128x128 px, Unique Colors: $($colors.Count)"
    $g.Dispose()
    $bmp.Dispose()
}

Build-DeviceStoreIcon "icon-128x128-64colors.png" "64"
Build-DeviceStoreIcon "icon-128x128-16colors.png" "16"
Build-DeviceStoreIcon "icon-128x128-8colors.png"  "8"
Build-DeviceStoreIcon "icon-128x128-2colors.png"  "2"
