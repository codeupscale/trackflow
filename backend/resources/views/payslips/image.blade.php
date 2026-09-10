{{--
    Image layout: the company's own payslip artwork, with payroll values
    printed onto it at saved positions.

    Positions are PERCENTAGES of the page, so the same placement holds whatever
    resolution the uploaded image is. The artwork is an absolutely positioned
    <img> rather than a CSS background because dompdf sizes a real element
    predictably, while background-size support is patchy.

    Nothing here is a form the user can break: an unplaced field simply is not
    printed, and a field whose value is empty prints nothing.
--}}
@php
    $positions = collect($template->field_positions ?? [])
        ->filter(fn ($f) => is_array($f) && isset($f['key']));
@endphp
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        @page { margin: 0; }
        html { color-scheme: light; }
        body {
            margin: 0;
            padding: 0;
            background: #ffffff;
            font-family: DejaVu Sans, Arial, sans-serif;
            color: #1f2937;
        }
        /* A4 in absolute units, not 100%. Every field is positioned with a
           PERCENTAGE top/left, and a percentage resolves against the
           containing block's height — which is zero for a `height: auto` box
           whose children are all absolutely positioned. Without a real height
           here every value stacks on the first line. */
        .sheet { position: relative; width: 210mm; height: 297mm; overflow: hidden; }
        .artwork { position: absolute; top: 0; left: 0; width: 210mm; height: 297mm; }
        .field { position: absolute; white-space: nowrap; line-height: 1.1; }
        .stamp {
            position: absolute; top: 2%; right: 3%;
            font-size: 9px; font-weight: bold; letter-spacing: 1px;
            padding: 2px 8px;
        }
        /* Amber while the figures can still change, green once a person has
           checked them. The stamp answers "can I rely on this?", and a payslip
           an employee has been sent is one somebody signed their name to. */
        .stamp-draft    { border: 1px solid #b45309; color: #b45309; }
        .stamp-verified { border: 1px solid #047857; color: #047857; }
    </style>
</head>
<body>
<div class="sheet">
    @if ($template->background_image_data_uri)
        <img src="{{ $template->background_image_data_uri }}" class="artwork" alt="">
    @endif

    @foreach ($positions as $field)
        @php
            // A 'custom' field prints the org's own text rather than a payroll
            // value — a label, a note, or a caption for a box the product has
            // no data for. Escaped on output like everything else, so it is
            // text and never markup.
            $value = ($field['key'] ?? '') === 'custom'
                ? (string) ($field['text'] ?? '')
                : ($field_values[$field['key']] ?? '');
            // Resolved ONCE. Writing `$field['align'] ?? 'left'` in the test
            // and `$field['align']` in the result reads as equivalent and is
            // not: a field saved without an align key passes the test on the
            // default and then crashes the whole payslip on the lookup. Every
            // property below is optional, so each takes its default the same
            // way.
            $align = $field['align'] ?? 'left';
            if (! in_array($align, ['left', 'right', 'center'], true)) {
                $align = 'left';
            }
            $x = (float) ($field['x'] ?? 0);
            // Anchored by its own edge so a right-aligned amount stays pinned to
            // the right of its column as the number gets longer.
            //
            // Centre is the case that needs a box. The others shrink-wrap, and
            // `text-align` on a box that is exactly as wide as its own text has
            // nothing to move — a centred field printed from its left edge like
            // an unaligned one, so it sat half its own width to the right of the
            // spot it was placed on. Spanning [0, 2x] puts the box's MIDDLE at
            // x, which is what centring on a point means. Past the halfway mark
            // the mirror image is used, or the box would run off the page.
            $box = null;
            if ($align === 'center') {
                $edge = $x <= 50 ? 'left' : 'right';
                $offset = 0;
                $box = $x <= 50 ? $x * 2 : (100 - $x) * 2;
            } else {
                $edge = $align === 'right' ? 'right' : 'left';
                $offset = $align === 'right' ? 100 - $x : $x;
            }
        @endphp
        @if ($value !== '')
            {{-- The saved point is the text's VERTICAL CENTRE, not its top
                 edge. Someone placing a value inside a table row clicks the
                 middle of that row; anchoring the top there hangs the text
                 below the line and every row looks a little low. The negative
                 margin is ~half a line, and the placer applies the same offset
                 so what is dragged is what prints. --}}
            <div class="field" style="
                top: {{ (float) ($field['y'] ?? 0) }}%;
                margin-top: -{{ round(((float) ($field['size'] ?? 10)) * 0.62, 1) }}px;
                {{ $edge }}: {{ $offset }}%;
                @if ($box !== null) width: {{ round($box, 3) }}%; @endif
                font-size: {{ (float) ($field['size'] ?? 10) }}px;
                font-weight: {{ ! empty($field['bold']) ? 'bold' : 'normal' }};
                color: {{ preg_match('/^#[0-9A-Fa-f]{6}$/', (string) ($field['color'] ?? '')) ? $field['color'] : '#1f2937' }};
                text-align: {{ $align }};
            ">{{ $value }}</div>
        @endif
    @endforeach

@php
        // The run's status is not the whole story. A payslip sits in 'draft'
        // for as long as the PERIOD is unapproved, so a slip that has been
        // verified and sent to the employee still carried a DRAFT stamp — the
        // one document where that word does real damage, since the employee is
        // told to rely on it.
        $isVerified = $payslip->verified_at !== null && ($payslip->withdrawn_at ?? null) === null;
        $stamp = match (true) {
            ($payslip->status ?? 'draft') === 'paid' => ['PAID', 'stamp-verified'],
            ($payslip->status ?? 'draft') === 'approved' => ['APPROVED', 'stamp-verified'],
            $isVerified => ['VERIFIED', 'stamp-verified'],
            default => ['DRAFT', 'stamp-draft'],
        };
    @endphp
    <div class="stamp {{ $stamp[1] }}">{{ $stamp[0] }}</div>
</div>
</body>
</html>
