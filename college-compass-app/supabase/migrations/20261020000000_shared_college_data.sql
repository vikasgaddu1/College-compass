-- Tierwise — shared college data (no student or user data, ever).
--
-- What lives here:
--   colleges          one row per institution (IPEDS UNITID), names/aliases and descriptive facts
--   college_stats     federal College Scorecard figures (admissions, cost, net price by income,
--                     outcomes), loaded by a scheduled job; one row per college per source
--   college_research  AI-researched facts for an admissions cycle (plans, deadlines, test policy,
--                     CDS extras, scholarships, sources) — published only after verification
--   college_programs  AI-researched program notes per college × major area
--   contributions     raw research sent by apps, held in quarantine (never readable by apps)
--
-- Access: the app's publishable/anon key can only READ published rows. All writes happen with the
-- service role (the Scorecard job, and later an edge function that validates contributions).

create extension if not exists pg_trgm;

-- ───────────────────────────── colleges ─────────────────────────────
create table if not exists public.colleges (
  unitid          text primary key,                       -- IPEDS UNITID
  name            text not null,
  aliases         text[] not null default '{}',
  city            text,
  state           text,                                   -- 2-letter
  lat             double precision,
  lon             double precision,
  ownership       text check (ownership in ('public', 'private_nonprofit', 'private_forprofit')),
  locale          text check (locale in ('city', 'suburb', 'town', 'rural')),
  url             text,
  undergrad_size  integer,
  hbcu            boolean not null default false,
  women_only      boolean not null default false,
  religious       boolean not null default false,
  active          boolean not null default true,     -- false once it drops out of the federal feed
  name_norm       text generated always as (trim(regexp_replace(lower(name), '[^a-z0-9]+', ' ', 'g'))) stored,
  updated_at      timestamptz not null default now()
);
create index if not exists colleges_name_trgm on public.colleges using gin (name_norm gin_trgm_ops);
create index if not exists colleges_state on public.colleges (state);

-- ───────────────────────────── federal statistics ─────────────────────────────
create table if not exists public.college_stats (
  unitid                    text not null references public.colleges (unitid) on delete cascade,
  source                    text not null default 'scorecard',
  data_year                 text,                         -- e.g. "Scorecard 2023-24"
  admit_rate                numeric,                      -- 0..1
  sat_25                    integer,                      -- composite (EBRW + math)
  sat_75                    integer,
  act_25                    integer,
  act_75                    integer,
  tuition_in_state          integer,
  tuition_out_of_state      integer,
  cost_of_attendance        integer,
  cost_of_attendance_basis  text check (cost_of_attendance_basis in ('out_of_state', 'in_state', 'same')),
  avg_net_price             integer,
  net_price_by_income       jsonb not null default '{}',  -- {"0_30k":…, "30_48k":…, "48_75k":…, "75_110k":…, "110k_plus":…}
  grad_rate_6yr             numeric,
  retention_rate            numeric,
  median_earnings_10yr      integer,
  program_share             jsonb not null default '{}',  -- share of bachelor's degrees by area, 0..1
  fetched_at                timestamptz not null default now(),
  stale_after               timestamptz not null default (now() + interval '13 months'),
  primary key (unitid, source)
);

-- ───────────────────────────── AI research (verified) ─────────────────────────────
create table if not exists public.college_research (
  unitid          text not null references public.colleges (unitid) on delete cascade,
  cycle           text not null,                         -- e.g. "Fall 2027 entry"
  data            jsonb not null,                         -- application plans, test policy, cds extras, scholarships
  sources         jsonb not null default '[]',
  confidence      text check (confidence in ('high', 'medium', 'low')),
  status          text not null default 'quarantine' check (status in ('published', 'quarantine', 'rejected')),
  verified_count  integer not null default 0,
  researched_at   timestamptz not null default now(),
  stale_after     timestamptz not null default (now() + interval '6 months'),
  primary key (unitid, cycle)
);

create table if not exists public.college_programs (
  unitid          text not null references public.colleges (unitid) on delete cascade,
  major_area      text not null,
  data            jsonb not null,                         -- offered, degree, how_to_enter, notes
  sources         jsonb not null default '[]',
  status          text not null default 'quarantine' check (status in ('published', 'quarantine', 'rejected')),
  verified_count  integer not null default 0,
  researched_at   timestamptz not null default now(),
  stale_after     timestamptz not null default (now() + interval '18 months'),
  primary key (unitid, major_area)
);

-- ───────────────────────────── contributions (quarantine) ─────────────────────────────
create table if not exists public.contributions (
  id           uuid primary key default gen_random_uuid(),
  unitid       text references public.colleges (unitid) on delete set null,
  name         text not null,
  cycle        text,
  payload      jsonb not null,                            -- structured college fields only
  app_version  text,
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  reason       text,
  created_at   timestamptz not null default now()
);

-- ───────────────────────────── Row Level Security ─────────────────────────────
alter table public.colleges          enable row level security;
alter table public.college_stats     enable row level security;
alter table public.college_research  enable row level security;
alter table public.college_programs  enable row level security;
alter table public.contributions     enable row level security;

drop policy if exists "read colleges" on public.colleges;
create policy "read colleges" on public.colleges for select to anon, authenticated using (true);

drop policy if exists "read stats" on public.college_stats;
create policy "read stats" on public.college_stats for select to anon, authenticated using (true);

drop policy if exists "read published research" on public.college_research;
create policy "read published research" on public.college_research for select to anon, authenticated using (status = 'published');

drop policy if exists "read published programs" on public.college_programs;
create policy "read published programs" on public.college_programs for select to anon, authenticated using (status = 'published');
-- contributions: no policies → apps can neither read nor write them directly.

-- ───────────────────────────── lookup by name ─────────────────────────────
-- match_colleges(['UNC Chapel Hill', 'Duke'], ['NC', null]) → best match per requested name.
create or replace function public.match_colleges(names text[], states text[] default null)
returns table (requested text, unitid text, name text, state text, similarity real)
language sql stable
set search_path = public, pg_temp
as $$
  with req as (
    select n as requested,
           trim(regexp_replace(lower(n), '[^a-z0-9]+', ' ', 'g')) as norm,
           case when states is null then null else states[i] end as st
    from unnest(names) with ordinality as t(n, i)
  )
  select r.requested, c.unitid, c.name, c.state, best.sim
  from req r
  cross join lateral (
    select c2.unitid, greatest(similarity(c2.name_norm, r.norm),
             coalesce((select max(similarity(trim(regexp_replace(lower(a), '[^a-z0-9]+', ' ', 'g')), r.norm)) from unnest(c2.aliases) a), 0)) as sim
    from public.colleges c2
    where c2.active and (r.st is null or c2.state = r.st)
      and (c2.name_norm % r.norm or exists (select 1 from unnest(c2.aliases) a where trim(regexp_replace(lower(a), '[^a-z0-9]+', ' ', 'g')) % r.norm))
    order by sim desc
    limit 1
  ) best
  join public.colleges c on c.unitid = best.unitid
  where best.sim >= 0.45;
$$;

grant execute on function public.match_colleges(text[], text[]) to anon, authenticated;
grant select on public.colleges, public.college_stats, public.college_research, public.college_programs to anon, authenticated;
