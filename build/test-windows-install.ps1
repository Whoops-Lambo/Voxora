param([Parameter(Mandatory=$true)][string]$InstallerPath, [Parameter(Mandatory=$true)][string]$ExpectedVersion)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:OS -ne 'Windows_NT') { throw 'Run this smoke test only on an isolated GitHub Actions Windows runner.' }
$target = Join-Path $env:RUNNER_TEMP ("Voxora Zoë 日本 [install] & test's " + [Guid]::NewGuid().ToString())
$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$asar = Join-Path $target 'resources/app.asar'
$receipt = Join-Path $target 'resources/voxora-release.json'
$appProcess = $null
function Install-Voxora {
  $process = Start-Process -FilePath $installer -ArgumentList @('/S', ('/D=' + $target)) -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw ('Production installer failed: ' + $process.ExitCode) }
  if ((Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json).version -ne $ExpectedVersion) { throw 'Installed version receipt does not match.' }
}
try {
  Install-Voxora
  $hash = (Get-FileHash -LiteralPath $asar -Algorithm SHA256).Hash
  $keep = Join-Path $target 'keep-user-file.txt'
  [IO.File]::WriteAllText($keep, 'User data must be preserved')
  Write-Output 'Production fresh installation passed.'
  $appProcess = Start-Process -FilePath (Join-Path $target 'Voxora.exe') -ArgumentList '--disable-gpu' -PassThru
  $ready = $false
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    try {
      $response = Invoke-WebRequest -Uri 'http://127.0.0.1:43127/api/info' -TimeoutSec 2
      if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
    if ($appProcess.HasExited) { throw 'Installed desktop exited during startup.' }
    Start-Sleep -Milliseconds 250
  }
  if (-not $ready) { throw 'Installed desktop did not start its bundled backend.' }
  Write-Output 'Installed Electron app and bundled backend started.'
  & taskkill /PID $appProcess.Id /T /F
  $appProcess.WaitForExit()
  $appProcess = $null
  Install-Voxora
  if ((Get-FileHash -LiteralPath $asar -Algorithm SHA256).Hash -ne $hash) { throw 'Application archive changed during reinstallation.' }
  if ([IO.File]::ReadAllText($keep) -ne 'User data must be preserved') { throw 'Reinstallation modified an unrelated user file.' }
  Write-Output 'Production reinstallation and user-file preservation passed.'
  $uninstall = Start-Process -FilePath (Join-Path $target 'Uninstall Voxora.exe') -ArgumentList '/S' -Wait -PassThru
  if ($uninstall.ExitCode -ne 0) { throw ('Uninstall failed: ' + $uninstall.ExitCode) }
  for ($attempt = 0; $attempt -lt 100 -and (Test-Path -LiteralPath $asar); $attempt++) { Start-Sleep -Milliseconds 100 }
  if (Test-Path -LiteralPath $asar) { throw 'Uninstaller left application files behind.' }
  if ([IO.File]::ReadAllText($keep) -ne 'User data must be preserved') { throw 'Uninstall modified an unrelated user file.' }
  Write-Output 'Production uninstall and user-file preservation passed.'
} finally {
  if ($appProcess -and -not $appProcess.HasExited) { & taskkill /PID $appProcess.Id /T /F }
}
