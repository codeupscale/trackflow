<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
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

    public function store(Request $request): JsonResponse
    {
        $this->authorize('create', PublicHoliday::class);

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'date' => 'required|date',
            'is_recurring' => 'sometimes|boolean',
        ]);

        $holiday = PublicHoliday::create([
            'organization_id' => $request->user()->organization_id,
            ...$validated,
        ]);

        return response()->json(['public_holiday' => $holiday], 201);
    }
}
