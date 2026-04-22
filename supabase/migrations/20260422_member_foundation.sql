-- ============================================================
-- Member Foundation Migration
-- Creates: profiles, feature_access, watchlists, alert_rules
-- Plus: auto-create profile on user signup trigger
-- ============================================================

-- 1. profiles (1:1 with auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  user_id                UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name           TEXT,
  plan                   TEXT NOT NULL DEFAULT 'free'
                         CHECK (plan IN ('free', 'pro', 'premium')),
  stripe_customer_id     TEXT UNIQUE,
  stripe_subscription_id TEXT,
  plan_expires_at        TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);

-- 2. feature_access (per-user feature overrides, finer than plan)
CREATE TABLE IF NOT EXISTS feature_access (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  granted_at  TIMESTAMPTZ DEFAULT NOW(),
  expires_at  TIMESTAMPTZ,
  UNIQUE(user_id, feature_key)
);

-- 3. watchlists (user-managed stock watchlist)
CREATE TABLE IF NOT EXISTS watchlists (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  symbol   TEXT NOT NULL,
  notes    TEXT,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, symbol)
);

-- 4. alert_rules (user custom alert rules)
CREATE TABLE IF NOT EXISTS alert_rules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  symbol       TEXT,
  trigger_type TEXT NOT NULL DEFAULT 'signal_score',
  min_score    INT  DEFAULT 70,
  direction    TEXT DEFAULT 'both',
  channels     TEXT[] DEFAULT '{telegram}',
  active       BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_feature_access_user ON feature_access(user_id);
CREATE INDEX IF NOT EXISTS idx_watchlists_user     ON watchlists(user_id);
CREATE INDEX IF NOT EXISTS idx_watchlists_symbol   ON watchlists(symbol);
CREATE INDEX IF NOT EXISTS idx_alert_rules_user    ON alert_rules(user_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlists    ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_rules   ENABLE ROW LEVEL SECURITY;

-- profiles: read + update own row only
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
-- INSERT is handled by the trigger below (service-role context)

-- feature_access: read only (writes by service_role / admin)
CREATE POLICY "feature_access_select_own" ON feature_access FOR SELECT
  USING (auth.uid() = user_id);

-- watchlists: full self-management
CREATE POLICY "watchlists_self" ON watchlists FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- alert_rules: full self-management
CREATE POLICY "alert_rules_self" ON alert_rules FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── Auto-create profile on signup ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Drop if exists, then recreate
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ── Backfill existing users ───────────────────────────────────────────────────
-- Run once to create profiles for any users who signed up before this migration
INSERT INTO public.profiles (user_id)
SELECT id FROM auth.users
ON CONFLICT (user_id) DO NOTHING;
