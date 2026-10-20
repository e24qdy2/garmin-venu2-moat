param(
    [string]$Message = "chore: sync source code changes ($(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

git add -A
$status = git status --porcelain
if (-not $status) {
    Write-Host "[Git] Working tree is already clean and up to date with GitHub." -ForegroundColor Green
    exit 0
}

git commit -m $Message
git push -u origin main
Write-Host "[OK] Pushed latest source code changes to GitHub (origin/main)." -ForegroundColor Green
