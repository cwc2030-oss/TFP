'use client';

import { useState } from 'react';

export default function ShareLinkGenerator() {
  const [address, setAddress] = useState('');
  const [link, setLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    if (!address.trim()) return;
    setLoading(true);
    setError('');
    setLink('');
    setCopied(false);

    try {
      const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
      if (!apiKey) throw new Error('Google Maps API key not configured');

      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address.trim())}&key=${apiKey}`
      );
      const data = await res.json();

      if (data.status !== 'OK' || !data.results?.length) {
        throw new Error('Could not geocode that address. Try a more specific address.');
      }

      const { lat, lng } = data.results[0].geometry.location;
      const formatted = data.results[0].formatted_address || address.trim();
      const url = `https://terrafirma.partners/intel?lat=${lat}&lng=${lng}&address=${encodeURIComponent(formatted)}`;
      setLink(url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Geocoding failed');
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="min-h-screen bg-[#0a1f0a] flex items-center justify-center p-4">
      <div className="w-full max-w-xl bg-[#122912] border border-[#1e3d1e] rounded-2xl shadow-2xl p-8">
        <h1 className="text-2xl font-bold text-emerald-400 mb-1">🦌 Share Link Generator</h1>
        <p className="text-emerald-600 text-sm mb-6">Paste an address → get a shareable terrain intel link</p>

        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
            placeholder="e.g. 761 Schlessman Rd, Pineville, MO"
            className="flex-1 bg-[#0a1f0a] border border-[#2a4d2a] text-emerald-100 placeholder-emerald-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          />
          <button
            onClick={handleGenerate}
            disabled={loading || !address.trim()}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-5 py-3 rounded-lg text-sm transition-colors whitespace-nowrap"
          >
            {loading ? 'Geocoding…' : 'Generate Link'}
          </button>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-700/40 text-red-300 text-sm rounded-lg px-4 py-3 mb-4">
            {error}
          </div>
        )}

        {link && (
          <div className="bg-[#0a1f0a] border border-[#2a4d2a] rounded-lg p-4">
            <p className="text-emerald-500 text-xs font-medium mb-2 uppercase tracking-wide">Shareable Link</p>
            <p className="text-emerald-200 text-sm break-all font-mono leading-relaxed mb-3">{link}</p>
            <button
              onClick={handleCopy}
              className="bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {copied ? '✓ Copied!' : '📋 Copy Link'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
