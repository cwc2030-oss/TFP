-- ============================================================================
-- 004_fix_stand_journal.sql — Align user_stand_journal with sit-pins pattern
-- ============================================================================
-- The app does NOT use Supabase Auth — user identity comes from NextAuth
-- (CUID strings like "cmod2hjtj0004ng08g788m5tm") and DB access is via a
-- service-role pg pool (see lib/spatial-db.ts). This matches the pattern in
-- public.user_sit_pins, where user_id is TEXT and RLS is disabled because
-- authorization is enforced at the API layer.
--
-- The original 003_stand_journal.sql used uuid + FK to auth.users + RLS,
-- which is incompatible with the rest of the app. This migration corrects it.
-- ============================================================================

-- Drop the RLS policy and disable RLS (security enforced in API layer).
DROP POLICY IF EXISTS "Users manage own journal entries" ON public.user_stand_journal;
ALTER TABLE public.user_stand_journal DISABLE ROW LEVEL SECURITY;

-- Drop the FK to auth.users (app does not use Supabase Auth).
ALTER TABLE public.user_stand_journal
  DROP CONSTRAINT IF EXISTS user_stand_journal_user_id_fkey;

-- Change user_id from uuid → text to match NextAuth CUID strings.
-- (Table is empty — this does not drop data.)
ALTER TABLE public.user_stand_journal
  ALTER COLUMN user_id TYPE text USING user_id::text;
