// Brand colors
export const COLORS = {
  primary: "#B87333",
  primaryDark: "#965A28",
  primaryLight: "#D4944A",
  accent: "#06B6D4",
  darkBg: "#1C1917",
  darkSurface: "#292524",
  darkBorder: "#3D3835",
  white: "#FAFAF9",
  textMuted: "#A8A29E",
  green: "#22C55E",
  red: "#EF4444",
  amber: "#F59E0B",
  purple: "#8B5CF6",
  blue: "#3B82F6",
} as const;

// Video settings
export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

// Scene durations in seconds
export const SCENE_DURATIONS = {
  intro: 4,
  problem: 5,
  solution: 5,
  timeTracking: 8,
  activityMonitor: 8,
  screenshots: 6,
  dashboard: 8,
  hrSuite: 10,
  security: 5,
  comparison: 6,
  pricing: 4,
  cta: 4,
} as const;

// Total duration in frames
export const TOTAL_DURATION_FRAMES = Object.values(SCENE_DURATIONS).reduce(
  (sum, d) => sum + d * FPS,
  0
);

// Scene start frames (cumulative)
export function getSceneStart(scene: keyof typeof SCENE_DURATIONS): number {
  const keys = Object.keys(SCENE_DURATIONS) as (keyof typeof SCENE_DURATIONS)[];
  let frame = 0;
  for (const key of keys) {
    if (key === scene) return frame;
    frame += SCENE_DURATIONS[key] * FPS;
  }
  return frame;
}

// Comparison data
export const COMPARISON_ROWS = [
  { feature: "Offline Data Resilience", trackflow: true, hubstaff: false, timedoctor: false },
  { feature: "Per-Display Screenshots", trackflow: true, hubstaff: false, timedoctor: true },
  { feature: "SAML2 SSO (No Premium)", trackflow: true, hubstaff: false, timedoctor: false },
  { feature: "Built-in HR Modules", trackflow: true, hubstaff: false, timedoctor: false },
  { feature: "Built-in Payroll", trackflow: true, hubstaff: false, timedoctor: false },
  { feature: "Multi-Org Login", trackflow: true, hubstaff: false, timedoctor: false },
];

// Pricing tiers
export const PRICING_TIERS = [
  { name: "Starter", price: "$5", period: "/user/mo", highlight: false },
  { name: "Pro", price: "$10", period: "/user/mo", highlight: true },
  { name: "Enterprise", price: "Custom", period: "", highlight: false },
];

// HR modules
export const HR_MODULES = [
  { name: "Leave Management", desc: "Apply, approve, track balances", color: COLORS.amber },
  { name: "Payroll Engine", desc: "Salary structures, auto-payslips", color: COLORS.green },
  { name: "Attendance", desc: "Auto-generated from time data", color: COLORS.blue },
  { name: "Shift Management", desc: "Templates, rosters, swaps", color: COLORS.purple },
];

// Security features
export const SECURITY_FEATURES = [
  "SAML2 SSO",
  "AES-256-GCM",
  "GDPR Compliant",
  "Audit Logs",
  "Role-Based Access",
  "Data Retention",
];
