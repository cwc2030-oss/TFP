'use client';

/**
 * useAutosave — debounced, draft-only auto-save for the listing wizard.
 *
 * Fires the SAME per-step PATCH (`/api/listings/[id]`) that the manual
 * "Save" button uses, ~800ms after the user stops typing (or immediately
 * on `flush()`, which we wire to field blur). This means typed text is
 * persisted to the draft even if the owner navigates away (Back button,
 * a "Fix →" link, step nav, or browser back) without clicking Save.
 *
 * Guarantees:
 *  - Never fires on initial mount (baseline = the values loaded from the draft).
 *  - Coalesces rapid edits (single trailing save) and serializes overlapping
 *    saves (if the body changed while a save was in flight, it saves again).
 *  - Draft-only: the PATCH endpoint refuses anything past DRAFT (409), and we
 *    never send publish/lifecycle fields — so this can never auto-publish.
 *  - `dirty` + a beforeunload guard warn the owner if a save couldn't fire
 *    before a full page unload / refresh.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function useAutosave({
  listingId,
  body,
  enabled = true,
  delay = 800,
}: {
  listingId: string;
  /** The exact PATCH body for this step. Rebuilt every render from form state. */
  body: Record<string, unknown>;
  enabled?: boolean;
  delay?: number;
}) {
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const serialized = JSON.stringify(body);

  // Baseline: what's already persisted in the draft. Initialised to the
  // mount-time value so we never re-save the values we just loaded.
  const lastSaved = useRef<string>(serialized);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const pending = useRef<string | null>(null);
  const mounted = useRef(false);

  const doSave = useCallback(
    async (payload: string) => {
      inFlight.current = true;
      setStatus('saving');
      try {
        const res = await fetch(`/api/listings/${listingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        lastSaved.current = payload;
        setStatus('saved');
      } catch {
        setStatus('error');
      } finally {
        inFlight.current = false;
        // If the form changed while this save was in flight, save the latest.
        if (pending.current && pending.current !== lastSaved.current) {
          const next = pending.current;
          pending.current = null;
          void doSave(next);
        }
      }
    },
    [listingId],
  );

  // Debounced trailing save whenever the serialized body changes.
  useEffect(() => {
    if (!enabled) return;
    if (!mounted.current) {
      mounted.current = true;
      return; // skip the mount render — baseline already matches the draft
    }
    if (serialized === lastSaved.current) return; // net no-op

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (inFlight.current) {
        pending.current = serialized;
      } else {
        void doSave(serialized);
      }
    }, delay);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [serialized, enabled, delay, doSave]);

  const dirty = serialized !== lastSaved.current;

  // Warn on hard unload (refresh / tab close / browser navigation) if a
  // save hasn't landed yet. Client-side nav is covered by flush()-on-blur.
  useEffect(() => {
    if (!enabled) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (serialized !== lastSaved.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [serialized, enabled]);

  // Flush immediately — wired to form blur so leaving a field (or clicking a
  // link, which blurs the field) dispatches the save right away.
  const flush = useCallback(() => {
    if (!enabled) return;
    if (timer.current) clearTimeout(timer.current);
    if (serialized !== lastSaved.current && !inFlight.current) {
      void doSave(serialized);
    }
  }, [enabled, serialized, doSave]);

  // Let a manual Save tell us its payload is now the persisted baseline, so
  // the indicator doesn't flash "unsaved" right before navigation.
  const markSaved = useCallback((payload: string) => {
    if (timer.current) clearTimeout(timer.current);
    lastSaved.current = payload;
  }, []);

  return { status, dirty, flush, markSaved };
}

/** Quiet, non-intrusive save status. No modal, no nag. */
export function AutosaveIndicator({
  status,
  dirty,
}: {
  status: AutosaveStatus;
  dirty: boolean;
}) {
  let text = '';
  let cls = 'text-stone-500';
  if (status === 'saving') {
    text = 'Saving\u2026';
    cls = 'text-stone-400';
  } else if (status === 'error') {
    text = 'Couldn\u2019t save \u2014 your last Save is safe';
    cls = 'text-amber-400';
  } else if (dirty) {
    text = 'Unsaved changes\u2026';
    cls = 'text-stone-500';
  } else if (status === 'saved') {
    text = '\u2713 Saved';
    cls = 'text-emerald-400';
  }

  return (
    <span
      aria-live="polite"
      className={`text-xs transition-colors ${cls} ${text ? 'opacity-100' : 'opacity-0'}`}
    >
      {text || '\u00a0'}
    </span>
  );
}
