"use client";

import { useState } from "react";
import { FadeIn, FloatingAnimation } from "../motion";
import { Play, ArrowRight } from "lucide-react";
import { DemoModal } from "../demo-modal";

function DashboardMockup() {
  return (
    <div className="relative w-full max-w-lg mx-auto">
      {/* Main dashboard card */}
      <div className="rounded-[var(--radius-xl)] bg-[var(--color-surface)] dark:bg-[var(--color-surface-elevated-dark)] ring-1 ring-[var(--color-border)] dark:ring-[var(--color-border-dark)] shadow-2xl p-6 space-y-5">
        {/* Header bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-full bg-[var(--color-primary)]/20 flex items-center justify-center">
              <div className="size-4 rounded-full bg-[var(--color-primary)]" />
            </div>
            <div>
              <div className="h-3 w-24 rounded-full bg-[var(--color-text)]/10 dark:bg-white/10" />
              <div className="h-2 w-16 rounded-full bg-[var(--color-text)]/5 dark:bg-white/5 mt-1.5" />
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="size-2 rounded-full bg-green-500" />
            <span className="text-xs font-mono text-green-600 dark:text-green-400">Tracking</span>
          </div>
        </div>

        {/* Timer display */}
        <div className="text-center py-3">
          <div className="font-mono text-4xl font-bold tracking-wider text-[var(--color-text)] dark:text-[var(--color-text-dark)]">
            04:32:18
          </div>
          <div className="text-sm text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)] mt-1">
            TrackFlow Marketing Site
          </div>
        </div>

        {/* Activity bar chart */}
        <div className="flex items-end gap-1 h-16 px-2">
          {[65, 80, 45, 90, 70, 85, 55, 92, 78, 60, 88, 72, 95, 68, 82, 50, 75, 90, 63, 87].map(
            (h, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-sm"
                style={{
                  height: `${h}%`,
                  backgroundColor:
                    h > 80
                      ? "oklch(0.555 0.163 48.998)"
                      : h > 60
                        ? "oklch(0.555 0.163 48.998 / 0.6)"
                        : "oklch(0.555 0.163 48.998 / 0.25)",
                }}
              />
            )
          )}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Active", value: "87%", color: "text-green-600 dark:text-green-400" },
            { label: "Tasks", value: "12", color: "text-[var(--color-primary)]" },
            { label: "Screenshots", value: "24", color: "text-[var(--color-accent-cyan)]" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-[var(--radius-base)] bg-[var(--color-surface-elevated)] dark:bg-[var(--color-surface-dark)] p-3 text-center"
            >
              <div className={`font-mono text-lg font-bold ${stat.color}`}>{stat.value}</div>
              <div className="text-xs text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Floating notification cards */}
      <div className="absolute -top-4 -right-4 rounded-[var(--radius-lg)] bg-[var(--color-surface)] dark:bg-[var(--color-surface-elevated-dark)] ring-1 ring-[var(--color-border)] dark:ring-[var(--color-border-dark)] shadow-lg px-4 py-2.5 flex items-center gap-2">
        <div className="size-2 rounded-full bg-green-500 animate-pulse" />
        <span className="text-xs font-medium">Leave Approved</span>
      </div>

      <div className="absolute -bottom-3 -left-4 rounded-[var(--radius-lg)] bg-[var(--color-surface)] dark:bg-[var(--color-surface-elevated-dark)] ring-1 ring-[var(--color-border)] dark:ring-[var(--color-border-dark)] shadow-lg px-4 py-2.5 flex items-center gap-2">
        <div className="size-6 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center">
          <svg className="size-3" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="oklch(0.555 0.163 48.998)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <span className="text-xs font-medium">Payslip Ready</span>
      </div>
    </div>
  );
}

export function Hero() {
  const [showDemo, setShowDemo] = useState(false);

  return (
    <section className="relative overflow-hidden pt-32 pb-20 md:pt-40 md:pb-28">
      <DemoModal isOpen={showDemo} onClose={() => setShowDemo(false)} />
      {/* Background gradient */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full bg-[var(--color-primary)]/5 blur-3xl" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full bg-[var(--color-accent-cyan)]/5 blur-3xl" />
      </div>

      <div className="mx-auto max-w-7xl px-6">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Text */}
          <div>
            <FadeIn>
              <div className="inline-flex items-center gap-2 rounded-full bg-[var(--color-primary)]/10 px-4 py-1.5 mb-6">
                <div className="size-1.5 rounded-full bg-[var(--color-primary)] animate-pulse" />
                <span className="text-xs font-semibold text-[var(--color-primary)] uppercase tracking-wider">
                  Now with HR Modules
                </span>
              </div>
            </FadeIn>

            <FadeIn delay={0.1}>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-[1.1] tracking-tight text-[var(--color-text)] dark:text-[var(--color-text-dark)]">
                Track Time.{" "}
                <span className="text-gradient">Monitor Activity.</span>{" "}
                Manage HR.{" "}
                <span className="text-[var(--color-primary)]">One Platform.</span>
              </h1>
            </FadeIn>

            <FadeIn delay={0.2}>
              <p className="mt-6 text-lg text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)] leading-relaxed max-w-xl">
                Replace your time tracker, activity monitor, screenshot tool, leave manager, and payroll system with a single workforce platform. Built for teams that value precision and privacy.
              </p>
            </FadeIn>

            <FadeIn delay={0.3}>
              <div className="mt-8 flex flex-wrap gap-4">
                <a
                  href="#cta"
                  className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-base)] bg-[var(--color-primary)] px-7 py-3.5 text-base font-semibold text-white shadow-lg shadow-[var(--color-primary)]/25 hover:bg-[var(--color-primary-dark)] active:translate-y-px transition-all"
                >
                  Start Free Trial
                  <ArrowRight className="size-4" />
                </a>
                <button
                  onClick={() => setShowDemo(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-base)] px-7 py-3.5 text-base font-semibold text-[var(--color-text)] dark:text-[var(--color-text-dark)] ring-2 ring-[var(--color-primary)]/30 hover:ring-[var(--color-primary)]/50 hover:bg-[var(--color-primary)]/5 dark:hover:bg-[var(--color-primary)]/10 active:translate-y-px transition-all"
                >
                  <Play className="size-4 text-[var(--color-primary)]" />
                  Watch Demo
                </button>
              </div>
            </FadeIn>

            <FadeIn delay={0.4}>
              <div className="mt-10 flex items-center gap-6 text-sm text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">
                <div className="flex items-center gap-1.5">
                  <svg className="size-4 text-green-500" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8l4 4 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  14-day free trial
                </div>
                <div className="flex items-center gap-1.5">
                  <svg className="size-4 text-green-500" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8l4 4 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  No credit card required
                </div>
              </div>
            </FadeIn>
          </div>

          {/* Dashboard mockup */}
          <FadeIn delay={0.3} direction="right">
            <FloatingAnimation>
              <DashboardMockup />
            </FloatingAnimation>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}
