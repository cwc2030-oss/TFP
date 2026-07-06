'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import Navbar from '@/components/navbar';
import { CheckCircle2, Shield, MapPin, Star, ChevronDown } from 'lucide-react';

/* ── Hero image config (swap this one line when Clark sends a drone shot) ── */
const HERO_IMAGE = '/sunset-field.jpg';

const FOUNDING_CAP = 50;

type FormState = 'idle' | 'submitting' | 'success' | 'error';
type WaitlistState = 'idle' | 'submitting' | 'success' | 'error';

export default function FoundingPropertyLanding() {
  const [personalCount, setPersonalCount] = useState<number | null>(null);
  const [formState, setFormState] = useState<FormState>('idle');
  const [waitlistState, setWaitlistState] = useState<WaitlistState>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // Form fields
  const [firstName, setFirstName] = useState('');
  const [email, setEmail] = useState('');
  const [state, setState] = useState('');
  const [acreage, setAcreage] = useState('');
  const [landownerType, setLandownerType] = useState('');

  // Waitlist fields
  const [wlFirstName, setWlFirstName] = useState('');
  const [wlEmail, setWlEmail] = useState('');
  const [wlState, setWlState] = useState('');

  useEffect(() => {
    fetch('/api/founding-property-signup')
      .then((r) => r.json())
      .then((d) => setPersonalCount(d.count ?? 0))
      .catch(() => setPersonalCount(0));
  }, []);

  const isCapped = personalCount !== null && personalCount >= FOUNDING_CAP;

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setFormState('submitting');
    setErrorMsg('');
    try {
      const res = await fetch('/api/founding-property-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: firstName,
          email,
          state,
          approx_acreage: acreage,
          landowner_type: landownerType,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setFormState('success');
      } else {
        setErrorMsg(data.message || 'Something went wrong.');
        setFormState('error');
      }
    } catch {
      setErrorMsg('Network error. Please try again.');
      setFormState('error');
    }
  }

  async function handleWaitlist(e: React.FormEvent) {
    e.preventDefault();
    setWaitlistState('submitting');
    setErrorMsg('');
    try {
      const res = await fetch('/api/launch-waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: wlFirstName,
          email: wlEmail,
          state: wlState,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setWaitlistState('success');
      } else {
        setErrorMsg(data.message || 'Something went wrong.');
        setWaitlistState('error');
      }
    } catch {
      setErrorMsg('Network error. Please try again.');
      setWaitlistState('error');
    }
  }

  function scrollToForm() {
    document.getElementById('signup-form')?.scrollIntoView({ behavior: 'smooth' });
  }

  return (
    <div className="min-h-screen bg-[#faf8f3]">
      <Navbar />

      {/* ══════ HERO ══════ */}
      <section className="relative pt-28 pb-20 sm:pt-36 sm:pb-28 overflow-hidden">
        {/* Faint topo contour texture */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='200' height='200' xmlns='https://www.shutterstock.com/image-vector/abstract-symmetrical-pattern-consisting-smooth-260nw-2718490077.jpg d='M0 80 Q50 60 100 80 T200 80' fill='none' stroke='%23554433' stroke-width='0.8'/%3E%3Cpath d='M0 120 Q50 100 100 120 T200 120' fill='none' stroke='%23554433' stroke-width='0.6'/%3E%3Cpath d='M0 160 Q60 140 120 160 T200 155' fill='none' stroke='%23554433' stroke-width='0.5'/%3E%3Cpath d='M0 40 Q40 25 80 40 T160 38 200 42' fill='none' stroke='%23554433' stroke-width='0.4'/%3E%3C/svg%3E")`,
            backgroundSize: '200px 200px',
          }}
        />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl font-bold text-stone-800 leading-[1.1] tracking-tight">
            Your hunting land deserves better than Facebook.
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-stone-600 max-w-2xl mx-auto leading-relaxed">
            Be one of the first 50 Founding Properties on the TFP Hunting Marketplace — Terrain Certified, free listing for life, never pay the 4% landowner fee, and connected to vetted hunters who&apos;ll treat your land like it&apos;s theirs.
          </p>
          <button
            onClick={scrollToForm}
            className="mt-8 inline-flex items-center justify-center bg-emerald-700 hover:bg-emerald-800 text-white px-8 py-3.5 rounded-lg font-semibold text-lg transition-colors shadow-lg shadow-emerald-900/20"
          >
            Claim My Founding Property Spot
          </button>
          <p className="mt-3 text-sm text-stone-500">
            Limited to 50 individual landowners. Bow season opens September 15.
          </p>
        </div>
      </section>

      {/* ══════ FOUR THINGS ══════ */}
      <section className="py-16 sm:py-24 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-2xl sm:text-3xl lg:text-4xl font-bold text-stone-800 text-center mb-14">
            Founding Properties get the four things every landowner actually wants.
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12">
            {[
              {
                icon: <Star className="w-6 h-6 text-amber-600" />,
                title: 'Free listing. Forever.',
                body: "Every Founding Property gets a permanent free listing on TFP. After bow season we'll start charging new landowners — you don't pay, ever. In writing.",
              },
              {
                icon: <MapPin className="w-6 h-6 text-emerald-700" />,
                title: 'Terrain Certified status.',
                body: "We send Terrain Brain — our terrain analysis engine — across your entire property and produce a hunter-grade map of deer flow, bedding areas, saddles, and stand placements. Then we walk it with you. You get a beautiful map for the cabin wall; hunters get proof your land delivers.",
              },
              {
                icon: <CheckCircle2 className="w-6 h-6 text-emerald-700" />,
                title: 'Featured placement at launch.',
                body: "When the marketplace opens to the public, the first thing every hunter sees is the Founding Properties. You're the front page — not buried behind a thousand corporate listings.",
              },
              {
                icon: <Shield className="w-6 h-6 text-stone-700" />,
                title: 'Hunters who respect your land.',
                body: 'Every lessee on TFP signs a conduct agreement, carries hunting-liability insurance, and is verified before they ever set foot on your property. No Facebook randoms. No "I\'ll be there next weekend with eight buddies."',
              },
            ].map((item) => (
              <div key={item.title} className="flex gap-4">
                <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-stone-100 flex items-center justify-center">
                  {item.icon}
                </div>
                <div>
                  <h3 className="font-serif text-xl font-bold text-stone-800 mb-2">{item.title}</h3>
                  <p className="text-stone-600 leading-relaxed">{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════ WHY 50 ══════ */}
      <section className="py-16 sm:py-24 bg-[#faf8f3]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-2xl sm:text-3xl lg:text-4xl font-bold text-stone-800 text-center mb-8">
            Why we&apos;re only doing 50.
          </h2>
          <div className="space-y-6 text-stone-600 leading-relaxed text-lg">
            <p>
              This isn&apos;t a marketing trick. We picked 50 because we want to know every Founding Property owner personally — by name, by phone call, by the shape of your land. Once we&apos;re past 50, we can&apos;t promise that anymore.
            </p>
            <p>
              We&apos;re launching the marketplace ahead of bow season — September 15, 2026. After that, listings open up, including to commercial hunting outfits. Founding Properties stay separate. You&apos;ll always be in the cohort that built this.
            </p>
            <p>
              Launching in four states first: Missouri, Kansas, Iowa, Oklahoma. If your land is somewhere else, sign up anyway — we&apos;ll come to you in batch 2.
            </p>
          </div>

          {/* Inline photo — "Why now" section */}
          <div className="mt-10 rounded-xl overflow-hidden shadow-lg">
            <div className="relative aspect-[16/9]">
              <Image
                src="/morning-mist.jpg"
                alt="Misty Missouri morning — country road at dawn with fog settling over farmland"
                fill
                className="object-cover"
                sizes="(max-width: 768px) 100vw, 700px"
                priority
              />
            </div>
          </div>
        </div>
      </section>

      {/* ══════ FORM / CAP SECTION ══════ */}
      <section id="signup-form" className="py-16 sm:py-24 bg-white">
        <div className="max-w-2xl mx-auto px-4 sm:px-6">
          {personalCount === null ? (
            <div className="text-center py-12">
              <div className="w-8 h-8 border-2 border-stone-300 border-t-emerald-600 rounded-full animate-spin mx-auto" />
            </div>
          ) : isCapped ? (
            /* ── BATCH FULL ── */
            <div>
              <h2 className="font-serif text-2xl sm:text-3xl font-bold text-stone-800 text-center mb-4">
                Founding Property batch is full.
              </h2>
              <p className="text-stone-600 text-center text-lg mb-10 leading-relaxed">
                We&apos;ve hit our 50-property cap for the founding cohort. The marketplace opens to all properties on September 15, 2026. Join the launch waitlist below and we&apos;ll let you know the moment it&apos;s live.
              </p>

              {waitlistState === 'success' ? (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-8 text-center">
                  <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-3" />
                  <p className="text-emerald-800 font-semibold text-lg">You&apos;re on the list!</p>
                  <p className="text-emerald-700 mt-1">We&apos;ll reach out as soon as the marketplace opens.</p>
                </div>
              ) : (
                <form onSubmit={handleWaitlist} className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">First name</label>
                    <input
                      type="text"
                      required
                      maxLength={80}
                      value={wlFirstName}
                      onChange={(e) => setWlFirstName(e.target.value)}
                      className="w-full border border-stone-300 rounded-lg px-4 py-2.5 text-stone-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">Email</label>
                    <input
                      type="email"
                      required
                      value={wlEmail}
                      onChange={(e) => setWlEmail(e.target.value)}
                      className="w-full border border-stone-300 rounded-lg px-4 py-2.5 text-stone-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">State</label>
                    <div className="relative">
                      <select
                        required
                        value={wlState}
                        onChange={(e) => setWlState(e.target.value)}
                        className="w-full border border-stone-300 rounded-lg px-4 py-2.5 text-stone-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors appearance-none"
                      >
                        <option value="">Select state</option>
                        <option>Missouri</option>
                        <option>Kansas</option>
                        <option>Iowa</option>
                        <option>Oklahoma</option>
                        <option>Other</option>
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
                    </div>
                  </div>
                  {waitlistState === 'error' && (
                    <p className="text-red-600 text-sm">{errorMsg}</p>
                  )}
                  <button
                    type="submit"
                    disabled={waitlistState === 'submitting'}
                    className="w-full bg-emerald-700 hover:bg-emerald-800 disabled:bg-stone-400 text-white py-3 rounded-lg font-semibold text-lg transition-colors"
                  >
                    {waitlistState === 'submitting' ? 'Joining...' : 'Join the waitlist'}
                  </button>
                </form>
              )}
            </div>
          ) : (
            /* ── MAIN FORM ── */
            <div>
              <h2 className="font-serif text-2xl sm:text-3xl font-bold text-stone-800 text-center mb-3">
                Tell us about your land.
              </h2>
              <p className="text-stone-600 text-center text-base sm:text-lg mb-10 leading-relaxed">
                Founding Property slots are limited to 50. We&apos;re reviewing applications in the order they arrive, prioritizing MO/KS/IA/OK properties. You&apos;ll hear from Clark within a week.
              </p>

              {formState === 'success' ? (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-8 text-center">
                  <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-3" />
                  <p className="text-emerald-800 font-semibold text-lg">Thanks! Clark will reach out within a week.</p>
                  <p className="text-emerald-700 mt-1">Check your email for a confirmation.</p>
                </div>
              ) : (
                <form onSubmit={handleSignup} className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">First name</label>
                    <input
                      type="text"
                      required
                      maxLength={80}
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="w-full border border-stone-300 rounded-lg px-4 py-2.5 text-stone-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
                      placeholder="Your first name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">Email</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full border border-stone-300 rounded-lg px-4 py-2.5 text-stone-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
                      placeholder="you@example.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">State</label>
                    <div className="relative">
                      <select
                        required
                        value={state}
                        onChange={(e) => setState(e.target.value)}
                        className="w-full border border-stone-300 rounded-lg px-4 py-2.5 text-stone-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors appearance-none"
                      >
                        <option value="">Select state</option>
                        <option>Missouri</option>
                        <option>Kansas</option>
                        <option>Iowa</option>
                        <option>Oklahoma</option>
                        <option>Other</option>
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">Approximate acreage</label>
                    <input
                      type="text"
                      required
                      maxLength={40}
                      value={acreage}
                      onChange={(e) => setAcreage(e.target.value)}
                      className="w-full border border-stone-300 rounded-lg px-4 py-2.5 text-stone-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
                      placeholder='e.g. "about 120", "320", "~50 acres"'
                    />
                  </div>
                  <fieldset>
                    <legend className="block text-sm font-medium text-stone-700 mb-2">Type of ownership</legend>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <label
                        className={`flex items-center gap-3 border rounded-lg px-4 py-3 cursor-pointer transition-colors flex-1 ${
                          landownerType === 'personal'
                            ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/30'
                            : 'border-stone-300 hover:border-stone-400'
                        }`}
                      >
                        <input
                          type="radio"
                          name="landownerType"
                          value="personal"
                          required
                          checked={landownerType === 'personal'}
                          onChange={() => setLandownerType('personal')}
                          className="text-emerald-600 focus:ring-emerald-500"
                        />
                        <span className="text-stone-700">My personal/family land</span>
                      </label>
                      <label
                        className={`flex items-center gap-3 border rounded-lg px-4 py-3 cursor-pointer transition-colors flex-1 ${
                          landownerType === 'commercial'
                            ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/30'
                            : 'border-stone-300 hover:border-stone-400'
                        }`}
                      >
                        <input
                          type="radio"
                          name="landownerType"
                          value="commercial"
                          required
                          checked={landownerType === 'commercial'}
                          onChange={() => setLandownerType('commercial')}
                          className="text-emerald-600 focus:ring-emerald-500"
                        />
                        <span className="text-stone-700">Commercial operator</span>
                      </label>
                    </div>
                  </fieldset>

                  {formState === 'error' && (
                    <p className="text-red-600 text-sm">{errorMsg}</p>
                  )}

                  <button
                    type="submit"
                    disabled={formState === 'submitting'}
                    className="w-full bg-emerald-700 hover:bg-emerald-800 disabled:bg-stone-400 text-white py-3.5 rounded-lg font-semibold text-lg transition-colors shadow-lg shadow-emerald-900/15"
                  >
                    {formState === 'submitting' ? 'Submitting...' : "I'm in — claim my spot"}
                  </button>
                  <p className="text-center text-sm text-stone-500">
                    We&apos;ll never share your information. We won&apos;t list your property publicly without your written approval.
                  </p>
                </form>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ══════ FOOTER ══════ */}
      <footer className="py-10 bg-stone-900 text-stone-400">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center">
          <p className="text-sm">
            © 2026 Terra Firma Partners. Terrain Brain™ and Terrain Certified™ are trademarks of Terra Firma Partners.
          </p>
          <div className="mt-3 flex items-center justify-center gap-4 text-sm">
            <Link href="mailto:clark@terrafirma.partners" className="hover:text-stone-200 transition-colors">Contact</Link>
            <span className="text-stone-600">·</span>
            <Link href="/terms" className="hover:text-stone-200 transition-colors">Privacy</Link>
            <span className="text-stone-600">·</span>
            <Link href="/our-story" className="hover:text-stone-200 transition-colors">About</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
