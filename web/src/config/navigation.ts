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
    {
        label: "Payroll",
        items: [
            {
                name: "Payroll",
                href: "/hr/payroll",
                icon: DollarSign,
                requiredPermission: "payroll.view_all",
            },
            {
                name: "Pay Periods",
                href: "/hr/payroll/periods",
                icon: CalendarDays,
                requiredPermission: "payroll.run",
            },
            {
                name: "My Payslips",
                href: "/hr/payroll/my-payslips",
                icon: Receipt,
                requiredPermission: "payroll.view_own",
            },
            {
                name: "Structures",
                href: "/hr/payroll/structures",
                icon: Layers,
                requiredPermission: "payroll.manage_structures",
            },
            {
                name: "Components",
                href: "/hr/payroll/components",
                icon: Puzzle,
                requiredPermission: "payroll.manage_components",
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
