$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$frontendRoot = Join-Path $projectRoot 'frontend'
$viteCli = Join-Path $projectRoot 'node_modules\vite\bin\vite.js'
$stdoutLog = Join-Path $projectRoot '.runtime\frontend-current.log'
$stderrLog = Join-Path $projectRoot '.runtime\frontend-current-error.log'

if (Get-NetTCPConnection -State Listen -LocalPort 5180 -ErrorAction SilentlyContinue) {
    throw 'Port 5180 is already in use.'
}
if (-not (Test-Path -LiteralPath $viteCli)) {
    throw "Vite CLI not found: $viteCli"
}

$node = (Get-Command node.exe).Source
$process = Start-Process -FilePath $node `
    -ArgumentList @($viteCli, '--host', '127.0.0.1', '--port', '5180', '--strictPort') `
    -WorkingDirectory $frontendRoot -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog

$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
    if ($process.HasExited) {
        Get-Content -LiteralPath $stdoutLog, $stderrLog -ErrorAction SilentlyContinue
        throw "Vite exited with code $($process.ExitCode)."
    }
    if (Get-NetTCPConnection -State Listen -LocalPort 5180 -ErrorAction SilentlyContinue) {
        $page = Invoke-WebRequest -Uri 'http://127.0.0.1:5180/' -UseBasicParsing -TimeoutSec 5
        if ($page.StatusCode -eq 200) {
            Write-Output "Frontend started. PID: $($process.Id); URL: http://localhost:5180"
            exit 0
        }
    }
    Start-Sleep -Seconds 1
}

Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
Get-Content -LiteralPath $stdoutLog, $stderrLog -Tail 30 -ErrorAction SilentlyContinue
throw 'Frontend did not respond on port 5180 within 30 seconds.'
