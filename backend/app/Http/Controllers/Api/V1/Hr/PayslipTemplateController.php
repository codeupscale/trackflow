<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
use App\Http\Requests\Hr\UpdatePayslipTemplateRequest;
use App\Services\PayslipTemplateService;
use App\Support\PayslipTemplateRenderer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class PayslipTemplateController extends Controller
{
    public function __construct(
        private readonly PayslipTemplateService $templates,
    ) {}

    public function show(Request $request): JsonResponse
    {
        $template = $this->templates->forOrganization($request->user()->organization_id);

        return response()->json(['data' => $template]);
    }

    public function update(UpdatePayslipTemplateRequest $request): JsonResponse
    {
        $data = $request->validated();

        // An uploaded design is proved to render BEFORE it is stored. A
        // template that only fails at download time would break payslips for
        // the whole company, and the person who would discover it is an
        // employee opening their pay — not the admin who uploaded it.
        if (array_key_exists('custom_template_html', $data) && filled($data['custom_template_html'])) {
            $problems = $this->dryRun($request, $data['custom_template_html']);

            if ($problems !== []) {
                return response()->json([
                    'message' => 'That payslip design could not be used.',
                    'errors' => ['custom_template_html' => $problems],
                ], 422);
            }

            $data['custom_template_uploaded_at'] = now();
        }

        $template = $this->templates->update($request->user()->organization_id, $data);

        return response()->json(['data' => $template]);
    }

    /**
     * Render a design against sample figures so an org can see its payslip
     * before payroll has ever run. Inline, not a download — this is a preview
     * pane, not a document anyone files.
     *
     * A POST body carrying edited fields is rendered WITHOUT being saved, so
     * the settings screen previews what the user is currently typing. That is
     * the point of the endpoint: a preview that only ever showed the stored row
     * would force someone to save a design to find out whether it works.
     */
    public function preview(UpdatePayslipTemplateRequest $request): Response
    {
        $user = $request->user();

        $data = $this->templates->sampleRenderData(
            $user->organization_id,
            $user->organization?->name ?? 'Company',
            $request->validated(),
        );

        return $this->templates->renderPdf($data)->stream('payslip-preview.pdf');
    }

    /**
     * Every placeholder an uploaded design may use, with its sample value.
     * Generated from a real sample render, so the reference cannot drift from
     * what the engine actually resolves.
     */
    public function placeholders(Request $request): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'data' => $this->templates->placeholderReference(
                $user->organization_id,
                $user->organization?->name ?? 'Company',
            ),
        ]);
    }

    /**
     * The draggable field palette for the image layout, grouped, each with a
     * sample value so the placer can show what will actually print.
     */
    public function fields(Request $request): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'data' => $this->templates->imageFieldCatalogue(
                $user->organization_id,
                $user->organization?->name ?? 'Company',
            ),
        ]);
    }

    /**
     * Static checks, then an actual render against sample data. Returns the
     * problems to show the uploader, or an empty list when the design is good.
     */
    private function dryRun(Request $request, string $html): array
    {
        $problems = PayslipTemplateRenderer::validate($html);

        if ($problems !== []) {
            return $problems;
        }

        $user = $request->user();

        try {
            $sample = $this->templates->sampleRenderData(
                $user->organization_id,
                $user->organization?->name ?? 'Company',
            );

            PayslipTemplateRenderer::render($html, $this->templates->customContext($sample));
        } catch (\Throwable $e) {
            return ['This design could not be rendered: ' . $e->getMessage()];
        }

        return [];
    }
}
