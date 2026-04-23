-- ============================================================================
-- 002_user_sit_pins.sql — Custom Sit Pins (Pro feature)
-- ============================================================================
-- Pro-tier users can drop their own stand pins on the intel map. Pins are
-- grouped per parcel (parcel_id is the Regrid-style identifier used by the
-- intel page) and scoped per user (user_id is the NextAuth user.id, which
-- lives in the primary Abacus-hosted Postgres — not FK'd here).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.user_sit_pins (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT         NOT NULL,
  parcel_id   TEXT         NOT NULL,
  name        VARCHAR(20)  NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  lat         DOUBLE PRECISION NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Fast load-by-parcel query: "all my pins on this parcel"
CREATE INDEX IF NOT EXISTS user_sit_pins_user_parcel_idx
  ON public.user_sit_pins (user_id, parcel_id);

-- Index on user alone for future "all my pins" views
CREATE INDEX IF NOT EXISTS user_sit_pins_user_idx
  ON public.user_sit_pins (user_id);
