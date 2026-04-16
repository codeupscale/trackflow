# TrackFlow Competitive Battle Cards

---

## Battle Card: TrackFlow vs Hubstaff

### Head-to-Head Comparison

| Capability | TrackFlow | Hubstaff |
|---|---|---|
| Time tracking | Local-first with SQLite queue | Memory-based queue |
| Offline resilience | Full (survives crashes, reconnects) | Partial (memory-only, lost on crash) |
| Activity scoring | Active-seconds model (30s heartbeats) | Active-intervals model (10-min slots) |
| Screenshots | Per-display capture (each monitor separate) | Composited (all monitors stitched) |
| Screenshot blur | Yes (server-side) | Yes |
| Idle detection | 6-state machine, 3 modes | Configurable threshold, prompt |
| App tracking | Active app + window title | Detailed app + duration |
| URL tracking | Configurable per org | Yes (detailed) |
| GPS tracking | Coming soon | Yes (mobile) |
| Mobile app | Coming soon | Yes (iOS + Android) |
| Auto-start on login | Not yet | Yes |
| Leave management | Built-in (full module) | Not available (separate product) |
| Attendance | Built-in (auto-generated from time) | Not available |
| Shift scheduling | Built-in (templates, roster, swaps) | Not available |
| Payroll engine | Built-in (structures, payslips) | Integration only (Gusto, PayPal) |
| Employee records | Built-in (encrypted, documents, notes) | Not available |
| SAML2 SSO | Included in all plans | Enterprise tier only |
| Multi-org login | Yes (consultants, freelancers) | No |
| Payroll integration | Built-in engine | External only (Gusto, PayPal, Wise) |
| Browser extension | Not yet | Yes |
| Pricing model | Per seat, all features | Per seat, tiered features |

### Our Advantages (Use These in Conversations)

1. **"We have a built-in HR suite."** Hubstaff is time tracking only. Leave management, attendance, payroll, employee records, and shift scheduling are all separate products that customers have to buy and integrate. TrackFlow includes all of this.

2. **"Our offline mode actually works."** Hubstaff stores queued data in memory. If the app crashes or the laptop restarts while offline, that data is gone. TrackFlow writes to a local SQLite database. The data survives crashes, restarts, and even OS updates.

3. **"Our screenshots are readable."** Hubstaff composites multiple monitors into a single image. On a dual-monitor setup, each monitor's content is shrunk to fit side by side, making text difficult to read. TrackFlow captures each display separately at native resolution.

4. **"SAML SSO without the enterprise tax."** Hubstaff gates SSO behind their highest pricing tier. TrackFlow includes SAML2 support for Okta, Azure AD, and OneLogin in every plan.

5. **"Multi-org support for consultants."** If a user works for multiple organizations, they log in once and switch between orgs without re-authenticating. Hubstaff does not support this.

### Our Gaps (Be Honest)

- **Mobile app**: Hubstaff has mature iOS and Android apps with GPS tracking. TrackFlow's mobile app is in development. If the prospect requires mobile time tracking today, this is a gap.
- **App duration tracking**: Hubstaff tracks cumulative time per application. TrackFlow currently captures the active app name but not duration breakdown. Being addressed.
- **Browser extension**: Hubstaff offers a Chrome extension for browser-based tracking. TrackFlow does not yet have this.
- **Auto-start on login**: Hubstaff supports this. TrackFlow does not yet.
- **Integrations ecosystem**: Hubstaff has more third-party integrations (Asana, Jira, Trello, QuickBooks). TrackFlow's integration library is growing.

### Objection Handling

**"We already use Hubstaff and it works fine."**
Hubstaff is a solid time tracker. The question is whether you are also paying for a separate HR system, a separate leave management tool, and a separate payroll processor. If you are, TrackFlow consolidates all of that into one platform at a lower total cost of ownership.

**"Hubstaff has a mobile app and you do not."**
Correct. Our mobile app is in active development. If mobile time tracking is a day-one requirement, we can discuss timeline. However, if your primary use case is desktop-based distributed teams, TrackFlow offers stronger offline resilience and a full HR suite that Hubstaff cannot match.

**"Hubstaff has more integrations."**
We integrate with the core tools that matter: SSO providers, payment processing, and cloud storage. Our built-in HR modules replace the need for many integrations that Hubstaff users set up to bridge functionality gaps. You do not need a Hubstaff-to-BambooHR integration if leave management is already built in.

---

## Battle Card: TrackFlow vs Time Doctor

### Head-to-Head Comparison

| Capability | TrackFlow | Time Doctor |
|---|---|---|
| Time tracking | Local-first with offline queue | Server-dependent |
| Offline resilience | Full (SQLite queue, crash-safe) | None (requires connectivity) |
| Activity scoring | Active-seconds (30s heartbeats) | Active-intervals |
| Screenshots | Per-display, multi-monitor | Multi-monitor, composited |
| Idle detection | 6-state machine, configurable | Configurable threshold |
| App tracking | Active app + window title | Detailed |
| URL tracking | Configurable per org | Yes |
| SAML2 SSO | Yes (all plans) | Not available |
| Multi-org login | Yes | Not available |
| Leave management | Built-in | Not available |
| Attendance | Built-in | Not available |
| Payroll | Built-in engine | Integration only (Wise) |
| Shift scheduling | Built-in | Not available |
| Employee records | Built-in (encrypted) | Not available |
| Desktop platforms | macOS, Windows, Linux | macOS, Windows, Linux |
| Mobile app | Coming soon | Not available |

### Our Advantages

1. **"We work offline. Time Doctor does not."** Time Doctor requires an active internet connection. If the connection drops, tracking stops. This is a dealbreaker for teams with unreliable connectivity: field workers, travelers, developing regions, or anyone working from a coffee shop.

2. **"We include SAML2 SSO."** Time Doctor does not offer enterprise SSO at any tier. For organizations with security policies that require SSO, Time Doctor is automatically disqualified.

3. **"We have a complete HR suite."** Time Doctor is purely a time tracking and monitoring tool. Leave management, attendance, payroll, and employee records are not part of the product and never will be.

4. **"Multi-org support."** Time Doctor does not support users who belong to multiple organizations. Consultants and freelancers who work for multiple clients need separate accounts.

### Our Gaps

- **App usage detail**: Time Doctor provides more granular application usage analytics with categorization.
- **Website blocking**: Time Doctor can actively block distracting websites. TrackFlow does not have this feature.
- **Client login**: Time Doctor offers a client portal where clients can view contractor time. TrackFlow does not have a dedicated client-facing view.

### Objection Handling

**"Time Doctor is cheaper."**
Compare total cost. If you are using Time Doctor plus a separate HR system plus a separate payroll tool, the combined cost likely exceeds TrackFlow's per-seat price. We replace all three.

**"Our team always has internet."**
Until they do not. Conference WiFi, hotel networks, VPN disconnections, ISP outages. Every distributed team encounters connectivity issues. The question is whether those issues cause lost time data. With Time Doctor, they do. With TrackFlow, they do not.

---

## Battle Card: TrackFlow vs DeskTime

### Head-to-Head Comparison

| Capability | TrackFlow | DeskTime |
|---|---|---|
| Platforms | macOS, Windows, Linux | Windows only |
| Time tracking | Local-first, offline-capable | Online required |
| Screenshots | Per-display, multi-monitor | Yes |
| Activity monitoring | Active-seconds model | Automatic categorization |
| URL tracking | Configurable | Yes |
| Idle detection | 6-state machine | Automatic |
| Private time mode | Not yet | Yes (pause tracking) |
| Leave management | Built-in | Not available |
| Attendance | Built-in | Not available |
| Payroll | Built-in | Not available |
| Employee records | Built-in (encrypted) | Not available |
| SAML2 SSO | Yes | Not available |
| Multi-org | Yes | Not available |

### Our Advantages

1. **"We run on macOS and Linux."** DeskTime is Windows-only for the desktop agent. Any team with macOS or Linux users cannot use DeskTime for desktop tracking. TrackFlow supports all three platforms.

2. **"We have an HR suite."** DeskTime is a time tracker. TrackFlow is a workforce management platform.

3. **"We work offline."** DeskTime requires an internet connection.

4. **"Enterprise SSO."** DeskTime does not offer SAML2 SSO.

### Our Gaps

- **Automatic time categorization**: DeskTime automatically categorizes time as productive, unproductive, or neutral based on app/website rules. TrackFlow tracks apps and URLs but does not apply automatic productivity categorization.
- **Private time mode**: DeskTime allows employees to pause tracking for personal breaks with a single click. TrackFlow does not have a dedicated private time mode (employees stop the timer instead).
- **Pomodoro timer**: DeskTime includes a built-in Pomodoro timer. TrackFlow does not.

### Objection Handling

**"DeskTime automatically categorizes productivity."**
Auto-categorization sounds useful but creates problems in practice. Is Stack Overflow productive or unproductive? Is YouTube a distraction or a training resource? These categorizations require constant maintenance and generate false positives that erode employee trust. TrackFlow gives managers raw app usage data and lets them draw their own conclusions.

**"DeskTime has a private time feature."**
TrackFlow employees control their timer. When they need private time, they stop tracking. The result is the same, without a feature that can be weaponized as "see, they took 3 hours of private time."

---

## Battle Card: TrackFlow vs Toggl Track

### Head-to-Head Comparison

| Capability | TrackFlow | Toggl Track |
|---|---|---|
| Time tracking | Local-first, project-based | Timer + manual, project-based |
| Screenshots | Yes (multi-monitor, per-display) | Not available |
| Activity monitoring | Active-seconds model | Not available |
| Idle detection | 6-state, configurable | Basic idle detection |
| Offline mode | Full (SQLite queue) | Limited (syncs on reconnect) |
| Leave management | Built-in | Not available |
| Attendance | Built-in | Not available |
| Payroll | Built-in | Not available |
| Employee records | Built-in (encrypted) | Not available |
| SAML2 SSO | Yes (all plans) | Enterprise tier only |
| Reporting | 8 report types + export | Detailed reports + export |
| Integrations | Growing | 100+ integrations |
| Mobile app | Coming soon | Yes (iOS + Android) |
| Browser extension | Not yet | Yes |

### Our Advantages

1. **"We provide visibility that Toggl does not."** Toggl is a self-reported time tracker with no screenshots, no activity monitoring, and no app tracking. Managers are trusting that employees are logging accurate time. TrackFlow provides verification through activity scores and screenshots.

2. **"We have an HR suite."** Toggl is time tracking only. Leave, attendance, payroll, shifts, and employee records are not part of the product.

3. **"We include SSO in every plan."** Toggl gates SAML SSO behind their Enterprise tier.

### Our Gaps

- **Integration ecosystem**: Toggl has 100+ integrations (Asana, Jira, Salesforce, Slack, and more). TrackFlow's integration library is smaller.
- **Mobile app**: Toggl has mature mobile apps. TrackFlow's are in development.
- **Browser extension**: Toggl has a popular Chrome extension that integrates with project management tools. TrackFlow does not have this.
- **API maturity**: Toggl's API is well-documented and widely used by third-party tools.
- **Simplicity**: Toggl is deliberately simple. Some prospects want simple. If activity monitoring and screenshots are not requirements, Toggl's lighter approach may appeal to them.

### Objection Handling

**"Toggl is simpler and our team likes it."**
If your team only needs a timer with project tagging, Toggl is a fine choice. The question is whether you also need to verify that logged time reflects actual work, manage leave requests, process attendance, or run payroll. If any of those apply, you are going to need additional tools, and TrackFlow gives you everything in one place.

**"We do not want to monitor our employees."**
TrackFlow's monitoring features are configurable. You can disable screenshots entirely, disable activity tracking, and use TrackFlow purely as a time tracker with HR capabilities. But the option to enable visibility is there when you need it, without switching to a different tool.

**"Toggl has more integrations."**
Toggl needs integrations because it is only a time tracker. Many of the integrations Toggl users rely on connect to HR systems, payroll tools, and project management. TrackFlow's built-in modules replace the need for several of those integrations.

---

## Battle Card: TrackFlow vs ActivTrak

### Head-to-Head Comparison

| Capability | TrackFlow | ActivTrak |
|---|---|---|
| Deployment model | Employee-controlled timer | Always-on agent (no timer) |
| Screenshots | Yes (multi-monitor) | Yes |
| Activity monitoring | Active-seconds, when timer running | Continuous, always recording |
| App tracking | Active app + window title | Detailed categorization |
| URL tracking | Configurable per org | Yes (detailed) |
| Keystroke logging | Not available (by design) | Optional |
| Productivity scoring | Activity percentage | AI-based productivity score |
| Time tracking | Full timer with projects | Passive (no explicit timer) |
| Offline mode | Full (SQLite queue) | Limited |
| Leave management | Built-in | Not available |
| Attendance | Built-in | Not available |
| Payroll | Built-in | Not available |
| Employee records | Built-in (encrypted) | Not available |
| SAML2 SSO | Yes (all plans) | Enterprise tier |
| Desktop platforms | macOS, Windows, Linux | Windows only (agent) |

### Our Advantages

1. **"Employees control the timer."** ActivTrak runs continuously in the background. Employees have no control over when they are monitored. TrackFlow uses an employee-controlled timer: tracking only happens when the employee starts it. This is a fundamental philosophical difference. Employee-controlled tracking builds trust. Always-on surveillance creates resentment.

2. **"We are cross-platform."** ActivTrak's desktop agent is Windows-only. TrackFlow runs on macOS, Windows, and Linux.

3. **"We have an HR suite."** ActivTrak is monitoring-only. It does not do time tracking with projects, leave management, attendance, payroll, or any HR function.

4. **"We do not do keystroke logging."** This is a deliberate product decision. Keystroke logging creates legal liability in many jurisdictions and destroys employee trust. TrackFlow measures activity through input detection without recording what was typed.

5. **"We track time, not just activity."** ActivTrak monitors what employees do on their computers but does not provide a timer-based time tracking system. You cannot use ActivTrak for client billing, timesheet submission, or project-based hour tracking.

### Our Gaps

- **AI productivity insights**: ActivTrak uses AI to categorize activity and provide productivity coaching recommendations. TrackFlow does not have AI-driven insights.
- **Automatic productivity categorization**: ActivTrak categorizes apps and websites as productive or unproductive. TrackFlow provides raw usage data without categorization.
- **Workforce analytics depth**: ActivTrak offers burnout detection, workload balance, and capacity planning analytics. TrackFlow's analytics focus on time, activity, and HR metrics.
- **Always-on monitoring**: Some organizations specifically want always-on monitoring. TrackFlow's timer-based model means monitoring only happens during active tracking sessions.

### Objection Handling

**"We need always-on monitoring."**
Consider the trade-off. Always-on monitoring provides more data but creates a surveillance culture that affects morale, trust, and retention. Timer-based tracking gives managers the visibility they need during work hours while respecting employees' autonomy. The companies that retain top talent are the ones that monitor outcomes, not every mouse movement.

**"ActivTrak has AI-powered productivity insights."**
AI categorization requires defining what is "productive" for every role, which is more subjective than it appears. A developer on Reddit might be debugging. A salesperson on LinkedIn is prospecting. TrackFlow gives managers the data and lets humans make the judgment.

**"We are a Windows-only shop."**
Today. But if you ever hire a macOS or Linux developer, onboard a contractor with their own equipment, or expand to a region where Windows is not dominant, you will need to switch tools. TrackFlow works on all three platforms from day one.

---

## Quick Reference: When to Lead With What

| If the prospect cares about... | Lead with... |
|---|---|
| Replacing multiple tools | Built-in HR suite (leave, payroll, attendance, shifts) |
| Remote team reliability | Offline resilience (SQLite queue, crash-safe) |
| Security and compliance | SAML2 SSO, AES-256 encryption, GDPR, audit trail |
| Employee experience | Self-service portal, configurable privacy, timer control |
| Cost reduction | Total cost of ownership (one tool vs. 4-6 subscriptions) |
| International/distributed teams | Multi-org support, multi-currency payroll, timezone handling |
| Consultant/freelancer model | Multi-org login, project-based tracking |
| Cross-platform teams | macOS + Windows + Linux support |
| Client billing accuracy | Local-first tracking, per-display screenshots, activity scores |

---

*Last updated: April 2026. Review quarterly or when major features ship.*
