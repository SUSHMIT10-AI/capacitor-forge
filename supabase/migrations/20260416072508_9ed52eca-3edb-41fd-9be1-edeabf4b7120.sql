
-- Build configs table
CREATE TABLE public.build_configs (
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

-- Signing keys table
CREATE TABLE public.signing_keys (
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

-- Foreign key from build_configs to signing_keys
ALTER TABLE public.build_configs
  ADD CONSTRAINT fk_signing_key FOREIGN KEY (signing_key_id) REFERENCES public.signing_keys(id) ON DELETE SET NULL;

-- Enable RLS
ALTER TABLE public.build_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signing_keys ENABLE ROW LEVEL SECURITY;

-- Build configs policies
CREATE POLICY "Users can view their own builds" ON public.build_configs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own builds" ON public.build_configs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own builds" ON public.build_configs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own builds" ON public.build_configs FOR DELETE USING (auth.uid() = user_id);

-- Signing keys policies
CREATE POLICY "Users can view their own keys" ON public.signing_keys FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own keys" ON public.signing_keys FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own keys" ON public.signing_keys FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own keys" ON public.signing_keys FOR DELETE USING (auth.uid() = user_id);

-- Updated at triggers
CREATE TRIGGER update_build_configs_updated_at
  BEFORE UPDATE ON public.build_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_signing_keys_updated_at
  BEFORE UPDATE ON public.signing_keys
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket for app icons and keystores
INSERT INTO storage.buckets (id, name, public) VALUES ('app-assets', 'app-assets', false);

CREATE POLICY "Users can upload their own assets"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'app-assets' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can view their own assets"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'app-assets' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own assets"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'app-assets' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Storage bucket for build outputs (AAB/APK files)
INSERT INTO storage.buckets (id, name, public) VALUES ('build-outputs', 'build-outputs', false);

CREATE POLICY "Users can view their own build outputs"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'build-outputs' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own build outputs"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'build-outputs' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Enable realtime for build_configs to track build progress
ALTER PUBLICATION supabase_realtime ADD TABLE public.build_configs;
