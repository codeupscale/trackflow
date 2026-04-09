import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "TrackFlow — Track Time. Monitor Activity. Manage HR. One Platform.",
  description:
    "Replace your time tracker, activity monitor, screenshot tool, leave manager, and payroll system with TrackFlow. Built for teams that value precision and privacy.",
  keywords: [
    "time tracking",
    "activity monitoring",
    "screenshot capture",
    "HR management",
    "leave management",
    "payroll",
    "attendance",
    "shift management",
    "workforce management",
    "employee monitoring",
  ],
  openGraph: {
    title: "TrackFlow — All-in-One Workforce Management",
    description:
      "Time tracking, activity monitoring, and full HR suite in a single platform.",
    type: "website",
    url: "https://trackflow.app",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Raleway:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-[var(--color-surface)] text-[var(--color-text)] antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
