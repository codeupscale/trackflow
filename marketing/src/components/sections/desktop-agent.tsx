"use client";

import { FadeIn, FloatingAnimation } from "../motion";
import { Monitor, Cpu, Camera, Moon, WifiOff, RefreshCw, Laptop, Terminal, Download } from "lucide-react";

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

const RELEASE_URL = "https://github.com/codeupscale/trackflow/releases/tag/v1.0.31";

const platformDownloads = [
  { icon: Laptop, platform: "macOS", subtitle: "Download v1.0.31" },
  { icon: Monitor, platform: "Windows", subtitle: "Download v1.0.31" },
  { icon: Terminal, platform: "Linux", subtitle: "Download v1.0.31" },
];

export function DesktopAgent() {
  return (
    <section className="py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <FadeIn>
              <div className="flex items-center gap-3 mb-3">
                <p className="text-sm font-semibold uppercase tracking-wider text-[var(--color-primary)]">
                  Desktop Agent
                </p>
                <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-bold text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/20">
                  v1.0.31
                </span>
              </div>
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

            {/* Download buttons */}
            <FadeIn delay={0.5}>
              <div className="mt-10">
                <div className="flex flex-wrap gap-3">
                  {platformDownloads.map((dl) => (
                    <a
                      key={dl.platform}
                      href={RELEASE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group inline-flex items-center gap-3 rounded-full bg-[var(--color-text)] dark:bg-white/10 px-5 py-3 ring-1 ring-[var(--color-border)] dark:ring-[var(--color-border-dark)] hover:ring-[var(--color-primary)]/40 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--color-primary)]/10 transition-all duration-200"
                    >
                      <dl.icon className="size-5 text-white dark:text-[var(--color-text-dark)] group-hover:text-[var(--color-primary-light)] transition-colors" />
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold text-white dark:text-[var(--color-text-dark)] leading-tight">
                          {dl.platform}
                        </span>
                        <span className="text-[10px] text-white/60 dark:text-[var(--color-text-muted-dark)] leading-tight">
                          {dl.subtitle}
                        </span>
                      </div>
                      <Download className="size-4 text-white/40 dark:text-[var(--color-text-muted-dark)] group-hover:text-[var(--color-primary-light)] transition-colors" />
                    </a>
                  ))}
                </div>
                <p className="mt-4 text-xs text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">
                  Open source &middot; Free forever &middot; Auto-updates included
                </p>
              </div>
            </FadeIn>
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
