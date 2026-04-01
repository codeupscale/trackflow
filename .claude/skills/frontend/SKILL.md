---
name: frontend
description: "Delegate Next.js web dashboard tasks to the frontend-engineer agent. Use for React components, pages, custom hooks, Zustand stores, TanStack Query, Tailwind CSS, shadcn/ui, HR module UI (leave, payroll, employees, onboarding, performance, org chart), reusable component architecture, or any work in the /web directory."
---

# Frontend Engineer

Delegate this task to the `frontend-engineer` agent using the Agent tool with `subagent_type: "frontend-engineer"`.

## Scope

- Next.js App Router pages (`web/src/app/(dashboard)/*/page.tsx`)
- React components — reusable first (`web/src/components/`)
- Custom hooks (`web/src/hooks/`) — business logic out of components
- Zustand stores (`web/src/stores/`) — UI state only
- API client (`web/src/lib/api.ts`)
- TanStack Query `useQuery` / `useMutation` — never raw useEffect+fetch
- Forms: react-hook-form + Zod (`web/src/lib/validations/`)
- Tailwind CSS 4 + shadcn/ui — semantic tokens, `gap-*`, `size-*`, `cn()`
- HR module pages: leave, payroll, employees, onboarding, performance, recruitment, org chart
- Data tables: TanStack Table + DataTable wrapper component
- Real-time subscriptions (Laravel Echo)

## Rules the agent follows

- Data fetching: TanStack Query only (never raw `useEffect + fetch`)
- State: Zustand stores, cleanup on unmount/logout
- SSR safety: `typeof window !== 'undefined'` guards
- Error handling: every query renders loading + error states
- Role-based: early return for unauthorized roles

## Invocation

```
/frontend <describe the frontend task>
```
