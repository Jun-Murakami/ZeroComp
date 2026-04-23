; ZeroComp Installer Script for Inno Setup
; Requires Inno Setup 6.3.0 or later (for dark mode support)

#define MyAppName "ZeroComp"
#define MyAppPublisher "Jun Murakami"
#define MyAppURL "https://jun-murakami.web.app"
#define MyAppExeName "ZeroComp.exe"

; Version is read from VERSION file during build
#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif

[Setup]
AppId={{958903A3-15F0-41FA-A06C-E438C7396F46}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
LicenseFile=LICENSE
OutputDir=releases\{#MyAppVersion}
OutputBaseFilename=ZeroComp_{#MyAppVersion}_Windows_Setup
SetupIconFile=cmake\icon.ico
UninstallDisplayIcon={uninstallexe}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern dynamic zircon
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64
DisableDirPage=no
DisableWelcomePage=no
DisableReadyPage=no
DisableFinishedPage=no
ShowLanguageDialog=no
UsePreviousAppDir=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Types]
Name: "full"; Description: "Full installation"
Name: "compact"; Description: "Compact installation"
Name: "custom"; Description: "Custom installation"; Flags: iscustom

[Components]
Name: "standalone"; Description: "Standalone Application"; Types: full custom
Name: "vst3"; Description: "VST3 Plugin"; Types: full compact custom
Name: "aax"; Description: "AAX Plugin (Pro Tools)"; Types: full custom

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Components: standalone; Flags: unchecked
Name: "quicklaunchicon"; Description: "{cm:CreateQuickLaunchIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Components: standalone; Flags: unchecked; OnlyBelowVersion: 6.1

[Files]
; Standalone Application
Source: "build\plugin\ZeroComp_artefacts\Release\Standalone\ZeroComp.exe"; DestDir: "{code:GetStandalonePath}"; Flags: ignoreversion; Components: standalone
Source: "build\plugin\ZeroComp_artefacts\Release\Standalone\*.dll"; DestDir: "{code:GetStandalonePath}"; Flags: ignoreversion skipifsourcedoesntexist; Components: standalone

; VST3 Plugin
Source: "build\plugin\ZeroComp_artefacts\Release\VST3\ZeroComp.vst3\*"; DestDir: "{code:GetVST3Path}\ZeroComp.vst3"; Flags: ignoreversion recursesubdirs createallsubdirs; Components: vst3

; AAX Plugin — バンドル全体を丸ごとコピー（入れ子は PrepareToInstall で事前削除により防止）
Source: "releases\{#MyAppVersion}\Windows\ZeroComp.aaxplugin\*"; DestDir: "{code:GetAAXPath}\ZeroComp.aaxplugin"; Flags: ignoreversion recursesubdirs createallsubdirs; Components: aax


; License and Documentation (install to standalone path if selected, otherwise to program files)
Source: "LICENSE"; DestDir: "{code:GetDocPath}"; Flags: ignoreversion

; Visual C++ Redistributable will be downloaded only if needed

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{code:GetStandalonePath}\{#MyAppExeName}"; Components: standalone
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{code:GetStandalonePath}\{#MyAppExeName}"; Tasks: desktopicon; Components: standalone
Name: "{userappdata}\Microsoft\Internet Explorer\Quick Launch\{#MyAppName}"; Filename: "{code:GetStandalonePath}\{#MyAppExeName}"; Tasks: quicklaunchicon; Components: standalone

[Run]
; Install Visual C++ Redistributable only if needed
Filename: "{tmp}\vc_redist.x64.exe"; Parameters: "/quiet /norestart"; StatusMsg: "Installing Microsoft Visual C++ Redistributables..."; Check: NeedsVCRedist; Flags: waituntilterminated

; Optionally run the standalone app after installation (disabled)
; Filename: "{code:GetStandalonePath}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent; Components: standalone

[UninstallDelete]
; Clean up any generated files
Type: filesandordirs; Name: "{code:GetStandalonePath}\logs"
Type: filesandordirs; Name: "{code:GetStandalonePath}\presets"
Type: filesandordirs; Name: "{localappdata}\ZeroComp"
Type: filesandordirs; Name: "{userappdata}\ZeroComp"

[Registry]
; Register VST3 plugin location
Root: HKLM64; Subkey: "Software\VST3"; ValueType: string; ValueName: "ZeroComp"; ValueData: "{code:GetVST3Path}\ZeroComp.vst3"; Flags: uninsdeletevalue; Components: vst3

; Register AAX plugin location
Root: HKLM64; Subkey: "Software\Avid\ProTools\AAX"; ValueType: string; ValueName: "ZeroComp"; ValueData: "{code:GetAAXPath}\ZeroComp.aaxplugin"; Flags: uninsdeletevalue; Components: aax

[Code]
var
  DownloadPage: TDownloadWizardPage;
  VCRedistNeeded: Boolean;
  PathSelectionPage: TInputDirWizardPage;
  StandalonePath: String;
  VST3Path: String;
  AAXPath: String;

function NeedsVCRedist(): Boolean;
var
  Version: String;
begin
  // Check for Visual C++ 2019-2022 Redistributable (14.30 or higher)
  // These versions share the same registry keys
  Result := not (RegQueryStringValue(HKLM64, 'SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64', 'Version', Version) or
                 RegQueryStringValue(HKLM64, 'SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64', 'Version', Version) or
                 RegQueryStringValue(HKLM64, 'SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64', 'Version', Version));

  if not Result then
  begin
    Log('Visual C++ Runtime found: ' + Version);
    // Check if version is 14.30 or higher (VS2019-2022)
    if CompareStr(Version, 'v14.30') < 0 then
    begin
      Result := True;
      Log('Visual C++ Runtime version too old, update needed');
    end;
  end
  else
  begin
    Log('Visual C++ Runtime not found, installation needed');
  end;

  VCRedistNeeded := Result;
end;

function OnDownloadProgress(const Url, FileName: String; const Progress, ProgressMax: Int64): Boolean;
begin
  if Progress = ProgressMax then
    Log(Format('Successfully downloaded file to {tmp}: %s', [FileName]));
  Result := True;
end;

procedure InitializeWizard;
begin
  VCRedistNeeded := False;

  // Create download page for Visual C++ Redistributable
  DownloadPage := CreateDownloadPage(SetupMessage(msgWizardPreparing), SetupMessage(msgPreparingDesc), @OnDownloadProgress);

  // Create custom directory selection page (shown after component selection)
  PathSelectionPage := CreateInputDirPage(wpSelectComponents,
    'Select Installation Paths',
    'Where should each component be installed?',
    'Select the installation folders for each component you have chosen to install.',
    False, '');

  // Add input fields for each component
  PathSelectionPage.Add('Standalone Application:');
  PathSelectionPage.Values[0] := ExpandConstant('{autopf}\ZeroComp');

  PathSelectionPage.Add('VST3 Plugin:');
  PathSelectionPage.Values[1] := ExpandConstant('{commoncf64}\VST3');

  PathSelectionPage.Add('AAX Plugin (Pro Tools):');
  PathSelectionPage.Values[2] := ExpandConstant('{commoncf64}\Avid\Audio\Plug-Ins');
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;

  // Skip the default directory page since we use custom path selection
  if PageID = wpSelectDir then
  begin
    Result := True;
  end
  // Skip the path selection page if no components are selected
  else if PageID = PathSelectionPage.ID then
  begin
    Result := not (IsComponentSelected('standalone') or IsComponentSelected('vst3') or IsComponentSelected('aax'));

    // Dynamically show/hide path inputs based on selected components
    if not Result then
    begin
      PathSelectionPage.Edits[0].Visible := IsComponentSelected('standalone');
      PathSelectionPage.Buttons[0].Visible := IsComponentSelected('standalone');
      PathSelectionPage.PromptLabels[0].Visible := IsComponentSelected('standalone');

      PathSelectionPage.Edits[1].Visible := IsComponentSelected('vst3');
      PathSelectionPage.Buttons[1].Visible := IsComponentSelected('vst3');
      PathSelectionPage.PromptLabels[1].Visible := IsComponentSelected('vst3');

      PathSelectionPage.Edits[2].Visible := IsComponentSelected('aax');
      PathSelectionPage.Buttons[2].Visible := IsComponentSelected('aax');
      PathSelectionPage.PromptLabels[2].Visible := IsComponentSelected('aax');
    end;
  end
  else if PageID = DownloadPage.ID then
    Result := not VCRedistNeeded;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;

  // Store the selected paths when leaving the path selection page
  if CurPageID = PathSelectionPage.ID then
  begin
    StandalonePath := PathSelectionPage.Values[0];
    VST3Path := PathSelectionPage.Values[1];
    AAXPath := PathSelectionPage.Values[2];
  end
  else if CurPageID = wpReady then
  begin
    // Check and download Visual C++ Redistributable only if needed
    if NeedsVCRedist() then
    begin
      if MsgBox('Microsoft Visual C++ Redistributables are required but not installed.' + #13#10 + #13#10 +
                'Would you like to download and install them now?' + #13#10 +
                '(Required for ZeroComp to run properly)', mbConfirmation, MB_YESNO) = IDYES then
      begin
        DownloadPage.Clear;
        DownloadPage.Add('https://aka.ms/vs/17/release/vc_redist.x64.exe', 'vc_redist.x64.exe', '');
        DownloadPage.Show;
        try
          DownloadPage.Download;
          Result := True;
        except
          MsgBox('Failed to download Visual C++ Redistributables.' + #13#10 +
                 'ZeroComp may not work properly without them.' + #13#10 + #13#10 +
                 'You can download them manually from:' + #13#10 +
                 'https://aka.ms/vs/17/release/vc_redist.x64.exe', mbError, MB_OK);
          Result := True; // Continue installation anyway
        end;
      end
      else
      begin
        MsgBox('Warning: ZeroComp may not work without Visual C++ Redistributables.' + #13#10 + #13#10 +
               'You can download them later from:' + #13#10 +
               'https://aka.ms/vs/17/release/vc_redist.x64.exe', mbInformation, MB_OK);
      end;
    end
    else
    begin
      Log('Visual C++ Redistributables already installed, skipping download');
    end;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  TestFile: String;
  FileLocked: Boolean;
  TargetPath: String;
begin
  Result := '';
  FileLocked := False;

  // Check if VST3 plugin file is locked (in use by a DAW)
  if IsComponentSelected('vst3') then
  begin
    // Use the stored path or default
    if VST3Path <> '' then
      TargetPath := VST3Path
    else
      TargetPath := ExpandConstant('{commoncf64}\VST3');

    TestFile := TargetPath + '\ZeroComp.vst3\Contents\x86_64-win\ZeroComp.vst3';
    if FileExists(TestFile) then
    begin
      FileLocked := not DeleteFile(TestFile);
      if FileLocked then
      begin
        Log('VST3 plugin appears to be in use (file locked)');
        if MsgBox('The VST3 plugin appears to be in use by a DAW.' + #13#10 + #13#10 +
                  'Please close any DAW that might be using ZeroComp and try again.' + #13#10 + #13#10 +
                  'Continue anyway? (Installation may fail)', mbConfirmation, MB_YESNO) = IDNO then
        begin
          Result := 'Plugin files are locked. Please close your DAW and try again.';
          Exit;
        end;
      end;
    end;
  end;

  // Check if AAX plugin file is locked
  if IsComponentSelected('aax') and not FileLocked then
  begin
    // Use the stored path or default
    if AAXPath <> '' then
      TargetPath := AAXPath
    else
      TargetPath := ExpandConstant('{commoncf64}\Avid\Audio\Plug-Ins');

    // 既存の AAX バンドルを丸ごと削除してからインストール（入れ子防止）
    if DirExists(TargetPath + '\ZeroComp.aaxplugin') then
    begin
      Log('Removing existing AAX bundle to avoid nested installation');
      if not DelTree(TargetPath + '\ZeroComp.aaxplugin', True, True, True) then
      begin
        Log('Failed to remove existing AAX bundle (possibly in use)');
        if MsgBox('The AAX plugin appears to be in use by Pro Tools.' + #13#10 + #13#10 +
                  'Please close Pro Tools and try again.' + #13#10 + #13#10 +
                  'Continue anyway? (Installation may fail)', mbConfirmation, MB_YESNO) = IDNO then
        begin
          Result := 'Plugin files are locked. Please close Pro Tools and try again.';
          Exit;
        end;
      end;
    end;
  end;

  // Check if Standalone executable is running
  if IsComponentSelected('standalone') and not FileLocked then
  begin
    // Use the stored path or default
    if StandalonePath <> '' then
      TargetPath := StandalonePath
    else
      TargetPath := ExpandConstant('{autopf}\ZeroComp');

    TestFile := TargetPath + '\ZeroComp.exe';
    if FileExists(TestFile) then
    begin
      FileLocked := not DeleteFile(TestFile);
      if FileLocked then
      begin
        Log('Standalone application appears to be running');
        if MsgBox('ZeroComp standalone application appears to be running.' + #13#10 + #13#10 +
                  'Please close it and try again.' + #13#10 + #13#10 +
                  'Continue anyway? (Installation may fail)', mbConfirmation, MB_YESNO) = IDNO then
        begin
          Result := 'ZeroComp.exe is running. Please close it and try again.';
          Exit;
        end;
      end;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    // Post-install messages disabled
  end;
end;

// Helper functions to get installation paths
function GetStandalonePath(Param: String): String;
begin
  if StandalonePath = '' then
    Result := ExpandConstant('{autopf}\ZeroComp')
  else
    Result := StandalonePath;
end;

function GetVST3Path(Param: String): String;
begin
  if VST3Path = '' then
    Result := ExpandConstant('{commoncf64}\VST3')
  else
    Result := VST3Path;
end;

function GetAAXPath(Param: String): String;
begin
  if AAXPath = '' then
    Result := ExpandConstant('{commoncf64}\Avid\Audio\Plug-Ins')
  else
    Result := AAXPath;
end;

function GetDocPath(Param: String): String;
begin
  // Install docs to standalone path if it's selected, otherwise to default
  if IsComponentSelected('standalone') then
    Result := GetStandalonePath('')
  else
    Result := ExpandConstant('{autopf}\ZeroComp');
end;

procedure DeinitializeUninstall();
begin
  // Clean up any remaining files
  DelTree(ExpandConstant('{localappdata}\ZeroComp'), True, True, True);
  DelTree(ExpandConstant('{userappdata}\ZeroComp'), True, True, True);
end;
