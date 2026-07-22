# KOINCODE installer for Windows
# Usage: irm https://raw.githubusercontent.com/KONY05/koincode/main/install.ps1 | iex

$ErrorActionPreference = "Stop"

$Repo = "KONY05/koincode"
$BinaryName = "koincode-windows-x64.exe"
$InstallDir = "$env:LOCALAPPDATA\koincode"

Write-Host "Finding latest release..." -ForegroundColor Cyan

$Release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest"
$Tag = $Release.tag_name
$Asset = $Release.assets | Where-Object { $_.name -eq $BinaryName }

if (-not $Asset) {
    Write-Host "Error: No Windows binary found in release $Tag." -ForegroundColor Red
    Write-Host "Download manually from: https://github.com/$Repo/releases/latest" -ForegroundColor Yellow
    exit 1
}

$DownloadUrl = $Asset.browser_download_url

Write-Host "Downloading koincode $Tag for windows-x64..." -ForegroundColor Cyan

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

$OutFile = Join-Path $InstallDir "koincode.exe"
Invoke-WebRequest -Uri $DownloadUrl -OutFile $OutFile -UseBasicParsing

# Add to PATH if not already present
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$UserPath;$InstallDir", "User")
    Write-Host "Added $InstallDir to your PATH." -ForegroundColor Green
    Write-Host "Restart your terminal for the PATH change to take effect." -ForegroundColor Yellow
}

Write-Host ""

# Colored ASCII wordmark — matches the "tiny" ascii-font used in the TUI header
# (packages/cli/src/components/header.tsx), so the install splash and the app's
# own splash screen read as the same brand.
$Koin = @(
    "█▄▀ █▀█ █ █▄ █ "
    "█ █ █▄█ █ █ ▀█ "
)
$Code = @(
    "█▀▀ █▀█ █▀▄ █▀▀ "
    "█▄▄ █▄█ █▄▀ ██▄ "
)
for ($i = 0; $i -lt $Koin.Length; $i++) {
    Write-Host $Koin[$i] -ForegroundColor White -NoNewline
    Write-Host $Code[$i] -ForegroundColor DarkYellow
}

Write-Host ""
Write-Host "koincode $Tag installed successfully!" -ForegroundColor Green
Write-Host "Koincode gives access to free/frontier models, get started:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  cd <project-folder>        # open your project folder/directory"
Write-Host "  koincode --setup           # Configure your API keys"
Write-Host "  koincode                   # Start coding"
Write-Host ""
Write-Host "For more information visit https://github.com/$Repo"
