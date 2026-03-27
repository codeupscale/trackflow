---
name: desktop
description: "Delegate Electron desktop agent tasks to the desktop-engineer agent. Use for screenshot capture, activity monitoring, offline queue, auto-updates, IPC, tray, or any work in the /desktop directory."
---

# Desktop Engineer

Delegate this task to the `desktop-engineer` agent using the Agent tool with `subagent_type: "desktop-engineer"`.

## Scope

- Main process (`desktop/src/main/index.js`)
- Screenshot service (`desktop/src/main/screenshot-service.js`)
- Activity monitor (`desktop/src/main/activity-monitor.js`)
- Idle detection (`desktop/src/main/idle-detector.js`)
- Offline queue (`desktop/src/main/offline-queue.js`)
- API client (`desktop/src/main/api-client.js`)
- Keychain/token storage (`desktop/src/main/keychain.js`)
- Preload bridge (`desktop/src/preload/index.js`)
- Renderer HTML/JS (`desktop/src/renderer/`)
- Build config (`desktop/package.json` build field)

## Rules the agent follows

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on ALL windows
- ALL renderer-main communication via `contextBridge` in preload
- Token storage: AES-256-GCM (no keytar, no safeStorage)
- macOS screenshots: window capture first, screen capture fallback
- Memory budget: <150MB idle, <250MB tracking

## Invocation

```
/desktop <describe the desktop task>
```
