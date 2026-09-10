<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
use App\Http\Requests\Hr\UpdatePayslipLinesRequest;
use App\Services\PayrollService;
use App\Services\PayslipTemplateService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;

class PayslipController extends Controller
{
    public function __construct(
        private readonly PayrollService $payrollService,
        private readonly PayslipTemplateService $templates,
    ) {}

    public function index(Request $request): JsonResponse
    {
        // Normalised here rather than trusting the raw query string: "0" and
        // "false" both have to mean "active only".
        $filters = $request->all() + ['archived' => $request->boolean('archived')];

        $payslips = $this->payrollService->getPayslips($filters, $request->user());

        // Totals ride alongside the page rather than needing a second call, and
        // they cover the whole filtered set — the point of asking for a year is
        // the year's figure, not this page's.
        return response()->json($payslips->toArray() + [
            'totals' => $this->payrollService->getPayslipTotals($filters, $request->user()),
            'years' => $this->payrollService->payslipYears($request->user()),
        ]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $payslip = $this->payrollService->getPayslipDetail($id, $request->user());

        return response()->json(['data' => $payslip]);
    }

    /**
     * Replace a payslip's earnings and deductions.
     *
     * Resolved through the same authorization as the detail view first, so a
     * payslip can never be edited by someone who could not open it.
     */
    public function updateLines(UpdatePayslipLinesRequest $request, string $id): JsonResponse
    {
        $this->payrollService->getPayslipDetail($id, $request->user());

        return response()->json([
            'message' => 'Payslip updated.',
            'data' => $this->payrollService->updatePayslipLines(
                $id,
                $request->validated()['lines'],
                $request->user(),
            ),
        ]);
    }

    /**
     * Verify one payslip, releasing it to the employee's My Payslips.
     */
    public function verify(Request $request, string $id): JsonResponse
    {
        // Resolved through the same authorization as the detail view, so a
        // verifier can only ever act on a payslip they are allowed to read.
        $this->payrollService->getPayslipDetail($id, $request->user());

        return response()->json([
            'data' => $this->payrollService->verifyPayslip($id, $request->user()),
        ]);
    }

    public function unverify(Request $request, string $id): JsonResponse
    {
        $this->payrollService->getPayslipDetail($id, $request->user());

        return response()->json([
            'data' => $this->payrollService->unverifyPayslip($id, $request->user()),
        ]);
    }

    /**
     * The employee's own payslip as a PDF, rendered with the organization's
     * design.
     *
     * Authorization is the SAME call the JSON detail endpoint makes —
     * `getPayslipDetail()` 403s for anyone outside own/team/all scope — so a
     * document can never be reachable by a route the JSON is not.
     *
     * A draft slip IS downloadable, but the layout stamps it DRAFT. Blocking it
     * would be worse: HR's whole reason to open a payslip before approval is to
     * check it, and a PDF of an unapproved figure that looks identical to a
     * final one is the actual danger — the watermark, not a 422, is what
     * addresses it.
     */
    public function download(Request $request, string $id): Response
    {
        $payslip = $this->payrollService->getPayslipDetail($id, $request->user());

        $template = $this->templates->forOrganization($payslip->organization_id);

        // Rendering is expensive — dompdf decodes the company's background
        // image every time — and the answer only changes when the payslip, the
        // design, or the RENDERER changes. All three are in the key.
        //
        // The renderer version is not decoration. With only the two timestamps,
        // a document rendered by buggy code stayed served for a day after the
        // bug was fixed: the data had not changed, so the key had not changed,
        // and there was no way to tell the cache that the ANSWER had. That
        // shipped twice — a payslip missing its pay period, and deduction rows
        // showing a stale name — each time looking like the fix had not worked.
        $pdf = Cache::remember(
            sprintf(
                'payslip-pdf:v%s:%s:%s:%s',
                PayslipTemplateService::RENDERER_VERSION,
                $payslip->id,
                optional($payslip->updated_at)->timestamp ?? 0,
                optional($template->updated_at)->timestamp ?? 0,
            ),
            now()->addDay(),
            fn () => $this->templates->renderPdf(
                $this->templates->renderData($payslip, $template),
            )->output(),
        );

        return response($pdf, 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'attachment; filename="' . $this->templates->filenameFor($payslip) . '"',
        ]);
    }
}
