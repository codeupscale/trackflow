'use client';

import { useState, useEffect, useRef, type ReactNode } from 'react';
import { useTimerStore } from '@/stores/timer-store';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Clock,
  Camera,
  BarChart3,
  Users,
  FolderOpen,
  Settings,
  Menu,
  ChevronLeft,
  LogOut,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { TimerWidget } from '@/components/timer-widget';
import { ErrorBoundary } from '@/components/error-boundary';
import { OfflineBanner } from '@/components/offline-banner';
import { useAuthStore } from '@/stores/auth-store';
import { useAuthGuard } from '@/hooks/use-auth-guard';
import { cn } from '@/lib/utils';

const allNavItems = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ['owner', 'admin', 'manager', 'employee'] },
  { name: 'Time', href: '/time', icon: Clock, roles: ['owner', 'admin', 'manager', 'employee'] },
  { name: 'Screenshots', href: '/screenshots', icon: Camera, roles: ['owner', 'admin', 'manager', 'employee'] },
  { name: 'Reports', href: '/reports', icon: BarChart3, roles: ['owner', 'admin', 'manager'] },
  { name: 'Team', href: '/team', icon: Users, roles: ['owner', 'admin', 'manager'] },
  { name: 'Projects', href: '/projects', icon: FolderOpen, roles: ['owner', 'admin', 'manager', 'employee'] },
  { name: 'Settings', href: '/settings', icon: Settings, roles: ['owner', 'admin', 'manager', 'employee'] },
];

function SidebarNav({
  collapsed,
  onNavClick,
  role,
}: {
  collapsed: boolean;
  onNavClick?: () => void;
  role?: string;
}) {
  const pathname = usePathname();
  const navigation = role
    ? allNavItems.filter((item) => item.roles.includes(role))
    : allNavItems;

  return (
    <nav className="flex flex-col gap-1 px-3">
      {navigation.map((item) => {
        const Icon = item.icon;
        const isActive =
          pathname === item.href || pathname.startsWith(item.href + '/');
        return (
          <Link
            key={item.name}
            href={item.href}
            onClick={onNavClick}
            title={collapsed ? item.name : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-blue-600/10 text-blue-400'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200',
              collapsed && 'justify-center px-2'
            )}
          >
            <Icon className={cn('h-4 w-4 shrink-0', isActive && 'text-blue-400')} />
            {!collapsed && <span>{item.name}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuthGuard();
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const queryClient = useQueryClient();
  const isTimerRunning = useTimerStore((s) => s.isRunning);
  const prevRunningRef = useRef(isTimerRunning);

  // BUG-002: When timer state changes (start/stop detected via polling),
  // invalidate dashboard queries so the Status card and timesheet update immediately.
  useEffect(() => {
    if (prevRunningRef.current !== isTimerRunning) {
      prevRunningRef.current = isTimerRunning;
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['time-entries-dashboard'] });
    }
  }, [isTimerRunning, queryClient]);

  const handleLogout = async () => {
    useTimerStore.getState().resetState();
    await logout();
    router.push('/login');
  };

  const userInitials =
    user?.name
      ?.split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || '??';

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="flex items-center gap-2 text-slate-400">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-blue-500" />
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950">
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'hidden lg:flex flex-col border-r border-slate-800 bg-slate-900/50 transition-all duration-300',
          collapsed ? 'w-16' : 'w-64'
        )}
      >
        {/* Logo */}
        <div
          className={cn(
            'flex items-center h-14 px-4 border-b border-slate-800',
            collapsed ? 'justify-center' : 'justify-between'
          )}
        >
          {!collapsed && (
            <Link href="/dashboard" className="text-lg font-bold text-white tracking-tight">
              TrackFlow
            </Link>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCollapsed(!collapsed)}
            className="h-8 w-8 p-0 text-slate-400 hover:text-white"
            aria-label="Toggle sidebar"
          >
            <ChevronLeft
              className={cn(
                'h-4 w-4 transition-transform',
                collapsed && 'rotate-180'
              )}
            />
          </Button>
        </div>

        {/* Navigation */}
        <div className="flex-1 py-4 overflow-y-auto">
          <SidebarNav collapsed={collapsed} role={user?.role} />
        </div>

        {/* Sidebar footer */}
        {!collapsed && (
          <div className="p-4 border-t border-slate-800">
            <p className="text-xs text-slate-500">
              {user?.organization?.name || 'Organization'}
            </p>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Top Header */}
        <header className="flex items-center justify-between h-14 px-4 lg:px-6 border-b border-slate-800 bg-slate-900/50">
          <div className="flex items-center gap-3">
            {/* Mobile Sidebar Toggle */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger
                className="lg:hidden inline-flex items-center justify-center rounded-md h-8 w-8 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                aria-label="Toggle sidebar"
              >
                <Menu className="h-5 w-5" />
              </SheetTrigger>
              <SheetContent side="left" className="w-64 bg-slate-900 border-slate-800 p-0">
                <SheetHeader className="px-4 py-4 border-b border-slate-800">
                  <SheetTitle className="text-white text-lg font-bold">TrackFlow</SheetTitle>
                </SheetHeader>
                <div className="py-4">
                  <SidebarNav collapsed={false} onNavClick={() => setMobileOpen(false)} role={user?.role} />
                </div>
              </SheetContent>
            </Sheet>
          </div>

          {/* Center: Timer Widget (single instance, responsive via flex order) */}
          <div className="flex items-center">
            <TimerWidget />
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
            <Separator orientation="vertical" className="h-6 bg-slate-800 hidden md:block" />

            {/* User Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 outline-none cursor-pointer" aria-label="User menu">
                <Avatar className="h-8 w-8 border border-slate-700">
                  <AvatarImage
                    src={user?.avatar_url || undefined}
                    alt={user?.name || 'User'}
                  />
                  <AvatarFallback className="bg-blue-600 text-white text-xs font-medium">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
                <div className="hidden md:block text-left">
                  <p className="text-sm font-medium text-slate-200 leading-none">{user?.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5 capitalize">{user?.role}</p>
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="bottom" sideOffset={8} className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium">{user?.name}</span>
                    <span className="text-xs text-muted-foreground">{user?.email}</span>
                    <span className="text-xs text-muted-foreground">
                      {user?.organization?.name}
                    </span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push('/settings')}>
                  <Settings className="h-4 w-4 mr-2" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} variant="destructive">
                  <LogOut className="h-4 w-4 mr-2" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Offline Banner */}
        <OfflineBanner />

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
