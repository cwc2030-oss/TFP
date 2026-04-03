/**
 * Deterministic seeded PRNG for terrain analysis.
 * Uses mulberry32 — a fast 32-bit PRNG with good distribution.
 * Extracted to avoid circular imports between terrain-flow and terrain-flow-v3.
 */

let _seededRng: (() => number) | null = null;
let _flowIdCounter = 0;

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seed the PRNG from parcel centroid so results are deterministic per parcel.
 * Call once at the start of any generation function.
 */
export function seedRng(centroid: [number, number]): void {
  const s = Math.round((centroid[0] + 180) * 1e6) * 360 + Math.round((centroid[1] + 90) * 1e6);
  _seededRng = mulberry32(s);
  _flowIdCounter = 0;
}

/** Deterministic random [0, 1) — MUST call seedRng() first. */
export function sRand(): number {
  if (!_seededRng) throw new Error('seedRng() not called');
  return _seededRng();
}

/** Deterministic incrementing flow ID counter — resets with seedRng(). */
export function nextFlowId(): number {
  return ++_flowIdCounter;
}
