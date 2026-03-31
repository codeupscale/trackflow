; Custom NSIS script — kill running TrackFlow before install/uninstall
; This prevents "Failed to uninstall old application files" errors on Windows

!macro customInit
  ; Kill any running TrackFlow processes before installing/updating
  nsExec::ExecToLog 'taskkill /F /IM "TrackFlow.exe" /T'
  Sleep 1000
!macroend

!macro customUnInit
  ; Kill any running TrackFlow processes before uninstalling
  nsExec::ExecToLog 'taskkill /F /IM "TrackFlow.exe" /T'
  Sleep 1000
!macroend
