'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Crosshair, CalendarX2 } from 'lucide-react';

interface HuntSessionData {
  id: string;
  standLabel: string;
  parcelId: string;
  windDirection: string;
  rutPhase: string;
  groundMoisture: string;
  huntStartTime: string;
  outcome: string | null;
}

interface HuntOutcomeCardProps {
  /** Called after outcome is recorded or skipped */
  onDismiss: () => void;
  /** Force-show the card (from "Record Outcome" tap or banner expand) */
  forceShow?: boolean;
}

const OUTCOMES = [
  { key: 'saw_deer',    emoji: '🦌', label: 'Saw Deer' },
  { key: 'harvested',   emoji: '🏆', label: 'Harvested' },
  { key: 'scouted',     emoji: '👀', label: 'Scouted Only' },
  { key: 'no_activity', emoji: '✗',  label: 'No Activity' },
] as const;

// Session-storage key so "Skip" collapse survives within a browser tab
// but resets on next full page load / new tab
const SKIP_KEY = 'hunt_outcome_skipped';

export default function HuntOutcomeCard({ onDismiss, forceShow }: HuntOutcomeCardProps) {
  const [huntSession, setHuntSession] = useState<HuntSessionData | null>(null);
  // 'full' = expanded panel, 'banner' = collapsed top bar, 'hidden' = nothing
  const [mode, setMode] = useState<'full' | 'banner' | 'hidden'>('hidden');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // On mount, check localStorage for active hunt session
  useEffect(() => {
    const activeId = localStorage.getItem('active_hunt_session_id');
    if (!activeId) return;

    fetch(`/api/hunt-sessions?id=${activeId}`)
      .then(r => {
        if (!r.ok) {
          localStorage.removeItem('active_hunt_session_id');
          return null;
        }
        return r.json();
      })
      .then((data: HuntSessionData | null) => {
        if (!data) return;
        if (data.outcome) {
          localStorage.removeItem('active_hunt_session_id');
          return;
        }
        setHuntSession(data);

        // Check if user already skipped this session
        const skipped = sessionStorage.getItem(SKIP_KEY);
        if (skipped === activeId) {
          // Already skipped — show collapsed banner instead
          setMode('banner');
          return;
        }

        // Auto-show full panel after 2 hours
        const hoursSince = (Date.now() - new Date(data.huntStartTime).getTime()) / 36e5;
        if (hoursSince >= 2) {
          setMode('full');
        }
      })
      .catch(err => {
        console.error('[HuntOutcome] Failed to load session:', err);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // React to forceShow prop — open full panel when parent triggers it
  useEffect(() => {
    if (forceShow && huntSession) {
      setMode('full');
    }
  }, [forceShow, huntSession]);

  const handleOutcome = useCallback(async (outcome: string) => {
    if (!huntSession || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/hunt-sessions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          huntSessionId: huntSession.id,
          outcome,
          deerCount: outcome === 'saw_deer' || outcome === 'harvested' ? 1 : 0,
        }),
      });
      if (res.ok) {
        localStorage.removeItem('active_hunt_session_id');
        sessionStorage.removeItem(SKIP_KEY);
        setSuccess(true);
        setTimeout(() => {
          setMode('hidden');
          onDismiss();
        }, 2000);
      } else {
        const d = await res.json().catch(() => ({}));
        console.error('[HuntOutcome] Error:', d);
      }
    } catch (err) {
      console.error('[HuntOutcome] Network error:', err);
    } finally {
      setSubmitting(false);
    }
  }, [huntSession, submitting, onDismiss]);

  const handleSkip = useCallback(() => {
    // Collapse to banner — don't clear localStorage so it resurfaces next session
    if (huntSession) {
      sessionStorage.setItem(SKIP_KEY, huntSession.id);
    }
    setMode('banner');
  }, [huntSession]);

  const handleBannerExpand = useCallback(() => {
    setMode('full');
  }, []);

  // No session or fully hidden
  if (!huntSession || mode === 'hidden') return null;

  const huntTime = new Date(huntSession.huntStartTime);
  const dateStr = huntTime.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
  const timeStr = huntTime.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });
  const seasonLabel = huntSession.rutPhase === 'early' ? 'Early' : huntSession.rutPhase === 'rut' ? 'Rut' : 'Late';

  // ─── Success confirmation ───
  if (success) {
    return (
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999,
        background: 'linear-gradient(to top, rgba(0,0,0,0.95), rgba(0,0,0,0.85))',
        backdropFilter: 'blur(20px)',
        borderTop: '1px solid rgba(201,168,76,0.3)',
        padding: '32px 20px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
      }}>
        <div style={{ fontSize: 28 }}>✓</div>
        <div style={{ color: '#c9a84c', fontSize: 14, fontWeight: 600 }}>Outcome recorded</div>
        <div style={{ color: '#9ca3af', fontSize: 11 }}>Thanks — this makes the model smarter.</div>
      </div>
    );
  }

  // ─── Collapsed banner (after "Skip for now") ───
  if (mode === 'banner') {
    return (
      <div
        onClick={handleBannerExpand}
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
          background: 'rgba(10,20,14,0.92)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(201,168,76,0.3)',
          padding: '10px 16px',
          display: 'flex', alignItems: 'center', gap: 10,
          cursor: 'pointer',
          transition: 'background 0.15s ease',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(10,20,14,0.98)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(10,20,14,0.92)'; }}
      >
        <Crosshair style={{ width: 14, height: 14, color: '#c9a84c', flexShrink: 0 }} />
        <span style={{ flex: 1, color: '#d1d5db', fontSize: 12, fontWeight: 500 }}>
          Log your <span style={{ color: '#c9a84c', fontWeight: 600 }}>{huntSession.standLabel}</span> sit — tap to record
        </span>
        <span style={{ color: '#c9a84c', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Record ›
        </span>
      </div>
    );
  }

  // ─── Full expanded panel ───
  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999,
      background: 'linear-gradient(to top, rgba(10,20,14,0.98), rgba(10,20,14,0.92))',
      backdropFilter: 'blur(20px)',
      borderTop: '2px solid rgba(201,168,76,0.4)',
      borderRadius: '16px 16px 0 0',
      padding: '20px 16px 28px',
      maxHeight: '55vh',
      overflowY: 'auto',
    }}>
      {/* Handle bar */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)' }} />
      </div>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Crosshair style={{ width: 16, height: 16, color: '#c9a84c' }} />
          <span style={{ color: '#c9a84c', fontSize: 13, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Record Outcome</span>
        </div>
        <button onClick={handleSkip} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          <X style={{ width: 16, height: 16, color: '#6b7280' }} />
        </button>
      </div>

      {/* Session info */}
      <div style={{
        background: 'rgba(255,255,255,0.04)',
        borderRadius: 10,
        padding: '12px 14px',
        marginBottom: 16,
        border: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ color: 'white', fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
          {huntSession.standLabel}
        </div>
        <div style={{ color: '#9ca3af', fontSize: 11, marginBottom: 8 }}>
          {dateStr} at {timeStr}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { label: huntSession.windDirection, icon: '💨' },
            { label: seasonLabel, icon: '🍂' },
            { label: huntSession.groundMoisture, icon: '🌧' },
          ].map((tag, i) => (
            <div key={i} style={{
              background: 'rgba(255,255,255,0.06)',
              borderRadius: 6,
              padding: '3px 8px',
              fontSize: 10,
              color: '#d1d5db',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <span>{tag.icon}</span>
              <span>{tag.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Outcome buttons — 5 buttons: 2×2 grid + full-width 5th */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        {OUTCOMES.map(o => (
          <button
            key={o.key}
            disabled={submitting}
            onClick={() => handleOutcome(o.key)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 6,
              padding: '16px 8px',
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.04)',
              cursor: submitting ? 'wait' : 'pointer',
              opacity: submitting ? 0.5 : 1,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(201,168,76,0.15)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(201,168,76,0.4)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.1)';
            }}
          >
            <span style={{ fontSize: 24 }}>{o.emoji}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'white' }}>{o.label}</span>
          </button>
        ))}
      </div>

      {/* Didn't Hunt — full-width 5th button */}
      <button
        disabled={submitting}
        onClick={() => handleOutcome('didnt_hunt')}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 8,
          width: '100%',
          padding: '12px 8px',
          borderRadius: 10,
          border: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(255,255,255,0.03)',
          cursor: submitting ? 'wait' : 'pointer',
          opacity: submitting ? 0.5 : 1,
          transition: 'all 0.15s ease',
          marginBottom: 16,
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.1)';
          (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(239,68,68,0.3)';
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.03)';
          (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.08)';
        }}
      >
        <CalendarX2 style={{ width: 18, height: 18, color: '#9ca3af' }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: '#d1d5db' }}>Didn&apos;t Hunt</span>
      </button>

      {/* Skip */}
      <div style={{ textAlign: 'center' }}>
        <button
          onClick={handleSkip}
          style={{
            background: 'none', border: 'none',
            color: '#6b7280', fontSize: 11,
            cursor: 'pointer',
            textDecoration: 'underline',
            textUnderlineOffset: 3,
          }}
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────
   Hunt-in-progress / awaiting-outcome indicator
   (top of left panel)
   ────────────────────────────────────────────── */

interface HuntInProgressProps {
  onRecordOutcome: () => void;
}

export function HuntInProgressBanner({ onRecordOutcome }: HuntInProgressProps) {
  const [standLabel, setStandLabel] = useState<string | null>(null);
  const [awaitingOutcome, setAwaitingOutcome] = useState(false);

  useEffect(() => {
    const activeId = localStorage.getItem('active_hunt_session_id');
    if (!activeId) { setStandLabel(null); return; }

    fetch(`/api/hunt-sessions?id=${activeId}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: HuntSessionData | null) => {
        if (data && !data.outcome) {
          setStandLabel(data.standLabel);
          // If >2 hours since start, it's "awaiting outcome" not "in progress"
          const hoursSince = (Date.now() - new Date(data.huntStartTime).getTime()) / 36e5;
          setAwaitingOutcome(hoursSince >= 2);
        } else {
          setStandLabel(null);
          if (data?.outcome) localStorage.removeItem('active_hunt_session_id');
        }
      })
      .catch(() => setStandLabel(null));
  }, []);

  // Listen for custom event to refresh banner
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      setStandLabel(e.detail?.standLabel || null);
      setAwaitingOutcome(false); // just started — not awaiting yet
    };
    window.addEventListener('hunt-session-started' as any, handler);
    return () => window.removeEventListener('hunt-session-started' as any, handler);
  }, []);

  // Listen for dismissal
  useEffect(() => {
    const handler = () => { setStandLabel(null); setAwaitingOutcome(false); };
    window.addEventListener('hunt-session-cleared' as any, handler);
    return () => window.removeEventListener('hunt-session-cleared' as any, handler);
  }, []);

  if (!standLabel) return null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 12px',
      background: awaitingOutcome ? 'rgba(201,168,76,0.08)' : 'rgba(34,197,94,0.08)',
      borderBottom: `1px solid ${awaitingOutcome ? 'rgba(201,168,76,0.15)' : 'rgba(34,197,94,0.15)'}`,
      borderRadius: 0,
    }}>
      <span style={{ fontSize: 10, lineHeight: 1 }}>{awaitingOutcome ? '🟡' : '🟢'}</span>
      <span style={{ flex: 1, fontSize: 11, color: awaitingOutcome ? '#fbbf24' : '#86efac', fontWeight: 500 }}>
        {awaitingOutcome ? 'Awaiting outcome' : 'Hunt in progress'} — {standLabel}
      </span>
      <button
        onClick={onRecordOutcome}
        style={{
          background: 'none', border: 'none',
          color: '#c9a84c', fontSize: 10, fontWeight: 600,
          cursor: 'pointer',
          textDecoration: 'underline',
          textUnderlineOffset: 2,
        }}
      >
        Record Outcome
      </button>
    </div>
  );
}
