$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $repoRoot '.runtime'
$mavenRoot = Join-Path $runtimeRoot 'apache-maven-3.9.9'
$maven = Get-Command mvn.cmd -ErrorAction SilentlyContinue

if ($maven) {
  $mavenCommand = $maven.Source
} else {
  $mavenCommand = Join-Path $mavenRoot 'bin/mvn.cmd'
  if (!(Test-Path $mavenCommand)) {
    New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
    $archive = Join-Path $runtimeRoot 'apache-maven-3.9.9-bin.zip'
    Invoke-WebRequest -Uri 'https://archive.apache.org/dist/maven/maven-3/3.9.9/binaries/apache-maven-3.9.9-bin.zip' -OutFile $archive
    Expand-Archive -Path $archive -DestinationPath $runtimeRoot -Force
  }
}

$wekaLib = Join-Path $repoRoot 'ml-service/.cache/weka'
New-Item -ItemType Directory -Force -Path $wekaLib | Out-Null
$pom = Join-Path $repoRoot 'ml-service/weka-pom.xml'
& $mavenCommand -B -f $pom org.apache.maven.plugins:maven-dependency-plugin:3.7.1:copy-dependencies "-DincludeScope=runtime" "-DoutputDirectory=$wekaLib"
if ($LASTEXITCODE -ne 0) { throw 'Could not install the pinned Weka runtime dependencies.' }
Write-Output "Weka runtime installed in $wekaLib. Restart the ML service to enable the researcher dashboard integration."
