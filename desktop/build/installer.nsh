; Custom NSIS script — kill running TrackFlow before install/uninstall
; This prevents "Failed to uninstall old application files" errors on Windows

!macro customInit
  ; Kill any running TrackFlow processes before installing/updating
  nsExec::ExecToLog 'taskkill /F /IM "TrackFlow.exe" /T'
  Sleep 1000
!macroend

!macro customUnInit
  ; Ask a running TrackFlow to stop its timer gracefully BEFORE we kill it.
  ; The single-instance lock forwards this flag to the running app, which calls
  ; app.quit() -> before-quit records the timer stop (local + best-effort server).
  ; Without this, the force-kill below would leave the server timer running forever.
  nsExec::ExecToLog '"$INSTDIR\TrackFlow.exe" --uninstall-stop'
  Sleep 3000
  ; Fallback: force-kill anything still alive so the uninstall can proceed.
  nsExec::ExecToLog 'taskkill /F /IM "TrackFlow.exe" /T'
  Sleep 1000
!macroend
