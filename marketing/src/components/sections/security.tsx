"use client";

import { FadeIn, StaggerChildren, StaggerItem } from "../motion";
import { Shield, Lock, FileCheck, ScrollText, Users, Trash2 } from "lucide-react";

const securityFeatures = [
  {
    icon: Shield,
    title: "SAML2 SSO",
    description: "Enterprise single sign-on included in every plan. No premium tier required.",
  },
  {
    icon: Lock,
    title: "AES-256-GCM Encryption",
    description: "Salary data, bank details, and tokens encrypted at rest with hardware-grade encryption.",
  },
  {
    icon: FileCheck,
    title: "GDPR Compliant",
    description: "Full data export and deletion capabilities. Your data, your control, always.",
  },
  {
    icon: ScrollText,
    title: "Audit Logs",
    description: "Every action logged with user, timestamp, and IP. Complete accountability trail.",
  },
  {
    icon: Users,
    title: "Role-Based Access",
    description: "Granular permissions: owner, admin, manager, employee. Field-level authorization on sensitive data.",
  },
  {
    icon: Trash2,
    title: "Data Retention Policies",
    description: "Configurable retention windows. Automatic cleanup of old screenshots and activity data.",
  },
];

export function Security() {
  return (
    <section className="py-20 md:py-28 bg-[var(--color-surface-elevated)] dark:bg-[var(--color-surface-elevated-dark)]">
      <div className="mx-auto max-w-7xl px-6">
        <FadeIn>
          <div className="text-center max-w-2xl mx-auto mb-16">
            <p className="text-sm font-semibold uppercase tracking-wider text-[var(--color-primary)] mb-3">
              Security & Compliance
            </p>
            <h2 className="text-3xl md:text-4xl font-bold text-[var(--color-text)] dark:text-[var(--color-text-dark)]">
              Enterprise security without the enterprise price
            </h2>
            <p className="mt-4 text-lg text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">
              Every feature below ships on every plan. Security is not an upsell.
            </p>
          </div>
        </FadeIn>

        <StaggerChildren className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6" staggerDelay={0.1}>
          {securityFeatures.map((feature) => (
            <StaggerItem key={feature.title}>
              <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface)] dark:bg-[var(--color-surface-dark)] ring-1 ring-[var(--color-border)] dark:ring-[var(--color-border-dark)] p-6 h-full">
                <div className="inline-flex items-center justify-center size-10 rounded-[var(--radius-base)] bg-[var(--color-primary)]/10 mb-4">
                  <feature.icon className="size-5 text-[var(--color-primary)]" />
                </div>
                <h3 className="text-base font-bold text-[var(--color-text)] dark:text-[var(--color-text-dark)] mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)] leading-relaxed">
                  {feature.description}
                </p>
              </div>
            </StaggerItem>
          ))}
        </StaggerChildren>
      </div>
    </section>
  );
}
