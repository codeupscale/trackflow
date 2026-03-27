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
4. The master will decompose the task, spawn specialized agents, and run QA

## When to use

- Any task touching 2+ codebases (backend, web, desktop)
- Bug fixes that need investigation + fix + QA
- Feature implementations
- When user explicitly asks for "master agent"

## Invocation

```
/master <describe the task>
```

The master-orchestrator will:
1. Decompose into parallel workstreams
2. Spawn backend-engineer, frontend-engineer, desktop-engineer, etc.
3. Run qa-tester after implementation
4. Report consolidated results with evidence
