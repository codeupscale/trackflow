<?php

namespace App\Exceptions;

use Exception;

class LeaveOverlapException extends Exception
{
    public function __construct(string $message = 'You already have a pending or approved leave request overlapping this date range.')
    {
        parent::__construct($message);
    }
}
