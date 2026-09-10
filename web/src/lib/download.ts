// Shared browser-download helpers.
//
// Extracted from the reports export fix (commit ebfd8327). Two subtle browser
// behaviours are handled here so callers never re-learn them:
//
//   1. Revoking the object URL synchronously right after link.click() aborts the
//      download in some browsers ("nothing happens"). Cleanup is deferred so the
//      browser has actually started the transfer before we revoke.
//   2. When an export request fails, the error body arrives as a Blob (because the
//      request used responseType: 'blob'). readBlobError() reads it back as JSON so
//      the real server message surfaces instead of a generic toast.

/**
 * Trigger a browser download from a blob/binary payload. Cleanup is deferred so the
 * browser has actually started the download before the object URL is revoked.
 * Guarded to run only in the browser.
 */
export function triggerDownload(data: BlobPart, filename: string, mime: string): void {
  if (typeof window === 'undefined') return;

  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    link.remove();
    window.URL.revokeObjectURL(url);
  }, 1500);
}

/**
 * When an export fails, the error body is a Blob (responseType: 'blob'); read it back
 * as JSON so we can surface the real server message instead of a generic toast.
 */
export async function readBlobError(err: unknown): Promise<string | null> {
  const data =
    (err as { data?: unknown })?.data ??
    (err as { response?: { data?: unknown } })?.response?.data;

  if (data instanceof Blob) {
    try {
      return extractMessage(JSON.parse(await data.text()));
    } catch {
      return null;
    }
  }

  return extractMessage(data);
}

/**
 * Pull the human-readable reason out of an API error body.
 *
 * This API wraps errors as `{ error: { code, message } }` (see the render()
 * handler in backend/bootstrap/app.php) and only validation failures also
 * carry a top-level `message`. Reading `message` alone therefore missed the
 * reason on every abort() — a 422 explaining exactly what was wrong arrived at
 * the UI as a generic fallback.
 */
function extractMessage(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;

  const wrapped = (data as { error?: { message?: unknown } }).error?.message;
  if (typeof wrapped === 'string' && wrapped) return wrapped;

  const plain = (data as { message?: unknown }).message;
  if (typeof plain === 'string' && plain) return plain;

  return null;
}
