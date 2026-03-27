---
description: "Delegate architectural design and implementation planning to the architect agent. Use BEFORE any implementation begins. Produces structured plans with schema, API contracts, execution order, and QA criteria."
---

# Architect Skill

You MUST delegate this task to an `architect-agent` using the Agent tool. Do NOT attempt to handle it yourself.

## When to Use
- Before starting any non-trivial feature (more than 2 files)
- When changes span multiple codebases (backend + frontend + desktop)
- When the user says "plan this", "design this", "figure out what we need to build"
- When schema changes are required
- Before running the master pipeline

## Invocation

Spawn with `subagent_type: "architect-agent"` and give the full context of the feature/task.

The architect agent will return a structured plan with:
- Exact files to change in each codebase
- Database schema (if applicable)
- API contract (request/response shapes)
- Frontend + desktop specifications
- Execution order for other agents
- QA acceptance criteria

## Usage

```
/architect <describe the feature or task to plan>
```

## Pipeline Position

```
/architect → (review plan) → /master implements the plan
```
