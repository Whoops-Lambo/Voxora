; A standard NSIS installer. WriteUninstaller embeds the uninstall section without executing Windows binaries during the build.
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!addincludedir "${BUILD_RESOURCES_DIR}"
!include "files.generated.nsh"
Name "Voxora"
InstallDir "$LOCALAPPDATA\Programs\Voxora"
InstallDirRegKey HKCU "Software\Voxora" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
SetOverwrite on
ShowInstDetails show
ShowUninstDetails show
Icon "${MUI_ICON}"
UninstallIcon "${MUI_UNICON}"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\Voxora.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch Voxora"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro addLangs
Function .onInit
 ${IfNot} ${RunningX64}
  MessageBox MB_ICONSTOP "Voxora requires 64-bit Windows 10 or later."
  Abort
 ${EndIf}
 SetRegView 64
 SetShellVarContext current
FunctionEnd
Section "Voxora"
 !insertmacro VoxoraInstallFiles
 SetOutPath "$INSTDIR"
 WriteUninstaller "$INSTDIR\Uninstall Voxora.exe"
 CreateDirectory "$SMPROGRAMS\Voxora"
 CreateShortcut "$SMPROGRAMS\Voxora\Voxora.lnk" "$INSTDIR\Voxora.exe"
 CreateShortcut "$SMPROGRAMS\Voxora\Uninstall Voxora.lnk" "$INSTDIR\Uninstall Voxora.exe"
 CreateShortcut "$DESKTOP\Voxora.lnk" "$INSTDIR\Voxora.exe"
 WriteRegStr HKCU "Software\Voxora" "InstallDir" "$INSTDIR"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Voxora" "DisplayName" "Voxora"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Voxora" "DisplayVersion" "${VERSION}"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Voxora" "Publisher" "Whoops-Lambo"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Voxora" "InstallLocation" "$INSTDIR"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Voxora" "UninstallString" '$\"$INSTDIR\Uninstall Voxora.exe$\"'
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Voxora" "DisplayIcon" "$INSTDIR\Voxora.exe"
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Voxora" "NoModify" 1
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Voxora" "NoRepair" 1
SectionEnd
Section "Uninstall"
 SetRegView 64
 SetShellVarContext current
 !insertmacro VoxoraUninstallFiles
 Delete "$DESKTOP\Voxora.lnk"
 Delete "$SMPROGRAMS\Voxora\Voxora.lnk"
 Delete "$SMPROGRAMS\Voxora\Uninstall Voxora.lnk"
 RMDir "$SMPROGRAMS\Voxora"
 Delete "$INSTDIR\Uninstall Voxora.exe"
 RMDir "$INSTDIR"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Voxora"
 DeleteRegKey HKCU "Software\Voxora"
 ; Chat data and browser profile deliberately remain in APPDATA.
SectionEnd
