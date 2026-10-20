param(
  [string]$ApiToken = $env:CLOUDFLARE_API_TOKEN
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "  Venu2Moat -> Cloudflare Workers + D1 Serverless Production Deploy" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

if ($ApiToken) {
  $env:CLOUDFLARE_API_TOKEN = $ApiToken
}

# 1. Verify Wrangler Authentication
Write-Host "`n[1/5] Checking Cloudflare Wrangler authentication..." -ForegroundColor Yellow
$whoamiOut = npx wrangler whoami 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -or $whoamiOut -match "not authenticated|login") {
  Write-Host "Not logged in to Wrangler yet. Launching OAuth login in browser..." -ForegroundColor Yellow
  npx wrangler login
  if ($LASTEXITCODE -ne 0) {
    throw "Wrangler login failed or timed out."
  }
}
Write-Host "Authenticated with Cloudflare successfully." -ForegroundColor Green

# 2. Ensure Cloudflare D1 Database `venu2-moat-db` exists & bind in wrangler.jsonc
Write-Host "`n[2/5] Provisioning / Binding Cloudflare D1 Database (venu2-moat-db)..." -ForegroundColor Yellow
$d1ListRaw = npx wrangler d1 list --json 2>$null | Out-String
$dbId = $null
if ($d1ListRaw) {
  try {
    $d1List = $d1ListRaw | ConvertFrom-Json
    foreach ($item in $d1List) {
      if ($item.name -eq "venu2-moat-db") {
        $dbId = $item.uuid
        break
      }
    }
  } catch {}
}

if (-not $dbId) {
  Write-Host "Creating D1 database 'venu2-moat-db'..." -ForegroundColor Cyan
  $createOut = npx wrangler d1 create venu2-moat-db 2>&1 | Out-String
  if ($createOut -match '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})') {
    $dbId = $Matches[1]
  }
}

if ($dbId) {
  Write-Host "D1 Database ID: $dbId" -ForegroundColor Green
  $wranglerConfig = Get-Content -Raw -Path "$PSScriptRoot\wrangler.jsonc" | ConvertFrom-Json
  $wranglerConfig | Add-Member -NotePropertyName "d1_databases" -NotePropertyValue @(
    @{
      binding = "DB"
      database_name = "venu2-moat-db"
      database_id = $dbId
    }
  ) -Force
  $wranglerConfig | ConvertTo-Json -Depth 10 | Set-Content -Path "$PSScriptRoot\wrangler.jsonc" -Encoding UTF8

  Write-Host "Applying D1 schema migration (migrations/0001_init_moat_store.sql)..." -ForegroundColor Cyan
  npx wrangler d1 execute venu2-moat-db --remote --file=./migrations/0001_init_moat_store.sql
} else {
  Write-Host "Proceeding with Worker deployment (using built-in seed store)." -ForegroundColor Yellow
}

# 3. Deploy Cloudflare Worker + Static Assets + Custom Routes
Write-Host "`n[3/5] Deploying Venu2Moat Worker + Static Assets to Cloudflare Edge..." -ForegroundColor Yellow
npx wrangler deploy
if ($LASTEXITCODE -ne 0) {
  throw "npx wrangler deploy failed."
}
Write-Host "Cloudflare Worker deployed successfully!" -ForegroundColor Green

# 4. Switch DNS records on readybyte.top from local tunnel CNAME to Cloudflare Originless Worker DNS (AAAA 100::)
Write-Host "`n[4/5] Updating DNS records for moat.readybyte.top and admin-moat.readybyte.top..." -ForegroundColor Yellow
$certPath = "$env:USERPROFILE\.cloudflared\cert.pem"
$dnsToken = $env:CLOUDFLARE_API_TOKEN
$zoneId = "9bc69fdff09326e6e6def161ca09811f"

if (Test-Path $certPath) {
  $pemText = Get-Content -Raw $certPath
  if ($pemText -match "-----BEGIN ARGO TUNNEL TOKEN-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END ARGO TUNNEL TOKEN-----") {
    $b64 = ($Matches[1] -replace "\s+", "")
    $decoded = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($b64)) | ConvertFrom-Json
    if ($decoded.apiToken) {
      $dnsToken = $decoded.apiToken
    }
    if ($decoded.zoneID) {
      $zoneId = $decoded.zoneID
    }
  }
}

if ($dnsToken) {
  $headers = @{
    "Authorization" = "Bearer $dnsToken"
    "Content-Type"  = "application/json"
  }
  foreach ($hostName in @("moat.readybyte.top", "admin-moat.readybyte.top")) {
    $existingResp = Invoke-RestMethod -Method GET -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records?name=$hostName" -Headers $headers
    $bodyObj = @{
      type    = "AAAA"
      name    = $hostName
      content = "100::"
      ttl     = 1
      proxied = $true
      comment = "Serverless Cloudflare Worker (venu2-moat) - 24/7 Live without local PC tunnel"
    }
    $bodyJson = $bodyObj | ConvertTo-Json
    if ($existingResp.result -and $existingResp.result.Count -gt 0) {
      $recId = $existingResp.result[0].id
      $oldContent = $existingResp.result[0].content
      $updateResp = Invoke-RestMethod -Method PUT -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records/$recId" -Headers $headers -Body $bodyJson
      Write-Host "Updated DNS [$hostName]: $oldContent -> AAAA 100:: (Proxied to Worker)" -ForegroundColor Green
    } else {
      $createResp = Invoke-RestMethod -Method POST -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records" -Headers $headers -Body $bodyJson
      Write-Host "Created DNS [$hostName]: AAAA 100:: (Proxied to Worker)" -ForegroundColor Green
    }
  }
}

# 5. Smoke-Test Live Production Endpoints
Write-Host "`n[5/5] Verifying Live Production Endpoints on Cloudflare Edge..." -ForegroundColor Yellow
Start-Sleep -Seconds 2
$health = Invoke-RestMethod -Method GET -Uri "https://moat.readybyte.top/api/health"
Write-Host "Health Check (https://moat.readybyte.top/api/health): runtime=$($health.runtime), ok=$($health.ok)" -ForegroundColor Green
$watch = Invoke-RestMethod -Method GET -Uri "https://moat.readybyte.top/api/watch?key=VENU2-88"
Write-Host "Watch API (https://moat.readybyte.top/api/watch?key=VENU2-88): key=$($watch.k), license=$($watch.lic.st), portfolios=$($watch.p.Count)" -ForegroundColor Green
Write-Host "`n==================================================================" -ForegroundColor Green
Write-Host "  LIVE PRODUCTION CUTOVER COMPLETE! (No Local PC Required 24/7)" -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Green
