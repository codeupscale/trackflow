"use client";

import { FadeIn, StaggerChildren, StaggerItem, ScaleOnHover } from "../motion";
import { Check } from "lucide-react";

const tiers = [
  {
    name: "Starter",
    price: "$5",
    period: "/user/mo",
    description: "For small teams getting started with time tracking.",
    features: [
      "Time tracking",
      "Basic activity monitoring",
      "Weekly reports",
      "3 projects",
      "Email support",
      "7-day data retention",
    ],
    cta: "Start Free Trial",
    highlighted: false,
  },
  {
    name: "Pro",
    price: "$10",
    period: "/user/mo",
    description: "Everything you need for a fully managed workforce.",
    features: [
      "Everything in Starter",
      "Screenshot capture",
      "HR modules (Leave, Payroll, Attendance, Shifts)",
      "Unlimited projects",
      "Employee records & documents",
      "Advanced reports & CSV/PDF export",
      "Priority support",
      "90-day data retention",
    ],
    cta: "Start Free Trial",
    highlighted: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    description: "For organizations with advanced security and compliance needs.",
    features: [
      "Everything in Pro",
      "SAML2 SSO",
      "Custom data retention",
      "Dedicated account manager",
      "SLA guarantee (99.9%)",
      "Custom integrations",
      "On-premise option",
      "Unlimited data retention",
    ],
    cta: "Contact Sales",
    highlighted: false,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <FadeIn>
          <div className="text-center max-w-2xl mx-auto mb-16">
            <p className="text-sm font-semibold uppercase tracking-wider text-[var(--color-primary)] mb-3">
              Pricing
            </p>
            <h2 className="text-3xl md:text-4xl font-bold text-[var(--color-text)] dark:text-[var(--color-text-dark)]">
              Simple pricing, no surprises
            </h2>
            <p className="mt-4 text-lg text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">
              Every plan includes a 14-day free trial. No credit card required.
            </p>
          </div>
        </FadeIn>

        <StaggerChildren className="grid md:grid-cols-3 gap-6 items-start" staggerDelay={0.15}>
          {tiers.map((tier) => (
            <StaggerItem key={tier.name}>
              <ScaleOnHover>
                <div
                  className={`rounded-[var(--radius-xl)] p-px ${
                    tier.highlighted
                      ? "bg-gradient-to-b from-[var(--color-primary)] to-[var(--color-primary-dark)]"
                      : "bg-[var(--color-border)] dark:bg-[var(--color-border-dark)]"
                  }`}
                >
                  <div className="rounded-[calc(var(--radius-xl)-1px)] bg-[var(--color-surface)] dark:bg-[var(--color-surface-dark)] p-8 h-full flex flex-col">
                    {tier.highlighted && (
                      <div className="text-xs font-bold uppercase tracking-widest text-[var(--color-primary)] mb-3">
                        Most Popular
                      </div>
                    )}

                    <h3 className="text-xl font-bold text-[var(--color-text)] dark:text-[var(--color-text-dark)]">
                      {tier.name}
                    </h3>

                    <div className="mt-4 flex items-baseline gap-1">
                      <span className="text-4xl font-extrabold text-[var(--color-text)] dark:text-[var(--color-text-dark)]">
                        {tier.price}
                      </span>
                      {tier.period && (
                        <span className="text-sm text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">
                          {tier.period}
                        </span>
                      )}
                    </div>

                    <p className="mt-3 text-sm text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">
                      {tier.description}
                    </p>

                    <ul className="mt-6 space-y-3 flex-1">
                      {tier.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2.5">
                          <div className="inline-flex items-center justify-center size-5 rounded-full bg-[var(--color-primary)]/10 shrink-0 mt-0.5">
                            <Check className="size-3 text-[var(--color-primary)]" />
                          </div>
                          <span className="text-sm text-[var(--color-text)] dark:text-[var(--color-text-dark)]">
                            {feature}
                          </span>
                        </li>
                      ))}
                    </ul>

                    <a
                      href="#cta"
                      className={`mt-8 inline-flex items-center justify-center rounded-[var(--radius-base)] px-6 py-3 text-sm font-semibold transition-all active:translate-y-px ${
                        tier.highlighted
                          ? "bg-[var(--color-primary)] text-white shadow-lg shadow-[var(--color-primary)]/25 hover:bg-[var(--color-primary-dark)]"
                          : "ring-1 ring-[var(--color-border)] dark:ring-[var(--color-border-dark)] text-[var(--color-text)] dark:text-[var(--color-text-dark)] hover:bg-[var(--color-surface-elevated)] dark:hover:bg-[var(--color-surface-elevated-dark)]"
                      }`}
                    >
                      {tier.cta}
                    </a>
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
