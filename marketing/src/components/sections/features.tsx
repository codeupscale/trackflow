"use client";

import { FadeIn, StaggerChildren, StaggerItem, ScaleOnHover } from "../motion";
import {
  Timer,
  Activity,
  Camera,
  WifiOff,
  CalendarDays,
  DollarSign,
  ClipboardCheck,
  BarChart3,
  Layers,
  Zap,
} from "lucide-react";

const features = [
  {
    icon: Timer,
    title: "Live Time Tracking",
    description:
      "Local-first architecture writes to SQLite before the network. Crash-proof, offline-resilient, and accurate to the second.",
    tag: "Core",
  },
  {
    icon: Activity,
    title: "Activity Monitoring",
    description:
      "Active-seconds scoring per 10-minute interval. Mouse, keyboard, and app usage tracked with full transparency.",
    tag: "Core",
  },
  {
    icon: Camera,
    title: "Screenshot Capture",
    description:
      "Per-display multi-monitor screenshots. Random intervals, blur options, and admin-configurable frequency.",
    tag: "Core",
  },
  {
    icon: WifiOff,
    title: "Never Lose a Second of Tracked Time",
    description:
      "SQLite-first architecture saves every timer event locally before touching the network. VPN drops, server errors, and laptop sleeps never stop your timer or lose your data. Other tools can't say the same.",
    tag: "Core",
  },
  {
    icon: Zap,
    title: "Lightest Agent in the Market",
    description:
      "Under 150MB RAM when idle. Under 250MB when tracking. Screenshots captured in under 3 seconds. We benchmark every release \u2014 no memory bloat, no battery drain, no fan noise.",
    tag: "Performance",
  },
  {
    icon: CalendarDays,
    title: "Leave Management",
    description:
      "Apply, approve, and track leave from one dashboard. Team calendar, balance tracking, and custom leave types.",
    tag: "HR",
  },
  {
    icon: DollarSign,
    title: "Payroll Engine",
    description:
      "Salary structures, pay components, automated payroll runs, and downloadable payslips. AES-256 encrypted at rest.",
    tag: "HR",
  },
  {
    icon: ClipboardCheck,
    title: "Attendance & Shifts",
    description:
      "Auto-generated attendance from time entries. Shift management, swap requests, grace periods, and overtime rules.",
    tag: "HR",
  },
  {
    icon: BarChart3,
    title: "Reports & Analytics",
    description:
      "Real-time dashboards, PDF/CSV export, team activity heatmaps, and per-project breakdowns. Role-aware filtering.",
    tag: "Analytics",
  },
];

export function Features() {
  return (
    <section id="features" className="py-20 md:py-28 bg-[var(--color-surface-elevated)] dark:bg-[var(--color-surface-elevated-dark)]">
      <div className="mx-auto max-w-7xl px-6">
        <FadeIn>
          <div className="text-center max-w-2xl mx-auto mb-16">
            <p className="text-sm font-semibold uppercase tracking-wider text-[var(--color-primary)] mb-3">
              Features
            </p>
            <h2 className="text-3xl md:text-4xl font-bold text-[var(--color-text)] dark:text-[var(--color-text-dark)]">
              Everything your workforce needs, nothing it does not
            </h2>
            <p className="mt-4 text-lg text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">
              From time tracking to payroll, every module is built to work together seamlessly.
            </p>
          </div>
        </FadeIn>

        {/* Hero feature card — full width */}
        <FadeIn>
          <div className="mb-8 rounded-[var(--radius-xl)] p-8 md:p-10 bg-gradient-to-br from-amber-500 to-orange-600 shadow-xl">
            <div className="flex flex-col md:flex-row md:items-center gap-6">
              <div className="inline-flex items-center justify-center size-14 rounded-[var(--radius-lg)] bg-white/20 shrink-0">
                <Layers className="size-7 text-white" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-xl md:text-2xl font-bold text-white">
                    One Platform. Zero Tool-Switching.
                  </h3>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white bg-white/20 px-2.5 py-1 rounded-full whitespace-nowrap">
                    Only in TrackFlow
                  </span>
                </div>
                <p className="text-white/90 leading-relaxed max-w-3xl">
                  TrackFlow is the only workforce platform that connects time tracking directly to attendance, leave, and payroll. Clock in &rarr; attendance recorded &rarr; leave deducted &rarr; payroll calculated. Automatically.
                </p>
              </div>
            </div>
          </div>
        </FadeIn>

        <StaggerChildren className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5" staggerDelay={0.08}>
          {features.map((feature) => (
            <StaggerItem key={feature.title}>
              <ScaleOnHover>
                <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface)] dark:bg-[var(--color-surface-dark)] ring-1 ring-[var(--color-border)] dark:ring-[var(--color-border-dark)] p-6 h-full flex flex-col">
                  <div className="flex items-center justify-between mb-4">
                    <div className="inline-flex items-center justify-center size-10 rounded-[var(--radius-base)] bg-[var(--color-primary)]/10">
                      <feature.icon className="size-5 text-[var(--color-primary)]" />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-primary)] bg-[var(--color-primary)]/10 px-2 py-0.5 rounded-full">
                      {feature.tag}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-[var(--color-text)] dark:text-[var(--color-text-dark)] mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)] leading-relaxed flex-1">
                    {feature.description}
                  </p>
                </div>
              </ScaleOnHover>
            </StaggerItem>
          ))}
        </StaggerChildren>
      </div>
    </section>
  );
}
