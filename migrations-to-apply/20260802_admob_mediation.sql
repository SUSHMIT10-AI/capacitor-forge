-- AdMob mediation network toggles for the AAB builder.
-- Run this in the SQL editor if your backend predates mediation support.

ALTER TABLE public.build_configs
  ADD COLUMN IF NOT EXISTS mediation_applovin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mediation_meta boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mediation_unity boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mediation_pangle boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mediation_mintegral boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mediation_liftoff boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS applovin_sdk_key text;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.build_configs TO authenticated;
GRANT ALL ON public.build_configs TO service_role;
