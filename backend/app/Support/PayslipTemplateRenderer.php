<?php

namespace App\Support;

/**
 * A deliberately tiny, sandboxed template engine for company-uploaded payslip
 * designs.
 *
 * This is NOT Blade and must never become Blade. A payslip template is content
 * uploaded by a customer and rendered on our server; compiling it as Blade —
 * or as anything that can evaluate an expression — hands every organization
 * arbitrary PHP execution. So the grammar here is closed and knows exactly
 * three forms:
 *
 *   {{ path.to.value }}          escaped output of a pre-computed value
 *   {{#each list}} … {{/each}}   repeat a block over a pre-computed list
 *   {{#if path}} … {{/if}}       render a block when a value is truthy
 *
 * There are no filters, no function calls, no arithmetic and no way to reach a
 * PHP object: the renderer is handed a flat array of strings, numbers and
 * lists, and an unknown path renders as an empty string rather than an error.
 * Everything is escaped on output except the two entries the SERVER builds
 * (the logo <img> and the draft stamp), which are listed in RAW_KEYS.
 */
class PayslipTemplateRenderer
{
    /**
     * Values the server itself composes as markup. Nothing user-supplied is
     * ever added to this list.
     */
    private const RAW_KEYS = ['company.logo_img', 'draft_stamp'];

    /** Guards a pathological template from looping the renderer forever. */
    private const MAX_BLOCK_DEPTH = 10;

    /**
     * Markup that must never survive into a rendered payslip, whatever the
     * uploader intended. `<?` covers both `<?php` and short tags; the rest
     * close the door on script execution inside a PDF renderer.
     */
    private const FORBIDDEN = ['<?', '<script', '<iframe', '<object', '<embed', 'javascript:', '<base'];

    /**
     * Reject a template outright before it is ever stored. Returns a list of
     * human-readable problems; an empty list means the template is storable.
     */
    public static function validate(string $html): array
    {
        $errors = [];
        $lower = mb_strtolower($html);

        foreach (self::FORBIDDEN as $needle) {
            if (str_contains($lower, $needle)) {
                $errors[] = "Templates cannot contain \"{$needle}\". Payslips are rendered on our server, so scripts and embedded documents are not allowed.";
            }
        }

        // Unbalanced blocks would silently swallow the rest of the payslip.
        foreach (['each', 'if'] as $block) {
            $opens = preg_match_all('/\{\{#' . $block . '\s+[a-z0-9_.]+\s*\}\}/i', $html);
            $closes = preg_match_all('/\{\{\/' . $block . '\s*\}\}/i', $html);
            if ($opens !== $closes) {
                $errors[] = "Unbalanced {{#{$block}}} and {{/{$block}}} tags ({$opens} opened, {$closes} closed).";
            }
        }

        return $errors;
    }

    /**
     * Render a validated template against a flat context.
     *
     * Blocks are resolved before plain values so that a `{{ label }}` inside an
     * {{#each}} resolves against the row, not the outer document.
     */
    public static function render(string $template, array $context): string
    {
        $out = self::renderBlocks($template, $context, 0);

        return self::renderValues($out, $context);
    }

    // ── Blocks ────────────────────────────────────────────────────────────

    private static function renderBlocks(string $template, array $context, int $depth): string
    {
        if ($depth > self::MAX_BLOCK_DEPTH) {
            return $template;
        }

        // {{#if path}} … {{/if}} — non-greedy so sibling blocks stay separate.
        $template = preg_replace_callback(
            '/\{\{#if\s+([a-z0-9_.]+)\s*\}\}(.*?)\{\{\/if\s*\}\}/is',
            function (array $m) use ($context, $depth) {
                $value = self::lookup($context, $m[1]);
                $truthy = is_array($value) ? $value !== [] : ! empty($value);

                return $truthy ? self::renderBlocks($m[2], $context, $depth + 1) : '';
            },
            $template,
        ) ?? $template;

        // {{#each list}} … {{/each}}
        $template = preg_replace_callback(
            '/\{\{#each\s+([a-z0-9_.]+)\s*\}\}(.*?)\{\{\/each\s*\}\}/is',
            function (array $m) use ($context, $depth) {
                $rows = self::lookup($context, $m[1]);
                if (! is_array($rows) || $rows === []) {
                    return '';
                }

                $rendered = '';
                foreach ($rows as $row) {
                    if (! is_array($row)) {
                        continue;
                    }
                    // The row wins over the document for the duration of the
                    // block, so {{ label }} means this row's label.
                    $scoped = array_merge($context, $row);
                    $rendered .= self::renderValues(
                        self::renderBlocks($m[2], $scoped, $depth + 1),
                        $scoped,
                    );
                }

                return $rendered;
            },
            $template,
        ) ?? $template;

        return $template;
    }

    // ── Values ────────────────────────────────────────────────────────────

    private static function renderValues(string $template, array $context): string
    {
        return preg_replace_callback(
            '/\{\{\s*([a-z0-9_.]+)\s*\}\}/i',
            function (array $m) use ($context) {
                $key = $m[1];
                $value = self::lookup($context, $key);

                if (is_array($value) || $value === null) {
                    return '';
                }

                if (in_array($key, self::RAW_KEYS, true)) {
                    return (string) $value;
                }

                return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
            },
            $template,
        ) ?? $template;
    }

    /**
     * Dot-path lookup. A miss returns null, which renders as an empty string —
     * a typo in a placeholder must degrade one field, never break the payslip.
     */
    private static function lookup(array $context, string $path): mixed
    {
        if (array_key_exists($path, $context)) {
            return $context[$path];
        }

        $value = $context;
        foreach (explode('.', $path) as $segment) {
            if (! is_array($value) || ! array_key_exists($segment, $value)) {
                return null;
            }
            $value = $value[$segment];
        }

        return $value;
    }
}
