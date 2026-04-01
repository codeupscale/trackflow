'use client';

import Link from 'next/link';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { EmployeeStatusBadge } from '@/components/hr/EmployeeStatusBadge';
import type { EmployeeListItem } from '@/lib/validations/employee';

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

interface EmployeeCardProps {
  employee: EmployeeListItem;
}

export function EmployeeCard({ employee }: EmployeeCardProps) {
  return (
    <Link href={`/hr/employees/${employee.id}`} className="block group">
      <Card className="transition-colors group-hover:border-primary/30">
        <CardContent className="flex flex-col items-center text-center gap-3 py-6">
          <Avatar className="size-16">
            <AvatarImage src={employee.avatar_url ?? undefined} alt={employee.name} />
            <AvatarFallback className="text-lg">
              {getInitials(employee.name)}
            </AvatarFallback>
          </Avatar>

          <div className="flex flex-col gap-1 min-w-0 w-full">
            <p className="font-semibold text-foreground truncate">
              {employee.name}
            </p>
            <p className="text-sm text-muted-foreground truncate">
              {employee.email}
            </p>
          </div>

          <div className="flex flex-col gap-1 min-w-0 w-full">
            <p className="text-sm text-muted-foreground truncate">
              {employee.department?.name ?? 'No department'}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {employee.position?.title ?? employee.job_title ?? 'No position'}
            </p>
          </div>

          <EmployeeStatusBadge status={employee.employment_status} />
        </CardContent>
      </Card>
    </Link>
  );
}
