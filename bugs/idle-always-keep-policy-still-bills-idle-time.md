# `keep_idle_time: always` still billed idle time as work

| | |
|---|---|
| **Area** | Desktop idle policy + `GET /agent/config` + org settings page |
| **Platform** | All |
| **Severity** | P1 — idle minutes billed as work for any org holding the retired setting |
| **Reported** | 2026-08-10 (found during the post-fix audit of the idle/totals surface) |
| **Status** | ✅ FIXED (2026-08-10) |

## Symptom

An organization with **"Always keep idle time"** selected in Settings kept having idle
periods counted as tracked work — no prompt, no split, the live entry simply carried
on from its original start with the idle gap inside it.

## Root cause

Owner policy on 2026-07-16 removed crediting idle time: Keep and Reassign were dropped
and the idle prompt reduced to **"Continue tracking"** and **"Stop timer"**, both of
which discard the gap. The `keep_idle_time = always` org setting predates that decision
and was never revisited, so it survived as the one code path that still implemented
"keep":

```js
if (policy === "always") {
    idleDetector.resolveIdle(actionId);
    idleDetector.start();
    ...
    startTrayTimer();
    return;          // no split — the idle span stays inside the live session
}
```

The idle watchdog reinforced it (`if (config?.keep_idle_time === "always") return;`),
standing its hard-stop backstop down for exactly those orgs.

The result was a UI that offered a choice the product no longer honours anywhere else:
the prompt cannot keep idle time, but the org-wide setting could — and silently did.

## Fix

`always` now means what its neighbours mean — resolve WITHOUT prompting, and discard
the gap. It is behaviourally identical to `never`, which is why the settings page stops
offering both.

Normalised in three places, deliberately layered:

1. **`AgentController::idlePolicy()`** folds `always` → `never` (and any unrecognised
   value → `prompt`) on read. This is the single place every build reads its policy
   from, so desktops that predate this release stop billing idle time immediately,
   without waiting for a rollout. The stored setting is NOT rewritten — a read-side
   clamp keeps the option recoverable if the policy is ever revisited.
2. **Desktop `index.js`** treats `always` and `never` identically (`handleIdleAction
   ("discard", ...)`), so a stale cached config or an older backend cannot bill idle
   time either. The idle watchdog's `always` exemption is removed with it — nothing
   credits idle presence now, so exempting those orgs would only remove the backstop
   for a wedged detector.
3. **Settings page** offers `Prompt` / `Always discard idle time` only, and normalises a
   stored `always` to `never` on load so an org still holding the old value sees what it
   actually does (and saving migrates it). The `Prompt` label also stopped advertising
   the removed actions — it said "ask Keep / Discard / Reassign / Stop".

`SettingsController` still ACCEPTS `always` (`in:prompt,always,never`) on purpose, so an
org holding the old value, or a client echoing settings back, is not 422'd mid-migration.

## Regression tests

- `backend/tests/Feature/Timer/AgentIdlePolicyTest.php` — `always` is handed to the agent
  as `never`, `prompt`/`never` pass through, unknown/missing falls back to `prompt`, and
  the stored setting is not rewritten.
- `desktop/test/idle-alert-invariants.test.js` → "keep_idle_time policy — no path credits
  idle time" (source-level, since `index.js` cannot be imported under Jest).

## Related

- `bugs/desktop-idle-continue-still-bills-the-idle-gap.md` — the same billing outcome via
  the split instant
- `bugs/desktop-idle-continue-deducts-pre-idle-time-from-total.md` — the audit this was
  found during
