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
Phase 0: architect-agent → implementation plan + API contracts
Phase 1: database-architect → schema/migrations
  └─ QA GATE: qa-tester validates schema
Phase 2: backend-engineer → API/services
  └─ QA GATE: qa-tester validates API
Phase 3: frontend-engineer + desktop-engineer (parallel) → UI
  └─ QA GATE: qa-tester runs full test suite
Phase 4: reviewer-agent → security + quality review (PASS/BLOCK verdict)
Phase 5: docs-agent → update CLAUDE.md + inline docs
Phase 6: devops-engineer → deploy preview → production
```

## Invocation

```
/master <describe the task>
```

## Available Slash Commands for Individual Agents

```
/architect  → Plan a feature before building
/reviewer   → Review code changes after implementation
/docs       → Update documentation after changes
/backend    → Backend-only changes
/frontend   → Frontend-only changes
/desktop    → Desktop-only changes
/qa         → Run tests and QA
/security   → Security review
/devops     → Deploy / infrastructure
/database   → Schema design / migrations
```
