-- Supabase grants anon/authenticated full table privileges by default; RLS already blocks writes
-- and hides unpublished rows, but revoke them too so the app's key can only ever read published data.
revoke all on table public.colleges, public.college_stats, public.college_research, public.college_programs from anon, authenticated;
grant select on table public.colleges, public.college_stats, public.college_research, public.college_programs to anon, authenticated;
revoke all on table public.contributions from anon, authenticated;
revoke all on all tables in schema cc_private from anon, authenticated;
revoke all on all functions in schema cc_private from public, anon, authenticated;
