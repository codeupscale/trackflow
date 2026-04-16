"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { FadeIn, FloatingAnimation } from "../motion";
import { Play, ArrowRight, Calendar, DollarSign, Download, CheckCircle2 } from "lucide-react";
import { DemoModal } from "../demo-modal";

/* ─── Notification sequence ─── */
const NOTIFICATIONS = [
  { text: "Timer Started", dot: "bg-green-500" },
  { text: "Screenshot Captured", dot: "bg-amber-500" },
  { text: "Leave Approved", dot: "bg-green-500" },
  { text: "Payslip Ready", dot: "bg-[var(--color-primary)]" },
  { text: "Weekly Report Ready", dot: "bg-cyan-500" },
] as const;

/* ─── Helper: format seconds to HH:MM:SS ─── */
function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/* ─── Screen 1: Time Tracking ─── */
function TimeTrackingScreen({
  timer,
  bars,
  active,
  tasks,
  screenshots,
}: {
  timer: number;
  bars: number[];
  active: number;
  tasks: number;
  screenshots: number;
}) {
  return (
    <>
      {/* Timer display */}
      <div className="text-center py-3">
        <div
          className="font-mono text-4xl font-bold tracking-wider text-[var(--color-text)] dark:text-[var(--color-text-dark)]"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {formatTime(timer)}
        </div>
        <div className="text-sm text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)] mt-1">
          TrackFlow Marketing Site
        </div>
      </div>

      {/* Activity bar chart */}
      <div className="flex items-end gap-1 h-16 px-2">
        {bars.map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-sm"
            style={{
              height: `${h}%`,
              transition: "height 0.4s ease",
              backgroundColor:
                h > 80
                  ? "oklch(0.555 0.163 48.998)"
                  : h > 60
                    ? "oklch(0.555 0.163 48.998 / 0.6)"
                    : "oklch(0.555 0.163 48.998 / 0.25)",
            }}
          />
        ))}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-[var(--radius-base)] bg-[var(--color-surface-elevated)] dark:bg-[var(--color-surface-dark)] p-3 text-center">
          <div
            className="font-mono text-lg font-bold text-green-600 dark:text-green-400"
            style={{ transition: "opacity 0.3s ease", fontVariantNumeric: "tabular-nums" }}
          >
            {active}%
          </div>
          <div className="text-xs text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">Active</div>
        </div>
        <div className="rounded-[var(--radius-base)] bg-[var(--color-surface-elevated)] dark:bg-[var(--color-surface-dark)] p-3 text-center">
          <div className="font-mono text-lg font-bold text-[var(--color-primary)]" style={{ fontVariantNumeric: "tabular-nums" }}>
            {tasks}
          </div>
          <div className="text-xs text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">Tasks</div>
        </div>
        <div className="rounded-[var(--radius-base)] bg-[var(--color-surface-elevated)] dark:bg-[var(--color-surface-dark)] p-3 text-center">
          <div className="font-mono text-lg font-bold text-[var(--color-accent-cyan)]" style={{ fontVariantNumeric: "tabular-nums" }}>
            {screenshots}
          </div>
          <div className="text-xs text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">Screenshots</div>
        </div>
      </div>
    </>
  );
}

/* ─── Screen 2: Leave Management ─── */
function LeaveScreen() {
  const leaves = [
    { name: "Sarah M.", type: "Annual Leave", days: "3 days", status: "Approved", statusColor: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" },
    { name: "John D.", type: "Sick Leave", days: "1 day", status: "Pending", statusColor: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" },
    { name: "Emma K.", type: "Personal", days: "2 days", status: "Approved", statusColor: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" },
  ];
  return (
    <>
      <div className="flex items-center gap-2 py-2">
        <Calendar className="size-5 text-[var(--color-primary)]" />
        <span className="font-semibold text-sm text-[var(--color-text)] dark:text-[var(--color-text-dark)]">Leave Overview</span>
      </div>
      <div className="flex flex-col gap-2.5">
        {leaves.map((l) => (
          <div key={l.name} className="flex items-center justify-between rounded-[var(--radius-base)] bg-[var(--color-surface-elevated)] dark:bg-[var(--color-surface-dark)] px-3 py-2.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold text-[var(--color-text)] dark:text-[var(--color-text-dark)]">{l.name}</span>
              <span className="text-[11px] text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">
                {l.type} &middot; {l.days}
              </span>
            </div>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${l.statusColor}`}>{l.status}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3 pt-1">
        <div className="rounded-[var(--radius-base)] bg-amber-50 dark:bg-amber-900/20 p-2.5 text-center">
          <div className="font-mono text-lg font-bold text-amber-600 dark:text-amber-400">8</div>
          <div className="text-[10px] text-amber-600/70 dark:text-amber-400/70">Pending</div>
        </div>
        <div className="rounded-[var(--radius-base)] bg-green-50 dark:bg-green-900/20 p-2.5 text-center">
          <div className="font-mono text-lg font-bold text-green-600 dark:text-green-400">24</div>
          <div className="text-[10px] text-green-600/70 dark:text-green-400/70">Approved</div>
        </div>
        <div className="rounded-[var(--radius-base)] bg-red-50 dark:bg-red-900/20 p-2.5 text-center">
          <div className="font-mono text-lg font-bold text-red-600 dark:text-red-400">3</div>
          <div className="text-[10px] text-red-600/70 dark:text-red-400/70">Rejected</div>
        </div>
      </div>
    </>
  );
}

/* ─── Screen 3: Payroll ─── */
function PayrollScreen() {
  const payslips = [
    { name: "Alex R.", amount: "$4,200", status: "Processed", statusColor: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" },
    { name: "Maria S.", amount: "$3,800", status: "Processed", statusColor: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" },
    { name: "Tom W.", amount: "$5,100", status: "Processing...", statusColor: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" },
  ];
  return (
    <>
      <div className="flex items-center gap-2 py-2">
        <DollarSign className="size-5 text-[var(--color-primary)]" />
        <span className="font-semibold text-sm text-[var(--color-text)] dark:text-[var(--color-text-dark)]">Payroll &middot; March 2026</span>
      </div>
      {/* Progress bar */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">
          <span>Processing: 18/24 employees</span>
          <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">75%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-[var(--color-surface-elevated)] dark:bg-[var(--color-surface-dark)] overflow-hidden">
          <div className="h-full rounded-full bg-amber-500" style={{ width: "75%", transition: "width 0.6s ease" }} />
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        {payslips.map((p) => (
          <div key={p.name} className="flex items-center justify-between rounded-[var(--radius-base)] bg-[var(--color-surface-elevated)] dark:bg-[var(--color-surface-dark)] px-3 py-2.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold text-[var(--color-text)] dark:text-[var(--color-text-dark)]">{p.name}</span>
              <span className="text-[11px] font-mono text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">{p.amount}</span>
            </div>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${p.statusColor}`}>{p.status}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between rounded-[var(--radius-base)] bg-[var(--color-surface-elevated)] dark:bg-[var(--color-surface-dark)] px-3 py-2.5 text-xs">
        <span className="font-semibold text-[var(--color-text)] dark:text-[var(--color-text-dark)]">Total: $94,200</span>
        <span className="text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">Run by Admin</span>
      </div>
    </>
  );
}

/* ─── Main Animated Dashboard Mockup ─── */
function DashboardMockup() {
  /* Timer state */
  const [timer, setTimer] = useState(0);
  const [timerFlash, setTimerFlash] = useState(false);

  /* Activity bars */
  const [bars, setBars] = useState<number[]>([65, 80, 45, 90, 70, 85, 55, 92, 78, 60, 88, 72, 95, 68, 82, 50, 75, 90, 63, 87]);

  /* Stats */
  const [active, setActive] = useState(87);
  const [tasks, setTasks] = useState(12);
  const [screenshots, setScreenshots] = useState(0);

  /* Notification */
  const [notifIndex, setNotifIndex] = useState(0);
  const [notifVisible, setNotifVisible] = useState(true);

  /* Screen cycling */
  const [activeScreen, setActiveScreen] = useState(0);
  const [screenVisible, setScreenVisible] = useState(true);

  /* Refs for cleanup */
  const intervalsRef = useRef<ReturnType<typeof setInterval>[]>([]);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const addInterval = useCallback((fn: () => void, ms: number) => {
    const id = setInterval(fn, ms);
    intervalsRef.current.push(id);
    return id;
  }, []);

  const addTimeout = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    timeoutsRef.current.push(id);
    return id;
  }, []);

  useEffect(() => {
    /* 1. Timer - ticks every second */
    addInterval(() => {
      setTimer((t) => t + 1);
    }, 1000);

    /* Timer flash at ~8s */
    addTimeout(() => {
      setTimerFlash(true);
      addTimeout(() => setTimerFlash(false), 1500);
    }, 8000);

    /* 2. Activity bars - shift left + new bar every 2s */
    addInterval(() => {
      setBars((prev) => {
        const next = [...prev.slice(1), Math.floor(Math.random() * 55) + 40];
        return next;
      });
    }, 2000);

    /* 3. Active % fluctuates every 3s */
    addInterval(() => {
      setActive(Math.floor(Math.random() * 13) + 82);
    }, 3000);

    /* 3. Screenshots increment every 4s */
    addInterval(() => {
      setScreenshots((s) => (s >= 30 ? 0 : s + 1));
    }, 4000);

    /* 3. Tasks bump every 10s */
    addInterval(() => {
      setTasks(13);
      addTimeout(() => setTasks(12), 3000);
    }, 10000);

    /* 4. Notification sequence */
    const NOTIF_STAY = 3000;
    const NOTIF_GAP = 1500;
    const NOTIF_CYCLE = NOTIF_STAY + NOTIF_GAP;
    addInterval(() => {
      /* fade out current */
      setNotifVisible(false);
      addTimeout(() => {
        setNotifIndex((i) => (i + 1) % NOTIFICATIONS.length);
        setNotifVisible(true);
      }, NOTIF_GAP);
    }, NOTIF_CYCLE);

    /* 5. Screen cycling every 8s */
    addInterval(() => {
      setScreenVisible(false);
      addTimeout(() => {
        setActiveScreen((s) => (s + 1) % 3);
        setScreenVisible(true);
      }, 500);
    }, 8000);

    return () => {
      intervalsRef.current.forEach(clearInterval);
      timeoutsRef.current.forEach(clearTimeout);
    };
  }, [addInterval, addTimeout]);

  const notif = NOTIFICATIONS[notifIndex];

  return (
    <div className="relative w-full max-w-lg mx-auto">
      {/* Main dashboard card */}
      <div className="rounded-[var(--radius-xl)] bg-[var(--color-surface)] dark:bg-[var(--color-surface-elevated-dark)] ring-1 ring-[var(--color-border)] dark:ring-[var(--color-border-dark)] shadow-2xl p-6 flex flex-col gap-5">
        {/* Header bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-full bg-[var(--color-primary)]/20 flex items-center justify-center">
              <div className="size-4 rounded-full bg-[var(--color-primary)]" />
            </div>
            <div>
              <div className="h-3 w-24 rounded-full bg-[var(--color-text)]/10 dark:bg-white/10" />
              <div className="h-2 w-16 rounded-full bg-[var(--color-text)]/5 dark:bg-white/5 mt-1.5" />
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            {/* LIVE badge */}
            <div className="flex items-center gap-1.5 rounded-full bg-green-500/10 px-2.5 py-1">
              <div className="size-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-green-600 dark:text-green-400">Live</span>
            </div>
            {/* Tracking badge with flash */}
            <div
              className="flex items-center gap-1.5 transition-all duration-300"
              style={{
                filter: timerFlash ? "brightness(1.4)" : "none",
              }}
            >
              <div className="size-2 rounded-full bg-green-500" style={{ boxShadow: timerFlash ? "0 0 8px 2px rgba(34,197,94,0.6)" : "none", transition: "box-shadow 0.3s ease" }} />
              <span className="text-xs font-mono text-green-600 dark:text-green-400">Tracking</span>
            </div>
          </div>
        </div>

        {/* Screen content area with cross-fade */}
        <div className="relative min-h-[240px]">
          <div
            className="flex flex-col gap-5"
            style={{
              opacity: screenVisible ? 1 : 0,
              transform: screenVisible ? "translateY(0)" : "translateY(8px)",
              transition: "opacity 0.5s ease, transform 0.5s ease",
            }}
          >
            {activeScreen === 0 && (
              <TimeTrackingScreen timer={timer} bars={bars} active={active} tasks={tasks} screenshots={screenshots} />
            )}
            {activeScreen === 1 && <LeaveScreen />}
            {activeScreen === 2 && <PayrollScreen />}
          </div>
        </div>

        {/* Screen indicator dots */}
        <div className="flex items-center justify-center gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="rounded-full transition-all duration-300"
              style={{
                width: activeScreen === i ? 20 : 6,
                height: 6,
                backgroundColor: activeScreen === i ? "oklch(0.555 0.163 48.998)" : "oklch(0.555 0.163 48.998 / 0.25)",
              }}
            />
          ))}
        </div>
      </div>

      {/* Animated notification card */}
      <div
        className="absolute -top-4 -right-4 rounded-[var(--radius-lg)] bg-[var(--color-surface)] dark:bg-[var(--color-surface-elevated-dark)] ring-1 ring-[var(--color-border)] dark:ring-[var(--color-border-dark)] shadow-lg px-4 py-2.5 flex items-center gap-2 z-10"
        style={{
          opacity: notifVisible ? 1 : 0,
          transform: notifVisible ? "translateX(0)" : "translateX(16px)",
          transition: "opacity 0.4s ease, transform 0.4s ease",
        }}
      >
        <div className={`size-2 rounded-full ${notif.dot} animate-pulse`} />
        <span className="text-xs font-medium text-[var(--color-text)] dark:text-[var(--color-text-dark)]">{notif.text}</span>
      </div>
    </div>
  );
}

/* ─── OS auto-detection for download CTA ─── */
function useDetectedOS(): string {
  const [os, setOs] = useState("Download Desktop App");
  useEffect(() => {
    const ua = navigator.userAgent;
    if (/Mac/i.test(ua)) setOs("Download for macOS");
    else if (/Win/i.test(ua)) setOs("Download for Windows");
    else if (/Linux/i.test(ua)) setOs("Download for Linux");
  }, []);
  return os;
}

const trustBarItems = [
  "Never lose tracked time \u2014 even offline",
  "Under 150MB RAM \u2014 lightest agent in the market",
  "Replaces 2\u20133 tools \u2014 avg $340/yr saved per seat",
  "14-day free trial \u2014 no credit card",
];

export function Hero() {
  const [showDemo, setShowDemo] = useState(false);
  const osLabel = useDetectedOS();

  return (
    <section className="relative overflow-hidden pt-32 pb-20 md:pt-40 md:pb-28">
      <DemoModal isOpen={showDemo} onClose={() => setShowDemo(false)} />
      {/* Background gradient */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full bg-[var(--color-primary)]/5 blur-3xl" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full bg-[var(--color-accent-cyan)]/5 blur-3xl" />
      </div>

      <div className="mx-auto max-w-7xl px-6">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Text */}
          <div>
            <FadeIn>
              <div className="inline-flex items-center gap-2 rounded-full bg-[var(--color-primary)]/10 px-4 py-1.5 mb-6">
                <div className="size-1.5 rounded-full bg-[var(--color-primary)] animate-pulse" />
                <span className="text-xs font-semibold text-[var(--color-primary)] uppercase tracking-wider">
                  Now with HR Modules
                </span>
              </div>
            </FadeIn>

            <FadeIn delay={0.1}>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-[1.1] tracking-tight text-[var(--color-text)] dark:text-[var(--color-text-dark)]">
                The Only Platform That Tracks Time{" "}
                <span className="text-gradient">AND Manages Your Entire HR.</span>
              </h1>
            </FadeIn>

            <FadeIn delay={0.2}>
              <p className="mt-6 text-lg text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)] leading-relaxed max-w-xl">
                Replace your time tracker, HR tool, and payroll system with one platform. Time tracking, screenshots, activity monitoring, leave management, payroll, attendance, and shifts &mdash; all connected, all in sync.
              </p>
            </FadeIn>

            <FadeIn delay={0.3}>
              <div className="mt-8 flex flex-wrap gap-4">
                <a
                  href="#cta"
                  className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-base)] bg-[var(--color-primary)] px-7 py-3.5 text-base font-semibold text-white shadow-lg shadow-[var(--color-primary)]/25 hover:bg-[var(--color-primary-dark)] active:translate-y-px transition-all"
                >
                  Start Free Trial
                  <ArrowRight className="size-4" />
                </a>
                <button
                  onClick={() => setShowDemo(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-base)] px-7 py-3.5 text-base font-semibold text-[var(--color-text)] dark:text-[var(--color-text-dark)] ring-2 ring-[var(--color-primary)]/30 hover:ring-[var(--color-primary)]/50 hover:bg-[var(--color-primary)]/5 dark:hover:bg-[var(--color-primary)]/10 active:translate-y-px transition-all"
                >
                  <Play className="size-4 text-[var(--color-primary)]" />
                  Watch Demo
                </button>
                <a
                  href="https://github.com/codeupscale/trackflow/releases/tag/v1.0.31"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-3.5 text-sm font-medium text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)] hover:text-[var(--color-text)] dark:hover:text-[var(--color-text-dark)] transition-colors"
                >
                  <Download className="size-4" />
                  {osLabel}
                </a>
              </div>
            </FadeIn>

            {/* Trust bar */}
            <FadeIn delay={0.4}>
              <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {trustBarItems.map((item) => (
                  <div key={item} className="flex items-start gap-2 text-sm text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)]">
                    <CheckCircle2 className="size-4 shrink-0 mt-0.5 text-green-500" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </FadeIn>
          </div>

          {/* Dashboard mockup */}
          <FadeIn delay={0.3} direction="right">
            <FloatingAnimation>
              <DashboardMockup />
            </FloatingAnimation>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}
