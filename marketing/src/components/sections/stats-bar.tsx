"use client";

import { useRef, useEffect, useState } from "react";
import { useInView } from "framer-motion";
import { FadeIn } from "../motion";
import { Layers, Monitor, Zap, Shield } from "lucide-react";

function AnimatedCounter({ target, suffix = "", prefix = "" }: { target: number; suffix?: string; prefix?: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true });

  useEffect(() => {
    if (!isInView) return;
    let start = 0;
    const duration = 2000;
    const step = Math.ceil(target / (duration / 16));
    const timer = setInterval(() => {
      start += step;
      if (start >= target) {
        setCount(target);
        clearInterval(timer);
      } else {
        setCount(start);
      }
    }, 16);
    return () => clearInterval(timer);
  }, [isInView, target]);

  return (
    <span ref={ref} className="font-mono text-3xl md:text-4xl font-bold text-[var(--color-primary)]">
      {prefix}{count}
      {suffix}
    </span>
  );
}

const stats = [
  { icon: Layers, value: 2, suffix: "+", label: "Tools Replaced", prefix: "" },
  { icon: Zap, value: 150, suffix: "MB", label: "Lightest Agent", prefix: "< " },
  { icon: Monitor, value: 3, suffix: "", label: "Platforms", prefix: "" },
  { icon: Shield, value: 256, suffix: "-bit", label: "Encryption", prefix: "" },
];

export function StatsBar() {
  return (
    <section className="relative py-16 bg-[var(--color-surface-elevated)] dark:bg-[var(--color-surface-elevated-dark)]">
      <div className="mx-auto max-w-7xl px-6">
        <FadeIn>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="inline-flex items-center justify-center size-12 rounded-[var(--radius-lg)] bg-[var(--color-primary)]/10 mb-4">
                  <stat.icon className="size-6 text-[var(--color-primary)]" />
                </div>
                <div>
                  <AnimatedCounter target={stat.value} suffix={stat.suffix} prefix={stat.prefix} />
                </div>
                <div className="mt-1 text-sm font-medium text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
