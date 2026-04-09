"use client";

import { FadeIn, motion } from "../motion";
import { useInView } from "framer-motion";
import { useRef } from "react";
import { Check, X, Minus } from "lucide-react";

type CellValue = true | false | "partial" | string;

interface ComparisonRow {
  feature: string;
  trackflow: CellValue;
  hubstaff: CellValue;
  timedoctor: CellValue;
}

const rows: ComparisonRow[] = [
  { feature: "Time Tracking", trackflow: true, hubstaff: true, timedoctor: true },
  { feature: "Activity Monitoring", trackflow: true, hubstaff: true, timedoctor: true },
  { feature: "Per-Display Screenshots", trackflow: true, hubstaff: false, timedoctor: false },
  { feature: "Never Loses Data on Network Drop", trackflow: true, hubstaff: false, timedoctor: false },
  { feature: "Crash-Proof Local-First Timer", trackflow: true, hubstaff: false, timedoctor: false },
  { feature: "Agent RAM Usage (Idle)", trackflow: "< 150MB", hubstaff: "~400MB", timedoctor: "~600MB" },
  { feature: "SAML2 SSO (No Premium Tier)", trackflow: true, hubstaff: "Enterprise only", timedoctor: "Enterprise only" },
  { feature: "Built-in Leave Management", trackflow: true, hubstaff: false, timedoctor: false },
  { feature: "Built-in Attendance Tracking", trackflow: true, hubstaff: false, timedoctor: false },
  { feature: "Payroll Runs from Tracked Hours", trackflow: true, hubstaff: "partial", timedoctor: false },
  { feature: "Employee Sees Their Own Data", trackflow: true, hubstaff: "partial", timedoctor: false },
  { feature: "Attendance & Shifts", trackflow: true, hubstaff: false, timedoctor: false },
  { feature: "Multi-Organization Login", trackflow: true, hubstaff: false, timedoctor: false },
  { feature: "Employee Records & Docs", trackflow: true, hubstaff: false, timedoctor: false },
  { feature: "Encrypted Salary Data", trackflow: true, hubstaff: false, timedoctor: false },
  { feature: "Price per seat (mid tier)", trackflow: "See pricing", hubstaff: "$10/user/mo", timedoctor: "$11/user/mo" },
];

function CellIcon({ value }: { value: CellValue }) {
  if (value === true) {
    return (
      <div className="inline-flex items-center justify-center size-6 rounded-full bg-green-500/10">
        <Check className="size-3.5 text-green-600 dark:text-green-400" />
      </div>
    );
  }
  if (value === false) {
    return (
      <div className="inline-flex items-center justify-center size-6 rounded-full bg-red-500/10">
        <X className="size-3.5 text-red-500" />
      </div>
    );
  }
  if (value === "partial") {
    return (
      <div className="inline-flex items-center justify-center size-6 rounded-full bg-amber-500/10">
        <Minus className="size-3.5 text-amber-500" />
      </div>
    );
  }
  return (
    <span className="text-xs text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">{value}</span>
  );
}

export function Comparison() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section id="comparison" className="py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <FadeIn>
          <div className="text-center max-w-2xl mx-auto mb-16">
            <p className="text-sm font-semibold uppercase tracking-wider text-[var(--color-primary)] mb-3">
              Comparison
            </p>
            <h2 className="text-3xl md:text-4xl font-bold text-[var(--color-text)] dark:text-[var(--color-text-dark)]">
              Why Teams Switch to TrackFlow
            </h2>
            <p className="mt-4 text-lg text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">
              We built what Hubstaff and Time Doctor refused to.
            </p>
          </div>
        </FadeIn>

        <FadeIn>
          <div className="overflow-x-auto" ref={ref}>
            <table className="w-full min-w-[600px]">
              <thead>
                <tr>
                  <th className="text-left py-4 pr-4 text-sm font-medium text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">
                    Feature
                  </th>
                  <th className="py-4 px-4 text-center">
                    <div className="inline-flex flex-col items-center">
                      <span className="text-sm font-bold text-[var(--color-primary)]">TrackFlow</span>
                    </div>
                  </th>
                  <th className="py-4 px-4 text-center text-sm font-medium text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">
                    Hubstaff
                  </th>
                  <th className="py-4 px-4 text-center text-sm font-medium text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">
                    Time Doctor
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <motion.tr
                    key={row.feature}
                    initial={{ opacity: 0, x: -20 }}
                    animate={isInView ? { opacity: 1, x: 0 } : {}}
                    transition={{ delay: i * 0.05, duration: 0.4 }}
                    className="border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)]"
                  >
                    <td className="py-3.5 pr-4 text-sm font-medium text-[var(--color-text)] dark:text-[var(--color-text-dark)]">
                      {row.feature}
                    </td>
                    <td className="py-3.5 px-4 text-center bg-[var(--color-primary)]/[0.08]">
                      <CellIcon value={row.trackflow} />
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <CellIcon value={row.hubstaff} />
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <CellIcon value={row.timedoctor} />
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
