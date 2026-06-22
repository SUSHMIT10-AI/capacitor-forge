DROP TABLE IF EXISTS public.conversions CASCADE;

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
ALTER TABLE public.conversions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own conversions" ON public.conversions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own conversions" ON public.conversions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own conversions" ON public.conversions FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Users can update their own conversions" ON public.conversions FOR UPDATE USING (auth.uid() = user_id);
CREATE TRIGGER update_conversions_updated_at BEFORE UPDATE ON public.conversions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();