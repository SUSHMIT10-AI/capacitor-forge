-- Add AdMob ad-unit IDs + test-mode flag to build_configs so the
-- builder can inject them into the generated app as window.__ADMOB_IDS__.
-- Run in the Supabase SQL editor of this project's backend.

ALTER TABLE public.build_configs
  ADD COLUMN IF NOT EXISTS admob_banner_id                text,
  ADD COLUMN IF NOT EXISTS admob_interstitial_id          text,
  ADD COLUMN IF NOT EXISTS admob_rewarded_id              text,
  ADD COLUMN IF NOT EXISTS admob_rewarded_interstitial_id text,
  ADD COLUMN IF NOT EXISTS admob_app_open_id              text,
  ADD COLUMN IF NOT EXISTS admob_test_mode                boolean NOT NULL DEFAULT false;
