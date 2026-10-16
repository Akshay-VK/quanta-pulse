# Generates the minisign key pair used to sign Quanta Pulse update bundles.
#
# Usage (from the repository root, in PowerShell):
#   .\scripts\generate-signing-key.ps1
#
# The private key is written to  $HOME\.tauri\quanta-pulse.key  and the public
# half to  $HOME\.tauri\quanta-pulse.key.pub . The password is prompted for;
# do not pass it on the command line.
$ErrorActionPreference = "Stop"

$keyDir = Join-Path $HOME ".tauri"
$keyPath = Join-Path $keyDir "quanta-pulse.key"
$pubPath = "$keyPath.pub"

if (Test-Path $keyPath) {
    Write-Error "A signing key already exists at $keyPath. Refusing to overwrite it."
    exit 1
}
if (Test-Path $pubPath) {
    Write-Error "A signing public key already exists at $pubPath. Re-run only after moving both files aside."
    exit 1
}

New-Item -ItemType Directory -Force -Path $keyDir | Out-Null

Write-Host ""
Write-Host "BACK UP  $keyPath  AND  $pubPath  TO AN ENCRYPTED, OFFLINE LOCATION."
Write-Host "If the private key is lost, users can never update automatically again."
Write-Host ""
Write-Host "You will now be prompted for a signing password. Choose a strong one and store it"
Write-Host "in the same secure location."
Write-Host ""

# -w writes the key pair. No -p and no -f: the CLI prompts for the password and
# refuses to clobber an existing key (we already checked, defence in depth).
npx tauri signer generate -w $keyPath
if ($LASTEXITCODE -ne 0) {
    Write-Error "tauri signer generate failed (exit $LASTEXITCODE)."
    exit $LASTEXITCODE
}

$pubkey = (Get-Content $pubPath -Raw).Trim()
Write-Host ""
Write-Host "Public key written to $pubPath:"
Write-Host $pubkey
Write-Host ""
Write-Host "Install it into the app config with:"
Write-Host "  node scripts/set-pubkey.mjs ""$pubPath"""
Write-Host ""
Write-Host "Then commit the resulting tauri.conf.json change and run 'npm run release:config:check'."
