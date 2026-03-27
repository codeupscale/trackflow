<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\BillingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BillingController extends Controller
{
    public function __construct(
        private readonly BillingService $billing
    ) {}

    // BILL-01: Subscribe (upgrade from trial)
    public function subscribe(Request $request): JsonResponse
    {
        $request->validate([
            'plan' => 'required|in:starter,pro',
            'interval' => 'required|in:monthly,annual',
            'payment_method_id' => 'required|string',
        ]);

        $user = $request->user();

        if (!$user->hasRole('owner', 'admin')) {
            return response()->json(['message' => 'Only owners/admins can manage billing.'], 403);
        }

        $result = $this->billing->subscribe(
            $user->organization,
            $request->plan,
            $request->interval,
            $request->payment_method_id,
            $user->email,
        );

        return response()->json($result);
    }

    // BILL-02: Change plan
    public function changePlan(Request $request): JsonResponse
    {
        $request->validate([
            'plan' => 'required|in:starter,pro',
            'interval' => 'required|in:monthly,annual',
        ]);

        $user = $request->user();

        if (!$user->hasRole('owner', 'admin')) {
            return response()->json(['message' => 'Only owners/admins can manage billing.'], 403);
        }

        try {
            $result = $this->billing->changePlan(
                $user->organization,
                $request->plan,
                $request->interval,
            );
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 400);
        }

        return response()->json($result);
    }

    // BILL-03: Cancel subscription
    public function cancel(Request $request): JsonResponse
    {
        $user = $request->user();

        if (!$user->hasRole('owner', 'admin')) {
            return response()->json(['message' => 'Only owners/admins can manage billing.'], 403);
        }

        try {
            $result = $this->billing->cancelSubscription($user->organization);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 400);
        }

        return response()->json($result);
    }

    // BILL-04: List invoices
    public function invoices(Request $request): JsonResponse
    {
        $org = $request->user()->organization;
        $invoices = $this->billing->getInvoices($org);

        return response()->json(['invoices' => $invoices]);
    }

    // BILL-05: Usage / seat count
    public function usage(Request $request): JsonResponse
    {
        $org = $request->user()->organization;
        $usage = $this->billing->getUsage($org);

        return response()->json($usage);
    }
}
