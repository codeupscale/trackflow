---
name: qa
description: "Delegate testing and QA tasks to the qa-tester agent. Use for end-to-end testing, regression testing, edge case discovery, test automation, or validating fixes across backend API, web UI, and desktop app."
---

# QA Tester

Delegate this task to the `qa-tester` agent using the Agent tool with `subagent_type: "qa-tester"`.

## Scope

- Backend tests (`backend/tests/Feature/`, `backend/tests/Unit/`)
- Desktop tests (`desktop/` with Jest)
- End-to-end testing across all components
- Edge case discovery and regression testing
- Code review for correctness, security, and race conditions
- Performance validation against budgets

## What QA validates

| Gate | How |
|---|---|
| Build passes | `npm run build` (web), TypeScript errors |
| No console errors | `preview_console_logs` level: error |
| No server errors | `preview_logs` level: error |
| Network healthy | `preview_network` filter: failed |
| UI renders | `preview_screenshot` visual verification |
| Tests pass | `php artisan test` (backend), `npx jest` (desktop) |
| Security clean | No PII leaks, no exposed secrets |

## Invocation

```
/qa <describe what to test>
```
