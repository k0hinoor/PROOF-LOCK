# ProofLock launcher for Windows PowerShell.
#
# First run: creates .venv, installs packages, builds the console.
# Later runs: rebuilds the console and starts the server.
#
# Usage (from the repository folder):
#   powershell -ExecutionPolicy Bypass -File .\start.ps1
#
# Keep this window open while you use the dashboard. Ctrl+C stops the server.

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Say($text, $colour = 'Gray') { Write-Host $text -ForegroundColor $colour }

Say ''
Say '  ProofLock - local machine console' 'Cyan'
Say '  =================================' 'DarkGray'
Say ''

# ---------------------------------------------------------------- 1-2 Python
$python = Join-Path '.venv' 'Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) {
    Say '[1/4] Creating the Python environment (one time only)...'
    $created = $false
    foreach ($launcher in @('py', 'python')) {
        if (Get-Command $launcher -ErrorAction SilentlyContinue) {
            if ($launcher -eq 'py') { & py -3 -m venv .venv } else { & python -m venv .venv }
            if (Test-Path -LiteralPath $python) { $created = $true; break }
        }
    }
    if (-not $created) {
        Say ''
        Say '  ERROR: Python 3.11+ was not found.' 'Red'
        Say '  Install it from https://www.python.org/downloads/ and tick'
        Say '  "Add python.exe to PATH", then run this script again.'
        exit 1
    }
    Say '[2/4] Installing backend packages...'
    & $python -m pip install --upgrade pip --quiet
    & $python -m pip install -r backend\requirements.txt
    if ($LASTEXITCODE -ne 0) {
        Say ''
        Say '  ERROR: Could not install the Python packages. Check the internet connection.' 'Red'
        exit 1
    }
} else {
    Say '[1/4] Python environment found.'
    Say '[2/4] Backend packages already installed.'
}

# ---------------------------------------------------------------- 3 Frontend
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Say ''
    Say '  ERROR: Node.js 22 was not found. Install the LTS version from https://nodejs.org/' 'Red'
    exit 1
}
if (-not (Test-Path -LiteralPath 'frontend\node_modules')) {
    Say '[3/4] Installing frontend packages (one time only, may take a minute)...'
    npm --prefix frontend ci
    if ($LASTEXITCODE -ne 0) {
        Say ''
        Say '  ERROR: npm install failed. Check the internet connection.' 'Red'
        exit 1
    }
} else {
    Say '[3/4] Frontend packages found.'
}

# ---------------------------------------------------------------- 4 Build
Say '[4/4] Building the console...'
npm --prefix frontend run build
if ($LASTEXITCODE -ne 0) {
    Say ''
    Say '  ERROR: The frontend build failed. Scroll up for the TypeScript error.' 'Red'
    exit 1
}

# ---------------------------------------------------------------- Operators
if (-not (Test-Path -LiteralPath 'config\operators.json')) {
    Copy-Item -LiteralPath 'config\operators.example.json' -Destination 'config\operators.json'
    Say ''
    Say '  NOTE: config\operators.json was created from the example file.' 'Yellow'
    Say '        Edit it to match the OP-nn references in your Arduino sketch.' 'Yellow'
}

# ---------------------------------------------------------------- Serve
Say ''
Say '  ===============================================' 'DarkGray'
Say '   Starting on http://127.0.0.1:8000' 'Green'
Say '   Keep this window open. Press Ctrl+C to stop.' 'Green'
Say '  ===============================================' 'DarkGray'
Say ''

Start-Process 'http://127.0.0.1:8000' -ErrorAction SilentlyContinue

# One worker only: the serial port and the login session live in this process.
& $python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000

Say ''
Say '  The console has stopped.' 'DarkGray'
