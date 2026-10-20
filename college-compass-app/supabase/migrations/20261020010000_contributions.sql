-- College Compass — research contributions and consensus publishing.
--
-- After a student's research finishes, the app calls public.contribute_research(payload) with the
-- structured college fields only (no profile, notes, names or ChatGPT data). This function:
--   1. checks size and shape, and limits each network address (stored only as a salted hash,
--      kept two days) to 120 contributions an hour;
--   2. matches the college to its federal ID and keeps only whitelisted, range-checked fields,
--      dropping any figure far from federal College Scorecard data;
--   3. stores it in `contributions` (quarantine — never readable by apps);
--   4. publishes to college_research / college_programs only when contributions from at least two
--      different app installs agree on the key facts. Apps read only published rows.
-- The install ID is a random per-install UUID, stored only as a salted hash; it is not linked to
-- any person, account or device identifier.

create schema if not exists cc_private;
revoke all on schema cc_private from public, anon, authenticated;

create table if not exists cc_private.settings (
  id    boolean primary key default true check (id),
  salt  text not null default (gen_random_uuid()::text || gen_random_uuid()::text)
);
insert into cc_private.settings default values on conflict do nothing;

create table if not exists cc_private.rate (
  ip_hash  text not null,
  hour     timestamptz not null,
  n        integer not null default 0,
  primary key (ip_hash, hour)
);

alter table public.contributions add column if not exists install_hash text;
alter table public.contributions add column if not exists kind text not null default 'research' check (kind in ('research', 'program'));
alter table public.contributions add column if not exists major_area text;
create index if not exists contributions_lookup on public.contributions (unitid, kind, cycle, major_area, created_at desc);

-- ───────────────────────────── helpers ─────────────────────────────
create or replace function cc_private.num(j jsonb, k text, lo numeric, hi numeric)
returns numeric language sql immutable as $$
  select case when jsonb_typeof(j -> k) = 'number' and (j ->> k)::numeric between lo and hi then (j ->> k)::numeric end
$$;

create or replace function cc_private.txt(j jsonb, k text, maxlen int)
returns text language sql immutable as $$
  select case when jsonb_typeof(j -> k) = 'string' and length(j ->> k) between 1 and maxlen then j ->> k end
$$;

-- Keep a small list of {title, url} objects with http(s) URLs.
create or replace function cc_private.sources(j jsonb)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object('title', left(s ->> 'title', 160), 'url', left(s ->> 'url', 500))), '[]'::jsonb)
  from (
    select s from jsonb_array_elements(case when jsonb_typeof(j) = 'array' then j else '[]'::jsonb end) s
    where jsonb_typeof(s) = 'object' and (s ->> 'url') ~ '^https?://' limit 20
  ) t
$$;

-- Whitelisted, range-checked copy of the researched college fields.
create or replace function cc_private.sanitize_college(c jsonb)
returns jsonb language plpgsql immutable as $$
declare
  out jsonb := '{}'::jsonb;
  sat25 numeric := cc_private.num(c, 'sat_25', 400, 1600);
  sat75 numeric := cc_private.num(c, 'sat_75', 400, 1600);
  act25 numeric := cc_private.num(c, 'act_25', 1, 36);
  act75 numeric := cc_private.num(c, 'act_75', 1, 36);
  npi jsonb := '{}'::jsonb;
  band text;
  app jsonb;
  plans jsonb := '[]'::jsonb;
  sch jsonb := '[]'::jsonb;
  cds jsonb := '{}'::jsonb;
begin
  out := jsonb_strip_nulls(jsonb_build_object(
    'name', cc_private.txt(c, 'name', 160),
    'short', cc_private.txt(c, 'short', 40),
    'city', cc_private.txt(c, 'city', 80),
    'state', case when (c ->> 'state') ~ '^[A-Z]{2}$' then c ->> 'state' end,
    'ownership', case when c ->> 'ownership' in ('public', 'private_nonprofit') then c ->> 'ownership' end,
    'url', case when (c ->> 'url') ~ '^https?://' then left(c ->> 'url', 300) end,
    'admit_rate', cc_private.num(c, 'admit_rate', 0.005, 1),
    'test_policy', case when c ->> 'test_policy' in ('required', 'optional', 'blind', 'considered', 'unknown') then c ->> 'test_policy' end,
    'tuition_in_state', cc_private.num(c, 'tuition_in_state', 0, 150000),
    'tuition_out_of_state', cc_private.num(c, 'tuition_out_of_state', 0, 150000),
    'cost_of_attendance', cc_private.num(c, 'cost_of_attendance', 0, 200000),
    'cost_of_attendance_basis', case when c ->> 'cost_of_attendance_basis' in ('out_of_state', 'in_state', 'same') then c ->> 'cost_of_attendance_basis' end,
    'avg_net_price', cc_private.num(c, 'avg_net_price', 0, 150000),
    'grad_rate_6yr', cc_private.num(c, 'grad_rate_6yr', 0, 1),
    'retention_rate', cc_private.num(c, 'retention_rate', 0, 1),
    'median_earnings_10yr', cc_private.num(c, 'median_earnings_10yr', 0, 500000),
    'undergrad_size', cc_private.num(c, 'undergrad_size', 0, 200000),
    'data_year', cc_private.txt(c, 'data_year', 120),
    'data_confidence', case when c ->> 'data_confidence' in ('high', 'medium', 'low') then c ->> 'data_confidence' end
  ));
  if sat25 is not null and sat75 is not null and sat25 <= sat75 then out := out || jsonb_build_object('sat_25', sat25, 'sat_75', sat75); end if;
  if act25 is not null and act75 is not null and act25 <= act75 then out := out || jsonb_build_object('act_25', act25, 'act_75', act75); end if;

  foreach band in array array['0_30k', '30_48k', '48_75k', '75_110k', '110k_plus'] loop
    npi := npi || jsonb_build_object(band, cc_private.num(c -> 'net_price_by_income', band, 0, 150000));
  end loop;
  out := out || jsonb_build_object('net_price_by_income', npi);

  if jsonb_typeof(c -> 'cds') = 'object' then
    cds := jsonb_strip_nulls(jsonb_build_object(
      'cds_year', cc_private.txt(c -> 'cds', 'cds_year', 40),
      'ed_admit_rate', cc_private.num(c -> 'cds', 'ed_admit_rate', 0.005, 1),
      'ea_admit_rate', cc_private.num(c -> 'cds', 'ea_admit_rate', 0.005, 1),
      'rd_admit_rate', cc_private.num(c -> 'cds', 'rd_admit_rate', 0.005, 1),
      'offers_ed', case when jsonb_typeof(c -> 'cds' -> 'offers_ed') = 'boolean' then c -> 'cds' -> 'offers_ed' end,
      'offers_ea', case when jsonb_typeof(c -> 'cds' -> 'offers_ea') = 'boolean' then c -> 'cds' -> 'offers_ea' end,
      'in_state_admit_rate', cc_private.num(c -> 'cds', 'in_state_admit_rate', 0.005, 1),
      'out_of_state_admit_rate', cc_private.num(c -> 'cds', 'out_of_state_admit_rate', 0.005, 1),
      'avg_gpa', cc_private.num(c -> 'cds', 'avg_gpa', 1, 5),
      'gated_majors', case when jsonb_typeof(c -> 'cds' -> 'gated_majors') = 'array' then c -> 'cds' -> 'gated_majors' end,
      'source_url', case when (c -> 'cds' ->> 'source_url') ~ '^https?://' then left(c -> 'cds' ->> 'source_url', 500) end
    ));
    out := out || jsonb_build_object('cds', cds);
  end if;

  app := c -> 'application';
  if jsonb_typeof(app) = 'object' then
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'plan', p ->> 'plan',
             'deadline', case when (p ->> 'deadline') ~ '^\d{4}-\d{2}-\d{2}$' then p ->> 'deadline' end,
             'notes', left(p ->> 'notes', 300)))), '[]'::jsonb)
      into plans
      from (select p from jsonb_array_elements(case when jsonb_typeof(app -> 'plans') = 'array' then app -> 'plans' else '[]' end) p
            where p ->> 'plan' in ('ED', 'ED2', 'EA', 'REA', 'RD', 'Rolling', 'Priority') limit 8) t;
    out := out || jsonb_build_object('application', jsonb_strip_nulls(jsonb_build_object(
      'cycle', cc_private.txt(app, 'cycle', 60),
      'plans', plans,
      'test_policy_note', cc_private.txt(app, 'test_policy_note', 400),
      'essays_note', cc_private.txt(app, 'essays_note', 400),
      'fee', cc_private.txt(app, 'fee', 80))));
  end if;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name', left(s ->> 'name', 160), 'amount', left(s ->> 'amount', 120), 'note', left(s ->> 'note', 300)))), '[]'::jsonb)
    into sch
    from (select s from jsonb_array_elements(case when jsonb_typeof(c -> 'scholarships') = 'array' then c -> 'scholarships' else '[]' end) s
          where jsonb_typeof(s -> 'name') = 'string' limit 12) t;
  out := out || jsonb_build_object('scholarships', sch, 'sources', cc_private.sources(c -> 'sources'));
  return out;
end $$;

-- Drop figures that are far from federal data (likely a research mistake or tampering).
create or replace function cc_private.check_against_federal(unit text, c jsonb)
returns jsonb language plpgsql stable as $$
declare s public.college_stats%rowtype;
begin
  select * into s from public.college_stats where unitid = unit and source = 'scorecard';
  if not found then return c; end if;
  if s.admit_rate is not null and c ? 'admit_rate' and abs((c ->> 'admit_rate')::numeric - s.admit_rate) > 0.15 then c := c - 'admit_rate'; end if;
  if s.sat_25 is not null and c ? 'sat_25' and abs((c ->> 'sat_25')::numeric - s.sat_25) > 150 then c := c - 'sat_25' - 'sat_75'; end if;
  if s.tuition_out_of_state is not null and s.tuition_out_of_state > 0 and c ? 'tuition_out_of_state'
     and ((c ->> 'tuition_out_of_state')::numeric / s.tuition_out_of_state not between 0.6 and 1.7) then c := c - 'tuition_out_of_state'; end if;
  if s.tuition_in_state is not null and s.tuition_in_state > 0 and c ? 'tuition_in_state'
     and ((c ->> 'tuition_in_state')::numeric / s.tuition_in_state not between 0.6 and 1.7) then c := c - 'tuition_in_state'; end if;
  return c;
end $$;

-- Do two researched records agree on the key facts? Needs at least two comparable facts and no conflict.
create or replace function cc_private.research_agrees(a jsonb, b jsonb)
returns boolean language plpgsql immutable as $$
declare
  compared int := 0;
  pa text[]; pb text[];
  p jsonb; q jsonb;
begin
  if a ? 'admit_rate' and b ? 'admit_rate' then
    compared := compared + 1;
    if abs((a ->> 'admit_rate')::numeric - (b ->> 'admit_rate')::numeric) > 0.02 then return false; end if;
  end if;
  if coalesce(a ->> 'test_policy', 'unknown') <> 'unknown' and coalesce(b ->> 'test_policy', 'unknown') <> 'unknown' then
    compared := compared + 1;
    if a ->> 'test_policy' <> b ->> 'test_policy' then return false; end if;
  end if;
  if a ? 'sat_25' and b ? 'sat_25' then
    compared := compared + 1;
    if abs((a ->> 'sat_25')::numeric - (b ->> 'sat_25')::numeric) > 30 or abs((a ->> 'sat_75')::numeric - (b ->> 'sat_75')::numeric) > 30 then return false; end if;
  end if;
  select array_agg(distinct x ->> 'plan' order by x ->> 'plan') into pa from jsonb_array_elements(coalesce(a -> 'application' -> 'plans', '[]')) x;
  select array_agg(distinct x ->> 'plan' order by x ->> 'plan') into pb from jsonb_array_elements(coalesce(b -> 'application' -> 'plans', '[]')) x;
  if pa is not null and pb is not null then
    compared := compared + 1;
    if pa <> pb then return false; end if;
    for p in select * from jsonb_array_elements(a -> 'application' -> 'plans') loop
      for q in select * from jsonb_array_elements(b -> 'application' -> 'plans') loop
        if p ->> 'plan' = q ->> 'plan' and p ? 'deadline' and q ? 'deadline' and p ->> 'deadline' <> q ->> 'deadline' then return false; end if;
      end loop;
    end loop;
  end if;
  return compared >= 2;
end $$;

-- ───────────────────────────── the RPC ─────────────────────────────
create or replace function public.contribute_research(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, cc_private, pg_temp
as $$
declare
  headers json;
  v_ip text;
  v_ip_hash text;
  inst_hash text;
  v_salt text;
  cnt int;
  cyc text := payload ->> 'cycle';
  raw jsonb := payload -> 'college';
  unit text;
  clean jsonb;
  agreeing int;
  research_status text := 'pending';
  prog jsonb;
  prog_clean jsonb;
  prog_major text;
  prog_published int := 0;
  allowed_majors text[] := array['computer_science','engineering','robotics_mechatronics','math_stats','physical_sciences','biology','health',
    'business','economics_social','psychology','communication','english_humanities','arts_design','education','data_science','nursing',
    'public_health','political_science_law','environmental_science','architecture','performing_arts','film_media','history_philosophy',
    'languages_international','agriculture_food','kinesiology_sports','aerospace'];
begin
  if payload is null or octet_length(payload::text) > 60000 then return jsonb_build_object('status', 'rejected', 'reason', 'too_large'); end if;
  if coalesce(payload ->> 'install_id', '') !~ '^[0-9a-fA-F-]{32,36}$' then return jsonb_build_object('status', 'rejected', 'reason', 'bad_install_id'); end if;
  if coalesce(cyc, '') !~ '^Fall 20[2-4][0-9]( entry)?$' then return jsonb_build_object('status', 'rejected', 'reason', 'bad_cycle'); end if;
  cyc := regexp_replace(cyc, ' entry$', '');
  if jsonb_typeof(raw) <> 'object' then return jsonb_build_object('status', 'rejected', 'reason', 'no_college'); end if;

  -- Rate limit per network address (salted hash, kept two days).
  select s.salt into v_salt from cc_private.settings s;
  begin headers := current_setting('request.headers', true)::json; exception when others then headers := null; end;
  v_ip := coalesce(nullif(split_part(headers ->> 'x-forwarded-for', ',', 1), ''), headers ->> 'cf-connecting-ip', 'unknown');
  v_ip_hash := encode(sha256(convert_to(v_salt || trim(v_ip), 'UTF8')), 'hex');
  insert into cc_private.rate (ip_hash, hour, n) values (v_ip_hash, date_trunc('hour', now()), 1)
    on conflict (ip_hash, hour) do update set n = cc_private.rate.n + 1 returning n into cnt;
  if random() < 0.01 then delete from cc_private.rate where hour < now() - interval '2 days'; end if;
  if cnt > 120 then return jsonb_build_object('status', 'rejected', 'reason', 'rate_limited'); end if;
  inst_hash := encode(sha256(convert_to(v_salt || lower(payload ->> 'install_id'), 'UTF8')), 'hex');

  -- Which college?
  select m.unitid into unit from public.match_colleges(array[raw ->> 'name'],
    array[case when (raw ->> 'state') ~ '^[A-Z]{2}$' then raw ->> 'state' end]) m;
  if unit is null then return jsonb_build_object('status', 'rejected', 'reason', 'unknown_college'); end if;

  clean := cc_private.check_against_federal(unit, cc_private.sanitize_college(raw));
  insert into public.contributions (unitid, name, cycle, payload, app_version, install_hash, kind)
    values (unit, left(raw ->> 'name', 160), cyc, clean, left(payload ->> 'app_version', 40), inst_hash, 'research');

  -- Consensus: distinct installs (including this one) whose recent research agrees with this one.
  select 1 + count(distinct c.install_hash) into agreeing
    from public.contributions c
   where c.kind = 'research' and c.unitid = unit and c.cycle = cyc and c.install_hash <> inst_hash
     and c.created_at > now() - interval '180 days' and c.status <> 'rejected'
     and cc_private.research_agrees(c.payload, clean);
  if agreeing >= 2 then
    insert into public.college_research (unitid, cycle, data, sources, confidence, status, verified_count, researched_at, stale_after)
      values (unit, cyc, clean, coalesce(clean -> 'sources', '[]'), clean ->> 'data_confidence', 'published', agreeing, now(), now() + interval '6 months')
      on conflict (unitid, cycle) do update
        -- Merge: newer values win, but a field missing from the new record never erases a published one.
        set data = public.college_research.data || excluded.data,
            sources = case when jsonb_array_length(excluded.sources) > 0 then excluded.sources else public.college_research.sources end,
            confidence = coalesce(excluded.confidence, public.college_research.confidence), status = 'published',
            verified_count = greatest(public.college_research.verified_count, excluded.verified_count),
            researched_at = now(), stale_after = excluded.stale_after;
    research_status := 'published';
  end if;

  -- Program notes, one per major area.
  for prog in select * from jsonb_array_elements(case when jsonb_typeof(payload -> 'programs') = 'array' then payload -> 'programs' else '[]' end) limit 6 loop
    prog_major := prog ->> 'major';
    continue when prog_major is null or not (prog_major = any (allowed_majors)) or jsonb_typeof(prog -> 'offered') <> 'boolean';
    prog_clean := jsonb_strip_nulls(jsonb_build_object(
      'major', prog_major, 'offered', prog -> 'offered',
      'degree', cc_private.txt(prog, 'degree', 140), 'how_to_enter', cc_private.txt(prog, 'how_to_enter', 300), 'notes', cc_private.txt(prog, 'notes', 500)));
    insert into public.contributions (unitid, name, cycle, payload, app_version, install_hash, kind, major_area)
      values (unit, left(raw ->> 'name', 160), cyc, prog_clean, left(payload ->> 'app_version', 40), inst_hash, 'program', prog_major);
    select 1 + count(distinct c.install_hash) into agreeing
      from public.contributions c
     where c.kind = 'program' and c.unitid = unit and c.major_area = prog_major and c.install_hash <> inst_hash
       and c.created_at > now() - interval '18 months' and c.status <> 'rejected'
       and (c.payload -> 'offered') = (prog_clean -> 'offered');
    if agreeing >= 2 then
      insert into public.college_programs (unitid, major_area, data, sources, status, verified_count, researched_at, stale_after)
        values (unit, prog_major, prog_clean, coalesce(clean -> 'sources', '[]'), 'published', agreeing, now(), now() + interval '18 months')
        on conflict (unitid, major_area) do update
          set data = public.college_programs.data || excluded.data, status = 'published', verified_count = greatest(public.college_programs.verified_count, excluded.verified_count),
              researched_at = now(), stale_after = excluded.stale_after;
      prog_published := prog_published + 1;
    end if;
  end loop;

  return jsonb_build_object('status', 'accepted', 'unitid', unit, 'research', research_status, 'programs_published', prog_published);
end $$;

revoke all on function public.contribute_research(jsonb) from public;
grant execute on function public.contribute_research(jsonb) to anon, authenticated;
