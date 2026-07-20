GRANT SELECT, INSERT, UPDATE, DELETE ON public.build_configs TO authenticated;
GRANT ALL ON public.build_configs TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversions TO authenticated;
GRANT ALL ON public.conversions TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.signing_keys TO authenticated;
GRANT ALL ON public.signing_keys TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.play_purchases TO authenticated;
GRANT ALL ON public.play_purchases TO service_role;

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

NOTIFY pgrst, 'reload schema';