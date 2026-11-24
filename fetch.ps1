# ProofLock - download every project file straight into this folder.
#
# Unlike update.ps1, this keeps NOTHING back: all tracked files are replaced
# with the current main branch. Your local extras (.venv, node_modules, dist,
# data, config/operators.json) are left in place because they are not in the
# download, but they are never excluded on purpose.
#
# Usage (server stopped):
#   powershell -ExecutionPolicy Bypass -File .\fetch.ps1
#
# Add -NoBuild to skip the frontend build.

param(
    [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$root = (Get-Location).Path

function Say($text, $colour = 'Gray') { Write-Host $text -ForegroundColor $colour }

$zipUrl = 'https://codeload.github.com/k0hinoor/PROOF-LOCK/zip/refs/heads/main'
$temp = Join-Path ([System.IO.Path]::GetTempPath()) ('prooflock-fetch-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null

try {
    Say ''
    Say '  ProofLock - download all files' 'Cyan'
    Say '  ===============================' 'DarkGray'
    Say ''

    Say '[1/4] Downloading...'
    $zip = Join-Path $temp 'prooflock.zip'
    Invoke-WebRequest -Uri $zipUrl -OutFile $zip -UseBasicParsing

    Say '[2/4] Unpacking...'
    Expand-Archive -LiteralPath $zip -DestinationPath $temp -Force
    $source = Join-Path $temp 'PROOF-LOCK-main'
    if (-not (Test-Path -LiteralPath (Join-Path $source 'backend\main.py'))) {
        throw 'The download did not contain the project files.'
    }

    Say '[3/4] Copying every file into this folder...'
    # -Force also brings .github and .gitignore; directories merge with the
    # existing ones and files are overwritten.
    Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $root -Recurse -Force

    $count = (Get-ChildItem -LiteralPath $source -Recurse -File -Force | Measure-Object).Count
    Say "[4/4] $count files copied." 'Green'

    if (-not (Test-Path -LiteralPath 'config\operators.json')) {
        Copy-Item -LiteralPath 'config\operators.example.json' -Destination 'config\operators.json'
        Say '  config\operators.json did not exist, so it was created from the example.' 'Yellow'
    }

    if (-not $NoBuild) {
        Say ''
        Say '  Building the console...' 'Cyan'
        if (-not (Test-Path -LiteralPath 'frontend\node_modules')) {
            npm --prefix frontend install
            if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
        }
        npm --prefix frontend run build
        if ($LASTEXITCODE -ne 0) { throw 'The frontend build failed.' }
        Say '  Build complete.' 'Green'
    }

    Say ''
    Say '  Done. Start with:  powershell -ExecutionPolicy Bypass -File .\start.ps1' 'Green'
}
catch {
    Say ''
    Say "  ERROR: $($_.Exception.Message)" 'Red'
    exit 1
}
finally {
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
