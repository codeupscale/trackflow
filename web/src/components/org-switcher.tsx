'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronsUpDown, Check, Building2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuthStore, type OrgSelectionItem } from '@/stores/auth-store';
import { useTimerStore } from '@/stores/timer-store';
import api from '@/lib/api';

const roleLabels: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  employee: 'Employee',
};

export function OrgSwitcher() {
  const { user, switchOrganization } = useAuthStore();
  const queryClient = useQueryClient();
  const [isSwitching, setIsSwitching] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['auth-organizations'],
    queryFn: async () => {
      const res = await api.get('/auth/organizations');
      return res.data as {
        data: OrgSelectionItem[];
        current_organization_id: string;
      };
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const organizations = data?.data ?? [];
  const hasMultipleOrgs = organizations.length > 1;

  // Don't render if user only has one org
  if (!hasMultipleOrgs && !isLoading) {
    return null;
  }

  const handleSwitch = async (orgId: string) => {
    if (orgId === user?.organization_id || isSwitching) return;

    setIsSwitching(true);
    try {
      // Stop timer if running before switching
      const timerState = useTimerStore.getState();
      if (timerState.isRunning) {
        timerState.resetState();
      }

      await switchOrganization(orgId);

      // Clear all cached data — new org = new data
      queryClient.clear();

      const targetOrg = organizations.find((o) => o.organization_id === orgId);
      toast.success(`Switched to ${targetOrg?.organization_name || 'organization'}`);
    } catch (err: unknown) {
      const message = (err as Error).message || 'Failed to switch organization.';
      toast.error(message);
    } finally {
      setIsSwitching(false);
    }
  };

  if (isLoading) {
    return null;
  }

  const currentOrg = organizations.find(
    (o) => o.organization_id === user?.organization_id
  );

  const orgInitials = (name: string) =>
    name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2 h-8 px-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSwitching ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Building2 className="h-3.5 w-3.5" />
        )}
        <span className="max-w-[120px] truncate text-xs hidden md:inline">
          {currentOrg?.organization_name || user?.organization?.name || 'Organization'}
        </span>
        <ChevronsUpDown className="h-3 w-3 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" sideOffset={8} className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
          Switch organization
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {organizations.map((org) => {
          const isCurrent = org.organization_id === user?.organization_id;
          return (
            <DropdownMenuItem
              key={org.organization_id}
              onClick={() => handleSwitch(org.organization_id)}
              disabled={isCurrent || isSwitching}
              className="flex items-center gap-2 py-2 cursor-pointer"
            >
              <Avatar className="h-7 w-7 border border-border shrink-0">
                <AvatarImage src={org.organization_avatar || undefined} alt={org.organization_name} />
                <AvatarFallback className="bg-blue-600/10 text-blue-400 text-xs">
                  {orgInitials(org.organization_name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{org.organization_name}</p>
                <p className="text-xs text-muted-foreground capitalize">
                  {roleLabels[org.user_role] || org.user_role}
                </p>
              </div>
              {isCurrent && (
                <Check className="h-4 w-4 text-blue-500 shrink-0" />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
