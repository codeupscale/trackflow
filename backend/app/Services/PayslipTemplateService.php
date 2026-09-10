<?php

namespace App\Services;

use App\Models\AttendanceRecord;
use App\Models\EmployeeProfile;
use App\Models\LeaveBalance;
use App\Support\Money;
use App\Models\PayComponent;
use App\Models\Payslip;
use App\Models\PayslipTemplate;
use App\Support\PayslipTemplateRenderer;
use Barryvdh\DomPDF\Facade\Pdf;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Owns the per-organization payslip design and turns a Payslip row into the
 * payload a Blade layout renders.
 *
 * The template is presentation ONLY. Nothing here may change an amount: a
 * payslip is a financial record, and a company editing its letterhead must
 * never be able to alter what an employee was paid. Every figure below is read
 * from the payslip and its line items exactly as payroll wrote them.
 */
class PayslipTemplateService
{
    /**
     * HR fields a payslip design can print, beyond name and email.
     *
     * Bank and tax identifiers are ENCRYPTED at rest and `$hidden` on the
     * model — they are resolved here, through the model's casts, because a
     * payslip is one of the few documents that legitimately carries them. The
     * account number is offered masked as well, so an org that only needs
     * "which account was this paid into" is not obliged to print the whole
     * number on a document that gets emailed and printed.
     */
    /**
     * Bump this whenever a change here alters what a rendered payslip LOOKS
     * like — a new field, a different value, a change to the Blade layouts.
     *
     * Rendered PDFs are cached for a day under a key built from the payslip's
     * and the template's timestamps. Neither moves when the code does, so
     * without this a fix to the renderer cannot reach a document already
     * cached, and the old output keeps being served as though nothing had been
     * fixed. It is one line to change and the only thing that makes a renderer
     * fix take effect immediately.
     */
    public const RENDERER_VERSION = 3;

    /**
     * How many spare "Other" rows a design may place, per side.
     *
     * Five rather than the three on the current artwork: the number is a
     * property of whatever design an organization uploads, and a slot nobody
     * places costs nothing, while a line with nowhere to go is missing money.
     */
    private const OVERFLOW_SLOTS = 5;

    private const PROFILE_FIELDS = [
        'employee.designation' => 'Designation',
        'employee.department' => 'Department',
        'employee.employee_id' => 'Employee ID',
        'employee.employment_type' => 'Employee type',
        'employee.date_of_joining' => 'Joining date',
        'employee.service_period' => 'Service period',
        'employee.work_location' => 'Work location',
        'employee.mode_of_payment' => 'Mode of payment',
        'employee.cnic' => 'CNIC / Tax ID',
        'employee.bank_name' => 'Bank name',
        'employee.account_title' => 'Account title',
        'employee.account_number' => 'Account / IBAN',
        'employee.account_number_masked' => 'Account / IBAN (masked)',
    ];


    /**
     * The org's template, created with defaults on first read. Returning a real
     * row (rather than an unsaved model) keeps the settings screen and the PDF
     * reading the same source.
     */
    public function forOrganization(string $orgId): PayslipTemplate
    {
        return PayslipTemplate::firstOrCreate(['organization_id' => $orgId]);
    }

    public function update(string $orgId, array $data): PayslipTemplate
    {
        if (! empty($data['background_image_data_uri'])) {
            $data['background_image_data_uri'] = $this->optimizeBackground(
                $data['background_image_data_uri'],
            );
        }

        $template = $this->forOrganization($orgId);
        $template->fill($data)->save();

        return $template->refresh();
    }

    /**
     * Downscale and re-encode an uploaded payslip design.
     *
     * dompdf decodes the background on EVERY render, and a full-resolution
     * export is the single most expensive thing in the document: a 1MB PNG
     * measured at 10.6 seconds per payslip, which is the whole delay when
     * opening a review. A4 at 200dpi is 1654px wide — more than enough for
     * print — and dropping the alpha channel by encoding as JPEG removes the
     * per-pixel compositing dompdf does for transparent PNGs.
     *
     * Failures return the original untouched: a slow payslip is a far better
     * outcome than a lost design.
     */
    public function optimizeBackground(string $dataUri, int $maxWidth = 1654): string
    {
        if (! function_exists('imagecreatefromstring')) {
            return $dataUri;
        }

        $comma = strpos($dataUri, ',');
        if ($comma === false) {
            return $dataUri;
        }

        $binary = base64_decode(substr($dataUri, $comma + 1), true);
        if ($binary === false) {
            return $dataUri;
        }

        try {
            $image = @imagecreatefromstring($binary);
            if ($image === false) {
                return $dataUri;
            }

            $width = imagesx($image);
            $height = imagesy($image);

            if ($width > $maxWidth) {
                $height = (int) round($height * ($maxWidth / $width));
                $width = $maxWidth;
            }

            // Flattened onto white: JPEG has no alpha, and without this a
            // transparent design would come out with a black background.
            $canvas = imagecreatetruecolor($width, $height);
            imagefill($canvas, 0, 0, imagecolorallocate($canvas, 255, 255, 255));
            imagecopyresampled($canvas, $image, 0, 0, 0, 0, $width, $height, imagesx($image), imagesy($image));

            ob_start();
            imagejpeg($canvas, null, 85);
            $optimized = (string) ob_get_clean();

            imagedestroy($image);
            imagedestroy($canvas);

            // Only keep it if it actually helped.
            if ($optimized === '' || strlen($optimized) >= strlen($binary)) {
                return $dataUri;
            }

            return 'data:image/jpeg;base64,' . base64_encode($optimized);
        } catch (\Throwable $e) {
            Log::warning('Could not optimize the payslip background; using it as uploaded.', [
                'error' => $e->getMessage(),
            ]);

            return $dataUri;
        }
    }

    /**
     * Build the render payload for one payslip.
     *
     * Optional sections are only QUERIED when their toggle is on — an org that
     * does not show leave balances pays nothing for the feature.
     */
    public function renderData(Payslip $payslip, PayslipTemplate $template): array
    {
        $payslip->loadMissing([
            // job_title is selected explicitly: it is the fallback for
            // Designation, and a column left out of the select is null on the
            // model rather than an error, so omitting it fails silently.
            'user:id,name,email,job_title',
            'payrollPeriod',
            'lineItems' => fn ($q) => $q->orderBy('sort_order'),
        ]);

        $period = $payslip->payrollPeriod;

        $earnings = $payslip->lineItems->where('type', 'earning')->values();
        $deductions = $payslip->lineItems->where('type', 'deduction')->values();
        $employerItems = $payslip->lineItems->where('type', 'employer_contribution')->values();

        $data = [
            'template' => $template,
            'payslip' => $payslip,
            'period' => $period,
            'employee' => $payslip->user,
            'earnings' => $earnings,
            'deductions' => $deductions,
            'employer_items' => $employerItems,
            'employer_total' => (float) $employerItems->sum('amount'),
            'currency' => $this->resolveCurrency($payslip),
            'company_name' => $template->company_name
                ?: optional($payslip->organization)->name
                ?: 'Company',
            'generated_at' => now(),
            'attendance' => null,
            'leave_balances' => null,
            'ytd' => null,
        ];

        // Optional sections are computed only when the design actually asks
        // for them. With the layout now being the company's own artwork or
        // HTML, the authority on what a payslip shows is the design itself —
        // and a run of 200 payslips must not pay for three extra queries each
        // to fill sections nobody placed.
        $needs = $this->sectionsReferencedBy($template);

        if ($needs['attendance'] && $period) {
            $data['attendance'] = $this->attendanceSummary($payslip, $period->start_date, $period->end_date);
        }

        if ($needs['leave']) {
            $data['leave_balances'] = $this->leaveBalances($payslip, $period?->end_date);
        }

        if ($needs['ytd'] && $period) {
            $data['ytd'] = $this->yearToDate($payslip, $period->end_date);
        }

        $data['profile'] = $needs['profile'] ? $this->employeeProfileFields($payslip) : [];

        return $data;
    }

    /**
     * A throwaway in-memory payslip used to preview the design before any real
     * payroll has run. Never saved — `newInstance` + `setRelation` keeps it out
     * of the database entirely.
     */
    public function sampleRenderData(string $orgId, string $companyName, array $overrides = []): array
    {
        $template = $this->forOrganization($orgId);

        // Unsaved edits from the settings screen. Applied to an in-memory copy
        // BEFORE anything below reads the toggles, so previewing "show
        // attendance" actually shows attendance — applying them afterwards
        // would preview the stored row's sections under the new styling.
        if ($overrides !== []) {
            $template = $template->replicate()->forceFill($overrides);
        }

        $payslip = new Payslip([
            'organization_id' => $orgId,
            'gross_salary' => 180000,
            'total_allowances' => 30000,
            'total_deductions' => 24500,
            'net_salary' => 155500,
            'status' => 'draft',
            'payment_date' => now(),
            'payment_method' => 'Bank transfer',
        ]);

        $items = collect([
            ['label' => 'Basic Salary', 'type' => 'earning', 'category' => 'basic', 'amount' => 150000.0],
            ['label' => 'Housing Allowance', 'type' => 'earning', 'amount' => 20000.0],
            ['label' => 'Transport Allowance', 'type' => 'earning', 'amount' => 10000.0],
            ['label' => 'Income Tax', 'type' => 'deduction', 'amount' => 18000.0],
            ['label' => 'Social Security', 'type' => 'deduction', 'amount' => 6500.0],
        ])->map(fn (array $row) => (object) $row);

        return [
            'template' => $template,
            'payslip' => $payslip,
            'period' => (object) [
                'name' => now()->format('F Y'),
                'start_date' => now()->startOfMonth(),
                'end_date' => now()->endOfMonth(),
            ],
            'employee' => (object) [
                'name' => 'Sample Employee',
                'email' => 'sample@example.com',
            ],
            'profile' => [
                'employee.designation' => 'Software Engineer',
                'employee.department' => 'Engineering',
                'employee.employee_id' => 'EMP-0042',
                'employee.employment_type' => 'Full Time',
                'employee.date_of_joining' => '01 Mar 2024',
                'employee.service_period' => '2 years, 6 months',
                'employee.work_location' => 'Lahore',
                'employee.cnic' => '35202-1234567-8',
                'employee.bank_name' => 'Meezan Bank',
                'employee.account_title' => 'Sample Employee',
                'employee.account_number' => 'PK36MEZN0001234567890123',
                'employee.account_number_masked' => '••••••••••••••••••••0123',
            ],
            'earnings' => $items->where('type', 'earning')->values(),
            'deductions' => $items->where('type', 'deduction')->values(),
            'employer_items' => collect(),
            'employer_total' => 0.0,
            'currency' => $this->orgCurrency($orgId),
            'company_name' => $template->company_name ?: $companyName,
            'generated_at' => now(),
            'attendance' => $template->show_attendance_summary
                ? ['working_days' => 22, 'present_days' => 21, 'absent_days' => 1, 'late_days' => 2, 'leave_days' => 0]
                : null,
            'leave_balances' => $template->show_leave_balance
                ? [['name' => 'Annual Leave', 'remaining' => 8.5, 'total' => 14.0]]
                : null,
            'ytd' => $template->show_ytd_totals
                ? ['gross' => 1440000.0, 'deductions' => 196000.0, 'net' => 1244000.0]
                : null,
            'is_sample' => true,
        ];
    }

    /**
     * Render a payload to a PDF, honouring an uploaded design when the org has
     * one.
     *
     * A custom template that throws at render time falls back to the built-in
     * `classic` layout and logs. That is deliberate: a design is cosmetic, and
     * an employee must always be able to get their payslip. Failing the
     * download because a company's HTML is malformed would make a presentation
     * setting capable of withholding a financial record.
     */
    public function renderPdf(array $data): \Barryvdh\DomPDF\PDF
    {
        $template = $data['template'];

        if ($template->usesImageTemplate()) {
            return Pdf::loadView('payslips.image', $data + [
                'field_values' => $this->imageFieldValues($data),
            ])->setPaper('a4')->setOptions([
                'isPhpEnabled' => false,
                'isJavascriptEnabled' => false,
                'isRemoteEnabled' => false,
                // `true` = MERGE with the package defaults. Without it this
                // REPLACES the whole option set, dropping fontDir/fontCache/
                // tempDir — so dompdf rebuilt its font metrics on every single
                // render. That alone was ~7 of the ~9 seconds it took to open
                // a payslip.
            ], true);
        }

        if ($template->usesCustomTemplate()) {
            try {
                // Re-validated at RENDER time, not only at upload. The engine
                // degrades rather than throws — an unclosed {{#each}} silently
                // swallows the rest of the document — so catching exceptions
                // alone would ship a blank payslip instead of falling back.
                // Re-checking here also covers a row edited around the API.
                $problems = PayslipTemplateRenderer::validate($template->custom_template_html);

                if ($problems !== []) {
                    throw new \RuntimeException(implode(' ', $problems));
                }

                $html = PayslipTemplateRenderer::render(
                    $template->custom_template_html,
                    $this->customContext($data),
                );

                return Pdf::loadHTML($html)->setOptions([
                    // Belt and braces over the package defaults: an uploaded
                    // document never executes and never reaches the network.
                    'isPhpEnabled' => false,
                    'isJavascriptEnabled' => false,
                    'isRemoteEnabled' => false,
                    ], true);
            } catch (\Throwable $e) {
                Log::warning('Custom payslip template failed to render; falling back to the built-in layout.', [
                    'organization_id' => $template->organization_id,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return Pdf::loadView('payslips.document', $data);
    }

    /**
     * Flatten a render payload into the closed, scalar-only context a
     * company-uploaded template may reference.
     *
     * This is the ONLY surface an uploaded design can see. Nothing here is a
     * model, a relation or a callable — a custom template gets pre-formatted
     * strings and plain lists, so it can display payroll but can never query
     * it, reach another organization's row, or execute anything.
     */
    public function customContext(array $data): array
    {
        $currency = $data['currency'];
        $money = fn ($n) => $currency . ' ' . number_format((float) $n, 2);
        $date = fn ($d) => $d ? \Illuminate\Support\Carbon::parse($d)->format('d M Y') : '';

        $template = $data['template'];
        $payslip = $data['payslip'];
        $period = $data['period'];
        $isDraft = ($payslip->status ?? 'draft') === 'draft';

        $list = fn ($items) => collect($items)->map(fn ($i) => [
            'label' => $i->label,
            'amount' => $money($i->amount),
            'amount_raw' => number_format((float) $i->amount, 2, '.', ''),
            // What the line IS, independent of what it is called. The overflow
            // rows need it to tell basic pay — which has a box of its own under
            // a different key — from an ordinary allowance.
            'category' => $i->category ?? null,
        ])->all();

        $context = [
            'company' => [
                'name' => $data['company_name'],
                'address' => (string) ($template->company_address ?? ''),
                'registration_no' => (string) ($template->company_registration_no ?? ''),
                // Pre-composed by the server, so the template embeds a logo
                // without ever handling a URL or a file path itself.
                'logo_img' => $template->logo_data_uri
                    ? '<img src="' . e($template->logo_data_uri) . '" style="max-height:60px;max-width:200px;" alt="">'
                    : '',
                'accent_color' => $template->accent_color,
            ],
            // HR fields are merged under the same `employee.` prefix as name
            // and email, so a design refers to "employee.designation" without
            // caring which table it came from.
            'employee' => array_merge(
                ['name' => $data['employee']->name, 'email' => $data['employee']->email],
                collect($data['profile'] ?? [])
                    ->mapWithKeys(fn ($v, $k) => [str($k)->after('employee.')->toString() => $v])
                    ->all(),
            ),
            'period' => [
                'name' => $period->name ?? '',
                // Derived from the dates, NOT abbreviated from the name. The
                // name is what someone typed when they opened the run and what
                // every payroll screen shows; a design that wants a short label
                // in a narrow header should not force that name to be short
                // everywhere else.
                'short' => $this->shortPeriod($period->start_date ?? null),
                'start' => $date($period->start_date ?? null),
                'end' => $date($period->end_date ?? null),
            ],
            'pay' => [
                'currency' => $currency,
                // Basic pay on its own, resolved from the line's CATEGORY
                // rather than its label — so the Basic Salary box on a design
                // keeps working whatever the line happens to be called.
                'basic' => $money(
                    collect($data['earnings'])
                        ->filter(fn ($i) => ($i->category ?? null) === 'basic')
                        ->sum('amount'),
                ),
                'gross' => $money($payslip->gross_salary),
                'allowances' => $money($payslip->total_allowances),
                'deductions' => $money($payslip->total_deductions),
                'net' => $money($payslip->net_salary),
                'status' => ucfirst($payslip->status ?? 'draft'),
            ],
            'payment' => [
                'date' => $date($payslip->payment_date ?? null),
                // Falls back to how this employee is normally paid. The
                // payslip's own payment_method is only set when a run records
                // an exception, and payroll does not write it today — so
                // without the fallback this field is permanently blank while
                // the answer sits on the employee's profile.
                'method' => (string) ($payslip->payment_method
                    ?: ($data['profile']['employee.mode_of_payment'] ?? '')),
                'reference' => (string) ($payslip->notes ?? ''),
            ],
            'earnings' => $list($data['earnings']),
            'deductions' => $list($data['deductions']),
            'employer_items' => $list($data['employer_items']),
            'footer_note' => (string) ($template->footer_note ?? ''),
            'generated_at' => $data['generated_at']->format('d M Y, H:i'),
            'is_draft' => $isDraft,
            // Server-composed markup: an uploaded design that forgets to mark a
            // draft still cannot present an unapproved figure as final.
            'draft_stamp' => $isDraft
                ? '<span style="border:1px solid #b45309;color:#b45309;padding:2px 8px;'
                    . 'font-size:9px;font-weight:bold;letter-spacing:1px;">DRAFT</span>'
                : '',
        ];

        if (! empty($data['attendance'])) {
            $context['attendance'] = array_map('strval', $data['attendance']);
        }

        if (! empty($data['leave_balances'])) {
            $context['leave_balances'] = collect($data['leave_balances'])->map(fn ($b) => [
                'name' => $b['name'],
                'remaining' => number_format($b['remaining'], 1),
                'total' => number_format($b['total'], 1),
            ])->all();
        }

        if (! empty($data['ytd'])) {
            $context['ytd'] = [
                'gross' => $money($data['ytd']['gross']),
                'deductions' => $money($data['ytd']['deductions']),
                'net' => $money($data['ytd']['net']),
            ];
        }

        return $context;
    }

    /**
     * Flatten the render payload into `key => printed string` for the image
     * layout, where every value is a single line dropped at a saved position.
     *
     * Line items appear TWICE and deliberately so. A company's artwork usually
     * pre-prints its own row labels ("Basic Salary", "Tax Deduction") with only
     * the amount column blank, so `component.basic-salary` addresses a row by
     * NAME and keeps pointing at the right box when payroll reorders its
     * components. `earning.1` addresses the first row whatever it is called,
     * for artwork with unlabelled rows.
     */
    /**
     * A pay period as a short month and year — "Sept 2026".
     *
     * The abbreviations are spelled out rather than taken from PHP's `M`,
     * which gives "Sep". Four of the twelve months are conventionally shortened
     * to four letters in payroll and press style, and a header that reads
     * "Sep 2026" beside a design set in "Sept" is the kind of mismatch this
     * field exists to avoid.
     */
    private function shortPeriod(mixed $startDate): string
    {
        if (! $startDate) {
            return '';
        }

        $months = [
            1 => 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July',
            'Aug', 'Sept', 'Oct', 'Nov', 'Dec',
        ];

        $start = \Illuminate\Support\Carbon::parse($startDate);

        return $months[(int) $start->month] . ' ' . $start->year;
    }

    /**
     * Is this line worth printing at all?
     *
     * Read from `amount_raw` — the unformatted figure — rather than from the
     * display string, which carries a currency symbol and thousands separators
     * and would need unpicking to compare against zero.
     */
    private function isZeroAmount(mixed $rawAmount): bool
    {
        return abs((float) $rawAmount) < 0.005;
    }

    public function imageFieldValues(array $data): array
    {
        $context = $this->customContext($data);
        $values = [];

        foreach ($context as $key => $value) {
            if (is_array($value)) {
                continue;
            }
            $values[$key] = (string) $value;
        }

        foreach (['company', 'employee', 'period', 'pay', 'payment'] as $group) {
            foreach (($context[$group] ?? []) as $sub => $subValue) {
                if (! is_array($subValue)) {
                    $values["{$group}.{$sub}"] = (string) $subValue;
                }
            }
        }

        foreach (['attendance', 'ytd'] as $group) {
            foreach (($context[$group] ?? []) as $sub => $subValue) {
                $values["{$group}.{$sub}"] = (string) $subValue;
            }
        }

        foreach (['earning' => 'earnings', 'deduction' => 'deductions'] as $single => $plural) {
            foreach (($context[$plural] ?? []) as $index => $row) {
                $position = $index + 1;
                // A zero line reads as BLANK, not as "0.00". The rows on a
                // company's artwork are pre-printed for every component it
                // might use, so on any given month most of them are zero —
                // and a column of "PKR 0.00" is noise a reader has to look
                // past to find the figures that matter. The renderer skips an
                // empty string, so this is how a placed field prints nothing.
                $blank = $this->isZeroAmount($row['amount_raw'] ?? null);

                $values["{$single}.{$position}.label"] = $row['label'];
                $values["{$single}.{$position}.amount"] = $blank ? '' : $row['amount'];

                // FIRST line of a given name owns the box, not the last.
                // Nothing stops a payslip carrying three lines all called
                // "Other Deduction", and this assignment used to overwrite —
                // so a box showed the last of them and the earlier two
                // vanished from the document entirely. One box holds one
                // value; the rest are unmatched and flow to the spare rows.
                $componentKey = 'component.' . str($row['label'])->slug();
                if (! array_key_exists($componentKey, $values)) {
                    $values[$componentKey] = $blank ? '' : $row['amount'];
                }
            }
        }

        return $values + $this->overflowValues($data, $context);
    }

    /**
     * The catch-all rows: whatever this payslip deducts or pays that the design
     * has NO box of its own for.
     *
     * A design carries a fixed set of printed rows — "Tax Deduction", "Loan
     * Deduction" — plus a few spares labelled "Other Deduction". A payroll run
     * is not fixed: someone can add a line called anything at all. Without
     * these, such a line is simply absent from the PDF, and a payslip that
     * silently omits a deduction is worse than one that prints it untidily.
     *
     * A line is "unmatched" when nothing on the design is already printing it —
     * so adding a dedicated box for a component immediately stops it appearing
     * in the spares, with no second setting to keep in step. The name is
     * carried INTO the value ("5,000.00 (Leave Deduction)"), because the
     * printed row beside it says "Other Deduction" and an amount with no name
     * attached is unreadable.
     *
     * "Already printing it" is decided PER LINE, not per name. A box holds one
     * value, so of three lines all called "Other Deduction" the first claims
     * the placed box and the other two are unmatched. Treating the name as
     * matched made all three disappear into a single box that could only show
     * one of them.
     */
    private function overflowValues(array $data, array $context): array
    {
        $placed = collect($data['template']->field_positions ?? [])
            ->pluck('key')
            ->filter()
            ->all();

        $values = [];
        // Shared across both sides, in the same order `imageFieldValues` walks
        // them, so the line that claims a box here is the same one that filled
        // it there.
        $claimed = [];

        foreach (['earning' => 'earnings', 'deduction' => 'deductions'] as $single => $plural) {
            $slot = 0;

            foreach (($context[$plural] ?? []) as $row) {
                $componentKey = 'component.' . str($row['label'])->slug();

                if (in_array($componentKey, $placed, true) && ! isset($claimed[$componentKey])) {
                    $claimed[$componentKey] = true;
                    continue;
                }

                // Basic pay has a box of its own that is NOT a `component.`
                // key. Without this the base salary spills into "Other earning
                // 1" on a design that is already printing it under Basic
                // Salary — the same figure twice.
                if (($row['category'] ?? null) === 'basic'
                    && in_array('pay.basic', $placed, true)
                    && ! isset($claimed['pay.basic'])
                ) {
                    $claimed['pay.basic'] = true;
                    continue;
                }

                // A zero line is a row the design prints as blank on purpose —
                // spending a spare slot on "0.00 (Arrears)" pushes a real
                // deduction off the page.
                if ($this->isZeroAmount($row['amount_raw'] ?? null)) {
                    continue;
                }

                $slot++;
                if ($slot > self::OVERFLOW_SLOTS) {
                    break;
                }

                // ONE key per slot, carrying both figure and name. Offering the
                // two separately would put fifteen more entries per side into a
                // picker that is searched by eye.
                $values["{$single}.other.{$slot}"] = $row['amount'] . ' (' . $row['label'] . ')';
            }

            // Unfilled slots resolve to empty, which the renderer skips — so a
            // month with nothing left over prints nothing rather than a stale
            // value from the sample data.
            for ($i = $slot + 1; $i <= self::OVERFLOW_SLOTS; $i++) {
                $values["{$single}.other.{$i}"] = '';
            }
        }

        return $values;
    }

    /**
     * The draggable palette for the image layout: every field that can be
     * printed onto a company's artwork, grouped for the placer UI. Derived from
     * a sample render, so a field can never be offered that does not resolve.
     */
    public function imageFieldCatalogue(string $orgId, string $companyName): array
    {
        $sample = $this->sampleRenderData($orgId, $companyName, [
            'show_attendance_summary' => true,
            'show_leave_balance' => true,
            'show_ytd_totals' => true,
        ]);

        $labels = self::PROFILE_FIELDS + [
            'employee.name' => 'Employee name',
            'employee.email' => 'Employee email',
            'company.name' => 'Company name',
            'company.address' => 'Company address',
            'company.registration_no' => 'Registration number',
            'period.name' => 'Pay period',
            'period.short' => 'Pay period (short)',
            'period.start' => 'Period start',
            'period.end' => 'Period end',
            'pay.basic' => 'Base salary',
            'pay.gross' => 'Gross / total earnings',
            'pay.allowances' => 'Total allowances',
            'pay.deductions' => 'Total deductions',
            'pay.net' => 'Net / total payable',
            'pay.currency' => 'Currency',
            'pay.status' => 'Status',
            'payment.date' => 'Payment date',
            // Distinct from "Mode of payment" above. Two entries carrying the
            // same label is how a field that is always blank gets placed
            // instead of the one holding the answer.
            'payment.method' => 'Mode of payment (this run)',
            'payment.reference' => 'Payment reference',
            'generated_at' => 'Generated at',
            'footer_note' => 'Footer note',
        ];

        // The spare rows need spelling out: derived from the key they would
        // read "1", "2", "3", which says nothing about what they are for.
        for ($i = 1; $i <= self::OVERFLOW_SLOTS; $i++) {
            $labels["deduction.other.{$i}"] = "Other deduction {$i}";
            $labels["earning.other.{$i}"] = "Other earning {$i}";
        }

        $groups = ['Employee' => [], 'Pay' => [], 'Company' => [], 'Earnings' => [], 'Deductions' => [], 'Other' => []];
        $values = $this->imageFieldValues($sample);

        // Every pay component the org has CONFIGURED, not merely the ones a
        // past run happened to produce. A design is built before payroll runs,
        // and its rows are pre-printed ("Over Time", "Medical Allowance") — so
        // the box for a component has to be placeable the moment the component
        // exists, otherwise the design cannot be finished until after a run
        // that the design is supposed to precede.
        foreach (PayComponent::where('organization_id', $orgId)->orderBy('name')->get() as $component) {
            $key = 'component.' . str($component->name)->slug();

            if (isset($values[$key])) {
                continue; // already offered from the sample's line items
            }

            $groups[in_array($component->type, ['deduction', 'tax'], true) ? 'Deductions' : 'Earnings'][] = [
                'key' => $key,
                'label' => $component->name,
                'sample' => $sample['currency'] . ' 0.00',
            ];
        }

        foreach ($values as $key => $sampleValue) {
            $group = match (true) {
                str_starts_with($key, 'employee.') => 'Employee',
                str_starts_with($key, 'company.') => 'Company',
                str_starts_with($key, 'pay.'), str_starts_with($key, 'payment.') => 'Pay',
                str_starts_with($key, 'earning.') => 'Earnings',
                str_starts_with($key, 'deduction.') => 'Deductions',
                str_starts_with($key, 'component.') => 'Earnings',
                default => 'Other',
            };

            // Markup the server composes for the HTML layouts; meaningless as a
            // single printed line, so it is never offered as a droppable field.
            if (in_array($key, ['company.logo_img', 'draft_stamp'], true)) {
                continue;
            }

            $groups[$group][] = [
                'key' => $key,
                'label' => $labels[$key] ?? str($key)->afterLast('.')->headline()->toString(),
                'sample' => $sampleValue,
            ];
        }

        return array_filter($groups, fn (array $fields) => $fields !== []);
    }

    /**
     * The placeholder reference the settings screen shows the uploader. Built
     * from a sample render so it can never drift from what actually resolves.
     */
    public function placeholderReference(string $orgId, string $companyName): array
    {
        $context = $this->customContext($this->sampleRenderData($orgId, $companyName));

        $scalars = [];
        $lists = [];

        foreach ($context as $key => $value) {
            if (is_array($value) && array_is_list($value)) {
                $lists[$key] = array_keys($value[0] ?? []);
            } elseif (is_array($value)) {
                foreach ($value as $sub => $subValue) {
                    $scalars["{$key}.{$sub}"] = is_scalar($subValue) ? (string) $subValue : '';
                }
            } else {
                $scalars[$key] = is_scalar($value) ? (string) $value : '';
            }
        }

        return ['values' => $scalars, 'lists' => $lists];
    }

    /**
     * The filename an employee sees. Kept free of spaces and of anything a user
     * can inject — the employee name is slugged, never interpolated raw.
     */
    public function filenameFor(Payslip $payslip): string
    {
        $person = str($payslip->user?->name ?? 'payslip')->slug();
        $period = str($payslip->payrollPeriod?->name ?? now()->format('Y-m'))->slug();

        return "payslip-{$person}-{$period}.pdf";
    }

    /**
     * Which optional sections the org's design actually references.
     *
     * For the image layout that means a placed field key; for an uploaded HTML
     * template it means a placeholder in the markup. The built-in fallback
     * layout keeps its stored toggles, since it has no design to read.
     */
    private function sectionsReferencedBy(PayslipTemplate $template): array
    {
        if ($template->usesImageTemplate()) {
            $keys = collect($template->field_positions ?? [])->pluck('key')->implode(' ');

            return [
                'attendance' => str_contains($keys, 'attendance.'),
                'leave' => false, // the image layout prints single values, not lists
                'ytd' => str_contains($keys, 'ytd.'),
                'profile' => $this->referencesProfile($keys),
            ];
        }

        if ($template->usesCustomTemplate()) {
            $html = (string) $template->custom_template_html;

            return [
                'attendance' => str_contains($html, 'attendance.'),
                'leave' => str_contains($html, 'leave_balances'),
                'ytd' => str_contains($html, 'ytd.'),
                'profile' => $this->referencesProfile($html),
            ];
        }

        return [
            'attendance' => (bool) $template->show_attendance_summary,
            'leave' => (bool) $template->show_leave_balance,
            'ytd' => (bool) $template->show_ytd_totals,
            'profile' => false,
        ];
    }

    /**
     * HR fields cost an extra join per payslip, so they are only fetched when
     * the design actually prints one. Name and email come off the payslip's
     * user and are deliberately not in this list.
     */
    private function referencesProfile(string $haystack): bool
    {
        foreach (self::PROFILE_FIELDS as $key => $_label) {
            if (str_contains($haystack, $key)) {
                return true;
            }
        }

        return false;
    }

    /**
     * The employee's HR record, resolved through the Eloquent model so the
     * encrypted bank and tax columns are decrypted by their casts rather than
     * read raw. Every value is a display string; a missing record yields empty
     * strings, so a design never breaks on an employee whose profile is
     * incomplete — that box simply stays blank.
     */
    private function employeeProfileFields(Payslip $payslip): array
    {
        $profile = EmployeeProfile::with(['position:id,title', 'department:id,name'])
            ->where('organization_id', $payslip->organization_id)
            ->where('user_id', $payslip->user_id)
            ->first();

        $blank = array_fill_keys(array_keys(self::PROFILE_FIELDS), '');
        $blank['employee.account_title'] = $payslip->user?->name ?? '';

        if (! $profile) {
            return $blank;
        }

        $joined = $profile->date_of_joining;
        $account = (string) ($profile->bank_account_number ?? '');

        return array_merge($blank, array_filter([
            // Designation comes from the linked POSITION when there is one,
            // and falls back to the free-text job title on the user record.
            // Both exist and both are edited as "Designation": the employee
            // screen writes users.job_title, while positions are a separate
            // catalogue with salary bands. Reading only the position meant a
            // designation typed on the employee form never reached the
            // payslip — it was saved, just not where this looked.
            'employee.designation' => $profile->position?->title
                ?: ($payslip->user?->job_title ?: null),
            'employee.department' => $profile->department?->name,
            'employee.employee_id' => $profile->employee_id,
            'employee.employment_type' => $profile->employment_type
                ? str($profile->employment_type)->replace('_', ' ')->title()->toString()
                : null,
            'employee.date_of_joining' => $joined ? Carbon::parse($joined)->format('d M Y') : null,
            'employee.service_period' => $joined ? $this->servicePeriod($joined) : null,
            'employee.work_location' => $profile->work_location,
            'employee.mode_of_payment' => $profile->payment_mode,
            'employee.cnic' => $profile->tax_id,
            'employee.bank_name' => $profile->bank_name,
            // Falls back to the employee's own name, which is what an account
            // title usually is — storing it is for the cases where it is not.
            'employee.account_title' => $profile->bank_account_title
                ?: ($payslip->user?->name ?? null),
            'employee.account_number' => $account ?: null,
            // Last four only — the same masking rule EmployeeService uses.
            'employee.account_number_masked' => $account !== ''
                ? str_repeat('•', max(0, strlen($account) - 4)) . substr($account, -4)
                : null,
        ], fn ($v) => $v !== null && $v !== ''));
    }

    /** "2 years, 3 months" — how long they have been with the company. */
    private function servicePeriod(mixed $joined): string
    {
        $start = Carbon::parse($joined);

        // Carbon 3 returns FLOATS from diffIn*, so without the cast a payslip
        // prints "2.2536232369336 years, 3.0190827161254 months" — which is
        // exactly the kind of thing nobody notices until it is on a document
        // that went to the whole company.
        $years = (int) $start->diffInYears(now());
        $months = (int) $start->copy()->addYears($years)->diffInMonths(now());

        $parts = [];
        if ($years > 0) {
            $parts[] = $years . ' year' . ($years === 1 ? '' : 's');
        }
        if ($months > 0 || $parts === []) {
            $parts[] = $months . ' month' . ($months === 1 ? '' : 's');
        }

        return implode(', ', $parts);
    }

    // ── Optional sections ─────────────────────────────────────────────────

    /**
     * Attendance for the pay period, read from the same `attendance_records`
     * rollup the attendance screens read, so the payslip can never disagree
     * with what HR sees there.
     */
    private function attendanceSummary(Payslip $payslip, $start, $end): array
    {
        $rows = AttendanceRecord::query()
            ->where('organization_id', $payslip->organization_id)
            ->where('user_id', $payslip->user_id)
            ->whereBetween('date', [$start, $end])
            ->get(['status', 'check_in_status']);

        $working = $rows->whereNotIn('status', ['weekend', 'holiday']);

        return [
            'working_days' => $working->count(),
            'present_days' => $working->whereIn('status', ['present', 'half_day'])->count(),
            'absent_days' => $working->where('status', 'absent')->count(),
            'leave_days' => $working->where('status', 'on_leave')->count(),
            'late_days' => $rows->where('check_in_status', 'late')->count(),
        ];
    }

    private function leaveBalances(Payslip $payslip, $asOf): array
    {
        $year = $asOf ? (int) date('Y', strtotime((string) $asOf)) : (int) now()->year;

        return LeaveBalance::query()
            ->where('organization_id', $payslip->organization_id)
            ->where('user_id', $payslip->user_id)
            ->where('year', $year)
            ->with('leaveType:id,name')
            ->get()
            ->map(fn (LeaveBalance $b) => [
                'name' => $b->leaveType?->name ?? 'Leave',
                'total' => (float) $b->total_days + (float) $b->carried_over_days,
                'remaining' => (float) $b->total_days + (float) $b->carried_over_days - (float) $b->used_days,
            ])
            ->all();
    }

    /**
     * Year-to-date across every payslip for this employee in the same calendar
     * year up to and including this period. Draft slips are excluded — YTD is a
     * statement of what has been paid, not of what might be.
     */
    private function yearToDate(Payslip $payslip, $periodEnd): array
    {
        $end = $periodEnd instanceof \DateTimeInterface ? $periodEnd : new \DateTime((string) $periodEnd);
        $yearStart = (clone $end)->modify('first day of January')->format('Y-m-d');

        $row = DB::table('payslips as ps')
            ->join('payroll_periods as pp', 'ps.payroll_period_id', '=', 'pp.id')
            ->where('ps.organization_id', $payslip->organization_id)
            ->where('ps.user_id', $payslip->user_id)
            ->whereNull('ps.deleted_at')
            ->whereIn('ps.status', ['approved', 'paid'])
            ->whereBetween('pp.end_date', [$yearStart, $end->format('Y-m-d')])
            ->selectRaw('COALESCE(SUM(ps.gross_salary), 0) as gross')
            ->selectRaw('COALESCE(SUM(ps.total_deductions), 0) as deductions')
            ->selectRaw('COALESCE(SUM(ps.net_salary), 0) as net')
            ->first();

        return [
            'gross' => (float) ($row->gross ?? 0),
            'deductions' => (float) ($row->deductions ?? 0),
            'net' => (float) ($row->net ?? 0),
        ];
    }

    // ── Currency ──────────────────────────────────────────────────────────

    /**
     * A payslip's currency is the ORGANIZATION's currency.
     *
     * It used to be read off whichever salary structure the employee was on,
     * with the org's most common structure currency as a fallback — a
     * heuristic that existed only because there was nowhere to state the
     * answer. There is now: one setting, one currency, and every salary, rate
     * and total in the product denominated in it.
     *
     * The structure's own `currency` column is left in place and no longer
     * consulted for display. It is the seam a future per-record currency would
     * grow from, and reading it now would mean a payslip and the payroll
     * listing beside it could disagree.
     */
    private function resolveCurrency(Payslip $payslip): string
    {
        // Its own stamp wins. A payslip approved before the org switched
        // currency records money that moved in the OLD one, and reprinting it
        // with today's symbol would restate what was paid.
        return $payslip->currency ?: $this->orgCurrency($payslip->organization_id);
    }

    private function orgCurrency(string $orgId): string
    {
        return Money::currencyFor($orgId);
    }
}
