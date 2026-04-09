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
   *  meets or exceeds this level (e.g. 'team' means scope >= team). */
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
      { name: 'Screenshots', href: '/screenshots', icon: Camera, requiredPermission: 'screenshots.view' },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { name: 'Reports', href: '/reports', icon: BarChart3, requiredPermission: 'reports.view' },
      { name: 'App Usage', href: '/reports/app-usage', icon: Monitor, requiredPermission: 'reports.view' },
      { name: 'Projects', href: '/projects', icon: FolderOpen, requiredPermission: 'projects.view' },
    ],
  },
  {
    label: 'HR',
    items: [
      { name: 'Departments', href: '/hr/departments', icon: Building2, requiredPermission: 'departments.view' },
      { name: 'Positions', href: '/hr/positions', icon: Briefcase, requiredPermission: 'positions.view' },
      { name: 'Employees', href: '/hr/employees', icon: Users, requiredPermission: 'employees.view_directory' },
      { name: 'My Leave', href: '/hr/leave', icon: CalendarDays, requiredPermission: 'leave.apply' },
      { name: 'Leave Approvals', href: '/hr/leave/approvals', icon: ClipboardCheck, requiredPermission: 'leave.approve' },
      { name: 'Leave Calendar', href: '/hr/leave/calendar', icon: CalendarRange, requiredPermission: 'leave.view_calendar' },
      { name: 'Leave Types', href: '/hr/leave/types', icon: ListChecks, requiredPermission: 'leave.manage_types' },
      { name: 'Attendance', href: '/hr/attendance', icon: CalendarCheck, requiredPermission: 'attendance.view' },
      { name: 'Team Attendance', href: '/hr/attendance/team', icon: UsersRound, requiredPermission: 'attendance.view', requiredScope: 'team' },
      { name: 'Regularizations', href: '/hr/attendance/regularizations', icon: FileEdit, requiredPermission: 'attendance.approve_regularizations' },
      { name: 'Shifts', href: '/hr/shifts', icon: Clock4, requiredPermission: 'shifts.view' },
      { name: 'Shift Roster', href: '/hr/shifts/roster', icon: CalendarClock, requiredPermission: 'shifts.view' },
      { name: 'Shift Assignments', href: '/hr/shifts/assignments', icon: UserCog, requiredPermission: 'shifts.manage_assignments' },
      { name: 'Shift Swaps', href: '/hr/shifts/swaps', icon: ArrowLeftRight, requiredPermission: 'shifts.view' },
      { name: 'Payroll', href: '/hr/payroll', icon: DollarSign, requiredPermission: 'payroll.view_all' },
      { name: 'Payroll Periods', href: '/hr/payroll/periods', icon: CalendarDays, requiredPermission: 'payroll.run' },
      { name: 'My Payslips', href: '/hr/payroll/my-payslips', icon: Receipt, requiredPermission: 'payroll.view_own' },
      { name: 'Salary Structures', href: '/hr/payroll/structures', icon: Layers, requiredPermission: 'payroll.manage_structures' },
      { name: 'Pay Components', href: '/hr/payroll/components', icon: Puzzle, requiredPermission: 'payroll.manage_components' },
    ],
  },
  {
    label: 'Team',
    items: [
      { name: 'Team', href: '/team', icon: Users, requiredPermission: 'team.view_members' },
      { name: 'Roles', href: '/settings/roles', icon: Shield, requiredPermission: 'roles.view' },
      { name: 'Settings', href: '/settings', icon: Settings, requiredPermission: 'settings.view_org' },
    ],
  },
];
