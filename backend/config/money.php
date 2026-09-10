<?php

/**
 * The currencies an organization may be set to.
 *
 * An allowlist rather than free text. `salary_structures.currency` was a bare
 * `string, 3` with no validation beyond its length, so "XyZ" was as acceptable
 * as "PKR" — and an unknown code has no symbol, no locale and no decimal rule,
 * which means it cannot be formatted, only echoed.
 *
 * `decimals` is not always 2. Rendering ¥1,200 as ¥1,200.00 is wrong, not
 * merely fussy, and the minor unit is a property of the currency rather than a
 * display preference.
 *
 * KEEP IN SYNC with `web/src/lib/money.ts`. The list is duplicated rather than
 * fetched because the frontend formats money on almost every screen, and an
 * async lookup for a symbol would put a loading state in front of a number.
 */
return [

    'default' => 'PKR',

    'currencies' => [
        'PKR' => ['symbol' => 'Rs',  'name' => 'Pakistani Rupee',      'locale' => 'en-PK', 'decimals' => 2],
        'USD' => ['symbol' => '$',   'name' => 'US Dollar',            'locale' => 'en-US', 'decimals' => 2],
        'EUR' => ['symbol' => '€',   'name' => 'Euro',                 'locale' => 'de-DE', 'decimals' => 2],
        'GBP' => ['symbol' => '£',   'name' => 'British Pound',        'locale' => 'en-GB', 'decimals' => 2],
        'AUD' => ['symbol' => 'A$',  'name' => 'Australian Dollar',    'locale' => 'en-AU', 'decimals' => 2],
        'CAD' => ['symbol' => 'C$',  'name' => 'Canadian Dollar',      'locale' => 'en-CA', 'decimals' => 2],
        'AED' => ['symbol' => 'AED', 'name' => 'UAE Dirham',           'locale' => 'en-AE', 'decimals' => 2],
        'SAR' => ['symbol' => 'SAR', 'name' => 'Saudi Riyal',          'locale' => 'en-SA', 'decimals' => 2],
        'INR' => ['symbol' => '₹',   'name' => 'Indian Rupee',         'locale' => 'en-IN', 'decimals' => 2],
        'BDT' => ['symbol' => '৳',   'name' => 'Bangladeshi Taka',     'locale' => 'en-BD', 'decimals' => 2],
        'LKR' => ['symbol' => 'Rs',  'name' => 'Sri Lankan Rupee',     'locale' => 'en-LK', 'decimals' => 2],
        'SGD' => ['symbol' => 'S$',  'name' => 'Singapore Dollar',     'locale' => 'en-SG', 'decimals' => 2],
        'MYR' => ['symbol' => 'RM',  'name' => 'Malaysian Ringgit',    'locale' => 'en-MY', 'decimals' => 2],
        'NZD' => ['symbol' => 'NZ$', 'name' => 'New Zealand Dollar',   'locale' => 'en-NZ', 'decimals' => 2],
        'ZAR' => ['symbol' => 'R',   'name' => 'South African Rand',   'locale' => 'en-ZA', 'decimals' => 2],
        'CNY' => ['symbol' => '¥',   'name' => 'Chinese Yuan',         'locale' => 'zh-CN', 'decimals' => 2],
        'JPY' => ['symbol' => '¥',   'name' => 'Japanese Yen',         'locale' => 'ja-JP', 'decimals' => 0],
    ],

];
