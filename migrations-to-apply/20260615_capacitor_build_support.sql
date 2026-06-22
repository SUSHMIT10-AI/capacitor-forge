-- Run this in the Supabase SQL editor of THIS project's backend
-- to enable the Capacitor build pipeline.

-- 1) Extend build_configs with Capacitor-mode columns
ALTER TABLE public.build_configs
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'webview',
  ADD COLUMN IF NOT EXISTS project_zip_path text,
  ADD COLUMN IF NOT EXISTS detected_plugins jsonb,
  ADD COLUMN IF NOT EXISTS sync_log text;

ALTER TABLE public.build_configs
  DROP CONSTRAINT IF EXISTS build_configs_mode_check;
ALTER TABLE public.build_configs
  ADD CONSTRAINT build_configs_mode_check CHECK (mode IN ('webview','capacitor'));

-- URL is required for webview mode but optional for capacitor mode
ALTER TABLE public.build_configs ALTER COLUMN url DROP NOT NULL;

-- 2) Private bucket for uploaded Capacitor project zips
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'capacitor-projects',
  'capacitor-projects',
  false,
  104857600, -- 100 MB
  ARRAY['application/zip','application/x-zip-compressed','application/octet-stream']
)
ON CONFLICT (id) DO NOTHING;

-- RLS: users manage only their own {user_id}/* objects
DROP POLICY IF EXISTS "capacitor_projects_read_own" ON storage.objects;
CREATE POLICY "capacitor_projects_read_own"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'capacitor-projects' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "capacitor_projects_insert_own" ON storage.objects;
CREATE POLICY "capacitor_projects_insert_own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'capacitor-projects' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "capacitor_projects_update_own" ON storage.objects;
CREATE POLICY "capacitor_projects_update_own"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'capacitor-projects' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "capacitor_projects_delete_own" ON storage.objects;
CREATE POLICY "capacitor_projects_delete_own"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'capacitor-projects' AND auth.uid()::text = (storage.foldername(name))[1]);
