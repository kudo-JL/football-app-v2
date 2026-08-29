# Diagnostic script for git push issues
$ErrorActionPreference = "Continue"
Write-Host "=== Git Diagnostic ===" -ForegroundColor Cyan
Write-Host ""

Write-Host "1) Current directory:" -ForegroundColor Yellow
Get-Location
Write-Host ""

Write-Host "2) Files in folder:" -ForegroundColor Yellow
Get-ChildItem -Name | Select-Object -First 20
Write-Host ""

Write-Host "3) Git status:" -ForegroundColor Yellow
git status
Write-Host ""

Write-Host "4) Local branches:" -ForegroundColor Yellow
git branch -a
Write-Host ""

Write-Host "5) Remote URL:" -ForegroundColor Yellow
git remote -v
Write-Host ""

Write-Host "6) Last commit:" -ForegroundColor Yellow
git log --oneline -5
Write-Host ""

Write-Host "7) Try to push and capture FULL error:" -ForegroundColor Yellow
git push -u origin main 2>&1 | Out-String
Write-Host ""

Write-Host "=== End ===" -ForegroundColor Cyan
Read-Host "Press Enter to close"
