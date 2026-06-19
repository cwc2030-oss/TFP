import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const CANONICAL_HOST = 'terrafirma.partners';

// Permanent (308) redirects for legacy URLs from discontinued products.
const REDIRECTS: Record<string, string> = {
  '/api/sample-quick-look': '/api/free-look',
  '/quick-look': '/demo',
  '/sample-quick-look': '/demo',
  '/find-a-lease': '/marketplace-coming-soon',
  '/listings': '/marketplace-coming-soon',
};

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Legacy redirects first
  const destination = REDIRECTS[pathname];
  if (destination) {
    const url = request.nextUrl.clone();
    url.pathname = destination;
    return NextResponse.redirect(url, 308);
  }

  // /listings/[slug] and /listings/[slug]/inquire → 404 so Google drops old listing URLs
  if (pathname.startsWith('/listings/')) {
    const url = request.nextUrl.clone();
    url.pathname = '/marketplace-coming-soon';
    return NextResponse.redirect(url, 302);
  }

  const response = NextResponse.next();

  // Determine the serving host from headers
  const host = (
    request.headers.get('x-forwarded-host') ||
    request.headers.get('host') ||
    ''
  ).split(':')[0].toLowerCase();

  // Non-canonical hosts: tell search engines to ignore these mirrors.
  // Human visitors still see the site normally (no redirect), but crawlers
  // won't index the .abacusai.app mirrors, preventing duplicate-content
  // dilution of the canonical terrafirma.partners domain.
  if (host && host !== CANONICAL_HOST) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }

  return response;
}

export const config = {
  // Run on all non-static paths.
  // Excludes _next/static, _next/image, favicon, and common static assets
  // to avoid unnecessary overhead on immutable files.
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.svg|og-image\\.png|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|eot)$).*)',
  ],
};
