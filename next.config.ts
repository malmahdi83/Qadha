import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on',
  },
  {
    key: 'X-Frame-Options',
    value: 'SAMEORIGIN',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(self), microphone=(self), geolocation=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // Supabase API + edge functions
      `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.elevenlabs.io`,
      // Next.js requires unsafe-inline; Google Fonts loaded from globals.css
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      // unsafe-inline required — Next.js injects inline scripts for hydration
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      // Camera/mic for interview recording
      "media-src 'self' blob:",
      // Avatar emoji rendered as text; no external images needed
      "img-src 'self' data: blob:",
      "font-src 'self' https://fonts.gstatic.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
