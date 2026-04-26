/**
 * Tiny disclosure widget for a long inquiry message in the row.
 * Default state collapsed (3-line preview). Click to expand inline.
 */
'use client';

import { useState } from 'react';

export default function InquiryMessageDisclosure({ message }: { message: string }) {
  const [open, setOpen] = useState(false);
  const PREVIEW_LEN = 140;
  const isLong = message.length > PREVIEW_LEN;
  const preview = isLong ? `${message.slice(0, PREVIEW_LEN).trim()}\u2026` : message;

  return (
    <div className="mt-2 text-stone-300 text-xs leading-relaxed">
      <span className="whitespace-pre-wrap">{open ? message : preview}</span>
      {isLong && (
        <>
          {' '}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2"
          >
            {open ? 'Show less' : 'Show more'}
          </button>
        </>
      )}
    </div>
  );
}
