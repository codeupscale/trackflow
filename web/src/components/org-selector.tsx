'use client';

import { useState } from 'react';
import { Loader2, Building2, ChevronRight, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { type OrgSelectionItem } from '@/stores/auth-store';

const roleLabels: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  employee: 'Employee',
};

const roleBadgeColors: Record<string, string> = {
  owner: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  admin: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  manager: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  employee: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
};

interface OrgSelectorProps {
  organizations: OrgSelectionItem[];
  onSelect: (organizationId: string) => Promise<void>;
  onBack?: () => void;
  title?: string;
  description?: string;
}

export function OrgSelector({
  organizations,
  onSelect,
  onBack,
  title = 'Select Organization',
  description = 'Your account belongs to multiple organizations. Choose one to continue.',
}: OrgSelectorProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = async (orgId: string) => {
    setSelectedId(orgId);
    setIsLoading(true);
    setError(null);
    try {
      await onSelect(orgId);
    } catch (err: unknown) {
      const message = (err as Error).message || 'Failed to select organization.';
      setError(message);
      setIsLoading(false);
      setSelectedId(null);
    }
  };

  return (
    <Card className="border-border bg-card/80 backdrop-blur w-full max-w-md">
      <CardHeader className="space-y-1">
        <div className="flex items-center gap-2 justify-center">
          <Building2 className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-2xl text-center text-foreground">{title}</CardTitle>
        </div>
        <CardDescription className="text-center text-muted-foreground">
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md border border-destructive/20">
            {error}
          </div>
        )}

        {organizations.map((org) => {
          const initials = org.organization_name
            .split(' ')
            .map((w) => w[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);

          const isSelected = selectedId === org.organization_id;
          const badgeColor = roleBadgeColors[org.user_role] || roleBadgeColors.employee;

          return (
            <button
              key={org.organization_id}
              onClick={() => handleSelect(org.organization_id)}
              disabled={isLoading}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-border bg-background hover:bg-muted/50 hover:border-blue-500/30 transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed group"
            >
              <Avatar className="h-10 w-10 border border-border shrink-0">
                <AvatarImage src={org.organization_avatar || undefined} alt={org.organization_name} />
                <AvatarFallback className="bg-blue-600/10 text-blue-400 text-sm font-medium">
                  {initials}
                </AvatarFallback>
              </Avatar>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {org.organization_name}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border ${badgeColor}`}>
                    <Shield className="h-3 w-3" />
                    {roleLabels[org.user_role] || org.user_role}
                  </span>
                  <span className="text-xs text-muted-foreground capitalize">
                    {org.organization_plan}
                  </span>
                </div>
              </div>

              {isSelected && isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
              )}
            </button>
          );
        })}

        {onBack && (
          <div className="pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              disabled={isLoading}
              className="w-full text-muted-foreground"
            >
              Back to login
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
