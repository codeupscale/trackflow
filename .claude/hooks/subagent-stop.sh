#!/usr/bin/env bash
# SubagentStop hook for TrackFlow
# Fires when a subagent completes. Reads agent context from stdin (JSON).
# Injects QA gate reminders based on which agent just completed.

set -euo pipefail

INPUT=$(cat)

# Extract agent name from subagent stop context
AGENT_NAME=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    # Try common fields where agent name might appear
    name = (
        data.get('agent_name') or
        data.get('subagent_type') or
        data.get('name') or
        ''
    )
    print(name.lower())
except:
    print('')
" 2>/dev/null || echo "")

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Map agents to their pipeline phase and required next step
case "$AGENT_NAME" in
  *database-architect*|*database*)
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "[$TIMESTAMP] PIPELINE GATE: database-architect completed" >&2
    echo "" >&2
    echo "⚡ REQUIRED NEXT STEP: Run QA gate for database changes" >&2
    echo "   Spawn qa-tester to verify:" >&2
    echo "   • Migrations run without errors" >&2
    echo "   • Rollback works cleanly" >&2
    echo "   • organization_id present on new tables" >&2
    echo "   • Indexes are correct" >&2
    echo "" >&2
    echo "   DO NOT proceed to backend-engineer until QA gate passes." >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    ;;

  *backend-engineer*|*backend*)
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "[$TIMESTAMP] PIPELINE GATE: backend-engineer completed" >&2
    echo "" >&2
    echo "⚡ REQUIRED NEXT STEP: Run QA gate for API changes" >&2
    echo "   Spawn qa-tester to verify:" >&2
    echo "   • cd backend && php artisan test" >&2
    echo "   • API endpoints return correct status codes" >&2
    echo "   • Response shapes match architect's contract" >&2
    echo "   • Auth/authorization works correctly" >&2
    echo "   • Multi-tenant isolation (org A ≠ org B)" >&2
    echo "" >&2
    echo "   DO NOT proceed to frontend/desktop until QA gate passes." >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    ;;

  *frontend-engineer*|*frontend*)
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "[$TIMESTAMP] PIPELINE GATE: frontend-engineer completed" >&2
    echo "" >&2
    echo "⚡ REQUIRED NEXT STEP: Run QA gate for UI changes" >&2
    echo "   Spawn qa-tester to verify:" >&2
    echo "   • cd web && npm test" >&2
    echo "   • UI renders correctly for all roles (admin, manager, employee)" >&2
    echo "   • Loading, error, and empty states all work" >&2
    echo "   • No TypeScript errors (npm run build)" >&2
    echo "" >&2
    echo "   If desktop-engineer also completed: run full suite." >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    ;;

  *desktop-engineer*|*desktop*)
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "[$TIMESTAMP] PIPELINE GATE: desktop-engineer completed" >&2
    echo "" >&2
    echo "⚡ REQUIRED NEXT STEP: Run QA gate for desktop changes" >&2
    echo "   Spawn qa-tester to verify:" >&2
    echo "   • cd desktop && npx jest --verbose" >&2
    echo "   • IPC events work correctly" >&2
    echo "   • No node-integration violations (contextIsolation: true)" >&2
    echo "   • Screenshot + activity tracking still functional" >&2
    echo "" >&2
    echo "   If frontend-engineer also completed: run full suite." >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    ;;

  *qa-tester*|*qa*)
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "[$TIMESTAMP] PIPELINE: qa-tester completed" >&2
    echo "" >&2
    echo "✅ QA gate complete. Check verdict:" >&2
    echo "   • If ALL tests pass → proceed to next pipeline phase" >&2
    echo "   • If tests FAIL → return to implementation agent with specific failures" >&2
    echo "   • After ALL implementation + QA phases done → run reviewer-agent" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    ;;

  *reviewer-agent*|*reviewer*)
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "[$TIMESTAMP] PIPELINE GATE: reviewer-agent completed" >&2
    echo "" >&2
    echo "⚡ CHECK REVIEWER VERDICT:" >&2
    echo "   • PASS → proceed to docs-agent then devops-engineer" >&2
    echo "   • PASS WITH WARNINGS → proceed, log warnings in final report" >&2
    echo "   • BLOCK → return to implementation with specific fixes required" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    ;;

  *docs-agent*|*docs*)
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "[$TIMESTAMP] PIPELINE: docs-agent completed" >&2
    echo "" >&2
    echo "⚡ REQUIRED NEXT STEP: Deploy" >&2
    echo "   Spawn devops-engineer to:" >&2
    echo "   • Deploy preview environment" >&2
    echo "   • Run final verification" >&2
    echo "   • Promote to production (if approved)" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    ;;

  *architect-agent*|*architect*)
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "[$TIMESTAMP] PIPELINE: architect-agent completed" >&2
    echo "" >&2
    echo "⚡ PLAN IS READY. Next steps:" >&2
    echo "   1. Review the plan for completeness" >&2
    echo "   2. For HIGH complexity: present to user for approval" >&2
    echo "   3. For MEDIUM/LOW: proceed to Phase 1 (database-architect or backend-engineer)" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    ;;

  *)
    # Unknown agent — just log completion
    if [ -n "$AGENT_NAME" ]; then
      echo "[$TIMESTAMP] PIPELINE: agent '$AGENT_NAME' completed" >&2
    fi
    ;;
esac

# Always exit 0 — hooks must not block the pipeline
exit 0
