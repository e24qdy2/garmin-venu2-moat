param(
    [string]$OutDir = "$PSScriptRoot\..\garmin-venu2-app\resources\fonts",
    [string]$PreviewOut = "C:\Users\saharabu\.gemini\antigravity-cli\brain\83e22c8d-edfe-40f4-9d8a-16a5fd99cbfa\scratch\verify_thai_watch_font.png"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# Character sets to bake into every Garmin watch bitmap font
$asciiCodes = 32..126
$symbolCodes = @(183, 8211, 8212, 8216, 8217, 8220, 8221, 8226, 8230, 8594, 9650, 9660)
$thaiCodes = (3585..3642) + (3647..3675)
$allCodes = ($asciiCodes + $symbolCodes + $thaiCodes) | Sort-Object -Unique

# Classify Thai combining marks
$upperVowels = @(0x0E31, 0x0E34, 0x0E35, 0x0E36, 0x0E37, 0x0E47, 0x0E4D, 0x0E4E)
$toneMarks   = @(0x0E48, 0x0E49, 0x0E4A, 0x0E4B, 0x0E4C)
$lowerVowels = @(0x0E38, 0x0E39, 0x0E3A)
$saraAm      = 0x0E33

function Get-InkBounds {
    param([System.Drawing.Bitmap]$Bmp, [int]$Threshold = 15)
    $w = $Bmp.Width
    $h = $Bmp.Height
    $minX = $w; $maxX = -1; $minY = $h; $maxY = -1
    for ($y = 0; $y -lt $h; $y++) {
        for ($x = 0; $x -lt $w; $x++) {
            $r = $Bmp.GetPixel($x, $y).R
            if ($r -gt $Threshold) {
                if ($x -lt $minX) { $minX = $x }
                if ($x -gt $maxX) { $maxX = $x }
                if ($y -lt $minY) { $minY = $y }
                if ($y -gt $maxY) { $maxY = $y }
            }
        }
    }
    return @{
        Empty = ($maxX -lt $minX)
        MinX  = $minX
        MaxX  = $maxX
        MinY  = $minY
        MaxY  = $maxY
    }
}

function Build-BMFont {
    param(
        [string]$FontId,
        [int]$PixelSize,
        [int]$LineHeight,
        [int]$BaseLine,
        [int]$EnDrawY,
        [int]$ThDrawY,
        [int]$ToneShiftUp,
        [int]$AtlasW = 256,
        [int]$AtlasH = 256
    )

    Write-Host "[*] Generating $FontId (${PixelSize}px, lineHeight=$LineHeight, atlas=${AtlasW}x${AtlasH})..." -ForegroundColor Cyan

    $fEn = New-Object System.Drawing.Font("Segoe UI", $PixelSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    $fTh = New-Object System.Drawing.Font("Tahoma", $PixelSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)

    # Measure Thai base consonant U+0E2D at (16, $ThDrawY) for combining mark reference
    $refBmp = New-Object System.Drawing.Bitmap(64, 64, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $refG = [System.Drawing.Graphics]::FromImage($refBmp)
    $refG.Clear([System.Drawing.Color]::FromArgb(255, 0, 0, 0))
    $refG.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $refG.DrawString([string][char]0x0E2D, $fTh, [System.Drawing.Brushes]::White, 16, $ThDrawY)
    $baseBounds = Get-InkBounds -Bmp $refBmp -Threshold 15
    $refG.Dispose()
    $refBmp.Dispose()

    $baseMinX = $baseBounds.MinX
    $baseMaxX = $baseBounds.MaxX
    $baseMinY = $baseBounds.MinY
    $baseMaxY = $baseBounds.MaxY

    $atlas = New-Object System.Drawing.Bitmap($AtlasW, $AtlasH, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $atlasG = [System.Drawing.Graphics]::FromImage($atlas)
    $atlasG.Clear([System.Drawing.Color]::FromArgb(255, 0, 0, 0))

    $curX = 2
    $curY = 2
    $charEntries = New-Object System.Collections.Generic.List[hashtable]

    foreach ($code in $allCodes) {
        $cellBmp = New-Object System.Drawing.Bitmap(64, 64, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $cellG = [System.Drawing.Graphics]::FromImage($cellBmp)
        $cellG.Clear([System.Drawing.Color]::FromArgb(255, 0, 0, 0))
        $cellG.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

        $isThai = ($code -ge 3585 -and $code -le 3675 -and $code -ne 3647)
        $xoffset = 0
        $yoffset = 0
        $xadvance = 0
        $glyphW = 0

        if ($code -eq 32) {
            # Space character
            $glyphW = [Math]::Max(4, [int][Math]::Round($PixelSize * 0.35))
            $xoffset = 0
            $xadvance = $glyphW - 1
        }
        elseif ($upperVowels -contains $code) {
            # Draw U+0E2D + upper vowel and erase Y >= baseMinY
            $cellG.DrawString(([string][char]0x0E2D + [string][char]$code), $fTh, [System.Drawing.Brushes]::White, 16, $ThDrawY)
            for ($y = $baseMinY; $y -lt 64; $y++) {
                for ($x = 0; $x -lt 64; $x++) {
                    $cellBmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(255, 0, 0, 0))
                }
            }
            $b = Get-InkBounds -Bmp $cellBmp -Threshold 12
            if ($b.Empty) {
                $glyphW = 4; $xoffset = 0; $xadvance = 4
            } else {
                $glyphW = ($b.MaxX - $b.MinX + 1)
                # Shift pixels horizontally so they start at X=0 in cellBmp
                $shifted = New-Object System.Drawing.Bitmap(64, 64, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
                $sg = [System.Drawing.Graphics]::FromImage($shifted)
                $sg.Clear([System.Drawing.Color]::FromArgb(255, 0, 0, 0))
                for ($y = 0; $y -lt $LineHeight; $y++) {
                    for ($x = $b.MinX; $x -le $b.MaxX; $x++) {
                        $p = $cellBmp.GetPixel($x, $y)
                        $shifted.SetPixel($x - $b.MinX, $y, $p)
                    }
                }
                $sg.Dispose()
                $cellG.Dispose(); $cellBmp.Dispose()
                $cellBmp = $shifted
                $xoffset = 0
                $xadvance = [Math]::Max(2, $glyphW)
            }
        }
        elseif ($toneMarks -contains $code) {
            # Draw U+0E2D + tone mark, erase Y >= baseMinY
            $cellG.DrawString(([string][char]0x0E2D + [string][char]$code), $fTh, [System.Drawing.Brushes]::White, 16, $ThDrawY)
            for ($y = $baseMinY; $y -lt 64; $y++) {
                for ($x = 0; $x -lt 64; $x++) {
                    $cellBmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(255, 0, 0, 0))
                }
            }
            $b = Get-InkBounds -Bmp $cellBmp -Threshold 12
            if ($b.Empty) {
                $glyphW = 4; $xoffset = 0; $xadvance = 4
            } else {
                $glyphW = ($b.MaxX - $b.MinX + 1)
                $shifted = New-Object System.Drawing.Bitmap(64, 64, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
                $sg = [System.Drawing.Graphics]::FromImage($shifted)
                $sg.Clear([System.Drawing.Color]::FromArgb(255, 0, 0, 0))
                for ($y = $b.MinY; $y -le $b.MaxY; $y++) {
                    if ($y -lt $LineHeight) {
                        for ($x = $b.MinX; $x -le $b.MaxX; $x++) {
                            $p = $cellBmp.GetPixel($x, $y)
                            $shifted.SetPixel($x - $b.MinX, $y, $p)
                        }
                    }
                }
                $sg.Dispose()
                $cellG.Dispose(); $cellBmp.Dispose()
                $cellBmp = $shifted
                $xoffset = 0
                $xadvance = [Math]::Max(2, $glyphW)
            }
        }
        elseif ($lowerVowels -contains $code) {
            # Draw U+0E2D + lower vowel, erase Y <= baseMaxY
            $cellG.DrawString(([string][char]0x0E2D + [string][char]$code), $fTh, [System.Drawing.Brushes]::White, 16, $ThDrawY)
            for ($y = 0; $y -le $baseMaxY; $y++) {
                for ($x = 0; $x -lt 64; $x++) {
                    $cellBmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(255, 0, 0, 0))
                }
            }
            $b = Get-InkBounds -Bmp $cellBmp -Threshold 12
            if ($b.Empty) {
                $glyphW = 4; $xoffset = 0; $xadvance = 4
            } else {
                $glyphW = ($b.MaxX - $b.MinX + 1)
                $shifted = New-Object System.Drawing.Bitmap(64, 64, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
                $sg = [System.Drawing.Graphics]::FromImage($shifted)
                $sg.Clear([System.Drawing.Color]::FromArgb(255, 0, 0, 0))
                for ($y = $b.MinY; $y -le $b.MaxY; $y++) {
                    $destY = [Math]::Min($LineHeight - 1, $y)
                    for ($x = $b.MinX; $x -le $b.MaxX; $x++) {
                        $p = $cellBmp.GetPixel($x, $y)
                        $shifted.SetPixel($x - $b.MinX, $destY, $p)
                    }
                }
                $sg.Dispose()
                $cellG.Dispose(); $cellBmp.Dispose()
                $cellBmp = $shifted
                $xoffset = 0
                $xadvance = [Math]::Max(2, $glyphW)
            }
        }
        elseif ($code -eq $saraAm) {
            # Draw U+0E2D + U+0E33 and erase the U+0E2D region (X <= baseMaxX and Y >= baseMinY)
            $cellG.DrawString(([string][char]0x0E2D + [string][char]$code), $fTh, [System.Drawing.Brushes]::White, 16, $ThDrawY)
            for ($y = $baseMinY; $y -lt 64; $y++) {
                for ($x = 0; $x -le $baseMaxX; $x++) {
                    $cellBmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(255, 0, 0, 0))
                }
            }
            $b = Get-InkBounds -Bmp $cellBmp -Threshold 12
            $glyphW = ($b.MaxX - $b.MinX + 1) + 1
            $shifted = New-Object System.Drawing.Bitmap(64, 64, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
            $sg = [System.Drawing.Graphics]::FromImage($shifted)
            $sg.Clear([System.Drawing.Color]::FromArgb(255, 0, 0, 0))
            for ($y = 0; $y -lt $LineHeight; $y++) {
                for ($x = $b.MinX; $x -le $b.MaxX; $x++) {
                    $p = $cellBmp.GetPixel($x, $y)
                    $shifted.SetPixel($x - $b.MinX, $y, $p)
                }
            }
            $sg.Dispose()
            $cellG.Dispose(); $cellBmp.Dispose()
            $cellBmp = $shifted
            $xoffset = 0
            $xadvance = [Math]::Max(2, $glyphW - 1)
        }
        else {
            # Standard base character (ASCII, Symbol, or Thai base consonant/vowel/digit)
            $useFont = if ($isThai) { $fTh } else { $fEn }
            $drawY = if ($isThai) { $ThDrawY } else { $EnDrawY }
            $cellG.DrawString([string][char]$code, $useFont, [System.Drawing.Brushes]::White, 8, $drawY)
            $b = Get-InkBounds -Bmp $cellBmp -Threshold 12
            if ($b.Empty) {
                $glyphW = [Math]::Max(4, [int][Math]::Round($PixelSize * 0.35))
                $xoffset = 0
                $xadvance = $glyphW - 1
            } else {
                # Keep 1px left/right breathing room inside glyph cell like original moat_micro.fnt
                $cropMinX = [Math]::Max(0, $b.MinX - 1)
                $cropMaxX = [Math]::Min(63, $b.MaxX + 1)
                $glyphW = ($cropMaxX - $cropMinX + 1)
                $shifted = New-Object System.Drawing.Bitmap(64, 64, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
                $sg = [System.Drawing.Graphics]::FromImage($shifted)
                $sg.Clear([System.Drawing.Color]::FromArgb(255, 0, 0, 0))
                for ($y = 0; $y -lt $LineHeight; $y++) {
                    for ($x = $cropMinX; $x -le $cropMaxX; $x++) {
                        $p = $cellBmp.GetPixel($x, $y)
                        $shifted.SetPixel($x - $cropMinX, $y, $p)
                    }
                }
                $sg.Dispose()
                $cellG.Dispose(); $cellBmp.Dispose()
                $cellBmp = $shifted
                $xoffset = 0
                $xadvance = [Math]::Max(1, $glyphW - 1)
            }
        }

        # Pack into atlas
        if (($curX + $glyphW + 2) -gt $AtlasW) {
            $curX = 2
            $curY += ($LineHeight + 2)
        }
        if (($curY + $LineHeight + 2) -gt $AtlasH) {
            throw "Atlas overflow for $FontId at char $code (curY=$curY, LineHeight=$LineHeight, AtlasH=$AtlasH)"
        }

        for ($y = 0; $y -lt $LineHeight; $y++) {
            for ($x = 0; $x -lt $glyphW; $x++) {
                $p = $cellBmp.GetPixel($x, $y)
                # Ensure strict grayscale RGB with A=255
                $lum = [int]$p.R
                $atlas.SetPixel($curX + $x, $curY + $y, [System.Drawing.Color]::FromArgb(255, $lum, $lum, $lum))
            }
        }

        $charEntries.Add(@{
            id       = $code
            x        = $curX
            y        = $curY
            width    = $glyphW
            height   = $LineHeight
            xoffset  = $xoffset
            yoffset  = $yoffset
            xadvance = $xadvance
        })

        $curX += ($glyphW + 2)
        $cellBmp.Dispose()
    }

    $pngFile = "${FontId}_0.png"
    $pngPath = Join-Path $OutDir $pngFile
    $fntPath = Join-Path $OutDir "${FontId}.fnt"

    $atlasG.Dispose()
    $atlas.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add("info face=`"Segoe UI`" size=-$PixelSize bold=0 italic=0 charset=`"`" unicode=1 stretchH=100 smooth=1 aa=1 padding=0,0,0,0 spacing=1,1 outline=0")
    $lines.Add("common lineHeight=$LineHeight base=$BaseLine scaleW=$AtlasW scaleH=$AtlasH pages=1 packed=0 alphaChnl=1 redChnl=0 greenChnl=0 blueChnl=0")
    $lines.Add("page id=0 file=`"$pngFile`"")
    $lines.Add("chars count=$($charEntries.Count)")
    foreach ($c in $charEntries) {
        $line = ("char id={0,-5} x={1,-5} y={2,-5} width={3,-5} height={4,-5} xoffset={5,-5} yoffset={6,-5} xadvance={7,-5} page=0  chnl=15" -f `
            $c.id, $c.x, $c.y, $c.width, $c.height, $c.xoffset, $c.yoffset, $c.xadvance)
        $lines.Add($line)
    }
    $lines.Add("kernings count=0")
    [System.IO.File]::WriteAllLines($fntPath, $lines, (New-Object System.Text.UTF8Encoding($false)))

    $fEn.Dispose()
    $fTh.Dispose()

    Write-Host "[OK] Saved $fntPath and $pngPath ($($charEntries.Count) glyphs, maxY=$($curY + $LineHeight))" -ForegroundColor Green
    return @{
        Atlas   = $atlas
        Entries = $charEntries
        LineH   = $LineHeight
    }
}

# Build all 4 watch fonts:
# 1. moat_memo_xs (11px, Tier-2 auto-fit multi-line WebMemo font)
$fontMemoXs = Build-BMFont -FontId "moat_memo_xs" -PixelSize 11 -LineHeight 16 -BaseLine 13 -EnDrawY 1 -ThDrawY 2 -ToneShiftUp 2 -AtlasW 256 -AtlasH 256

# 2. moat_micro (14px, Tier-1 WebMemo & detail metadata font)
$fontMicro  = Build-BMFont -FontId "moat_micro"   -PixelSize 14 -LineHeight 19 -BaseLine 16 -EnDrawY 1 -ThDrawY 2 -ToneShiftUp 2 -AtlasW 256 -AtlasH 256

# 3. moat_row (17px, row title & current price font)
$fontRow    = Build-BMFont -FontId "moat_row"     -PixelSize 17 -LineHeight 23 -BaseLine 19 -EnDrawY 1 -ThDrawY 2 -ToneShiftUp 2 -AtlasW 512 -AtlasH 256

# 4. moat_val (22px, portfolio value & header ticker font)
$fontVal    = Build-BMFont -FontId "moat_val"     -PixelSize 22 -LineHeight 29 -BaseLine 25 -EnDrawY 1 -ThDrawY 3 -ToneShiftUp 3 -AtlasW 512 -AtlasH 256

# Simulate Garmin's exact BMFont dc.drawText blitter on a 416x220 preview canvas
if ($PreviewOut) {
    $prev = New-Object System.Drawing.Bitmap(416, 220, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $pg = [System.Drawing.Graphics]::FromImage($prev)
    $pg.Clear([System.Drawing.Color]::FromArgb(255, 5, 10, 20))
    $pg.Dispose()

    function Draw-SimulatedBMText {
        param($TargetBmp, $FontObj, [string]$Text, [int]$CenterX, [int]$TopY, [System.Drawing.Color]$Color)
        $map = @{}
        foreach ($e in $FontObj.Entries) { $map[[int]$e.id] = $e }
        $totalW = 0
        foreach ($ch in $Text.ToCharArray()) {
            $code = [int]$ch
            if ($map.ContainsKey($code)) { $totalW += $map[$code].xadvance }
        }
        $cx = [int]($CenterX - ($totalW / 2))
        foreach ($ch in $Text.ToCharArray()) {
            $code = [int]$ch
            if (-not $map.ContainsKey($code)) { continue }
            $g = $map[$code]
            for ($gy = 0; $gy -lt $g.height; $gy++) {
                for ($gx = 0; $gx -lt $g.width; $gx++) {
                    $lum = $FontObj.Atlas.GetPixel($g.x + $gx, $g.y + $gy).R
                    if ($lum -gt 10) {
                        $dx = $cx + $g.xoffset + $gx
                        $dy = $TopY + $g.yoffset + $gy
                        if ($dx -ge 0 -and $dx -lt $TargetBmp.Width -and $dy -ge 0 -and $dy -lt $TargetBmp.Height) {
                            $existing = $TargetBmp.GetPixel($dx, $dy)
                            $alpha = $lum / 255.0
                            $nr = [Math]::Min(255, [int]($existing.R * (1.0 - $alpha) + $Color.R * $alpha))
                            $ng = [Math]::Min(255, [int]($existing.G * (1.0 - $alpha) + $Color.G * $alpha))
                            $nb = [Math]::Min(255, [int]($existing.B * (1.0 - $alpha) + $Color.B * $alpha))
                            $TargetBmp.SetPixel($dx, $dy, [System.Drawing.Color]::FromArgb(255, $nr, $ng, $nb))
                        }
                    }
                }
            }
            $cx += $g.xadvance
        }
    }

    $s1 = "TMDX " + [char]0x0E07 + [char]0x0E1A + " Q3 " + [char]0x0E42 + [char]0x0E15 + [char]0x0E41 + [char]0x0E23 + [char]0x0E07 + " 5 " + [char]0x0E1E + "." + [char]0x0E22 + ". " + [char]0x0E23 + [char]0x0E2D + [char]0x0E2A + [char]0x0E30 + [char]0x0E2A + [char]0x0E21 + [char]0x0E41 + [char]0x0E19 + [char]0x0E27 + [char]0x0E23 + [char]0x0E31 + [char]0x0E1A
    $s2 = $s1 + " `$85.0"
    $s3 = "" + [char]0x0E41 + [char]0x0E19 + [char]0x0E27 + [char]0x0E15 + [char]0x0E49 + [char]0x0E32 + [char]0x0E19 + " `$98.5 " + [char]0x00B7 + " " + [char]0x0E15 + [char]0x0E31 + [char]0x0E49 + [char]0x0E07 + [char]0x0E40 + [char]0x0E1B + [char]0x0E49 + [char]0x0E32 + [char]0x0E16 + [char]0x0E37 + [char]0x0E2D + [char]0x0E22 + [char]0x0E32 + [char]0x0E27 + " " + [char]0x0E01 + [char]0x0E33 + [char]0x0E44 + [char]0x0E23 + " +24% " + [char]0x25B2
    $s4 = "" + [char]0x0E1B + [char]0x0E39 + [char]0x0E48 + [char]0x0E42 + [char]0x0E2A + [char]0x0E21 + " " + [char]0x00B7 + " " + [char]0x0E0B + [char]0x0E37 + [char]0x0E49 + [char]0x0E2D + [char]0x0E2B + [char]0x0E38 + [char]0x0E49 + [char]0x0E19 + [char]0x0E1E + [char]0x0E37 + [char]0x0E49 + [char]0x0E19 + [char]0x0E10 + [char]0x0E32 + [char]0x0E19 + [char]0x0E14 + [char]0x0E35 + " MoatWatch"

    Draw-SimulatedBMText -TargetBmp $prev -FontObj $fontMicro  -Text "WEBMEMO (14px FontMicro)" -CenterX 208 -TopY 12 -Color ([System.Drawing.Color]::FromArgb(255, 6, 182, 212))
    Draw-SimulatedBMText -TargetBmp $prev -FontObj $fontMicro  -Text $s1 -CenterX 208 -TopY 36 -Color ([System.Drawing.Color]::White)
    Draw-SimulatedBMText -TargetBmp $prev -FontObj $fontMemoXs -Text "WEBMEMO AUTO-FIT (11px FontMemoXS - 3 Lines)" -CenterX 208 -TopY 82 -Color ([System.Drawing.Color]::FromArgb(255, 6, 182, 212))
    Draw-SimulatedBMText -TargetBmp $prev -FontObj $fontMemoXs -Text $s2 -CenterX 208 -TopY 104 -Color ([System.Drawing.Color]::White)
    Draw-SimulatedBMText -TargetBmp $prev -FontObj $fontMemoXs -Text $s3 -CenterX 208 -TopY 122 -Color ([System.Drawing.Color]::White)
    Draw-SimulatedBMText -TargetBmp $prev -FontObj $fontMemoXs -Text $s4 -CenterX 208 -TopY 140 -Color ([System.Drawing.Color]::FromArgb(255, 148, 163, 184))

    $prev.Save($PreviewOut, [System.Drawing.Imaging.ImageFormat]::Png)
    $prev.Dispose()
    Write-Host "[OK] Saved simulated watch rendering preview to $PreviewOut" -ForegroundColor Cyan
}

$fontMemoXs.Atlas.Dispose()
$fontMicro.Atlas.Dispose()
$fontRow.Atlas.Dispose()
$fontVal.Atlas.Dispose()
