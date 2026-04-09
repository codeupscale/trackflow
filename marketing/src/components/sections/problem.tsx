"use client";

import { FadeIn, StaggerChildren, StaggerItem, ScaleOnHover } from "../motion";
import { Shuffle, Clock, FileText } from "lucide-react";

const problems = [
  {
    icon: Shuffle,
    title: "Scattered Tools",
    description:
      "Your team juggles 5+ apps for time tracking, screenshots, leave, payroll, and attendance. Data is everywhere, insights are nowhere.",
    color: "text-red-500",
    bg: "bg-red-500/10",
  },
  {
    icon: Clock,
    title: "Lost Time Data",
    description:
      "Offline? App crash? Network drop? Traditional trackers lose hours of work data. You pay for time you can't verify.",
    color: "text-amber-500",
    bg: "bg-amber-500/10",
  },
  {
    icon: FileText,
    title: "Manual HR Processes",
    description:
      "Leave requests via email. Payslips in spreadsheets. Attendance on paper. Your HR team spends more time on admin than on people.",
    color: "text-purple-500",
    bg: "bg-purple-500/10",
  },
];

export function Problem() {
  return (
    <section className="py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <FadeIn>
          <div className="text-center max-w-2xl mx-auto mb-16">
            <p className="text-sm font-semibold uppercase tracking-wider text-[var(--color-primary)] mb-3">
              The Problem
            </p>
            <h2 className="text-3xl md:text-4xl font-bold text-[var(--color-text)] dark:text-[var(--color-text-dark)]">
              Your workforce tools are working against you
            </h2>
            <p className="mt-4 text-lg text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">
              Fragmented tools create fragmented insights. It does not have to be this way.
            </p>
          </div>
        </FadeIn>

        <StaggerChildren className="grid md:grid-cols-3 gap-6" staggerDelay={0.15}>
          {problems.map((problem) => (
            <StaggerItem key={problem.title}>
              <ScaleOnHover>
                <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface)] dark:bg-[var(--color-surface-elevated-dark)] ring-1 ring-[var(--color-border)] dark:ring-[var(--color-border-dark)] p-8 h-full">
                  <div className={`inline-flex items-center justify-center size-12 rounded-[var(--radius-lg)] ${problem.bg} mb-5`}>
                    <problem.icon className={`size-6 ${problem.color}`} />
                  </div>
                  <h3 className="text-xl font-bold text-[var(--color-text)] dark:text-[var(--color-text-dark)] mb-3">
                    {problem.title}
                  </h3>
                  <p className="text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)] leading-relaxed">
                    {problem.description}
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
