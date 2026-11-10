Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$cloudflared = Join-Path $projectRoot '.runtime\cloudflared.exe'
$runtimeDir = Join-Path $projectRoot '.runtime'
$stdoutLog = Join-Path $runtimeDir 'cloudflared.stdout.log'
$stderrLog = Join-Path $runtimeDir 'cloudflared.stderr.log'

if (-not (Test-Path -LiteralPath $cloudflared)) {
    throw "cloudflared is missing: $cloudflared"
}

$frontend = Invoke-WebRequest -Uri 'http://127.0.0.1:5180/' -UseBasicParsing -TimeoutSec 5
if ($frontend.StatusCode -ne 200) {
    throw "WeeWare frontend on port 5180 returned HTTP $($frontend.StatusCode)."
}

$api = Invoke-WebRequest -Uri 'http://127.0.0.1:5180/api/health' -UseBasicParsing -TimeoutSec 5
if ($api.StatusCode -ne 200) {
    throw "WeeWare API health check returned HTTP $($api.StatusCode)."
}

$existing = Get-Process -Name cloudflared -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) {
    throw "cloudflared is already running (PID $($existing.Id)); stop it before starting another quick tunnel."
}

Remove-Item -LiteralPath $stdoutLog, $stderrLog -Force -ErrorAction SilentlyContinue
$process = Start-Process -FilePath $cloudflared `
    -ArgumentList @('tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', 'http://127.0.0.1:5180') `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog

$deadline = (Get-Date).AddSeconds(45)
$publicUrl = $null
while ((Get-Date) -lt $deadline) {
    if ($process.HasExited) {
        Get-Content -LiteralPath $stdoutLog, $stderrLog -ErrorAction SilentlyContinue
        throw "cloudflared exited with code $($process.ExitCode)."
    }
    $logText = (Get-Content -LiteralPath $stdoutLog, $stderrLog -Raw -ErrorAction SilentlyContinue) -join "`n"
    $match = [regex]::Match($logText, 'https://[a-z-]+\.trycloudflare\.com')
    if ($match.Success) {
        $publicUrl = $match.Value
        break
    }
    Start-Sleep -Seconds 1
}

if (-not $publicUrl) {
    Get-Content -LiteralPath $stdoutLog, $stderrLog -Tail 30 -ErrorAction SilentlyContinue
    throw 'cloudflared did not return a Quick Tunnel URL within 45 seconds.'
}

$pageCheck = $null
$apiCheck = $null
$lastCheckError = $null
$verificationDeadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $verificationDeadline) {
    try {
        $pageCheck = Invoke-WebRequest -Uri "$publicUrl/" -UseBasicParsing -TimeoutSec 12
        $apiCheck = Invoke-WebRequest -Uri "$publicUrl/api/health" -UseBasicParsing -TimeoutSec 12
        if ($pageCheck.StatusCode -eq 200 -and $apiCheck.StatusCode -eq 200) { break }
        $lastCheckError = "frontend HTTP $($pageCheck.StatusCode), API HTTP $($apiCheck.StatusCode)"
    }
    catch {
        $lastCheckError = $_.Exception.Message
    }
    Start-Sleep -Seconds 3
}

if (-not $pageCheck -or -not $apiCheck -or $pageCheck.StatusCode -ne 200 -or $apiCheck.StatusCode -ne 200) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw "Public tunnel verification failed: $lastCheckError"
}

Write-Output "Tunnel URL: $publicUrl"
Write-Output "cloudflared PID: $($process.Id)"
Write-Output "Frontend HTTP: $($pageCheck.StatusCode)"
Write-Output "API health HTTP: $($apiCheck.StatusCode)"
