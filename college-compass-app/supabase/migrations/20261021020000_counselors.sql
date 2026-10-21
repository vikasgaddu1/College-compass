-- College Compass — counselor directory (paid listings, approved by the owner).
-- Contract: docs/COUNSELORS_CONTRACT.md · Operations: docs/COUNSELORS.md
--
-- Counselors sign in on the website portal (Supabase Auth magic link), edit a DRAFT profile, accept the
-- counselor terms, submit for review and pay through Stripe (Edge Functions). The owner approves; approval
-- copies the draft into `published`, and the directory only ever shows `published`. Edits after approval
-- stay in the draft until re-approved (the old published version stays live meanwhile).
--
-- Listed (shown to families) = approved AND published AND not suspended AND one of:
--   * founding listing: founding_until >= today (payment ignored)
--   * subscription active or trialing (a cancelled subscription stays active until the paid period ends)
--   * subscription past_due for less than 7 days since the first failed payment (grace period)
-- Everything else (draft, pending, rejected, suspended, unpaid, canceled, never paid) is hidden — the
-- directory query applies this rule itself, so nothing needs to run for a listing to disappear.
--
-- Apps (anon key) can only call counselor_directory() and report_counselor(). Counselors can read their own
-- row and write only the draft columns. Billing ids, reports and admins live in cc_private (no API access).

-- ───────────────────────────── private tables ─────────────────────────────
create table if not exists cc_private.admins (
  email     text primary key check (email = lower(email)),
  added_at  timestamptz not null default now()
);

-- Photos must be public URLs of objects in the counselor-photos bucket under the counselor's own folder,
-- so the app never loads images from hosts a counselor controls (which could log families' addresses).
alter table cc_private.settings add column if not exists counselor_photo_prefix text not null
  default 'https://nspbxlnocelknibrajkv.supabase.co/storage/v1/object/public/counselor-photos/';

-- ───────────────────────────── counselors ─────────────────────────────
create table if not exists public.counselors (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  status                text not null default 'draft'
                          check (status in ('draft', 'pending', 'approved', 'rejected', 'suspended')),
  -- draft (editable by the counselor)
  name                  text check (char_length(name) <= 120),
  title                 text check (char_length(title) <= 120),
  photo_url             text check (char_length(photo_url) <= 500),
  bio                   text check (char_length(bio) <= 1200),
  website               text check (char_length(website) <= 300 and website ~* '^https?://[^\s/?#.]+\.[^\s]+$'),
  phone                 text check (phone ~ '^[0-9+().\s/xX-]{7,30}$'),
  email                 text check (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  city                  text check (char_length(city) <= 80),
  states                text[] not null default '{}' check (cardinality(states) <= 60 and states <@ array[
                          'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME',
                          'MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI',
                          'SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','PR','GU','VI','AS','MP','US']::text[]),
  specialties           text[] not null default '{}' check (specialties <@ array[
                          'stem','engineering','arts','athletics','international','financial_aid','essays','test_prep',
                          'transfer','learning_differences','first_gen','general']::text[]),
  modes                 text[] not null default '{}' check (modes <@ array['virtual','in_person']::text[]),
  credentials           text check (char_length(credentials) <= 300),
  -- review (admin only)
  published             jsonb,
  has_changes           boolean not null default false,
  review_note           text check (char_length(review_note) <= 2000),
  terms_accepted_at     timestamptz,
  submitted_at          timestamptz,
  approved_at           timestamptz,
  -- billing (Stripe webhook / reconcile / admin only)
  subscription_status   text not null default 'none'
                          check (subscription_status in ('none', 'trialing', 'active', 'past_due', 'unpaid', 'canceled')),
  plan                  text check (plan in ('monthly', 'yearly', 'founding')),
  founding_until        date,
  past_due_since        timestamptz,
  current_period_end    timestamptz,
  cancel_at_period_end  boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists counselors_status on public.counselors (status);

-- Private: Stripe ids, reports, processed webhook events.
create table if not exists cc_private.counselor_billing (
  counselor_id            uuid primary key references public.counselors (id) on delete cascade,
  stripe_customer_id      text unique,
  stripe_subscription_id  text,
  stripe_price_id         text,
  synced_at               timestamptz,               -- when the Stripe state written last was observed
  updated_at              timestamptz not null default now()
);

create table if not exists cc_private.stripe_events (
  id           text primary key,                      -- Stripe event id (idempotency)
  type         text not null,
  result       text,
  received_at  timestamptz not null default now()
);

create table if not exists cc_private.counselor_reports (
  id             bigint generated always as identity primary key,
  counselor_id   uuid not null references public.counselors (id) on delete cascade,
  reason         text not null check (reason in ('inappropriate', 'misleading', 'unresponsive', 'other')),
  detail         text check (char_length(detail) <= 1000),
  reporter_hash  text not null,                       -- salted hash of the network address (dedupe only)
  created_at     timestamptz not null default now()
);
create index if not exists counselor_reports_counselor on cc_private.counselor_reports (counselor_id, created_at desc);

-- ───────────────────────────── helpers ─────────────────────────────
-- The fields families see, as stored in `published`.
create or replace function cc_private.counselor_snapshot(c public.counselors)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'name', c.name, 'title', c.title, 'photo_url', c.photo_url, 'bio', c.bio, 'website', c.website,
    'phone', c.phone, 'email', c.email, 'city', c.city, 'states', to_jsonb(c.states),
    'specialties', to_jsonb(c.specialties), 'modes', to_jsonb(c.modes), 'credentials', c.credentials)
$$;

-- The single definition of "listed". 7-day grace from the first failed payment.
create or replace function cc_private.counselor_listed(c public.counselors)
returns boolean language sql stable as $$
  select c.status = 'approved' and c.published is not null and (
    coalesce(c.founding_until >= current_date, false)
    or c.subscription_status in ('active', 'trialing')
    or (c.subscription_status = 'past_due' and coalesce(c.past_due_since, now()) > now() - interval '7 days'))
$$;

-- Waiting for the owner: a new profile (pending) or submitted edits to an approved one.
create or replace function cc_private.counselor_awaiting(c public.counselors)
returns boolean language sql immutable as $$
  select c.status = 'pending'
      or (c.status = 'approved' and c.has_changes and coalesce(c.submitted_at > coalesce(c.approved_at, '-infinity'), false))
$$;

-- What's missing before a profile can be reviewed/approved (empty array = complete).
create or replace function cc_private.counselor_missing(c public.counselors)
returns text[] language sql immutable as $$
  select array_remove(array[
    case when c.name is null then 'name' end,
    case when c.bio is null then 'bio' end,
    case when cardinality(c.states) = 0 then 'states' end,
    case when cardinality(c.specialties) = 0 then 'specialties' end,
    case when cardinality(c.modes) = 0 then 'modes' end,
    case when c.website is null and c.phone is null and c.email is null then 'contact' end
  ], null)
$$;

-- Salted hash of the caller's network address, per purpose (same salt/approach as contribute_research,
-- but a different key so report limits and contribution limits don't share a counter).
create or replace function cc_private.client_hash(purpose text)
returns text language plpgsql stable as $$
declare
  headers json;
  v_ip text;
  v_salt text;
begin
  select s.salt into v_salt from cc_private.settings s;
  begin headers := current_setting('request.headers', true)::json; exception when others then headers := null; end;
  v_ip := coalesce(nullif(split_part(headers ->> 'x-forwarded-for', ',', 1), ''), headers ->> 'cf-connecting-ip', 'unknown');
  return encode(sha256(convert_to(v_salt || purpose || ':' || trim(v_ip), 'UTF8')), 'hex');
end $$;

-- Count one hit for `key` this hour (cc_private.rate, rows kept two days); true while within the limit.
create or replace function cc_private.rate_hit(key text, max_per_hour int)
returns boolean language plpgsql volatile as $$
declare cnt int;
begin
  insert into cc_private.rate (ip_hash, hour, n) values (key, date_trunc('hour', now()), 1)
    on conflict (ip_hash, hour) do update set n = cc_private.rate.n + 1 returning n into cnt;
  if random() < 0.01 then delete from cc_private.rate where hour < now() - interval '2 days'; end if;
  return cnt <= max_per_hour;
end $$;

-- Stripe subscription status → ours. Unknown future statuses are treated as not paying (hidden).
create or replace function cc_private.stripe_status_map(s text)
returns text language sql immutable as $$
  select case
    when s is null then null
    when s in ('active', 'trialing', 'past_due', 'unpaid', 'canceled') then s
    when s = 'paused' then 'unpaid'
    when s in ('incomplete', 'incomplete_expired') then 'none'
    else 'unpaid' end
$$;

-- ───────────────────────────── triggers ─────────────────────────────
-- 1) Guard (runs as the caller): counselors writing through the API can only touch draft columns.
--    Column grants already enforce this; the trigger is defence in depth. Admin/billing RPCs run as the
--    function owner and the Edge Functions as service_role, so they pass.
create or replace function public.counselors_guard()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('anon', 'authenticated') then return new; end if;
  if tg_op = 'INSERT' then
    new.user_id := auth.uid();
    new.status := 'draft'; new.published := null; new.has_changes := false; new.review_note := null;
    new.terms_accepted_at := null; new.submitted_at := null; new.approved_at := null;
    new.subscription_status := 'none'; new.plan := null; new.founding_until := null; new.past_due_since := null;
    new.current_period_end := null; new.cancel_at_period_end := false;
    new.created_at := now();
    return new;
  end if;
  if new.id is distinct from old.id or new.user_id is distinct from old.user_id or new.created_at is distinct from old.created_at
     or new.status is distinct from old.status or new.published is distinct from old.published
     or new.has_changes is distinct from old.has_changes or new.review_note is distinct from old.review_note
     or new.terms_accepted_at is distinct from old.terms_accepted_at or new.submitted_at is distinct from old.submitted_at
     or new.approved_at is distinct from old.approved_at or new.subscription_status is distinct from old.subscription_status
     or new.plan is distinct from old.plan or new.founding_until is distinct from old.founding_until
     or new.past_due_since is distinct from old.past_due_since or new.current_period_end is distinct from old.current_period_end
     or new.cancel_at_period_end is distinct from old.cancel_at_period_end then
    raise exception 'protected_column' using errcode = '42501', hint = 'Counselors can only edit their draft profile fields.';
  end if;
  return new;
end $$;

-- 2) Derive (definer, reads cc_private.settings): normalize, validate photo URL, updated_at, has_changes.
create or replace function cc_private.counselors_derive()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  prefix text;
  rest text;
begin
  new.name := nullif(btrim(new.name), '');
  new.title := nullif(btrim(new.title), '');
  new.photo_url := nullif(btrim(new.photo_url), '');
  new.bio := nullif(btrim(new.bio), '');
  new.website := nullif(btrim(new.website), '');
  new.phone := nullif(btrim(new.phone), '');
  new.email := lower(nullif(btrim(new.email), ''));
  new.city := nullif(btrim(new.city), '');
  new.credentials := nullif(btrim(new.credentials), '');
  new.states := coalesce(array(select distinct upper(btrim(s)) from unnest(new.states) s where btrim(s) <> '' order by 1), '{}');
  new.specialties := coalesce(array(select distinct btrim(s) from unnest(new.specialties) s where btrim(s) <> '' order by 1), '{}');
  new.modes := coalesce(array(select distinct btrim(s) from unnest(new.modes) s where btrim(s) <> '' order by 1), '{}');

  if new.photo_url is not null and (tg_op = 'INSERT' or new.photo_url is distinct from old.photo_url) then
    select s.counselor_photo_prefix into prefix from cc_private.settings s;
    rest := case when starts_with(new.photo_url, prefix || new.user_id::text || '/')
                 then substr(new.photo_url, char_length(prefix || new.user_id::text || '/') + 1) end;
    if rest is null or rest !~ '^[A-Za-z0-9._-]{1,120}(\?[A-Za-z0-9=&._-]{0,60})?$' or rest like '%..%' then
      raise exception 'photo_url_invalid' using errcode = '23514',
        hint = 'Upload the photo to the counselor-photos bucket under your own folder and use its public URL.';
    end if;
  end if;

  new.updated_at := now();
  new.has_changes := new.published is not null and cc_private.counselor_snapshot(new) is distinct from new.published;
  return new;
end $$;

drop trigger if exists counselors_10_guard on public.counselors;
create trigger counselors_10_guard before insert or update on public.counselors
  for each row execute function public.counselors_guard();
drop trigger if exists counselors_20_derive on public.counselors;
create trigger counselors_20_derive before insert or update on public.counselors
  for each row execute function cc_private.counselors_derive();

-- ───────────────────────────── access: table ─────────────────────────────
alter table public.counselors enable row level security;

drop policy if exists "counselor reads own row" on public.counselors;
create policy "counselor reads own row" on public.counselors for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "counselor creates own row" on public.counselors;
create policy "counselor creates own row" on public.counselors for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists "counselor edits own row" on public.counselors;
create policy "counselor edits own row" on public.counselors for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- No delete policy: removing a listing goes through the owner (suspend) so billing can be handled.

revoke all on table public.counselors from anon, authenticated;
grant select on table public.counselors to authenticated;
grant insert (user_id, name, title, photo_url, bio, website, phone, email, city, states, specialties, modes, credentials)
  on table public.counselors to authenticated;
grant update (user_id, name, title, photo_url, bio, website, phone, email, city, states, specialties, modes, credentials)
  on table public.counselors to authenticated;

revoke all on all tables in schema cc_private from anon, authenticated;

-- ───────────────────────────── admin check ─────────────────────────────
-- The signed-in user's confirmed email is in cc_private.admins.
create or replace function public.is_admin()
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from auth.users u join cc_private.admins a on a.email = lower(u.email)
     where u.id = auth.uid() and u.email_confirmed_at is not null)
$$;

-- ───────────────────────────── public directory (apps) ─────────────────────────────
create or replace function public.counselor_directory(p_state text default null, p_specialties text[] default null)
returns table (id uuid, name text, title text, photo_url text, bio text, website text, phone text, email text, city text,
               states text[], specialties text[], modes text[], credentials text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select c.id, p ->> 'name', p ->> 'title', p ->> 'photo_url', p ->> 'bio', p ->> 'website', p ->> 'phone', p ->> 'email',
         p ->> 'city',
         array(select jsonb_array_elements_text(coalesce(p -> 'states', '[]'))),
         array(select jsonb_array_elements_text(coalesce(p -> 'specialties', '[]'))),
         array(select jsonb_array_elements_text(coalesce(p -> 'modes', '[]'))),
         p ->> 'credentials'
    from public.counselors c
   cross join lateral (select c.published as p) pub
   where cc_private.counselor_listed(c)
     and (nullif(btrim(p_state), '') is null or p -> 'states' ? upper(btrim(p_state)) or p -> 'states' ? 'US')
     and (coalesce(cardinality(p_specialties), 0) = 0 or p -> 'specialties' ?| p_specialties)
   -- Rotates daily (UTC) so no counselor is always first; stable within a day.
   order by md5(c.id::text || current_date::text)
   limit 500
$$;

create or replace function public.report_counselor(p_counselor uuid, p_reason text, p_detail text default null)
returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  h text;
begin
  if p_reason is null or p_reason not in ('inappropriate', 'misleading', 'unresponsive', 'other') then
    return jsonb_build_object('ok', false, 'reason', 'bad_reason');
  end if;
  h := cc_private.client_hash('counselor_report');
  if not cc_private.rate_hit(h, 5) then return jsonb_build_object('ok', false, 'reason', 'rate_limited'); end if;
  if not exists (select 1 from public.counselors c where c.id = p_counselor and cc_private.counselor_listed(c)) then
    return jsonb_build_object('ok', false, 'reason', 'unknown_counselor');
  end if;
  -- One report per counselor per address per day is enough; repeats are acknowledged but not stored.
  if not exists (select 1 from cc_private.counselor_reports r
                  where r.counselor_id = p_counselor and r.reporter_hash = h and r.created_at > now() - interval '1 day') then
    insert into cc_private.counselor_reports (counselor_id, reason, detail, reporter_hash)
      values (p_counselor, p_reason, left(nullif(btrim(p_detail), ''), 1000), h);
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ───────────────────────────── counselor portal ─────────────────────────────
create or replace function public.accept_counselor_terms()
returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  at timestamptz;
begin
  if uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  insert into public.counselors (user_id, terms_accepted_at) values (uid, now())
    on conflict (user_id) do update set terms_accepted_at = now()
    returning terms_accepted_at into at;
  return jsonb_build_object('ok', true, 'terms_accepted_at', at);
end $$;

create or replace function public.submit_counselor_for_review()
returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  c public.counselors%rowtype;
  missing text[];
begin
  if uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  select * into c from public.counselors where user_id = uid for update;
  if not found then raise exception 'no_profile' using hint = 'Save your profile first.'; end if;
  if c.terms_accepted_at is null then raise exception 'terms_not_accepted' using hint = 'Accept the counselor terms first.'; end if;
  if c.status = 'suspended' then raise exception 'suspended' using hint = 'This listing is suspended; contact College Compass.'; end if;
  missing := cc_private.counselor_missing(c);
  if cardinality(missing) > 0 then
    raise exception 'incomplete_profile' using detail = array_to_string(missing, ','), hint = 'Missing: ' || array_to_string(missing, ', ');
  end if;
  if c.status = 'approved' then
    if not c.has_changes then raise exception 'no_changes' using hint = 'Your published listing already matches your profile.'; end if;
    update public.counselors set submitted_at = now(), review_note = null where id = c.id;
  else
    update public.counselors set status = 'pending', submitted_at = now(), review_note = null where id = c.id;
  end if;
  select * into c from public.counselors where id = c.id;
  return jsonb_build_object('ok', true, 'status', c.status, 'awaiting_review', true, 'submitted_at', c.submitted_at);
end $$;

-- ───────────────────────────── admin ─────────────────────────────
create or replace function public.admin_counselors(p_status text default null)
returns table (id uuid, user_id uuid, account_email text, status text, awaiting_review boolean, listed boolean,
               name text, title text, photo_url text, bio text, website text, phone text, email text, city text,
               states text[], specialties text[], modes text[], credentials text,
               published jsonb, has_changes boolean, review_note text, terms_accepted_at timestamptz,
               submitted_at timestamptz, approved_at timestamptz,
               subscription_status text, plan text, founding_until date, past_due_since timestamptz,
               current_period_end timestamptz, cancel_at_period_end boolean,
               created_at timestamptz, updated_at timestamptz, report_count bigint, recent_report_count bigint)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'not_authorized' using errcode = '42501'; end if;
  return query
  select c.id, c.user_id, u.email::text, c.status,
         cc_private.counselor_awaiting(c),
         cc_private.counselor_listed(c),
         c.name, c.title, c.photo_url, c.bio, c.website, c.phone, c.email, c.city, c.states, c.specialties, c.modes, c.credentials,
         c.published, c.has_changes, c.review_note, c.terms_accepted_at, c.submitted_at, c.approved_at,
         c.subscription_status, c.plan, c.founding_until, c.past_due_since, c.current_period_end, c.cancel_at_period_end,
         c.created_at, c.updated_at,
         (select count(*) from cc_private.counselor_reports r where r.counselor_id = c.id),
         (select count(*) from cc_private.counselor_reports r where r.counselor_id = c.id and r.created_at > now() - interval '30 days')
    from public.counselors c
    left join auth.users u on u.id = c.user_id
   where p_status is null
      or c.status = p_status
      or (p_status = 'review' and cc_private.counselor_awaiting(c))
      or (p_status = 'listed' and cc_private.counselor_listed(c))
   order by cc_private.counselor_awaiting(c) desc,
            c.updated_at desc;
end $$;

-- approve: publish the current draft (also re-approves edits); reject: for a new profile → rejected, for an
-- approved one → declines the pending edits (published version stays); suspend: hidden immediately whatever
-- the payment state; unsuspend: back to approved (or draft if never published); founding: only set
-- founding_until. p_founding_until (any decision) sets the free founding listing end date (a past date ends it).
-- p_expected_updated_at (optional) refuses the decision if the profile changed after the admin loaded it.
create or replace function public.admin_review_counselor(p_id uuid, p_decision text, p_note text default null,
                                                         p_founding_until date default null,
                                                         p_expected_updated_at timestamptz default null)
returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  c public.counselors%rowtype;
  missing text[];
  note text := left(nullif(btrim(p_note), ''), 2000);
begin
  if not public.is_admin() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if p_decision is null or p_decision not in ('approve', 'reject', 'suspend', 'unsuspend', 'founding') then
    raise exception 'bad_decision';
  end if;
  select * into c from public.counselors where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_expected_updated_at is not null and c.updated_at <> p_expected_updated_at then
    raise exception 'changed_since_viewed' using hint = 'The profile changed after you opened it; reload and review again.';
  end if;

  if p_decision = 'approve' then
    if c.status = 'suspended' then raise exception 'suspended' using hint = 'Unsuspend first.'; end if;
    missing := cc_private.counselor_missing(c);
    if cardinality(missing) > 0 then raise exception 'incomplete_profile' using detail = array_to_string(missing, ','); end if;
    if c.terms_accepted_at is null then raise exception 'terms_not_accepted'; end if;
    update public.counselors set status = 'approved', published = cc_private.counselor_snapshot(c), approved_at = now(),
           review_note = note where id = p_id;
  elsif p_decision = 'reject' then
    if c.status = 'suspended' then raise exception 'suspended'; end if;
    if c.status = 'approved' then
      update public.counselors set review_note = note, submitted_at = null where id = p_id;
    else
      update public.counselors set status = 'rejected', review_note = note where id = p_id;
    end if;
  elsif p_decision = 'suspend' then
    update public.counselors set status = 'suspended', review_note = coalesce(note, review_note) where id = p_id;
  elsif p_decision = 'unsuspend' then
    if c.status <> 'suspended' then raise exception 'not_suspended'; end if;
    update public.counselors set status = case when published is not null then 'approved' else 'draft' end,
           review_note = coalesce(note, review_note) where id = p_id;
  elsif p_decision = 'founding' then
    if p_founding_until is null then raise exception 'founding_until_required'; end if;
    if note is not null then update public.counselors set review_note = note where id = p_id; end if;
  end if;

  if p_founding_until is not null then
    update public.counselors
       set founding_until = p_founding_until,
           plan = case when subscription_status in ('active', 'trialing', 'past_due', 'unpaid') then plan
                       when p_founding_until >= current_date then 'founding' end
     where id = p_id;
  end if;

  select * into c from public.counselors where id = p_id;
  return jsonb_build_object('ok', true, 'id', c.id, 'status', c.status, 'listed', cc_private.counselor_listed(c),
                            'has_changes', c.has_changes, 'plan', c.plan, 'founding_until', c.founding_until,
                            'updated_at', c.updated_at);
end $$;

create or replace function public.admin_counselor_reports()
returns table (id bigint, counselor_id uuid, counselor_name text, counselor_status text, reason text, detail text,
               reporter text, created_at timestamptz)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'not_authorized' using errcode = '42501'; end if;
  return query
  select r.id, r.counselor_id, coalesce(c.published ->> 'name', c.name), c.status, r.reason, r.detail,
         left(r.reporter_hash, 8), r.created_at
    from cc_private.counselor_reports r
    join public.counselors c on c.id = r.counselor_id
   order by r.created_at desc
   limit 200;
end $$;

-- ───────────────────────────── billing (Edge Functions, service role only) ─────────────────────────────
-- The signed-in user's counselor row + Stripe customer, for counselor-checkout / counselor-billing.
create or replace function public.billing_counselor_for_user(p_user uuid)
returns jsonb language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('counselor_id', c.id, 'status', c.status, 'name', c.name,
                            'terms_accepted_at', c.terms_accepted_at, 'subscription_status', c.subscription_status,
                            'plan', c.plan, 'stripe_customer_id', b.stripe_customer_id)
    from public.counselors c
    left join cc_private.counselor_billing b on b.counselor_id = c.id
   where c.user_id = p_user
$$;

-- Remember the counselor's Stripe customer; an existing one wins (returns the customer to use).
create or replace function public.billing_attach_customer(p_counselor uuid, p_customer text)
returns text language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare cust text;
begin
  insert into cc_private.counselor_billing (counselor_id, stripe_customer_id) values (p_counselor, p_customer)
    on conflict (counselor_id) do update
      set stripe_customer_id = coalesce(cc_private.counselor_billing.stripe_customer_id, excluded.stripe_customer_id),
          updated_at = now()
    returning stripe_customer_id into cust;
  return cust;
end $$;

-- Counselors the daily reconcile should compare with Stripe.
create or replace function public.billing_reconcile_targets()
returns table (counselor_id uuid, stripe_customer_id text, stripe_subscription_id text, subscription_status text,
               plan text, past_due_since timestamptz)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select c.id, b.stripe_customer_id, b.stripe_subscription_id, c.subscription_status, c.plan, c.past_due_since
    from public.counselors c
    left join cc_private.counselor_billing b on b.counselor_id = c.id
   where b.stripe_customer_id is not null or c.subscription_status <> 'none'
   order by c.created_at
$$;

-- Apply the CURRENT state of a Stripe subscription (retrieved fresh from Stripe by the caller) to a
-- counselor. Used by stripe-webhook (p_event_id set → idempotent per event) and counselor-reconcile.
-- p_subscription null = the customer has no subscription at all.
--   status: active/trialing → listed; past_due → listed for 7 days from past_due_since; unpaid, paused and
--   unknown statuses → unpaid (hidden); canceled → canceled (hidden; Stripe keeps a cancel-at-period-end
--   subscription active until the paid period ends); incomplete/incomplete_expired → none (never paid).
--   past_due_since: set at the first failure (status past_due/unpaid, or an invoice.payment_failed event),
--   kept while failing, cleared once active/trialing again (or canceled).
--   plan: monthly/yearly from the price interval; after cancellation 'founding' if a founding listing is
--   still running, else null.
create or replace function public.billing_apply_subscription(
  p_source                text,
  p_event_id              text default null,
  p_event_type            text default null,
  p_event_created         timestamptz default null,
  p_counselor             uuid default null,
  p_customer              text default null,
  p_subscription          text default null,
  p_stripe_status         text default null,
  p_interval              text default null,
  p_price                 text default null,
  p_period_end            timestamptz default null,
  p_cancel_at_period_end  boolean default false,
  p_payment_failed        boolean default false,
  p_observed_at           timestamptz default null)
returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  cid uuid;
  c public.counselors%rowtype;
  b cc_private.counselor_billing%rowtype;
  observed timestamptz := coalesce(p_observed_at, now());
  failed_at timestamptz := least(coalesce(p_event_created, now()), now());
  live text[] := array['active', 'trialing', 'past_due'];
  new_status text;
  new_plan text;
  new_pds timestamptz;
  new_end timestamptz;
  new_cancel boolean;
  res text;
  changed boolean;
begin
  if p_source is null or p_source not in ('webhook', 'reconcile') then raise exception 'bad_source'; end if;
  if p_subscription is not null and p_stripe_status is null then raise exception 'stripe_status_required'; end if;

  if p_event_id is not null then
    insert into cc_private.stripe_events (id, type) values (p_event_id, coalesce(p_event_type, 'unknown'))
      on conflict (id) do nothing;
    if not found then return jsonb_build_object('result', 'duplicate'); end if;
    if random() < 0.01 then delete from cc_private.stripe_events where received_at < now() - interval '90 days'; end if;
  end if;

  if p_counselor is not null then select id into cid from public.counselors where id = p_counselor; end if;
  if cid is null and p_customer is not null then
    select counselor_id into cid from cc_private.counselor_billing where stripe_customer_id = p_customer;
  end if;
  if cid is null then
    res := 'unknown_counselor';
  else
    select * into c from public.counselors where id = cid for update;
    insert into cc_private.counselor_billing (counselor_id) values (cid) on conflict (counselor_id) do nothing;
    select * into b from cc_private.counselor_billing where counselor_id = cid for update;

    if b.synced_at is not null and observed < b.synced_at then
      res := 'stale';
    else
      if p_subscription is null then
        new_status := case when c.subscription_status = 'none' and b.stripe_subscription_id is null then 'none' else 'canceled' end;
      else
        new_status := cc_private.stripe_status_map(p_stripe_status);
      end if;

      if p_subscription is not null and b.stripe_subscription_id is not null and b.stripe_subscription_id <> p_subscription
         and c.subscription_status = any (live) and not (new_status = any (live)) then
        -- An old/duplicate subscription changed while another one is live: keep the live one.
        res := 'ignored_other_subscription';
      else
        new_plan := case
          when new_status in ('active', 'trialing', 'past_due', 'unpaid') then
            coalesce(case p_interval when 'month' then 'monthly' when 'year' then 'yearly' end,
                     case when c.plan in ('monthly', 'yearly') then c.plan end,
                     case when c.founding_until >= current_date then 'founding' end)
          when c.founding_until >= current_date then 'founding'
        end;
        new_pds := case
          when new_status in ('past_due', 'unpaid') then coalesce(c.past_due_since, failed_at)
          when new_status in ('active', 'trialing') and p_payment_failed then coalesce(c.past_due_since, failed_at)
        end;
        new_end := case when p_subscription is not null then p_period_end end;
        new_cancel := p_subscription is not null and coalesce(p_cancel_at_period_end, false);

        changed := c.subscription_status is distinct from new_status or c.plan is distinct from new_plan
                   or c.past_due_since is distinct from new_pds or c.current_period_end is distinct from new_end
                   or c.cancel_at_period_end is distinct from new_cancel;
        if changed then
          update public.counselors
             set subscription_status = new_status, plan = new_plan, past_due_since = new_pds,
                 current_period_end = new_end, cancel_at_period_end = new_cancel
           where id = cid;
        end if;
        update cc_private.counselor_billing
           set stripe_customer_id = case
                 when stripe_customer_id is null and p_customer is not null
                      and not exists (select 1 from cc_private.counselor_billing o where o.stripe_customer_id = p_customer)
                 then p_customer else stripe_customer_id end,
               stripe_subscription_id = coalesce(p_subscription, stripe_subscription_id),
               stripe_price_id = coalesce(p_price, stripe_price_id),
               synced_at = observed, updated_at = now()
         where counselor_id = cid;
        res := case when changed then 'applied' else 'unchanged' end;
      end if;
    end if;
  end if;

  if p_event_id is not null then update cc_private.stripe_events set result = res where id = p_event_id; end if;
  select * into c from public.counselors where id = cid;
  return jsonb_build_object('result', res, 'counselor_id', cid, 'subscription_status', c.subscription_status,
                            'plan', c.plan, 'past_due_since', c.past_due_since,
                            'listed', case when cid is not null then cc_private.counselor_listed(c) end);
end $$;

-- ───────────────────────────── storage: counselor photos ─────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('counselor-photos', 'counselor-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Public bucket: anyone can fetch /object/public/counselor-photos/... by URL (no listing policy needed).
-- Signed-in users can read/write only inside their own <uid>/ folder.
drop policy if exists "counselor photos: owner reads" on storage.objects;
create policy "counselor photos: owner reads" on storage.objects for select to authenticated
  using (bucket_id = 'counselor-photos' and (storage.foldername(name))[1] = (select auth.uid()::text));
drop policy if exists "counselor photos: owner uploads" on storage.objects;
create policy "counselor photos: owner uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'counselor-photos' and (storage.foldername(name))[1] = (select auth.uid()::text));
drop policy if exists "counselor photos: owner updates" on storage.objects;
create policy "counselor photos: owner updates" on storage.objects for update to authenticated
  using (bucket_id = 'counselor-photos' and (storage.foldername(name))[1] = (select auth.uid()::text))
  with check (bucket_id = 'counselor-photos' and (storage.foldername(name))[1] = (select auth.uid()::text));
drop policy if exists "counselor photos: owner deletes" on storage.objects;
create policy "counselor photos: owner deletes" on storage.objects for delete to authenticated
  using (bucket_id = 'counselor-photos' and (storage.foldername(name))[1] = (select auth.uid()::text));

-- ───────────────────────────── function privileges ─────────────────────────────
-- Supabase grants EXECUTE on new public functions to anon/authenticated by default: revoke, then grant
-- exactly what each caller needs.
revoke all on function public.counselors_guard() from public, anon, authenticated;
revoke all on function public.is_admin() from public, anon, authenticated;
revoke all on function public.counselor_directory(text, text[]) from public, anon, authenticated;
revoke all on function public.report_counselor(uuid, text, text) from public, anon, authenticated;
revoke all on function public.accept_counselor_terms() from public, anon, authenticated;
revoke all on function public.submit_counselor_for_review() from public, anon, authenticated;
revoke all on function public.admin_counselors(text) from public, anon, authenticated;
revoke all on function public.admin_review_counselor(uuid, text, text, date, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_counselor_reports() from public, anon, authenticated;
revoke all on function public.billing_counselor_for_user(uuid) from public, anon, authenticated;
revoke all on function public.billing_attach_customer(uuid, text) from public, anon, authenticated;
revoke all on function public.billing_reconcile_targets() from public, anon, authenticated;
revoke all on function public.billing_apply_subscription(text, text, text, timestamptz, uuid, text, text, text, text, text,
                                                         timestamptz, boolean, boolean, timestamptz) from public, anon, authenticated;
revoke all on all functions in schema cc_private from public, anon, authenticated;

grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.counselor_directory(text, text[]) to anon, authenticated;
grant execute on function public.report_counselor(uuid, text, text) to anon, authenticated;
grant execute on function public.accept_counselor_terms() to authenticated;
grant execute on function public.submit_counselor_for_review() to authenticated;
grant execute on function public.admin_counselors(text) to authenticated;
grant execute on function public.admin_review_counselor(uuid, text, text, date, timestamptz) to authenticated;
grant execute on function public.admin_counselor_reports() to authenticated;
grant execute on function public.billing_counselor_for_user(uuid) to service_role;
grant execute on function public.billing_attach_customer(uuid, text) to service_role;
grant execute on function public.billing_reconcile_targets() to service_role;
grant execute on function public.billing_apply_subscription(text, text, text, timestamptz, uuid, text, text, text, text, text,
                                                            timestamptz, boolean, boolean, timestamptz) to service_role;
