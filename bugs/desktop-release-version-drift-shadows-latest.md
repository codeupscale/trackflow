# Stale package.json version republished as a stray, "Latest"-shadowing release

**Status:** fixed
**Reported:** 2026-08-27 (owner)
**Severity:** P1 — new downloads silently got an older, 27-commits-behind build; the just-merged idle-alert fix (PR #100) was unreachable by anyone already updated

## Symptom

Merging a desktop fix (PR #100) to `develop` and then to `main` produced three releases:
`TrackFlow Desktop 1.0.46-dev.16`, `TrackFlow Desktop 1.0.46`, and — already sitting there from
six days earlier — `TrackFlow Desktop 1.0.47`. The new `1.0.46` production release, being the
most recently published, was flagged **"Latest" by GitHub** (GitHub picks "Latest" by publish
date, not semver), which meant:

- Anyone downloading fresh from the releases page or the marketing site's `/releases/latest`
  link got the OLDER `1.0.46` build, missing the 27 commits already shipped in `1.0.47`.
- Everyone already on `1.0.47` could never auto-update to `1.0.46` (electron-updater does not
  downgrade), so the fix that had just been merged reached **nobody**.
- A GitHub API inspection also turned up two release objects sharing the tag `v1.0.46` (both
  `created_at` 2026-08-12 — an old unpublished draft plus something that published alongside it
  today), a second data-integrity symptom of the same underlying gap.

## Root cause

`desktop/package.json`'s `"version"` field had been sitting at `1.0.46` since before `v1.0.47`
was published (`v1.0.47` appears to have shipped out-of-band, e.g. via an explicit
`workflow_dispatch` version input, without that number ever being written back to
`package.json`). The release workflow's version-resolution step (`.github/workflows/desktop-release.yml`)
only ever asked *"does a release with this **exact** tag already exist?"* — for both the
production (`main`) and dev-prerelease (`develop`) channels — and bumped by exactly one patch
per iteration when it did. It never asked *"what's the highest version we've actually shipped?"*

That is precisely the gap a stale `package.json` falls into: `v1.0.46` had never been
**published** (only drafted), so `gh release view v1.0.46` reported "not found," the loop never
engaged, and the workflow proceeded to publish `1.0.46` as a real, brand-new release — two
versions below the true, already-shipped ceiling. The same one-tag-at-a-time blindness affects
the dev channel identically, and would resolve a `-dev.N` prerelease for an already-superseded
base version the same way.

This is the same *class* of defect the workflow had partially addressed before — its own
comments record an earlier incident where `package.json` sat at `1.0.43` while prod was on
`v1.0.46`, which was "fixed" by adding the per-branch while-loop this report describes. That fix
only ever compared against the single version package.json happened to hold; it was never
robust to the true ceiling having moved further than package.json knew about.

## Fix

Before either channel's while-loop runs, the resolve step now computes the highest version
**ever actually published to production** (`gh api .../releases`, filtered to
non-draft/non-prerelease, `sort -V`), and raises `BASE` to that floor whenever `package.json`'s
version is behind it. The existing while-loops (unchanged) then walk forward from a now-correct
starting point instead of a potentially-stale one. This applies only to the AUTO-resolved path —
an explicit `workflow_dispatch` version input is still honored literally, refused only if that
exact tag already exists, matching prior behavior.

Also bumped `desktop/package.json` to `1.0.48` directly, both as an immediate fix (so the very
next `main` push ships past `1.0.47`) and as defense in depth — the workflow guard should not be
the *only* thing keeping the recorded version close to reality.

### Immediate cleanup performed

- Deleted both stray `v1.0.46` release objects and their tag.
- Deleted the `v1.0.46-dev.16` prerelease and its orphaned tag.
- Re-flagged `v1.0.47` as "Latest".

## Lessons

- **GitHub's "Latest" flag is publish-date-based, not semver-based.** Any release automation
  that can publish an out-of-order version needs its own floor check — GitHub will not stop you
  from shadowing a newer release with an older one.
- **A one-tag-at-a-time "does this exact version exist" check is not the same as "what's the
  real ceiling."** A version can be missing from that specific check (never published, only
  drafted, or skipped via an out-of-band dispatch) while a HIGHER version already exists
  elsewhere. Always resolve against the actual maximum, not an assumed-adjacent one.
- A `package.json` version field that only humans remember to bump will drift the moment any
  release goes out through a path that doesn't write back to it (manual dispatch, hotfix,
  reverted commit). Prefer deriving the floor from the source of truth (published releases)
  over trusting a hand-maintained number.
