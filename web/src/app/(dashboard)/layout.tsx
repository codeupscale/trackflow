'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useTimerStore } from '@/stores/timer-store';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LogOut,
  Settings,
} from 'lucide-react';
import { TrackFlowLogo } from '@/components/ui/trackflow-logo';

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
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { TimerWidget } from '@/components/timer-widget';
import { ThemeToggle } from '@/components/theme-toggle';
import { ErrorBoundary } from '@/components/error-boundary';
import { OfflineBanner } from '@/components/offline-banner';
import { OrgSwitcher } from '@/components/org-switcher';
import { useAuthStore } from '@/stores/auth-store';
import { usePermissionStore } from '@/stores/permission-store';
import { navigationConfig } from '@/config/navigation';
import { useAuthGuard } from '@/hooks/use-auth-guard';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuthGuard();
  const { user, logout } = useAuthStore();
  const { hasPermission, hasPermissionWithScope } = usePermissionStore();
  const router = useRouter();
  const pathname = usePathname();

  // Derive current page title from pathname
  const allNavItems = navigationConfig.flatMap((g) => g.items);
  const currentPage = allNavItems.find(
    (item) => pathname === item.href || pathname.startsWith(item.href + '/')
  );

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
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
          Loading...
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider className="h-screen overflow-hidden">
      {/* Sidebar */}
      <Sidebar collapsible="icon">
        <SidebarHeader className="h-14 border-b border-sidebar-border px-3 flex items-center">
          <Link href="/dashboard" className="flex items-center">
            <TrackFlowLogo size={28} showText={true} className="group-data-[collapsible=icon]:[&>span]:hidden" />
          </Link>
        </SidebarHeader>

        <SidebarContent>
          {navigationConfig.map((group) => {
            const visibleItems = group.items.filter((item) =>
              item.requiredScope
                ? hasPermissionWithScope(item.requiredPermission, item.requiredScope)
                : hasPermission(item.requiredPermission)
            );

            if (visibleItems.length === 0) return null;

            return (
              <SidebarGroup key={group.label}>
                <SidebarGroupLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{group.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {visibleItems.map((item) => {
                      const Icon = item.icon;
                      const isActive =
                        pathname === item.href || pathname.startsWith(item.href + '/');
                      return (
                        <SidebarMenuItem key={item.name}>
                          <SidebarMenuButton
                            isActive={isActive}
                            tooltip={item.name}
                            render={<Link href={item.href} />}
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span>{item.name}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            );
          })}
        </SidebarContent>

        <SidebarFooter className="border-t border-sidebar-border">
          <SidebarMenu>
            <SidebarMenuItem>
              <div className="flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:justify-center">
                <Avatar className="h-7 w-7 border border-border">
                  <AvatarImage src={user?.avatar_url || undefined} alt={user?.name || 'User'} />
                  <AvatarFallback className="bg-blue-600 text-white text-xs font-medium">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col group-data-[collapsible=icon]:hidden">
                  <span className="text-sm font-medium text-sidebar-foreground leading-none">{user?.name}</span>
                  <span className="text-xs text-muted-foreground mt-0.5">{user?.organization?.name || 'Organization'}</span>
                </div>
              </div>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>

      {/* Main Content */}
      <SidebarInset className="flex flex-col overflow-hidden">
        {/* Top Header */}
        <header className="flex items-center justify-between h-14 px-4 md:px-6 border-b border-border bg-background shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <SidebarTrigger className="hover:bg-muted shrink-0" />
            <Separator orientation="vertical" className="h-5 hidden md:block shrink-0" />
            {/* Page title — shown on md+ screens */}
            {currentPage && (
              <span className="hidden md:block text-sm font-semibold text-foreground truncate">
                {currentPage.name}
              </span>
            )}
            <Separator orientation="vertical" className="h-5 hidden md:block shrink-0" />
            <OrgSwitcher />
          </div>

          {/* Center: Timer Widget */}
          <div className="flex items-center shrink-0">
            <TimerWidget />
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Separator orientation="vertical" className="h-6 hidden md:block" />

            {/* User Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 outline-none cursor-pointer" aria-label="User menu">
                <Avatar className="h-8 w-8 border border-border">
                  <AvatarImage
                    src={user?.avatar_url || undefined}
                    alt={user?.name || 'User'}
                  />
                  <AvatarFallback className="bg-blue-600 text-white text-xs font-medium">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
                <div className="hidden md:block text-left">
                  <p className="text-sm font-medium text-foreground leading-none">{user?.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 capitalize">{user?.role}</p>
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
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
