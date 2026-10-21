-- Counselor directory admins (the owner). Admin RPCs check the signed-in user's confirmed email against
-- this list (public.is_admin()). To add or change an admin, add a new migration like this one, or run the
-- statement in the Supabase SQL editor. Emails are stored lower-case.
insert into cc_private.admins (email) values ('vikasgaddu@gmail.com') on conflict (email) do nothing;
