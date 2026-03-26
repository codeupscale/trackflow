import type { NextConfig } from "next";

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
              "img-src 'self' data: blob: https://*.codeupscale.com https://*.s3.amazonaws.com https://*.s3.*.amazonaws.com https://*.amazonaws.com https://*.googleusercontent.com https://*.google.com",
              "font-src 'self' data: https://fonts.gstatic.com",
              "connect-src 'self' https://*.codeupscale.com wss://*.codeupscale.com https://us.i.posthog.com https://us-assets.i.posthog.com https://us.posthog.com https://accounts.google.com https://oauth2.googleapis.com",
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
