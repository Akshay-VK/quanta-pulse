# Builds the Windows NSIS installer and signs the updater artifact.
#
# Usage (from the repository root, in PowerShell):
#   .\scripts\build-windows.ps1
#
# The private key is read from $HOME\.tauri\quanta-pulse.key and its password is
# prompted for, so the secret never lands in your command history.
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$keyPath = Join-Path $HOME ".tauri\quanta-pulse.key"
if (-not (Test-Path $keyPath)) {
    Write-Error "No signing key at $keyPath. Run .\scripts\generate-signing-key.ps1 first."
    exit 1
}

# `tauri build` accepts either the key text or a path here.
$env:TAURI_SIGNING_PRIVATE_KEY = $keyPath

$secure = Read-Host -Prompt "Signing key password (blank if none)" -AsSecureString
$plain = [System.Net.NetworkCredential]::new("", $secure).Password
if ($plain) {
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $plain
}

npm run app:build:win
