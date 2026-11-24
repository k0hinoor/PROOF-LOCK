# ProofLock updater for Windows PowerShell.
#
# Downloads the current main branch and overwrites the source files in this
# folder, keeping everything that is yours:
#   .venv\  frontend\node_modules\  frontend\dist\  data\  config\operators.json 
#
# Usage (from the repository folder, with the server stopped):
#   powershell -ExecutionPolicy Bypass -File .\update.ps1
#
# Add -Rebuild to also reinstall/build the frontend afterwards (normal use).

param(
    [switch]$Rebuild
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$root = (Get-Location).Path

function Say($text, $colour = 'Gray') { Write-Host $text -ForegroundColor $colour }

$zipUrl = 'https://codeload.github.com/k0hinoor/PROOF-LOCK/zip/refs/heads/main'
$temp = Join-Path ([System.IO.Path]::GetTempPath()) ('prooflock-update-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null

try {
    Say ''
    Say '  ProofLock updater' 'Cyan'
    Say '  =================' 'DarkGray'
    Say ''
    Say "[1/4] Downloading the latest source..."
    $zip = Join-Path $temp 'prooflock.zip'
    Invoke-WebRequest -Uri $zipUrl -OutFile $zip -UseBasicParsing

    Say '[2/4] Unpacking...'
    $expanded = Join-Path $temp 'unpacked'
    Expand-Archive -LiteralPath $zip -DestinationPath $expanded -Force
    $source = Join-Path $expanded 'PROOF-LOCK-main'
    if (-not (Test-Path -LiteralPath (Join-Path $source 'backend\main.py'))) {
        throw 'The download did not contain the project files.'
    }
    $version = (Get-Content -LiteralPath (Join-Path $source 'README.md') -TotalCount 1)
    Say "      Package: $version"

    Say '[3/4] Copying files over this folder...'
    # Robocopy is part of Windows. Excluded: the folders you built locally.
    $exclude = @('.venv', 'node_modules', 'dist', 'data', '.git', '__pycache__', '.pytest_cache')
    $copyArgs = @($source, $root, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/R:1', '/W:1')
    foreach ($name in $exclude) { $copyArgs += @('/XD', $name) }
    & robocopy @copyArgs | Out-Null
    # robocopy reports 0-7 for success (8 and above is a real failure).
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }

    Say '[4/4] Files updated.'
    Say ''
    Say '  Kept as they were: .venv, node_modules, dist, data, config\operators.json' 'DarkGreen'

    if (-not (Test-Path -LiteralPath 'config\operators.json')) {
        Copy-Item -LiteralPath 'config\operators.example.json' -Destination 'config\operators.json'
        Say '  config\operators.json did not exist, so it was created from the example.' 'Yellow'
    }

    if ($Rebuild) {
        Say ''
        Say '  Rebuilding the console...' 'Cyan'
        if (-not (Test-Path -LiteralPath 'frontend\node_modules')) {
            npm --prefix frontend ci
            if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
        }
        npm --prefix frontend run build
        if ($LASTEXITCODE -ne 0) { throw 'The frontend build failed.' }
        Say '  Build complete.' 'Green'
    } else {
        Say ''
        Say '  Run  start.ps1  to rebuild and start, or add -Rebuild to this script.' 'Gray'
    }

    Say ''
    Say '  Done.' 'Green'
}
catch {
    Say ''
    Say "  ERROR: $($_.Exception.Message)" 'Red'
    exit 1
}
finally {
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
