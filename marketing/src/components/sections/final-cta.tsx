"use client";

import { FadeIn } from "../motion";
import { ArrowRight, Download } from "lucide-react";

export function FinalCta() {
  return (
    <section id="cta" className="py-20 md:py-28 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-[var(--color-primary)]/5 via-transparent to-[var(--color-accent-cyan)]/5" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-[var(--color-primary)]/5 blur-3xl -z-10" />

      <div className="mx-auto max-w-3xl px-6 text-center">
        <FadeIn>
          <h2 className="text-3xl md:text-5xl font-extrabold text-[var(--color-text)] dark:text-[var(--color-text-dark)] leading-tight">
            One Platform. One Price. No Compromises.
          </h2>
          <p className="mt-4 text-lg text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)] max-w-xl mx-auto">
            Join teams who replaced multiple tools with TrackFlow.
          </p>
        </FadeIn>

        <FadeIn delay={0.15}>
          <form
            onSubmit={(e) => e.preventDefault()}
            className="mt-8 flex flex-col sm:flex-row gap-3 max-w-md mx-auto"
          >
            <input
              type="email"
              placeholder="Enter your work email"
              className="flex-1 rounded-[var(--radius-base)] bg-[var(--color-surface)] dark:bg-[var(--color-surface-elevated-dark)] ring-1 ring-[var(--color-border)] dark:ring-[var(--color-border-dark)] px-4 py-3 text-sm text-[var(--color-text)] dark:text-[var(--color-text-dark)] placeholder:text-[var(--color-text-muted)] dark:placeholder:text-[var(--color-text-muted-dark)] outline-none focus:ring-2 focus:ring-[var(--color-primary)] transition-shadow"
              required
            />
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-base)] bg-[var(--color-primary)] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[var(--color-primary)]/25 hover:bg-[var(--color-primary-dark)] active:translate-y-px transition-all whitespace-nowrap"
            >
              Get Started
              <ArrowRight className="size-4" />
            </button>
          </form>
        </FadeIn>

        <FadeIn delay={0.2}>
          <div className="mt-6 flex items-center justify-center gap-6 text-sm text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">
            <div className="flex items-center gap-1.5">
              <svg className="size-4 text-green-500" viewBox="0 0 16 16" fill="none">
                <path d="M3 8l4 4 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Free 14-day trial
            </div>
            <div className="flex items-center gap-1.5">
              <svg className="size-4 text-green-500" viewBox="0 0 16 16" fill="none">
                <path d="M3 8l4 4 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Cancel anytime
            </div>
            <div className="flex items-center gap-1.5">
              <svg className="size-4 text-green-500" viewBox="0 0 16 16" fill="none">
                <path d="M3 8l4 4 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              No credit card
            </div>
          </div>
        </FadeIn>

        {/* Second CTA track */}
        <FadeIn delay={0.3}>
          <div className="mt-10 flex flex-col items-center gap-4">
            <div className="flex items-center gap-4 text-sm text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">
              <div className="h-px w-10 bg-[var(--color-border)] dark:bg-[var(--color-border-dark)]" />
              <span>OR</span>
              <div className="h-px w-10 bg-[var(--color-border)] dark:bg-[var(--color-border-dark)]" />
            </div>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <a
                href="https://github.com/codeupscale/trackflow/releases/tag/v1.0.31"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-base)] px-6 py-3 text-sm font-semibold text-[var(--color-text)] dark:text-[var(--color-text-dark)] ring-2 ring-[var(--color-primary)]/30 hover:ring-[var(--color-primary)]/50 hover:bg-[var(--color-primary)]/5 dark:hover:bg-[var(--color-primary)]/10 active:translate-y-px transition-all"
              >
                <Download className="size-4" />
                Download Desktop App
              </a>
              <a
                href="https://trackflow.codeupscale.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-base)] px-6 py-3 text-sm font-semibold text-[var(--color-text)] dark:text-[var(--color-text-dark)] ring-2 ring-[var(--color-primary)]/30 hover:ring-[var(--color-primary)]/50 hover:bg-[var(--color-primary)]/5 dark:hover:bg-[var(--color-primary)]/10 active:translate-y-px transition-all"
              >
                <ArrowRight className="size-4" />
                See Live Demo
              </a>
            </div>
            <p className="text-xs text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">
              Already have an account?{" "}
              <a
                href="https://trackflow.codeupscale.com/login"
                className="text-[var(--color-primary)] hover:underline"
              >
                Log in &rarr;
              </a>
            </p>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
