$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not (Test-Path (Join-Path $root 'backend\.env'))) { throw 'Run scripts/setup.ps1 first and configure backend/.env.' }
$mongo = Get-Content (Join-Path $root 'backend\.env') | Where-Object { $_ -match '^MONGODB_URI=' } | Select-Object -First 1
if (-not $mongo -or $mongo -match '127\.0\.0\.1|localhost') {
  $port = 27017
  if (-not (Test-NetConnection 127.0.0.1 -Port $port -InformationLevel Quiet)) {
    $mongod = Join-Path $root '.runtime\mongodb\bin\mongod.exe'
    if (-not (Test-Path $mongod)) { throw 'MongoDB is not listening and the local MongoDB runtime is missing. Install MongoDB or configure MONGODB_URI in backend/.env.' }
    $data = Join-Path $root '.runtime\mongodb\data'
    $log = Join-Path $root '.runtime\mongodb\mongod.log'
    New-Item -ItemType Directory -Force -Path $data | Out-Null
    Start-Process -FilePath $mongod -ArgumentList @('--dbpath', $data, '--bind_ip', '127.0.0.1', '--port', $port, '--logpath', $log, '--logappend') -WorkingDirectory (Split-Path $mongod) -WindowStyle Hidden | Out-Null
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      if (Test-NetConnection 127.0.0.1 -Port $port -InformationLevel Quiet) { $ready = $true; break }
      Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw 'The local MongoDB process did not start. Check .runtime/mongodb/mongod.log.' }
  }
}
Set-Location $root
npm.cmd run dev

