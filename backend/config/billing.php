<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Plan Definitions
    |--------------------------------------------------------------------------
    |
    | Each plan defines its seat limit and rank (used to determine upgrades
    | vs downgrades). A null seat_limit means unlimited seats.
    |
    */

    'plans' => [
        'trial' => [
            'seat_limit' => 5,
            'rank' => 0,
        ],
        'starter' => [
            'seat_limit' => 20,
            'rank' => 1,
        ],
        'pro' => [
            'seat_limit' => null, // unlimited
            'rank' => 2,
        ],
        'enterprise' => [
            'seat_limit' => null, // unlimited
            'rank' => 3,
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Default Invoice Limit
    |--------------------------------------------------------------------------
    |
    | Maximum number of invoices to retrieve from Stripe.
    |
    */

    'invoice_limit' => 24,

];
