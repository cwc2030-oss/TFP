/**
 * Deterministic seeded PRNG for terrain analysis.
 * Uses mulberry32 — a fast 32-bit PRNG with good distribution.
 * Extracted to avoid circular imports between terrain-flow and terrain-flow-v3.
 *
 * v2.3: Factory-based API — `createSeededRng()` returns a local instance so
 * concurrent analysis runs cannot corrupt each other's sequences. The module-
 * level `sRand()` / `nextFlowId()` wrappers delegate to the *active* instance
 * for backward compatibility with terrain-flow-v3 call sites.
 */

export interface SeededRng {
  /** Deterministic random [0, 1). */
  random(): number;
  /** Deterministic incrementing flow ID counter. */
  nextFlowId(): number;
}

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
 * Create a new isolated RNG instance seeded from a parcel centroid.
 * Each call returns an independent instance — safe for concurrent use.
 */
export function createSeededRng(centroid: [number, number]): SeededRng {
  const s = Math.round((centroid[0] + 180) * 1e6) * 360 + Math.round((centroid[1] + 90) * 1e6);
  const rng = mulberry32(s);
  let flowIdCounter = 0;
  return {
    random: rng,
    nextFlowId: () => ++flowIdCounter,
  };
}

// ── Global active instance (backward compat for sRand() / nextFlowId()) ──
let _activeRng: SeededRng | null = null;

/**
 * Set the active RNG instance that `sRand()` and `nextFlowId()` delegate to.
 * Call this at the top of each generation function right after `createSeededRng()`.
 */
export function setActiveRng(rng: SeededRng): void {
  _activeRng = rng;
}

/**
 * Legacy: Seed the global PRNG from parcel centroid.
 * Internally creates a new instance and sets it as active.
 * Prefer `createSeededRng()` + `setActiveRng()` for explicit ownership.
 */
export function seedRng(centroid: [number, number]): void {
  _activeRng = createSeededRng(centroid);
}

/** Deterministic random [0, 1) — delegates to the active instance. */
export function sRand(): number {
  if (!_activeRng) throw new Error('seedRng() or setActiveRng() not called');
  return _activeRng.random();
}

/** Deterministic incrementing flow ID — delegates to the active instance. */
export function nextFlowId(): number {
  if (!_activeRng) throw new Error('seedRng() or setActiveRng() not called');
  return _activeRng.nextFlowId();
}
