<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class SanitizeInput
{
    /**
     * Keys left untouched by the blunt strip_tags() pass below.
     *
     * Passwords are excluded because stripping them would silently corrupt a
     * credential containing < or >.
     *
     * long_description is the job posting's rich text. It is the one field in
     * the API that legitimately carries HTML, so strip_tags() would destroy the
     * formatting it exists to store. It is NOT unprotected: StoreJobPostingRequest
     * and UpdateJobPostingRequest run it through JobDescriptionSanitizer in
     * prepareForValidation, which is an allow-list far stricter than strip_tags
     * (it also removes javascript: URLs, event handlers and unknown attributes,
     * none of which strip_tags understands).
     *
     * Anything added here MUST have its own sanitiser. An exemption without one
     * is a stored-XSS hole.
     */
    protected array $except = [
        'password',
        'password_confirmation',
        'current_password',
        'long_description',
    ];

    public function handle(Request $request, Closure $next): Response
    {
        $input = $request->all();
        $request->merge($this->sanitize($input));

        return $next($request);
    }

    private function sanitize(array $data): array
    {
        foreach ($data as $key => $value) {
            if (in_array($key, $this->except, true)) {
                continue;
            }

            if (is_string($value)) {
                $data[$key] = strip_tags($value);
            } elseif (is_array($value)) {
                $data[$key] = $this->sanitize($value);
            }
        }

        return $data;
    }
}
