# Football App v2.2 - One-click install + run
# v3: يحفظ بياناتك (data\football.db) قبل أي تحديث
# يقبل أي ملف football*.zip
$ErrorActionPreference = "Stop"
$dest = "$env:USERPROFILE\Desktop\football-app-v2"
$backupRoot = "$env:USERPROFILE\Desktop\football-backups"

Write-Host ""
Write-Host "Football App v2.2 - Installer" -ForegroundColor Green
Write-Host "=================================" -ForegroundColor Green
Write-Host ""

# 1) Check Node
$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node) {
  Write-Host "ERROR: Node.js not found. Install from https://nodejs.org (v22+ required)" -ForegroundColor Red
  Read-Host "Press Enter to exit"
  exit 1
}
Write-Host "Node: $(& node -v)" -ForegroundColor Cyan

# 2) Find the ZIP
$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$zipPath = Get-ChildItem -Path $scriptDir -Filter "football*.zip" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $zipPath) {
  $zipPath = Get-ChildItem -Path $env:USERPROFILE\Desktop -Filter "football*.zip" -ErrorAction SilentlyContinue | Select-Object -First 1
}
if (-not $zipPath) {
  Write-Host "ERROR: no football*.zip found in $scriptDir or on Desktop." -ForegroundColor Red
  Read-Host "Press Enter to exit"
  exit 1
}
Write-Host "Found ZIP: $($zipPath.Name) ($([math]::Round($zipPath.Length/1KB, 0)) KB)" -ForegroundColor Cyan

# 3) BACKUP existing data BEFORE touching anything
$dbPath = Join-Path $dest "data\football.db"
$backupFile = $null
if (Test-Path $dbPath) {
  Write-Host ""
  Write-Host "Existing data found at: $dbPath" -ForegroundColor Yellow
  if (-not (Test-Path $backupRoot)) {
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
  }
  $timestamp = Get-Date -Format "yyyy-MM-dd-HHmm"
  $backupFile = Join-Path $backupRoot "football-$timestamp.db"
  Copy-Item $dbPath $backupFile -Force
  Write-Host "Backed up to: $backupFile" -ForegroundColor Green
}

# 4) Extract to a TEMP folder (we'll merge code only, not nuke data)
$tempExtract = Join-Path $env:TEMP "football-app-extract-$timestamp"
if (Test-Path $tempExtract) { Remove-Item $tempExtract -Recurse -Force }
Write-Host "Extracting ZIP to temp..." -ForegroundColor Cyan
Expand-Archive -Path $zipPath.FullName -DestinationPath $tempExtract -Force
# The ZIP contains 'football-app-v2' as the top folder
$source = Join-Path $tempExtract "football-app-v2"
if (-not (Test-Path $source)) {
  # Try other name patterns
  $candidates = @("football_app_v2_2", "football-app-v2.2", "football-app")
  foreach ($c in $candidates) {
    $try = Join-Path $tempExtract $c
    if (Test-Path $try) { $source = $try; break }
  }
}
if (-not (Test-Path $source)) {
  Write-Host "ERROR: extracted folder structure unexpected" -ForegroundColor Red
  Read-Host "Press Enter to exit"
  exit 1
}

# 5) Merge: copy CODE files (lib, routes, views, public, server.js, package.json, .gitignore)
#     but PRESERVE the existing data folder
if (-not (Test-Path $dest)) {
  New-Item -ItemType Directory -Path $dest -Force | Out-Null
}
Write-Host "Updating code files (keeping your data)..." -ForegroundColor Cyan
$codeItems = @("lib", "routes", "views", "public", "server.js", "package.json", ".gitignore", "README.md", "start.bat")
foreach ($item in $codeItems) {
  $src = Join-Path $source $item
  $dst = Join-Path $dest $item
  if (Test-Path $src) {
    if (Test-Path $dst) { Remove-Item $dst -Recurse -Force -ErrorAction SilentlyContinue }
    Copy-Item $src $dst -Recurse -Force
  }
}
# Make sure data folder exists
$dataDst = Join-Path $dest "data"
if (-not (Test-Path $dataDst)) {
  New-Item -ItemType Directory -Path $dataDst -Force | Out-Null
  Copy-Item (Join-Path $source "data\.gitkeep") (Join-Path $dataDst ".gitkeep") -ErrorAction SilentlyContinue
}

# Clean up temp
Remove-Item $tempExtract -Recurse -Force -ErrorAction SilentlyContinue

# 6) Install deps
Write-Host ""
Write-Host "Installing dependencies (this may take a minute)..." -ForegroundColor Cyan
Set-Location $dest
& npm install --no-audit --no-fund | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "npm install failed." -ForegroundColor Red
  Read-Host "Press Enter to exit"
  exit 1
}

# 7) Done
Write-Host ""
Write-Host "=================================" -ForegroundColor Green
Write-Host "Install complete!" -ForegroundColor Green
if ($backupFile) {
  Write-Host "Your previous data backup: $backupFile" -ForegroundColor Yellow
  Write-Host "(Your login + cups + teams were preserved from the existing install.)" -ForegroundColor Yellow
}
Write-Host "Starting server..." -ForegroundColor Green
Write-Host "Open http://localhost:3000 in your browser." -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop, or close this window." -ForegroundColor Gray
Write-Host ""

& node server.js
Read-Host "Press Enter to close"
