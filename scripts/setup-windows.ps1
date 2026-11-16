param(
  [switch]$Install
)

$ErrorActionPreference = "Stop"

function Test-Command($Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-VcTools {
  $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  if (-not (Test-Path $vswhere)) { return $false }
  $path = & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  return [bool]($path | Select-Object -First 1)
}

$missing = @()
if (-not (Test-Command "node")) { $missing += "Node.js 20+" }
if (-not (Test-Command "npm")) { $missing += "npm" }
if (-not (Test-Command "cargo")) { $missing += "Rust (MSVC toolchain)" }
if (-not (Test-Command "rustc")) { $missing += "rustc" }
if (-not (Test-VcTools)) { $missing += "Visual Studio C++ Build Tools" }

if ($missing.Count -gt 0) {
  Write-Host "Missing: $($missing -join ', ')"
  if (-not $Install) {
    @"

Install the missing tools with winget:
  winget install OpenJS.NodeJS.LTS
  winget install Rustlang.Rustup
  winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

Or run:
  powershell -ExecutionPolicy Bypass -File scripts/setup-windows.ps1 -Install

WebView2 is preinstalled on Windows 11. On Windows 10, install the Evergreen
WebView2 Runtime if it is missing.
"@ | Write-Host
    exit 1
  }

  if (-not (Test-Command "winget")) {
    Write-Host "winget is required for automatic installation. Install App Installer from Microsoft Store." -ForegroundColor Red
    exit 1
  }

  if (-not (Test-Command "node") -or -not (Test-Command "npm")) {
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  }
  if (-not (Test-Command "cargo")) {
    winget install --id Rustlang.Rustup -e --accept-source-agreements --accept-package-agreements
  }
  if (-not (Test-VcTools)) {
    winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-source-agreements --accept-package-agreements --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
  }

  Write-Host "Installation commands finished. Open a new terminal, then re-run this script." -ForegroundColor Yellow
  exit 1
}

$arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
if ($arch.ToString() -ne "X64") {
  Write-Host "This build targets Windows x64; current architecture is $arch." -ForegroundColor Red
  exit 1
}

Write-Host @"

Windows build prerequisites are ready.
Next:
  npm ci
  npm run build:app

Artifacts are written to release-assets\v<version>\platforms\windows\.
Signing is done separately on the Linux workstation.
"@
