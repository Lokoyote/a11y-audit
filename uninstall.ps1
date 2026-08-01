# Script de desinstallation automatique de a11y-audit (Windows / PowerShell)
# Usage : .\uninstall.ps1 [-Yes]
param(
  [switch]$Yes
)
$ErrorActionPreference = "Stop"

$AppName = "a11y-audit"
$InstallDir = Join-Path $env:LOCALAPPDATA "$AppName"
$BinDir = Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps"
$WrapperPath = Join-Path $BinDir "$AppName.cmd"

Write-Host ""
Write-Host "Desinstallation de $AppName"
Write-Host "-------------------------------------"

$installDirExists = Test-Path $InstallDir
$wrapperExists = Test-Path $WrapperPath

if (-not $installDirExists -and -not $wrapperExists) {
  Write-Host "$AppName ne semble pas installe (rien a faire)."
  exit 0
}

Write-Host "Sera supprime :"
if ($installDirExists) { Write-Host "  - $InstallDir" }
if ($wrapperExists) { Write-Host "  - $WrapperPath" }
Write-Host ""

if (-not $Yes) {
  $confirm = Read-Host "Confirmer la suppression ? [o/N]"
  if ($confirm -notmatch '^[oOyY]') {
    Write-Host "Annule."
    exit 0
  }
}

if ($installDirExists) { Remove-Item -Recurse -Force $InstallDir }
if ($wrapperExists) { Remove-Item -Force $WrapperPath }

Write-Host ""
Write-Host "$AppName a ete desinstalle." -ForegroundColor Green
