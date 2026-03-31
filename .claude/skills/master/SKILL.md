---
name: master
description: "Delegate complex multi-system tasks to the master-orchestrator agent. Use for any task spanning backend + web + desktop, bug fixes requiring investigation across codebases, feature implementations, or when the user says 'use master agent'. This is the primary entry point for non-trivial work."
---

# Master Orchestrator

You MUST delegate this task to the `master-orchestrator` agent using the Agent tool. Do NOT attempt to handle it yourself.

## Instructions

1. Spawn a single `master-orchestrator` agent with `subagent_type: "master-orchestrator"`
2. Pass the FULL user request as the prompt
3. Include context: the web dev server may be running on port 3000 (check with `preview_list`)
4. The master will run the full pipeline and enforce QA gates at every phase

## When to use

- Any task touching 2+ codebases (backend, web, desktop)
- Bug fixes that need investigation + fix + QA
- Feature implementations (new endpoints, new pages, new desktop features)
- When user explicitly asks for "master agent"

## Full Pipeline the Master Runs

```
Phase 0:  architect-agent              → Plan: schema, API contracts, execution order
Phase 1:  database-architect           → Schema/migrations (if needed)
          qa-tester                    → GATE: migrations clean + rollback works
Phase 2:  backend-engineer             → API, services, controllers, jobs, policies
          test-backend                 → GATE: PHPUnit tests written + passing
Phase 3:  frontend-engineer (shadcn)   → Next.js pages, components, stores
          desktop-engineer             → Electron IPC, services (parallel with frontend)
          test-frontend + test-desktop → GATE: all tests written + passing
Phase 4:  qa-tester                    → GATE: full suite (backend + web + desktop)
Phase 5:  security-engineer            → GATE: OWASP scan, multi-tenancy, Electron
Phase 6:  reviewer-agent               → GATE: code quality, architecture, performance
Phase 7:  devops-engineer (build)      → GATE: npm run build + tsc --noEmit clean
Phase 8:  docs-agent                   → CLAUDE.md + inline docs updated
Phase 9:  git commit + push            → Conventional commit, specific files staged
Phase 10: devops-engineer (deploy)     → Rebuild images, rolling restart, health checks
```

## Invocation

```
/master <describe the task>
```

## Available Slash Commands for Individual Agents

```
/pipeline   → Full 10-phase pipeline (same as /master but explicit)
/architect  → Phase 0: plan a feature before building
/database   → Phase 1: schema design / migrations
/backend    → Phase 2: backend-only changes
/frontend   → Phase 3: frontend-only changes
/desktop    → Phase 3: desktop-only changes
/qa         → Phase 4: run full test suite
/security   → Phase 5: security audit
/reviewer   → Phase 6: code quality review
/devops     → Phase 7 or 10: build verify or deploy
/docs       → Phase 8: update documentation
/shadcn     → Add/customize shadcn components (used inside Phase 3)
/ux         → UI/UX design (used inside Phase 3)
/test-backend   → Write PHPUnit tests (used inside Phase 2 gate)
/test-frontend  → Write React tests (used inside Phase 3 gate)
/test-desktop   → Write Electron tests (used inside Phase 3 gate)
```
