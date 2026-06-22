
CREATE POLICY "obj_select_own_folder" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('app-assets','keystores','apk-uploads','build-outputs','capacitor-projects')
         AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "obj_insert_own_folder" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('app-assets','keystores','apk-uploads','build-outputs','capacitor-projects')
              AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "obj_update_own_folder" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id IN ('app-assets','keystores','apk-uploads','build-outputs','capacitor-projects')
         AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "obj_delete_own_folder" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id IN ('app-assets','keystores','apk-uploads','build-outputs','capacitor-projects')
         AND auth.uid()::text = (storage.foldername(name))[1]);
