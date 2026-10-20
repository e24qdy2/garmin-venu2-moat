param(
    [string]$TunnelName = "venu2moat",
    [string]$Hostname = "moat.readybyte.top",
    [string]$LocalUrl = "http://localhost:3880"
)

$Cloudflared = Join-Path $PSScriptRoot "bin\cloudflared.exe"
$CertPath = Join-Path $env:USERPROFILE ".cloudflared\cert.pem"

Write-Host "[*] Waiting for Cloudflare authorization ($CertPath)..." -ForegroundColor Cyan
while (-not (Test-Path $CertPath)) {
    Start-Sleep -Seconds 2
}
Write-Host "[OK] Cloudflare cert.pem detected!" -ForegroundColor Green

# Check if tunnel already exists, otherwise create it
$ExistingList = & $Cloudflared tunnel list 2>&1 | Out-String
if ($ExistingList -notmatch "\b$TunnelName\b") {
    Write-Host "[*] Creating Cloudflare Tunnel '$TunnelName'..." -ForegroundColor Cyan
    & $Cloudflared tunnel create $TunnelName
} else {
    Write-Host "[OK] Reusing existing Cloudflare Tunnel '$TunnelName'" -ForegroundColor Green
}

Write-Host "[*] Routing DNS '$Hostname' and 'admin-$Hostname' -> '$TunnelName'..." -ForegroundColor Cyan
& $Cloudflared tunnel route dns --overwrite-dns $TunnelName $Hostname
& $Cloudflared tunnel route dns --overwrite-dns $TunnelName "admin-$Hostname"

Write-Host "[OK] Starting live HTTPS tunnel https://$Hostname -> $LocalUrl ..." -ForegroundColor Green
& $Cloudflared tunnel --no-autoupdate run --url $LocalUrl $TunnelName
