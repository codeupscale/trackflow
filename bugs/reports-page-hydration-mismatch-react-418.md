# Reports page hydration mismatch (React #418) + random skeleton heights

**Status:** ✅ FIXED (2026-06-30, `develop`) — branch `fix/reports-hydration-418`.

**Scope:** Web `app/(dashboard)/reports/page.tsx` SSR hydration.

**Severity:** P2 — console error on every reports load; tree regenerated on the client (flicker / wasted render). Page still functioned.

## Symptom

Browser console on the Reports page:

```
Uncaught Error: Minified React error #418; ... args[]=HTML
```

(React #418 = hydration failed: server-rendered HTML didn't match the client.)

Also logged: `Cookie "dmn_chk_…" rejected for invalid domain` — unrelated third-party/extension cookie, **not** an app bug; safe to ignore.

## Root cause

Two SSR/client non-determinisms in the page render:

1. **`Math.random()` skeleton heights** — the analytics chart loading skeleton used `style={{ height: `${40 + Math.random()*60}%` }}`. The SSR pass (queries pending → skeleton shown) produced different heights than the client's first render → guaranteed mismatch.
2. **Timezone-sensitive date init** — date `useState` initializers call `new Date()` / date-fns `format()`. SSR evaluates in the server timezone (UTC); the browser re-evaluates in the user's timezone (e.g. PKT). Near midnight these yield different date strings, mismatching the rendered date inputs/labels.

## Fix

- Replaced the random skeleton heights with a **deterministic** array (`[65,85,50,95,70,45,80]`).
- Added a `mounted` flag (`useState(false)` + `useEffect(()=>setMounted(true),[])`). The component renders a stable placeholder until mounted, so server HTML and the first client render are identical; date-dependent content renders only after mount (client-only, no hydration involved).

## Verify

- `cd web && npx tsc --noEmit` — clean.
- Manual: open Reports → no React #418 in console; skeleton bars stable.

## Key files

- `web/src/app/(dashboard)/reports/page.tsx` — `mounted` gate, deterministic skeleton
