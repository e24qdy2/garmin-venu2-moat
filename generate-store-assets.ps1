Add-Type -AssemblyName System.Drawing

$BaseOutDir = Join-Path $PSScriptRoot "dist\store-assets"
$DateStamp  = Get-Date -Format "yyyy-MM-dd"
$DatedOutDir = Join-Path $BaseOutDir $DateStamp

New-Item -ItemType Directory -Force -Path $BaseOutDir | Out-Null
New-Item -ItemType Directory -Force -Path $DatedOutDir | Out-Null

$DotSep = " " + [char]0x2022 + " "
$BahtSym = [char]0x0E3F
$DownTri = [char]0x25BC

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

function Save-AssetBothDirs([System.Drawing.Bitmap]$bmp, [string]$baseName, [int]$maxKb = 140, [long]$quality = 92) {
    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
    $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, $quality)

    foreach ($dir in @($BaseOutDir, $DatedOutDir)) {
        $pngPath = Join-Path $dir ($baseName + ".png")
        $jpgPath = Join-Path $dir ($baseName + ".jpg")
        $bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Save($jpgPath, $codec, $ep)
    }
    $ep.Dispose()
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

    $fontMicro = New-Object System.Drawing.Font "Consolas", ($r * 0.052), ([System.Drawing.FontStyle]::Bold)
    $fontRow   = New-Object System.Drawing.Font "Segoe UI", ($r * 0.066), ([System.Drawing.FontStyle]::Bold)
    $fontVal   = New-Object System.Drawing.Font "Segoe UI", ($r * 0.100), ([System.Drawing.FontStyle]::Bold)

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

    # Header Clock + Auto-Swipe + Sort Order + FULL Lifetime Mode Flag (Matches MoatWatchLayout.mc)
    $hdrY = $top + $h * 0.048
    $hdrTxt = "09:41" + $DotSep + "A:5s" + $DotSep + "S:" + $DownTri + "%" + $DotSep + "FULL"
    $g.DrawString($hdrTxt, $fontMicro, $bSlate, $cx, $hdrY, $sfCenter)

    # Portfolio Title + Pagination
    $g.DrawString("< US Moat Core 1/2 >", $fontRow, $bCyan, $cx, $top + $h * 0.096, $sfCenter)
    $g.DrawString("`$148,920", $fontVal, $bWhite, $cx, $top + $h * 0.140, $sfCenter)

    # Day P&L + Daily US Fear & Greed Badge (FG:68G) on P&L line (Matches MoatWatchLayout.drawPortfolioPnlAndFearGreed)
    $pnlY = $top + $h * 0.232
    $pnlTxt = "DAY: +`$2,840 (+1.9%)" + $DotSep
    $fgiTxt = "FG:68G"
    $wPnl = $g.MeasureString($pnlTxt, $fontMicro).Width
    $wFgi = $g.MeasureString($fgiTxt, $fontMicro).Width
    $totalPnlW = $wPnl + $wFgi + 6
    $pnlStartX = $cx - ($totalPnlW / 2)

    $g.DrawString($pnlTxt, $fontMicro, $bEmerald, $pnlStartX, $pnlY, $sfLeft)
    Fill-RoundedRect $g $bFgiBg ($pnlStartX + $wPnl - 1) ($pnlY - 1) ($wFgi + 6) ($r * 0.078) 5
    Draw-RoundedRect $g $pFgiPen ($pnlStartX + $wPnl - 1) ($pnlY - 1) ($wFgi + 6) ($r * 0.078) 5
    $g.DrawString($fgiTxt, $fontMicro, $bEmerald, ($pnlStartX + $wPnl + 2), $pnlY, $sfLeft)

    # Divider
    $divPen = New-Object System.Drawing.Pen (New-Color 30 41 59), 1.5
    $g.DrawLine($divPen, $left + $w * 0.14, $top + $h * 0.280, $left + $w * 0.86, $top + $h * 0.280)

    # 4 Responsive Holding Rows (with Quant Grade & S/R indicators)
    $rows = @(
        @{ sym="NVDA"; ed="e-17/11/26"; px="`$138.6"; pct="+3.4%"; pos=$true;  sma="SMA:131(+5.8%)"; rsi="R:64"; loHi="S1:132 R1:142"; dot="EMERALD" },
        @{ sym="TSM";  ed="e-14/01/27"; px="`$194.2"; pct="+4.8%"; pos=$true;  sma="SMA:182(+6.7%)"; rsi="R:71"; loHi="S1:185 R1:198"; dot="EMERALD" },
        @{ sym="AAPL"; ed="e-02/11/26"; px="`$231.4"; pct="+1.2%"; pos=$true;  sma="SMA:226(+2.4%)"; rsi="R:58"; loHi="S1:226 R1:236"; dot="CYAN" },
        @{ sym="MSFT"; ed="e-28/10/26"; px="`$428.5"; pct="-0.5%"; pos=$false; sma="SMA:431(-0.6%)"; rsi="R:46"; loHi="S1:420 R1:438"; dot="NONE" }
    )

    $rowStartY = $top + $h * 0.295
    $rowH = $h * 0.135
    $cardH = $rowH - 4

    for ($i = 0; $i -lt $rows.Count; $i++) {
        $item = $rows[$i]
        $ry = $rowStartY + ($i * $rowH)
        $midY = ($ry + $cardH / 2) - $cy
        $halfChord = [Math]::Sqrt([Math]::Max(10, ($r * $r) - ($midY * $midY)))
        $padX = ($r - $halfChord) + ($w * 0.048)
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

        $subY = $ry + $cardH - ($r * 0.082)
        $g.DrawString($item.sma, $fontMicro, $bSky, $symX, $subY, $sfLeft)
        $rsiBrush = if ($item.rsi -eq "R:71") { $bAmber } else { $bEmerald }
        $g.DrawString($item.rsi, $fontMicro, $rsiBrush, $symX + $smaSize.Width + 3, $subY, $sfLeft)
        $g.DrawString($item.loHi, $fontMicro, $bSlate, $rightX, $subY, $sfRight)
    }

    # Bottom Sync Info & Portfolio Dots
    $g.DrawString("SYNC: 60s" + $DotSep + "FREE FULL LIFETIME", $fontMicro, $bMuted, $cx, $top + $h * 0.855, $sfCenter)
    $g.FillEllipse($bCyan, $cx - 14, $top + $h * 0.925, 8, 8)
    $g.FillEllipse($bMuted, $cx + 2, $top + $h * 0.928, 6, 6)
    $g.FillEllipse($bMuted, $cx + 16, $top + $h * 0.928, 6, 6)
}

function Draw-SparklineScreenContent([System.Drawing.Graphics]$g, [float]$cx, [float]$cy, [float]$r) {
    $sfCenter = New-Object System.Drawing.StringFormat
    $sfCenter.Alignment = [System.Drawing.StringAlignment]::Center

    $fontMicro = New-Object System.Drawing.Font "Consolas", ($r * 0.054), ([System.Drawing.FontStyle]::Bold)
    $fontThai  = New-Object System.Drawing.Font "Tahoma", ($r * 0.058), ([System.Drawing.FontStyle]::Bold)
    $fontRow   = New-Object System.Drawing.Font "Segoe UI", ($r * 0.066), ([System.Drawing.FontStyle]::Bold)
    $fontVal   = New-Object System.Drawing.Font "Segoe UI", ($r * 0.076), ([System.Drawing.FontStyle]::Bold)

    $bWhite   = New-Object System.Drawing.SolidBrush (New-Color 255 255 255)
    $bEmerald = New-Object System.Drawing.SolidBrush (New-Color 16 185 129)
    $bCyan    = New-Object System.Drawing.SolidBrush (New-Color 6 182 212)
    $bAmber   = New-Object System.Drawing.SolidBrush (New-Color 251 191 36)
    $bLight   = New-Object System.Drawing.SolidBrush (New-Color 226 232 240)
    $bSlate   = New-Object System.Drawing.SolidBrush (New-Color 203 213 225)
    $bBox     = New-Object System.Drawing.SolidBrush (New-Color 11 15 23)

    $top = $cy - $r
    $left = $cx - $r
    $w = $r * 2
    $h = $r * 2

    $g.DrawString("< NVDA" + $DotSep + "[A+] MOAT" + $DotSep + "TARGET", $fontVal, $bWhite, $cx, $top + $h * 0.082, $sfCenter)
    $g.DrawString("Now: `$138.60  +4.55 (+3.40%)", $fontRow, $bEmerald, $cx, $top + $h * 0.148, $sfCenter)
    $g.DrawString("S1:`$132 S2:`$126 | R1:`$142 R2:`$150", $fontMicro, $bAmber, $cx, $top + $h * 0.208, $sfCenter)
    $g.DrawString("SMA20: `$131.0 (+5.8%)" + $DotSep + "RSI14: 64" + $DotSep + "BB", $fontMicro, $bCyan, $cx, $top + $h * 0.262, $sfCenter)

    # Sparkline Chart Box
    $chartX = $left + $w * 0.13
    $chartY = $top + $h * 0.325
    $chartW = $w * 0.74
    $chartH = $h * 0.215
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

    # Holdings & Bilingual TH/EN WebMemo with Quant Prefix
    $g.DrawString("Hold: 45.0 @ `$92.5 (+49.8%)", $fontMicro, $bSlate, $cx, $top + $h * 0.575, $sfCenter)
    $g.DrawString("WEBMEMO (TH/EN 18px/22px)" + $DotSep + "1/2", $fontMicro, $bCyan, $cx, $top + $h * 0.642, $sfCenter)
    $g.DrawString("[A+] AI GPU Moat" + $DotSep + "S1:132 R1:142", $fontMicro, $bEmerald, $cx, $top + $h * 0.702, $sfCenter)
    $thLine = [regex]::Unescape("\u0E04\u0E39\u0E40\u0E21\u0E37\u0E2D\u0E07 AI \u0E41\u0E02\u0E47\u0E07\u0E41\u0E01\u0E23\u0E48\u0E07 \u0E2A\u0E30\u0E2A\u0E21\u0E41\u0E19\u0E27\u0E23\u0E31\u0E1A `$132")
    $g.DrawString($thLine, $fontThai, $bWhite, $cx, $top + $h * 0.758, $sfCenter)
}

# ==============================================================================
# 1. SCREEN IMAGE 1: Portfolio Overview + FG:68G + FULL Mode (500x500 < 150 KB)
# ==============================================================================
$bmp1 = New-Object System.Drawing.Bitmap 500, 500
$g1 = [System.Drawing.Graphics]::FromImage($bmp1)
Set-HighQuality $g1
$bgGrad1 = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Rectangle 0, 0, 500, 500), (New-Color 7 11 18), (New-Color 15 23 42), 45.0
$g1.FillRectangle($bgGrad1, 0, 0, 500, 500)
Draw-WatchBezel $g1 250 250 205
Draw-PortfolioScreenContent $g1 250 250 205
Save-AssetBothDirs $bmp1 "screen-1-portfolio-overview" 140 92
$g1.Dispose(); $bmp1.Dispose()

# ==============================================================================
# 2. SCREEN IMAGE 2: Symbol Detail, Sparkline, S/R 1-2-3 & TH/EN WebMemo (500x500)
# ==============================================================================
$bmp2 = New-Object System.Drawing.Bitmap 500, 500
$g2 = [System.Drawing.Graphics]::FromImage($bmp2)
Set-HighQuality $g2
$bgGrad2 = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Rectangle 0, 0, 500, 500), (New-Color 7 11 18), (New-Color 12 25 38), 45.0
$g2.FillRectangle($bgGrad2, 0, 0, 500, 500)
Draw-WatchBezel $g2 250 250 205
Draw-SparklineScreenContent $g2 250 250 205
Save-AssetBothDirs $bmp2 "screen-2-symbol-sparkline" 140 92
$g2.Dispose(); $bmp2.Dispose()

# ==============================================================================
# 3. SCREEN IMAGE 3: Glance Widget + Live Sync & FreeFull Highlights (500x500)
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

$fHead  = New-Object System.Drawing.Font "Segoe UI", 11.5, ([System.Drawing.FontStyle]::Bold)
$fBig   = New-Object System.Drawing.Font "Segoe UI", 20.5, ([System.Drawing.FontStyle]::Bold)
$fSub   = New-Object System.Drawing.Font "Consolas", 9.8, ([System.Drawing.FontStyle]::Bold)
$fSmall = New-Object System.Drawing.Font "Segoe UI", 9.0, ([System.Drawing.FontStyle]::Bold)

$bCyan    = New-Object System.Drawing.SolidBrush (New-Color 6 182 212)
$bWhite   = New-Object System.Drawing.SolidBrush (New-Color 255 255 255)
$bEmerald = New-Object System.Drawing.SolidBrush (New-Color 16 185 129)
$bAmber   = New-Object System.Drawing.SolidBrush (New-Color 251 191 36)
$bRose    = New-Object System.Drawing.SolidBrush (New-Color 244 63 94)
$bSky     = New-Object System.Drawing.SolidBrush (New-Color 56 189 248)
$bSlate   = New-Object System.Drawing.SolidBrush (New-Color 148 163 184)
$bCard    = New-Object System.Drawing.SolidBrush (New-Color 15 23 42)
$pCyan    = New-Object System.Drawing.Pen (New-Color 6 182 212 120), 1.5

$g3.DrawString("QUICK GLANCE WIDGET", $fSub, $bSlate, 250, 76, $sfCenter)

# Glance Card inside Watch Screen (with FG:68G & FULL Lifetime Badge)
Fill-RoundedRect $g3 $bCard 92 108 316 122 16
Draw-RoundedRect $g3 $pCyan 92 108 316 122 16
$g3.DrawString("MOATWATCH" + $DotSep + "FG:68G (GREED)", $fSub, $bCyan, 110, 121, $sfLeft)
$g3.DrawString("THB 1,482,910", $fBig, $bWhite, 110, 145, $sfLeft)
$g3.DrawString("+18,420 (+1.25%)" + $DotSep + "FULL LIFETIME", $fHead, $bEmerald, 110, 192, $sfLeft)

# Feature Pills below Glance
$pills = @(
    "100% Free Full Lifetime (No Key Required)",
    "Live Sync: 60s Ticker & 10m Fear & Greed",
    "2h Sentiment Radar & 04:30 S/R Re-Anchor",
    "Supports 30 Garmin Watches (AMOLED & MIP)"
)
for ($p = 0; $p -lt $pills.Count; $p++) {
    $py = 242 + ($p * 36)
    Fill-RoundedRect $g3 $bCard 98 $py 304 30 9
    $g3.FillEllipse($bEmerald, 110, $py + 11, 7, 7)
    $g3.DrawString($pills[$p], $fSmall, $bWhite, 123, $py + 6, $sfLeft)
}
$g3.DrawString("moat.readybyte.top", $fSub, $bCyan, 250, 396, $sfCenter)

Save-AssetBothDirs $bmp3 "screen-3-glance-widget" 140 92
$g3.Dispose(); $bmp3.Dispose()

# ==============================================================================
# 4. SCREEN IMAGE 4: Live Sync Schedule + Quant S/R + 30 Garmin Models (500x500)
# ==============================================================================
$bmp4 = New-Object System.Drawing.Bitmap 500, 500
$g4 = [System.Drawing.Graphics]::FromImage($bmp4)
Set-HighQuality $g4
$bgGrad4 = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Rectangle 0, 0, 500, 500), (New-Color 6 10 18), (New-Color 14 28 44), 45.0
$g4.FillRectangle($bgGrad4, 0, 0, 500, 500)
Draw-WatchBezel $g4 250 250 205

$fTag   = New-Object System.Drawing.Font "Consolas", 8.8, ([System.Drawing.FontStyle]::Bold)
$fTitle4 = New-Object System.Drawing.Font "Segoe UI", 11.8, ([System.Drawing.FontStyle]::Bold)
$fZone  = New-Object System.Drawing.Font "Consolas", 8.0, ([System.Drawing.FontStyle]::Bold)
$fDesc4 = New-Object System.Drawing.Font "Segoe UI", 8.2, ([System.Drawing.FontStyle]::Bold)

$bBadge4 = New-Object System.Drawing.SolidBrush (New-Color 16 185 129 35)
$pBadge4 = New-Object System.Drawing.Pen (New-Color 16 185 129 150), 1.2
Fill-RoundedRect $g4 $bBadge4 134 68 232 23 11
Draw-RoundedRect $g4 $pBadge4 134 68 232 23 11
$g4.DrawString("v1.0.2 FREE FULL LIFETIME", $fTag, $bEmerald, 250, 73, $sfCenter)

$g4.DrawString("SYNC SCHEDULE & 30 WATCHES", $fTitle4, $bWhite, 250, 98, $sfCenter)

# Dual Sync & Quant Cards (60s/10m Live Sync + Quant [A+] S1-R3)
Fill-RoundedRect $g4 $bCard 90 126 154 64 12
Draw-RoundedRect $g4 $pBadge4 90 126 154 64 12
$g4.DrawString("TICKER & SENTIMENT", $fZone, $bSlate, 167, 133, $sfCenter)
$g4.DrawString("60s / 10m", $fTitle4, $bEmerald, 167, 149, $sfCenter)
$g4.DrawString("Quote 60s | FG 10m", $fZone, $bEmerald, 167, 172, $sfCenter)

$pCyan4 = New-Object System.Drawing.Pen (New-Color 6 182 212 150), 1.2
Fill-RoundedRect $g4 $bCard 256 126 154 64 12
Draw-RoundedRect $g4 $pCyan4 256 126 154 64 12
$g4.DrawString("QUANT & S/R 1-2-3", $fZone, $bSlate, 333, 133, $sfCenter)
$g4.DrawString("[A+] S1-R3", $fTitle4, $bCyan, 333, 149, $sfCenter)
$g4.DrawString("2h Radar | 04:30 S/R", $fZone, $bCyan, 333, 172, $sfCenter)

# 5 Daily Schedule Time Slots Bar inside Watch (UTC+7 ICT)
$slots = @(
    @{ lbl="08/21 Scan"; br=$bEmerald; x=86;  w=64 },
    @{ lbl="20:00 Pre";  br=$bCyan;    x=153; w=63 },
    @{ lbl="1h US Mkt";  br=$bSky;     x=219; w=63 },
    @{ lbl="04:30 S/R";  br=$bAmber;   x=285; w=63 },
    @{ lbl="Sat 10:17";  br=$bEmerald; x=351; w=63 }
)
for ($z = 0; $z -lt $slots.Count; $z++) {
    $zn = $slots[$z]
    Fill-RoundedRect $g4 $bCard $zn.x 198 $zn.w 28 6
    $g4.FillRectangle($zn.br, $zn.x + 4, 201, $zn.w - 8, 3)
    $g4.DrawString($zn.lbl, $fZone, $zn.br, ($zn.x + $zn.w / 2), 209, $sfCenter)
}

# 30 Supported Garmin Watch Models Card
Fill-RoundedRect $g4 $bCard 86 234 328 148 14
Draw-RoundedRect $g4 $pCyan 86 234 328 148 14
$g4.DrawString("30 GARMIN WATCHES SUPPORTED", $fTag, $bCyan, 250, 242, $sfCenter)

$families = @(
    ("Venu 2 / 3 / 4" + $DotSep + "vivoactive 5 / 6"),
    "Forerunner 165 / 265 / 570 / 955 / 965 / 970",
    ("fenix 7 / 8" + $DotSep + "epix Gen 2" + $DotSep + "Enduro 3"),
    ("Instinct 3 AMOLED" + $DotSep + "Approach S70" + $DotSep + "MARQ 2"),
    ("D2 Mach 1 / 2" + $DotSep + "Quatix 7 / 8" + $DotSep + "Tactix 7 / 8")
)
for ($m = 0; $m -lt $families.Count; $m++) {
    $my = 262 + ($m * 22)
    $g4.FillEllipse($bEmerald, 98, $my + 5, 6, 6)
    $g4.DrawString($families[$m], $fDesc4, $bWhite, 110, $my, $sfLeft)
}

$g4.DrawString("AMOLED (390-454px) & Solar MIP (240-280px)", $fZone, $bSky, 250, 392, $sfCenter)

Save-AssetBothDirs $bmp4 "screen-4-whats-new-fgi-models" 140 92
Save-AssetBothDirs $bmp4 "screen-4-sync-schedule-30models" 140 92
$g4.Dispose(); $bmp4.Dispose()

# ==============================================================================
# 5. SCREEN IMAGE 5: Thai & English WebMemo + 4-Axis Quant S/R Page (500x500)
# ==============================================================================
$bmp5 = New-Object System.Drawing.Bitmap 500, 500
$g5 = [System.Drawing.Graphics]::FromImage($bmp5)
Set-HighQuality $g5
$bgGrad5 = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Rectangle 0, 0, 500, 500), (New-Color 6 10 18), (New-Color 15 24 40), 45.0
$g5.FillRectangle($bgGrad5, 0, 0, 500, 500)
Draw-WatchBezel $g5 250 250 205

$fMemoHdr = New-Object System.Drawing.Font "Consolas", 10.0, ([System.Drawing.FontStyle]::Bold)
$fMemoSym = New-Object System.Drawing.Font "Segoe UI", 13.5, ([System.Drawing.FontStyle]::Bold)
$fMemoTag = New-Object System.Drawing.Font "Consolas", 9.2, ([System.Drawing.FontStyle]::Bold)
$fMemoTh  = New-Object System.Drawing.Font "Tahoma", 10.5, ([System.Drawing.FontStyle]::Bold)

$g5.DrawString("09:41" + $DotSep + "WEBMEMO" + $DotSep + "PAGE 1/2", $fMemoHdr, $bSlate, 250, 74, $sfCenter)
$g5.DrawString("NVDA" + $DotSep + "`$138.60 (+3.4%)", $fMemoSym, $bWhite, 250, 98, $sfCenter)

# Quant Grade + Support/Resistance Card
Fill-RoundedRect $g5 $bCard 86 130 328 74 12
Draw-RoundedRect $g5 $pBadge4 86 130 328 74 12
$g5.DrawString("[A+] WIDE MOAT" + $DotSep + "BUY ON DIP", $fMemoTag, $bEmerald, 250, 140, $sfCenter)
$g5.DrawString("Support: S1 `$132.0 | S2 `$126.5 | S3 `$118.0", $fZone, $bCyan, 250, 162, $sfCenter)
$g5.DrawString("Resist : R1 `$142.0 | R2 `$150.0 | R3 `$160.0", $fZone, $bAmber, 250, 180, $sfCenter)

# Bilingual Thai + English WebMemo Card
Fill-RoundedRect $g5 $bCard 86 214 328 158 12
Draw-RoundedRect $g5 $pCyan 86 214 328 158 12
$g5.DrawString("THAI / ENGLISH BITMAP (18px/22px)", $fZone, $bSky, 250, 224, $sfCenter)
$memoLines = @(
    ([regex]::Unescape("\u2022 \u0E04\u0E39\u0E40\u0E21\u0E37\u0E2D\u0E07 AI Data Center \u0E41\u0E02\u0E47\u0E07\u0E41\u0E01\u0E23\u0E48\u0E07 (Moat 5/5)")),
    ([regex]::Unescape("\u2022 \u0E01\u0E23\u0E30\u0E41\u0E2A\u0E40\u0E07\u0E34\u0E19\u0E2A\u0E14\u0E2D\u0E34\u0E2A\u0E23\u0E30\u0E40\u0E15\u0E34\u0E1A\u0E42\u0E15\u0E40\u0E14\u0E48\u0E19 \u0E23\u0E31\u0E01\u0E29\u0E32\u0E21\u0E32\u0E23\u0E4C\u0E08\u0E34\u0E49\u0E19\u0E2A\u0E39\u0E07")),
    ([regex]::Unescape("\u2022 \u0E41\u0E1C\u0E19\u0E40\u0E17\u0E23\u0E14: \u0E17\u0E22\u0E2D\u0E22\u0E2A\u0E30\u0E2A\u0E21\u0E43\u0E01\u0E25\u0E49\u0E41\u0E19\u0E27\u0E23\u0E31\u0E1A S1 (`$132)")),
    ([regex]::Unescape("\u2022 \u0E40\u0E1B\u0E49\u0E32\u0E2B\u0E21\u0E32\u0E22\u0E17\u0E33\u0E01\u0E33\u0E44\u0E23\u0E23\u0E30\u0E22\u0E30\u0E01\u0E25\u0E32\u0E07 R2-R3 (`$150-`$160)")),
    ([regex]::Unescape("\u2022 Synced via https://moat.readybyte.top"))
)
for ($ml = 0; $ml -lt $memoLines.Count; $ml++) {
    $ly = 246 + ($ml * 23)
    $brLine = if ($ml -eq 4) { $bCyan } else { $bWhite }
    $g5.DrawString($memoLines[$ml], $fMemoTh, $brLine, 100, $ly, $sfLeft)
}
$g5.DrawString("Updated: 08:00 / 21:00 & 04:30 ICT", $fZone, $bSlate, 250, 388, $sfCenter)

Save-AssetBothDirs $bmp5 "screen-5-thai-webmemo-quant-sr" 140 92
$g5.Dispose(); $bmp5.Dispose()

# ==============================================================================
# 6. COVER IMAGE & ICON: 500x500 (< 300 KB)
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
$fCoverSub   = New-Object System.Drawing.Font "Segoe UI", 9.0, ([System.Drawing.FontStyle]::Bold)
$gCover.DrawString("MoatWatch", $fCoverTitle, $bWhite, 250, 14, $sfCenter)
$gCover.DrawString("FREE FULL LIFETIME" + $DotSep + "FG:68G" + $DotSep + "S/R 1-2-3" + $DotSep + "TH/EN", $fCoverSub, $bCyan, 250, 62, $sfCenter)

Draw-WatchBezel $gCover 250 288 170
Draw-PortfolioScreenContent $gCover 250 288 170

Save-AssetBothDirs $bmpCover "cover-image-500x500" 280 94
$gCover.Dispose(); $bmpCover.Dispose()

# ==============================================================================
# 7. HERO IMAGE: Exact 1440x720 pixels (< 2048 KB)
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

$fHeroBadge = New-Object System.Drawing.Font "Consolas", 10.5, ([System.Drawing.FontStyle]::Bold)
$fHeroTitle = New-Object System.Drawing.Font "Segoe UI", 48, ([System.Drawing.FontStyle]::Bold)
$fHeroLead  = New-Object System.Drawing.Font "Segoe UI", 16.5, ([System.Drawing.FontStyle]::Regular)
$fHeroFeat  = New-Object System.Drawing.Font "Segoe UI", 12.5, ([System.Drawing.FontStyle]::Bold)

$badgeBrush = New-Object System.Drawing.SolidBrush (New-Color 16 185 129 35)
$badgePen   = New-Object System.Drawing.Pen (New-Color 16 185 129 140), 1.5
Fill-RoundedRect $gHero $badgeBrush 68 72 548 38 19
Draw-RoundedRect $gHero $badgePen 68 72 548 38 19
$gHero.DrawString("GARMIN CONNECT IQ" + $DotSep + "30 WATCHES" + $DotSep + "FREE FULL LIFETIME", $fHeroBadge, $bEmerald, 88, 82, $sfLeft)

$gHero.DrawString("MoatWatch", $fHeroTitle, $bWhite, 64, 124, $sfLeft)
$gHero.DrawString("Live Portfolio Tracker, 4-Axis Quant Grades, S/R 1-2-3", $fHeroLead, $bSlate, 70, 216, $sfLeft)
$gHero.DrawString("& Bilingual (TH/EN) WebMemos on Your Garmin Watch", $fHeroLead, $bCyan, 70, 250, $sfLeft)

$heroFeatures = @(
    "100% Free Full Lifetime Unlocked (No Activation Key Required)",
    "Live Sync: 60s Ticker Quotes & 10m US Fear & Greed (FG:0-100)",
    "4-Axis Quant Grades ([A+]) + Support/Resistance (S1-S3 / R1-R3)",
    "Supports 30 Garmin Models (Venu, Forerunner, fenix 7/8, epix, MARQ)"
)
$featBoxBrush = New-Object System.Drawing.SolidBrush (New-Color 15 23 42 210)
$featBoxPen   = New-Object System.Drawing.Pen (New-Color 56 189 248 70), 1.2
for ($f = 0; $f -lt $heroFeatures.Count; $f++) {
    $fy = 320 + ($f * 64)
    Fill-RoundedRect $gHero $featBoxBrush 68 $fy 566 50 12
    Draw-RoundedRect $gHero $featBoxPen 68 $fy 566 50 12
    $gHero.FillEllipse($bEmerald, 88, $fy + 19, 12, 12)
    $gHero.DrawString($heroFeatures[$f], $fHeroFeat, $bWhite, 112, $fy + 13, $sfLeft)
}

$gHero.DrawString("Companion Web Dashboard: https://moat.readybyte.top", $fHeroBadge, $bCyan, 70, 608, $sfLeft)

# Right Column: Dual High-Res Watch Mockups
Draw-WatchBezel $gHero 830 335 175
Draw-PortfolioScreenContent $gHero 830 335 175

Draw-WatchBezel $gHero 1225 385 162
Draw-SparklineScreenContent $gHero 1225 385 162

Save-AssetBothDirs $bmpHero "hero-banner-1440x720" 1800 94
$gHero.Dispose(); $bmpHero.Dispose()

# Also generate/copy the 128x128 device icons into both BaseOutDir and DatedOutDir
& (Join-Path $PSScriptRoot "generate-device-store-icons.ps1")
Get-ChildItem -Path $BaseOutDir -Filter "icon-128x128-*.png" | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination (Join-Path $DatedOutDir $_.Name) -Force
}

Write-Host "`n=== Generated Store Assets in $DatedOutDir ===" -ForegroundColor Cyan
Get-ChildItem $DatedOutDir | Select-Object Name, @{Name="SizeKB";Expression={[Math]::Round($_.Length / 1KB, 1)}}, LastWriteTime | Format-Table -AutoSize
