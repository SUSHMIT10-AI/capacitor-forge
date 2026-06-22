-- Create conversions table
CREATE TABLE public.conversions (
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

-- Enable RLS
ALTER TABLE public.conversions ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own conversions"
  ON public.conversions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own conversions"
  ON public.conversions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own conversions"
  ON public.conversions FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own conversions"
  ON public.conversions FOR UPDATE
  USING (auth.uid() = user_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_conversions_updated_at
  BEFORE UPDATE ON public.conversions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create storage bucket for APK uploads
INSERT INTO storage.buckets (id, name, public) VALUES ('apk-uploads', 'apk-uploads', false);

-- Storage policies
CREATE POLICY "Users can upload their own APKs"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'apk-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can view their own APKs"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'apk-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own APKs"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'apk-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);