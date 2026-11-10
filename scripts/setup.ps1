$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root

if (-not (Test-Path 'backend\.env')) {
  Copy-Item 'backend\.env.example' 'backend\.env'
  Write-Host 'Created backend/.env. Set a private JWT_SECRET and MongoDB URI before production use.'
}

npm install
$venv = Join-Path $root 'ml-service\.venv'
if (-not (Test-Path $venv)) { python -m venv $venv }
$python = Join-Path $venv 'Scripts\python.exe'
& $python -m pip install --upgrade pip
& $python -m pip install -r 'ml-service\requirements.txt'
Write-Host 'Setup complete. Ensure MongoDB is running, then run: npm run dev'

