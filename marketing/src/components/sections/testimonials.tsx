"use client";

import { FadeIn, StaggerChildren, StaggerItem } from "../motion";
import { Star } from "lucide-react";

const testimonials = [
  {
    quote:
      "We replaced Hubstaff, BambooHR, and a spreadsheet payroll system with TrackFlow. One platform, one bill, and my team actually likes using it.",
    author: "Sarah Chen",
    role: "VP of Operations",
    company: "NovaTech Solutions",
    initials: "SC",
  },
  {
    quote:
      "The offline mode is a game-changer. Our field engineers work in areas with spotty internet, and TrackFlow never loses a minute of their time data.",
    author: "Marcus Williams",
    role: "Engineering Manager",
    company: "BuildRight Corp",
    initials: "MW",
  },
  {
    quote:
      "Setting up leave policies and running payroll used to take our HR team a full day. With TrackFlow, it takes 20 minutes. The automation is incredible.",
    author: "Priya Sharma",
    role: "HR Director",
    company: "Elevate Digital",
    initials: "PS",
  },
];

export function Testimonials() {
  return (
    <section className="py-20 md:py-28 bg-[var(--color-surface-elevated)] dark:bg-[var(--color-surface-elevated-dark)]">
      <div className="mx-auto max-w-7xl px-6">
        <FadeIn>
          <div className="text-center max-w-2xl mx-auto mb-16">
            <p className="text-sm font-semibold uppercase tracking-wider text-[var(--color-primary)] mb-3">
              Testimonials
            </p>
            <h2 className="text-3xl md:text-4xl font-bold text-[var(--color-text)] dark:text-[var(--color-text-dark)]">
              Trusted by teams who value precision
            </h2>
          </div>
        </FadeIn>

        <StaggerChildren className="grid md:grid-cols-3 gap-6" staggerDelay={0.15}>
          {testimonials.map((t) => (
            <StaggerItem key={t.author}>
              <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface)] dark:bg-[var(--color-surface-dark)] ring-1 ring-[var(--color-border)] dark:ring-[var(--color-border-dark)] p-8 h-full flex flex-col">
                {/* Stars */}
                <div className="flex gap-0.5 mb-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="size-4 fill-[var(--color-primary)] text-[var(--color-primary)]" />
                  ))}
                </div>

                <blockquote className="text-[var(--color-text)] dark:text-[var(--color-text-dark)] leading-relaxed flex-1">
                  &ldquo;{t.quote}&rdquo;
                </blockquote>

                <div className="mt-6 flex items-center gap-3">
                  <div className="inline-flex items-center justify-center size-10 rounded-full bg-[var(--color-primary)]/10 text-sm font-bold text-[var(--color-primary)]">
                    {t.initials}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-[var(--color-text)] dark:text-[var(--color-text-dark)]">
                      {t.author}
                    </div>
                    <div className="text-xs text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">
                      {t.role}, {t.company}
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
