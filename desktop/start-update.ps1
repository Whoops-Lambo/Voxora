param([Parameter(Mandatory=$true)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
try {
  # Start-Process creates an independent Windows process with its own hidden
  # console. Neither Node's DETACHED_PROCESS flag nor the GUI's console/job
  # lifetime should control the installer helper after readiness.
  $powershell = Join-Path $PSHOME 'powershell.exe'
  $arguments = @('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $config.helperScript + '"'), '-ConfigPath', ('"' + $ConfigPath + '"'))
  Start-Process -FilePath $powershell -ArgumentList $arguments -WorkingDirectory ([IO.Path]::GetDirectoryName($ConfigPath)) -WindowStyle Hidden -PassThru | Out-Null
} catch {
  $failure = @{ nonce = $config.nonce; ready = $false; error = $_.Exception.Message }
  [IO.File]::WriteAllText($config.readyPath, ($failure | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
  throw
}
