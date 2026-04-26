'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CONTACT_METHODS } from '@/lib/listings';

interface Initial {
  title: string | null;
  description: string | null;
  photos: string[];
  contactMethod: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

export default function ContentContactForm({
  listingId,
  initial,
}: {
  listingId: string;
  initial: Initial;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title ?? '');
  const [description, setDescription] = useState(initial.description ?? '');
  const [photos, setPhotos] = useState<string[]>(initial.photos);
  const [photoInput, setPhotoInput] = useState('');
  const [contactMethod, setContactMethod] = useState<string>(
    initial.contactMethod ?? '',
  );
  const [contactEmail, setContactEmail] = useState(initial.contactEmail ?? '');
  const [contactPhone, setContactPhone] = useState(initial.contactPhone ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function addPhoto() {
    const url = photoInput.trim();
    if (!url) return;
    if (photos.length >= 6) {
      setErr('Max 6 photos.');
      return;
    }
    if (!url.includes('listings/')) {
      setErr('Photos must be uploaded under the listings/ prefix.');
      return;
    }
    setPhotos([...photos, url]);
    setPhotoInput('');
    setErr(null);
  }
  function removePhoto(i: number) {
    setPhotos(photos.filter((_, idx) => idx !== i));
  }

  async function save(returnTo: 'index' | 'step2') {
    setSubmitting(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        title: title || null,
        description: description || null,
        photos,
        contactMethod: contactMethod || null,
        contactEmail: contactEmail || null,
        contactPhone: contactPhone || null,
      };
      const res = await fetch(`/api/listings/${listingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      if (returnTo === 'step2') {
        router.push(`/listings/${listingId}/edit?step=2`);
      } else {
        router.push('/listings');
      }
    } catch (e: any) {
      setErr(e.message ?? 'Save failed');
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save('index');
      }}
      className="space-y-6"
    >
      <Field label="Title (optional)">
        <input
          type="text"
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder='e.g. "160 ac timber + draws, 4-mile river bottom"'
          className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-stone-100 focus:border-emerald-500 focus:outline-none"
        />
      </Field>

      <Field label={`Description (max 500 chars) — ${description.length}/500`}>
        <textarea
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          placeholder="Briefly describe terrain, access, what makes this hunt special. Avoid precise location details."
          className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-stone-100 focus:border-emerald-500 focus:outline-none resize-y"
        />
      </Field>

      <Field label={`Photos — ${photos.length}/6 (must use listings/ prefix)`}>
        <div className="space-y-2">
          {photos.map((p, i) => (
            <div
              key={i}
              className="flex items-center gap-2 bg-stone-900 border border-stone-800 rounded-lg px-3 py-2"
            >
              <span className="text-stone-300 text-sm font-mono truncate flex-1">
                {p}
              </span>
              <button
                type="button"
                onClick={() => removePhoto(i)}
                className="text-red-400 hover:text-red-300 text-sm"
              >
                Remove
              </button>
            </div>
          ))}
          {photos.length < 6 && (
            <div className="flex gap-2">
              <input
                type="url"
                value={photoInput}
                onChange={(e) => setPhotoInput(e.target.value)}
                placeholder="https://i.vimeocdn.com/video/1628524257-3221ebe08bfc6a5626f014a17475821a801a4364a9255e9f304b7f22f87358ee-d?f=webp"
                className="flex-1 bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-stone-100 focus:border-emerald-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={addPhoto}
                className="bg-stone-700 hover:bg-stone-600 text-stone-100 px-4 py-2 rounded-lg"
              >
                Add
              </button>
            </div>
          )}
        </div>
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Contact method">
          <select
            value={contactMethod}
            onChange={(e) => setContactMethod(e.target.value)}
            className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-stone-100 focus:border-emerald-500 focus:outline-none"
          >
            <option value="">—</option>
            {CONTACT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m.replace('_', ' ')}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Contact email">
          <input
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-stone-100 focus:border-emerald-500 focus:outline-none"
          />
        </Field>
        <Field label="Contact phone">
          <input
            type="tel"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-stone-100 focus:border-emerald-500 focus:outline-none"
          />
        </Field>
      </div>

      {err && <p className="text-red-400 text-sm">{err}</p>}

      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        <button
          type="button"
          disabled={submitting}
          onClick={() => save('step2')}
          className="inline-flex items-center justify-center bg-stone-800 hover:bg-stone-700 disabled:opacity-50 text-stone-200 px-6 py-3 rounded-lg font-medium transition-colors"
        >
          ← Back to lease terms
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center justify-center bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-medium transition-colors"
        >
          {submitting ? 'Saving…' : 'Save draft'}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-stone-400 text-sm mb-1">{label}</span>
      {children}
    </label>
  );
}
