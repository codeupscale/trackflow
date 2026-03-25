import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 text-center">
      <h1 className="text-8xl font-bold tracking-tight text-slate-100">404</h1>
      <p className="mt-4 text-lg text-slate-400">
        The page you are looking for does not exist or has been moved.
      </p>
      <Link
        href="/dashboard"
        className="mt-8 inline-flex items-center rounded-md bg-blue-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
