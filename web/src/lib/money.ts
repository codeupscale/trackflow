import { useAuthStore } from '@/stores/auth-store';

/**
 * The organization's currency, and how to render an amount in it.
 *
 * One currency per organization: every salary, rate and total is denominated
 * in it and nothing is converted. Per-record currencies would make every sum
 * in payroll and reporting meaningless without dated exchange rates — a
 * different feature from "show our numbers in our own currency".
 *
 * This exists because there was no shared formatter at all. Money was
 * formatted in sixteen separate places, none of which used
 * `Intl.NumberFormat`'s currency style: several hardcoded a `$`, and the
 * payroll module alone shipped two locales — `en-AU` on the structures and
 * period totals, `en-US` on the payslip cells beside them.
 *
 * KEEP IN SYNC with `backend/config/money.php`.
 */

export interface CurrencyMeta {
  symbol: string;
  name: string;
  locale: string;
  /** Not always 2 — rendering ¥1,200 as ¥1,200.00 is wrong, not just verbose. */
  decimals: number;
}

export const CURRENCIES: Record<string, CurrencyMeta> = {
  PKR: { symbol: 'Rs', name: 'Pakistani Rupee', locale: 'en-PK', decimals: 2 },
  USD: { symbol: '$', name: 'US Dollar', locale: 'en-US', decimals: 2 },
  EUR: { symbol: '€', name: 'Euro', locale: 'de-DE', decimals: 2 },
  GBP: { symbol: '£', name: 'British Pound', locale: 'en-GB', decimals: 2 },
  AUD: { symbol: 'A$', name: 'Australian Dollar', locale: 'en-AU', decimals: 2 },
  CAD: { symbol: 'C$', name: 'Canadian Dollar', locale: 'en-CA', decimals: 2 },
  AED: { symbol: 'AED', name: 'UAE Dirham', locale: 'en-AE', decimals: 2 },
  SAR: { symbol: 'SAR', name: 'Saudi Riyal', locale: 'en-SA', decimals: 2 },
  INR: { symbol: '₹', name: 'Indian Rupee', locale: 'en-IN', decimals: 2 },
  BDT: { symbol: '৳', name: 'Bangladeshi Taka', locale: 'en-BD', decimals: 2 },
  LKR: { symbol: 'Rs', name: 'Sri Lankan Rupee', locale: 'en-LK', decimals: 2 },
  SGD: { symbol: 'S$', name: 'Singapore Dollar', locale: 'en-SG', decimals: 2 },
  MYR: { symbol: 'RM', name: 'Malaysian Ringgit', locale: 'en-MY', decimals: 2 },
  NZD: { symbol: 'NZ$', name: 'New Zealand Dollar', locale: 'en-NZ', decimals: 2 },
  ZAR: { symbol: 'R', name: 'South African Rand', locale: 'en-ZA', decimals: 2 },
  CNY: { symbol: '¥', name: 'Chinese Yuan', locale: 'zh-CN', decimals: 2 },
  JPY: { symbol: '¥', name: 'Japanese Yen', locale: 'ja-JP', decimals: 0 },
};

export const DEFAULT_CURRENCY = 'PKR';

export const CURRENCY_OPTIONS = Object.entries(CURRENCIES).map(([code, meta]) => ({
  value: code,
  label: `${code} — ${meta.name}`,
}));

export function currencyMeta(code: string | undefined | null): CurrencyMeta {
  return CURRENCIES[code ?? ''] ?? CURRENCIES[DEFAULT_CURRENCY];
}

export interface MoneyOptions {
  /** Print the symbol. Off inside a table whose header already names it. */
  symbol?: boolean;
  /** Drop the minor unit — for a dense figure like an estimated total. */
  compact?: boolean;
}

/**
 * An amount as text: `Rs 1,234.56`, `$1,234.56`, `¥1,235`.
 *
 * Grouping follows the currency's own locale rather than the browser's, so a
 * PKR figure reads the same to everyone looking at the same payroll.
 */
export function formatMoney(
  amount: number | string | null | undefined,
  code: string | undefined | null,
  options: MoneyOptions = {},
): string {
  const meta = currencyMeta(code);
  const { symbol = true, compact = false } = options;
  const decimals = compact ? 0 : meta.decimals;

  const number = Number(amount ?? 0).toLocaleString(meta.locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return symbol ? `${meta.symbol} ${number}` : number;
}

/**
 * The signed-in org's currency code.
 *
 * Read from the auth store rather than fetched: money appears on nearly every
 * screen, and an async lookup for a symbol would put a loading state in front
 * of a number. The settings blob is served merged with its defaults, so the
 * key is present even for an org that has never saved the form.
 */
export function useCurrency(): string {
  const raw = useAuthStore((s) => s.user?.organization?.settings?.currency);
  return typeof raw === 'string' && raw in CURRENCIES ? raw : DEFAULT_CURRENCY;
}

/** `formatMoney` already bound to the org's currency. */
export function useMoney(): (
  amount: number | string | null | undefined,
  options?: MoneyOptions,
) => string {
  const currency = useCurrency();
  return (amount, options) => formatMoney(amount, currency, options);
}
