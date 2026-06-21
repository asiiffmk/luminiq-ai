
CREATE POLICY "anon upload sorted-photos" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id = 'sorted-photos');
CREATE POLICY "anon read sorted-photos" ON storage.objects FOR SELECT TO anon USING (bucket_id = 'sorted-photos');
