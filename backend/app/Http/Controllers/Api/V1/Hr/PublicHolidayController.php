<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
use App\Http\Requests\Hr\StorePublicHolidayRequest;
use App\Models\PublicHoliday;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PublicHolidayController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = PublicHoliday::where('organization_id', $request->user()->organization_id);

        if ($request->filled('year')) {
            $year = (int) $request->input('year');
            $query->whereYear('date', $year);
        }

        $holidays = $query->orderBy('date')->paginate(25);

        return response()->json($holidays);
    }

    public function store(StorePublicHolidayRequest $request): JsonResponse
    {
        $holiday = PublicHoliday::create([
            'organization_id' => $request->user()->organization_id,
            ...$request->validated(),
        ]);

        return response()->json(['public_holiday' => $holiday], 201);
    }
}
