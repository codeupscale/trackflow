import {
  LayoutDashboard,
  Clock,
  Camera,
  BarChart3,
  Users,
  FolderOpen,
  Settings,
  Building2,
  Briefcase,
  CalendarDays,
  ClipboardCheck,
  CalendarRange,
  ListChecks,
  CalendarCheck,
  UsersRound,
  FileEdit,
  FileBarChart2,
  SlidersHorizontal,
  Shield,
  Clock4,
  CalendarClock,
  UserCog,
  ArrowLeftRight,
  DollarSign,
  Receipt,
  Layers,
  Puzzle,
  Monitor,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

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
    label: 'Main',
    items: [
      { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, requiredPermission: 'dashboard.view_own_stats' },
      { name: 'Time Entries', href: '/time', icon: Clock, requiredPermission: 'time_entries.view' },
      // Manual time approvals — managers/admins only (time_entries.approve)
      { name: 'Time Approvals', href: '/time-entries/approvals', icon: ClipboardCheck, requiredPermission: 'time_entries.approve' },
      { name: 'Screenshots', href: '/screenshots', icon: Camera, requiredPermission: 'screenshots.view' },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { name: 'Reports', href: '/reports', icon: BarChart3, requiredPermission: 'reports.view' },
      // Project-manager time report (per-entry breakdown + CSV/PDF export)
      { name: 'Project Time', href: '/reports/project-time', icon: FileBarChart2, requiredPermission: 'reports.view' },
      { name: 'App Usage', href: '/reports/app-usage', icon: Monitor, requiredPermission: 'reports.view' },
      { name: 'Projects', href: '/projects', icon: FolderOpen, requiredPermission: 'projects.view' },
    ],
  },
  {
    label: 'HR',
    items: [
      // Employees with departments.view can see the org tree (read-only at API level)
      { name: 'Departments', href: '/hr/departments', icon: Building2, requiredPermission: 'departments.view' },
      // Positions — Owner, Org Manager, HR Manager only (Finance Manager and Employee do not have positions.view)
      { name: 'Positions', href: '/hr/positions', icon: Briefcase, requiredPermission: 'positions.view' },
      // Employees see own profile only (scoped at API level); managers+ see directory
      { name: 'Employees', href: '/hr/employees', icon: Users, requiredPermission: 'employees.view_directory', requiredScope: 'project' },
      { name: 'My Leave', href: '/hr/leave', icon: CalendarDays, requiredPermission: 'leave.apply' },
      // Leave Approvals — managers/admins only
      { name: 'Leave Approvals', href: '/hr/leave/approvals', icon: ClipboardCheck, requiredPermission: 'leave.approve' },
      { name: 'Leave Calendar', href: '/hr/leave/calendar', icon: CalendarRange, requiredPermission: 'leave.view_calendar' },
      // Leave Types — admin/HR only
      { name: 'Leave Types', href: '/hr/leave/types', icon: ListChecks, requiredPermission: 'leave.manage_types' },
      { name: 'Attendance', href: '/hr/attendance', icon: CalendarCheck, requiredPermission: 'attendance.view' },
      // Team Attendance — managers/admins only
      { name: 'Team Attendance', href: '/hr/attendance/team', icon: UsersRound, requiredPermission: 'attendance.view', requiredScope: 'project' },
      // Regularizations approvals — managers/admins only
      { name: 'Regularizations', href: '/hr/attendance/regularizations', icon: FileEdit, requiredPermission: 'attendance.approve_regularizations' },
      // Check-in Report (all-employees rollup) — HR/admin only
      { name: 'Check-in Report', href: '/hr/attendance/report', icon: FileBarChart2, requiredPermission: 'attendance.view_all' },
      // Attendance Policy settings — HR/admin only
      { name: 'Attendance Policy', href: '/hr/attendance/settings', icon: SlidersHorizontal, requiredPermission: 'attendance.manage_policy' },
      // Shifts management — managers/admins only (employees have shifts.view but NOT shifts.create)
      { name: 'Shifts', href: '/hr/shifts', icon: Clock4, requiredPermission: 'shifts.create' },
      { name: 'Shift Roster', href: '/hr/shifts/roster', icon: CalendarClock, requiredPermission: 'shifts.manage_assignments' },
      { name: 'Shift Assignments', href: '/hr/shifts/assignments', icon: UserCog, requiredPermission: 'shifts.manage_assignments' },
      // Shift Swaps — employees can request swaps (shifts.view)
      { name: 'Shift Swaps', href: '/hr/shifts/swaps', icon: ArrowLeftRight, requiredPermission: 'shifts.view' },
      // Payroll admin — managers/admins only
      { name: 'Payroll', href: '/hr/payroll', icon: DollarSign, requiredPermission: 'payroll.view_all' },
      { name: 'Payroll Periods', href: '/hr/payroll/periods', icon: CalendarDays, requiredPermission: 'payroll.run' },
      // My Payslips — all employees
      { name: 'My Payslips', href: '/hr/payroll/my-payslips', icon: Receipt, requiredPermission: 'payroll.view_own' },
      // Salary/Pay management — admin only
      { name: 'Salary Structures', href: '/hr/payroll/structures', icon: Layers, requiredPermission: 'payroll.manage_structures' },
      { name: 'Pay Components', href: '/hr/payroll/components', icon: Puzzle, requiredPermission: 'payroll.manage_components' },
    ],
  },
  {
    label: 'Team',
    items: [
      // Team page — managers/admins only (team.view_members has_scope=false; employees have no such permission at all)
      { name: 'Team', href: '/team', icon: Users, requiredPermission: 'team.view_members' },
      // Roles — admin only
      { name: 'Roles', href: '/settings/roles', icon: Shield, requiredPermission: 'roles.view' },
      // Settings — admin only
      { name: 'Settings', href: '/settings', icon: Settings, requiredPermission: 'settings.view_org' },
    ],
  },
];
