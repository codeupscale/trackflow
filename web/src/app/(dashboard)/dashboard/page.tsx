'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Clock,
  Users,
  FolderOpen,
  Monitor,
} from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import api from '@/lib/api';
import { formatDuration } from '@/lib/utils';

interface DashboardStats {
  total_online: number;
  today_hours: number;
  active_projects: number;
  total_members: number;
}

interface TeamMember {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  is_online: boolean;
  today_seconds: number;
  current_project: string | null;
  activity_score: number;
}

interface DashboardData {
  stats: DashboardStats;
  team: TeamMember[];
}

export default function DashboardPage() {
  const { data, isLoading, error } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const res = await api.get('/dashboard');
      return res.data;
    },
    refetchInterval: 30000,
  });

  const stats = data?.stats;
  const team = data?.team || [];

  const statCards = [
    {
      label: 'Total Online',
      value: stats?.total_online ?? 0,
      icon: Users,
      color: 'text-green-400',
      bg: 'bg-green-500/10',
    },
    {
      label: "Today's Hours",
      value: stats?.today_hours != null
        ? `${Math.floor(stats.today_hours)}h ${Math.round((stats.today_hours % 1) * 60)}m`
        : '0h 0m',
      icon: Clock,
      color: 'text-blue-400',
      bg: 'bg-blue-500/10',
    },
    {
      label: 'Active Projects',
      value: stats?.active_projects ?? 0,
      icon: FolderOpen,
      color: 'text-purple-400',
      bg: 'bg-purple-500/10',
    },
    {
      label: 'Team Members',
      value: stats?.total_members ?? 0,
      icon: Monitor,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
    },
  ];

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-slate-400">Failed to load dashboard data. Please try again.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-slate-400 text-sm mt-1">Overview of your team&apos;s activity today</p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} className="border-slate-800 bg-slate-900/50">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-400">{stat.label}</p>
                    <p className="text-2xl font-bold text-white mt-1">
                      {isLoading ? (
                        <span className="inline-block h-7 w-16 bg-slate-800 rounded animate-pulse" />
                      ) : (
                        stat.value
                      )}
                    </p>
                  </div>
                  <div className={`h-10 w-10 rounded-lg ${stat.bg} flex items-center justify-center`}>
                    <Icon className={`h-5 w-5 ${stat.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Team activity table */}
      <Card className="border-slate-800 bg-slate-900/50">
        <CardHeader>
          <CardTitle className="text-white">Team Activity</CardTitle>
          <CardDescription className="text-slate-400">
            Real-time activity status of your team members
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 bg-slate-800/50 rounded animate-pulse" />
              ))}
            </div>
          ) : team.length === 0 ? (
            <div className="text-center py-12">
              <Users className="h-10 w-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 font-medium">No team members yet</p>
              <p className="text-sm text-slate-500 mt-1">
                Invite your team to start tracking time together
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="text-slate-400">Member</TableHead>
                  <TableHead className="text-slate-400">Status</TableHead>
                  <TableHead className="text-slate-400">Today&apos;s Hours</TableHead>
                  <TableHead className="text-slate-400">Activity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {team.map((member) => {
                  const initials = member.name
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2);

                  return (
                    <TableRow key={member.id} className="border-slate-800">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <Avatar className="h-8 w-8 border border-slate-700">
                              <AvatarImage
                                src={member.avatar_url || undefined}
                                alt={member.name}
                              />
                              <AvatarFallback className="bg-slate-700 text-white text-xs">
                                {initials}
                              </AvatarFallback>
                            </Avatar>
                            <span
                              className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-slate-900 ${
                                member.is_online ? 'bg-green-500' : 'bg-slate-500'
                              }`}
                            />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-white">{member.name}</p>
                            <p className="text-xs text-slate-500">{member.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={member.is_online ? 'default' : 'secondary'}
                          className={
                            member.is_online
                              ? 'bg-green-500/10 text-green-400 border-green-500/20'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full mr-1.5 inline-block ${
                              member.is_online ? 'bg-green-400' : 'bg-slate-500'
                            }`}
                          />
                          {member.is_online ? 'Online' : 'Offline'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm font-mono text-slate-300">
                          {formatDuration(member.today_seconds)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-2 bg-slate-800 rounded-full max-w-[120px]">
                            <div
                              className={`h-full rounded-full transition-all ${
                                member.activity_score >= 70
                                  ? 'bg-green-500'
                                  : member.activity_score >= 40
                                  ? 'bg-amber-500'
                                  : 'bg-red-500'
                              }`}
                              style={{ width: `${Math.min(member.activity_score, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-400 w-8 text-right">
                            {member.activity_score}%
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
