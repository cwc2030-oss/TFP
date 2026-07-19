'use client';

/**
 * Brick 1 — hunter create/edit profile form (client).
 *
 * HONESTY RULES enforced in the UI here:
 *  - Credentials offer only "Not provided" or "Self-attest". There is NO
 *    "verified" option — no uploader exists in Brick 1, so DOCUMENT_ON_FILE is
 *    never offered.
 *  - The firearm item is a self-attestation checkbox, always labeled as such,
 *    never as a background check.
 *  - The form warns that the profile only appears to landowners once the
 *    firearm attestation is checked (affirmative-claim hard gate).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  FOOTPRINTS,
  CREDENTIAL_FIELDS,
  type CredentialKey,
  type Footprint,
} from '@/lib/hunter-profile';

type CredLevel = 'NONE' | 'SELF_ATTESTED';

type Ref = { name?: string; relationship?: string; contact?: string; note?: string };

type Initial = {
  groupSize: number | null;
  hasKidsFamily: boolean | null;
  footprint: Footprint | null;
  needsPowerHookup: boolean | null;
  needsWaterHookup: boolean | null;
  hasATV: boolean | null;
  huntingLicense: CredLevel;
  hunterEd: CredLevel;
  liabilityInsurance: CredLevel;
  mdcPermits: CredLevel;
  firearmAttestation: boolean;
  references: Ref[];
  bio: string | null;
  visible: boolean;
} | null;

export default function ProfileForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [groupSize, setGroupSize] = useState<string>(
    initial?.groupSize != null ? String(initial.groupSize) : '',
  );
  const [hasKidsFamily, setHasKidsFamily] = useState<boolean>(initial?.hasKidsFamily ?? false);
  const [footprint, setFootprint] = useState<Footprint | ''>(initial?.footprint ?? '');
  const [needsPowerHookup, setNeedsPowerHookup] = useState<boolean>(initial?.needsPowerHookup ?? false);
  const [needsWaterHookup, setNeedsWaterHookup] = useState<boolean>(initial?.needsWaterHookup ?? false);
  const [hasATV, setHasATV] = useState<boolean>(initial?.hasATV ?? false);

  const [creds, setCreds] = useState<Record<CredentialKey, CredLevel>>({
    huntingLicense: initial?.huntingLicense === 'SELF_ATTESTED' ? 'SELF_ATTESTED' : 'NONE',
    hunterEd: initial?.hunterEd === 'SELF_ATTESTED' ? 'SELF_ATTESTED' : 'NONE',
    liabilityInsurance: initial?.liabilityInsurance === 'SELF_ATTESTED' ? 'SELF_ATTESTED' : 'NONE',
    mdcPermits: initial?.mdcPermits === 'SELF_ATTESTED' ? 'SELF_ATTESTED' : 'NONE',
  });

  const [firearmAttestation, setFirearmAttestation] = useState<boolean>(initial?.firearmAttestation ?? false);
  const [refs, setRefs] = useState<Ref[]>(
    initial?.references && initial.references.length > 0
      ? initial.references
      : [{ name: '', relationship: '', contact: '', note: '' }],
  );
  const [bio, setBio] = useState<string>(initial?.bio ?? '');
  const [visible, setVisible] = useState<boolean>(initial?.visible ?? true);

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  function toggleCred(key: CredentialKey) {
    setCreds((c) => ({ ...c, [key]: c[key] === 'SELF_ATTESTED' ? 'NONE' : 'SELF_ATTESTED' }));
  }

  function updateRef(i: number, patch: Partial<Ref>) {
    setRefs((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRef() {
    if (refs.length >= 5) return;
    setRefs((rs) => [...rs, { name: '', relationship: '', contact: '', note: '' }]);
  }
  function removeRef(i: number) {
    setRefs((rs) => rs.filter((_, idx) => idx !== i));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const payload = {
        groupSize: groupSize ? parseInt(groupSize, 10) : null,
        hasKidsFamily,
        footprint: footprint || null,
        needsPowerHookup,
        needsWaterHookup,
        hasATV,
        huntingLicense: creds.huntingLicense,
        hunterEd: creds.hunterEd,
        liabilityInsurance: creds.liabilityInsurance,
        mdcPermits: creds.mdcPermits,
        firearmAttestation,
        references: refs,
        bio,
        visible,
      };
      const res = await fetch('/api/hunters/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || 'Could not save your profile.');
      }
      setMsg({ kind: 'ok', text: 'Saved. Your profile is up to date.' });
      router.refresh();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message || 'Something went wrong.' });
    } finally {
      setSaving(false);
    }
  }

  const card = 'bg-stone-900/60 border border-stone-800 rounded-xl p-6';
  const label = 'block text-sm font-medium text-stone-300 mb-1';
  const input =
    'w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50';

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* Disclosure */}
      <section className={card}>
        <h2 className="text-lg font-semibold text-stone-100 mb-4">How you hunt</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={label}>Typical group size</label>
            <input
              type="number"
              min={1}
              max={50}
              value={groupSize}
              onChange={(e) => setGroupSize(e.target.value)}
              placeholder="e.g. 3"
              className={input}
            />
          </div>
          <div>
            <label className={label}>Footprint on the land</label>
            <select
              value={footprint}
              onChange={(e) => setFootprint(e.target.value as Footprint | '')}
              className={input}
            >
              <option value="">Select…</option>
              {FOOTPRINTS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label} — {f.blurb}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 grid sm:grid-cols-2 gap-3">
          <Check label="Kids / family come along" checked={hasKidsFamily} onChange={setHasKidsFamily} />
          <Check label="I bring an ATV / UTV" checked={hasATV} onChange={setHasATV} />
          <Check label="Need a power hookup" checked={needsPowerHookup} onChange={setNeedsPowerHookup} />
          <Check label="Need a water hookup" checked={needsWaterHookup} onChange={setNeedsWaterHookup} />
        </div>
      </section>

      {/* Credentials */}
      <section className={card}>
        <h2 className="text-lg font-semibold text-stone-100 mb-1">Credentials</h2>
        <p className="text-sm text-stone-400 mb-4">
          Check the ones you hold. For now these are{' '}
          <span className="text-stone-200 font-medium">self-attested</span> — landowners
          see them labeled exactly that way. We do not verify or check them.
        </p>
        <div className="space-y-2">
          {CREDENTIAL_FIELDS.map((c) => (
            <label
              key={c.key}
              className="flex items-center justify-between gap-3 bg-stone-950 border border-stone-800 rounded-lg px-4 py-3 cursor-pointer"
            >
              <span className="text-stone-200">{c.label}</span>
              <span className="flex items-center gap-2 text-sm">
                <span className={creds[c.key] === 'SELF_ATTESTED' ? 'text-emerald-400' : 'text-stone-500'}>
                  {creds[c.key] === 'SELF_ATTESTED' ? 'Self-attested' : 'Not provided'}
                </span>
                <input
                  type="checkbox"
                  checked={creds[c.key] === 'SELF_ATTESTED'}
                  onChange={() => toggleCred(c.key)}
                  className="h-4 w-4 accent-emerald-500"
                />
              </span>
            </label>
          ))}
        </div>
      </section>

      {/* Safety gate */}
      <section className={card}>
        <h2 className="text-lg font-semibold text-stone-100 mb-1">Safety attestation</h2>
        <label className="flex items-start gap-3 mt-3 cursor-pointer">
          <input
            type="checkbox"
            checked={firearmAttestation}
            onChange={(e) => setFirearmAttestation(e.target.checked)}
            className="h-5 w-5 mt-0.5 accent-emerald-500"
          />
          <span className="text-stone-200 leading-relaxed">
            I attest that I have no firearm-related violations.
            <span className="block text-sm text-stone-400 mt-1">
              This is a <span className="font-medium text-stone-300">self-attestation</span>,
              not a background check. TFP does not run a third-party check on this.
            </span>
          </span>
        </label>
        {!firearmAttestation && (
          <p className="mt-3 text-sm text-amber-400/90 bg-amber-950/30 border border-amber-900/40 rounded-lg px-3 py-2">
            Heads up: until you check this box, your profile stays hidden from
            landowners. The attestation is required to appear in the pool.
          </p>
        )}
      </section>

      {/* References */}
      <section className={card}>
        <h2 className="text-lg font-semibold text-stone-100 mb-1">
          Prior-landowner references <span className="text-stone-500 font-normal">(optional)</span>
        </h2>
        <p className="text-sm text-stone-400 mb-4">
          Landowners you&apos;ve hunted for before. We keep contact details
          private — they are not shown openly while browsing.
        </p>
        <div className="space-y-4">
          {refs.map((r, i) => (
            <div key={i} className="bg-stone-950 border border-stone-800 rounded-lg p-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <input
                  value={r.name ?? ''}
                  onChange={(e) => updateRef(i, { name: e.target.value })}
                  placeholder="Name"
                  className={input}
                />
                <input
                  value={r.relationship ?? ''}
                  onChange={(e) => updateRef(i, { relationship: e.target.value })}
                  placeholder="Relationship (e.g. leased their farm 3 yrs)"
                  className={input}
                />
                <input
                  value={r.contact ?? ''}
                  onChange={(e) => updateRef(i, { contact: e.target.value })}
                  placeholder="Phone or email (kept private)"
                  className={input}
                />
                <input
                  value={r.note ?? ''}
                  onChange={(e) => updateRef(i, { note: e.target.value })}
                  placeholder="Note (optional)"
                  className={input}
                />
              </div>
              {refs.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRef(i)}
                  className="mt-2 text-sm text-stone-400 hover:text-red-400"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
        {refs.length < 5 && (
          <button
            type="button"
            onClick={addRef}
            className="mt-3 text-sm text-emerald-400 hover:text-emerald-300"
          >
            + Add another reference
          </button>
        )}
      </section>

      {/* Bio */}
      <section className={card}>
        <h2 className="text-lg font-semibold text-stone-100 mb-1">Who you are</h2>
        <p className="text-sm text-stone-400 mb-3">Freeform — who you are and how you hunt.</p>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={5}
          maxLength={2000}
          placeholder="Tell landowners about yourself, your crew, and how you treat the land you hunt…"
          className={input}
        />
        <div className="text-right text-xs text-stone-500 mt-1">{bio.length}/2000</div>
      </section>

      {/* Visibility + submit */}
      <section className={card}>
        <Check
          label="Show my profile to landowners browsing the hunter pool"
          checked={visible}
          onChange={setVisible}
        />
        <p className="text-xs text-stone-500 mt-1 ml-7">
          Your profile appears only when this is on AND your firearm attestation is checked.
        </p>

        {msg && (
          <p
            className={`mt-4 text-sm rounded-lg px-3 py-2 ${
              msg.kind === 'ok'
                ? 'text-emerald-300 bg-emerald-950/30 border border-emerald-900/40'
                : 'text-red-300 bg-red-950/30 border border-red-900/40'
            }`}
          >
            {msg.text}
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="mt-4 w-full sm:w-auto inline-flex items-center justify-center bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white px-6 py-3 rounded-lg font-medium transition-colors"
        >
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </section>
    </form>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-emerald-500"
      />
      <span className="text-stone-200">{label}</span>
    </label>
  );
}
