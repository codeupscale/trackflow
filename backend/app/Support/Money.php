<?php

namespace App\Support;

use App\Models\Organization;

/**
 * The organization's currency, and how to render an amount in it.
 *
 * One currency per organization. Every salary, rate, payslip and report total
 * is denominated in it and nothing is converted — so this class resolves a
 * code and formats a number, and deliberately has no notion of an exchange
 * rate. Introducing one would mean every SUM in reporting and payroll needs a
 * currency dimension and an as-of date, which is a different feature.
 *
 * Before this, the product had three hardcoded currencies at once — 'AUD' in
 * the schema and frontend defaults, 'USD' as the payslip fallback, 'PKR' on
 * job postings — plus a bare '$' printed over all of them in reports.
 */
final class Money
{
    /** Resolved per request; an org's currency cannot change mid-response. */
    private static array $cache = [];

    /**
     * The org's currency code, or the configured default when it is unset or
     * no longer one this build supports.
     */
    public static function currencyFor(?string $organizationId): string
    {
        if ($organizationId === null) {
            return self::fallback();
        }

        if (! array_key_exists($organizationId, self::$cache)) {
            $currency = Organization::withoutGlobalScopes()
                ->find($organizationId)
                ?->getSetting('currency');

            self::$cache[$organizationId] = self::normalize($currency);
        }

        return self::$cache[$organizationId];
    }

    /** What to print in front of an amount — the symbol, else the code itself. */
    public static function symbol(string $code): string
    {
        return config("money.currencies.{$code}.symbol", $code);
    }

    /**
     * An amount as text: "Rs 1,234.56", "¥1,235".
     *
     * The decimal count comes from the currency, not from a caller's
     * preference — rendering ¥1,200 as ¥1,200.00 is wrong rather than merely
     * verbose, because the yen has no minor unit.
     */
    public static function format(float|int|string $amount, string $code): string
    {
        $decimals = (int) config("money.currencies.{$code}.decimals", 2);

        return self::symbol($code) . ' ' . number_format((float) $amount, $decimals);
    }

    /** Format in the org's own currency. */
    public static function formatForOrg(float|int|string $amount, ?string $organizationId): string
    {
        return self::format($amount, self::currencyFor($organizationId));
    }

    /** Forget cached lookups. For tests, which change settings mid-run. */
    public static function flush(): void
    {
        self::$cache = [];
    }

    private static function normalize(mixed $currency): string
    {
        return is_string($currency) && isset(config('money.currencies')[$currency])
            ? $currency
            : self::fallback();
    }

    private static function fallback(): string
    {
        return (string) config('money.default', 'PKR');
    }
}
