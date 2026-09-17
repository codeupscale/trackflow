<?php

namespace App\Support;

/**
 * The fixed set of reasons someone may give for leaving before their hours are done.
 *
 * A category alongside the free-text note is what makes early departures
 * REPORTABLE: "eleven medical early-outs this month" is a number HR can act on,
 * where eleven sentences are not. The note carries the detail the category cannot.
 *
 * Shared by the validation rule, the API payload and the CSV export so the list
 * is stated exactly once — the labels the employee picks from are the labels HR
 * reads back.
 */
final class EarlyCheckoutReasons
{
    /** Category key => the label shown to the employee and in reports. */
    public const CATEGORIES = [
        'medical' => 'Medical appointment or unwell',
        'family_emergency' => 'Family emergency',
        'personal_work' => 'Personal work',
        'travel' => 'Travel or commute',
        'official_work' => 'Official work outside the office',
        'other' => 'Other',
    ];

    /** The shortest note that still says anything — "ok" must not clear the flag. */
    public const MIN_NOTE_LENGTH = 10;

    public const MAX_NOTE_LENGTH = 500;

    /** @return list<string> */
    public static function keys(): array
    {
        return array_keys(self::CATEGORIES);
    }

    public static function label(?string $key): ?string
    {
        return $key === null ? null : (self::CATEGORIES[$key] ?? $key);
    }

    /** The picker payload the checkout dialog renders. */
    public static function options(): array
    {
        return array_map(
            fn (string $key, string $label) => ['value' => $key, 'label' => $label],
            array_keys(self::CATEGORIES),
            array_values(self::CATEGORIES),
        );
    }
}
