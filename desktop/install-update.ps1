param([Parameter(Mandatory=$true)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
$config = $null
$parentExited = $false
$success = $false
$message = ''

function Write-UpdateLog([string]$Text) {
  $line = [DateTime]::UtcNow.ToString('o') + ' ' + $Text
  Write-Output $line
  if ($config) { try { Add-Content -LiteralPath $config.logPath -Value $line -Encoding UTF8 } catch { Write-Output $_.Exception.Message } }
}
function Write-UpdateJson([string]$Destination, $Value) {
  $temporary = $Destination + '.tmp'
  [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporary -Destination $Destination -Force
}
function Assert-NotCancelled {
  if (Test-Path -LiteralPath $config.cancelPath) { throw 'The update was cancelled before Voxora closed.' }
}

try {
  # Explicit encoding also handles Windows usernames outside the active ANSI code page.
  $config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  Write-UpdateLog ('Preparing update ' + $config.version)
  Assert-NotCancelled
  if ((Get-Item -LiteralPath $config.installer).Length -ne $config.size -or (Get-FileHash -LiteralPath $config.installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $config.sha256) { throw 'Installer verification failed. Download the update again.' }
  if (-not (Test-Path -LiteralPath $config.appExe -PathType Leaf)) { throw 'The installed Voxora executable could not be found.' }
  $probe = Join-Path $config.installDir ('.voxora-update-' + $config.nonce)
  [IO.File]::WriteAllText($probe, 'write check')
  Remove-Item -LiteralPath $probe -Force
  Assert-NotCancelled
  Write-UpdateLog 'Verified installer and installation access; waiting for Voxora to close.'
  Write-UpdateJson $config.readyPath @{ nonce = $config.nonce; ready = $true }

  $deadline = [DateTime]::UtcNow.AddSeconds(120)
  $running = Get-Process -Id $config.pid -ErrorAction SilentlyContinue
  while ($running -and -not $running.WaitForExit(250)) {
    Assert-NotCancelled
    if ([DateTime]::UtcNow -gt $deadline) { throw 'Voxora did not close; the update was not installed.' }
  }
  Assert-NotCancelled
  $parentExited = $true
  # Chromium children can hold the executable/ASAR briefly after the main process exits.
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  foreach ($file in @($config.appExe, (Join-Path $config.installDir 'resources/app.asar'))) {
    if (-not (Test-Path -LiteralPath $file)) { continue }
    while ($true) {
      try { $handle = [IO.File]::Open($file, 'Open', 'ReadWrite', 'None'); $handle.Dispose(); break }
      catch { if ([DateTime]::UtcNow -gt $deadline) { throw 'Voxora files are still in use. Close other Voxora windows and retry.' }; Start-Sleep -Milliseconds 250 }
    }
  }
  # Verify again after shutdown: nothing unverified may reach Start-Process.
  if ((Get-Item -LiteralPath $config.installer).Length -ne $config.size -or (Get-FileHash -LiteralPath $config.installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $config.sha256) { throw 'Installer verification failed after shutdown.' }
  Write-UpdateLog 'Installing update.'
  # NSIS requires /D= last and unquoted, including when the directory contains spaces.
  $installed = Start-Process -FilePath $config.installer -ArgumentList @('/S', ('/D=' + $config.installDir)) -Wait -PassThru
  if ($installed.ExitCode -ne 0) { throw ('Installer exited with code ' + $installed.ExitCode) }
  $receipt = Get-Content -LiteralPath (Join-Path $config.installDir 'resources/voxora-release.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($receipt.version -ne $config.version) { throw 'The installer did not install the requested Voxora version.' }
  $success = $true
  Write-UpdateLog 'Installation finished; reopening Voxora.'
} catch {
  $message = $_.Exception.Message
  Write-UpdateLog ('Update failed: ' + $message)
  if ($config -and -not $parentExited) {
    Write-UpdateJson $config.readyPath @{ nonce = $config.nonce; ready = $false; error = $message }
  }
}

if ($config) {
  try {
    Write-UpdateJson $config.resultPath @{ version = $config.version; success = $success; message = $message }
    if ($parentExited) {
      Remove-Item -LiteralPath $config.startupPath -Force -ErrorAction SilentlyContinue
      $reopened = Start-Process -FilePath $config.appExe -WorkingDirectory $config.installDir -ArgumentList @('--voxora-update=' + $config.nonce) -PassThru
      $deadline = [DateTime]::UtcNow.AddSeconds(45)
      $started = $false
      while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-Path -LiteralPath $config.startupPath) {
          try {
            $startup = Get-Content -LiteralPath $config.startupPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($startup.nonce -eq $config.nonce) {
              if ($success -and $startup.version -ne $config.version) { throw 'Voxora restarted with the previous version.' }
              $started = $true
              break
            }
          } catch { if ($_.Exception.Message -eq 'Voxora restarted with the previous version.') { throw } }
        }
        if ($reopened.HasExited) { throw 'Voxora closed before confirming that it restarted.' }
        Start-Sleep -Milliseconds 200
      }
      if (-not $started) { throw 'Voxora did not confirm startup within 45 seconds.' }
      Write-UpdateLog ('Voxora startup confirmed: ' + $startup.version)
    }
  } catch {
    $message = ($message + ' ' + $_.Exception.Message).Trim()
    Write-UpdateLog ('Recovery needs attention: ' + $message)
    Write-UpdateJson $config.resultPath @{ version = $config.version; success = $false; message = $message }
    # Keep a visible recovery path even if the application cannot reopen.
    if ($env:OS -eq 'Windows_NT') {
      try {
        $popup = New-Object -ComObject WScript.Shell
        $null = $popup.Popup(('Voxora could not finish updating. ' + $message + "`n`nRun the latest Voxora installer manually. Your chat data is preserved.`n`nLog: " + $config.logPath), 0, 'Voxora update needs attention', 16)
      } catch {}
    }
  } finally {
    foreach ($file in @($ConfigPath, $config.readyPath, $config.cancelPath)) { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
  }
}
