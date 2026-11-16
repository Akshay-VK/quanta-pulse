# Windows x64 library tests with a link-time Common Controls v6 manifest.
# Opt into the isolated, interactive about:blank test with -Native.
[CmdletBinding()]
param([switch]$Native)

$ErrorActionPreference = 'Stop'
$keys = @('CARGO_ENCODED_RUSTFLAGS', 'CARGO_TARGET_DIR', 'CARGO_INCREMENTAL')
$prior = @{}
foreach ($key in $keys) {
    $prior[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
}
$pushed = $false
$result = 1
$failureReason = 'This test runner requires Windows and the x64 MSVC Rust toolchain.'
try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw 'Unsupported platform'
    }

    $failureReason = 'Existing Rust flags must be reviewed and cleared explicitly before using this runner; its manifest flags would override them. No flag values are printed.'
    foreach ($key in @('RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS', 'CARGO_BUILD_RUSTFLAGS', 'CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS')) {
        if (-not [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($key, 'Process'))) {
            throw 'Existing Rust flags'
        }
    }

    $failureReason = 'TEMP must name an existing, fully qualified Windows temporary directory.'
    $tempRoot = [Environment]::GetEnvironmentVariable('TEMP', 'Process')
    if ([string]::IsNullOrWhiteSpace($tempRoot) -or
        -not [IO.Path]::IsPathRooted($tempRoot) -or
        [IO.Path]::GetPathRoot($tempRoot).Length -lt 3 -or
        -not (Test-Path -LiteralPath $tempRoot -PathType Container)) {
        throw 'Invalid temporary directory'
    }
    $targetDir = Join-Path ([IO.Path]::GetFullPath($tempRoot)) 'quanta-native-test-target'

    $failureReason = 'Keep this file in the repository scripts directory; the repository must contain src-tauri/Cargo.toml.'
    $crateDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'src-tauri'
    if (-not (Test-Path -LiteralPath (Join-Path $crateDir 'Cargo.toml') -PathType Leaf)) {
        throw 'Missing library manifest'
    }
    $failureReason = 'cargo.exe must be available on PATH with the x86_64-pc-windows-msvc target and MSVC build tools installed.'
    $cargo = (Get-Command cargo.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source

    $failureReason = 'Could not prepare the library test working directory or temporary environment.'
    Push-Location -LiteralPath $crateDir
    $pushed = $true
    $env:CARGO_TARGET_DIR = $targetDir
    $env:CARGO_INCREMENTAL = '0'
    $dependency = "/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
    $env:CARGO_ENCODED_RUSTFLAGS = @('-C', 'link-arg=/MANIFEST:EMBED', '-C', "link-arg=$dependency") -join [char]31

    $testArgs = @()
    if ($Native) {
        $testArgs = @('auth::tests::native_blank_window_focus_cancel_delivery', '--', '--ignored', '--exact', '--nocapture')
    }
    $failureReason = 'Could not launch Cargo library tests. Check the Windows Rust/MSVC installation.'
    # Inherit output directly: PowerShell 5.1 must not turn redirected Cargo
    # stderr into a terminating error that hides the actual process exit code.
    # Every argument is a fixed token without spaces; no caller text is joined.
    $cargoArgs = @('test', '--target', 'x86_64-pc-windows-msvc', '--lib') + $testArgs
    $process = Start-Process -FilePath $cargo -ArgumentList $cargoArgs -NoNewWindow -Wait -PassThru
    $result = $process.ExitCode
    if ($null -eq $result) {
        $result = 1
    }
} catch {
    # Do not render exception details: paths/environment values may contain secrets.
    Write-Error -Message $failureReason -ErrorAction Continue
    $result = 1
} finally {
    try {
        if ($pushed) { Pop-Location }
    } finally {
        foreach ($key in $keys) {
            [Environment]::SetEnvironmentVariable($key, $prior[$key], 'Process')
        }
    }
}
exit $result
