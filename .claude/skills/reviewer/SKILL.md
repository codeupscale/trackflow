---
description: "Delegate code review to the reviewer agent. Runs AFTER implementation is complete. Reviews all changed files for security vulnerabilities, multi-tenancy violations, code quality issues, performance problems, and test coverage. Returns PASS / PASS WITH WARNINGS / BLOCK verdict."
---

# Reviewer Skill

You MUST delegate this task to a `reviewer-agent` using the Agent tool. Do NOT attempt to handle it yourself.

## When to Use
- After all implementation agents have completed their work
- Before running devops-engineer to deploy
- When the master-orchestrator runs the quality gate phase
- When the user says "review the changes", "check for security issues", "is this safe to ship?"

## What the Reviewer Checks
- Security: org scoping, authorization, input validation, secrets, Electron security
- Code quality: N+1 queries, missing error handling, unbounded collections
- Architecture: standards compliance, thin controllers, paginated lists
- Performance: missing indexes, synchronous heavy work
- Test coverage: were tests written? Are they meaningful?
- Regression risk: what existing functionality could break?

## Verdict Scale
- ✅ **PASS** — Safe to deploy
- ⚠️ **PASS WITH WARNINGS** — Can deploy, track the warnings
- 🚫 **BLOCK** — Must fix before deploying (critical security or architecture violation)

## Invocation

Spawn with `subagent_type: "reviewer-agent"` and provide context about what was implemented.

## Usage

```
/reviewer review all changes since main branch
/reviewer review the timer service changes
```

## Pipeline Position

```
implementation agents → qa-tester → /reviewer → docs-agent → devops-engineer
```
