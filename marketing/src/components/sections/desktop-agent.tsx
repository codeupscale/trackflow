"use client";

import { FadeIn, FloatingAnimation } from "../motion";
import { Monitor, Cpu, Camera, Moon, WifiOff, RefreshCw } from "lucide-react";

const agentFeatures = [
  { icon: Monitor, label: "System tray app", desc: "Runs silently, one-click start/stop" },
  { icon: Cpu, label: "Lightweight", desc: "Under 150MB RAM when idle" },
  { icon: Camera, label: "Smart screenshots", desc: "Per-display, multi-monitor capture" },
  { icon: Moon, label: "Idle detection", desc: "Pauses on inactivity, discards or keeps" },
  { icon: WifiOff, label: "Offline mode", desc: "SQLite queue, syncs on reconnect" },
  { icon: RefreshCw, label: "Auto-updates", desc: "Always on the latest version" },
];

function DesktopMockup() {
  return (
    <div className="relative w-full max-w-sm mx-auto">
      <div className="rounded-[var(--radius-xl)] bg-[var(--color-surface)] dark:bg-[var(--color-surface-elevated-dark)] ring-1 ring-[var(--color-border)] dark:ring-[var(--color-border-dark)] shadow-2xl overflow-hidden">
        {/* Title bar */}
        <div className="flex items-center gap-2 px-4 py-2.5 bg-[var(--color-surface-elevated)] dark:bg-[var(--color-surface-dark)] border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
          <div className="flex gap-1.5">
            <div className="size-3 rounded-full bg-red-400" />
            <div className="size-3 rounded-full bg-amber-400" />
            <div className="size-3 rounded-full bg-green-400" />
          </div>
          <span className="text-xs text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)] ml-2 font-medium">
            TrackFlow Agent
          </span>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Timer */}
          <div className="text-center">
            <div className="text-xs text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)] mb-1">
              Current Session
            </div>
            <div className="font-mono text-3xl font-bold tracking-wider text-[var(--color-text)] dark:text-[var(--color-text-dark)]">
              02:47:33
            </div>
          </div>

          {/* Project selector */}
          <div className="rounded-[var(--radius-base)] bg-[var(--color-surface-elevated)] dark:bg-[var(--color-surface-dark)] p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="size-2 rounded-full bg-[var(--color-primary)]" />
              <span className="text-sm font-medium">Marketing Site</span>
            </div>
            <svg className="size-4 text-[var(--color-text-muted)]" viewBox="0 0 16 16" fill="none">
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          {/* Activity bar */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">Activity</span>
              <span className="font-mono font-bold text-green-600 dark:text-green-400">92%</span>
            </div>
            <div className="h-2 rounded-full bg-[var(--color-surface-elevated)] dark:bg-[var(--color-surface-dark)] overflow-hidden">
              <div className="h-full w-[92%] rounded-full bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-primary-light)]" />
            </div>
          </div>

          {/* Stop button */}
          <button className="w-full rounded-[var(--radius-base)] bg-red-500 hover:bg-red-600 text-white font-semibold py-2.5 text-sm transition-colors">
            Stop Timer
          </button>

          {/* Status */}
          <div className="flex items-center justify-center gap-1.5 text-xs text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">
            <div className="size-1.5 rounded-full bg-green-500 animate-pulse" />
            Online &middot; Last screenshot 2m ago
          </div>
        </div>
      </div>
    </div>
  );
}

export function DesktopAgent() {
  return (
    <section className="py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <FadeIn>
              <p className="text-sm font-semibold uppercase tracking-wider text-[var(--color-primary)] mb-3">
                Desktop Agent
              </p>
              <h2 className="text-3xl md:text-4xl font-bold text-[var(--color-text)] dark:text-[var(--color-text-dark)] mb-4">
                Lightweight. Invisible. Reliable.
              </h2>
              <p className="text-lg text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)] mb-8 leading-relaxed">
                The TrackFlow desktop agent sits in your system tray and captures everything
                automatically. Built on Electron with a local-first SQLite architecture
                that never loses data, even when the network drops.
              </p>
            </FadeIn>

            <div className="grid sm:grid-cols-2 gap-4">
              {agentFeatures.map((feat, i) => (
                <FadeIn key={feat.label} delay={i * 0.08}>
                  <div className="flex items-start gap-3">
                    <div className="inline-flex items-center justify-center size-8 rounded-[var(--radius-base)] bg-[var(--color-primary)]/10 shrink-0 mt-0.5">
                      <feat.icon className="size-4 text-[var(--color-primary)]" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-[var(--color-text)] dark:text-[var(--color-text-dark)]">
                        {feat.label}
                      </div>
                      <div className="text-xs text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">
                        {feat.desc}
                      </div>
                    </div>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>

          <FadeIn direction="right" delay={0.2}>
            <FloatingAnimation>
              <DesktopMockup />
            </FloatingAnimation>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}
