# Dev desktop releases version behind the shipped production build

**Status:** ✅ FIXED (2026-07-07) · **Severity:** P2 (release/auto-update integrity) · **Area:** CI — desktop-release.yml

## Symptom

After production `v1.0.42` shipped, pushes to `develop` kept publishing pre-releases like
`v1.0.42-dev.73`. Expected: `v1.0.43-dev.1` — the *next* version, with a per-version counter
starting at 1.

## Why it matters

Semver orders `1.0.42-dev.73` **before** `1.0.42`, so every dev build published after the release
claimed to be *older* than production despite containing newer code. electron-updater on the dev
channel could treat stable `1.0.42` as an upgrade over a dev build, and the releases page misrepresented
what was newest.

## Root cause

Two compounding issues in the `preflight` job of `.github/workflows/desktop-release.yml`:

1. **Stale base version.** Dev versions were `<desktop/package.json version>-dev.<n>`, and
   `package.json` is only bumped *before* a production release (e.g. `bb428a65`), never after —
   so the base stayed `1.0.42` until someone remembered a manual chore commit.
2. **Global run counter.** The `-dev.<n>` suffix was `github.run_number` — a monotonically
   increasing counter across all runs of the workflow, chosen for tag uniqueness. It never resets
   per version, hence `dev.73`.

## Fix

`preflight` is now self-correcting for the dev channel:

- **Auto-bump past shipped versions:** if `v<BASE>` already exists as a published release, the patch
  is incremented (looped) until an unreleased version is reached → `1.0.42` becomes `1.0.43`
  automatically after the prod release. The manual post-release bump chore is gone.
- **Per-version counter from tags:** `-dev.<n>` = highest existing `v<BASE>-dev.*` tag + 1 (1 if
  none), so numbering restarts at `-dev.1` for each new version.
- **Race safety:** a workflow-level `concurrency` group (`desktop-release-<ref>`, queued, never
  cancelled) serializes runs so two concurrent develop pushes cannot resolve the same tag —
  the uniqueness guarantee `run_number` used to provide.

Production (`main`) resolution is unchanged. `workflow_dispatch` with an explicit `version` input
still wins as the base (and is also auto-bumped if already shipped).
