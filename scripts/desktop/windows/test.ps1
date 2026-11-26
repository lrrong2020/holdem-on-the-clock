[CmdletBinding()]
param([Parameter(Mandatory)][string]$Installer)
$ErrorActionPreference = 'Stop'
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$testDir = Join-Path ([IO.Path]::GetTempPath()) ("Holdem installation " + [guid]::NewGuid().ToString('N'))
$installDir = Join-Path $testDir '摸鱼德州'
$log = Join-Path $testDir 'launcher-output.txt'
$uninstall = Join-Path $installDir 'unins000.exe'
$null = New-Item -ItemType Directory -Path $testDir
$launcher = $null
try {
    $setup = Start-Process $installerPath -ArgumentList "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DIR=`"$installDir`"" -PassThru -Wait
    if ($setup.ExitCode -ne 0) { throw "Installation failed: $($setup.ExitCode)" }
    $exe = Join-Path $installDir 'HoldemOnTheClock.exe'
    if (!(Test-Path -LiteralPath $exe) -or !(Test-Path -LiteralPath $uninstall)) { throw 'The installer did not create the application.' }

    # Exercise the packaged runtime, including a hand against the actual model.
    & node "$PSScriptRoot/../smoke.mjs" $installDir
    if ($LASTEXITCODE -ne 0) { throw 'Installed runtime smoke test failed.' }

    $launcher = Start-Process $exe -ArgumentList '--no-browser' -RedirectStandardOutput $log -PassThru
    $address = $null
    $deadline = (Get-Date).AddSeconds(45)
    do {
        if ($launcher.HasExited) { throw "Launcher exited before readiness: $($launcher.ExitCode)" }
        $output = Get-Content -LiteralPath $log -Raw -ErrorAction SilentlyContinue
        if ($output -match 'DESKTOP_READY (http://127\.0\.0\.1:\d+)/?') { $address = $Matches[1]; break }
        Start-Sleep -Milliseconds 300
    } while ((Get-Date) -lt $deadline)
    if (!$address) { throw 'The installed Windows launcher did not report readiness.' }
    $state = Invoke-RestMethod "$address/api/address"
    if (!$state.kernelAvailable) { throw 'The Windows launcher could not load the bundled model.' }
    $duplicate = Start-Process $exe -ArgumentList '--no-browser' -PassThru
    if (!$duplicate.WaitForExit(5000) -or $duplicate.ExitCode -ne 0) { throw 'Second launch did not reuse the running application.' }
    if (!$launcher.CloseMainWindow() -or !$launcher.WaitForExit(10000)) { throw 'The launcher did not close normally.' }
    $closed = $false
    for ($i = 0; $i -lt 40; $i++) {
        try { $null = Invoke-RestMethod "$address/api/address" -TimeoutSec 1 }
        catch { $closed = $true; break }
        Start-Sleep -Milliseconds 200
    }
    if (!$closed) { throw 'The table remained open after quitting the Windows app.' }
    Write-Host 'Installed Windows app passed startup, Kernel play, second launch and shutdown.'
} finally {
    if ($launcher -and !$launcher.HasExited) { $launcher.Kill(); $launcher.WaitForExit() }
    if (Test-Path -LiteralPath $uninstall) {
        $result = Start-Process $uninstall -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART' -Wait -PassThru
        if ($result.ExitCode -ne 0) { throw "Uninstall failed: $($result.ExitCode)" }
    }
    if (Test-Path -LiteralPath (Join-Path $installDir 'HoldemOnTheClock.exe')) { throw 'Uninstall left the launcher behind.' }
    Remove-Item -LiteralPath $testDir -Recurse -Force
}
