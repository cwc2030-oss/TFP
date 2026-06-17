"use client";

import { Shield } from "lucide-react";

/**
 * Privacy promise — renders prominently near address bars, checkout buttons,
 * and in the footer. Single source of truth for the copy.
 */
export default function PrivacyPromise({ className = '' }: { className?: string }) {
  return (
    <p
      className={`flex items-start gap-2 text-xs sm:text-sm leading-relaxed ${
        className || 'text-stone-500'
      }`}
    >
      <Shield className="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-600" />
      <span>
        Where you hunt is nobody&apos;s business but yours. We will never sell
        your data&nbsp;&mdash; not your locations, not your parcels, not your
        pins, not your hunts. Not now. Not ever.
      </span>
    </p>
  );
}
