<?php

namespace App\Services;

use App\Models\User;
use App\Support\TimezoneAwareDateRange;
use Barryvdh\DomPDF\Facade\Pdf;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Project-manager time report: per-entry breakdown for one or more projects /
 * resources over a week, month or custom range, with CSV + PDF export.
 *
 * Only APPROVED tracked and manual time is reported (pending/rejected manual
 * entries and idle markers never appear). Every query is org-scoped and further
 * the actor's reports.view scope (organization / project / own).
 */
class ProjectTimeReportService
{
    /** Same cap as ReportService — clamp runaway timers so totals stay sane. */
    private const MAX_ENTRY_DURATION = 43200;

    /** Hard row cap for PDF rendering (dompdf is memory-hungry). */
    private const PDF_ROW_CAP = 5000;

    public function __construct(
        private readonly PermissionService $permissions,
    ) {}

    private static function durationExpr(string $prefix = 'te'): string
    {
        $cap = self::MAX_ENTRY_DURATION;
        $startCol = "{$prefix}.started_at";
        $endCol = "{$prefix}.ended_at";

        if (DB::connection()->getDriverName() === 'sqlite') {
            return "MIN(MAX(CAST((julianday({$endCol}) - julianday({$startCol})) * 86400 AS INTEGER), 0), {$cap})";
        }

        return "LEAST(GREATEST(EXTRACT(EPOCH FROM ({$endCol} - {$startCol}))::int, 0), {$cap})";
    }

    /**
     * Paginated per-entry rows plus a summary aggregate over the FULL filtered
     * set (in meta.summary). Matches the {data, meta} envelope.
     */
    public function index(User $actor, array $filters): array
    {
        $tz = $actor->getTimezoneForDates();
        $perPage = min((int) ($filters['per_page'] ?? 25), 100);
        $groupByDay = $this->isGroupByDay($filters);

        $paginator = $groupByDay
            ? $this->dailyRowQuery($actor, $filters)->paginate($perPage)
            : $this->rowQuery($actor, $filters)->paginate($perPage);

        $data = collect($paginator->items())
            ->map(fn ($row) => $groupByDay ? $this->mapDailyRow($row, $tz) : $this->mapRow($row, $tz))
            ->all();

        return [
            'data' => $data,
            'meta' => [
                'current_page' => $paginator->currentPage(),
                'last_page' => $paginator->lastPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
                'summary' => $this->summary($actor, $filters),
                'group_by_day' => $groupByDay,
            ],
        ];
    }

    /**
     * Streamed CSV export. UTF-8 BOM, a metadata header block, then the column
     * header and data rows — all cells neutralized against formula injection.
     * Streamed via cursor() so month × all-resources exports stay memory-bounded.
     */
    public function csv(User $actor, array $filters): StreamedResponse
    {
        $tz = $actor->getTimezoneForDates();
        $meta = $this->metaHeader($actor, $filters);
        $groupByDay = $this->isGroupByDay($filters);
        $query = $groupByDay
            ? $this->dailyRowQuery($actor, $filters)
            : $this->rowQuery($actor, $filters);

        $filename = 'project-time-report-' . now()->format('Ymd-His') . '.csv';

        return new StreamedResponse(function () use ($query, $meta, $tz, $groupByDay) {
            $out = fopen('php://output', 'w');
            // UTF-8 BOM so Excel renders accented characters correctly.
            fwrite($out, "\xEF\xBB\xBF");

            // Metadata header block (before the column header rows).
            fputcsv($out, [$this->neutralizeCsv('Project(s)'), $this->neutralizeCsv($meta['projects'])]);
            fputcsv($out, [$this->neutralizeCsv('Resource(s)'), $this->neutralizeCsv($meta['resources'])]);
            fputcsv($out, [$this->neutralizeCsv('Date Range'), $this->neutralizeCsv($meta['date_range'])]);
            fputcsv($out, [$this->neutralizeCsv('View'), $this->neutralizeCsv($groupByDay ? 'Daily totals per resource and project' : 'Per entry')]);
            fputcsv($out, [$this->neutralizeCsv('Exported At'), $this->neutralizeCsv($meta['exported_at'])]);
            fputcsv($out, [$this->neutralizeCsv('Exported By'), $this->neutralizeCsv($meta['exported_by'])]);
            fputcsv($out, []);

            // Column header.
            $headers = [
                'Resource', 'Project', 'Task', 'Type', 'Date', 'Start', 'End',
                'Duration (h)', 'Activity %', 'Billable', 'Billable Amount',
            ];
            if ($groupByDay) {
                array_splice($headers, 7, 0, ['Entries']);
            }
            fputcsv($out, $headers);

            foreach ($query->cursor() as $raw) {
                $row = $groupByDay ? $this->mapDailyRow($raw, $tz) : $this->mapRow($raw, $tz);
                $cells = [
                    $this->neutralizeCsv($row['user_name']),
                    $this->neutralizeCsv($row['project_name']),
                    $this->neutralizeCsv($row['task_name']),
                    $this->neutralizeCsv($row['type']),
                    $this->neutralizeCsv($row['date']),
                    $this->neutralizeCsv($row['start_time']),
                    $this->neutralizeCsv($row['end_time']),
                    $this->neutralizeCsv(number_format($row['duration_seconds'] / 3600, 2)),
                    $this->neutralizeCsv((string) $row['activity_score']),
                    $this->neutralizeCsv($row['billable'] ? 'Yes' : 'No'),
                    $this->neutralizeCsv(number_format($row['billable_amount'], 2)),
                ];
                if ($groupByDay) {
                    array_splice($cells, 7, 0, [$this->neutralizeCsv((string) ($row['entry_count'] ?? 1))]);
                }
                fputcsv($out, $cells);
            }

            fclose($out);
        }, 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => "attachment; filename=\"{$filename}\"",
        ]);
    }

    /**
     * PDF export. Row-capped (dompdf renders the whole document in memory).
     */
    public function pdf(User $actor, array $filters): \Illuminate\Http\Response
    {
        $tz = $actor->getTimezoneForDates();
        $groupByDay = $this->isGroupByDay($filters);

        $count = $groupByDay
            ? $this->dailyRowCount($actor, $filters)
            : (clone $this->baseQuery($actor, $filters))->count('te.id');

        if ($count > self::PDF_ROW_CAP) {
            abort(422, 'Too many rows for PDF, narrow the filter or use CSV.');
        }

        $rawRows = $groupByDay
            ? $this->dailyRowQuery($actor, $filters)->get()
            : $this->rowQuery($actor, $filters)->get();

        $rows = $rawRows
            ->map(fn ($row) => $groupByDay ? $this->mapDailyRow($row, $tz) : $this->mapRow($row, $tz))
            ->all();

        $meta = $this->metaHeader($actor, $filters);
        $summary = $this->summary($actor, $filters);

        $filename = 'project-time-report-' . now()->format('Ymd-His') . '.pdf';

        return Pdf::loadView('reports.project-time', [
            'rows' => $rows,
            'meta' => $meta,
            'summary' => $summary,
            'group_by_day' => $groupByDay,
        ])->download($filename);
    }

    // ── Query building ────────────────────────────────────────────────────

    /**
     * Org-scoped, role-scoped, filtered base query over approved tracked entries.
     */
    private function baseQuery(User $actor, array $filters)
    {
        $tz = $actor->getTimezoneForDates();
        [$startUtc, $endUtc] = $this->resolveRange($filters, $tz);

        $query = DB::table('time_entries as te')
            ->join('users as u', 'te.user_id', '=', 'u.id')
            ->leftJoin('projects as p', 'te.project_id', '=', 'p.id')
            ->leftJoin('tasks as t', 'te.task_id', '=', 't.id')
            ->where('te.organization_id', $actor->organization_id)
            ->whereIn('te.type', ['tracked', 'manual'])
            ->where('te.approval_status', 'approved')
            // Raw DB::table bypasses the SoftDeletes global scope — exclude
            // soft-deleted entries explicitly (also matches the idx_te_pending /
            // idx_te_org_status_started partial indexes' `deleted_at IS NULL`).
            ->whereNull('te.deleted_at')
            ->whereNotNull('te.ended_at')
            ->where('te.started_at', '>=', $startUtc)
            ->where('te.started_at', '<', $endUtc);

        $projectIds = $this->normalizeProjectIds($filters);
        if (! empty($projectIds)) {
            $query->whereIn('te.project_id', $projectIds);
        }

        if (! empty($filters['user_id'])) {
            $query->where('te.user_id', $filters['user_id']);
        }

        // Role scope narrowing.
        $scope = $this->permissions->getScope($actor, 'reports.view');
        if ($scope === 'organization') {
            // Whole org — already constrained by organization_id.
        } elseif ($scope === 'project') {
            $query->whereIn('te.user_id', $this->permissions->getProjectUserIds($actor));
        } else {
            // own / null → self only.
            $query->where('te.user_id', $actor->id);
        }

        return $query;
    }

    /**
     * baseQuery + row projection, ordered newest-first.
     */
    private function rowQuery(User $actor, array $filters)
    {
        $dur = self::durationExpr('te');

        return $this->baseQuery($actor, $filters)
            ->select([
                'te.id',
                'u.name as user_name',
                'p.name as project_name',
                'p.billable',
                'p.hourly_rate',
                't.name as task_name',
                'te.type',
                'te.activity_score',
                'te.started_at',
                'te.ended_at',
            ])
            ->selectRaw("{$dur} as duration_seconds")
            ->selectRaw("CASE WHEN p.billable = true THEN ROUND({$dur} / 3600.0 * p.hourly_rate, 2) ELSE 0 END as billable_amount")
            ->orderByDesc('te.started_at');
    }

    /**
     * Aggregated rows: one line per resource + project + calendar day (org timezone).
     */
    private function dailyRowQuery(User $actor, array $filters)
    {
        $tz = $actor->getTimezoneForDates();
        $dur = self::durationExpr('te');
        $workDate = $this->localDateExpr('te.started_at', $tz);
        $projectKey = "COALESCE(te.project_id, '00000000-0000-0000-0000-000000000000')";

        if (DB::connection()->getDriverName() === 'sqlite') {
            return $this->baseQuery($actor, $filters)
                ->select([
                    DB::raw("te.user_id || '|' || {$workDate} || '|' || {$projectKey} as id"),
                    'te.user_id',
                    'te.project_id',
                    'u.name as user_name',
                    DB::raw("MAX(COALESCE(p.name, '—')) as project_name"),
                    DB::raw('COUNT(te.id) as entry_count'),
                    DB::raw("CASE WHEN COUNT(DISTINCT te.type) > 1 THEN 'mixed' ELSE MAX(te.type) END as entry_type"),
                    DB::raw("{$workDate} as work_date"),
                    DB::raw('MIN(te.started_at) as min_started_at'),
                    DB::raw('MAX(te.ended_at) as max_ended_at'),
                ])
                ->selectRaw("SUM({$dur}) as duration_seconds")
                ->selectRaw("SUM(CASE WHEN te.activity_score > 0 THEN te.activity_score * {$dur} ELSE 0 END) as weighted_activity")
                ->selectRaw("SUM(CASE WHEN te.activity_score > 0 THEN {$dur} ELSE 0 END) as activity_weight")
                ->selectRaw("SUM(CASE WHEN p.billable = 1 THEN ROUND({$dur} / 3600.0 * p.hourly_rate, 2) ELSE 0 END) as billable_amount")
                ->selectRaw('MAX(CASE WHEN p.billable = 1 THEN 1 ELSE 0 END) as is_billable')
                ->groupBy('te.user_id', 'u.name', 'te.project_id', DB::raw($workDate))
                ->orderByDesc(DB::raw($workDate))
                ->orderBy('u.name')
                ->orderBy('project_name');
        }

        return $this->baseQuery($actor, $filters)
            ->select([
                DB::raw("te.user_id::text || '|' || {$workDate}::text || '|' || {$projectKey} as id"),
                'te.user_id',
                'te.project_id',
                'u.name as user_name',
                DB::raw("MAX(COALESCE(p.name, '—')) as project_name"),
                DB::raw('COUNT(te.id)::int as entry_count'),
                DB::raw("CASE WHEN COUNT(DISTINCT te.type) > 1 THEN 'mixed' ELSE MAX(te.type) END as entry_type"),
                DB::raw("{$workDate} as work_date"),
                DB::raw('MIN(te.started_at) as min_started_at'),
                DB::raw('MAX(te.ended_at) as max_ended_at'),
            ])
            ->selectRaw("COALESCE(SUM({$dur}), 0)::int as duration_seconds")
            ->selectRaw("COALESCE(SUM(CASE WHEN te.activity_score > 0 THEN te.activity_score * {$dur} ELSE 0 END), 0) as weighted_activity")
            ->selectRaw("COALESCE(SUM(CASE WHEN te.activity_score > 0 THEN {$dur} ELSE 0 END), 0) as activity_weight")
            ->selectRaw("COALESCE(SUM(CASE WHEN p.billable = true THEN ROUND({$dur} / 3600.0 * p.hourly_rate, 2) ELSE 0 END), 0) as billable_amount")
            ->selectRaw('BOOL_OR(p.billable = true) as is_billable')
            ->groupBy('te.user_id', 'u.name', 'te.project_id', DB::raw($workDate))
            ->orderByDesc(DB::raw($workDate))
            ->orderBy('u.name')
            ->orderBy('project_name');
    }

    private function isGroupByDay(array $filters): bool
    {
        return filter_var($filters['group_by_day'] ?? false, FILTER_VALIDATE_BOOLEAN);
    }

    private function dailyRowCount(User $actor, array $filters): int
    {
        $tz = $actor->getTimezoneForDates();
        $workDate = $this->localDateExpr('te.started_at', $tz);

        return $this->baseQuery($actor, $filters)
            ->select('te.user_id', 'te.project_id')
            ->groupBy('te.user_id', 'te.project_id', DB::raw($workDate))
            ->get()
            ->count();
    }

    private function localDateExpr(string $column, string $tz): string
    {
        if (DB::connection()->getDriverName() === 'sqlite') {
            return "DATE({$column})";
        }

        $escapedTz = str_replace("'", "''", $tz);

        // Naive UTC timestamps (Laravel `timestamp` columns) → org-local calendar date.
        // Must match Carbon::parse($value)->setTimezone($tz)->toDateString() in mapRow().
        return "(timezone('{$escapedTz}', timezone('UTC', {$column})))::date";
    }

    /**
     * Summary aggregate over the FULL filtered set.
     */
    private function summary(User $actor, array $filters): array
    {
        $dur = self::durationExpr('te');

        $row = $this->baseQuery($actor, $filters)
            ->selectRaw("COALESCE(SUM({$dur}), 0) as total_seconds")
            ->selectRaw("COALESCE(SUM(CASE WHEN p.billable = true THEN {$dur} / 3600.0 * p.hourly_rate ELSE 0 END), 0) as billable_amount")
            ->selectRaw('COUNT(te.id) as entry_count')
            ->selectRaw('COUNT(DISTINCT te.user_id) as resource_count')
            ->selectRaw('COUNT(DISTINCT te.project_id) as project_count')
            ->first();

        return [
            'total_seconds' => (int) ($row->total_seconds ?? 0),
            'total_hours' => round((int) ($row->total_seconds ?? 0) / 3600, 2),
            'billable_amount' => round((float) ($row->billable_amount ?? 0), 2),
            'entry_count' => (int) ($row->entry_count ?? 0),
            'resource_count' => (int) ($row->resource_count ?? 0),
            'project_count' => (int) ($row->project_count ?? 0),
        ];
    }

    private function mapRow(object $row, string $tz): array
    {
        $started = Carbon::parse($row->started_at)->setTimezone($tz);
        $ended = $row->ended_at ? Carbon::parse($row->ended_at)->setTimezone($tz) : null;

        return [
            'id' => $row->id,
            'user_name' => $row->user_name,
            'project_name' => $row->project_name ?? '—',
            'task_name' => $row->task_name ?? '—',
            'type' => $row->type === 'manual' ? 'Manual' : 'Tracked',
            'date' => $started->format('Y-m-d'),
            'start_time' => $started->format('H:i'),
            'end_time' => $ended?->format('H:i') ?? '—',
            // Back-compat for existing API consumers.
            'started_at' => $started->format('Y-m-d H:i'),
            'ended_at' => $ended?->format('Y-m-d H:i'),
            'duration_seconds' => (int) $row->duration_seconds,
            'activity_score' => (int) ($row->activity_score ?? 0),
            'billable' => (bool) $row->billable,
            'billable_amount' => (float) $row->billable_amount,
        ];
    }

    private function mapDailyRow(object $row, string $tz): array
    {
        $started = Carbon::parse($row->min_started_at)->setTimezone($tz);
        $ended = $row->max_ended_at ? Carbon::parse($row->max_ended_at)->setTimezone($tz) : null;
        $activityWeight = (int) ($row->activity_weight ?? 0);
        $weightedActivity = (float) ($row->weighted_activity ?? 0);
        $entryType = $row->entry_type ?? 'tracked';

        $typeLabel = match ($entryType) {
            'mixed' => 'Mixed',
            'manual' => 'Manual',
            default => 'Tracked',
        };

        $workDate = $row->work_date ?? $started->format('Y-m-d');
        if ($workDate instanceof \DateTimeInterface) {
            $workDate = $workDate->format('Y-m-d');
        }

        return [
            'id' => (string) ($row->id ?? "{$row->user_id}|{$workDate}"),
            'user_name' => $row->user_name,
            'project_name' => $row->project_name ?? '—',
            'task_name' => '—',
            'type' => $typeLabel,
            'date' => (string) $workDate,
            'start_time' => ((int) ($row->entry_count ?? 1)) > 1
                ? '—'
                : $started->format('H:i'),
            'end_time' => ((int) ($row->entry_count ?? 1)) > 1
                ? '—'
                : ($ended?->format('H:i') ?? '—'),
            'time_span' => ((int) ($row->entry_count ?? 1)) > 1
                ? $started->format('H:i') . ' – ' . ($ended?->format('H:i') ?? '—')
                : null,
            'started_at' => $started->format('Y-m-d H:i'),
            'ended_at' => $ended?->format('Y-m-d H:i'),
            'duration_seconds' => (int) $row->duration_seconds,
            'activity_score' => $activityWeight > 0
                ? (int) round($weightedActivity / $activityWeight)
                : 0,
            'billable' => (bool) ($row->is_billable ?? false),
            'billable_amount' => round((float) ($row->billable_amount ?? 0), 2),
            'entry_count' => (int) ($row->entry_count ?? 1),
        ];
    }

    // ── Filters / range resolution ────────────────────────────────────────

    /**
     * Accept project_id as a single uuid or an array of uuids.
     *
     * @return string[]
     */
    private function normalizeProjectIds(array $filters): array
    {
        $raw = $filters['project_id'] ?? null;
        if (empty($raw)) {
            return [];
        }

        return array_values(array_filter((array) $raw));
    }

    /**
     * Resolve [startUtc, endUtc) for the requested period in the org timezone.
     */
    private function resolveRange(array $filters, string $tz): array
    {
        $period = $filters['period'] ?? 'week';

        if ($period === 'custom') {
            $start = $filters['start_date'] ?? now($tz)->toDateString();
            $end = $filters['end_date'] ?? $start;

            return TimezoneAwareDateRange::toUtcBounds($start, $end, $tz);
        }

        if ($period === 'month') {
            $month = $filters['month'] ?? now($tz)->format('Y-m');
            $anchor = Carbon::parse("{$month}-01", $tz);

            return TimezoneAwareDateRange::toUtcBounds(
                $anchor->copy()->startOfMonth()->toDateString(),
                $anchor->copy()->endOfMonth()->toDateString(),
                $tz
            );
        }

        // Default: week containing week_of (or today).
        $anchor = isset($filters['week_of'])
            ? Carbon::parse($filters['week_of'], $tz)
            : now($tz);

        return TimezoneAwareDateRange::toUtcBounds(
            $anchor->copy()->startOfWeek()->toDateString(),
            $anchor->copy()->endOfWeek()->toDateString(),
            $tz
        );
    }

    /**
     * Human-readable metadata header shared by CSV + PDF.
     *
     * @return array{projects:string,resources:string,date_range:string,exported_at:string,exported_by:string}
     */
    private function metaHeader(User $actor, array $filters): array
    {
        $tz = $actor->getTimezoneForDates();

        // Project label.
        $projectIds = $this->normalizeProjectIds($filters);
        if (! empty($projectIds)) {
            $names = DB::table('projects')
                ->where('organization_id', $actor->organization_id)
                ->whereIn('id', $projectIds)
                ->pluck('name')
                ->all();
            $projectLabel = $names ? implode(', ', $names) : 'All Projects';
        } else {
            $projectLabel = 'All Projects';
        }

        // Resource label.
        if (! empty($filters['user_id'])) {
            $name = DB::table('users')
                ->where('organization_id', $actor->organization_id)
                ->where('id', $filters['user_id'])
                ->value('name');
            $resourceLabel = $name ?: 'All Resources';
        } else {
            $resourceLabel = 'All Resources';
        }

        // Local date range label.
        [$startUtc, $endUtc] = $this->resolveRange($filters, $tz);
        $startLocal = Carbon::parse($startUtc)->setTimezone($tz)->format('Y-m-d');
        // endUtc is the exclusive start-of-next-day; show the inclusive last day.
        $endLocal = Carbon::parse($endUtc)->setTimezone($tz)->subDay()->format('Y-m-d');

        return [
            'projects' => $projectLabel,
            'resources' => $resourceLabel,
            'date_range' => "{$startLocal} to {$endLocal}",
            'exported_at' => now($tz)->format('Y-m-d H:i') . " ({$tz})",
            'exported_by' => $actor->name,
        ];
    }

    /**
     * OWASP CSV formula-injection mitigation — identical approach to
     * ReportExportFormatter::neutralizeCsv(). Prefix any cell that begins with a
     * formula/DDE trigger with a single quote so spreadsheets treat it as text.
     */
    private function neutralizeCsv($value)
    {
        if (! is_string($value) || $value === '') {
            return $value;
        }

        if (in_array($value[0], ['=', '+', '-', '@', "\t", "\r"], true)) {
            return "'" . $value;
        }

        return $value;
    }
}
