/**
 * County Deer Flow launch switch.
 *
 * The county-level "Deer Flow" browsing page (/deer-flow) — which ranks
 * counties by an aggregated Deer Flow Index, including many "not rated"
 * counties — is hidden behind this flag until we have deeper county data.
 * The code is intentionally preserved; we ARE coming back to it.
 *
 * Hidden by default. The county page only appears when
 * TFP_DEERFLOW_COUNTY_ENABLED is explicitly set to the string "true". Any
 * other value (unset, "false", "1", "yes", "TRUE", ...) keeps it hidden, so
 * we can never accidentally expose it by fat-fingering the env var.
 *
 * To bring it back: set TFP_DEERFLOW_COUNTY_ENABLED=true and redeploy. No
 * code change required — the gate is read at request time in Node server
 * components and route handlers (mirrors the marketplace gate), not inlined
 * at build time.
 *
 * IMPORTANT: This ONLY gates the county-data browsing tab/page. The in-map
 * Deer Flow layer (green/blue corridors on a parcel) is the core product and
 * is unaffected by this flag.
 */

/** True only when the county Deer Flow page has been explicitly enabled. */
export function isCountyDeerFlowEnabled(): boolean {
  return process.env.TFP_DEERFLOW_COUNTY_ENABLED === 'true';
}
