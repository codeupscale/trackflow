"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { usePermissionStore } from "@/stores/permission-store";

const REPORT_TABS = [
    { name: "Overview", href: "/reports" },
    { name: "Project Time", href: "/reports/project-time" },
    { name: "App Usage", href: "/reports/app-usage" },
] as const;

/** Cross-links between /reports, /reports/project-time, and /reports/app-usage. */
export function ReportsSectionNav() {
    const pathname = usePathname();
    const { hasPermission } = usePermissionStore();

    if (!hasPermission("reports.view")) {
        return null;
    }

    return (
        <nav
            aria-label="Reports sections"
            className="flex w-fit flex-wrap gap-1 rounded-lg border border-border bg-muted/50 p-1"
        >
            {REPORT_TABS.map((tab) => {
                const isActive =
                    pathname === tab.href ||
                    pathname.startsWith(`${tab.href}/`);

                return (
                    <Link
                        key={tab.href}
                        href={tab.href}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                            isActive
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                    >
                        {tab.name}
                    </Link>
                );
            })}
        </nav>
    );
}
