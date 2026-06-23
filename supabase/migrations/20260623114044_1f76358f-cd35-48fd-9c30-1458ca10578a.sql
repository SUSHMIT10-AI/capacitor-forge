
CREATE POLICY "buildout_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'build-outputs' AND (auth.uid())::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'build-outputs' AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "asset_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'app-assets' AND (auth.uid())::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'app-assets' AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "apk_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'apk-uploads' AND (auth.uid())::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'apk-uploads' AND (auth.uid())::text = (storage.foldername(name))[1]);
