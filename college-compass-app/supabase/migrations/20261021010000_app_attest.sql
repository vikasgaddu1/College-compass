-- Tierwise — Apple App Attest for shared-research contributions (monitor mode first).
--
-- The `attest` Edge Function (supabase/functions/attest) verifies App Attest attestations and
-- assertions (CBOR + X.509 chain to Apple's App Attestation Root CA — not practical in SQL) and then
-- calls the service-role-only functions below. The app's publishable key can execute none of them.
--
--   attest_new_challenge(challenge, purpose, ip)     single-use challenge, 5 minutes, per-address limit
--   attest_register_key(...)                         stores a verified key (public key, counter 0)
--   attest_key_info(key_id)                          public key + counter for assertion checks
--   contribute_research_attested(payload, key_id, counter, challenge)
--                                                    consumes the challenge, advances the counter
--                                                    atomically, then the usual contribution logic
--                                                    with the contribution marked attested
--
-- Rollout: cc_private.settings.require_attest (default false) = MONITOR MODE. The anonymous
-- public.contribute_research keeps working exactly as before and every contribution records whether
-- it was attested, so adoption can be watched. With require_attest = true (ENFORCE MODE) the
-- anonymous RPC rejects with 'attestation_required' and consensus counts distinct attested keys.
--   Flip: update cc_private.settings set require_attest = true;
-- Development (Xcode-built) keys are refused unless attest_allow_development is true.
--
-- Nothing personal is stored: a key ID is a hash of a public key generated in the device's Secure
-- Enclave for this app only; contributions keep only its salted hash. Challenges keep only a salted
-- hash of the network address (deleted after a day, like the contribution rate limit).

alter table cc_private.settings add column if not exists require_attest boolean not null default false;
alter table cc_private.settings add column if not exists attest_allow_development boolean not null default false;

create table if not exists cc_private.attest_challenges (
  challenge_hash  text primary key,                        -- hex SHA-256 of the challenge
  purpose         text not null check (purpose in ('attest', 'assert')),
  ip_hash         text not null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  used_at         timestamptz
);
create index if not exists attest_challenges_ip on cc_private.attest_challenges (ip_hash, created_at);
create index if not exists attest_challenges_expiry on cc_private.attest_challenges (expires_at);

create table if not exists cc_private.app_attest_keys (
  key_id               text primary key check (key_id ~ '^[A-Za-z0-9+/]{43}=$'),  -- Apple's key identifier: base64 SHA-256 of the public key
  key_hash             text not null unique,                 -- salted hash recorded on contributions
  public_key           text not null,                        -- base64 uncompressed P-256 point (verified by the Edge Function)
  environment          text not null check (environment in ('production', 'development')),
  counter              bigint not null default 0 check (counter >= 0),
  receipt              text,                                 -- base64 App Attest receipt (for Apple's fraud metric, later)
  validation_category  integer,
  bundle_version       text,
  revoked              boolean not null default false,       -- set by hand to stop a key
  created_at           timestamptz not null default now(),
  last_used_at         timestamptz
);

alter table cc_private.settings enable row level security;
alter table cc_private.attest_challenges enable row level security;
alter table cc_private.app_attest_keys enable row level security;
-- No policies: only the functions below (security definer, owned by the migration role) touch them.

alter table public.contributions add column if not exists attested boolean not null default false;
alter table public.contributions add column if not exists attest_key_hash text;
create index if not exists contributions_attested on public.contributions (unitid, kind, cycle, major_area, created_at desc) where attested;

-- ───────────────────────────── shared contribution logic ─────────────────────────────
-- Shape checks, unchanged from 20261020010000_contributions.sql.
create or replace function cc_private.contribution_shape_error(payload jsonb)
returns text language plpgsql immutable as $$
begin
  if payload is null or octet_length(payload::text) > 60000 then return 'too_large'; end if;
  if coalesce(payload ->> 'install_id', '') !~ '^[0-9a-fA-F-]{32,36}$' then return 'bad_install_id'; end if;
  if coalesce(payload ->> 'cycle', '') !~ '^Fall 20[2-4][0-9]( entry)?$' then return 'bad_cycle'; end if;
  if jsonb_typeof(payload -> 'college') <> 'object' then return 'no_college'; end if;
  return null;
end $$;

-- Everything after the caller's identity/rate checks: match, sanitize, quarantine, consensus, publish.
-- Monitor mode: consensus = distinct installs (as before). Enforce mode: distinct attested keys
-- (and installs), counting attested contributions only.
create or replace function cc_private.contribute_core(payload jsonb, inst_hash text, p_attested boolean, p_key_hash text)
returns jsonb
language plpgsql
set search_path = public, cc_private, pg_temp
as $$
declare
  cyc text := regexp_replace(payload ->> 'cycle', ' entry$', '');
  raw jsonb := payload -> 'college';
  v_require boolean;
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
  select s.require_attest into v_require from cc_private.settings s;
  v_require := coalesce(v_require, false);
  if v_require and not (p_attested and p_key_hash is not null) then
    return jsonb_build_object('status', 'rejected', 'reason', 'attestation_required');
  end if;

  -- Which college?
  select m.unitid into unit from public.match_colleges(array[raw ->> 'name'],
    array[case when (raw ->> 'state') ~ '^[A-Z]{2}$' then raw ->> 'state' end]) m;
  if unit is null then return jsonb_build_object('status', 'rejected', 'reason', 'unknown_college'); end if;

  clean := cc_private.check_against_federal(unit, cc_private.sanitize_college(raw));
  insert into public.contributions (unitid, name, cycle, payload, app_version, install_hash, kind, attested, attest_key_hash)
    values (unit, left(raw ->> 'name', 160), cyc, clean, left(payload ->> 'app_version', 40), inst_hash, 'research', p_attested, p_key_hash);

  -- Consensus: distinct installs (monitor) or distinct attested keys (enforce), including this one.
  if v_require then
    select 1 + count(distinct c.attest_key_hash) into agreeing
      from public.contributions c
     where c.kind = 'research' and c.unitid = unit and c.cycle = cyc and c.attested
       and c.attest_key_hash <> p_key_hash and c.install_hash <> inst_hash
       and c.created_at > now() - interval '180 days' and c.status <> 'rejected'
       and cc_private.research_agrees(c.payload, clean);
  else
    select 1 + count(distinct c.install_hash) into agreeing
      from public.contributions c
     where c.kind = 'research' and c.unitid = unit and c.cycle = cyc and c.install_hash <> inst_hash
       and c.created_at > now() - interval '180 days' and c.status <> 'rejected'
       and cc_private.research_agrees(c.payload, clean);
  end if;
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
    insert into public.contributions (unitid, name, cycle, payload, app_version, install_hash, kind, major_area, attested, attest_key_hash)
      values (unit, left(raw ->> 'name', 160), cyc, prog_clean, left(payload ->> 'app_version', 40), inst_hash, 'program', prog_major, p_attested, p_key_hash);
    if v_require then
      select 1 + count(distinct c.attest_key_hash) into agreeing
        from public.contributions c
       where c.kind = 'program' and c.unitid = unit and c.major_area = prog_major and c.attested
         and c.attest_key_hash <> p_key_hash and c.install_hash <> inst_hash
         and c.created_at > now() - interval '18 months' and c.status <> 'rejected'
         and (c.payload -> 'offered') = (prog_clean -> 'offered');
    else
      select 1 + count(distinct c.install_hash) into agreeing
        from public.contributions c
       where c.kind = 'program' and c.unitid = unit and c.major_area = prog_major and c.install_hash <> inst_hash
         and c.created_at > now() - interval '18 months' and c.status <> 'rejected'
         and (c.payload -> 'offered') = (prog_clean -> 'offered');
    end if;
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

-- ───────────────────────────── anonymous RPC (unchanged behaviour in monitor mode) ─────────────────────────────
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
  v_salt text;
  v_require boolean;
  cnt int;
  err text;
begin
  err := cc_private.contribution_shape_error(payload);
  if err is not null then return jsonb_build_object('status', 'rejected', 'reason', err); end if;

  -- Rate limit per network address (salted hash, kept two days).
  select s.salt, s.require_attest into v_salt, v_require from cc_private.settings s;
  begin headers := current_setting('request.headers', true)::json; exception when others then headers := null; end;
  v_ip := coalesce(nullif(split_part(headers ->> 'x-forwarded-for', ',', 1), ''), headers ->> 'cf-connecting-ip', 'unknown');
  v_ip_hash := encode(sha256(convert_to(v_salt || trim(v_ip), 'UTF8')), 'hex');
  insert into cc_private.rate (ip_hash, hour, n) values (v_ip_hash, date_trunc('hour', now()), 1)
    on conflict (ip_hash, hour) do update set n = cc_private.rate.n + 1 returning n into cnt;
  if random() < 0.01 then delete from cc_private.rate where hour < now() - interval '2 days'; end if;
  if cnt > 120 then return jsonb_build_object('status', 'rejected', 'reason', 'rate_limited'); end if;

  if coalesce(v_require, false) then return jsonb_build_object('status', 'rejected', 'reason', 'attestation_required'); end if;

  return cc_private.contribute_core(payload, encode(sha256(convert_to(v_salt || lower(payload ->> 'install_id'), 'UTF8')), 'hex'), false, null);
end $$;

-- ───────────────────────────── service-role-only functions for the Edge Function ─────────────────────────────
create or replace function public.attest_new_challenge(p_challenge text, p_purpose text, p_ip text)
returns jsonb
language plpgsql
security definer
set search_path = public, cc_private, pg_temp
as $$
declare
  v_salt text;
  v_ip_hash text;
  cnt int;
begin
  if coalesce(p_challenge, '') !~ '^[A-Za-z0-9_-]{43}$' or coalesce(p_purpose, '') not in ('attest', 'assert') then
    return jsonb_build_object('status', 'rejected', 'reason', 'bad_request');
  end if;
  select s.salt into v_salt from cc_private.settings s;
  v_ip_hash := encode(sha256(convert_to(v_salt || trim(coalesce(nullif(p_ip, ''), 'unknown')), 'UTF8')), 'hex');
  select count(*) into cnt from cc_private.attest_challenges where ip_hash = v_ip_hash and created_at > now() - interval '1 hour';
  if cnt >= 600 then return jsonb_build_object('status', 'rejected', 'reason', 'rate_limited'); end if;
  if random() < 0.02 then delete from cc_private.attest_challenges where expires_at < now() - interval '1 day'; end if;
  insert into cc_private.attest_challenges (challenge_hash, purpose, ip_hash, expires_at)
    values (encode(sha256(convert_to(p_challenge, 'UTF8')), 'hex'), p_purpose, v_ip_hash, now() + interval '5 minutes')
    on conflict (challenge_hash) do nothing;
  if not found then return jsonb_build_object('status', 'rejected', 'reason', 'bad_request'); end if;
  return jsonb_build_object('status', 'ok', 'expires_in', 300);
end $$;

-- Single use: marks the challenge used; true only if it existed, was unused, unexpired and for `purpose`.
create or replace function cc_private.consume_challenge(p_challenge text, p_purpose text)
returns boolean language plpgsql
set search_path = public, cc_private, pg_temp
as $$
begin
  update cc_private.attest_challenges set used_at = now()
   where challenge_hash = encode(sha256(convert_to(coalesce(p_challenge, ''), 'UTF8')), 'hex')
     and purpose = p_purpose and used_at is null and expires_at > now();
  return found;
end $$;

create or replace function public.attest_register_key(p_key_id text, p_public_key text, p_environment text, p_receipt text,
  p_challenge text, p_validation_category integer default null, p_bundle_version text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, cc_private, pg_temp
as $$
declare
  v_salt text;
  v_allow_dev boolean;
begin
  if coalesce(p_key_id, '') !~ '^[A-Za-z0-9+/]{43}=$' or coalesce(p_public_key, '') !~ '^[A-Za-z0-9+/]{87}=$'
     or coalesce(p_environment, '') not in ('production', 'development') then
    return jsonb_build_object('status', 'rejected', 'reason', 'bad_request');
  end if;
  if not cc_private.consume_challenge(p_challenge, 'attest') then
    return jsonb_build_object('status', 'rejected', 'reason', 'bad_challenge');
  end if;
  select s.salt, s.attest_allow_development into v_salt, v_allow_dev from cc_private.settings s;
  if p_environment = 'development' and not coalesce(v_allow_dev, false) then
    return jsonb_build_object('status', 'rejected', 'reason', 'development_not_allowed');
  end if;
  insert into cc_private.app_attest_keys (key_id, key_hash, public_key, environment, receipt, validation_category, bundle_version)
    values (p_key_id, encode(sha256(convert_to(v_salt || 'attest-key:' || p_key_id, 'UTF8')), 'hex'), p_public_key, p_environment,
            left(p_receipt, 20000), p_validation_category, left(p_bundle_version, 64))
    on conflict (key_id) do nothing;
  if not found then return jsonb_build_object('status', 'rejected', 'reason', 'key_exists'); end if;
  return jsonb_build_object('status', 'registered', 'environment', p_environment);
end $$;

create or replace function public.attest_key_info(p_key_id text)
returns jsonb
language sql
stable
security definer
set search_path = public, cc_private, pg_temp
as $$
  select jsonb_build_object('public_key', k.public_key, 'counter', k.counter, 'environment', k.environment, 'revoked', k.revoked)
    from cc_private.app_attest_keys k where k.key_id = p_key_id
$$;

create or replace function public.contribute_research_attested(payload jsonb, p_key_id text, p_counter bigint, p_challenge text)
returns jsonb
language plpgsql
security definer
set search_path = public, cc_private, pg_temp
as $$
declare
  k cc_private.app_attest_keys%rowtype;
  v_salt text;
  cnt int;
  err text;
begin
  -- The Edge Function verified the assertion signature with this key's public key; here: the
  -- challenge inside the signed client data is fresh and single use, and the counter advances.
  if not cc_private.consume_challenge(p_challenge, 'assert') then
    return jsonb_build_object('status', 'rejected', 'reason', 'bad_challenge');
  end if;
  update cc_private.app_attest_keys set counter = p_counter, last_used_at = now()
   where key_id = p_key_id and not revoked and counter < p_counter
   returning * into k;
  if not found then
    select * into k from cc_private.app_attest_keys where key_id = p_key_id;
    if not found then return jsonb_build_object('status', 'rejected', 'reason', 'unknown_key'); end if;
    if k.revoked then return jsonb_build_object('status', 'rejected', 'reason', 'revoked_key'); end if;
    return jsonb_build_object('status', 'rejected', 'reason', 'replay');
  end if;

  err := cc_private.contribution_shape_error(payload);
  if err is not null then return jsonb_build_object('status', 'rejected', 'reason', err); end if;

  -- Rate limit per attested key (requests arrive from the Edge Function's address, not the device's).
  insert into cc_private.rate (ip_hash, hour, n) values ('key:' || k.key_hash, date_trunc('hour', now()), 1)
    on conflict (ip_hash, hour) do update set n = cc_private.rate.n + 1 returning n into cnt;
  if cnt > 120 then return jsonb_build_object('status', 'rejected', 'reason', 'rate_limited'); end if;

  select s.salt into v_salt from cc_private.settings s;
  return cc_private.contribute_core(payload, encode(sha256(convert_to(v_salt || lower(payload ->> 'install_id'), 'UTF8')), 'hex'), true, k.key_hash)
         || jsonb_build_object('attested', true);
end $$;

-- ───────────────────────────── privileges ─────────────────────────────
revoke all on function public.contribute_research(jsonb) from public;
grant execute on function public.contribute_research(jsonb) to anon, authenticated;

revoke all on function public.attest_new_challenge(text, text, text) from public, anon, authenticated;
revoke all on function public.attest_register_key(text, text, text, text, text, integer, text) from public, anon, authenticated;
revoke all on function public.attest_key_info(text) from public, anon, authenticated;
revoke all on function public.contribute_research_attested(jsonb, text, bigint, text) from public, anon, authenticated;
grant execute on function public.attest_new_challenge(text, text, text) to service_role;
grant execute on function public.attest_register_key(text, text, text, text, text, integer, text) to service_role;
grant execute on function public.attest_key_info(text) to service_role;
grant execute on function public.contribute_research_attested(jsonb, text, bigint, text) to service_role;

revoke all on table public.contributions from anon, authenticated;
revoke all on all tables in schema cc_private from public, anon, authenticated;
revoke all on all functions in schema cc_private from public, anon, authenticated;
