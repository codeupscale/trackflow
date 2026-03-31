<?php

namespace App\Exceptions;

use Exception;

class InsufficientLeaveBalanceException extends Exception
{
    public function __construct(string $message = 'Insufficient leave balance for this request.')
    {
        parent::__construct($message);
    }
}
