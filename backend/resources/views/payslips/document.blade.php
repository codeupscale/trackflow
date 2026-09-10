{{--
    Payslip document.

    One file renders all three layouts. `classic` is a bordered, letterhead
    document; `modern` puts a filled accent band across the top; `compact`
    strips the chrome for orgs that print in bulk. They differ in CSS and in the
    header block only — every figure below is identical in all three, so a
    company changing its design can never change what a payslip says.

    dompdf notes: no flexbox and no CSS variables, so this is tables and
    inline-blocks on purpose. Keep it that way.
--}}
@php
    $accent = $template->accent_color ?: '#2563EB';
    $layout = $template->layout ?: 'classic';
    $isDraft = ($payslip->status ?? 'draft') === 'draft';
    $money = fn ($n) => $currency . ' ' . number_format((float) $n, 2);
@endphp
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        @page { margin: {{ $layout === 'compact' ? '18px 24px' : '28px 32px' }}; }
        /* A payslip is a printed document and is always light. Declared
           explicitly so a dark-mode browser previewing this same markup does
           not paint dark paper behind black ink. */
        html { color-scheme: light; }
        body {
            font-family: DejaVu Sans, Arial, sans-serif;
            font-size: {{ $layout === 'compact' ? '10px' : '11px' }};
            color: #1f2937;
            background: #ffffff;
            margin: 0;
        }
        .accent { color: {{ $accent }}; }

        /* Header */
        .band { background: {{ $accent }}; color: #fff; padding: 16px 20px; }
        .band .company { font-size: 18px; font-weight: bold; }
        .band .sub { font-size: 10px; opacity: 0.9; margin-top: 3px; }

        .letterhead { border-bottom: 3px solid {{ $accent }}; padding-bottom: 12px; margin-bottom: 16px; }
        .letterhead .company { font-size: 20px; font-weight: bold; color: {{ $accent }}; }
        .letterhead .sub { font-size: 10px; color: #6b7280; margin-top: 3px; line-height: 1.5; }

        .logo { max-height: 54px; max-width: 180px; }

        .doc-title { font-size: 13px; font-weight: bold; letter-spacing: 0.5px; text-transform: uppercase; }
        .period { font-size: 10px; color: #6b7280; }

        /* Blocks */
        .section { margin-top: 16px; }
        .section-title {
            font-size: 10px; font-weight: bold; text-transform: uppercase;
            letter-spacing: 0.6px; color: {{ $accent }};
            border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; margin-bottom: 8px;
        }

        table { width: 100%; border-collapse: collapse; }
        .kv td { padding: 3px 0; font-size: 10px; vertical-align: top; }
        .kv .label { color: #6b7280; width: 14%; }
        .kv .value { font-weight: bold; width: 36%; }

        .lines th {
            text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.4px;
            color: #6b7280; border-bottom: 1px solid #e5e7eb; padding: 5px 6px;
        }
        .lines td { padding: 5px 6px; border-bottom: 1px solid #f3f4f6; }
        .lines .right { text-align: right; }
        .lines .total td { font-weight: bold; border-top: 1px solid #d1d5db; border-bottom: none; }

        .net {
            margin-top: 14px; padding: 12px 16px;
            background: #f9fafb; border-left: 4px solid {{ $accent }};
        }
        .net .label { font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }
        .net .amount { font-size: 20px; font-weight: bold; color: {{ $accent }}; }

        .draft {
            display: inline-block; margin-left: 8px; padding: 2px 8px;
            border: 1px solid #b45309; color: #b45309;
            font-size: 9px; font-weight: bold; letter-spacing: 1px; text-transform: uppercase;
        }
        .sample-note { margin-top: 10px; font-size: 9px; color: #b45309; }

        .sign { margin-top: 34px; }
        .sign td { width: 50%; font-size: 9px; color: #6b7280; padding-top: 26px; }
        .sign .line { border-top: 1px solid #9ca3af; padding-top: 4px; width: 70%; }

        .footer {
            margin-top: 22px; padding-top: 8px; border-top: 1px solid #e5e7eb;
            font-size: 8.5px; color: #9ca3af; line-height: 1.5;
        }
    </style>
</head>
<body>

{{-- ── Header ───────────────────────────────────────────────────────── --}}
@if ($layout === 'modern')
    <div class="band">
        <table>
            <tr>
                <td>
                    <div class="company">{{ $company_name }}</div>
                    @if ($template->company_address)
                        <div class="sub">{{ $template->company_address }}</div>
                    @endif
                    @if ($template->company_registration_no)
                        <div class="sub">Reg. No: {{ $template->company_registration_no }}</div>
                    @endif
                </td>
                @if ($template->logo_data_uri)
                    <td style="text-align: right; width: 190px;">
                        <img src="{{ $template->logo_data_uri }}" class="logo" alt="">
                    </td>
                @endif
            </tr>
        </table>
    </div>
    <div style="margin-top: 14px;">
        <span class="doc-title">Payslip</span>
        @if ($isDraft)<span class="draft">Draft</span>@endif
        <div class="period">{{ $period->name ?? '' }} &middot;
            {{ \Illuminate\Support\Carbon::parse($period->start_date)->format('d M Y') }}
            &ndash;
            {{ \Illuminate\Support\Carbon::parse($period->end_date)->format('d M Y') }}
        </div>
    </div>
@else
    <div class="letterhead">
        <table>
            <tr>
                @if ($template->logo_data_uri)
                    <td style="width: 190px;"><img src="{{ $template->logo_data_uri }}" class="logo" alt=""></td>
                @endif
                <td>
                    <div class="company">{{ $company_name }}</div>
                    @if ($template->company_address)
                        <div class="sub">{{ $template->company_address }}</div>
                    @endif
                    @if ($template->company_registration_no)
                        <div class="sub">Reg. No: {{ $template->company_registration_no }}</div>
                    @endif
                </td>
                <td style="text-align: right; vertical-align: bottom;">
                    <div class="doc-title accent">Payslip</div>
                    @if ($isDraft)<span class="draft">Draft</span>@endif
                    <div class="period">{{ $period->name ?? '' }}</div>
                    <div class="period">
                        {{ \Illuminate\Support\Carbon::parse($period->start_date)->format('d M Y') }}
                        &ndash;
                        {{ \Illuminate\Support\Carbon::parse($period->end_date)->format('d M Y') }}
                    </div>
                </td>
            </tr>
        </table>
    </div>
@endif

{{-- ── Employee ─────────────────────────────────────────────────────── --}}
<div class="section">
    <div class="section-title">Employee</div>
    <table class="kv">
        <tr>
            <td class="label">Name</td><td class="value">{{ $employee->name }}</td>
            <td class="label">Email</td><td class="value">{{ $employee->email }}</td>
        </tr>
    </table>
</div>

{{-- ── Earnings & deductions ────────────────────────────────────────── --}}
<div class="section">
    <div class="section-title">Earnings</div>
    <table class="lines">
        <thead><tr><th>Description</th><th class="right">Amount</th></tr></thead>
        <tbody>
        @forelse ($earnings as $item)
            <tr><td>{{ $item->label }}</td><td class="right">{{ $money($item->amount) }}</td></tr>
        @empty
            <tr><td colspan="2" style="color:#9ca3af;">No earnings recorded.</td></tr>
        @endforelse
            <tr class="total">
                <td>Gross Pay</td>
                <td class="right">{{ $money($payslip->gross_salary) }}</td>
            </tr>
        </tbody>
    </table>
</div>

<div class="section">
    <div class="section-title">Deductions</div>
    <table class="lines">
        <thead><tr><th>Description</th><th class="right">Amount</th></tr></thead>
        <tbody>
        @forelse ($deductions as $item)
            <tr><td>{{ $item->label }}</td><td class="right">{{ $money($item->amount) }}</td></tr>
        @empty
            <tr><td colspan="2" style="color:#9ca3af;">No deductions.</td></tr>
        @endforelse
            <tr class="total">
                <td>Total Deductions</td>
                <td class="right">{{ $money($payslip->total_deductions) }}</td>
            </tr>
        </tbody>
    </table>
</div>

{{-- ── Net pay ──────────────────────────────────────────────────────── --}}
<div class="net">
    <table>
        <tr>
            <td>
                <div class="label">Net Pay</div>
                <div class="amount">{{ $money($payslip->net_salary) }}</div>
            </td>
            <td style="text-align: right; font-size: 10px; color: #6b7280;">
                Gross {{ $money($payslip->gross_salary) }}<br>
                less deductions {{ $money($payslip->total_deductions) }}
            </td>
        </tr>
    </table>
</div>

{{-- ── Optional sections ────────────────────────────────────────────── --}}
@if ($template->show_employer_contributions && $employer_items->isNotEmpty())
    <div class="section">
        <div class="section-title">Employer Contributions</div>
        <table class="lines">
            <tbody>
            @foreach ($employer_items as $item)
                <tr><td>{{ $item->label }}</td><td class="right">{{ $money($item->amount) }}</td></tr>
            @endforeach
                <tr class="total">
                    <td>Total Employer Cost</td>
                    <td class="right">{{ $money((float) $payslip->net_salary + $employer_total) }}</td>
                </tr>
            </tbody>
        </table>
    </div>
@endif

@if ($template->show_attendance_summary && $attendance)
    <div class="section">
        <div class="section-title">Attendance This Period</div>
        <table class="lines">
            <thead>
                <tr>
                    <th>Working Days</th><th>Present</th><th>Absent</th><th>On Leave</th><th>Late</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>{{ $attendance['working_days'] }}</td>
                    <td>{{ $attendance['present_days'] }}</td>
                    <td>{{ $attendance['absent_days'] }}</td>
                    <td>{{ $attendance['leave_days'] }}</td>
                    <td>{{ $attendance['late_days'] }}</td>
                </tr>
            </tbody>
        </table>
    </div>
@endif

@if ($template->show_leave_balance && !empty($leave_balances))
    <div class="section">
        <div class="section-title">Leave Balance</div>
        <table class="lines">
            <thead><tr><th>Type</th><th class="right">Remaining</th><th class="right">Entitlement</th></tr></thead>
            <tbody>
            @foreach ($leave_balances as $balance)
                <tr>
                    <td>{{ $balance['name'] }}</td>
                    <td class="right">{{ number_format($balance['remaining'], 1) }} days</td>
                    <td class="right">{{ number_format($balance['total'], 1) }} days</td>
                </tr>
            @endforeach
            </tbody>
        </table>
    </div>
@endif

@if ($template->show_ytd_totals && $ytd)
    <div class="section">
        <div class="section-title">Year to Date</div>
        <table class="lines">
            <thead><tr><th>Gross</th><th>Deductions</th><th>Net</th></tr></thead>
            <tbody>
                <tr>
                    <td>{{ $money($ytd['gross']) }}</td>
                    <td>{{ $money($ytd['deductions']) }}</td>
                    <td>{{ $money($ytd['net']) }}</td>
                </tr>
            </tbody>
        </table>
    </div>
@endif

@if ($template->show_payment_details)
    <div class="section">
        <div class="section-title">Payment</div>
        <table class="kv">
            <tr>
                <td class="label">Status</td>
                <td class="value">{{ ucfirst($payslip->status ?? 'draft') }}</td>
                <td class="label">Payment Date</td>
                <td class="value">
                    {{ $payslip->payment_date
                        ? \Illuminate\Support\Carbon::parse($payslip->payment_date)->format('d M Y')
                        : '—' }}
                </td>
            </tr>
            <tr>
                <td class="label">Method</td>
                <td class="value">{{ $payslip->payment_method ?: '—' }}</td>
                <td class="label">Reference</td>
                <td class="value">{{ $payslip->notes ?: '—' }}</td>
            </tr>
        </table>
    </div>
@endif

@if ($template->show_signature_block)
    <table class="sign">
        <tr>
            <td><div class="line">Employee Signature</div></td>
            <td><div class="line">Authorised Signatory</div></td>
        </tr>
    </table>
@endif

<div class="footer">
    @if ($template->footer_note)
        {{ $template->footer_note }}<br>
    @endif
    This is a computer-generated payslip and does not require a signature.
    Generated {{ $generated_at->format('d M Y, H:i') }}.
    @if (!empty($is_sample))
        <div class="sample-note">Preview only — figures shown are sample data, not a real payslip.</div>
    @endif
</div>

</body>
</html>
