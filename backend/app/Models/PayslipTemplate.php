<?php

namespace App\Models;

use App\Models\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * Per-organization payslip presentation: letterhead, accent colour, layout and
 * which optional sections appear. Exactly one row per org; it holds no payroll
 * figures, so changing it can never change what anyone was paid.
 */
class PayslipTemplate extends Model
{
    use BelongsToOrganization, HasFactory, HasUuids;

    /**
     * Layouts shipped with the product, plus 'custom' — the org's own uploaded
     * HTML, rendered by the sandboxed placeholder engine.
     */
    public const BUILT_IN_LAYOUTS = ['classic', 'modern', 'compact'];

    /**
     * 'custom' = the org's uploaded HTML. 'image' = the org's own payslip
     * artwork with values printed onto it at saved positions.
     */
    public const LAYOUTS = ['classic', 'modern', 'compact', 'custom', 'image'];

    protected $fillable = [
        'organization_id',
        'layout',
        'accent_color',
        'company_name',
        'company_address',
        'company_registration_no',
        'footer_note',
        'logo_data_uri',
        'show_payment_details',
        'show_employer_contributions',
        'show_attendance_summary',
        'show_leave_balance',
        'show_ytd_totals',
        'show_signature_block',
        'custom_template_html',
        'custom_template_name',
        'custom_template_uploaded_at',
        'background_image_data_uri',
        'background_image_name',
        'field_positions',
    ];

    /** True when this org renders payslips from its own uploaded HTML. */
    public function usesCustomTemplate(): bool
    {
        return $this->layout === 'custom' && filled($this->custom_template_html);
    }

    /** True when this org prints values onto its own payslip artwork. */
    public function usesImageTemplate(): bool
    {
        return $this->layout === 'image' && filled($this->background_image_data_uri);
    }

    protected function casts(): array
    {
        return [
            'custom_template_uploaded_at' => 'datetime',
            'field_positions' => 'array',
            'show_payment_details' => 'boolean',
            'show_employer_contributions' => 'boolean',
            'show_attendance_summary' => 'boolean',
            'show_leave_balance' => 'boolean',
            'show_ytd_totals' => 'boolean',
            'show_signature_block' => 'boolean',
        ];
    }
}
