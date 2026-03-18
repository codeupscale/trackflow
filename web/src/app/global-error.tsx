'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-950 text-slate-50">
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center max-w-md p-8">
            <h2 className="text-xl font-bold text-white mb-4">Something went wrong</h2>
            <p className="text-slate-400 text-sm mb-6">
              {error?.message || 'An unexpected error occurred.'}
            </p>
            <button
              onClick={() => reset()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
