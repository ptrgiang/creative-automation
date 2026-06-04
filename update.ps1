$ErrorActionPreference = 'Stop'

$RepoUrl = 'https://github.com/ptrgiang/creative-automation/archive/refs/heads/main.zip'
$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$TempRoot = Join-Path $env:TEMP ("creative-automation-update-" + [guid]::NewGuid().ToString('N'))
$ZipPath = Join-Path $TempRoot 'creative-automation-main.zip'
$ExtractDir = Join-Path $TempRoot 'extract'
$BackupDir = Join-Path $TempRoot 'backup'

function Write-Step($Message) {
  Write-Host "==> $Message" -ForegroundColor Cyan
}

try {
  New-Item -ItemType Directory -Path $TempRoot, $ExtractDir, $BackupDir -Force | Out-Null

  Write-Step "Backing up current extension folder"
  Copy-Item -Path (Join-Path $AppDir '*') -Destination $BackupDir -Recurse -Force -ErrorAction SilentlyContinue

  Write-Step "Downloading latest Creative Automation"
  Invoke-WebRequest -Uri $RepoUrl -OutFile $ZipPath

  Write-Step "Extracting update"
  Expand-Archive -Path $ZipPath -DestinationPath $ExtractDir -Force
  $SourceDir = Join-Path $ExtractDir 'creative-automation-main'
  if (-not (Test-Path $SourceDir)) {
    throw "Update package did not contain the expected folder: $SourceDir"
  }

  Write-Step "Copying latest files"
  Copy-Item -Path (Join-Path $SourceDir '*') -Destination $AppDir -Recurse -Force

  Write-Host 'Creative Automation is up to date.' -ForegroundColor Green
  Write-Host "Backup saved at: $BackupDir"
  Write-Host 'Open chrome://extensions and click the reload icon for Creative Automation.'
} catch {
  Write-Host 'Update failed.' -ForegroundColor Red
  Write-Host "Backup is available at: $BackupDir" -ForegroundColor Yellow
  throw
}
