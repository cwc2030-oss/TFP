import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Permanent (308) redirects for legacy URLs from discontinued products.
// Captures ~28 GA hits/month from external backlinks (FB posts, broker emails)
// pointing to the now-removed Broker Quick Look ($49) URLs.
const REDIRECTS: Record<string, string> = {
  '/api/sample-quick-look': '/api/free-look',
  '/quick-look': '/demo',
  '/sample-quick-look': '/demo',
};

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const destination = REDIRECTS[pathname];

  if (destination) {
    const url = request.nextUrl.clone();
    url.pathname = destination;
    // 308 Permanent Redirect — preserves method (POST stays POST),
    // tells search engines & social platforms to update their index.
    return NextResponse.redirect(url, 308);
  }

  return NextResponse.next();
}

export const config = {
  // Match exactly the legacy paths so middleware doesn't run for every request.
  matcher: [
    '/api/sample-quick-look',
    '/quick-look',
    '/sample-quick-look',
  ],
};
