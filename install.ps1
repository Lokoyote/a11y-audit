# Script d'installation automatique de a11y-audit (Windows / PowerShell)
# Usage : .\install.ps1
$ErrorActionPreference = "Stop"

$AppName = "a11y-audit"
$InstallDir = Join-Path $env:LOCALAPPDATA "$AppName"
$BinDir = Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "Installation de $AppName"
Write-Host "-------------------------------------"

# 1. Verifier Node.js
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Node.js n'est pas installe. Installez Node.js 18+ : https://nodejs.org" -ForegroundColor Red
  exit 1
}
$nodeVersion = (node -v) -replace 'v', ''
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 18) {
  Write-Host "Node.js 18+ requis (version detectee : $nodeVersion)." -ForegroundColor Red
  exit 1
}
Write-Host "Node.js $nodeVersion detecte"

# 2. Copier les fichiers du projet
Write-Host "Copie des fichiers vers $InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$exclude = @('install.sh', 'uninstall.sh', 'install.ps1', 'uninstall.ps1', 'node_modules', '.git')
Get-ChildItem -Path $ScriptDir -Force | Where-Object { $exclude -notcontains $_.Name } | ForEach-Object {
  Copy-Item -Path $_.FullName -Destination $InstallDir -Recurse -Force
}

# 3. Installer les dependances npm
Write-Host "Installation des dependances npm..."
Push-Location $InstallDir
npm install --omit=dev --no-audit --no-fund

# 4. Telecharger Chromium (Playwright)
Write-Host "Telechargement de Chromium (peut prendre quelques minutes)..."
npx --yes playwright install chromium
Pop-Location

# 5. Creer la commande globale (wrapper .cmd dans un dossier deja present dans le PATH utilisateur)
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
$wrapperPath = Join-Path $BinDir "$AppName.cmd"
@"
@echo off
node "$InstallDir\index.js" %*
"@ | Set-Content -Path $wrapperPath -Encoding ASCII

Write-Host ""
Write-Host "Installation terminee !" -ForegroundColor Green
Write-Host ""
Write-Host "Utilisation (ouvrez un nouveau terminal si la commande n'est pas trouvee) :"
Write-Host "  $AppName https://votre-site.fr"
Write-Host "  $AppName https://votre-site.fr --level AAA --out ./audits"
Write-Host ""
Write-Host "Pour desinstaller : .\uninstall.ps1"
