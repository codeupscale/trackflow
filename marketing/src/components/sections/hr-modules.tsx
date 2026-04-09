"use client";

import { FadeIn, StaggerChildren, StaggerItem } from "../motion";
import { CalendarDays, DollarSign, ClipboardCheck, ArrowLeftRight } from "lucide-react";

const modules = [
  {
    icon: CalendarDays,
    title: "Leave Management",
    description:
      "Custom leave types, automated balance tracking, manager approval workflows, and a full team calendar with holiday support. Employees apply from the dashboard; managers approve in one click.",
    features: ["Custom leave types", "Auto balance deduction", "Team calendar", "Public holidays"],
    gradient: "from-amber-500/10 to-orange-500/10",
  },
  {
    icon: DollarSign,
    title: "Payroll Engine",
    description:
      "Define salary structures with allowances, deductions, bonuses, and tax components. Run payroll in bulk, generate payslips, and keep salary data AES-256 encrypted at rest.",
    features: ["Salary structures", "Pay components", "Bulk payroll runs", "Encrypted payslips"],
    gradient: "from-green-500/10 to-emerald-500/10",
  },
  {
    icon: ClipboardCheck,
    title: "Attendance & Overtime",
    description:
      "Auto-generate daily attendance from time entries. Smart status detection: present, half-day, absent, on leave, weekend, holiday. Configurable overtime rules per organization.",
    features: ["Auto-generated records", "Regularization requests", "Late tracking", "Overtime rules"],
    gradient: "from-blue-500/10 to-cyan-500/10",
  },
  {
    icon: ArrowLeftRight,
    title: "Shift Management",
    description:
      "Create shifts with break periods and grace periods. Assign users, manage rosters with a weekly view, and let employees swap shifts with manager approval.",
    features: ["Shift creation", "Weekly roster", "Swap requests", "Grace periods"],
    gradient: "from-purple-500/10 to-pink-500/10",
  },
];

export function HrModules() {
  return (
    <section className="py-20 md:py-28 bg-[var(--color-surface-elevated)] dark:bg-[var(--color-surface-elevated-dark)]">
      <div className="mx-auto max-w-7xl px-6">
        <FadeIn>
          <div className="text-center max-w-2xl mx-auto mb-16">
            <p className="text-sm font-semibold uppercase tracking-wider text-[var(--color-primary)] mb-3">
              Built-in HR Suite
            </p>
            <h2 className="text-3xl md:text-4xl font-bold text-[var(--color-text)] dark:text-[var(--color-text-dark)]">
              HR modules that actually talk to your time data
            </h2>
            <p className="mt-4 text-lg text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">
              No more exporting CSVs between systems. Leave, payroll, attendance, and shifts all reference the same time entries.
            </p>
          </div>
        </FadeIn>

        <StaggerChildren className="grid md:grid-cols-2 gap-6" staggerDelay={0.12}>
          {modules.map((mod) => (
            <StaggerItem key={mod.title}>
              <div className={`rounded-[var(--radius-lg)] bg-gradient-to-br ${mod.gradient} p-px`}>
                <div className="rounded-[calc(var(--radius-lg)-1px)] bg-[var(--color-surface)] dark:bg-[var(--color-surface-dark)] p-8 h-full">
                  <div className="flex items-start gap-5">
                    <div className="inline-flex items-center justify-center size-12 rounded-[var(--radius-lg)] bg-[var(--color-primary)]/10 shrink-0">
                      <mod.icon className="size-6 text-[var(--color-primary)]" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-xl font-bold text-[var(--color-text)] dark:text-[var(--color-text-dark)] mb-2">
                        {mod.title}
                      </h3>
                      <p className="text-sm text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)] leading-relaxed mb-4">
                        {mod.description}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {mod.features.map((f) => (
                          <span
                            key={f}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)] bg-[var(--color-surface-elevated)] dark:bg-[var(--color-surface-elevated-dark)] px-2.5 py-1 rounded-full"
                          >
                            <svg className="size-3 text-[var(--color-primary)]" viewBox="0 0 12 12" fill="none">
                              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </StaggerItem>
          ))}
        </StaggerChildren>
      </div>
    </section>
  );
}
