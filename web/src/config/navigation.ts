import type { LucideIcon } from "lucide-react";
import {
    BarChart3,
    Briefcase,
    Building2,
    CalendarCheck,
    CalendarClock,
    CalendarDays,
    Camera,
    ClipboardCheck,
    Clock,
    Clock4,
    DollarSign,
    FolderOpen,
    Layers,
    LayoutDashboard,
    Megaphone,
    Palette,
    Puzzle,
    Receipt,
    Settings,
    Shield,
    Users,
    UsersRound,
} from "lucide-react";

export interface NavItem {
    name: string;
    href: string;
    icon: LucideIcon;
    requiredPermission: string;
    /** When set, the item is shown only if the user's scope for the permission
     *  meets or exceeds this level (e.g. 'project' means scope >= project). */
    requiredScope?: string;
}

export interface NavGroup {
    label: string;
    items: NavItem[];
}

export const navigationConfig: NavGroup[] = [
    {
        label: "Main",
        items: [
            {
                name: "Dashboard",
                href: "/dashboard",
                icon: LayoutDashboard,
                requiredPermission: "dashboard.view_own_stats",
            },
            {
                name: "Time Entries",
                href: "/time",
                icon: Clock,
                requiredPermission: "time_entries.view",
            },
            {
                name: "Time Approvals",
                href: "/time-entries/approvals",
                icon: ClipboardCheck,
                requiredPermission: "time_entries.approve",
            },
            {
                name: "Screenshots",
                href: "/screenshots",
                icon: Camera,
                requiredPermission: "screenshots.view",
            },
        ],
    },
    {
        label: "Analytics",
        items: [
            {
                name: "Reports",
                href: "/reports",
                icon: BarChart3,
                requiredPermission: "reports.view",
            },
            {
                name: "Projects",
                href: "/projects",
                icon: FolderOpen,
                requiredPermission: "projects.view",
            },
        ],
    },
    {
        label: "People",
        items: [
            {
                name: "Employees",
                href: "/hr/employees",
                icon: Users,
                requiredPermission: "employees.view_directory",
                requiredScope: "project",
            },
            {
                name: "Departments",
                href: "/hr/departments",
                icon: Building2,
                requiredPermission: "departments.view",
            },
            {
                name: "Positions",
                href: "/hr/positions",
                icon: Briefcase,
                requiredPermission: "positions.view",
            },
            {
                name: "Job Postings",
                href: "/hr/job-postings",
                icon: Megaphone,
                requiredPermission: "job_postings.view",
            },
        ],
    },
    {
        label: "Leave",
        items: [
            {
                name: "My Leave",
                href: "/hr/leave",
                icon: CalendarDays,
                requiredPermission: "leave.apply",
            },
            {
                name: "Leave Management",
                href: "/hr/leave/management",
                icon: ClipboardCheck,
                requiredPermission: "leave.approve",
            },
        ],
    },
    {
        label: "Attendance",
        items: [
            {
                name: "My Attendance",
                href: "/hr/attendance",
                icon: CalendarCheck,
                requiredPermission: "attendance.view",
            },
            {
                name: "Attendance Management",
                href: "/hr/attendance/management",
                icon: UsersRound,
                requiredPermission: "attendance.view",
                requiredScope: "project",
            },
        ],
    },
    {
        label: "Scheduling",
        items: [
            // These two were inverted: viewing shifts required shifts.create,
            // while MANAGING assignments required only shifts.view — which every
            // employee holds, so Shift Assignment appeared in their sidebar.
            {
                name: "Shifts",
                href: "/hr/shifts",
                icon: Clock4,
                requiredPermission: "shifts.view",
            },
            {
                name: "Shift Assignment",
                href: "/hr/shifts/management",
                icon: CalendarClock,
                requiredPermission: "shifts.manage_assignments",
            },
        ],
    },
    // Payroll is split by WHAT YOU DO, not by entity: the monthly task first,
    // configuration second. Ordered by how often each is opened — the run card
    // on /hr/payroll now guides setup, so the nav no longer has to teach the
    // sequence by its ordering.
    //
    // "Pay Periods" is deliberately absent. It listed the same periods as
    // /hr/payroll from the same hook, and the run card creates the current
    // month's period on demand, so it was a second door to one workflow. The
    // route still resolves for anyone holding a bookmark.
    {
        label: "Payroll",
        items: [
            {
                name: "Run Payroll",
                href: "/hr/payroll",
                icon: DollarSign,
                requiredPermission: "payroll.view_all",
            },
            {
                name: "My Payslips",
                href: "/hr/payroll/my-payslips",
                icon: Receipt,
                requiredPermission: "payroll.view_own",
            },
        ],
    },
    {
        label: "Payroll Setup",
        items: [
            // "Employee Salaries" is deliberately absent. The roster is a tab
            // on /hr/payroll now — assigning a salary is part of the run, not
            // a separate errand, and two doors to one table meant the payroll
            // screen sent you away mid-task. The route still redirects there
            // for anyone holding a bookmark.
            {
                name: "Salary Structures",
                href: "/hr/payroll/structures",
                icon: Layers,
                requiredPermission: "payroll.manage_structures",
            },
            {
                name: "Pay Components",
                href: "/hr/payroll/components",
                icon: Puzzle,
                requiredPermission: "payroll.manage_components",
            },
            // Presentation only — it cannot change an amount, which is why it
            // sits last and is gated on the same permission as structures.
            {
                name: "Payslip Design",
                href: "/hr/payroll/template",
                icon: Palette,
                requiredPermission: "payroll.manage_structures",
            },
        ],
    },
    {
        label: "Settings",
        items: [
            {
                name: "Roles",
                href: "/settings/roles",
                icon: Shield,
                requiredPermission: "roles.view",
            },
            {
                name: "Settings",
                href: "/settings",
                icon: Settings,
                requiredPermission: "settings.view_org",
            },
        ],
    },
];
