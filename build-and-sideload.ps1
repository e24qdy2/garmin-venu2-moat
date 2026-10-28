param(
    [string]$SyncKey = "",
    [string]$ApiUrl = "https://moat.readybyte.top",
    [Alias("DeviceId")][string]$Device = "venu2",
    [string]$KeyPath = "$PSScriptRoot\keys\developer_key.der",
    [switch]$PackageStoreIq,
    [switch]$SkipGitSync
)

$ErrorActionPreference = "Stop"
Write-Host "`n==================================================================" -ForegroundColor Cyan
Write-Host "  GarminMoat - Garmin 2024-2026 Multi-Device Build & USB Sideloader" -ForegroundColor Cyan
Write-Host "==================================================================`n" -ForegroundColor Cyan

$AppDir = Join-Path $PSScriptRoot "garmin-venu2-app"
$DistDir = Join-Path $PSScriptRoot "dist"
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

# 0. Auto-provision all 20 Garmin 2024-2026 Connect IQ Device Profiles
try {
    & node -e "const g = require('./lib/garminDevices'); const r = g.provisionConnectIqDevices(); console.log('[OK] Connect IQ Device Profiles Ready (' + g.COMPATIBLE_GARMIN_DEVICES.length + ' models, ' + r.provisioned + ' newly provisioned)');"
} catch {
    Write-Warning "Connect IQ device profile provision check warning: $_"
}

# 1. Update default properties if SyncKey or ApiUrl provided
$PropsFile = Join-Path $AppDir "resources\settings\properties.xml"
if (Test-Path $PropsFile) {
    [xml]$xml = Get-Content $PropsFile
    foreach ($prop in $xml.properties.property) {
        if ($prop.id -eq "syncKey") {
            if ($SyncKey -and $SyncKey -ne "AUTO") {
                $propInnerText = $SyncKey.ToUpper()
                $prop.InnerText = $propInnerText
                Write-Host "[OK] Embedded Default Sync Key : $propInnerText" -ForegroundColor Green
            } else {
                $prop.InnerText = ""
                Write-Host "[OK] Embedded Default Sync Key : AUTO (Per-Device Unique Hardware ID)" -ForegroundColor Green
            }
        }
        if ($prop.id -eq "apiUrl" -and $ApiUrl) {
            $prop.InnerText = $ApiUrl.TrimEnd('/')
            Write-Host "[OK] Embedded HTTPS Server URL : $($prop.InnerText)" -ForegroundColor Green
        }
    }
    $xml.Save($PropsFile)
}

# 2. Locate Portable JRE & Connect IQ SDK monkeybrains.jar
$JavaExe = Join-Path $PSScriptRoot "bin\jre\bin\java.exe"
if (-not (Test-Path $JavaExe)) {
    $CmdJava = Get-Command "java" -ErrorAction SilentlyContinue
    if ($CmdJava) { $JavaExe = $CmdJava.Source }
}
if (-not (Test-Path $JavaExe)) {
    $TempJava = Get-ChildItem -Path (Join-Path $env:TEMP "jre_extract") -Recurse -Filter "java.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($TempJava) { $JavaExe = $TempJava.FullName }
}

$CiqBase = Join-Path $env:APPDATA "Garmin\ConnectIQ\Sdks"
$MonkeyJar = $null
if (Test-Path $CiqBase) {
    $LatestSdk = Get-ChildItem -Path $CiqBase -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($LatestSdk) {
        $Candidate = Join-Path $LatestSdk.FullName "bin\monkeybrains.jar"
        if (Test-Path $Candidate) { $MonkeyJar = $Candidate }
    }
}

if (-not $MonkeyJar -or -not (Test-Path $JavaExe)) {
    throw "Garmin Connect IQ SDK (monkeybrains.jar) or Java runtime was not found."
}

# 3. Compile GarminMoat.prg (and keep Venu2Moat.prg in sync for backward compatibility)
$OutputPrg = Join-Path $DistDir "GarminMoat.prg"
$LegacyPrg = Join-Path $DistDir "Venu2Moat.prg"
$JungleFile = Join-Path $AppDir "monkey.jungle"
Write-Host "[*] Compiling GarminMoat.prg for device '$Device'..." -ForegroundColor Cyan
& $JavaExe "-Xms1g" "-Dfile.encoding=UTF-8" -jar $MonkeyJar -o $OutputPrg -f $JungleFile -y $KeyPath -d $Device -w

if (Test-Path $OutputPrg) {
    Copy-Item -Path $OutputPrg -Destination $LegacyPrg -Force
    if (Test-Path "$OutputPrg.debug.xml") {
        Copy-Item -Path "$OutputPrg.debug.xml" -Destination "$LegacyPrg.debug.xml" -Force
    }
    $SizeKb = [Math]::Round((Get-Item $OutputPrg).Length / 1KB, 1)
    Write-Host "[OK] Built binary: $OutputPrg ($SizeKb KB)" -ForegroundColor Green
}

if ($PackageStoreIq) {
    $OutputIq = Join-Path $DistDir "GarminMoat.iq"
    Write-Host "[*] Packaging Garmin Connect IQ Store bundle: $OutputIq (20 Garmin models)..." -ForegroundColor Cyan
    & $JavaExe "-Xms1g" "-Dfile.encoding=UTF-8" -jar $MonkeyJar -e -r -o $OutputIq -f $JungleFile -y $KeyPath -w
    if (Test-Path $OutputIq) {
        $IqSizeKb = [Math]::Round((Get-Item $OutputIq).Length / 1KB, 1)
        Write-Host "[OK] Built Connect IQ Store Package: $OutputIq ($IqSizeKb KB)" -ForegroundColor Green
    }
}

# 4. Auto-detect MTP-connected Garmin Watch via Windows Shell.Application (with 8s non-blocking timeout)
$Sideloaded = $false
try {
    $mtpJob = Start-Job -ScriptBlock {
        param($PrgPath, $LegacyPrgPath)
        $shell = New-Object -ComObject Shell.Application
        $venu = $shell.NameSpace(17).Items() | Where-Object {
            $_.Name -match "Venu|Forerunner|fenix|epix|vivoactive|Enduro|Approach|Garmin"
        } | Select-Object -First 1
        if ($venu) {
            $internal = $venu.GetFolder.Items() | Where-Object { $_.Name -eq "Internal Storage" } | Select-Object -First 1
            $garmin = $internal.GetFolder.Items() | Where-Object { $_.Name -eq "GARMIN" } | Select-Object -First 1
            $apps = $garmin.GetFolder.Items() | Where-Object { $_.Name -eq "APPS" } | Select-Object -First 1
            if ($apps) {
                $existingLegacy = $apps.GetFolder.Items() | Where-Object { $_.Name -match "^Venu2Moat(\.prg)?$" } | Select-Object -First 1
                $sourceToCopy = if ($existingLegacy) { $LegacyPrgPath } else { $PrgPath }
                # Flags: 4 (No progress dialog) + 16 (Yes to All / Overwrite) + 512 (No confirm dir) + 1024 (No error UI) = 1556
                $apps.GetFolder.CopyHere($sourceToCopy, 1556)
                Start-Sleep -Seconds 2
                return $venu.Name
            }
        }
        return $null
    } -ArgumentList $OutputPrg, $LegacyPrg

    if (Wait-Job $mtpJob -Timeout 8) {
        $watchName = Receive-Job $mtpJob
        if ($watchName) {
            Write-Host "[OK] Sideloaded GarminMoat via MTP USB to '$watchName\Internal Storage\GARMIN\APPS'!" -ForegroundColor Green
            $Sideloaded = $true
        }
    } else {
        Stop-Job $mtpJob -ErrorAction SilentlyContinue
        Write-Warning "MTP USB copy timed out (device may be busy or waiting in File Explorer)."
    }
    Remove-Job $mtpJob -Force -ErrorAction SilentlyContinue
} catch {
    Write-Warning "MTP check warning: $_"
}

# 5. Fallback: Mass Storage Drive Letter check
if (-not $Sideloaded) {
    $GarminDrives = Get-PSDrive -PSProvider FileSystem | Where-Object {
        Test-Path (Join-Path $_.Root "GARMIN\APPS")
    }
    if ($GarminDrives) {
        foreach ($drv in $GarminDrives) {
            $TargetAppsDir = Join-Path $drv.Root "GARMIN\APPS"
            $OldPrgOnDrive = Join-Path $TargetAppsDir "Venu2Moat.prg"
            if (Test-Path $OldPrgOnDrive) {
                Remove-Item -Path $OldPrgOnDrive -Force -ErrorAction SilentlyContinue
            }
            Copy-Item -Path $OutputPrg -Destination (Join-Path $TargetAppsDir "GarminMoat.prg") -Force
            Write-Host "[OK] Sideloaded GarminMoat.prg to $TargetAppsDir\GarminMoat.prg!" -ForegroundColor Green
            $Sideloaded = $true
        }
    }
}

if (-not $Sideloaded) {
    Write-Host "[i] No USB/MTP Garmin watch detected right now. Binary is ready at $OutputPrg" -ForegroundColor Yellow
}

# 6. Auto-sync any source/binary changes to GitHub repository
$SyncScript = Join-Path $PSScriptRoot "sync-github.ps1"
if (-not $SkipGitSync -and (Test-Path $SyncScript)) {
    try {
        & $SyncScript -Message "chore(build): rebuild GarminMoat.prg ($Device) and sync source changes"
    } catch {
        Write-Warning "GitHub auto-sync warning: $_"
    }
}
