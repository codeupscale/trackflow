<?php

namespace App\Http\Requests\Hr;

use App\Models\PayslipTemplate;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdatePayslipTemplateRequest extends FormRequest
{
    /**
     * A base64 payload is ~4/3 the size of the bytes it encodes, so this caps
     * the actual image near 375KB. dompdf holds the whole document in memory
     * and every payslip in a run embeds this logo — an unbounded upload here
     * is an out-of-memory on the biggest run, not a slow page.
     */
    private const MAX_LOGO_CHARS = 500_000;

    /** ~3MB of actual image once base64 overhead is removed. */
    private const MAX_BACKGROUND_CHARS = 4_000_000;

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'layout' => ['sometimes', 'string', Rule::in(PayslipTemplate::LAYOUTS)],
            // Hex only. The value is interpolated into the PDF's stylesheet, so
            // anything looser is a CSS injection into a document the whole
            // company receives.
            'accent_color' => ['sometimes', 'string', 'regex:/^#[0-9A-Fa-f]{6}$/'],

            'company_name' => ['sometimes', 'nullable', 'string', 'max:255'],
            'company_address' => ['sometimes', 'nullable', 'string', 'max:500'],
            'company_registration_no' => ['sometimes', 'nullable', 'string', 'max:100'],
            'footer_note' => ['sometimes', 'nullable', 'string', 'max:500'],

            'logo_data_uri' => [
                'sometimes', 'nullable', 'string',
                'max:' . self::MAX_LOGO_CHARS,
                // PNG, JPEG and GIF only: dompdf rasterises these natively.
                // SVG is deliberately excluded — it is XML that can carry
                // scripts and external references into the renderer.
                'regex:/^data:image\/(png|jpeg|jpg|gif);base64,[A-Za-z0-9+\/=]+$/',
            ],

            'show_payment_details' => ['sometimes', 'boolean'],
            'show_employer_contributions' => ['sometimes', 'boolean'],
            'show_attendance_summary' => ['sometimes', 'boolean'],
            'show_leave_balance' => ['sometimes', 'boolean'],
            'show_ytd_totals' => ['sometimes', 'boolean'],
            'show_signature_block' => ['sometimes', 'boolean'],

            // A company-uploaded design. Content is checked and test-rendered
            // by the controller before it is stored; this only bounds the size.
            // dompdf holds the whole document in memory per payslip, so an
            // unbounded upload is an out-of-memory on the largest run.
            'custom_template_html' => ['sometimes', 'nullable', 'string', 'max:200000'],
            'custom_template_name' => ['sometimes', 'nullable', 'string', 'max:255'],

            // The company's own payslip artwork. Larger than the logo cap
            // because this is a full page, but still bounded: dompdf holds the
            // decoded image in memory for every payslip in a run.
            'background_image_data_uri' => [
                'sometimes', 'nullable', 'string',
                'max:' . self::MAX_BACKGROUND_CHARS,
                'regex:/^data:image\/(png|jpeg|jpg);base64,[A-Za-z0-9+\/=]+$/',
            ],
            'background_image_name' => ['sometimes', 'nullable', 'string', 'max:255'],

            // Where each value prints. x/y are percentages of the page, so a
            // placement survives the artwork being re-exported at another size.
            'field_positions' => ['sometimes', 'nullable', 'array', 'max:120'],
            'field_positions.*.key' => ['required', 'string', 'max:120', 'regex:/^[a-z0-9_.\-]+$/i'],
            // Only meaningful when key is 'custom': the org's own text for a
            // box the product has no field for.
            'field_positions.*.text' => ['sometimes', 'nullable', 'string', 'max:200'],
            'field_positions.*.x' => ['required', 'numeric', 'between:0,100'],
            'field_positions.*.y' => ['required', 'numeric', 'between:0,100'],
            'field_positions.*.size' => ['sometimes', 'numeric', 'between:5,48'],
            'field_positions.*.align' => ['sometimes', 'string', 'in:left,center,right'],
            'field_positions.*.bold' => ['sometimes', 'boolean'],
            'field_positions.*.color' => ['sometimes', 'nullable', 'string', 'regex:/^#[0-9A-Fa-f]{6}$/'],
        ];
    }

    public function messages(): array
    {
        return [
            'accent_color.regex' => 'Pick a colour in hex form, for example #2563EB.',
            'logo_data_uri.regex' => 'The logo must be a PNG, JPEG or GIF image.',
            'logo_data_uri.max' => 'That logo is too large. Please use an image under 350KB.',
            'background_image_data_uri.regex' => 'The payslip design must be a JPEG or PNG image.',
            'background_image_data_uri.max' => 'That design is too large. Please use an image under 3MB.',
        ];
    }
}
