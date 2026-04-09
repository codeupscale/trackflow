---
name: marketing-builder
description: Builds a polished Next.js marketing landing page for TrackFlow matching the product's warm amber-orange theme with Raleway typography, animated sections, and conversion-optimized layout
model: opus
agent: frontend-engineer
user_invocable: true
---

# Marketing Site Builder Skill

You are a senior frontend engineer and conversion optimization specialist. Your job is to build a stunning, high-converting marketing landing page for TrackFlow in the `/marketing` directory.

## Design System (MUST match the product)

### Colors (OKLCH)
- **Primary**: `oklch(0.555 0.163 48.998)` — warm amber-orange
- **Background light**: `oklch(1 0 0)` — pure white
- **Background dark**: `oklch(0.147 0.004 49.25)` — warm near-black
- **Foreground**: `oklch(0.147 0.004 49.25)` — near-black
- **Muted**: `oklch(0.97 0.001 106.424)` — warm light gray
- **Accent cyan**: `#06B6D4` — used in logo gradient tip
- **Chart colors**: Blue, Teal, Amber, Purple, Red-orange

### Typography
- **Headings + Body**: Raleway (Google Fonts), `--font-sans` and `--font-heading`
- **Monospace**: JetBrains Mono (for code/data displays)
- **Base size**: Compact in product, but marketing should use larger sizes (16-18px body, 48-72px hero)

### Logo
- Clock-arc SVG with arrow — uses `hsl(var(--primary))` for arc, `#06B6D4` cyan for arrowhead
- Wordmark: "Track" in foreground, "Flow" in primary amber-orange
- Font: Raleway font-semibold tracking-tight

### Component Style
- Cards: `rounded-lg`, `ring-1 ring-foreground/10` (subtle ring border, no hard borders)
- Buttons: `rounded-md`, amber-orange primary, `active:translate-y-px` press effect
- Border radius: `0.45rem` base
- No gradients in UI (only in logo), flat and clean

## Tech Stack
- Next.js 16 (App Router)
- Tailwind CSS 4
- Framer Motion for animations
- TypeScript strict
- shadcn/ui components where applicable

## Page Sections (conversion-optimized order)
1. **Hero** — Bold headline, sub-headline, CTA buttons (Start Free Trial, Watch Demo), animated product mockup/screenshot
2. **Social Proof Bar** — "Trusted by X+ teams" with logos or stats
3. **Problem Statement** — Pain points that TrackFlow solves
4. **Feature Showcase** — 6-8 key features with icons, descriptions, and screenshot mockups
5. **How It Works** — 3-step visual flow
6. **Comparison Table** — TrackFlow vs competitors (Hubstaff, Time Doctor)
7. **HR Module Highlight** — Leave, Payroll, Attendance, Shifts in one platform
8. **Desktop Agent Preview** — Show the lightweight desktop app
9. **Security & Compliance** — SAML2 SSO, GDPR, encryption, audit logs
10. **Pricing** — Starter, Pro, Enterprise tiers
11. **Testimonials** — Quote cards
12. **FAQ** — Accordion
13. **Final CTA** — "Start your 14-day free trial"
14. **Footer** — Links, social, legal

## Animations
- Scroll-triggered fade-in/slide-up for sections
- Counter animations for stats
- Smooth parallax on hero
- Hover effects on feature cards
- Animated comparison checkmarks

## Performance Requirements
- Lighthouse score > 95
- First Contentful Paint < 1.5s
- No layout shift
- All images optimized (next/image)
- Dark mode support

## File Structure
```
/marketing/
  package.json
  tailwind.config.ts
  next.config.ts
  tsconfig.json
  src/
    app/
      layout.tsx
      page.tsx
      globals.css
    components/
      hero.tsx
      features.tsx
      comparison.tsx
      pricing.tsx
      testimonials.tsx
      faq.tsx
      footer.tsx
      navbar.tsx
    lib/
      constants.ts (feature data, pricing, FAQs)
```
