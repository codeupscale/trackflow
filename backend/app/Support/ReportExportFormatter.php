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

    /**
     * OWASP CSV-injection (formula / DDE) mitigation. Employee-controlled cells
     * (name, email, …) can start with a formula trigger — =HYPERLINK(...), +, -,
     * @, or a leading TAB/CR for DDE — which spreadsheet apps execute on open.
     * Prefix any such string with a single quote so it is treated as literal text.
     *
     * Prefix-based and string-only: numbers, ISO dates ("2026-03-16") and HH:MM
     * totals ("09:05") never begin with these characters, so they pass through
     * unchanged. Non-string values are returned as-is.
     */
    private static function neutralizeCsv($value)
    {
        if (! is_string($value) || $value === '') {
            return $value;
        }

        if (in_array($value[0], ['=', '+', '-', '@', "\t", "\r"], true)) {
            return "'" . $value;
        }

        return $value;
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

    /**
     * Per-record check-in / checkout detail export. Accepts an iterable (a lazy DB
     * cursor) so month × all-employee volumes never materialise in memory.
     */
    public static function checkInDetail(iterable $rows): string
    {
        $out = fopen('php://temp', 'r+');
        fwrite($out, "\xEF\xBB\xBF");

        fputcsv($out, [
            'Employee', 'Email', 'Date', 'Sessions', 'First In', 'Last Out', 'Total (HH:MM)',
            'Status', 'Late (min)', 'Early (min)', 'Overtime (min)', 'Missing Checkout',
        ]);

        foreach ($rows as $row) {
            // All string cells pass through neutralizeCsv (formula-injection guard).
            fputcsv($out, [
                self::neutralizeCsv(self::val($row, 'name')),
                self::neutralizeCsv(self::val($row, 'email')),
                self::neutralizeCsv(self::val($row, 'date')),
                self::val($row, 'sessions_count', 0),
                self::neutralizeCsv(self::val($row, 'check_in')),
                self::neutralizeCsv(self::val($row, 'check_out')),
                self::neutralizeCsv(self::val($row, 'worked_hhmm')),
                self::neutralizeCsv(self::val($row, 'status')),
                self::val($row, 'late_minutes', 0),
                self::val($row, 'early_minutes', 0),
                self::val($row, 'overtime_minutes', 0),
                self::val($row, 'missing_checkout') ? 'yes' : 'no',
            ]);
        }

        rewind($out);
        $csv = stream_get_contents($out);
        fclose($out);

        return $csv;
    }

    /**
     * Per-employee check-in rollup export (worked totals + late / early / missing counts).
     */
    public static function checkInSummary(iterable $rows): string
    {
        $out = fopen('php://temp', 'r+');
        fwrite($out, "\xEF\xBB\xBF");

        fputcsv($out, [
            'Employee', 'Email', 'Total (HH:MM)', 'Days Present',
            'Late Count', 'Early Checkout Count', 'Missing Checkout Count',
        ]);

        foreach ($rows as $row) {
            $user = self::val($row, 'user', []);
            // name/email are employee-controlled → neutralize the formula-injection risk.
            fputcsv($out, [
                self::neutralizeCsv(is_array($user) ? ($user['name'] ?? '') : ''),
                self::neutralizeCsv(is_array($user) ? ($user['email'] ?? '') : ''),
                self::neutralizeCsv(self::val($row, 'worked_hhmm')),
                self::val($row, 'days_present', 0),
                self::val($row, 'late_count', 0),
                self::val($row, 'early_checkout_count', 0),
                self::val($row, 'missing_checkout_count', 0),
            ]);
        }

        rewind($out);
        $csv = stream_get_contents($out);
        fclose($out);

        return $csv;
    }
}
