Add-Type -AssemblyName System.Drawing

$OutDir = Join-Path $PSScriptRoot "dist\store-assets"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$DotSep = " " + [char]0x2022 + " "
$BahtSym = [char]0x0E3F

function New-Color([int]$r, [int]$g, [int]$b, [int]$a = 255) {
    return [System.Drawing.Color]::FromArgb($a, $r, $g, $b)
}

function Add-RoundedRectPath([System.Drawing.Drawing2D.GraphicsPath]$path, [float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $d = $r * 2
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
}

function Fill-RoundedRect([System.Drawing.Graphics]$g, [System.Drawing.Brush]$brush, [float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    Add-RoundedRectPath $path $x $y $w $h $r
    $g.FillPath($brush, $path)
    $path.Dispose()
}

function Draw-RoundedRect([System.Drawing.Graphics]$g, [System.Drawing.Pen]$pen, [float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    Add-RoundedRectPath $path $x $y $w $h $r
    $g.DrawPath($pen, $path)
    $path.Dispose()
}

function Set-HighQuality([System.Drawing.Graphics]$g) {
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
}

function Draw-WatchBezel([System.Drawing.Graphics]$g, [float]$cx, [float]$cy, [float]$screenRadius) {
    $outerR = $screenRadius + 24
    $midR = $screenRadius + 10

    # Side Crown / Buttons
    $btnBrush = New-Object System.Drawing.SolidBrush (New-Color 38 46 62)
    $btnPen = New-Object System.Drawing.Pen (New-Color 80 95 120), 1.5
    $g.FillRectangle($btnBrush, $cx + $outerR - 6, $cy - $screenRadius * 0.48, 14, 34)
    $g.DrawRectangle($btnPen, $cx + $outerR - 6, $cy - $screenRadius * 0.48, 14, 34)
    $g.FillRectangle($btnBrush, $cx + $outerR - 6, $cy + $screenRadius * 0.22, 14, 30)
    $g.DrawRectangle($btnPen, $cx + $outerR - 6, $cy + $screenRadius * 0.22, 14, 30)

    # Outer Titanium Case
    $bezelRect = New-Object System.Drawing.RectangleF ($cx - $outerR), ($cy - $outerR), ($outerR * 2), ($outerR * 2)
    $bezelGrad = New-Object System.Drawing.Drawing2D.LinearGradientBrush $bezelRect, (New-Color 45 55 72), (New-Color 15 20 28), 45.0
    $g.FillEllipse($bezelGrad, $bezelRect)

    $outerRingPen = New-Object System.Drawing.Pen (New-Color 95 110 135 160), 2.0
    $g.DrawEllipse($outerRingPen, $bezelRect)

    # Inner Bezel Ring
    $midRect = New-Object System.Drawing.RectangleF ($cx - $midR), ($cy - $midR), ($midR * 2), ($midR * 2)
    $midBrush = New-Object System.Drawing.SolidBrush (New-Color 10 13 18)
    $g.FillEllipse($midBrush, $midRect)
    $midPen = New-Object System.Drawing.Pen (New-Color 30 41 59), 2.0
    $g.DrawEllipse($midPen, $midRect)

    # True Void AMOLED Screen
    $scrRect = New-Object System.Drawing.RectangleF ($cx - $screenRadius), ($cy - $screenRadius), ($screenRadius * 2), ($screenRadius * 2)
    $scrBrush = New-Object System.Drawing.SolidBrush (New-Color 0 0 0)
    $g.FillEllipse($scrBrush, $scrRect)

    # Subtle Cyan Tick Marks on Bezel
    $tickPen = New-Object System.Drawing.Pen (New-Color 56 189 248 90), 1.5
    for ($deg = 0; $deg -lt 360; $deg += 30) {
        $rad = $deg * [Math]::PI / 180.0
        $x1 = $cx + [Math]::Cos($rad) * ($screenRadius + 3)
        $y1 = $cy + [Math]::Sin($rad) * ($screenRadius + 3)
        $x2 = $cx + [Math]::Cos($rad) * ($screenRadius + 8)
        $y2 = $cy + [Math]::Sin($rad) * ($screenRadius + 8)
        $g.DrawLine($tickPen, [float]$x1, [float]$y1, [float]$x2, [float]$y2)
    }

    $btnBrush.Dispose(); $btnPen.Dispose(); $bezelGrad.Dispose(); $outerRingPen.Dispose()
    $midBrush.Dispose(); $midPen.Dispose(); $scrBrush.Dispose(); $tickPen.Dispose()
}

function Draw-PortfolioScreenContent([System.Drawing.Graphics]$g, [float]$cx, [float]$cy, [float]$r) {
    $sfCenter = New-Object System.Drawing.StringFormat
    $sfCenter.Alignment = [System.Drawing.StringAlignment]::Center
    $sfLeft = New-Object System.Drawing.StringFormat
    $sfLeft.Alignment = [System.Drawing.StringAlignment]::Near
    $sfRight = New-Object System.Drawing.StringFormat
    $sfRight.Alignment = [System.Drawing.StringAlignment]::Far

    $fontMicro = New-Object System.Drawing.Font "Consolas", ($r * 0.054), ([System.Drawing.FontStyle]::Bold)
    $fontRow   = New-Object System.Drawing.Font "Segoe UI", ($r * 0.068), ([System.Drawing.FontStyle]::Bold)
    $fontVal   = New-Object System.Drawing.Font "Segoe UI", ($r * 0.115), ([System.Drawing.FontStyle]::Bold)

    $bSlate   = New-Object System.Drawing.SolidBrush (New-Color 148 163 184)
    $bCyan    = New-Object System.Drawing.SolidBrush (New-Color 6 182 212)
    $bSky     = New-Object System.Drawing.SolidBrush (New-Color 56 189 248)
    $bWhite   = New-Object System.Drawing.SolidBrush (New-Color 255 255 255)
    $bLight   = New-Object System.Drawing.SolidBrush (New-Color 226 232 240)
    $bEmerald = New-Object System.Drawing.SolidBrush (New-Color 16 185 129)
    $bRose    = New-Object System.Drawing.SolidBrush (New-Color 244 63 94)
    $bAmber   = New-Object System.Drawing.SolidBrush (New-Color 251 191 36)
    $bMuted   = New-Object System.Drawing.SolidBrush (New-Color 100 116 139)
    $bCard    = New-Object System.Drawing.SolidBrush (New-Color 13 19 28)
    $bFgiBg   = New-Object System.Drawing.SolidBrush (New-Color 16 185 129 38)
    $pFgiPen  = New-Object System.Drawing.Pen (New-Color 16 185 129 160), 1.2

    $top = $cy - $r
    $h = $r * 2
    $w = $r * 2
    $left = $cx - $r

    # Header Clock + NEW Daily Fear & Greed Index (S:68 G) + Mode Flags
    $hdrY = $top + $h * 0.052
    $leftTxt = "09:41" + $DotSep
    $fgiTxt  = "S:68 G"
    $rightTxt = $DotSep + "A:5s" + $DotSep + "PRO"

    $wLeft  = $g.MeasureString($leftTxt, $fontMicro).Width
    $wFgi   = $g.MeasureString($fgiTxt, $fontMicro).Width
    $wRight = $g.MeasureString($rightTxt, $fontMicro).Width
    $totalHdrW = $wLeft + $wFgi + $wRight + 8
    $hdrStartX = $cx - ($totalHdrW / 2)

    $g.DrawString($leftTxt, $fontMicro, $bSlate, $hdrStartX, $hdrY, $sfLeft)
    Fill-RoundedRect $g $bFgiBg ($hdrStartX + $wLeft - 1) ($hdrY - 1) ($wFgi + 6) ($r * 0.082) 5
    Draw-RoundedRect $g $pFgiPen ($hdrStartX + $wLeft - 1) ($hdrY - 1) ($wFgi + 6) ($r * 0.082) 5
    $g.DrawString($fgiTxt, $fontMicro, $bEmerald, ($hdrStartX + $wLeft + 2), $hdrY, $sfLeft)
    $g.DrawString($rightTxt, $fontMicro, $bSlate, ($hdrStartX + $wLeft + $wFgi + 5), $hdrY, $sfLeft)

    $g.DrawString("< US Moat Core 1/2 >", $fontRow, $bCyan, $cx, $top + $h * 0.105, $sfCenter)
    $g.DrawString("`$148,920", $fontVal, $bWhite, $cx, $top + $h * 0.15, $sfCenter)
    $g.DrawString("DAY: +`$2,840 (+1.94%)", $fontMicro, $bEmerald, $cx, $top + $h * 0.23, $sfCenter)

    # Divider
    $divPen = New-Object System.Drawing.Pen (New-Color 30 41 59), 1.5
    $g.DrawLine($divPen, $left + $w * 0.16, $top + $h * 0.28, $left + $w * 0.84, $top + $h * 0.28)

    # 4 Responsive Holding Rows (with exact MeasureString collision prevention matching MoatWatchLayout.mc)
    $rows = @(
        @{ sym="NVDA"; ed="e-20/11/26"; px="`$138.6"; pct="+3.4%"; pos=$true;  sma="SMA:131(+5.8%)"; rsi="R:64"; loHi="L:134 H:139"; dot="EMERALD" },
        @{ sym="AAPL"; ed="e-31/10/26"; px="`$231.4"; pct="+1.2%"; pos=$true;  sma="SMA:226(+2.4%)"; rsi="R:58"; loHi="L:229 H:233"; dot="CYAN" },
        @{ sym="MSFT"; ed="";           px="`$428.5"; pct="-0.5%"; pos=$false; sma="SMA:431(-0.6%)"; rsi="R:46"; loHi="L:426 H:432"; dot="NONE" },
        @{ sym="TSM";  ed="e-16/01/27"; px="`$194.2"; pct="+4.8%"; pos=$true;  sma="SMA:182(+6.7%)"; rsi="R:71"; loHi="L:188 H:195"; dot="EMERALD" }
    )

    $rowStartY = $top + $h * 0.30
    $rowH = $h * 0.132
    $cardH = $rowH - 4

    for ($i = 0; $i -lt $rows.Count; $i++) {
        $item = $rows[$i]
        $ry = $rowStartY + ($i * $rowH)
        $midY = ($ry + $cardH / 2) - $cy
        $halfChord = [Math]::Sqrt([Math]::Max(10, ($r * $r) - ($midY * $midY)))
        $padX = ($r - $halfChord) + ($w * 0.05)
        $rx = $left + $padX
        $rw = $w - ($padX * 2)

        Fill-RoundedRect $g $bCard $rx $ry $rw $cardH 9

        if ($item.dot -eq "EMERALD") {
            $g.FillEllipse($bEmerald, $rx + 6, $ry + ($cardH * 0.25), 5, 5)
        } elseif ($item.dot -eq "CYAN") {
            $g.FillEllipse($bCyan, $rx + 6, $ry + ($cardH * 0.25), 5, 5)
        }

        $symX = $rx + 14
        $rightX = $rx + $rw - 8

        # Measure widths for zero-collision placement
        $symSize = $g.MeasureString($item.sym, $fontRow)
        $pctSize = $g.MeasureString($item.pct, $fontRow)
        $smaSize = $g.MeasureString($item.sma, $fontMicro)

        $g.DrawString($item.sym, $fontRow, $bWhite, $symX, $ry + 2, $sfLeft)
        if ($item.ed -ne "") {
            $g.DrawString($item.ed, $fontMicro, $bAmber, $symX + $symSize.Width + 2, $ry + 4, $sfLeft)
        }

        $pctBrush = if ($item.pos) { $bEmerald } else { $bRose }
        $g.DrawString($item.pct, $fontRow, $pctBrush, $rightX, $ry + 2, $sfRight)
        $g.DrawString($item.px, $fontRow, $bLight, $rightX - $pctSize.Width - 4, $ry + 2, $sfRight)

        # Sub-metrics line: SMA20 + RSI14 + L/H
        $subY = $ry + $cardH - ($r * 0.082)
        $g.DrawString($item.sma, $fontMicro, $bSky, $symX, $subY, $sfLeft)
        $rsiBrush = if ($item.rsi -eq "R:71") { $bAmber } else { $bEmerald }
        $g.DrawString($item.rsi, $fontMicro, $rsiBrush, $symX + $smaSize.Width + 3, $subY, $sfLeft)
        $g.DrawString($item.loHi, $fontMicro, $bSlate, $rightX, $subY, $sfRight)
    }

    # Bottom Sync Key & Dots (Device-neutral GARMIN88)
    $g.DrawString("KEY: V2-GARMIN88", $fontMicro, $bMuted, $cx, $top + $h * 0.855, $sfCenter)
    $g.FillEllipse($bCyan, $cx - 14, $top + $h * 0.925, 8, 8)
    $g.FillEllipse($bMuted, $cx + 2, $top + $h * 0.928, 6, 6)
    $g.FillEllipse($bMuted, $cx + 16, $top + $h * 0.928, 6, 6)
}

function Draw-SparklineScreenContent([System.Drawing.Graphics]$g, [float]$cx, [float]$cy, [float]$r) {
    $sfCenter = New-Object System.Drawing.StringFormat
    $sfCenter.Alignment = [System.Drawing.StringAlignment]::Center

    $fontMicro = New-Object System.Drawing.Font "Consolas", ($r * 0.056), ([System.Drawing.FontStyle]::Bold)
    $fontRow   = New-Object System.Drawing.Font "Segoe UI", ($r * 0.068), ([System.Drawing.FontStyle]::Bold)
    $fontVal   = New-Object System.Drawing.Font "Segoe UI", ($r * 0.080), ([System.Drawing.FontStyle]::Bold)

    $bWhite   = New-Object System.Drawing.SolidBrush (New-Color 255 255 255)
    $bEmerald = New-Object System.Drawing.SolidBrush (New-Color 16 185 129)
    $bCyan    = New-Object System.Drawing.SolidBrush (New-Color 6 182 212)
    $bLight   = New-Object System.Drawing.SolidBrush (New-Color 226 232 240)
    $bSlate   = New-Object System.Drawing.SolidBrush (New-Color 203 213 225)
    $bBox     = New-Object System.Drawing.SolidBrush (New-Color 11 15 23)

    $top = $cy - $r
    $left = $cx - $r
    $w = $r * 2
    $h = $r * 2

    $g.DrawString("< NVDA" + $DotSep + "e-20/11/26" + $DotSep + "TARGET", $fontVal, $bWhite, $cx, $top + $h * 0.085, $sfCenter)
    $g.DrawString("Now: `$138.60  +4.55 (+3.40%)", $fontRow, $bEmerald, $cx, $top + $h * 0.15, $sfCenter)
    $g.DrawString("Day L: `$134.20  H: `$139.50", $fontMicro, $bLight, $cx, $top + $h * 0.21, $sfCenter)
    $g.DrawString("SMA20: `$131.0 (+5.8%)" + $DotSep + "RSI14: 64" + $DotSep + "BB", $fontMicro, $bCyan, $cx, $top + $h * 0.265, $sfCenter)

    # Sparkline Chart Box
    $chartX = $left + $w * 0.13
    $chartY = $top + $h * 0.33
    $chartW = $w * 0.74
    $chartH = $h * 0.22
    Fill-RoundedRect $g $bBox ($chartX - 6) ($chartY - 4) ($chartW + 12) ($chartH + 8) 10

    # Bollinger Bands (Upper & Lower)
    $bbPen = New-Object System.Drawing.Pen (New-Color 30 58 138), 1.5
    $g.DrawLine($bbPen, $chartX, $chartY + $chartH * 0.14, $chartX + $chartW, $chartY + $chartH * 0.14)
    $g.DrawLine($bbPen, $chartX, $chartY + $chartH * 0.86, $chartX + $chartW, $chartY + $chartH * 0.86)

    # SMA20 Cyan Line
    $smaPen = New-Object System.Drawing.Pen (New-Color 6 182 212), 2.0
    $g.DrawLine($smaPen, $chartX, $chartY + $chartH * 0.52, $chartX + $chartW, $chartY + $chartH * 0.52)

    # 20D Sparkline Points
    $vals = @(0.78, 0.74, 0.76, 0.68, 0.64, 0.67, 0.58, 0.53, 0.56, 0.48, 0.44, 0.47, 0.39, 0.35, 0.38, 0.31, 0.28, 0.25, 0.22, 0.18)
    $spkPen = New-Object System.Drawing.Pen (New-Color 16 185 129), 3.0
    for ($k = 0; $k -lt ($vals.Count - 1); $k++) {
        $x1 = $chartX + ($k * $chartW) / ($vals.Count - 1)
        $y1 = $chartY + ($vals[$k] * $chartH)
        $x2 = $chartX + (($k + 1) * $chartW) / ($vals.Count - 1)
        $y2 = $chartY + ($vals[$k + 1] * $chartH)
        $g.DrawLine($spkPen, [float]$x1, [float]$y1, [float]$x2, [float]$y2)
    }
    $lastX = $chartX + $chartW
    $lastY = $chartY + ($vals[$vals.Count - 1] * $chartH)
    $g.FillEllipse($bWhite, [float]($lastX - 5), [float]($lastY - 5), 10.0, 10.0)
    $g.FillEllipse($bEmerald, [float]($lastX - 3), [float]($lastY - 3), 6.0, 6.0)

    # Holdings & WebMemo
    $g.DrawString("Hold: 45.0 @ `$92.5 (+49.8%)", $fontMicro, $bSlate, $cx, $top + $h * 0.585, $sfCenter)
    $g.DrawString("WEBMEMO", $fontMicro, $bCyan, $cx, $top + $h * 0.655, $sfCenter)
    $g.DrawString("AI GPU Moat intact" + $DotSep + "Hold to `$155", $fontMicro, $bWhite, $cx, $top + $h * 0.715, $sfCenter)
    $g.DrawString("Strong datacenter FCF margin", $fontMicro, $bSlate, $cx, $top + $h * 0.765, $sfCenter)
}

function Save-JpgWithMaxKb([System.Drawing.Bitmap]$bmp, [string]$filePath, [int]$maxKb, [long]$quality = 90) {
    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
    $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, $quality)
    $bmp.Save($filePath, $codec, $ep)
    $ep.Dispose()
}

# ==============================================================================
# 1. SCREEN IMAGE 1: Portfolio Overview + FGI Header Badge (500x500 < 150 KB)
# ==============================================================================
$bmp1 = New-Object System.Drawing.Bitmap 500, 500
$g1 = [System.Drawing.Graphics]::FromImage($bmp1)
Set-HighQuality $g1
$bgGrad1 = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Rectangle 0, 0, 500, 500), (New-Color 7 11 18), (New-Color 15 23 42), 45.0
$g1.FillRectangle($bgGrad1, 0, 0, 500, 500)
Draw-WatchBezel $g1 250 250 205
Draw-PortfolioScreenContent $g1 250 250 205
$screen1Png = Join-Path $OutDir "screen-1-portfolio-overview.png"
$screen1Jpg = Join-Path $OutDir "screen-1-portfolio-overview.jpg"
$bmp1.Save($screen1Png, [System.Drawing.Imaging.ImageFormat]::Png)
Save-JpgWithMaxKb $bmp1 $screen1Jpg 140 92
$g1.Dispose(); $bmp1.Dispose()

# ==============================================================================
# 2. SCREEN IMAGE 2: Symbol Detail & 20D Sparkline + BB (500x500 < 150 KB)
# ==============================================================================
$bmp2 = New-Object System.Drawing.Bitmap 500, 500
$g2 = [System.Drawing.Graphics]::FromImage($bmp2)
Set-HighQuality $g2
$bgGrad2 = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Rectangle 0, 0, 500, 500), (New-Color 7 11 18), (New-Color 12 25 38), 45.0
$g2.FillRectangle($bgGrad2, 0, 0, 500, 500)
Draw-WatchBezel $g2 250 250 205
Draw-SparklineScreenContent $g2 250 250 205
$screen2Png = Join-Path $OutDir "screen-2-symbol-sparkline.png"
$screen2Jpg = Join-Path $OutDir "screen-2-symbol-sparkline.jpg"
$bmp2.Save($screen2Png, [System.Drawing.Imaging.ImageFormat]::Png)
Save-JpgWithMaxKb $bmp2 $screen2Jpg 140 92
$g2.Dispose(); $bmp2.Dispose()

# ==============================================================================
# 3. SCREEN IMAGE 3: Glance Widget + FGI Sentiment (500x500 < 150 KB)
# ==============================================================================
$bmp3 = New-Object System.Drawing.Bitmap 500, 500
$g3 = [System.Drawing.Graphics]::FromImage($bmp3)
Set-HighQuality $g3
$bgGrad3 = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Rectangle 0, 0, 500, 500), (New-Color 6 10 17), (New-Color 15 23 42), 45.0
$g3.FillRectangle($bgGrad3, 0, 0, 500, 500)
Draw-WatchBezel $g3 250 250 205

$sfCenter = New-Object System.Drawing.StringFormat
$sfCenter.Alignment = [System.Drawing.StringAlignment]::Center
$sfLeft = New-Object System.Drawing.StringFormat
$sfLeft.Alignment = [System.Drawing.StringAlignment]::Near

$fHead  = New-Object System.Drawing.Font "Segoe UI", 12, ([System.Drawing.FontStyle]::Bold)
$fBig   = New-Object System.Drawing.Font "Segoe UI", 21, ([System.Drawing.FontStyle]::Bold)
$fSub   = New-Object System.Drawing.Font "Consolas", 10, ([System.Drawing.FontStyle]::Bold)
$fSmall = New-Object System.Drawing.Font "Segoe UI", 9.5, ([System.Drawing.FontStyle]::Bold)

$bCyan    = New-Object System.Drawing.SolidBrush (New-Color 6 182 212)
$bWhite   = New-Object System.Drawing.SolidBrush (New-Color 255 255 255)
$bEmerald = New-Object System.Drawing.SolidBrush (New-Color 16 185 129)
$bAmber   = New-Object System.Drawing.SolidBrush (New-Color 251 191 36)
$bRose    = New-Object System.Drawing.SolidBrush (New-Color 244 63 94)
$bSky     = New-Object System.Drawing.SolidBrush (New-Color 56 189 248)
$bSlate   = New-Object System.Drawing.SolidBrush (New-Color 148 163 184)
$bCard    = New-Object System.Drawing.SolidBrush (New-Color 15 23 42)
$pCyan    = New-Object System.Drawing.Pen (New-Color 6 182 212 120), 1.5

$g3.DrawString("QUICK GLANCE WIDGET", $fSub, $bSlate, 250, 78, $sfCenter)

# Glance Card inside Watch Screen (with S:68 G Fear & Greed Index)
Fill-RoundedRect $g3 $bCard 92 112 316 124 16
Draw-RoundedRect $g3 $pCyan 92 112 316 124 16
$g3.DrawString("MOATWATCH" + $DotSep + "S:68 G", $fSub, $bCyan, 110, 126, $sfLeft)
$g3.DrawString("THB 1,482,910", $fBig, $bWhite, 110, 150, $sfLeft)
$g3.DrawString("+18,420 (+1.25%)" + $DotSep + "TODAY", $fHead, $bEmerald, 110, 196, $sfLeft)

# Feature Pills below Glance
$pills = @(
    "Daily Fear & Greed Index (Stock & Crypto)",
    "Auto-Swipe Portfolios (5s - 60s)",
    "Supports 20 Garmin Watches (AMOLED & MIP)"
)
for ($p = 0; $p -lt $pills.Count; $p++) {
    $py = 254 + ($p * 42)
    Fill-RoundedRect $g3 $bCard 102 $py 296 33 10
    $g3.FillEllipse($bEmerald, 116, $py + 12, 8, 8)
    $g3.DrawString($pills[$p], $fSmall, $bWhite, 130, $py + 8, $sfLeft)
}
$g3.DrawString("moat.readybyte.top", $fSub, $bCyan, 250, 396, $sfCenter)

$screen3Png = Join-Path $OutDir "screen-3-glance-widget.png"
$screen3Jpg = Join-Path $OutDir "screen-3-glance-widget.jpg"
$bmp3.Save($screen3Png, [System.Drawing.Imaging.ImageFormat]::Png)
Save-JpgWithMaxKb $bmp3 $screen3Jpg 140 92
$g3.Dispose(); $bmp3.Dispose()

# ==============================================================================
# 4. NEW SCREEN IMAGE 4: What's New v1.2.0 — Daily Fear & Greed Index + 20 Garmin Models (500x500 < 150 KB)
# ==============================================================================
$bmp4 = New-Object System.Drawing.Bitmap 500, 500
$g4 = [System.Drawing.Graphics]::FromImage($bmp4)
Set-HighQuality $g4
$bgGrad4 = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Rectangle 0, 0, 500, 500), (New-Color 6 10 18), (New-Color 14 28 44), 45.0
$g4.FillRectangle($bgGrad4, 0, 0, 500, 500)
Draw-WatchBezel $g4 250 250 205

$fTag   = New-Object System.Drawing.Font "Consolas", 9.0, ([System.Drawing.FontStyle]::Bold)
$fTitle4 = New-Object System.Drawing.Font "Segoe UI", 12.5, ([System.Drawing.FontStyle]::Bold)
$fZone  = New-Object System.Drawing.Font "Consolas", 8.5, ([System.Drawing.FontStyle]::Bold)
$fDesc4 = New-Object System.Drawing.Font "Segoe UI", 8.8, ([System.Drawing.FontStyle]::Bold)

$bBadge4 = New-Object System.Drawing.SolidBrush (New-Color 16 185 129 35)
$pBadge4 = New-Object System.Drawing.Pen (New-Color 16 185 129 150), 1.2
Fill-RoundedRect $g4 $bBadge4 148 70 204 24 12
Draw-RoundedRect $g4 $pBadge4 148 70 204 24 12
$g4.DrawString("NEW IN v1.2.0 UPDATE", $fTag, $bEmerald, 250, 75, $sfCenter)

$g4.DrawString("FEAR & GREED INDEX (FGI)", $fTitle4, $bWhite, 250, 102, $sfCenter)

# Dual FGI Live Pill Cards (Stock Market S:68 G & Crypto C:72 G)
Fill-RoundedRect $g4 $bCard 92 132 152 64 12
Draw-RoundedRect $g4 $pBadge4 92 132 152 64 12
$g4.DrawString("US STOCK (CNN)", $fZone, $bSlate, 168, 140, $sfCenter)
$g4.DrawString("S:68 G", $fTitle4, $bEmerald, 168, 156, $sfCenter)
$g4.DrawString("GREED ZONE", $fZone, $bEmerald, 168, 178, $sfCenter)

$pCyan4 = New-Object System.Drawing.Pen (New-Color 6 182 212 150), 1.2
Fill-RoundedRect $g4 $bCard 256 132 152 64 12
Draw-RoundedRect $g4 $pCyan4 256 132 152 64 12
$g4.DrawString("CRYPTO (ALT.ME)", $fZone, $bSlate, 332, 140, $sfCenter)
$g4.DrawString("C:72 G", $fTitle4, $bCyan, 332, 156, $sfCenter)
$g4.DrawString("GREED ZONE", $fZone, $bCyan, 332, 178, $sfCenter)

# 5 Sentiment Color Scale Bar inside Watch
$zones = @(
    @{ lbl="EF 0-24";  br=$bRose;    x=88;  w=62 },
    @{ lbl="F 25-44";  br=$bAmber;   x=153; w=62 },
    @{ lbl="N 45-55";  br=$bSlate;   x=218; w=62 },
    @{ lbl="G 56-74";  br=$bEmerald; x=283; w=62 },
    @{ lbl="EG 75+";   br=$bCyan;    x=348; w=64 }
)
for ($z = 0; $z -lt $zones.Count; $z++) {
    $zn = $zones[$z]
    Fill-RoundedRect $g4 $bCard $zn.x 206 $zn.w 28 6
    $g4.FillRectangle($zn.br, $zn.x + 4, 209, $zn.w - 8, 4)
    $g4.DrawString($zn.lbl, $fZone, $zn.br, ($zn.x + $zn.w / 2), 217, $sfCenter)
}

# 20 Supported Garmin Watch Models Card
Fill-RoundedRect $g4 $bCard 86 246 328 132 14
Draw-RoundedRect $g4 $pCyan 86 246 328 132 14
$g4.DrawString("20 GARMIN WATCHES SUPPORTED", $fTag, $bCyan, 250, 256, $sfCenter)

$families = @(
    "Venu 2 / 2S / 2 Plus / Venu 3 / 3S",
    ("vivoactive 5" + $DotSep + "Forerunner 165 / 265 / 965"),
    "fenix 8 (43/47/51mm AMOLED & Solar)",
    ("Enduro 3 (MIP)" + $DotSep + "epix Pro (Gen 2)")
)
for ($m = 0; $m -lt $families.Count; $m++) {
    $my = 278 + ($m * 23)
    $g4.FillEllipse($bEmerald, 102, $my + 5, 6, 6)
    $g4.DrawString($families[$m], $fDesc4, $bWhite, 114, $my, $sfLeft)
}

$g4.DrawString("Auto-Scaling 260px MIP to 454px AMOLED", $fZone, $bSky, 250, 392, $sfCenter)

$screen4Png = Join-Path $OutDir "screen-4-whats-new-fgi-models.png"
$screen4Jpg = Join-Path $OutDir "screen-4-whats-new-fgi-models.jpg"
$bmp4.Save($screen4Png, [System.Drawing.Imaging.ImageFormat]::Png)
Save-JpgWithMaxKb $bmp4 $screen4Jpg 140 92
$g4.Dispose(); $bmp4.Dispose()

# ==============================================================================
# 5. COVER IMAGE & ICON: 500x500 (< 300 KB)
# ==============================================================================
$bmpCover = New-Object System.Drawing.Bitmap 500, 500
$gCover = [System.Drawing.Graphics]::FromImage($bmpCover)
Set-HighQuality $gCover
$coverGrad = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Rectangle 0, 0, 500, 500), (New-Color 5 8 15), (New-Color 12 32 46), 45.0
$gCover.FillRectangle($coverGrad, 0, 0, 500, 500)

$gridPen = New-Object System.Drawing.Pen (New-Color 255 255 255 10), 1
for ($gx = 0; $gx -lt 500; $gx += 50) {
    $gCover.DrawLine($gridPen, $gx, 0, $gx, 500)
    $gCover.DrawLine($gridPen, 0, $gx, 500, $gx)
}

$fCoverTitle = New-Object System.Drawing.Font "Segoe UI", 26, ([System.Drawing.FontStyle]::Bold)
$fCoverSub   = New-Object System.Drawing.Font "Segoe UI", 9.5, ([System.Drawing.FontStyle]::Bold)
$gCover.DrawString("MoatWatch", $fCoverTitle, $bWhite, 250, 14, $sfCenter)
$gCover.DrawString("PORTFOLIO" + $DotSep + "FGI (S/C)" + $DotSep + "SMA20/RSI14" + $DotSep + "WEBMEMO", $fCoverSub, $bCyan, 250, 62, $sfCenter)

Draw-WatchBezel $gCover 250 288 170
Draw-PortfolioScreenContent $gCover 250 288 170

$coverPng = Join-Path $OutDir "cover-image-500x500.png"
$coverJpg = Join-Path $OutDir "cover-image-500x500.jpg"
$bmpCover.Save($coverPng, [System.Drawing.Imaging.ImageFormat]::Png)
Save-JpgWithMaxKb $bmpCover $coverJpg 280 94
$gCover.Dispose(); $bmpCover.Dispose()

# ==============================================================================
# 6. HERO IMAGE (OPTIONAL): Exact 1440x720 pixels (< 2048 KB)
# ==============================================================================
$bmpHero = New-Object System.Drawing.Bitmap 1440, 720
$gHero = [System.Drawing.Graphics]::FromImage($bmpHero)
Set-HighQuality $gHero
$heroGrad = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Rectangle 0, 0, 1440, 720), (New-Color 5 7 12), (New-Color 10 28 42), 30.0
$gHero.FillRectangle($heroGrad, 0, 0, 1440, 720)

$glowEmerald = New-Object System.Drawing.SolidBrush (New-Color 16 185 129 22)
$glowCyan    = New-Object System.Drawing.SolidBrush (New-Color 6 182 212 24)
$gHero.FillEllipse($glowEmerald, 680, 40, 520, 520)
$gHero.FillEllipse($glowCyan, 960, 140, 460, 460)

for ($hx = 0; $hx -lt 1440; $hx += 60) {
    $gHero.DrawLine($gridPen, $hx, 0, $hx, 720)
}
for ($hy = 0; $hy -lt 720; $hy += 60) {
    $gHero.DrawLine($gridPen, 0, $hy, 1440, $hy)
}

$fHeroBadge = New-Object System.Drawing.Font "Consolas", 11.0, ([System.Drawing.FontStyle]::Bold)
$fHeroTitle = New-Object System.Drawing.Font "Segoe UI", 48, ([System.Drawing.FontStyle]::Bold)
$fHeroLead  = New-Object System.Drawing.Font "Segoe UI", 17, ([System.Drawing.FontStyle]::Regular)
$fHeroFeat  = New-Object System.Drawing.Font "Segoe UI", 13.0, ([System.Drawing.FontStyle]::Bold)

$badgeBrush = New-Object System.Drawing.SolidBrush (New-Color 16 185 129 35)
$badgePen   = New-Object System.Drawing.Pen (New-Color 16 185 129 140), 1.5
Fill-RoundedRect $gHero $badgeBrush 68 74 495 38 19
Draw-RoundedRect $gHero $badgePen 68 74 495 38 19
$gHero.DrawString("GARMIN CONNECT IQ" + $DotSep + "20 WATCH MODELS (v1.2)", $fHeroBadge, $bEmerald, 90, 84, $sfLeft)

$gHero.DrawString("MoatWatch", $fHeroTitle, $bWhite, 64, 126, $sfLeft)
$gHero.DrawString("Multi-Portfolio Stock Tracker, Fear & Greed Index", $fHeroLead, $bSlate, 70, 218, $sfLeft)
$gHero.DrawString("& Cloud WebMemos on Your Garmin Watch", $fHeroLead, $bCyan, 70, 252, $sfLeft)

$heroFeatures = @(
    "NEW: Daily Fear & Greed Index (US Stock S & Crypto C)",
    "Price, % Change, SMA20 Distance & RSI14 Alerts",
    "20-Day Sparkline Chart + Bollinger Bands Overlay",
    "Supports 20 Garmin Watches (Venu, Forerunner, fenix 8, epix)"
)
$featBoxBrush = New-Object System.Drawing.SolidBrush (New-Color 15 23 42 210)
$featBoxPen   = New-Object System.Drawing.Pen (New-Color 56 189 248 70), 1.2
for ($f = 0; $f -lt $heroFeatures.Count; $f++) {
    $fy = 322 + ($f * 64)
    Fill-RoundedRect $gHero $featBoxBrush 68 $fy 556 50 12
    Draw-RoundedRect $gHero $featBoxPen 68 $fy 556 50 12
    $gHero.FillEllipse($bEmerald, 88, $fy + 19, 12, 12)
    $gHero.DrawString($heroFeatures[$f], $fHeroFeat, $bWhite, 112, $fy + 13, $sfLeft)
}

$gHero.DrawString("Companion Web Dashboard: https://moat.readybyte.top", $fHeroBadge, $bCyan, 70, 608, $sfLeft)

# Right Column: Dual High-Res Watch Mockups (Non-overlapping clean placement)
Draw-WatchBezel $gHero 830 335 175
Draw-PortfolioScreenContent $gHero 830 335 175

Draw-WatchBezel $gHero 1225 385 162
Draw-SparklineScreenContent $gHero 1225 385 162

$heroPng = Join-Path $OutDir "hero-banner-1440x720.png"
$heroJpg = Join-Path $OutDir "hero-banner-1440x720.jpg"
$bmpHero.Save($heroPng, [System.Drawing.Imaging.ImageFormat]::Png)
Save-JpgWithMaxKb $bmpHero $heroJpg 1800 94
$gHero.Dispose(); $bmpHero.Dispose()

Get-ChildItem $OutDir | Select-Object Name, @{Name="SizeKB";Expression={[Math]::Round($_.Length / 1KB, 1)}} | Format-Table -AutoSize
