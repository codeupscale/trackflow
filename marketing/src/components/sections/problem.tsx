"use client";

import { FadeIn, StaggerChildren, StaggerItem, ScaleOnHover } from "../motion";
import { WifiOff, EyeOff, Cpu } from "lucide-react";

const problems = [
  {
    icon: WifiOff,
    title: "\u201cI got logged out and lost 3 hours of tracking\u201d",
    description:
      "Time Doctor and Hubstaff users report losing hours of tracked time when network hiccups trigger automatic logouts. It happens on VPN switches, sleep/wake, and server blips.",
    competitorTag: "Common with Time Doctor \u00b7 Hubstaff",
    answer: "TrackFlow\u2019s local-first SQLite timer saves every event before touching the network. VPN drops, server errors, and laptop sleeps never lose a second.",
    color: "text-red-500",
    bg: "bg-red-500/10",
  },
  {
    icon: EyeOff,
    title: "\u201cOur team refused to use it \u2014 said it felt like surveillance\u201d",
    description:
      "Fixed-interval screenshots, keyloggers, and opaque tracking create resentment. Employees push back, adoption fails, and the tool gets cancelled at renewal.",
    competitorTag: "Common with ActivTrak \u00b7 Time Doctor",
    answer: "TrackFlow gives employees full visibility into their own data. Configurable screenshot blur, transparent activity scoring, and no keylogging.",
    color: "text-amber-500",
    bg: "bg-amber-500/10",
  },
  {
    icon: Cpu,
    title: "\u201cThe desktop agent makes my laptop fan scream\u201d",
    description:
      "Competing agents regularly consume 500MB\u20131GB RAM. Developers and designers run them on MacBook Pros with fan noise audible on video calls.",
    competitorTag: "Common with Time Doctor \u00b7 Hubstaff",
    answer: "TrackFlow\u2019s agent uses under 150MB idle, under 250MB tracking. Screenshots captured in under 3 seconds. No battery drain, no fan noise.",
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
              Sound familiar? You are not alone.
            </h2>
            <p className="mt-4 text-lg text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">
              These are the top 3 reasons teams cancel their current time tracker.
            </p>
          </div>
        </FadeIn>

        <StaggerChildren className="grid md:grid-cols-3 gap-6" staggerDelay={0.15}>
          {problems.map((problem) => (
            <StaggerItem key={problem.title}>
              <ScaleOnHover>
                <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface)] dark:bg-[var(--color-surface-elevated-dark)] ring-1 ring-[var(--color-border)] dark:ring-[var(--color-border-dark)] p-8 h-full flex flex-col">
                  <div className={`inline-flex items-center justify-center size-12 rounded-[var(--radius-lg)] ${problem.bg} mb-5`}>
                    <problem.icon className={`size-6 ${problem.color}`} />
                  </div>
                  <h3 className="text-lg font-bold text-[var(--color-text)] dark:text-[var(--color-text-dark)] mb-3">
                    {problem.title}
                  </h3>
                  <p className="text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)] leading-relaxed mb-4 flex-1">
                    {problem.description}
                  </p>
                  <div className="text-xs font-medium text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)] bg-[var(--color-surface-elevated)] dark:bg-[var(--color-surface-dark)] rounded-full px-3 py-1 inline-block mb-4 w-fit">
                    {problem.competitorTag}
                  </div>
                  <div className="flex items-start gap-2 pt-3 border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
                    <span className="text-sm font-semibold text-green-600 dark:text-green-400 shrink-0">TrackFlow&apos;s answer:</span>
                    <span className="text-sm text-green-600 dark:text-green-400 leading-relaxed">{problem.answer}</span>
                  </div>
                </div>
              </ScaleOnHover>
            </StaggerItem>
          ))}
        </StaggerChildren>
      </div>
    </section>
  );
}
