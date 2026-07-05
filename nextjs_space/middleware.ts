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

  // Brokers page disabled (per Polsinelli). 307 = temporary, easy to revive.
  if (pathname === '/brokers') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url, 307);
  }

  // Legacy redirects first
  const destination = REDIRECTS[pathname];
  if (destination) {
    const url = request.nextUrl.clone();
    url.pathname = destination;
    return NextResponse.redirect(url, 308);
  }

  // NOTE: /listings/[slug] and /listings/[slug]/inquire are intentionally NOT
  // gated here. Edge middleware can't do the owner DB lookup, so gating lives
  // in the page layer (see app/listings/[slug]/page.tsx + .../inquire/page.tsx):
  // while the marketplace is closed, an admin OR the listing's owner may view a
  // PUBLISHED listing; everyone else is redirected to /marketplace-coming-soon,
  // and any non-published/legacy id 404s (which also drops old URLs from Google).

  // Determine the serving host from headers
  const host = (
    request.headers.get('x-forwarded-host') ||
    request.headers.get('host') ||
    ''
  ).split(':')[0].toLowerCase();

  // ── Hard 301 canonicalization ─────────────────────────────────────────────
  // Permanently redirect every non-canonical PRODUCTION mirror
  // (*.abacusai.app) to terrafirma.partners so all link equity and traffic
  // consolidate on the canonical domain.
  //
  // IMPORTANT protections (do NOT redirect these):
  //   - the canonical host itself
  //   - the in-app preview environment (*.preview.abacusai.app) — redirecting
  //     it would break the live editor/iframe preview
  //   - localhost / 127.0.0.1 (local dev)
  const isCanonical = host === CANONICAL_HOST;
  const isPreview = host.includes('.preview.');
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.') || host.endsWith('.local');
  const isProdMirror = host.endsWith('.abacusai.app') && !isPreview;

  if (host && !isCanonical && !isPreview && !isLocal && isProdMirror) {
    const url = request.nextUrl.clone();
    url.protocol = 'https:';
    url.host = CANONICAL_HOST;
    url.port = '';
    return NextResponse.redirect(url, 301);
  }

  const response = NextResponse.next();

  // Any remaining non-canonical host (e.g. preview) should still never be
  // indexed by search engines.
  if (host && !isCanonical) {
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
