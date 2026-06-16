'use client';

import { usePathname } from 'next/navigation';

const CANONICAL_ORIGIN = 'https://terrafirma.partners';

/**
 * Injects <link rel="canonical"> pointing to the terrafirma.partners
 * equivalent of the current page. Placed in <head> of root layout.
 * Search engines always know the single source of truth regardless
 * of which hostname served the page.
 */
export default function CanonicalHead() {
  const pathname = usePathname();
  const href = `${CANONICAL_ORIGIN}${pathname === '/' ? '' : pathname}`;

  return <link rel="canonical" href={href} key="canonical" />;
}
