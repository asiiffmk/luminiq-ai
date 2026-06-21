
DROP POLICY IF EXISTS "anon upload sorted-photos" ON storage.objects;
DROP POLICY IF EXISTS "auth upload sorted-photos" ON storage.objects;
DROP POLICY IF EXISTS "owner read sorted-photos" ON storage.objects;
DROP POLICY IF EXISTS "owner update sorted-photos" ON storage.objects;
DROP POLICY IF EXISTS "owner delete sorted-photos" ON storage.objects;

CREATE POLICY "auth upload sorted-photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'sorted-photos' AND owner = auth.uid());

CREATE POLICY "owner read sorted-photos" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'sorted-photos' AND owner = auth.uid());

CREATE POLICY "owner update sorted-photos" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'sorted-photos' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'sorted-photos' AND owner = auth.uid());

CREATE POLICY "owner delete sorted-photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'sorted-photos' AND owner = auth.uid());
