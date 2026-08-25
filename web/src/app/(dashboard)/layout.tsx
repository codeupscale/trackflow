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
import { toast } from 'sonner';
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
import { HolidayAnnouncementBanner } from '@/components/hr/HolidayAnnouncementBanner';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuthGuard();
  const { user, logout, fetchUser } = useAuthStore();
  const { hasPermission, hasPermissionWithScope, permissions } = usePermissionStore();
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

  // If the permission store is empty (e.g. stale localStorage hydration, first load, or a
  // transient /auth/me failure that left the session intact), re-fetch the current user so
  // setPermissions() repopulates the nav. Keyed on the empty condition too, so the sidebar
  // self-heals whenever permissions go empty while still authenticated — not only on mount.
  const permissionsEmpty = Object.keys(permissions).length === 0;
  useEffect(() => {
    if (isAuthenticated && permissionsEmpty) {
      fetchUser();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, permissionsEmpty]);

  const handleLogout = async () => {
    useTimerStore.getState().resetState();
    await logout();
    toast.success('Logged out successfully');
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
        <SidebarHeader className="h-14 border-b border-sidebar-border px-3 justify-center group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:items-center">
          <Link href="/dashboard" className="flex items-center">
            <TrackFlowLogo size={28} showText={true} className="group-data-[collapsible=icon]:[&>span]:hidden" />
          </Link>
        </SidebarHeader>

        <SidebarContent className="px-2 pt-2">
          {(() => {
            const visibleGroups = navigationConfig
              .map((group) => ({
                ...group,
                visibleItems: group.items.filter((item) =>
                  item.requiredScope
                    ? hasPermissionWithScope(item.requiredPermission, item.requiredScope)
                    : hasPermission(item.requiredPermission)
                ),
              }))
              .filter((g) => g.visibleItems.length > 0);

            const allHrefs = visibleGroups.flatMap((g) => g.visibleItems.map((i) => i.href));
            const activeHref = allHrefs
              .filter((href) => pathname === href || pathname.startsWith(href + '/'))
              .sort((a, b) => b.length - a.length)[0] ?? null;

            return visibleGroups.map((group, idx) => (
              <SidebarGroup key={group.label} className={`group-data-[collapsible=icon]:px-1 group-data-[collapsible=icon]:py-0.5 ${idx > 0 ? 'pt-0' : ''}`}>
                {idx > 0 && (
                  <div className="mx-2 mb-1 border-t border-sidebar-border/60 group-data-[collapsible=icon]:mx-0 group-data-[collapsible=icon]:my-1.5" />
                )}
                <SidebarGroupLabel className="text-[0.65rem] font-bold text-sidebar-foreground/50 uppercase tracking-[0.12em] mb-1">{group.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.visibleItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = item.href === activeHref;
                      return (
                        <SidebarMenuItem key={item.name}>
                          <SidebarMenuButton
                            isActive={isActive}
                            tooltip={item.name}
                            render={<Link href={item.href} />}
                            className={isActive ? 'border-l-[3px] border-orange-500 rounded-l-none font-semibold' : ''}
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
            ));
          })()}
        </SidebarContent>

        <SidebarFooter className="border-t border-sidebar-border p-3 group-data-[collapsible=icon]:p-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <div className="flex items-center gap-2.5 px-1 py-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:py-1">
                <Avatar className="h-8 w-8 ring-2 ring-orange-500/20">
                  <AvatarImage src={user?.avatar_url || undefined} alt={user?.name || 'User'} />
                  <AvatarFallback className="bg-gradient-to-br from-orange-500 to-orange-600 text-white text-xs font-bold">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col group-data-[collapsible=icon]:hidden">
                  <span className="text-sm font-semibold text-sidebar-foreground leading-none">{user?.name}</span>
                  <span className="text-[0.7rem] text-sidebar-foreground/50 mt-0.5">{user?.organization?.name || 'Organization'}</span>
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
        <header className="flex items-center justify-between h-14 px-4 md:px-6 border-b border-border bg-card/80 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <SidebarTrigger className="hover:bg-muted shrink-0" />
            <Separator orientation="vertical" className="h-5 hidden md:block shrink-0" />
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
              <DropdownMenuContent align="end" side="bottom" sideOffset={8} className="w-64 p-0 overflow-hidden">
                <div className="bg-muted/40 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-9 w-9 border border-border shadow-sm">
                      <AvatarImage src={user?.avatar_url || undefined} alt={user?.name || 'User'} />
                      <AvatarFallback className="bg-blue-600 text-white text-xs font-semibold">
                        {userInitials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.8rem] font-semibold text-foreground truncate">{user?.name}</p>
                      <p className="text-[0.65rem] text-muted-foreground truncate">{user?.email}</p>
                    </div>
                  </div>
                  {user?.organization?.name && (
                    <div className="mt-2 flex items-center gap-1.5 rounded-md bg-background/60 px-2 py-1">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      <span className="text-[0.65rem] text-muted-foreground truncate">{user.organization.name}</span>
                      {user?.role && (
                        <span className="ml-auto text-[0.6rem] text-muted-foreground/70 capitalize shrink-0">{user.role.replace('_', ' ')}</span>
                      )}
                    </div>
                  )}
                </div>
                <DropdownMenuSeparator className="m-0" />
                <div className="p-1">
                  <DropdownMenuItem onClick={() => router.push('/settings')} className="text-[0.75rem] gap-2 rounded-md">
                    <Settings className="h-3.5 w-3.5" />
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleLogout} variant="destructive" className="text-[0.75rem] gap-2 rounded-md">
                    <LogOut className="h-3.5 w-3.5" />
                    Log out
                  </DropdownMenuItem>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Offline Banner */}
        <OfflineBanner />

        {/* Holiday announcement — every role sees the nearest upcoming holiday */}
        <HolidayAnnouncementBanner />

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 bg-background">
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
