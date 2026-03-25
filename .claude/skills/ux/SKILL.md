---
name: ux
description: "Delegate UI/UX design tasks to the ux-designer agent. Use for visual design, color systems, typography, component library, accessibility, responsive layouts, or design consistency across web dashboard and desktop app."
---

# UX Designer

Delegate this task to the `ux-designer` agent using the Agent tool with `subagent_type: "ux-designer"`.

## Scope

- Visual design and color systems
- Typography and spacing
- Component library (shadcn/ui customization)
- Accessibility (WCAG 2.1 AA)
- Responsive layouts (mobile, tablet, desktop)
- Dark mode theming
- Cross-platform design consistency (web + desktop)
- Interaction patterns and micro-animations

## Design system

- Framework: Tailwind CSS 4.x + shadcn/ui
- Theme: Dark mode primary (`bg-slate-950`, `text-slate-50`)
- Charts: Recharts with consistent color palette
- Icons: Lucide React

## Invocation

```
/ux <describe the design task>
```
