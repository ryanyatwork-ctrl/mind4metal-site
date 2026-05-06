param(
  [string]$OutDir = "_bridge"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $repoRoot
try {
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $bridgeRoot = Join-Path $repoRoot $OutDir
  $workDir = Join-Path $bridgeRoot "mind4metal-upgrade-$timestamp"
  $changedDir = Join-Path $workDir "changed-files"
  $patchPath = Join-Path $workDir "mind4metal-upgrade.patch"
  $manifestPath = Join-Path $workDir "manifest.txt"
  $zipPath = Join-Path $bridgeRoot "mind4metal-upgrade-bridge.zip"

  New-Item -ItemType Directory -Force -Path $changedDir | Out-Null

  git diff --binary > $patchPath
  $trackedChanged = git diff --name-only
  $untrackedChanged = git ls-files --others --exclude-standard
  $changed = @($trackedChanged + $untrackedChanged) | Where-Object { $_ } | Sort-Object -Unique

  @(
    "Mind4Metal upgrade bridge",
    "Created: $(Get-Date -Format o)",
    "Source repo: $repoRoot",
    "",
    "Patch file covers tracked-file edits. New files are included in changed-files.",
    "",
    "Changed files:",
    $changed
  ) | Set-Content -Path $manifestPath -Encoding UTF8

  foreach ($file in $changed) {
    $src = Join-Path $repoRoot $file
    if (-not (Test-Path -LiteralPath $src)) { continue }
    $dest = Join-Path $changedDir $file
    New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null
    Copy-Item -LiteralPath $src -Destination $dest -Force
  }

  if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }
  Compress-Archive -Path (Join-Path $workDir "*") -DestinationPath $zipPath -Force

  Write-Host "Bridge bundle created:"
  Write-Host $zipPath
}
finally {
  Pop-Location
}
