-- ============================================================================
-- College Compass — Initial Supabase migration
-- Enables owner + counselor collaboration on notes, applicant profile, and
-- demonstrated-interest logs. All applicant PII stays in Supabase — never in
-- static site code, JSON files, or commit history.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'My Applicant — Fall 2027',
  created_at timestamptz default now()
);

create table if not exists workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade, -- nullable until invite is claimed
  invited_email text,                                        -- filled on invite, cleared on claim
  role text not null check (role in ('owner','editor','viewer')),
  display_name text,                                         -- shown next to notes
  created_at timestamptz default now(),
  check (user_id is not null or invited_email is not null)    -- must identify someone
);

-- Postgres does not allow expressions in a table-level PRIMARY KEY, so uniqueness
-- is enforced with two partial unique indexes instead: one for claimed members
-- (user_id set) and one for pending invites (invited_email set, user_id null).
create unique index if not exists workspace_members_user_uniq
  on workspace_members (workspace_id, user_id)
  where user_id is not null;

create unique index if not exists workspace_members_invite_uniq
  on workspace_members (workspace_id, lower(invited_email))
  where user_id is null and invited_email is not null;

create table if not exists school_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  school_slug text not null,
  author_id uuid not null references auth.users(id) on delete cascade,
  content text,
  rating int check (rating is null or (rating >= 1 and rating <= 5)),
  status text check (status is null or status in ('researching','considering','applying','applied','waitlisted','admitted','declined','enrolled')),
  updated_at timestamptz default now(),
  unique (workspace_id, school_slug, author_id)              -- one note per member per school
);

create table if not exists applicant_profile (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  gpa_uw numeric check (gpa_uw is null or (gpa_uw >= 0 and gpa_uw <= 4.5)),
  gpa_w numeric  check (gpa_w  is null or (gpa_w  >= 0 and gpa_w  <= 6.0)),
  sat int check (sat is null or (sat between 400 and 1600)),
  act int check (act is null or (act between 1 and 36)),
  test_plan text check (test_plan is null or test_plan in ('submitting','optional_hold','not_submitting')),
  rigor_note text,
  odds_thresholds jsonb,                                     -- user-adjusted classifier thresholds
  updated_at timestamptz default now()
);

create table if not exists interest_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  school_slug text not null,
  action text not null check (action in ('info_session','visit','rep_email','interview','open_house','tour','fair_meeting','other')),
  occurred_on date,
  note text,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER — reads auth context safely)
-- ----------------------------------------------------------------------------

-- Is the current auth.uid() a member of the given workspace?
create or replace function is_workspace_member(w uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from workspace_members
    where workspace_id = w
      and user_id = auth.uid()
  ) or exists (
    select 1
    from workspaces
    where id = w
      and owner_id = auth.uid()
  );
$$;

-- Is the current auth.uid() an editor+ (owner or editor role)?
create or replace function is_workspace_editor(w uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from workspaces
    where id = w
      and owner_id = auth.uid()
  ) or exists (
    select 1
    from workspace_members
    where workspace_id = w
      and user_id = auth.uid()
      and role in ('owner','editor')
  );
$$;

-- Claim invites: on first sign-in, attach the authenticated user to any
-- workspace_members row where invited_email matches their auth email.
create or replace function claim_pending_invites()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed int;
begin
  update workspace_members
     set user_id = auth.uid(),
         invited_email = null
   where user_id is null
     and lower(invited_email) = lower((select email from auth.users where id = auth.uid()));
  get diagnostics claimed = row_count;
  return claimed;
end;
$$;

grant execute on function is_workspace_member(uuid)  to authenticated;
grant execute on function is_workspace_editor(uuid)  to authenticated;
grant execute on function claim_pending_invites()    to authenticated;

-- ----------------------------------------------------------------------------
-- Row-Level Security
-- ----------------------------------------------------------------------------

alter table workspaces         enable row level security;
alter table workspace_members  enable row level security;
alter table school_notes       enable row level security;
alter table applicant_profile  enable row level security;
alter table interest_log       enable row level security;

-- workspaces --------------------------------------------------------------

drop policy if exists workspaces_select on workspaces;
create policy workspaces_select on workspaces
  for select using (
    owner_id = auth.uid() or is_workspace_member(id)
  );

drop policy if exists workspaces_insert on workspaces;
create policy workspaces_insert on workspaces
  for insert with check (owner_id = auth.uid());

drop policy if exists workspaces_update on workspaces;
create policy workspaces_update on workspaces
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists workspaces_delete on workspaces;
create policy workspaces_delete on workspaces
  for delete using (owner_id = auth.uid());

-- workspace_members -------------------------------------------------------

drop policy if exists members_select on workspace_members;
create policy members_select on workspace_members
  for select using (
    user_id = auth.uid()
    or exists (select 1 from workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
    or is_workspace_member(workspace_id)
  );

drop policy if exists members_insert on workspace_members;
create policy members_insert on workspace_members
  for insert with check (
    exists (select 1 from workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
  );

drop policy if exists members_update on workspace_members;
create policy members_update on workspace_members
  for update using (
    exists (select 1 from workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
    or user_id = auth.uid()  -- members can update their own display_name
  );

drop policy if exists members_delete on workspace_members;
create policy members_delete on workspace_members
  for delete using (
    exists (select 1 from workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
  );

-- school_notes ------------------------------------------------------------

drop policy if exists notes_select on school_notes;
create policy notes_select on school_notes
  for select using (is_workspace_member(workspace_id));

drop policy if exists notes_insert on school_notes;
create policy notes_insert on school_notes
  for insert with check (
    is_workspace_editor(workspace_id)
    and author_id = auth.uid()
  );

drop policy if exists notes_update on school_notes;
create policy notes_update on school_notes
  for update using (
    author_id = auth.uid()
    and is_workspace_editor(workspace_id)
  ) with check (author_id = auth.uid());

drop policy if exists notes_delete on school_notes;
create policy notes_delete on school_notes
  for delete using (
    author_id = auth.uid()
    and is_workspace_editor(workspace_id)
  );

-- applicant_profile -------------------------------------------------------

drop policy if exists profile_select on applicant_profile;
create policy profile_select on applicant_profile
  for select using (is_workspace_member(workspace_id));

drop policy if exists profile_insert on applicant_profile;
create policy profile_insert on applicant_profile
  for insert with check (is_workspace_editor(workspace_id));

drop policy if exists profile_update on applicant_profile;
create policy profile_update on applicant_profile
  for update using (is_workspace_editor(workspace_id))
             with check (is_workspace_editor(workspace_id));

-- interest_log ------------------------------------------------------------

drop policy if exists interest_select on interest_log;
create policy interest_select on interest_log
  for select using (is_workspace_member(workspace_id));

drop policy if exists interest_insert on interest_log;
create policy interest_insert on interest_log
  for insert with check (
    is_workspace_editor(workspace_id) and created_by = auth.uid()
  );

drop policy if exists interest_update on interest_log;
create policy interest_update on interest_log
  for update using (
    created_by = auth.uid() and is_workspace_editor(workspace_id)
  ) with check (created_by = auth.uid());

drop policy if exists interest_delete on interest_log;
create policy interest_delete on interest_log
  for delete using (
    created_by = auth.uid() and is_workspace_editor(workspace_id)
  );

-- ----------------------------------------------------------------------------
-- Trigger: auto-add the workspace creator as owner in workspace_members
-- ----------------------------------------------------------------------------

create or replace function on_workspace_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into workspace_members (workspace_id, user_id, role, display_name)
  values (new.id, new.owner_id, 'owner', 'Owner')
  on conflict (workspace_id, user_id) where user_id is not null do nothing;
  return new;
end;
$$;

drop trigger if exists workspaces_after_insert on workspaces;
create trigger workspaces_after_insert
  after insert on workspaces
  for each row execute function on_workspace_created();

-- ----------------------------------------------------------------------------
-- updated_at auto-touch
-- ----------------------------------------------------------------------------

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists notes_touch  on school_notes;      create trigger notes_touch  before update on school_notes      for each row execute function touch_updated_at();
drop trigger if exists profile_touch on applicant_profile; create trigger profile_touch before update on applicant_profile for each row execute function touch_updated_at();
