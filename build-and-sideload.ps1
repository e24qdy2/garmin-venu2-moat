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
Write-Host "  MoatWatch - Garmin 2024-2026 Multi-Device Build & USB Sideloader" -ForegroundColor Cyan
Write-Host "==================================================================`n" -ForegroundColor Cyan

$AppDir = Join-Path $PSScriptRoot "garmin-venu2-app"
$DistDir = Join-Path $PSScriptRoot "dist"
$DownloadsDir = Join-Path $PSScriptRoot "public\downloads"
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
New-Item -ItemType Directory -Force -Path $DownloadsDir | Out-Null

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

$JungleFile = Join-Path $AppDir "monkey.jungle"
$ManifestFile = Join-Path $AppDir "manifest.xml"
$BuildEditionFile = Join-Path $AppDir "source\BuildEdition.mc"
$SettingsFile = Join-Path $AppDir "resources\settings\settings.xml"
$BetaAppId = "83e22c8d-edfe-40f4-9d8a-16a5fd99cbfa"
$PublicAppId = "94f33d9e-fe0f-41a5-8e9b-27b6fe00dc0b"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Set-BuildConfiguration {
    param(
        [string]$AppId,
        [bool]$IsFreeFull,
        [string]$EditionCode
    )
    if (Test-Path $ManifestFile) {
        $mRaw = [System.IO.File]::ReadAllText($ManifestFile, [System.Text.Encoding]::UTF8)
        $mUpdated = $mRaw -replace 'id="[0-9a-fA-F\-]{36}"', "id=`"$AppId`""
        [System.IO.File]::WriteAllText($ManifestFile, $mUpdated, $utf8NoBom)
    }
    $boolStr = if ($IsFreeFull) { "true" } else { "false" }
    $editionMc = @"
import Toybox.Lang;

(:glance)
module BuildEdition {
    // True for FreeFull / Beta / Public lifetime unlocked editions (no activation key required)
    const IS_FREE_FULL = $boolStr;
    const EDITION_CODE = "$EditionCode";
}
"@
    [System.IO.File]::WriteAllText($BuildEditionFile, $editionMc, $utf8NoBom)

    if ($IsFreeFull) {
        $settingsXml = @"
<settings>
    <setting propertyKey="@Properties.syncKey" title="@Strings.SyncKeyTitle">
        <settingConfig type="alphaNumeric" maxLength="24" />
    </setting>
    <setting propertyKey="@Properties.apiUrl" title="@Strings.ApiUrlTitle">
        <settingConfig type="alphaNumeric" maxLength="160" />
    </setting>
</settings>
"@
    } else {
        $settingsXml = @"
<settings>
    <setting propertyKey="@Properties.syncKey" title="@Strings.SyncKeyTitle">
        <settingConfig type="alphaNumeric" maxLength="24" />
    </setting>
    <setting propertyKey="@Properties.activationKey" title="@Strings.ActivationKeyTitle">
        <settingConfig type="alphaNumeric" maxLength="24" />
    </setting>
    <setting propertyKey="@Properties.apiUrl" title="@Strings.ApiUrlTitle">
        <settingConfig type="alphaNumeric" maxLength="160" />
    </setting>
</settings>
"@
    }
    [System.IO.File]::WriteAllText($SettingsFile, $settingsXml, $utf8NoBom)
}

# Ensure default FreeFull Beta configuration before compiling default .prg
Set-BuildConfiguration -AppId $BetaAppId -IsFreeFull $true -EditionCode "FREEFULL"

# 3. Compile MoatWatch.prg (FreeFull Lifetime Unlocked default)
$OutputPrg = Join-Path $DistDir "MoatWatch.prg"
$GarminMoatPrg = Join-Path $DistDir "GarminMoat.prg"
$LegacyPrg = Join-Path $DistDir "Venu2Moat.prg"
$BetaPrg = Join-Path $DistDir "MoatWatch-Beta.prg"
$FreeFullPrg = Join-Path $DistDir "MoatWatch-FreeFull.prg"

Write-Host "[*] Compiling MoatWatch.prg (FREEFULL Lifetime Unlocked) for device '$Device'..." -ForegroundColor Cyan
& $JavaExe "-Xms1g" "-Dfile.encoding=UTF-8" -jar $MonkeyJar -o $OutputPrg -f $JungleFile -y $KeyPath -d $Device -w

if (Test-Path $OutputPrg) {
    Copy-Item -Path $OutputPrg -Destination $GarminMoatPrg -Force
    Copy-Item -Path $OutputPrg -Destination $LegacyPrg -Force
    Copy-Item -Path $OutputPrg -Destination $BetaPrg -Force
    Copy-Item -Path $OutputPrg -Destination $FreeFullPrg -Force
    Copy-Item -Path $OutputPrg -Destination (Join-Path $DownloadsDir "MoatWatch-Beta.prg") -Force
    Copy-Item -Path $OutputPrg -Destination (Join-Path $DownloadsDir "MoatWatch-FreeFull.prg") -Force
    if (Test-Path "$OutputPrg.debug.xml") {
        Copy-Item -Path "$OutputPrg.debug.xml" -Destination "$GarminMoatPrg.debug.xml" -Force
        Copy-Item -Path "$OutputPrg.debug.xml" -Destination "$LegacyPrg.debug.xml" -Force
    }
    $SizeKb = [Math]::Round((Get-Item $OutputPrg).Length / 1KB, 1)
    Write-Host "[OK] Built FreeFull binary: $OutputPrg ($SizeKb KB)" -ForegroundColor Green
}

if ($PackageStoreIq) {
    $OutputIq = Join-Path $DistDir "MoatWatch.iq"
    $BetaIq = Join-Path $DistDir "MoatWatch-Beta.iq"
    $PublicIq = Join-Path $DistDir "MoatWatch-Public.iq"
    $FreeFullIq = Join-Path $DistDir "MoatWatch-FreeFull.iq"
    $FreeFullBetaIq = Join-Path $DistDir "MoatWatch-FreeFull-Beta.iq"
    $PaidIq = Join-Path $DistDir "MoatWatch-Paid.iq"
    $PaidBetaIq = Join-Path $DistDir "MoatWatch-Paid-Beta.iq"
    $GarminMoatIq = Join-Path $DistDir "GarminMoat.iq"
    $PublicPrg = Join-Path $DistDir "MoatWatch-Public.prg"
    $PaidPrg = Join-Path $DistDir "MoatWatch-Paid.prg"

    try {
        # Edition A: Beta Channel + FreeFull Lifetime Unlocked (UUID: 83e22c8d-edfe-40f4-9d8a-16a5fd99cbfa)
        Set-BuildConfiguration -AppId $BetaAppId -IsFreeFull $true -EditionCode "BETA_FREEFULL"
        Write-Host "[*] [1/4] Packaging Beta + FreeFull Store Bundle (UUID: $BetaAppId)..." -ForegroundColor Cyan
        & $JavaExe "-Xms1g" "-Dfile.encoding=UTF-8" -jar $MonkeyJar -e -r -o $OutputIq -f $JungleFile -y $KeyPath -w
        if (Test-Path $OutputIq) {
            Copy-Item -Path $OutputIq -Destination $BetaIq -Force
            Copy-Item -Path $OutputIq -Destination $FreeFullBetaIq -Force
            Copy-Item -Path $OutputIq -Destination $GarminMoatIq -Force
            Copy-Item -Path $OutputIq -Destination (Join-Path $DownloadsDir "MoatWatch-Beta.iq") -Force
            Copy-Item -Path $OutputIq -Destination (Join-Path $DownloadsDir "MoatWatch-FreeFull-Beta.iq") -Force
            $IqSizeKb = [Math]::Round((Get-Item $OutputIq).Length / 1KB, 1)
            Write-Host "[OK] Built Beta/FreeFull-Beta .iq Package ($IqSizeKb KB)" -ForegroundColor Green
        }

        # Edition B: Public Channel + FreeFull Lifetime Unlocked (UUID: 94f33d9e-fe0f-41a5-8e9b-27b6fe00dc0b)
        Set-BuildConfiguration -AppId $PublicAppId -IsFreeFull $true -EditionCode "PUBLIC_FREEFULL"
        Write-Host "[*] [2/4] Packaging Public + FreeFull Store Bundle (UUID: $PublicAppId)..." -ForegroundColor Cyan
        & $JavaExe "-Xms1g" "-Dfile.encoding=UTF-8" -jar $MonkeyJar -e -r -o $PublicIq -f $JungleFile -y $KeyPath -w
        if (Test-Path $PublicIq) {
            Copy-Item -Path $PublicIq -Destination $FreeFullIq -Force
            Copy-Item -Path $PublicIq -Destination (Join-Path $DownloadsDir "MoatWatch-Public.iq") -Force
            Copy-Item -Path $PublicIq -Destination (Join-Path $DownloadsDir "MoatWatch-FreeFull.iq") -Force
            $PubSizeKb = [Math]::Round((Get-Item $PublicIq).Length / 1KB, 1)
            Write-Host "[OK] Built Public/FreeFull .iq Package ($PubSizeKb KB)" -ForegroundColor Green
        }
        & $JavaExe "-Xms1g" "-Dfile.encoding=UTF-8" -jar $MonkeyJar -o $PublicPrg -f $JungleFile -y $KeyPath -d $Device -w
        if (Test-Path $PublicPrg) {
            Copy-Item -Path $PublicPrg -Destination (Join-Path $DownloadsDir "MoatWatch-Public.prg") -Force
        }

        # Edition C: Paid Edition (14D Trial + Pro Key Gated, Public UUID: 94f33d9e-fe0f-41a5-8e9b-27b6fe00dc0b)
        Set-BuildConfiguration -AppId $PublicAppId -IsFreeFull $false -EditionCode "PAID_PRO"
        Write-Host "[*] [3/4] Packaging Paid Edition Store Bundle (Public UUID: $PublicAppId)..." -ForegroundColor Cyan
        & $JavaExe "-Xms1g" "-Dfile.encoding=UTF-8" -jar $MonkeyJar -e -r -o $PaidIq -f $JungleFile -y $KeyPath -w
        if (Test-Path $PaidIq) {
            Copy-Item -Path $PaidIq -Destination (Join-Path $DownloadsDir "MoatWatch-Paid.iq") -Force
            $PaidSizeKb = [Math]::Round((Get-Item $PaidIq).Length / 1KB, 1)
            Write-Host "[OK] Built Paid .iq Package ($PaidSizeKb KB)" -ForegroundColor Green
        }
        & $JavaExe "-Xms1g" "-Dfile.encoding=UTF-8" -jar $MonkeyJar -o $PaidPrg -f $JungleFile -y $KeyPath -d $Device -w
        if (Test-Path $PaidPrg) {
            Copy-Item -Path $PaidPrg -Destination (Join-Path $DownloadsDir "MoatWatch-Paid.prg") -Force
            $PaidPrgSizeKb = [Math]::Round((Get-Item $PaidPrg).Length / 1KB, 1)
            Write-Host "[OK] Built Paid .prg Binary ($PaidPrgSizeKb KB)" -ForegroundColor Green
        }

        # Edition D: Paid-Beta Edition (14D Trial + Pro Key Gated, Beta UUID: 83e22c8d-edfe-40f4-9d8a-16a5fd99cbfa)
        Set-BuildConfiguration -AppId $BetaAppId -IsFreeFull $false -EditionCode "PAID_BETA"
        Write-Host "[*] [4/4] Packaging Paid-Beta Store Bundle (Beta UUID: $BetaAppId)..." -ForegroundColor Cyan
        & $JavaExe "-Xms1g" "-Dfile.encoding=UTF-8" -jar $MonkeyJar -e -r -o $PaidBetaIq -f $JungleFile -y $KeyPath -w
        if (Test-Path $PaidBetaIq) {
            Copy-Item -Path $PaidBetaIq -Destination (Join-Path $DownloadsDir "MoatWatch-Paid-Beta.iq") -Force
            $PaidBetaSizeKb = [Math]::Round((Get-Item $PaidBetaIq).Length / 1KB, 1)
            Write-Host "[OK] Built Paid-Beta .iq Package ($PaidBetaSizeKb KB)" -ForegroundColor Green
        }
    } finally {
        # Always restore source tree to FreeFull Lifetime Unlocked + Beta UUID
        Set-BuildConfiguration -AppId $BetaAppId -IsFreeFull $true -EditionCode "FREEFULL"
    }

    # Generate public/downloads/packages.json manifest for Admin Panel Download Center
    & node -e @"
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dir = path.join(process.cwd(), 'public', 'downloads');
function statFile(fileName) {
  const full = path.join(dir, fileName);
  if (!fs.existsSync(full)) return null;
  const buf = fs.readFileSync(full);
  const st = fs.statSync(full);
  return {
    fileName,
    url: '/downloads/' + fileName,
    sizeBytes: st.size,
    sizeKb: Number((st.size / 1024).toFixed(1)),
    sha256: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16),
    updatedAt: st.mtime.toISOString()
  };
}
const manifest = {
  generatedAt: new Date().toISOString(),
  sdkVersion: '8.4.1',
  supportedModelsCount: 20,
  editions: [
    {
      id: 'freefull',
      name: 'FreeFull (Full Lifetime Unlocked)',
      badge: 'FREEFULL LIFETIME',
      channel: 'Public + Beta Store & USB Sideload',
      licenseMode: 'FREEFULL_LIFETIME',
      requiresActivationKey: false,
      manifestAppId: '94f33d9e-fe0f-41a5-8e9b-27b6fe00dc0b',
      betaManifestAppId: '83e22c8d-edfe-40f4-9d8a-16a5fd99cbfa',
      description: 'ปลดล็อก Full Lifetime ถาวรในตัวแอป ไม่ต้องกรอก Activation Key ไม่มีวันหมดอายุ (แม้ใช้งาน Offline) และซ่อนช่องกรอกคีย์ใน Connect IQ Settings',
      files: {
        iqPublic: statFile('MoatWatch-FreeFull.iq'),
        iqBeta: statFile('MoatWatch-FreeFull-Beta.iq'),
        prg: statFile('MoatWatch-FreeFull.prg')
      }
    },
    {
      id: 'beta',
      name: 'Beta Channel (Garmin Store Beta)',
      badge: 'BETA CHANNEL',
      channel: 'Garmin Connect IQ Beta Store',
      licenseMode: 'FREEFULL_LIFETIME',
      requiresActivationKey: false,
      manifestAppId: '83e22c8d-edfe-40f4-9d8a-16a5fd99cbfa',
      description: 'แพ็กเกจสำหรับอัปโหลดขึ้น Garmin Connect IQ Developer Portal ช่องทาง Beta App (UUID: 83e22c8d-edfe-40f4-9d8a-16a5fd99cbfa) ปลดล็อก Full Lifetime',
      files: {
        iq: statFile('MoatWatch-Beta.iq'),
        prg: statFile('MoatWatch-Beta.prg')
      }
    },
    {
      id: 'public',
      name: 'Public Channel (Garmin Store Public)',
      badge: 'PUBLIC STORE',
      channel: 'Garmin Connect IQ Public Store',
      licenseMode: 'FREEFULL_LIFETIME',
      requiresActivationKey: false,
      manifestAppId: '94f33d9e-fe0f-41a5-8e9b-27b6fe00dc0b',
      description: 'แพ็กเกจสำหรับอัปโหลดขึ้น Garmin Connect IQ Store สาธารณะ (UUID: 94f33d9e-fe0f-41a5-8e9b-27b6fe00dc0b) รองรับนาฬิกา 20 รุ่น ปลดล็อก Full Lifetime',
      files: {
        iq: statFile('MoatWatch-Public.iq'),
        prg: statFile('MoatWatch-Public.prg')
      }
    },
    {
      id: 'paid',
      name: 'Paid / Pro Key Edition (14D Trial + Key)',
      badge: 'PAID / PRO KEY',
      channel: 'Commercial / Key-Gated Release',
      licenseMode: 'TRIAL_14D_PRO_KEY',
      requiresActivationKey: true,
      manifestAppId: '94f33d9e-fe0f-41a5-8e9b-27b6fe00dc0b',
      betaManifestAppId: '83e22c8d-edfe-40f4-9d8a-16a5fd99cbfa',
      description: 'เวอร์ชันระบบสมาชิก ทดลองใช้ฟรี 14 วัน พร้อมหน้าจอแจ้งเตือนเมื่อหมดอายุและช่องใส่รหัส Pro Activation Key (ทำงานร่วมกับปุ่ม Unhide PaidMode บน Admin Panel)',
      files: {
        iqPublic: statFile('MoatWatch-Paid.iq'),
        iqBeta: statFile('MoatWatch-Paid-Beta.iq'),
        prg: statFile('MoatWatch-Paid.prg')
      }
    }
  ]
};
fs.writeFileSync(path.join(dir, 'packages.json'), JSON.stringify(manifest, null, 2));
console.log('[OK] Generated public/downloads/packages.json manifest (' + manifest.editions.length + ' editions)');
"@
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
