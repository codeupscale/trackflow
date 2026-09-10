'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FolderKanban, X } from 'lucide-react';

import api from '@/lib/api';
import { cn } from '@/lib/utils';
// The "Xh Ym" formatter, not the HH:MM:SS one in lib/utils — a total rendered
// as "22:36:00" reads as a running clock.
import { formatDuration } from '@/lib/check-in-time';
import {
  useProjectHours,
  type ProjectHoursPeriod,
} from '@/hooks/dashboard/use-project-hours';

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ProjectOption {
  id: string;
  name: string;
  color?: string | null;
}

const PERIOD_TABS: { label: string; value: ProjectHoursPeriod }[] = [
  { label: 'Today', value: 'today' },
  { label: 'Week', value: 'week' },
  { label: 'Month', value: 'month' },
  { label: 'Custom', value: 'custom' },
];

/** The last 12 months, newest first, as { value: "YYYY-MM", label: "Aug 2026" }. */
function recentMonths(count = 12) {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({
      value,
      label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
    });
  }
  return out;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Fallback swatch for a project with no colour set, stable per project. */
const FALLBACK_COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4',
];

/**
 * "What did I spend my time on?" — the signed-in user's OWN hours grouped by
 * project, for a week, a month, or a custom range, optionally narrowed to one
 * project. The two filters AND together: project A + August answers "how long
 * did I spend on A in August".
 *
 * Deliberately self-scoped and behind dashboard.view_own_stats, so it works for
 * an employee who holds no reports permission — this is the answer to "how does
 * an employee check their project time" now that Reports is not theirs.
 */
export function ProjectHoursCard() {
  const months = useMemo(() => recentMonths(), []);

  const [period, setPeriod] = useState<ProjectHoursPeriod>('month');
  const [month, setMonth] = useState(months[0].value);
  const [weekOf, setWeekOf] = useState(todayIso());
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [projectId, setProjectId] = useState<string | null>(null);

  // Same list the Time Entries page uses; role-scoped server-side, so an
  // employee sees only projects they are assigned to.
  const { data: projects } = useQuery<ProjectOption[]>({
    queryKey: ['projects-list'],
    queryFn: async () => {
      const res = await api.get('/projects', { params: { per_page: 100 } });
      return res.data.projects || res.data.data || (Array.isArray(res.data) ? res.data : []);
    },
    staleTime: 5 * 60_000,
  });

  const { data, isLoading, isError } = useProjectHours({
    period,
    month,
    week_of: weekOf,
    start_date: startDate,
    end_date: endDate,
    project_id: projectId,
  });

  const projectItems = useMemo(
    () => [
      { value: 'all', label: 'All projects' },
      ...(projects ?? []).map((p) => ({ value: p.id, label: p.name })),
    ],
    [projects],
  );

  const rows = data?.projects ?? [];
  const total = data?.total_seconds ?? 0;

  const rangeLabel = data
    ? `${new Date(data.date_from + 'T00:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} – ${new Date(data.date_to + 'T00:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}`
    : null;

  return (
    <Card>
      <CardContent className="p-0">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10 shrink-0">
              <FolderKanban className="h-4 w-4 text-indigo-500" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Hours by Project</h3>
              <p className="text-[0.65rem] text-muted-foreground mt-0.5">
                {rangeLabel ?? 'Your tracked time, grouped by project'}
              </p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[0.6rem] font-medium text-muted-foreground uppercase tracking-wider">
              Total
            </p>
            <p className="text-base font-bold tabular-nums leading-tight">
              {/* "0h 0m" rather than formatDuration's "0s", to read the same as
                  the Today's Hours / This Week cards directly above. */}
              {isLoading ? '--' : total > 0 ? formatDuration(total) : '0h 0m'}
            </p>
          </div>
        </div>

        {/* Filters — a toolbar with its own rule, so the controls read as one
            band rather than floating between the header and the rows. */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3 border-b border-border/50">
          {/* Period — anchored left, so switching tabs never moves them. */}
          <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
            {PERIOD_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setPeriod(tab.value)}
                aria-pressed={period === tab.value}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[0.65rem] font-medium transition-colors',
                  period === tab.value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Value controls — anchored RIGHT as one group, so the toolbar spans
              the card's full width instead of bunching everything left and
              leaving a dead half. Each control keeps a fixed width so the group
              does not jump when the period changes. */}
          <div className="flex items-center gap-2 ml-auto">
          {/* Period-specific control */}
          {period === 'month' && (
            // Base UI renders the raw VALUE unless the root is given the
            // value→label mapping, which is how "2026-09" reached the trigger.
            <Select items={months} value={month} onValueChange={(v) => { if (v) setMonth(v); }}>
              <SelectTrigger className="h-7 w-[130px] text-[0.65rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m.value} value={m.value} className="text-xs">
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {period === 'week' && (
            <DatePicker
              value={weekOf}
              onChange={(v) => setWeekOf(v || todayIso())}
              placeholder="Any day in the week"
              className="h-7 w-[150px] text-[0.65rem]"
            />
          )}

          {period === 'custom' && (
            <div className="flex items-center gap-1.5">
              <DatePicker
                value={startDate}
                onChange={(v) => setStartDate(v || todayIso())}
                placeholder="From"
                maxDate={endDate}
                className="h-7 w-[130px] text-[0.65rem]"
              />
              <span className="text-[0.65rem] text-muted-foreground">to</span>
              <DatePicker
                value={endDate}
                onChange={(v) => setEndDate(v || todayIso())}
                placeholder="To"
                minDate={startDate}
                className="h-7 w-[130px] text-[0.65rem]"
              />
            </div>
          )}

          {/* Project — ANDs with the period above */}
          <Select
            items={projectItems}
            value={projectId ?? 'all'}
            onValueChange={(v) => setProjectId(!v || v === 'all' ? null : v)}
          >
            <SelectTrigger className="h-7 w-[160px] text-[0.65rem]">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All projects</SelectItem>
              {(projects ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-xs">
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {projectId && (
            <button
              type="button"
              onClick={() => setProjectId(null)}
              aria-label="Clear project filter"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          </div>
        </div>

        {/* Rows — a real table, so Project / Entries / Share / Hours / % line up
            on fixed columns instead of drifting with each project's name
            length. Column widths are declared once on the header cells and the
            body inherits them, which is what keeps the bars starting on the
            same x-position on every row and at every screen width. */}
        {isError ? (
          <p className="text-xs text-muted-foreground py-10 text-center">
            Couldn&apos;t load your project hours. Please try again.
          </p>
        ) : isLoading ? (
          <div className="flex flex-col gap-3 px-4 py-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-2.5 w-2.5 rounded-full" />
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-2 flex-1" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-1 py-10 text-center">
            <FolderKanban className="h-7 w-7 text-muted-foreground/40" />
            <p className="text-xs font-medium text-muted-foreground">
              No tracked time in this period
            </p>
            <p className="text-[0.65rem] text-muted-foreground">
              {projectId
                ? 'Try another project or a wider date range.'
                : 'Time you track will be grouped here by project.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border/50">
                  {/* Fixed at 30%: left to size itself it absorbed every spare
                      pixel, pushing Sessions into the middle of the card with a
                      gulf of empty space after each project name. The bar column
                      takes the slack instead, which is the one that benefits. */}
                  <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2 whitespace-nowrap w-[30%]">
                    Project
                  </th>
                  {/* "Sessions", not "Entries": it reads as the number of times
                      the timer was started and stopped, which is what the count
                      actually is. */}
                  <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2 whitespace-nowrap text-right w-[90px] hidden sm:table-cell">
                    Sessions
                  </th>
                  {/* Bar and number are ONE measure, so they live in one column.
                      Splitting them across "Share" and "Share %" made the table
                      look like it reported two different things. */}
                  <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2 whitespace-nowrap min-w-[140px]">
                    % of total
                  </th>
                  <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2 whitespace-nowrap text-right w-[100px]">
                    Hours
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  // Share of the visible total, so the bars still read correctly
                  // when a project filter narrows the set to a single row (100%).
                  const pct = total > 0 ? Math.round((row.total_seconds / total) * 100) : 0;
                  const color = row.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length];

                  return (
                    <tr
                      key={row.project_id ?? 'none'}
                      className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          <span className="text-[0.75rem] font-medium truncate">
                            {row.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right text-[0.7rem] text-muted-foreground tabular-nums whitespace-nowrap hidden sm:table-cell">
                        {row.entry_count}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ width: `${pct}%`, backgroundColor: color }}
                            />
                          </div>
                          {/* Fixed width so the numbers stay in a column of
                              their own instead of tracking each bar's length. */}
                          <span className="w-9 text-right text-[0.7rem] text-muted-foreground tabular-nums shrink-0">
                            {pct}%
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right text-[0.75rem] font-semibold tabular-nums whitespace-nowrap">
                        {formatDuration(row.total_seconds)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
