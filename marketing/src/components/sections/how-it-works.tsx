"use client";

import { FadeIn, StaggerChildren, StaggerItem } from "../motion";
import { Download, Timer, LayoutDashboard } from "lucide-react";

const steps = [
  {
    icon: Download,
    step: "01",
    title: "Install the Desktop Agent",
    description:
      "Download for macOS, Windows, or Linux. Auto-updates, lightweight (under 150MB RAM idle), runs quietly in your system tray.",
  },
  {
    icon: Timer,
    step: "02",
    title: "Track Time & Activity",
    description:
      "Click start. Work naturally. TrackFlow captures time, activity levels, and screenshots automatically. Even offline.",
  },
  {
    icon: LayoutDashboard,
    step: "03",
    title: "Manage Everything from the Dashboard",
    description:
      "View reports, approve leave, run payroll, manage shifts, and oversee your entire workforce from one beautiful web dashboard.",
  },
];

export function HowItWorks() {
  return (
    <section className="py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <FadeIn>
          <div className="text-center max-w-2xl mx-auto mb-16">
            <p className="text-sm font-semibold uppercase tracking-wider text-[var(--color-primary)] mb-3">
              How It Works
            </p>
            <h2 className="text-3xl md:text-4xl font-bold text-[var(--color-text)] dark:text-[var(--color-text-dark)]">
              Up and running in under 5 minutes
            </h2>
          </div>
        </FadeIn>

        <StaggerChildren className="grid md:grid-cols-3 gap-8" staggerDelay={0.2}>
          {steps.map((step, index) => (
            <StaggerItem key={step.step}>
              <div className="relative text-center">
                {/* Connector line */}
                {index < steps.length - 1 && (
                  <div className="hidden md:block absolute top-12 left-[calc(50%+40px)] w-[calc(100%-80px)] h-px bg-[var(--color-border)] dark:bg-[var(--color-border-dark)]" />
                )}

                <div className="inline-flex items-center justify-center size-20 rounded-full bg-[var(--color-primary)]/10 ring-4 ring-[var(--color-surface)] dark:ring-[var(--color-surface-dark)] mb-6 relative z-10">
                  <step.icon className="size-8 text-[var(--color-primary)]" />
                </div>

                <div className="text-xs font-bold uppercase tracking-widest text-[var(--color-primary)] mb-2">
                  Step {step.step}
                </div>

                <h3 className="text-xl font-bold text-[var(--color-text)] dark:text-[var(--color-text-dark)] mb-3">
                  {step.title}
                </h3>

                <p className="text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)] leading-relaxed max-w-xs mx-auto">
                  {step.description}
                </p>
              </div>
            </StaggerItem>
          ))}
        </StaggerChildren>
      </div>
    </section>
  );
}
