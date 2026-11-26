[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Version,
    [Parameter(Mandatory)][string]$Payload,
    [Parameter(Mandatory)][string]$Output
)
$ErrorActionPreference = 'Stop'
$payloadDir = (Resolve-Path -LiteralPath $Payload).Path
$artifactDir = [IO.Directory]::CreateDirectory($Output).FullName
foreach ($item in 'node.exe','app/desktop.mjs','kernel-worker/kernel-worker.exe') {
    if (!(Test-Path -LiteralPath (Join-Path $payloadDir $item))) { throw "Missing runtime file: $item" }
}
if ($Version -notmatch '^v?\d+\.\d+\.\d+(?:[-+][0-9a-zA-Z.-]+)?$') { throw "Unexpected version: $Version" }

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$launcherExe = Join-Path $payloadDir 'HoldemOnTheClock.exe'
Push-Location -LiteralPath $PSScriptRoot
try {
    & $csc /nologo /noconfig /target:winexe /platform:x64 /optimize+ /codepage:65001 "/out:$launcherExe" /reference:System.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll Launcher.cs
    if ($LASTEXITCODE -ne 0) { throw 'Windows launcher build failed.' }
} finally { Pop-Location }

$iscc = Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6/ISCC.exe'
if (!(Test-Path -LiteralPath $iscc)) {
    $found = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($found) { $iscc = $found.Source }
    elseif ($env:GITHUB_ACTIONS -eq 'true') {
        # Pin the upstream installer to the SHA-256 in Microsoft's winget manifest.
        $tools = Join-Path $env:RUNNER_TEMP 'holdem-inno'
        $setup = Join-Path $env:RUNNER_TEMP 'innosetup-6.7.3.exe'
        $expectedHash = '9c73c3bae7ed48d44112a0f48e66742c00090bdb5bef71d9d3c056c66e97b732'
        Invoke-WebRequest 'https://github.com/jrsoftware/issrc/releases/download/is-6_7_3/innosetup-6.7.3.exe' -OutFile $setup
        if ((Get-FileHash $setup -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Inno Setup checksum mismatch.' }
        $result = Start-Process $setup -ArgumentList "/CURRENTUSER /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DIR=`"$tools`"" -Wait -PassThru
        if ($result.ExitCode -ne 0) { throw "Inno Setup installation failed: $($result.ExitCode)" }
        $iscc = Join-Path $tools 'ISCC.exe'
    } else { throw 'Install Inno Setup 6 or add ISCC.exe to PATH.' }
}
$installerScript = (Get-Item -LiteralPath (Join-Path $PSScriptRoot 'installer.iss')).FullName
& $iscc /Qp "/DReleaseVersion=$($Version.TrimStart('v'))" "/DPayloadDir=$payloadDir" "/DArtifactDir=$artifactDir" $installerScript
if ($LASTEXITCODE -ne 0) { throw 'Windows installer build failed.' }
