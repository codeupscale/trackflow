---
name: pipeline
description: "Run the full TrackFlow development pipeline from planning through deploy. Invokes all agents in the correct sequence with quality gates enforced at every phase. Use this for any non-trivial task that needs the complete flow: plan → build → test → security → review → build-verify → docs → commit → deploy."
---

# TrackFlow Full Pipeline

Delegate this task to the `master-orchestrator` agent using the Agent tool with `subagent_type: "master-orchestrator"`.

## What This Runs

The complete 10-phase pipeline with mandatory quality gates:

```
Phase 0  → architect-agent       Plan: schema, API contracts, execution order
Phase 1  → database-architect    Schema changes + migrations (if needed)
           qa-tester             Gate: migrations clean, rollback works
Phase 2  → backend-engineer      API, services, controllers, jobs, policies
           test-backend          Gate: PHPUnit tests written + passing
Phase 3  → frontend-engineer     Next.js pages, components, stores (shadcn)
           desktop-engineer      Electron IPC, services, preload (if needed)
           test-frontend         Gate: component + hook tests passing
           test-desktop          Gate: IPC + service tests passing
Phase 4  → qa-tester             Full suite: backend + frontend + desktop
Phase 5  → security-engineer     Security scan: OWASP, multi-tenancy, Electron
Phase 6  → reviewer-agent        Code quality, architecture, performance
Phase 7  → devops-engineer       Build verify: npm run build + tsc --noEmit
Phase 8  → docs-agent            CLAUDE.md + inline docs updated
Phase 9  → git commit + push     Conventional commit, specific files only
Phase 10 → devops-engineer       Production deploy: rebuild → rolling restart → health check
```

## Quality Gates (All Mandatory)

| Gate | Block Condition |
|---|---|
| Schema QA | Any migration error or missing org_id |
| Backend tests | Any PHPUnit failure |
| Frontend/Desktop tests | Any test failure |
| Full suite | Any single test failure across all codebases |
| Security scan | Any critical vulnerability (missing auth, org scope, injection) |
| Code review | BLOCK verdict from reviewer-agent |
| Build verify | Any `npm run build` error or TypeScript error |
| Deploy health | Any container unhealthy after restart |

## Invocation

```
/pipeline <describe the task>
```

## Examples

```
/pipeline add bulk time entry export to CSV for admin reports
/pipeline fix the screenshot gallery not loading after org switch
/pipeline implement two-factor authentication for owner accounts
/pipeline add keyboard shortcuts to the timer widget
```

## Individual Phase Skills (for targeted work)

When you only need part of the pipeline:

```
/architect  → Phase 0 only (planning)
/backend    → Phase 2 only (API changes)
/frontend   → Phase 3 only (UI changes)
/desktop    → Phase 3 only (desktop changes)
/qa         → Phase 4 only (run all tests)
/security   → Phase 5 only (security audit)
/reviewer   → Phase 6 only (code review)
/devops     → Phase 7 or 10 (build verify or deploy)
/docs       → Phase 8 only (update docs)
/shadcn     → Add/fix shadcn components (used inside Phase 3)
```
