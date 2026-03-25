---
name: devops
description: "Delegate infrastructure and deployment tasks to the devops-engineer agent. Use for Docker, CI/CD, desktop builds, releases, auto-updates, monitoring, or production reliability."
---

# DevOps Engineer

Delegate this task to the `devops-engineer` agent using the Agent tool with `subagent_type: "devops-engineer"`.

## Scope

- Docker compose (`compose.yaml`, `compose.production.yaml`)
- CI/CD pipelines (`.github/workflows/`)
- Desktop builds (`desktop/package.json` build config, electron-builder)
- Release management (GitHub Releases, `latest-mac.yml` / `latest.yml`)
- Auto-updates (electron-updater)
- Monitoring and logging
- Production deployment and reliability

## Rules the agent follows

- Dev environment: Docker Compose with Sail
- Production: `compose.production.yaml` with Redis, Horizon, Reverb
- Desktop builds: DMG (macOS), NSIS (Windows), AppImage/deb (Linux)
- CI: PHPUnit + `composer audit` + `npm audit`
- Auto-updates: GitHub Releases with signed manifests

## Invocation

```
/devops <describe the infrastructure task>
```
