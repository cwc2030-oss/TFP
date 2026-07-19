'use client';

/**
 * Brick 1 — owner browse-and-choose (client).
 *
 * Fetches the PII-safe hunter pool from /api/hunters/browse, offers the named
 * filters (day-hunt only / no ATVs / has insurance, plus footprint + max
 * group size), renders honest badges, an expandable detail view, and
 * shortlist add/remove.
 *
 * All honest label copy comes from lib/hunter-profile so there is a single
 * source of truth and no surface can drift into "verified".
 */
import { useCallback, useEffect, useState } from 'react';
import {
  credentialBadge,
  firearmAttestationLabel,
  reputationLabel,
  footprintLabel,
  CREDENTIAL_FIELDS,
  FOOTPRINTS,
  type CredentialLevel,
  type Footprint,
} from '@/lib/hunter-profile';

type Item = {
  id: string;
  displayName: string;
  groupSize: number | null;
  hasKidsFamily: boolean | null;
  footprint: Footprint | null;
  needsPowerHookup: boolean | null;
  needsWaterHookup: boolean | null;
  hasATV: boolean | null;
  huntingLicense: CredentialLevel;
  hunterEd: CredentialLevel;
  liabilityInsurance: CredentialLevel;
  mdcPermits: CredentialLevel;
  firearmAttestation: boolean;
  referenceCount: number;
  completedLeaseCount: number;
  bio: string | null;
  shortlisted: boolean;
};

export default function BrowseClient() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Filters
  const [dayHuntOnly, setDayHuntOnly] = useState(false);
  const [noATV, setNoATV] = useState(false);
  const [hasInsurance, setHasInsurance] = useState(false);
  const [footprint, setFootprint] = useState<Footprint | ''>('');
  const [maxGroupSize, setMaxGroupSize] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      if (dayHuntOnly) q.set('dayHuntOnly', '1');
      if (noATV) q.set('noATV', '1');
      if (hasInsurance) q.set('hasInsurance', '1');
      if (footprint && !dayHuntOnly) q.set('footprint', footprint);
      if (maxGroupSize) q.set('maxGroupSize', maxGroupSize);
      const res = await fetch(`/api/hunters/browse?${q.toString()}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || 'Could not load hunters.');
      }
      const j = await res.json();
      setItems(j.items ?? []);
    } catch (e: any) {
      setError(e?.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }, [dayHuntOnly, noATV, hasInsurance, footprint, maxGroupSize]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleShortlist(item: Item) {
    try {
      if (item.shortlisted) {
        await fetch(`/api/hunters/shortlist?hunterProfileId=${item.id}`, { method: 'DELETE' });
      } else {
        await fetch('/api/hunters/shortlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hunterProfileId: item.id }),
        });
      }
      setItems((prev) =>
        prev.map((p) => (p.id === item.id ? { ...p, shortlisted: !p.shortlisted } : p)),
      );
    } catch {
      /* no-op; keep UI responsive */
    }
  }

  const filterChip =
    'inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm cursor-pointer select-none';

  return (
    <div>
      {/* Filter bar */}
      <div className="bg-stone-900/60 border border-stone-800 rounded-xl p-4 mb-6 flex flex-wrap items-center gap-3">
        <Chip active={dayHuntOnly} onClick={() => setDayHuntOnly((v) => !v)} className={filterChip}>
          Day-hunt only
        </Chip>
        <Chip active={noATV} onClick={() => setNoATV((v) => !v)} className={filterChip}>
          No ATVs
        </Chip>
        <Chip active={hasInsurance} onClick={() => setHasInsurance((v) => !v)} className={filterChip}>
          Has insurance
        </Chip>
        <select
          value={footprint}
          onChange={(e) => setFootprint(e.target.value as Footprint | '')}
          disabled={dayHuntOnly}
          className="bg-stone-950 border border-stone-700 rounded-lg px-3 py-1.5 text-sm text-stone-200 disabled:opacity-50"
        >
          <option value="">Any footprint</option>
          {FOOTPRINTS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <label className="text-sm text-stone-400">Max group</label>
          <input
            type="number"
            min={1}
            max={50}
            value={maxGroupSize}
            onChange={(e) => setMaxGroupSize(e.target.value)}
            placeholder="any"
            className="w-20 bg-stone-950 border border-stone-700 rounded-lg px-2 py-1.5 text-sm text-stone-200"
          />
        </div>
      </div>

      {loading && <p className="text-stone-400">Loading hunters…</p>}
      {error && (
        <p className="text-red-300 bg-red-950/30 border border-red-900/40 rounded-lg px-4 py-3">
          {error}
        </p>
      )}
      {!loading && !error && items.length === 0 && (
        <div className="bg-stone-900/60 border border-stone-800 rounded-xl p-8 text-center text-stone-400">
          No hunters match these filters yet.
        </div>
      )}

      <div className="space-y-4">
        {items.map((item) => {
          const rep = reputationLabel(item.completedLeaseCount);
          const isOpen = expanded === item.id;
          return (
            <div key={item.id} className="bg-stone-900/60 border border-stone-800 rounded-xl p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="text-lg font-semibold text-stone-100">{item.displayName}</h3>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-stone-800 text-stone-300 border border-stone-700">
                      {rep.headline}
                    </span>
                  </div>
                  <p className="text-sm text-stone-400 mt-1">
                    {footprintLabel(item.footprint)}
                    {item.groupSize ? ` · party of ${item.groupSize}` : ''}
                    {item.hasATV ? ' · brings ATV' : ''}
                    {item.hasKidsFamily ? ' · family' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleShortlist(item)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      item.shortlisted
                        ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                        : 'bg-stone-800 text-stone-200 hover:bg-stone-700 border border-stone-700'
                    }`}
                  >
                    {item.shortlisted ? '★ Shortlisted' : '☆ Shortlist'}
                  </button>
                  <button
                    onClick={() => setExpanded(isOpen ? null : item.id)}
                    className="px-3 py-2 rounded-lg text-sm text-stone-300 hover:text-stone-100 border border-stone-700"
                  >
                    {isOpen ? 'Hide' : 'View'}
                  </button>
                </div>
              </div>

              {/* Quick credential badges (always visible) */}
              <div className="flex flex-wrap gap-2 mt-3">
                {CREDENTIAL_FIELDS.map((c) => {
                  const badge = credentialBadge(item[c.key] as CredentialLevel);
                  if (badge.tone === 'muted') return null; // hide "not provided" chips in the summary
                  return <Badge key={c.key} tone={badge.tone}>{`${c.label}: ${badge.text}`}</Badge>;
                })}
              </div>

              {/* Expanded detail */}
              {isOpen && (
                <div className="mt-5 pt-5 border-t border-stone-800 space-y-5">
                  {/* Reputation shell */}
                  <div>
                    <h4 className="text-sm font-semibold text-stone-300 mb-1">Reputation</h4>
                    <p className="text-stone-200">{rep.headline}</p>
                    <p className="text-sm text-stone-500">{rep.sub}</p>
                  </div>

                  {/* Full credentials with honest levels */}
                  <div>
                    <h4 className="text-sm font-semibold text-stone-300 mb-2">Credentials</h4>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {CREDENTIAL_FIELDS.map((c) => {
                        const badge = credentialBadge(item[c.key] as CredentialLevel);
                        return (
                          <div
                            key={c.key}
                            className="flex items-center justify-between bg-stone-950 border border-stone-800 rounded-lg px-3 py-2"
                          >
                            <span className="text-sm text-stone-300">{c.label}</span>
                            <Badge tone={badge.tone}>{badge.text}</Badge>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Safety attestation — always labeled self-attested */}
                  <div>
                    <h4 className="text-sm font-semibold text-stone-300 mb-1">Safety</h4>
                    <p className="text-stone-200">
                      Firearm-violation:{' '}
                      <span className="text-stone-300">
                        {firearmAttestationLabel(item.firearmAttestation)}
                      </span>
                    </p>
                  </div>

                  {/* Disclosure detail */}
                  <div>
                    <h4 className="text-sm font-semibold text-stone-300 mb-1">On the land</h4>
                    <ul className="text-sm text-stone-300 space-y-0.5">
                      <li>Footprint: {footprintLabel(item.footprint)}</li>
                      <li>Group size: {item.groupSize ?? 'Not provided'}</li>
                      <li>Kids / family: {yn(item.hasKidsFamily)}</li>
                      <li>ATV / UTV: {yn(item.hasATV)}</li>
                      <li>Power hookup needed: {yn(item.needsPowerHookup)}</li>
                      <li>Water hookup needed: {yn(item.needsWaterHookup)}</li>
                    </ul>
                  </div>

                  {/* References — existence only, no PII */}
                  <div>
                    <h4 className="text-sm font-semibold text-stone-300 mb-1">References</h4>
                    <p className="text-sm text-stone-400">
                      {item.referenceCount > 0
                        ? `${item.referenceCount} prior-landowner ${
                            item.referenceCount === 1 ? 'reference' : 'references'
                          } on file — not yet contacted. Contact details stay private until you engage.`
                        : 'No references provided.'}
                    </p>
                  </div>

                  {/* Bio */}
                  {item.bio && (
                    <div>
                      <h4 className="text-sm font-semibold text-stone-300 mb-1">Who they are</h4>
                      <p className="text-stone-300 whitespace-pre-wrap leading-relaxed">{item.bio}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function yn(v: boolean | null | undefined): string {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  return 'Not provided';
}

function Chip({
  active,
  onClick,
  className,
  children,
}: {
  active: boolean;
  onClick: () => void;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${className} ${
        active
          ? 'bg-emerald-500/15 border-emerald-500 text-emerald-300'
          : 'bg-stone-950 border-stone-700 text-stone-300 hover:border-stone-600'
      }`}
    >
      {children}
    </button>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: 'muted' | 'attested' | 'onfile';
  children: React.ReactNode;
}) {
  const cls =
    tone === 'attested'
      ? 'bg-sky-500/10 text-sky-300 border-sky-500/30'
      : tone === 'onfile'
        ? 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30'
        : 'bg-stone-800 text-stone-400 border-stone-700';
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${cls}`}
    >
      {children}
    </span>
  );
}
