[Setup]
AppId=org.holdem-on-the-clock.desktop
AppName=Hold’em on the Clock
AppVersion={#ReleaseVersion}
AppPublisher=lrrong2020
AppPublisherURL=https://github.com/lrrong2020/holdem-on-the-clock
DefaultDirName={localappdata}\Programs\Holdem on the Clock
DefaultGroupName=Hold’em on the Clock
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
AppMutex=Local\HoldemOnTheClock.Desktop
OutputDir={#ArtifactDir}
OutputBaseFilename=Holdem-on-the-Clock-Windows-x64
UninstallDisplayIcon={app}\HoldemOnTheClock.exe
DisableProgramGroupPage=yes
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Hold’em on the Clock"; Filename: "{app}\HoldemOnTheClock.exe"; WorkingDir: "{app}"
Name: "{userdesktop}\Hold’em on the Clock"; Filename: "{app}\HoldemOnTheClock.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Run]
Filename: "{app}\HoldemOnTheClock.exe"; Description: "{cm:LaunchProgram,Hold’em on the Clock}"; Flags: nowait postinstall skipifsilent
