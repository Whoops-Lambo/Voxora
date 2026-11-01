param([string]$ScriptPath, [string]$ConfigPath)
$ErrorActionPreference = 'Stop'
$script:FixtureConfig = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
# Only replace Windows executable launches. The actual helper performs its file IO,
# hashing, UTF-8 parsing, process waiting, handshakes and recovery in PowerShell.
function Start-FixtureProcess {
  param([string]$FilePath, [string]$Arguments, [string]$WorkingDirectory, [bool]$Wait)
  if ($FilePath -eq $script:FixtureConfig.installer) {
    if ($Arguments -ne ('/S /D=' + $script:FixtureConfig.installDir)) { throw 'Invalid silent installer arguments' }
    $ArgumentList = @('/S', $Arguments.Substring(3))
    [IO.File]::WriteAllText((Join-Path $script:FixtureConfig.installDir 'installer-arguments.json'), ($ArgumentList | ConvertTo-Json))
    $mode = 'install'
  } elseif ($FilePath -eq $script:FixtureConfig.appExe) {
    if ($Arguments -ne ('--voxora-update=' + $script:FixtureConfig.nonce)) { throw 'Missing startup nonce' }
    $mode = 'app'
  } else { throw 'Unexpected executable' }
  $arguments = '"' + $env:VOXORA_TEST_HELPER_PROCESS + '" ' + $mode + ' "' + $ConfigPath + '"'
  $process = Microsoft.PowerShell.Management\Start-Process -FilePath $env:VOXORA_TEST_NODE -ArgumentList $arguments -PassThru
  if ($Wait) { $process.WaitForExit() }
  return $process
}
. $ScriptPath -ConfigPath $ConfigPath -ProcessLauncher { param($FileName, $Arguments, $Directory, $Wait) Start-FixtureProcess $FileName $Arguments $Directory $Wait }
