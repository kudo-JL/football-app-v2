# Football League Manager v2 - one-click installer
# PowerShell 5.1 compatible

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host ''
Write-Host '  Football League Manager v2 - Installer' -ForegroundColor Green
Write-Host '  =====================================' -ForegroundColor Green
Write-Host ''

# Check Node 22+
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $nodeCmd) {
  Write-Host '  [X] Node.js not found. Install from https://nodejs.org' -ForegroundColor Red
  Read-Host '  Press Enter to exit'
  exit 1
}
$nodeVersion = node --version
Write-Host "  [OK] Node: $nodeVersion" -ForegroundColor Green

$major = [int]($nodeVersion -replace 'v(\d+)\..*','$1')
if ($major -lt 22) {
  Write-Host '  [X] Node 22+ required (you have '$nodeVersion'). Update from https://nodejs.org' -ForegroundColor Red
  Read-Host '  Press Enter to exit'
  exit 1
}

# Install dependencies
Write-Host ''
Write-Host '  [1/2] Installing dependencies...' -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) {
  Write-Host '  [X] npm install failed' -ForegroundColor Red
  Read-Host '  Press Enter to exit'
  exit 1
}

# Start
Write-Host ''
Write-Host '  [2/2] Starting server...' -ForegroundColor Cyan
Write-Host ''
Write-Host '  Open: http://localhost:3000' -ForegroundColor Green
Write-Host '  First account you create = ADMIN' -ForegroundColor Yellow
Write-Host '  Press Ctrl+C to stop' -ForegroundColor Gray
Write-Host ''

node server.js
