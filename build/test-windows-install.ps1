param([Parameter(Mandatory=$true)][string]$InstallerPath, [Parameter(Mandatory=$true)][string]$ExpectedVersion, [string]$PreviousInstallerPath)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:OS -ne 'Windows_NT') { throw 'Run this smoke test only on an isolated GitHub Actions Windows runner.' }
$target = Join-Path $env:RUNNER_TEMP ("Voxora Zoë 日本 [install] & test's " + [Guid]::NewGuid().ToString())
$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$asar = Join-Path $target 'resources/app.asar'
$receipt = Join-Path $target 'resources/voxora-release.json'
$userDirectory = Join-Path $env:APPDATA 'Voxora'
$startupPath = Join-Path $userDirectory 'updates/desktop-started.json'
$configPath = Join-Path $userDirectory 'connection.json'
$privateState = Join-Path $userDirectory 'chat-data/state.json'
$appProcess = $null
$sharedProcess = $null
function Install-Voxora {
  $process = Start-Process -FilePath $installer -ArgumentList @('/S', ('/D=' + $target)) -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw ('Production installer failed: ' + $process.ExitCode) }
  $inventory = Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
  if ($inventory.version -ne $ExpectedVersion) { throw 'Installed version receipt does not match.' }
  if (-not $inventory.files -or -not ($inventory.files | Where-Object path -eq 'Voxora.exe')) { throw 'The installed payload has no complete file inventory.' }
  $root = [IO.Path]::GetFullPath($target).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  foreach ($file in $inventory.files) {
    $full = [IO.Path]::GetFullPath((Join-Path $target $file.path))
    if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe installed inventory path.' }
    if (-not [IO.File]::Exists($full) -or (Get-Item -LiteralPath $full).Length -ne $file.size -or (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw ('Installed payload mismatch: ' + $file.path) }
  }
  Write-Output ('Verified ' + $inventory.files.Count + ' installed payload hashes.')
}
function Stop-TestProcess($Process) {
  if ($Process -and -not $Process.HasExited) {
    & taskkill /PID $Process.Id /T /F | Out-Null
    if (-not $Process.WaitForExit(15000)) { throw 'Test process did not stop.' }
  }
}
function Wait-Startup($Process, [string]$Nonce, [string]$Phase) {
  for ($attempt = 0; $attempt -lt 300; $attempt++) {
    if ($Process.HasExited) { throw 'Installed desktop exited during startup.' }
    if (Test-Path -LiteralPath $startupPath) {
      try {
        $startup = Get-Content -LiteralPath $startupPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($startup.nonce -eq $Nonce -and $startup.version -eq $ExpectedVersion -and $startup.pid -eq $Process.Id -and $startup.phase -eq $Phase) { return }
      } catch {}
    }
    Start-Sleep -Milliseconds 250
  }
  throw ('Installed desktop did not confirm ' + $Phase + ' startup.')
}
function Assert-NoPrivateServer {
  $client = New-Object Net.Sockets.TcpClient
  try {
    try { $task = $client.ConnectAsync('127.0.0.1', 43127); $null = $task.Wait(700) } catch {}
    if ($client.Connected) { throw 'A shared client unexpectedly started a private backend.' }
  } finally { $client.Dispose() }
}
try {
  if ((Test-Path -LiteralPath $configPath) -or (Test-Path -LiteralPath $privateState)) { throw 'The test requires a clean, isolated CI user profile.' }
  Install-Voxora
  $hash = (Get-FileHash -LiteralPath $asar -Algorithm SHA256).Hash
  $keep = Join-Path $target 'keep-user-file.txt'
  [IO.File]::WriteAllText($keep, 'User data must be preserved')
  Write-Output 'Production fresh installation passed.'
  $nonce = [Guid]::NewGuid().ToString()
  $debugPort = Get-Random -Minimum 40000 -Maximum 44000
  $appProcess = Start-Process -FilePath (Join-Path $target 'Voxora.exe') -ArgumentList @('--disable-gpu', ('--remote-debugging-port=' + $debugPort), ('--voxora-update=' + $nonce)) -PassThru
  Wait-Startup $appProcess $nonce 'connected'
  Assert-NoPrivateServer
  if (Test-Path -LiteralPath $privateState) { throw 'Public startup created a private platform.' }
  $publicOrigin = (Get-Content desktop/platform.json -Raw | ConvertFrom-Json).defaultServer
  $publicConnection = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  if ($publicConnection.mode -ne 'remote' -or $publicConnection.server -ne $publicOrigin -or -not $publicConnection.instanceId) { throw 'Fresh startup did not save the verified public connection.' }
  node ./build/test-desktop-page.mjs $debugPort public
  if ($LASTEXITCODE -ne 0) { throw 'The public sign-in page failed its real desktop check.' }
  Stop-TestProcess $appProcess; $appProcess = $null
  Remove-Item -LiteralPath $configPath
  $nonce = [Guid]::NewGuid().ToString()
  $appProcess = Start-Process -FilePath (Join-Path $target 'Voxora.exe') -ArgumentList @('--disable-gpu', '--voxora-connection-setup', ('--remote-debugging-port=' + $debugPort), ('--voxora-update=' + $nonce)) -PassThru
  Wait-Startup $appProcess $nonce 'setup'
  Assert-NoPrivateServer
  if (Test-Path -LiteralPath $privateState) { throw 'First launch created an implicit private platform.' }
  Write-Output 'Explicit connection setup opens without creating a private backend or owner.'
  node ./build/test-desktop-page.mjs $debugPort
  if ($LASTEXITCODE -ne 0) { throw 'The installed connection screen failed its real UI check.' }
  Wait-Startup $appProcess $nonce 'connected'
  $privateInfo = Invoke-RestMethod -Uri 'http://127.0.0.1:43127/api/info' -TimeoutSec 5
  if (-not $privateInfo.privateWorkspace) { throw 'Private hosting was not labeled as a private workspace.' }
  if (-not $privateInfo.capabilities.profilePictures -or -not $privateInfo.capabilities.customInvites -or -not $privateInfo.capabilities.boostGrants) { throw 'The installed backend did not load picture and custom invite services.' }
  if (-not $privateInfo.capabilities.supportDesk -or -not $privateInfo.capabilities.knowledgeBase -or -not $privateInfo.capabilities.serverSafety) { throw 'The installed backend did not load Community Care.' }
  Stop-TestProcess $appProcess; $appProcess = $null
  $privateHash = (Get-FileHash -LiteralPath $privateState -Algorithm SHA256).Hash
  Write-Output 'Explicit private hosting and installed desktop UI startup passed.'
  $sharedPort = Get-Random -Minimum 45000 -Maximum 55000
  $sharedOrigin = 'http://127.0.0.1:' + $sharedPort
  $sharedData = Join-Path $env:RUNNER_TEMP ('voxora-shared-' + [Guid]::NewGuid().ToString())
  $sharedProcess = Start-Process -FilePath (Get-Command node).Source -WorkingDirectory (Get-Location).Path -ArgumentList 'server.js' -Environment @{PORT=[string]$sharedPort;VOXORA_HOST='127.0.0.1';VOXORA_DATA_DIR=$sharedData} -PassThru
  $sharedInfo = $null
  for ($attempt=0; $attempt -lt 100; $attempt++) {
    try { $sharedInfo = Invoke-RestMethod -Uri ($sharedOrigin + '/api/info') -TimeoutSec 1; break } catch {}
    if ($sharedProcess.HasExited) { throw 'The shared test backend exited.' }
    Start-Sleep -Milliseconds 200
  }
  if (-not $sharedInfo -or $sharedInfo.privateWorkspace) { throw 'The shared test backend did not become available.' }
  $owner = Invoke-RestMethod -Uri ($sharedOrigin + '/api/auth/register') -Method Post -ContentType 'application/json' -Body (@{username='native_shared_owner';password='Synthetic-password-738';displayName='Native Owner'} | ConvertTo-Json)
  $member = Invoke-RestMethod -Uri ($sharedOrigin + '/api/auth/register') -Method Post -ContentType 'application/json' -Body (@{username='native_shared_member';password='Synthetic-password-738';displayName='Native Member'} | ConvertTo-Json)
  if (-not $owner.platform.owner -or $member.platform.owner -or $member.platform.permissions.Count -ne 0) { throw 'Shared platform ownership is not exclusive to its first account.' }
  if (($member.servers | Where-Object id -eq 'community').members.Count -ne 2) { throw 'Shared accounts do not see the same community membership.' }
  [IO.File]::WriteAllText($configPath, (@{mode='remote';server=$sharedOrigin;instanceId=$sharedInfo.instanceId} | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
  $nonce = [Guid]::NewGuid().ToString()
  $appProcess = Start-Process -FilePath (Join-Path $target 'Voxora.exe') -ArgumentList @('--disable-gpu', ('--voxora-update=' + $nonce)) -PassThru
  Wait-Startup $appProcess $nonce 'connected'
  Assert-NoPrivateServer
  if ((Get-FileHash -LiteralPath $privateState -Algorithm SHA256).Hash -ne $privateHash) { throw 'Connecting to the shared platform changed private account data.' }
  Stop-TestProcess $appProcess; $appProcess = $null
  Write-Output 'Installed desktop connected to the shared backend without creating another local platform.'
  node ./build/test-windows-update.mjs $installer (Join-Path $target 'Voxora.exe') $ExpectedVersion
  if ($LASTEXITCODE -ne 0) { throw 'The real production updater cycle failed.' }
  if ($PreviousInstallerPath) {
    node ./build/test-windows-upgrade.mjs (Resolve-Path -LiteralPath $PreviousInstallerPath).Path $installer (Join-Path $target 'Voxora.exe') $ExpectedVersion
    if ($LASTEXITCODE -ne 0) { throw 'The published 3.2.1 updater failed the real upgrade.' }
  }
  if ((Get-FileHash -LiteralPath $privateState -Algorithm SHA256).Hash -ne $privateHash) { throw 'Updating the desktop changed private account data.' }
  Install-Voxora
  if ((Get-FileHash -LiteralPath $asar -Algorithm SHA256).Hash -ne $hash) { throw 'Application archive changed during reinstallation.' }
  if ([IO.File]::ReadAllText($keep) -ne 'User data must be preserved') { throw 'Reinstallation modified an unrelated user file.' }
  Write-Output 'Production reinstallation and user-file preservation passed.'
  $uninstall = Start-Process -FilePath (Join-Path $target 'Uninstall Voxora.exe') -ArgumentList '/S' -Wait -PassThru
  if ($uninstall.ExitCode -ne 0) { throw ('Uninstall failed: ' + $uninstall.ExitCode) }
  for ($attempt=0; $attempt -lt 100 -and (Test-Path -LiteralPath $asar); $attempt++) { Start-Sleep -Milliseconds 100 }
  if (Test-Path -LiteralPath $asar) { throw 'Uninstaller left application files behind.' }
  if ([IO.File]::ReadAllText($keep) -ne 'User data must be preserved') { throw 'Uninstall modified an unrelated user file.' }
  if (-not (Test-Path -LiteralPath $privateState) -or -not (Test-Path -LiteralPath $configPath)) { throw 'Uninstall removed account data or the shared connection.' }
  Write-Output 'Production uninstall preserves private account data and the shared connection.'
} finally {
  try { Stop-TestProcess $appProcess } catch { Write-Warning $_.Exception.Message }
  try { Stop-TestProcess $sharedProcess } catch { Write-Warning $_.Exception.Message }
}
