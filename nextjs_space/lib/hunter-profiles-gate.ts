/**
 * Hunter Trust Profile launch switch (Brick 1 of the vetted-introduction
 * marketplace).
 *
 * The hunter profile create/edit form, the owner browse-and-choose view, and
 * all of their API routes are walled off until launch. This module is the
 * single switch that opens them. It is SEPARATE from the marketplace gate
 * (lib/marketplace-gate.ts), which is already open (r10) — we are not exposing
 * half-built trust profiles just because the lease marketplace is live.
 *
 * Closed by default. Only opens when TFP_HUNTER_PROFILES_OPEN is explicitly
 * set to the string "true". Any other value (unset, "false", "1", "yes",
 * "TRUE", ...) keeps it closed, so we can never accidentally launch by
 * fat-fingering the env var.
 *
 * To launch: set TFP_HUNTER_PROFILES_OPEN=true and redeploy. No code change
 * required — the gate is read at request time in Node server components and
 * route handlers (not inlined at build time). Intentionally NOT read in edge
 * middleware.
 */

/** True only when hunter profiles have been explicitly opened for launch. */
export function areHunterProfilesOpen(): boolean {
  return process.env.TFP_HUNTER_PROFILES_OPEN === 'true';
}

/** Where gated hunter-profile pages send visitors while we're closed. */
export const HUNTER_PROFILES_COMING_SOON_PATH = '/marketplace-coming-soon';
