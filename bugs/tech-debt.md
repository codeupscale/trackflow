# Tech Debt — Stack Versions

**Status:** Open / not actioned
**Assessed:** 2026-06-15
**Scope:** Framework/runtime versions across all three codebases

> **Verdict:** All three framework *choices* are correct and modern. No rewrite needed anywhere.
> The items below are upgrades/maintenance, not redesigns.

---

## Summary

| Codebase | Stack | Current version | Status | Action |
|----------|-------|-----------------|--------|--------|
| Backend | Laravel / PHP | Laravel 12, PHP 8.2 | ✅ Modern, reliable | Bump PHP to 8.3/8.4 (low priority) |
| Web | Next.js / React | Next 16, React 19, TanStack Query 5, Zustand 5, Tailwind 4 | ✅ Newest mainstream stack | Routine minor upgrades only |
| Desktop | Electron | **Electron 28** | ⚠️ **End-of-life** | **Upgrade — security risk** |

---

## P1 — Desktop: Electron 28 is end-of-life (SECURITY)

**The only real stack liability.**

- Electron releases a new major ~every 8 weeks and supports only the **latest 3 majors**.
  Electron 28 shipped in late 2023 and is well past that window.
- Consequence: the desktop agent receives **no security patches and no Chromium CVE fixes**.
- This matters more than usual here because the desktop app **captures screenshots and stores
  auth tokens (AES-256-GCM)** — running an unpatched Chromium is a genuine exposure.

**Companion upgrades (follow once Electron is bumped):**
- `electron-builder ^24` → current major
- `electron-updater ^6` → current major

**Risk / care needed:**
- Jumping several Electron majors at once can break native modules — `better-sqlite3` and `sharp`
  must be recompiled against the new ABI.
- Screenshot capture paths (macOS window-vs-screen capture) and the auto-updater manifests
  (`latest-mac.yml` / `latest.yml`) need re-testing after the bump.
- This is **bounded upgrade work, not a rewrite.** Plan it as a dedicated, tested upgrade pass.

**Recommended approach:** upgrade incrementally to a current supported Electron major, recompile
native deps, then run the full desktop test suite (`desktop/test/*.test.js`) plus manual
screenshot + auto-update verification.

---

## P3 — Backend: PHP 8.2 → 8.4 ✅ DONE (2026-06-16, uncommitted)

- `backend/composer.json` constraint bumped `"php": "^8.2"` → **`"^8.4"`** to match reality:
  production (`Dockerfile.production`) and both CI workflows already run **8.4**; local runtime is **8.5.7**.
- `composer.lock` re-synced (`composer update --lock`) — only the content-hash + php platform req
  changed; **no package versions changed**.
- Verified: `composer validate` ✓, `composer check-platform-reqs` ✓ (php 8.5.7 success), app boots
  (Laravel 12.54.1), all 102 backend timer tests pass on 8.5.7.
- Sail's stock `backend/docker/8.0`–`8.4` scaffolding Dockerfiles left as-is (not used by the
  production build, which is already `php:8.4-fpm-alpine`).

> Note (separate, pre-existing): `phpunit.xml` test DB points at `127.0.0.1:5432` / `trackflow`/
> `trackflow_test`, but the app's Docker Postgres is on `:5433` / `postgres`/`password`. Run tests
> with those overrides (or align phpunit.xml) — not related to the PHP bump.

---

## Explicitly NOT a problem

- **Laravel 12** — current major, do not rewrite the backend (e.g. to Node/Nest); that would
  discard a working modern stack and re-introduce the timer bugs in a new language.
- **Next.js 16 / React 19** — newest mainstream React stack; reliable.
- **Electron as the desktop framework** — the correct choice for this app. Only the *version* is
  the issue, not the framework.
