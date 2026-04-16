"use client";

import { useState } from "react";
import { FadeIn } from "../motion";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";

const faqs = [
  {
    question: "How does TrackFlow track time when I'm offline?",
    answer:
      "TrackFlow uses a local-first architecture with SQLite. When you start or stop the timer, the event is written to a local database before any network call. If you're offline, events queue up with full timestamps and sync automatically when your connection returns. Idempotency keys prevent duplicate entries.",
  },
  {
    question: "Can I use TrackFlow without the desktop agent?",
    answer:
      "Yes. The web dashboard includes a browser-based timer for manual time entry and project management. The desktop agent is optional but recommended for automatic activity monitoring, screenshot capture, and offline resilience.",
  },
  {
    question: "Is my salary and payroll data secure?",
    answer:
      "Absolutely. All salary data, bank account details, and tax IDs are encrypted at rest using AES-256-GCM encryption. These fields are never exposed in API responses in their raw form. Access is controlled by role-based permissions with field-level authorization.",
  },
  {
    question: "Can employees belong to multiple organizations?",
    answer:
      "Yes. TrackFlow supports multi-organization login. A single email can be associated with multiple organizations. Users see an org selector at login and can switch between organizations from the dashboard header without logging out.",
  },
  {
    question: "How does the screenshot feature work?",
    answer:
      "Screenshots are captured at configurable random intervals during active tracking. On multi-monitor setups, each display is captured separately. Images are uploaded to encrypted S3 storage with signed URLs that expire after 15 minutes. Employees can see their own screenshots; managers see their team's.",
  },
  {
    question: "What HR modules are included?",
    answer:
      "TrackFlow includes leave management (custom types, balances, approval workflows, team calendar), payroll (salary structures, pay components, automated runs, payslips), attendance (auto-generated from time entries, regularization requests, overtime rules), and shift management (creation, assignment, roster view, swap requests).",
  },
  {
    question: "Do I need to set up SAML2 SSO separately?",
    answer:
      "No. SAML2 SSO is included in every plan at no additional cost. Unlike competitors who gate SSO behind enterprise tiers, TrackFlow believes security features should be accessible to all teams.",
  },
  {
    question: "What happens if the desktop app crashes?",
    answer:
      "Because the timer state is persisted in local SQLite before any API call, a crash never loses your time data. When the app restarts, it reconciles local state with the server, recovers the active session, and continues tracking from where it left off.",
  },
];

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between py-5 text-left"
      >
        <span className="text-base font-semibold text-[var(--color-text)] dark:text-[var(--color-text-dark)] pr-4">
          {question}
        </span>
        <motion.div
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="shrink-0"
        >
          <ChevronDown className="size-5 text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.25, 0.4, 0.25, 1] }}
            className="overflow-hidden"
          >
            <p className="pb-5 text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)] leading-relaxed pr-12">
              {answer}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Faq() {
  return (
    <section id="faq" className="py-20 md:py-28">
      <div className="mx-auto max-w-3xl px-6">
        <FadeIn>
          <div className="text-center mb-12">
            <p className="text-sm font-semibold uppercase tracking-wider text-[var(--color-primary)] mb-3">
              FAQ
            </p>
            <h2 className="text-3xl md:text-4xl font-bold text-[var(--color-text)] dark:text-[var(--color-text-dark)]">
              Frequently asked questions
            </h2>
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <div>
            {faqs.map((faq) => (
              <FaqItem key={faq.question} {...faq} />
            ))}
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
