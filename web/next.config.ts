import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== 'production';

// Derive allowed API origin from NEXT_PUBLIC_API_URL so local dev works
// without loosening production CSP (e.g. http://localhost:8080/api/v1 → http://localhost:8080)
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '';
let apiOrigin = '';
try {
  apiOrigin = apiUrl ? new URL(apiUrl).origin : '';
} catch {
  // ignore invalid URL
}
// For local dev also allow all localhost ports; in production apiOrigin is already codeupscale.com
const isLocalDev = isDev || apiOrigin.startsWith('http://localhost') || apiOrigin.startsWith('http://127.0.0.1');
const localhostCsp = isLocalDev
  ? ' http://localhost:* ws://localhost:* http://127.0.0.1:*'
  : '';
// In dev, screenshots are served from local Laravel storage (http://localhost:PORT/storage/...)
// so we must allow http localhost in img-src too.
const localhostImgCsp = isLocalDev ? ' http://localhost:* http://127.0.0.1:*' : '';

const nextConfig: NextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.codeupscale.com',
      },
      {
        protocol: 'https',
        hostname: '*.s3.*.amazonaws.com',
      },
      {
        protocol: 'https',
        hostname: '*.s3.amazonaws.com',
      },
      // Dev: screenshots are served from local Laravel storage over HTTP
      ...(isLocalDev ? ([
        { protocol: 'http' as const, hostname: 'localhost' },
        { protocol: 'http' as const, hostname: '127.0.0.1' },
      ]) : []),
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // unsafe-inline needed for Next.js inline scripts; unsafe-eval needed for Next.js dev (consider removing in prod via env)
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://us.i.posthog.com https://us-assets.i.posthog.com https://accounts.google.com https://apis.google.com",
              "style-src 'self' 'unsafe-inline' https://accounts.google.com",
              // Restrict img-src to known domains instead of blanket https:
              "img-src 'self' data: blob: https://*.codeupscale.com https://*.s3.amazonaws.com https://*.s3.*.amazonaws.com https://*.amazonaws.com https://*.googleusercontent.com https://*.google.com" + localhostImgCsp,
              "font-src 'self' data: https://fonts.gstatic.com",
              "connect-src 'self' https://*.codeupscale.com wss://*.codeupscale.com https://us.i.posthog.com https://us-assets.i.posthog.com https://us.posthog.com https://accounts.google.com https://oauth2.googleapis.com" + localhostCsp,
              "frame-src 'self' https://accounts.google.com",
              // Prevent the page from being embedded in iframes (defense in depth with X-Frame-Options)
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
  poweredByHeader: false,
};

export default nextConfig;
