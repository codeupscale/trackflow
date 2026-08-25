<?php

namespace App\Http\Requests\Hr;

/**
 * Editing a pending request takes the same field rules as creating one —
 * subclassed so the two can never drift apart silently.
 */
class UpdateLeaveRequestRequest extends StoreLeaveRequestRequest
{
}
