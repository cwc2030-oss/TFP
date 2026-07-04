/**
 * Marketplace launch switch.
 *
 * The public hunt-lease marketplace — the browse page, the public listing
 * detail pages, the brokers page, and the hunter inquiry endpoint — is walled
 * off behind a "coming soon" page until launch. This module is the single
 * switch that opens it.
 *
 * Closed by default. The marketplace only opens when TFP_MARKETPLACE_OPEN is
 * explicitly set to the string "true". Any other value (unset, "false", "1",
 * "yes", "TRUE", …) keeps it closed, so we can never accidentally launch by
 * fat-fingering the env var.
 *
 * To launch: set TFP_MARKETPLACE_OPEN=true and redeploy. No code change
 * required — the gate is read at request time in Node server components and
 * route handlers (not inlined at build time).
 *
 * Note: intentionally NOT read in edge middleware. Edge middleware inlines
 * env vars at build time, which would defeat the runtime flip; gating lives
 * in the (Node-runtime) pages and API routes instead.
 */

/** True only when the marketplace has been explicitly opened for launch. */
export function isMarketplaceOpen(): boolean {
  return process.env.TFP_MARKETPLACE_OPEN === 'true';
}

/** Where gated public marketplace pages send visitors while we're closed. */
export const COMING_SOON_PATH = '/marketplace-coming-soon';
