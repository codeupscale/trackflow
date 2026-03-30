---
name: shadcn
description: "Add, customize, or fix shadcn/ui components in the TrackFlow web dashboard. Use for installing new components, building UI with shadcn primitives, theming, or composing complex UI from shadcn building blocks."
---

# shadcn/ui

Use this skill when the user wants to add or work with shadcn/ui components in the TrackFlow web dashboard (`/web`).

## What This Skill Does

- Adds shadcn/ui components via `npx shadcn@latest add <component>`
- Builds UI using shadcn primitives (Button, Dialog, Sheet, Table, Select, etc.)
- Customizes components inside `web/src/components/ui/`
- Composes complex UI from shadcn building blocks
- Uses the shadcn MCP server (if connected) to browse and search components

## Component Library Location

All shadcn components live at: `web/src/components/ui/`

## How to Add a Component

```bash
cd /home/ubuntu/trackflow/web
npx shadcn@latest add <component-name>
```

Examples:
```bash
npx shadcn@latest add button
npx shadcn@latest add dialog
npx shadcn@latest add data-table
npx shadcn@latest add calendar
npx shadcn@latest add command
npx shadcn@latest add sheet
npx shadcn@latest add tabs
npx shadcn@latest add badge
npx shadcn@latest add avatar
npx shadcn@latest add dropdown-menu
```

## Rules

- Always install via CLI — never copy-paste component code manually
- Import from `@/components/ui/<component>` (not relative paths)
- Compose with Tailwind — never override with inline styles
- Use `cn()` utility from `@/lib/utils` for conditional class merging
- Follow existing design tokens and color variables in `globals.css`
- Prefer shadcn primitives over custom HTML for forms, dialogs, tables
- Components are fully customizable — edit files in `web/src/components/ui/` directly

## MCP Integration

If the shadcn MCP server is connected (`/mcp` shows it), you can:
- Browse all available components
- Search for specific components by functionality
- Get component code and usage examples directly

## Invocation

```
/shadcn <describe what UI to build or which component to add>
```

Examples:
- `/shadcn add a data table with sorting and pagination for the reports page`
- `/shadcn add a command palette for global search`
- `/shadcn build a settings dialog with tabs for profile, notifications, and security`
- `/shadcn add a date range picker to the time entries filter`
