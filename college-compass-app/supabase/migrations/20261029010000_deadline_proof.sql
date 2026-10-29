-- Tierwise — deadline proof check: let a plan's proof page, quote and check result through the
-- contribution whitelist (src/deadlines/verify.ts), so shared research carries "checked on the
-- college's own page" / "not found there" along with each deadline. Everything else in
-- cc_private.sanitize_college is unchanged from 20261020010000_contributions.sql.
--
-- Per plan, besides plan / deadline / notes:
--   source_url  https URL, ≤ 300 chars (the app only trusts it when it is on the college's own domain)
--   quote       ≤ 240 chars of page text
--   check       { status: verified | mismatch | unchecked, reason?, url? (https, ≤ 300), host?, checkedAt? }

create or replace function cc_private.plan_check(c jsonb)
returns jsonb language sql immutable as $$
  select case
    when jsonb_typeof(c) = 'object' and (c ->> 'status') in ('verified', 'mismatch', 'unchecked') then
      jsonb_strip_nulls(jsonb_build_object(
        'status', c ->> 'status',
        'reason', case when (c ->> 'reason') ~ '^[a-z_]{1,40}$' then c ->> 'reason' end,
        'url', case when (c ->> 'url') ~ '^https://' then left(c ->> 'url', 300) end,
        'host', case when (c ->> 'host') ~ '^[a-z0-9.-]{1,120}$' then c ->> 'host' end,
        'checkedAt', case when (c ->> 'checkedAt') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' then left(c ->> 'checkedAt', 40) end))
  end
$$;

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
             'notes', left(p ->> 'notes', 300),
             'source_url', case when (p ->> 'source_url') ~ '^https://' then left(p ->> 'source_url', 300) end,
             'quote', left(p ->> 'quote', 240),
             'check', cc_private.plan_check(p -> 'check')))), '[]'::jsonb)
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
