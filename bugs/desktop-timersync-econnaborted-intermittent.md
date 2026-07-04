# Desktop — intermittent `[TimerSync] API unreachable … ECONNABORTED`

**Area:** Desktop ↔ API connectivity (`api-client.js` timeouts, `index.js` TimerSync loop)
**Severity:** P2 (handled gracefully — no logout, no data loss — but noisy and a symptom of slow sync)
**Status:** 🔴 OPEN — observed, **not root-caused** (possibly environmental)

## Symptom
During testing on the dev stack, the desktop log repeatedly logged:
```
[TimerSync] API unreachable (retrying while online): ECONNABORTED — check TRACKFLOW_API_URL or server availability
```
at 09:14:49Z, 09:25:36Z, 09:28:06Z (and earlier). Some occurrences lined up with a deliberate internet-disconnect (offline reassign test — expected), but **others happened while the user reported being online**, and contributed to the broken-feeling session (a start/reassign not syncing promptly).

## What is known
- The dev API container (`infra-tf-dev-app-1`) was **healthy (up 19h)** throughout; Config/Shift fetches succeeded in the same window → the server was up, only some calls timed out.
- Timer/status calls use a **10s timeout** (`api-client.js`); default is 15s. `ECONNABORTED` = the call exceeded its timeout (or the connection aborted).
- It is **handled correctly**: `ECONNABORTED` is treated as transient — no `forceLogout()`, timer continues locally, reconcile on reconnect. So this is a *quality/latency* issue, not a correctness bug.

## NOT yet determined (why it's OPEN)
Whether the cause is:
1. **Environmental** — dev server / reverse-proxy / network latency exceeding the 10s timer-call budget (most likely; dev is shared infra), or
2. **Endpoint latency** — `/timer/status` slow on dev (large today-total aggregation?), or
3. **Client** — too-aggressive 10s budget for the dev path.

## Recommended next step (not done)
- Confirm the desktop's actual `TRACKFLOW_API_URL` for the dev build and time `GET /timer/status` against it (curl with timing) over several minutes to see p95 latency.
- If endpoint-slow: profile the status query. If network-slow on dev only: likely non-issue for prod (prod is on dedicated infra) — verify against prod before changing the client timeout.
- Do **not** blanket-raise the 10s timeout without data — it would mask slow syncs and delay offline fallback.

## Note
This was observed during the 2026-06-23 idle/reassign testing session. Logged here for tracking rather than left undocumented; it is **not** confirmed as a code defect.
