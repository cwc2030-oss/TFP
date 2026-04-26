'use client';

import { useEffect } from 'react';
import { trackEvent } from '@/lib/gtag';

export default function ListingCtaArrivalTracker({
  savedPropertyId,
  cta,
}: {
  savedPropertyId: string | null;
  cta: string | null;
}) {
  useEffect(() => {
    if (!savedPropertyId || cta !== 'pdf') return;
    trackEvent('list_cta_pdf_click', { savedPropertyId });
  }, [savedPropertyId, cta]);

  return null;
}
