<?php

namespace App\Http\Requests\Hr\Concerns;

use App\Services\JobDescriptionSanitizer;

/**
 * Cleans the rich-text long description before validation runs.
 *
 * Sanitising in prepareForValidation (rather than in the service, after
 * validation) means the length rule applies to the markup that will actually be
 * stored, and the sanitised value is what every later step sees. Doing it here
 * also means no route into the model can bypass it: the client-side editor
 * cannot be trusted, since the API accepts whatever is POSTed to it.
 */
trait SanitizesJobDescription
{
    protected function sanitizeLongDescriptionInput(): void
    {
        if (! $this->has('long_description')) {
            return;
        }

        $this->merge([
            'long_description' => app(JobDescriptionSanitizer::class)
                ->sanitize($this->input('long_description')),
        ]);
    }
}
