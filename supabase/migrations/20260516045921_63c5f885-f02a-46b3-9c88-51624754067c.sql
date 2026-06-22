-- Helper trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

-- conversions
CREATE TABLE IF NOT EXISTS public.conversions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  error_message TEXT,
  storage_path TEXT,
  output_path TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.conversions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own conversions" ON public.conversions;
DROP POLICY IF EXISTS "Users can create their own conversions" ON public.conversions;
DROP POLICY IF EXISTS "Users can delete their own conversions" ON public.conversions;
DROP POLICY IF EXISTS "Users can update their own conversions" ON public.conversions;
CREATE POLICY "Users can view their own conversions" ON public.conversions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own conversions" ON public.conversions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own conversions" ON public.conversions FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Users can update their own conversions" ON public.conversions FOR UPDATE USING (auth.uid() = user_id);
DROP TRIGGER IF EXISTS update_conversions_updated_at ON public.conversions;
CREATE TRIGGER update_conversions_updated_at BEFORE UPDATE ON public.conversions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- build_configs
CREATE TABLE IF NOT EXISTS public.build_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  app_name TEXT NOT NULL,
  package_name TEXT NOT NULL DEFAULT 'com.example.app',
  version_name TEXT NOT NULL DEFAULT '1.0.0',
  version_code INTEGER NOT NULL DEFAULT 1,
  icon_path TEXT,
  splash_color TEXT DEFAULT '#FFFFFF',
  theme_color TEXT DEFAULT '#FFFFFF',
  nav_color TEXT DEFAULT '#000000',
  orientation TEXT NOT NULL DEFAULT 'portrait' CHECK (orientation IN ('portrait', 'landscape', 'any')),
  admob_app_id TEXT,
  admob_banner_id TEXT,
  admob_interstitial_id TEXT,
  admob_rewarded_id TEXT,
  enable_billing BOOLEAN NOT NULL DEFAULT false,
  signing_key_id UUID,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'building', 'complete', 'failed')),
  output_aab_path TEXT,
  output_apk_path TEXT,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.signing_keys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Default Key',
  key_alias TEXT NOT NULL,
  key_password TEXT NOT NULL,
  store_password TEXT NOT NULL,
  keystore_path TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.build_configs
    ADD CONSTRAINT fk_signing_key FOREIGN KEY (signing_key_id)
    REFERENCES public.signing_keys(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.build_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signing_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own builds" ON public.build_configs;
DROP POLICY IF EXISTS "Users can create their own builds" ON public.build_configs;
DROP POLICY IF EXISTS "Users can update their own builds" ON public.build_configs;
DROP POLICY IF EXISTS "Users can delete their own builds" ON public.build_configs;
CREATE POLICY "Users can view their own builds" ON public.build_configs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own builds" ON public.build_configs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own builds" ON public.build_configs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own builds" ON public.build_configs FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own keys" ON public.signing_keys;
DROP POLICY IF EXISTS "Users can create their own keys" ON public.signing_keys;
DROP POLICY IF EXISTS "Users can update their own keys" ON public.signing_keys;
DROP POLICY IF EXISTS "Users can delete their own keys" ON public.signing_keys;
CREATE POLICY "Users can view their own keys" ON public.signing_keys FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own keys" ON public.signing_keys FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own keys" ON public.signing_keys FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own keys" ON public.signing_keys FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_build_configs_updated_at ON public.build_configs;
CREATE TRIGGER update_build_configs_updated_at BEFORE UPDATE ON public.build_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_signing_keys_updated_at ON public.signing_keys;
CREATE TRIGGER update_signing_keys_updated_at BEFORE UPDATE ON public.signing_keys
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES ('apk-uploads', 'apk-uploads', false) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('app-assets', 'app-assets', false) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('build-outputs', 'build-outputs', false) ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users can upload their own APKs" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their own APKs" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own APKs" ON storage.objects;
CREATE POLICY "Users can upload their own APKs" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'apk-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can view their own APKs" ON storage.objects FOR SELECT
  USING (bucket_id = 'apk-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can delete their own APKs" ON storage.objects FOR DELETE
  USING (bucket_id = 'apk-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Users can upload their own assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their own assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own assets" ON storage.objects;
CREATE POLICY "Users can upload their own assets" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'app-assets' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can view their own assets" ON storage.objects FOR SELECT
  USING (bucket_id = 'app-assets' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can delete their own assets" ON storage.objects FOR DELETE
  USING (bucket_id = 'app-assets' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Users can view their own build outputs" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own build outputs" ON storage.objects;
CREATE POLICY "Users can view their own build outputs" ON storage.objects FOR SELECT
  USING (bucket_id = 'build-outputs' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can delete their own build outputs" ON storage.objects FOR DELETE
  USING (bucket_id = 'build-outputs' AND auth.uid()::text = (storage.foldername(name))[1]);

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.build_configs;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END $$;

ALTER TABLE public.build_configs ADD COLUMN IF NOT EXISTS build_type text NOT NULL DEFAULT 'aab';
ALTER TABLE public.build_configs DROP CONSTRAINT IF EXISTS build_configs_build_type_check;
ALTER TABLE public.build_configs ADD CONSTRAINT build_configs_build_type_check CHECK (build_type IN ('aab', 'apk', 'both'));

ALTER TABLE public.build_configs
  ADD COLUMN IF NOT EXISTS custom_html text,
  ADD COLUMN IF NOT EXISTS custom_css text,
  ADD COLUMN IF NOT EXISTS custom_js text,
  ADD COLUMN IF NOT EXISTS enable_capacitor boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS enable_pull_to_refresh boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_native_splash boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_offline_page boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_push_notifications boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS enable_camera boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS enable_microphone boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS enable_location boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS enable_storage boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS enable_sms boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS enable_contacts boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS enable_phone_state boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS enable_vibrate boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_clipboard boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_share boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_biometric boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS enable_bluetooth boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS enable_nfc boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS enable_calendar boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS enable_file_download boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_file_upload boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_geolocation boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS block_screenshots boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS keep_screen_on boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fullscreen_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hide_status_bar boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_zoom boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dark_mode_force boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS user_agent_override text,
  ADD COLUMN IF NOT EXISTS allow_external_links boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cache_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_cleartext boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS swipe_back_navigation boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.play_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  package_name text NOT NULL,
  product_id text NOT NULL,
  purchase_token text NOT NULL,
  order_id text,
  purchase_state integer,
  acknowledged boolean NOT NULL DEFAULT false,
  is_subscription boolean NOT NULL DEFAULT false,
  expiry_time_ms bigint,
  raw jsonb,
  verified_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (package_name, purchase_token)
);
ALTER TABLE public.play_purchases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own purchases" ON public.play_purchases;
DROP POLICY IF EXISTS "Users can create their own purchases" ON public.play_purchases;
DROP POLICY IF EXISTS "Users can update their own purchases" ON public.play_purchases;
CREATE POLICY "Users can view their own purchases" ON public.play_purchases FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own purchases" ON public.play_purchases FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own purchases" ON public.play_purchases FOR UPDATE USING (auth.uid() = user_id);
DROP TRIGGER IF EXISTS update_play_purchases_updated_at ON public.play_purchases;
CREATE TRIGGER update_play_purchases_updated_at BEFORE UPDATE ON public.play_purchases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_play_purchases_user ON public.play_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_play_purchases_token ON public.play_purchases(purchase_token);