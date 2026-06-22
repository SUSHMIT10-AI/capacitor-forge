ALTER TABLE public.build_configs
ADD COLUMN IF NOT EXISTS build_type text NOT NULL DEFAULT 'aab';

ALTER TABLE public.build_configs
DROP CONSTRAINT IF EXISTS build_configs_build_type_check;

ALTER TABLE public.build_configs
ADD CONSTRAINT build_configs_build_type_check
CHECK (build_type IN ('aab', 'apk', 'both'));

ALTER TABLE public.build_configs
ADD COLUMN IF NOT EXISTS custom_html text,
ADD COLUMN IF NOT EXISTS custom_css text,
ADD COLUMN IF NOT EXISTS custom_js text,
ADD COLUMN IF NOT EXISTS enable_capacitor boolean NOT NULL DEFAULT false;

ALTER TABLE public.build_configs
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

CREATE POLICY "Users can view their own purchases"
  ON public.play_purchases FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own purchases"
  ON public.play_purchases FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own purchases"
  ON public.play_purchases FOR UPDATE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_play_purchases_updated_at
  BEFORE UPDATE ON public.play_purchases
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_play_purchases_user ON public.play_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_play_purchases_token ON public.play_purchases(purchase_token);