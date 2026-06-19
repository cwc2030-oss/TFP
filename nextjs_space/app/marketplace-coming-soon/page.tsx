"use client";

import { useState } from "react";
import Navbar from "@/components/navbar";
import { motion } from "framer-motion";
import { MapPin, Trees, Target, ArrowRight, CheckCircle, Loader2 } from "lucide-react";

type SignupSide = "HUNTER" | "LANDOWNER";

export default function MarketplaceComingSoon() {
  const [side, setSide] = useState<SignupSide | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [state, setState] = useState("");
  const [acres, setAcres] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!side || !email) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/marketplace-waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ side, email: email.trim(), name: name.trim(), state: state || undefined, acres: acres || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Something went wrong");
      setSubmitted(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-emerald-50/30 pt-20">
        {/* Hero */}
        <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-12 sm:pt-20 pb-8 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center gap-2 bg-emerald-100 text-emerald-800 px-4 py-1.5 rounded-full text-sm font-medium mb-6">
              <Target className="w-4 h-4" />
              Coming Soon
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-stone-900 tracking-tight leading-tight">
              The Marketplace for{" "}
              <span className="text-emerald-700">Data-Backed</span>{" "}
              Hunt Leases
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-stone-600 max-w-2xl mx-auto leading-relaxed">
              Every listing comes with a{" "}
              <span className="font-semibold text-emerald-700">Flow Score</span>{" "}
              — our proprietary deer-movement rating powered by terrain intelligence.
              No more guessing. Know exactly what you&apos;re leasing before you sign.
            </p>
          </motion.div>

          {/* Value props */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-3xl mx-auto"
          >
            {[
              { icon: Target, title: "Flow Score on Every Listing", desc: "Terrain-verified deer movement data, not just a pretty photo." },
              { icon: MapPin, title: "Verified Boundaries", desc: "Parcel-level accuracy so you know exactly what you're leasing." },
              { icon: Trees, title: "Habitat Intel", desc: "Bedding areas, funnels, and travel corridors mapped for each property." },
            ].map((item) => (
              <div key={item.title} className="bg-white rounded-xl p-6 shadow-sm border border-stone-100">
                <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center mb-3 mx-auto">
                  <item.icon className="w-5 h-5 text-emerald-700" />
                </div>
                <h3 className="font-semibold text-stone-900 text-sm">{item.title}</h3>
                <p className="text-stone-500 text-sm mt-1">{item.desc}</p>
              </div>
            ))}
          </motion.div>
        </section>

        {/* Signup Section */}
        <section className="max-w-xl mx-auto px-4 sm:px-6 pb-24">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.35 }}
            className="bg-white rounded-2xl shadow-lg border border-stone-200 p-6 sm:p-8"
          >
            {submitted ? (
              <div className="text-center py-8">
                <CheckCircle className="w-12 h-12 text-emerald-600 mx-auto mb-4" />
                <h2 className="text-2xl font-bold text-stone-900 mb-2">You&apos;re on the list!</h2>
                <p className="text-stone-600">
                  {side === "HUNTER"
                    ? "We'll email you the moment leases go live."
                    : "We'll reach out soon to get your property set up."}
                </p>
              </div>
            ) : (
              <>
                <h2 className="text-xl font-bold text-stone-900 text-center mb-1">Get Early Access</h2>
                <p className="text-stone-500 text-center text-sm mb-6">Choose your path below</p>

                {/* Side picker */}
                <div className="grid grid-cols-2 gap-3 mb-6">
                  <button
                    type="button"
                    onClick={() => setSide("HUNTER")}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${
                      side === "HUNTER"
                        ? "border-emerald-600 bg-emerald-50 shadow-sm"
                        : "border-stone-200 hover:border-stone-300"
                    }`}
                  >
                    <Target className={`w-5 h-5 mb-2 ${side === "HUNTER" ? "text-emerald-700" : "text-stone-400"}`} />
                    <div className={`font-semibold text-sm ${side === "HUNTER" ? "text-emerald-800" : "text-stone-700"}`}>I&apos;m a Hunter</div>
                    <div className="text-xs text-stone-500 mt-0.5">Notify me when leases go live</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSide("LANDOWNER")}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${
                      side === "LANDOWNER"
                        ? "border-emerald-600 bg-emerald-50 shadow-sm"
                        : "border-stone-200 hover:border-stone-300"
                    }`}
                  >
                    <Trees className={`w-5 h-5 mb-2 ${side === "LANDOWNER" ? "text-emerald-700" : "text-stone-400"}`} />
                    <div className={`font-semibold text-sm ${side === "LANDOWNER" ? "text-emerald-800" : "text-stone-700"}`}>I Own Land</div>
                    <div className="text-xs text-stone-500 mt-0.5">List your ground — be first in line</div>
                  </button>
                </div>

                {side && (
                  <motion.form
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    transition={{ duration: 0.3 }}
                    onSubmit={handleSubmit}
                    className="space-y-4"
                  >
                    <div>
                      <label htmlFor="name" className="block text-sm font-medium text-stone-700 mb-1">Name</label>
                      <input
                        id="name"
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Your name"
                        className="w-full px-4 py-2.5 rounded-lg border border-stone-300 text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                      />
                    </div>
                    <div>
                      <label htmlFor="email" className="block text-sm font-medium text-stone-700 mb-1">Email <span className="text-red-500">*</span></label>
                      <input
                        id="email"
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="w-full px-4 py-2.5 rounded-lg border border-stone-300 text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                      />
                    </div>
                    <div>
                      <label htmlFor="state" className="block text-sm font-medium text-stone-700 mb-1">
                        {side === "HUNTER" ? "State(s) you're interested in" : "State where your land is"}
                      </label>
                      <input
                        id="state"
                        type="text"
                        value={state}
                        onChange={(e) => setState(e.target.value)}
                        placeholder={side === "HUNTER" ? "e.g. Missouri, Kansas" : "e.g. Missouri"}
                        className="w-full px-4 py-2.5 rounded-lg border border-stone-300 text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                      />
                    </div>
                    {side === "LANDOWNER" && (
                      <div>
                        <label htmlFor="acres" className="block text-sm font-medium text-stone-700 mb-1">Approximate Acreage</label>
                        <input
                          id="acres"
                          type="text"
                          value={acres}
                          onChange={(e) => setAcres(e.target.value)}
                          placeholder="e.g. 200"
                          className="w-full px-4 py-2.5 rounded-lg border border-stone-300 text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                        />
                      </div>
                    )}

                    {error && (
                      <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
                    )}

                    <button
                      type="submit"
                      disabled={loading || !email}
                      className="w-full bg-emerald-700 hover:bg-emerald-800 disabled:bg-stone-300 text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      {loading ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <>
                          {side === "HUNTER" ? "Notify Me" : "Get My Land Listed"}
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </motion.form>
                )}
              </>
            )}
          </motion.div>
        </section>
      </main>
    </>
  );
}
