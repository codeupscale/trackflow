'use client';

import { useEffect } from 'react';
import type { Path, PathValue, UseFormReturn } from 'react-hook-form';

/**
 * Code auto-generation shared by every name+code form in the app.
 *
 * Two formats exist in this product and a single slugify would be wrong for
 * two of the three entities, so the format is chosen per form:
 *
 *   abbreviateCode  Engineering      -> ENG      (departments, positions)
 *   slugCode        Annual Leave     -> annual   (leave types)
 *
 * Codes are UNIQUE PER ORGANIZATION in the database, so a generated value can
 * always collide. Generation is therefore a convenience only — the field stays
 * fully editable and the user's own input always wins.
 */

/**
 * UPPERCASE abbreviation, matching the seeded department codes
 * (Design -> DES, Engineering -> ENG, Human Resources -> HR).
 *
 * Multi-word names become initials; a single word becomes its first three
 * letters. Digits are kept so "QA 2" style names survive.
 */
export function abbreviateCode(source: string, maxLength = 5): string {
  const words = source
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return '';

  const raw =
    words.length === 1
      ? words[0].slice(0, 3)
      : words.map((w) => w[0]).join('');

  return raw.toUpperCase().slice(0, maxLength);
}

/**
 * lowercase slug, matching the leave-type convention (Annual Leave -> annual).
 *
 * A trailing generic noun is dropped so "Annual Leave" yields "annual" rather
 * than "annual-leave" — that is what the field's own placeholder documents.
 */
export function slugCode(source: string, maxLength = 20): string {
  const cleaned = source
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (cleaned.length === 0) return '';

  // Drop a trailing generic word, but never the only word ("Leave" -> "leave").
  const GENERIC_TRAILING = new Set(['leave', 'type', 'types']);
  const words =
    cleaned.length > 1 && GENERIC_TRAILING.has(cleaned[cleaned.length - 1])
      ? cleaned.slice(0, -1)
      : cleaned;

  return words.join('-').slice(0, maxLength).replace(/-+$/, '');
}

interface UseCodeFromNameOptions<T extends Record<string, unknown>> {
  form: UseFormReturn<T>;
  /** Field to read from — `name` for most forms, `title` for positions. */
  sourceField: Path<T>;
  codeField: Path<T>;
  /** How to turn the source value into a code. */
  generate: (source: string) => string;
  /**
   * Auto-generation is for NEW records only. Pass false when editing: an
   * existing code may already be referenced elsewhere, and silently rewriting
   * it while someone fixes a typo in the name risks a uniqueness violation.
   */
  enabled: boolean;
}

/**
 * Keeps `codeField` in sync with `sourceField` until the user edits the code
 * themselves, after which the field is left alone.
 *
 * "Has the user edited it" is read from react-hook-form's `dirtyFields`, and
 * the generated write uses `shouldDirty: false` — so only real keystrokes in
 * the code input mark it dirty. Clearing the code field back to empty makes it
 * clean again and resumes generation, which is the behaviour you want if
 * someone wipes a code intending to start over.
 */
export function useCodeFromName<T extends Record<string, unknown>>({
  form,
  sourceField,
  codeField,
  generate,
  enabled,
}: UseCodeFromNameOptions<T>): void {
  const sourceValue = form.watch(sourceField);
  // dirtyFields is a DeepMap keyed by field path; index it as a plain record.
  const userEditedCode = Boolean(
    (form.formState.dirtyFields as Record<string, unknown>)[codeField]
  );

  useEffect(() => {
    if (!enabled || userEditedCode) return;

    const next = generate(typeof sourceValue === 'string' ? sourceValue : '');
    if (next === form.getValues(codeField)) return;

    form.setValue(codeField, next as PathValue<T, Path<T>>, {
      shouldDirty: false,
      shouldValidate: false,
    });
    // `form` and `generate` are stable enough in practice; keying the effect on
    // them re-runs it on every render and fights the user's own typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceValue, userEditedCode, enabled, codeField]);
}
