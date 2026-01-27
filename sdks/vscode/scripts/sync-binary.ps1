# sync-binary.ps1
# Builds dipoleCODE (opencode-fork) and copies binaries to dipoleSTUDIO extension
#
# Usage:
#   .\sync-binary.ps1                    # Build all platforms
#   .\sync-binary.ps1 -SinglePlatform    # Build only current platform

param(
    [switch]$SinglePlatform,
    [string]$OpenCodePath = "C:\repos\opencode-fork",
    [string]$ExtensionPath = "C:\repos\dipoleSTUDIO\extensions\dipolecode"
)

$ErrorActionPreference = "Stop"

Write-Host "=== dipoleCODE Binary Sync ===" -ForegroundColor Cyan
Write-Host "OpenCode fork path: $OpenCodePath"
Write-Host "Extension path: $ExtensionPath"

# Verify opencode-fork exists
if (-not (Test-Path "$OpenCodePath\packages\opencode\package.json")) {
    Write-Host "ERROR: opencode-fork not found at $OpenCodePath" -ForegroundColor Red
    exit 1
}

# Navigate to opencode-fork
Push-Location "$OpenCodePath\packages\opencode"

try {
    # Build
    Write-Host "`n[1/3] Building dipoleCODE..." -ForegroundColor Yellow

    if ($SinglePlatform) {
        Write-Host "  Building for current platform only..."
        bun run build --single
    } else {
        Write-Host "  Building for all platforms..."
        bun run build
    }

    if ($LASTEXITCODE -ne 0) {
        throw "Build failed with exit code $LASTEXITCODE"
    }

    Write-Host "  Build completed!" -ForegroundColor Green

    # Create bin directory if not exists
    $binDir = "$ExtensionPath\bin"
    if (-not (Test-Path $binDir)) {
        New-Item -ItemType Directory -Path $binDir | Out-Null
    }

    # Copy binaries
    Write-Host "`n[2/3] Copying binaries to extension..." -ForegroundColor Yellow

    $distDir = "$OpenCodePath\packages\opencode\dist"

    # Platform mapping: source folder -> destination filename
    $platforms = @{
        "opencode-windows-x64"     = "opencode-win32-x64.exe"
        "opencode-darwin-arm64"    = "opencode-darwin-arm64"
        "opencode-darwin-x64"      = "opencode-darwin-x64"
        "opencode-linux-x64"       = "opencode-linux-x64"
        "opencode-linux-arm64"     = "opencode-linux-arm64"
    }

    $copiedCount = 0
    foreach ($platform in $platforms.GetEnumerator()) {
        $sourcePath = "$distDir\$($platform.Key)\bin\opencode"

        # Add .exe for Windows binary
        if ($platform.Key -like "*windows*") {
            $sourcePath += ".exe"
        }

        $destPath = "$binDir\$($platform.Value)"

        if (Test-Path $sourcePath) {
            Copy-Item -Path $sourcePath -Destination $destPath -Force
            $size = (Get-Item $destPath).Length / 1MB
            Write-Host "  Copied: $($platform.Value) ($([math]::Round($size, 2)) MB)" -ForegroundColor Green
            $copiedCount++
        } else {
            Write-Host "  Skipped: $($platform.Key) (not built)" -ForegroundColor Gray
        }
    }

    Write-Host "`n[3/3] Summary" -ForegroundColor Yellow
    Write-Host "  Binaries copied: $copiedCount"
    Write-Host "  Location: $binDir"

    # List final contents
    Write-Host "`n  Contents of bin/:" -ForegroundColor Cyan
    Get-ChildItem $binDir | ForEach-Object {
        $size = $_.Length / 1MB
        Write-Host "    $($_.Name) ($([math]::Round($size, 2)) MB)"
    }

    Write-Host "`n=== Sync complete! ===" -ForegroundColor Green

} finally {
    Pop-Location
}
