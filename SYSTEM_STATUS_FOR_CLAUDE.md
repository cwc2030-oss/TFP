# Terra Firma Partners — System Status (for Claude)
_Prepared for hand-off · focus: Marketplace launch readiness_

> Terminology note for the reader: this is a modern full-stack web app hosted on the
> Abacus AI platform. Canonical domain **terrafirma.partners** (10 additional mirror
> hostnames 301-redirect to it). Do NOT name the underlying framework in user-facing copy.

---

## 1. What the Marketplace is

A hunt-lease marketplace where **landowners list their ground** and **hunters find leases**.
Every listing is *anchored to a Saved Property* (a Territory the owner already analyzed with
the Terrain Brain), so each listing carries a certified terrain score / Deer Flow grade —
that certification is the trust differentiator.

**Two audiences, two entry pages:**
- `/lease-your-land` — landowner intent (list ground)
- `/find-a-lease` — hunter intent (browse leases)

---

## 2. Current gating status (IMPORTANT — marketplace is NOT open yet)

The public marketplace is intentionally **gated behind "coming soon"** until launch:
- `/find-a-lease` and `/listings` → redirect to `/marketplace-coming-soon`
- `/brokers` → redirects to `/` (307)
- The owner-side listing wizard (`/dashboard/listings/**`) is **reachable** so owners can
  build drafts now; the *public* browse/inquiry surface is what's gated.

**This gate is the single switch that "opens" the marketplace.** Flipping it is the launch event.

---

## 3. Listing lifecycle & the creation wizard

**Statuses:** `DRAFT → PENDING_REVIEW → PUBLISHED → LEASED / WITHDRAWN / EXPIRED` (with Relist).
Auto-approve is ON by default (`TFP_LISTINGS_AUTO_APPROVE` defaults to true), so publish goes
straight to PUBLISHED for the MVP. Set the env var to `false` to require manual moderation.

**Wizard (server-persisted, per step):**
1. **Step 1** — pick the anchoring Saved Property → creates a DRAFT → redirect to step 2.
2. **Step 2** — lease terms (state, county, price min/max, lease type, max hunters, seasons, amenities).
3. **Step 3** — photos (up to 6), title, description, contact method/email/phone.
4. **Step 4** — Review & Publish checklist (the "verification screen").

**Persistence model (verified in code):**
- Each step saves to the database when the user clicks a Save button.
- **Photos upload immediately** to cloud storage AND write to the listing record on upload
  (`POST /api/listings/[id]/photos` calls a DB update). Delete & reorder persist immediately too.
- The step-4 checklist's **"Fix →"** links jump to the relevant step, which re-loads its values
  from the database. So a completed step's data is retained across the round-trip.

**Publish requirements (enforced both client-side checklist and server-side `validateForPublish`):**
anchored Saved Property · state · county · asking price min > 0 · asking price max ≥ min ·
lease type · max hunters ≥ 1 · ≥ 1 season · description ≥ 30 chars · ≥ 1 photo ·
contact method (+ email and/or phone to match the chosen method).

---

## 4. OPSEC rules (do not violate)

Listings must NEVER expose precise location. Safe-to-surface fields only:
Deer Flow index/grade, terrain score, acres, **county/state (finest grain — never centroid lat/lng)**,
primary movement, funnel/corridor/intercept counts, bed acres, amenities, lease type,
season availability, hunters max, price. The listing snapshots these OPSEC-safe fields at publish.
The PATCH route rejects any field outside its allowlist. Never expose centroid lat/lng or the parcels JSON.

---

## 5. Money / commercial state

- **Listing is FREE for the 2026 launch** — no fee code, no charge on create/publish.
- **Founding Properties** (first 50) get free listing for life (in writing).
- **Commission model (8% / 4%) and payments/escrow are ON HOLD with attorneys — do NOT build
  payments/escrow yet.** No marketplace transaction layer exists.
- Existing Stripe (separate from marketplace): $19 parcel unlock, Pro $99/yr, Pro Max $199/yr — all LIVE.
- The old $350 / $149 / $49 one-time reports are DISCONTINUED (endpoints return 410 Gone).

---

## 6. Inquiry flow (hunter → landowner)

- `POST /api/listings/[id]/inquire` captures hunter interest against a published listing.
- Owner sees inquiries at `/dashboard/inquiries` (status-managed).
- A three-tier Deer Flow gated funnel + an "accepted-lessee" gate control access to the deeper
  Terrain Brain data on a listing (buyers don't get full terrain intel until appropriate).

---

## 7. Known / open item flagged by owner (listing form data-loss complaint)

Owner reports: on the pre-publish verification screen, if the form is incomplete you "have to
start all over and re-enter pics."

**Code review finding (honest):** in the current codebase this should NOT happen — photos persist
to storage + DB the instant they're uploaded, and each completed step is saved server-side, so the
"Fix →" round-trip reloads saved data rather than blanking it. The genuine residual loss vector is
**unsaved *text* fields** (lease terms / description / contact) if the user leaves a step via the
browser Back button or a nav link *without* clicking that step's Save button — those live in local
form state until Save. Recommended hardening: (a) an "unsaved changes" guard before navigating away
from a dirty step, and/or (b) debounced auto-save of text fields. This is a UX-robustness fix, not a
storage bug. Exact repro from the owner (which fields vanish; live site vs. preview; resuming the
existing draft vs. starting a new one) will confirm which path to harden.

---

## 8. Launch-readiness checklist (Marketplace)

**Done / working:** owner listing wizard (all 4 steps), immediate photo upload + reorder,
publish validation (client + server), lifecycle transitions, inquiry capture, OPSEC field
allowlist, Deer Flow certification snapshot on publish, terrain-flow snapshot at publish.

**Open before opening the gate:**
1. Decide + flip the `/find-a-lease` `/listings` `/brokers` gate (the launch switch).
2. Harden the listing form against unsaved-text-field loss (owner's flagged pain point).
3. Confirm auto-approve vs. manual moderation policy for launch.
4. Payments/commission remain parked with attorneys — launch is list-and-connect only (no escrow).
5. Seed enough real published listings so the browse page isn't empty on day one.
