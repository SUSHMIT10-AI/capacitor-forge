CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "p_select_own" ON public.profiles;
DROP POLICY IF EXISTS "p_insert_own" ON public.profiles;
DROP POLICY IF EXISTS "p_update_own" ON public.profiles;
CREATE POLICY "p_select_own" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "p_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "p_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
DROP TRIGGER IF EXISTS trg_profiles_updated ON public.profiles;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data ->> 'full_name');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ur_select_own" ON public.user_roles;
CREATE POLICY "ur_select_own" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE TABLE IF NOT EXISTS public.signing_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Default Key',
  key_alias TEXT NOT NULL,
  key_password TEXT NOT NULL,
  store_password TEXT NOT NULL,
  keystore_path TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signing_keys TO authenticated;
GRANT ALL ON public.signing_keys TO service_role;
ALTER TABLE public.signing_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sk_all_own" ON public.signing_keys;
CREATE POLICY "sk_all_own" ON public.signing_keys FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS trg_signing_keys_updated ON public.signing_keys;
CREATE TRIGGER trg_signing_keys_updated BEFORE UPDATE ON public.signing_keys
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.build_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'webview' CHECK (mode IN ('webview','capacitor')),
  url TEXT,
  app_name TEXT NOT NULL,
  package_name TEXT NOT NULL DEFAULT 'com.example.app',
  version_name TEXT NOT NULL DEFAULT '1.0.0',
  version_code INTEGER NOT NULL DEFAULT 1,
  icon_path TEXT,
  splash_color TEXT DEFAULT '#FFFFFF',
  theme_color TEXT DEFAULT '#FFFFFF',
  nav_color TEXT DEFAULT '#000000',
  orientation TEXT NOT NULL DEFAULT 'portrait' CHECK (orientation IN ('portrait','landscape','any')),
  admob_app_id TEXT,
  admob_banner_id TEXT,
  admob_interstitial_id TEXT,
  admob_rewarded_id TEXT,
  admob_rewarded_interstitial_id TEXT,
  admob_app_open_id TEXT,
  admob_test_mode BOOLEAN NOT NULL DEFAULT false,
  enable_admob BOOLEAN NOT NULL DEFAULT false,
  enable_billing BOOLEAN NOT NULL DEFAULT false,
  signing_key_id UUID REFERENCES public.signing_keys(id) ON DELETE SET NULL,
  project_zip_path TEXT,
  detected_plugins JSONB,
  sync_log TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','building','complete','failed')),
  codemagic_build_id TEXT,
  output_aab_path TEXT,
  output_apk_path TEXT,
  download_url TEXT,
  error_message TEXT,
  enable_capacitor BOOLEAN NOT NULL DEFAULT true,
  custom_html TEXT,
  custom_css TEXT,
  custom_js TEXT,
  build_type TEXT NOT NULL DEFAULT 'aab' CHECK (build_type IN ('aab','apk','both')),
  user_agent_override TEXT,
  enable_pull_to_refresh BOOLEAN NOT NULL DEFAULT true,
  enable_native_splash BOOLEAN NOT NULL DEFAULT true,
  enable_offline_page BOOLEAN NOT NULL DEFAULT true,
  enable_push_notifications BOOLEAN NOT NULL DEFAULT false,
  enable_camera BOOLEAN NOT NULL DEFAULT false,
  enable_microphone BOOLEAN NOT NULL DEFAULT false,
  enable_location BOOLEAN NOT NULL DEFAULT false,
  enable_storage BOOLEAN NOT NULL DEFAULT false,
  enable_sms BOOLEAN NOT NULL DEFAULT false,
  enable_contacts BOOLEAN NOT NULL DEFAULT false,
  enable_phone_state BOOLEAN NOT NULL DEFAULT false,
  enable_vibrate BOOLEAN NOT NULL DEFAULT true,
  enable_clipboard BOOLEAN NOT NULL DEFAULT true,
  enable_share BOOLEAN NOT NULL DEFAULT true,
  enable_biometric BOOLEAN NOT NULL DEFAULT false,
  enable_bluetooth BOOLEAN NOT NULL DEFAULT false,
  enable_nfc BOOLEAN NOT NULL DEFAULT false,
  enable_calendar BOOLEAN NOT NULL DEFAULT false,
  enable_file_download BOOLEAN NOT NULL DEFAULT true,
  enable_file_upload BOOLEAN NOT NULL DEFAULT true,
  enable_geolocation BOOLEAN NOT NULL DEFAULT false,
  block_screenshots BOOLEAN NOT NULL DEFAULT false,
  keep_screen_on BOOLEAN NOT NULL DEFAULT false,
  fullscreen_mode BOOLEAN NOT NULL DEFAULT false,
  hide_status_bar BOOLEAN NOT NULL DEFAULT false,
  allow_zoom BOOLEAN NOT NULL DEFAULT false,
  dark_mode_force BOOLEAN NOT NULL DEFAULT false,
  allow_external_links BOOLEAN NOT NULL DEFAULT true,
  cache_enabled BOOLEAN NOT NULL DEFAULT true,
  allow_cleartext BOOLEAN NOT NULL DEFAULT true,
  swipe_back_navigation BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.build_configs TO authenticated;
GRANT ALL ON public.build_configs TO service_role;
ALTER TABLE public.build_configs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bc_all_own" ON public.build_configs;
CREATE POLICY "bc_all_own" ON public.build_configs FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS trg_build_configs_updated ON public.build_configs;
CREATE TRIGGER trg_build_configs_updated BEFORE UPDATE ON public.build_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','complete','failed')),
  error_message TEXT,
  storage_path TEXT,
  output_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversions TO authenticated;
GRANT ALL ON public.conversions TO service_role;
ALTER TABLE public.conversions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cv_all_own" ON public.conversions;
CREATE POLICY "cv_all_own" ON public.conversions FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS trg_conversions_updated ON public.conversions;
CREATE TRIGGER trg_conversions_updated BEFORE UPDATE ON public.conversions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.play_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  package_name TEXT NOT NULL,
  product_id TEXT NOT NULL,
  purchase_token TEXT NOT NULL,
  order_id TEXT,
  purchase_state INTEGER,
  acknowledged BOOLEAN NOT NULL DEFAULT false,
  is_subscription BOOLEAN NOT NULL DEFAULT false,
  expiry_time_ms BIGINT,
  raw JSONB,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (package_name, purchase_token)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.play_purchases TO authenticated;
GRANT ALL ON public.play_purchases TO service_role;
ALTER TABLE public.play_purchases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pp_all_own" ON public.play_purchases;
CREATE POLICY "pp_all_own" ON public.play_purchases FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS trg_play_purchases_updated ON public.play_purchases;
CREATE TRIGGER trg_play_purchases_updated BEFORE UPDATE ON public.play_purchases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_play_purchases_user ON public.play_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_play_purchases_token ON public.play_purchases(purchase_token);

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.build_configs;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END $$;

DROP POLICY IF EXISTS "apk_upload_own" ON storage.objects;
DROP POLICY IF EXISTS "apk_select_own" ON storage.objects;
DROP POLICY IF EXISTS "apk_delete_own" ON storage.objects;
CREATE POLICY "apk_upload_own" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'apk-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "apk_select_own" ON storage.objects FOR SELECT
  USING (bucket_id = 'apk-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "apk_delete_own" ON storage.objects FOR DELETE
  USING (bucket_id = 'apk-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "asset_upload_own" ON storage.objects;
DROP POLICY IF EXISTS "asset_select_own" ON storage.objects;
DROP POLICY IF EXISTS "asset_delete_own" ON storage.objects;
CREATE POLICY "asset_upload_own" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'app-assets' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "asset_select_own" ON storage.objects FOR SELECT
  USING (bucket_id = 'app-assets' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "asset_delete_own" ON storage.objects FOR DELETE
  USING (bucket_id = 'app-assets' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "buildout_select_own" ON storage.objects;
DROP POLICY IF EXISTS "buildout_delete_own" ON storage.objects;
CREATE POLICY "buildout_select_own" ON storage.objects FOR SELECT
  USING (bucket_id = 'build-outputs' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "buildout_delete_own" ON storage.objects FOR DELETE
  USING (bucket_id = 'build-outputs' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "capproj_upload_own" ON storage.objects;
DROP POLICY IF EXISTS "capproj_select_own" ON storage.objects;
DROP POLICY IF EXISTS "capproj_update_own" ON storage.objects;
DROP POLICY IF EXISTS "capproj_delete_own" ON storage.objects;
CREATE POLICY "capproj_upload_own" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'capacitor-projects' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "capproj_select_own" ON storage.objects FOR SELECT
  USING (bucket_id = 'capacitor-projects' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "capproj_update_own" ON storage.objects FOR UPDATE
  USING (bucket_id = 'capacitor-projects' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "capproj_delete_own" ON storage.objects FOR DELETE
  USING (bucket_id = 'capacitor-projects' AND auth.uid()::text = (storage.foldername(name))[1]);

NOTIFY pgrst, 'reload schema';