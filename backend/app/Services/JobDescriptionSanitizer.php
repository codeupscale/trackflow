<?php

namespace App\Services;

use Symfony\Component\HtmlSanitizer\HtmlSanitizer;
use Symfony\Component\HtmlSanitizer\HtmlSanitizerConfig;

/**
 * Allow-list sanitiser for the job posting long description.
 *
 * WHY THIS EXISTS: the long description is authored as HTML in trackflow and
 * rendered verbatim on the public careers site. Without sanitising, anyone who
 * can create a job posting — or anyone who compromises an HR account — could
 * inject script into codeupscale.com for every visitor. Sanitising happens on
 * SAVE so the database only ever holds safe markup; the careers page can then
 * render what it is given without re-sanitising.
 *
 * The allow-list is deliberately narrower than allowSafeElements(): it permits
 * exactly what the TipTap toolbar can produce and nothing more. Anything else
 * (images, iframes, tables, style attributes) is dropped rather than escaped,
 * so unexpected markup vanishes instead of showing up as literal angle brackets.
 */
class JobDescriptionSanitizer
{
    /** Roughly 60k of markup — far above any realistic job ad. */
    private const MAX_INPUT_LENGTH = 60000;

    private HtmlSanitizer $sanitizer;

    public function __construct()
    {
        $config = (new HtmlSanitizerConfig())
            // Text and structure
            ->allowElement('p')
            ->allowElement('br')
            ->allowElement('strong')
            ->allowElement('b')
            ->allowElement('em')
            ->allowElement('i')
            ->allowElement('u')
            ->allowElement('s')
            ->allowElement('h2')
            ->allowElement('h3')
            ->allowElement('h4')
            ->allowElement('blockquote')
            ->allowElement('code')
            // Lists
            ->allowElement('ul')
            ->allowElement('ol')
            ->allowElement('li')
            // Links, with the scheme restricted and rel/target forced
            ->allowElement('a', ['href'])
            ->allowLinkSchemes(['https', 'http', 'mailto'])
            ->allowRelativeLinks(false)
            ->forceAttribute('a', 'rel', 'noopener noreferrer nofollow')
            ->forceAttribute('a', 'target', '_blank')
            ->withMaxInputLength(self::MAX_INPUT_LENGTH);

        $this->sanitizer = new HtmlSanitizer($config);
    }

    public function sanitize(?string $html): ?string
    {
        if ($html === null) {
            return null;
        }

        $clean = trim($this->sanitizer->sanitize($html));

        // An editor that has been cleared still emits an empty paragraph.
        // Store null rather than "<p></p>" so "is there a description?" is a
        // simple null check for every consumer.
        if ($clean === '' || $this->isEmptyMarkup($clean)) {
            return null;
        }

        return $clean;
    }

    private function isEmptyMarkup(string $html): bool
    {
        $text = trim(html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5));

        // Non-breaking spaces survive strip_tags as UTF-8 bytes.
        $text = trim(str_replace("\xC2\xA0", ' ', $text));

        return $text === '';
    }
}
