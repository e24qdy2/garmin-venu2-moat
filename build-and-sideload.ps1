param(
    [string]$SyncKey = "VENU2-88",
    [string]$ApiUrl = "https://moat.readybyte.top",
    [string]$Device = "venu2",
    [string]$KeyPath = "$PSScriptRoot\keys\developer_key.der"
)

$ErrorActionPreference = "Stop"
Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "  Venu2Moat - Garmin Venu 2 Build & MTP/USB Sideload Utility" -ForegroundColor Cyan
Write-Host "============================================================`n" -ForegroundColor Cyan

$AppDir = Join-Path $PSScriptRoot "garmin-venu2-app"
$DistDir = Join-Path $PSScriptRoot "dist"
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

# 1. Update default properties if SyncKey or ApiUrl provided
$PropsFile = Join-Path $AppDir "resources\settings\properties.xml"
if (Test-Path $PropsFile) {
    [xml]$xml = Get-Content $PropsFile
    foreach ($prop in $xml.properties.property) {
        if ($prop.id -eq "syncKey" -and $SyncKey) {
            $propInnerText = $SyncKey.ToUpper()
            $prop.InnerText = $propInnerText
            Write-Host "[OK] Embedded Default Sync Key : $propInnerText" -ForegroundColor Green
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

# 3. Compile Venu2Moat.prg for Garmin Venu 2
$OutputPrg = Join-Path $DistDir "Venu2Moat.prg"
$JungleFile = Join-Path $AppDir "monkey.jungle"
Write-Host "[*] Compiling Venu2Moat.prg for device '$Device'..." -ForegroundColor Cyan
& $JavaExe "-Xms1g" "-Dfile.encoding=UTF-8" -jar $MonkeyJar -o $OutputPrg -f $JungleFile -y $KeyPath -d $Device -w

if (Test-Path $OutputPrg) {
    $SizeKb = [Math]::Round((Get-Item $OutputPrg).Length / 1KB, 1)
    Write-Host "[OK] Built binary: $OutputPrg ($SizeKb KB)" -ForegroundColor Green
}

# 4. Auto-detect MTP-connected Garmin Venu 2 via Windows Shell.Application
$Sideloaded = $false
try {
    $shell = New-Object -ComObject Shell.Application
    $venu = $shell.NameSpace(17).Items() | Where-Object { $_.Name -like "*Venu*" } | Select-Object -First 1
    if ($venu) {
        $internal = $venu.GetFolder.Items() | Where-Object { $_.Name -eq "Internal Storage" } | Select-Object -First 1
        $garmin = $internal.GetFolder.Items() | Where-Object { $_.Name -eq "GARMIN" } | Select-Object -First 1
        $apps = $garmin.GetFolder.Items() | Where-Object { $_.Name -eq "APPS" } | Select-Object -First 1
        if ($apps) {
            $existing = $apps.GetFolder.Items() | Where-Object { $_.Name -like "Venu2Moat*" }
            if ($existing) {
                foreach ($item in $existing) { $item.InvokeVerb("delete") }
                Start-Sleep -Milliseconds 800
            }
            $apps.GetFolder.CopyHere($OutputPrg, 20)
            Start-Sleep -Seconds 2
            Write-Host "[OK] Sideloaded Venu2Moat.prg via MTP USB to '$($venu.Name)\Internal Storage\GARMIN\APPS\Venu2Moat.prg'!" -ForegroundColor Green
            $Sideloaded = $true
        }
    }
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
            Copy-Item -Path $OutputPrg -Destination (Join-Path $TargetAppsDir "Venu2Moat.prg") -Force
            Write-Host "[OK] Sideloaded Venu2Moat.prg to $TargetAppsDir\Venu2Moat.prg!" -ForegroundColor Green
            $Sideloaded = $true
        }
    }
}

if (-not $Sideloaded) {
    Write-Host "[i] No USB/MTP Garmin Venu 2 detected right now. Binary is ready at $OutputPrg" -ForegroundColor Yellow
}
