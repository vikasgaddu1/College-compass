-- Tie-breaks: an exact name OR exact alias match first ("Miami University" is Miami University in Ohio,
-- not "University of Miami", though trigrams ignore word order), then the larger campus, then the ID.
create or replace function public.match_colleges(names text[], states text[] default null)
returns table (requested text, unitid text, name text, state text, similarity real)
language sql stable
set search_path = public, extensions, pg_temp
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
    select c2.unitid, c2.name_norm, c2.undergrad_size,
           greatest(similarity(c2.name_norm, r.norm),
             coalesce((select max(similarity(trim(regexp_replace(lower(a), '[^a-z0-9]+', ' ', 'g')), r.norm)) from unnest(c2.aliases) a), 0)) as sim
    from public.colleges c2
    where c2.active and (r.st is null or c2.state = r.st)
      and (c2.name_norm % r.norm or exists (select 1 from unnest(c2.aliases) a where trim(regexp_replace(lower(a), '[^a-z0-9]+', ' ', 'g')) % r.norm))
    order by sim desc,
             (c2.name_norm = r.norm or exists (select 1 from unnest(c2.aliases) a where trim(regexp_replace(lower(a), '[^a-z0-9]+', ' ', 'g')) = r.norm)) desc,
             c2.undergrad_size desc nulls last, c2.unitid
    limit 1
  ) best
  join public.colleges c on c.unitid = best.unitid
  where best.sim >= 0.45;
$$;
grant execute on function public.match_colleges(text[], text[]) to anon, authenticated;
