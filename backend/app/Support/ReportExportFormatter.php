<?php

namespace App\Support;

/**
 * Builds downloadable CSV/PDF content for the Reports module.
 *
 * Durations are always presented as hours (2 decimals) with human-readable
 * headers — never raw "total seconds" — and "Time Utilized" reflects tracked
 * working time (idle excluded).
 */
class ReportExportFormatter
{
    public static function csv(string $type, array $data): string
    {
        $out = fopen('php://temp', 'r+');
        // UTF-8 BOM so Excel renders accented characters correctly.
        fwrite($out, "\xEF\xBB\xBF");

        match ($type) {
            'summary' => self::summaryCsv($out, $data),
            'team' => self::teamCsv($out, $data),
            'projects' => self::projectsCsv($out, $data),
            'payroll' => self::payrollCsv($out, $data),
            'attendance' => self::attendanceCsv($out, $data),
            default => null,
        };

        rewind($out);
        $csv = stream_get_contents($out);
        fclose($out);

        return $csv;
    }

    public static function pdf(string $type, array $data, string $dateFrom, string $dateTo): string
    {
        if (class_exists(\Barryvdh\DomPDF\Facade\Pdf::class)) {
            return \Barryvdh\DomPDF\Facade\Pdf::loadView('reports.generic', [
                'type' => $type,
                'data' => $data,
                'dateFrom' => $dateFrom,
                'dateTo' => $dateTo,
            ])->output();
        }

        return json_encode($data, JSON_PRETTY_PRINT);
    }

    private static function hours($seconds): string
    {
        return number_format(((int) $seconds) / 3600, 2);
    }

    /** Read a key from either an array row or a stdClass row. */
    private static function val($row, string $key, $default = '')
    {
        if (is_array($row)) {
            return $row[$key] ?? $default;
        }

        return $row->{$key} ?? $default;
    }

    private static function summaryCsv($out, array $data): void
    {
        fputcsv($out, ['Date', 'Time Utilized (h)', 'Idle (h)', 'Total (h)', 'Activity %', 'Entries']);

        foreach (($data['daily'] ?? []) as $row) {
            fputcsv($out, [
                self::val($row, 'date'),
                self::hours(self::val($row, 'tracked_seconds', 0)),
                self::hours(self::val($row, 'idle_seconds', 0)),
                self::hours(self::val($row, 'total_seconds', 0)),
                round((float) self::val($row, 'activity_score_avg', 0)),
                self::val($row, 'entry_count', 0),
            ]);
        }

        fputcsv($out, []);
        fputcsv($out, [
            'TOTAL',
            self::hours($data['total_seconds_tracked'] ?? 0),
            self::hours($data['total_seconds_idle'] ?? 0),
            self::hours($data['total_seconds'] ?? 0),
            round((float) ($data['avg_activity'] ?? 0)),
            $data['total_entries'] ?? 0,
        ]);
    }

    private static function teamCsv($out, array $data): void
    {
        fputcsv($out, ['Name', 'Email', 'Time Utilized (h)', 'Idle (h)', 'Activity %', 'Entries']);

        foreach ($data as $row) {
            $total = (int) ($row['total_seconds'] ?? 0);
            $idle = (int) ($row['seconds_idle'] ?? 0);
            $tracked = max($total - $idle, 0);

            fputcsv($out, [
                $row['user']['name'] ?? '',
                $row['user']['email'] ?? '',
                self::hours($tracked),
                self::hours($idle),
                $row['avg_activity'] ?? 0,
                $row['entry_count'] ?? 0,
            ]);
        }
    }

    private static function projectsCsv($out, array $data): void
    {
        fputcsv($out, ['Project', 'Time Utilized (h)']);

        foreach ($data as $row) {
            fputcsv($out, [
                $row['name'] ?? '',
                $row['total_hours'] ?? self::hours($row['total_seconds'] ?? 0),
            ]);
        }
    }

    private static function payrollCsv($out, array $data): void
    {
        fputcsv($out, ['Name', 'Email', 'Total Hours', 'Billable Hours', 'Earnings']);

        foreach ($data as $row) {
            fputcsv($out, [
                $row['user']['name'] ?? '',
                $row['user']['email'] ?? '',
                $row['total_hours'] ?? 0,
                $row['billable_hours'] ?? 0,
                $row['earnings'] ?? 0,
            ]);
        }
    }

    private static function attendanceCsv($out, array $data): void
    {
        fputcsv($out, ['Employee', 'Date', 'First Seen', 'Last Seen', 'Time Utilized (h)']);

        foreach ($data as $row) {
            fputcsv($out, [
                self::val($row, 'user_name'),
                self::val($row, 'date'),
                self::val($row, 'first_seen'),
                self::val($row, 'last_seen'),
                self::hours(self::val($row, 'total_seconds', 0)),
            ]);
        }
    }
}
