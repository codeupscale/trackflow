<?php

namespace App\Services;

use App\Models\AppUsageSummary;
use App\Models\User;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\StreamedResponse;

class AppUsageService
{
    private const PDF_ROW_CAP = 5000;
    /**
     * Record a heartbeat's app usage into the daily summary.
     *
     * Upserts by (organization_id, user_id, date, app_name) and increments
     * duration_seconds by $intervalSeconds. Updates window_title to the latest value.
     */
    public function recordHeartbeat(User $user, string $appName, ?string $windowTitle, int $intervalSeconds): void
    {
        $today = now()->toDateString();

        // Use DB upsert for atomicity — avoids race conditions on concurrent heartbeats
        DB::table('app_usage_summaries')->upsert(
            [
                'id' => (string) \Illuminate\Support\Str::uuid(),
                'organization_id' => $user->organization_id,
                'user_id' => $user->id,
                'date' => $today,
                'app_name' => $appName,
                'window_title' => $windowTitle ? mb_substr($windowTitle, 0, 500) : null,
                'duration_seconds' => $intervalSeconds,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            ['organization_id', 'user_id', 'date', 'app_name'], // unique key columns
            [ // columns to update on conflict
                'duration_seconds' => DB::raw("app_usage_summaries.duration_seconds + {$intervalSeconds}"),
                'window_title' => $windowTitle ? mb_substr($windowTitle, 0, 500) : null,
                'updated_at' => now(),
            ]
        );
    }

    /**
     * Get daily app usage summary for a specific user and date.
     * Returns paginated results sorted by duration_seconds descending.
     */
    public function getDailySummary(string $orgId, string $userId, string $date): LengthAwarePaginator
    {
        return AppUsageSummary::withoutGlobalScopes()
            ->where('organization_id', $orgId)
            ->where('user_id', $userId)
            ->where('date', $date)
            ->orderByDesc('duration_seconds')
            ->paginate(20);
    }

    /**
     * Get team-wide app usage aggregated per user per app across a date range.
     * Org-scoped with explicit WHERE clause for raw query safety.
     */
    public function getTeamSummary(string $orgId, string $startDate, string $endDate): LengthAwarePaginator
    {
        return DB::table('app_usage_summaries')
            ->join('users', 'app_usage_summaries.user_id', '=', 'users.id')
            ->where('app_usage_summaries.organization_id', $orgId)
            ->whereBetween('app_usage_summaries.date', [$startDate, $endDate])
            ->select(
                'app_usage_summaries.user_id',
                'users.name as user_name',
                'app_usage_summaries.app_name',
                DB::raw('SUM(app_usage_summaries.duration_seconds) as duration_seconds'),
                DB::raw('COUNT(DISTINCT app_usage_summaries.date) as days_used')
            )
            ->groupBy('app_usage_summaries.user_id', 'users.name', 'app_usage_summaries.app_name')
            ->orderByDesc('duration_seconds')
            ->paginate(30);
    }

    /**
     * Get top apps across the entire organization for a date range.
     * Returns paginated results (use limit param on the frontend to control display).
     */
    public function getTopApps(string $orgId, string $startDate, string $endDate, int $limit = 10): LengthAwarePaginator
    {
        return DB::table('app_usage_summaries')
            ->where('organization_id', $orgId)
            ->whereBetween('date', [$startDate, $endDate])
            ->select(
                'app_name',
                DB::raw('SUM(duration_seconds) as duration_seconds'),
                DB::raw('COUNT(DISTINCT user_id) as user_count'),
                DB::raw('COUNT(DISTINCT date) as days_active')
            )
            ->groupBy('app_name')
            ->orderByDesc('duration_seconds')
            ->paginate($limit);
    }

    /**
     * Stream CSV export for my / team / top app-usage views.
     */
    public function csv(User $actor, array $params): StreamedResponse
    {
        $view = $params['view'] ?? 'team';
        $meta = $this->exportMeta($actor, $params);
        $filename = 'app-usage-' . $view . '-' . now()->format('Ymd-His') . '.csv';

        return new StreamedResponse(function () use ($actor, $params, $view, $meta) {
            $out = fopen('php://output', 'w');
            fwrite($out, "\xEF\xBB\xBF");

            fputcsv($out, [$this->neutralizeCsv('View'), $this->neutralizeCsv($meta['view_label'])]);
            fputcsv($out, [$this->neutralizeCsv('Date Range'), $this->neutralizeCsv($meta['date_range'])]);
            if (! empty($meta['resource'])) {
                fputcsv($out, [$this->neutralizeCsv('Resource'), $this->neutralizeCsv($meta['resource'])]);
            }
            fputcsv($out, [$this->neutralizeCsv('Exported At'), $this->neutralizeCsv($meta['exported_at'])]);
            fputcsv($out, [$this->neutralizeCsv('Exported By'), $this->neutralizeCsv($meta['exported_by'])]);
            fputcsv($out, []);

            $headers = match ($view) {
                'my' => ['Application', 'Duration (h)', 'Productive', 'Window Title'],
                'top' => ['Application', 'Duration (h)', 'Users', 'Days Active'],
                default => ['Employee', 'Application', 'Duration (h)', 'Days Used'],
            };
            fputcsv($out, $headers);

            foreach ($this->exportRowCursor($actor, $params) as $row) {
                fputcsv($out, match ($view) {
                    'my' => [
                        $this->neutralizeCsv($row->app_name),
                        $this->neutralizeCsv(number_format(((int) $row->duration_seconds) / 3600, 2)),
                        $this->neutralizeCsv($this->productiveLabel($row->is_productive ?? null)),
                        $this->neutralizeCsv($row->window_title ?? '—'),
                    ],
                    'top' => [
                        $this->neutralizeCsv($row->app_name),
                        $this->neutralizeCsv(number_format(((int) $row->duration_seconds) / 3600, 2)),
                        $this->neutralizeCsv((string) ($row->user_count ?? 0)),
                        $this->neutralizeCsv((string) ($row->days_active ?? 0)),
                    ],
                    default => [
                        $this->neutralizeCsv($row->user_name),
                        $this->neutralizeCsv($row->app_name),
                        $this->neutralizeCsv(number_format(((int) $row->duration_seconds) / 3600, 2)),
                        $this->neutralizeCsv((string) ($row->days_used ?? 0)),
                    ],
                });
            }

            fclose($out);
        }, 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => "attachment; filename=\"{$filename}\"",
        ]);
    }

    /**
     * PDF export (row-capped).
     */
    public function pdf(User $actor, array $params): \Illuminate\Http\Response
    {
        $view = $params['view'] ?? 'team';
        $count = $this->exportRowCount($actor, $params);

        if ($count > self::PDF_ROW_CAP) {
            abort(422, 'Too many rows for PDF, narrow the date range or use CSV.');
        }

        $rows = iterator_to_array($this->exportRowCursor($actor, $params), false);
        $meta = $this->exportMeta($actor, $params);
        $filename = 'app-usage-' . $view . '-' . now()->format('Ymd-His') . '.pdf';

        return Pdf::loadView('reports.app-usage', [
            'rows' => $rows,
            'meta' => $meta,
            'view' => $view,
        ])->download($filename);
    }

    private function exportMeta(User $actor, array $params): array
    {
        $view = $params['view'] ?? 'team';
        $tz = $actor->getTimezoneForDates();

        $viewLabel = match ($view) {
            'my' => 'My Usage',
            'top' => 'Top Apps',
            default => 'Team Usage',
        };

        if ($view === 'my') {
            $dateRange = $params['date'] ?? now($tz)->toDateString();
            $resource = DB::table('users')
                ->where('organization_id', $actor->organization_id)
                ->where('id', $params['user_id'] ?? $actor->id)
                ->value('name') ?? $actor->name;
        } else {
            $start = $params['start_date'] ?? now($tz)->toDateString();
            $end = $params['end_date'] ?? $start;
            $dateRange = "{$start} to {$end}";
            $resource = null;
        }

        return [
            'view_label' => $viewLabel,
            'date_range' => $dateRange,
            'resource' => $resource,
            'exported_at' => now($tz)->format('Y-m-d H:i') . " ({$tz})",
            'exported_by' => $actor->name,
        ];
    }

    private function exportRowCursor(User $actor, array $params): \Generator
    {
        $view = $params['view'] ?? 'team';
        $orgId = $actor->organization_id;

        if ($view === 'my') {
            $userId = $params['user_id'] ?? $actor->id;
            $date = $params['date'] ?? now()->toDateString();

            $query = AppUsageSummary::withoutGlobalScopes()
                ->where('organization_id', $orgId)
                ->where('user_id', $userId)
                ->where('date', $date)
                ->orderByDesc('duration_seconds')
                ->select(['app_name', 'duration_seconds', 'is_productive', 'window_title']);
        } elseif ($view === 'top') {
            $start = $params['start_date'];
            $end = $params['end_date'];

            $query = DB::table('app_usage_summaries')
                ->where('organization_id', $orgId)
                ->whereBetween('date', [$start, $end])
                ->select(
                    'app_name',
                    DB::raw('SUM(duration_seconds) as duration_seconds'),
                    DB::raw('COUNT(DISTINCT user_id) as user_count'),
                    DB::raw('COUNT(DISTINCT date) as days_active')
                )
                ->groupBy('app_name')
                ->orderByDesc('duration_seconds');
        } else {
            $start = $params['start_date'];
            $end = $params['end_date'];

            $query = DB::table('app_usage_summaries')
                ->join('users', 'app_usage_summaries.user_id', '=', 'users.id')
                ->where('app_usage_summaries.organization_id', $orgId)
                ->whereBetween('app_usage_summaries.date', [$start, $end])
                ->select(
                    'users.name as user_name',
                    'app_usage_summaries.app_name',
                    DB::raw('SUM(app_usage_summaries.duration_seconds) as duration_seconds'),
                    DB::raw('COUNT(DISTINCT app_usage_summaries.date) as days_used')
                )
                ->groupBy('app_usage_summaries.user_id', 'users.name', 'app_usage_summaries.app_name')
                ->orderByDesc('duration_seconds');
        }

        foreach ($query->cursor() as $row) {
            yield $row;
        }
    }

    private function exportRowCount(User $actor, array $params): int
    {
        $count = 0;
        foreach ($this->exportRowCursor($actor, $params) as $_row) {
            $count++;
        }

        return $count;
    }

    private function productiveLabel(mixed $value): string
    {
        if ($value === null) {
            return '—';
        }

        return filter_var($value, FILTER_VALIDATE_BOOLEAN) ? 'Yes' : 'No';
    }

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
