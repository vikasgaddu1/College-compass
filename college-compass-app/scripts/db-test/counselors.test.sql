-- Counselor directory: behaviour tests (run by scripts/db-test/run.sh on a throwaway Postgres 16).
-- Each check prints "ok - …"; the first failure raises and stops the run.

-- ───────────── helpers ─────────────
create schema t;
grant usage on schema t to anon, authenticated, service_role;

create function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', msg; end if;
  raise info 'ok - %', msg;
end $$;

-- Run `sql` as the current role and require it to fail with an error containing `expect`.
create function t.fails(sql text, expect text, msg text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if expect is not null and position(expect in sqlerrm) = 0 then
      raise exception 'FAIL: % (wrong error: %)', msg, sqlerrm;
    end if;
    raise info 'ok - % (%)', msg, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % (no error)', msg;
end $$;

-- Pretend to be a signed-in user (claims as PostgREST sets them); null = anonymous.
create function t.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when uid is null then '{"role":"anon"}' else json_build_object('sub', uid, 'role', 'authenticated')::text end, false);
$$;
create function t.from_ip(ip text) returns void language sql as $$
  select set_config('request.headers', json_build_object('x-forwarded-for', ip)::text, false);
$$;
-- Directory as the app sees it (ids only).
create function t.dir(p_state text default null, p_spec text[] default null) returns uuid[] language sql as $$
  select coalesce(array_agg(d.id), '{}') from public.counselor_directory(p_state, p_spec) d
$$;
grant execute on all functions in schema t to anon, authenticated, service_role;

-- ───────────── fixtures ─────────────
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-00000000000a', 'VikasGaddu@gmail.com', now()),   -- owner (case differs on purpose)
  ('00000000-0000-0000-0000-00000000000b', 'vikasgaddu@gmail.com', null),    -- same email, never confirmed
  ('00000000-0000-0000-0000-000000000001', 'c1@example.com', now()),
  ('00000000-0000-0000-0000-000000000002', 'c2@example.com', now()),
  ('00000000-0000-0000-0000-000000000003', 'c3@example.com', now()),
  ('00000000-0000-0000-0000-000000000004', 'c4@example.com', now()),
  ('00000000-0000-0000-0000-000000000005', 'c5@example.com', now()),
  ('00000000-0000-0000-0000-000000000006', 'c6@example.com', now());

-- Quick approved+published counselor for billing/listing tests (inserted as the owner role).
create function t.mk(uid uuid, nm text, st text[], sp text[]) returns uuid language plpgsql as $$
declare cid uuid;
begin
  insert into public.counselors (user_id, name, bio, website, states, specialties, modes, terms_accepted_at)
    values (uid, nm, 'Bio of ' || nm, 'https://example.com/' || lower(nm), st, sp, '{virtual}', now()) returning id into cid;
  update public.counselors set status = 'approved', published = cc_private.counselor_snapshot(c), approved_at = now()
    from public.counselors c where c.id = cid and public.counselors.id = cid;
  return cid;
end $$;

-- ═════════════ 1. counselor self-service (portal) ═════════════
select t.login('00000000-0000-0000-0000-000000000001');
set role authenticated;

select t.fails($$insert into public.counselors (name, status) values ('Ann', 'approved')$$, 'permission denied',
               'counselor cannot insert protected columns (status)');
-- user_id is forced to the caller: a row "for" someone else becomes the caller's own.
insert into public.counselors (user_id, name, title, bio, states, specialties, modes, city)
  values ('00000000-0000-0000-0000-000000000002', '  Ann Advisor ', 'Independent counselor', 'Helping students since 2010.',
          '{nc,va,NC}', '{stem,engineering}', '{virtual,in_person}', 'Cary');
select t.ok((select user_id = '00000000-0000-0000-0000-000000000001' and status = 'draft' and name = 'Ann Advisor'
                    and states = '{NC,VA}' and not has_changes from public.counselors),
            'insert creates own draft row; text trimmed, states upper-cased and de-duplicated');
select t.fails($$update public.counselors set status = 'approved'$$, 'permission denied', 'counselor cannot set status');
select t.fails($$update public.counselors set published = '{}'$$, 'permission denied', 'counselor cannot set published');
select t.fails($$update public.counselors set subscription_status = 'active'$$, 'permission denied', 'counselor cannot set subscription_status');
select t.fails($$update public.counselors set founding_until = '2099-01-01'$$, 'permission denied', 'counselor cannot set founding_until');
select t.fails($$update public.counselors set review_note = 'x'$$, 'permission denied', 'counselor cannot set review_note');
select t.fails($$update public.counselors set has_changes = true$$, 'permission denied', 'counselor cannot set has_changes');
select t.fails($$update public.counselors set bio = repeat('x', 1201)$$, 'check', 'bio over 1200 characters rejected');
select t.fails($$update public.counselors set states = '{XX}'$$, 'check', 'unknown state code rejected');
select t.fails($$update public.counselors set specialties = '{astrology}'$$, 'check', 'unknown specialty rejected');
select t.fails($$update public.counselors set website = 'javascript:alert(1)'$$, 'check', 'non-http website rejected');
select t.fails($$update public.counselors set photo_url = 'https://evil.example.com/p.jpg'$$, 'photo_url_invalid',
               'photo from another host rejected');
select t.fails($$update public.counselors set photo_url = 'https://nspbxlnocelknibrajkv.supabase.co/storage/v1/object/public/counselor-photos/00000000-0000-0000-0000-000000000002/p.jpg'$$,
               'photo_url_invalid', 'photo from another counselor''s folder rejected');
update public.counselors set photo_url = 'https://nspbxlnocelknibrajkv.supabase.co/storage/v1/object/public/counselor-photos/00000000-0000-0000-0000-000000000001/photo.jpg?v=2';
select t.ok((select photo_url like '%/00000000-0000-0000-0000-000000000001/photo.jpg?v=2' from public.counselors),
            'photo in own folder accepted');
select t.fails($$select public.submit_counselor_for_review()$$, 'terms_not_accepted', 'submit requires accepted terms');
select t.ok((select (public.accept_counselor_terms() ->> 'ok')::boolean), 'accept_counselor_terms');
select t.fails($$select public.submit_counselor_for_review()$$, 'incomplete_profile', 'submit requires a contact method');
update public.counselors set email = 'Ann@Example.com', website = 'https://ann.example.com';
select t.ok((select public.submit_counselor_for_review() ->> 'status') = 'pending', 'submit moves draft → pending');
select t.fails($$select public.admin_counselors(null)$$, 'not_authorized', 'admin_counselors refuses non-admins');
select t.fails($$select public.admin_review_counselor(id, 'approve') from public.counselors$$, 'not_authorized',
               'admin_review_counselor refuses non-admins');
select t.fails($$select public.admin_counselor_reports()$$, 'not_authorized', 'admin_counselor_reports refuses non-admins');
select t.ok(not public.is_admin(), 'counselor is not admin');
select t.fails($$select public.billing_apply_subscription('webhook')$$, 'permission denied', 'counselor cannot call billing RPCs');
select t.fails($$select * from cc_private.counselor_billing$$, 'permission denied', 'counselor cannot read private billing');

-- Another counselor sees and changes nothing of counselor 1.
reset role;
select t.login('00000000-0000-0000-0000-000000000002');
set role authenticated;
select t.ok((select count(*) = 0 from public.counselors), 'counselor 2 cannot see counselor 1''s row');
do $$ declare n int; begin
  with u as (update public.counselors set name = 'hijack' where user_id = '00000000-0000-0000-0000-000000000001' returning 1)
  select count(*) into n from u;
  perform t.ok(n = 0, 'counselor 2 cannot update counselor 1''s row');
end $$;
reset role;

-- Anonymous app key.
select t.login(null);
set role anon;
select t.fails($$select * from public.counselors$$, 'permission denied', 'anon cannot read the counselors table');
select t.fails($$insert into public.counselors (name) values ('x')$$, 'permission denied', 'anon cannot insert counselors');
select t.fails($$select public.submit_counselor_for_review()$$, 'permission denied', 'anon cannot submit');
select t.fails($$select public.admin_counselors(null)$$, 'permission denied', 'anon cannot call admin RPCs');
select t.ok(cardinality(t.dir()) = 0, 'pending counselor is not in the directory');
reset role;

-- ═════════════ 2. admin review ═════════════
select t.login('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select t.ok(not public.is_admin(), 'unconfirmed account with the owner''s email is not admin');
reset role;

select t.login('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select t.ok(public.is_admin(), 'owner (confirmed email, any case) is admin');
select t.ok((select awaiting_review and not listed and account_email = 'c1@example.com'
               from public.admin_counselors('review') where user_id = '00000000-0000-0000-0000-000000000001'),
            'admin sees pending counselor awaiting review with account email');
select t.fails($$select public.admin_review_counselor(id, 'approve', null, null, '2000-01-01') from public.admin_counselors(null)$$,
               'changed_since_viewed', 'approve refuses when the profile changed since it was viewed');
select t.ok((select (public.admin_review_counselor(id, 'approve', 'Welcome!') ->> 'status') = 'approved'
               from public.admin_counselors('pending')), 'admin approves');
reset role;
select t.ok((select published ->> 'bio' = 'Helping students since 2010.' and approved_at is not null and not has_changes
               from public.counselors where user_id = '00000000-0000-0000-0000-000000000001'),
            'approval copies draft → published');

set role anon;
select t.ok(cardinality(t.dir()) = 0, 'approved but unpaid (no subscription, no founding) is hidden');
reset role;

-- Founding listing: visible through founding_until (inclusive), payment ignored.
select t.login('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select public.admin_review_counselor(id, 'founding', null, current_date) from public.admin_counselors('approved');
reset role;
select t.ok((select plan = 'founding' from public.counselors where user_id = '00000000-0000-0000-0000-000000000001'),
            'founding grant sets plan=founding');
set role anon;
select t.ok(cardinality(t.dir()) = 1, 'founding listing visible on its last day');
do $$ declare r record; begin
  select * into r from public.counselor_directory(null, null);
  perform t.ok((select array_agg(k order by k) from jsonb_object_keys(to_jsonb(r)) k)
               = array['bio','city','credentials','email','id','modes','name','phone','photo_url','specialties','states','title','website'],
               'directory returns published fields only');
  perform t.ok(r.email = 'ann@example.com' and r.states = '{NC,VA}', 'directory returns the published values');
end $$;
reset role;
update public.counselors set founding_until = current_date - 1 where user_id = '00000000-0000-0000-0000-000000000001';
set role anon;
select t.ok(cardinality(t.dir()) = 0, 'founding listing hidden the day after founding_until');
reset role;
update public.counselors set founding_until = current_date + 30 where user_id = '00000000-0000-0000-0000-000000000001';

-- Edits after approval: published stays until re-approved.
select t.login('00000000-0000-0000-0000-000000000001');
set role authenticated;
update public.counselors set bio = 'New bio, not yet reviewed.';
select t.ok((select has_changes and status = 'approved' from public.counselors), 'edit after approval sets has_changes, stays approved');
select t.fails($$update public.counselors set status = 'approved', bio = 'x'$$, 'permission denied', 'still cannot touch status');
reset role;
set role anon;
select t.ok((select bio = 'Helping students since 2010.' from public.counselor_directory(null, null)),
            'directory keeps showing the approved version');
reset role;
select t.login('00000000-0000-0000-0000-000000000001');
set role authenticated;
select t.ok((select (public.submit_counselor_for_review() ->> 'status') = 'approved'), 'submitting edits keeps the listing approved');
reset role;
select t.login('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select t.ok((select awaiting_review from public.admin_counselors('review')), 'submitted edits await review');
select public.admin_review_counselor(id, 'reject', 'Please keep the bio factual.') from public.admin_counselors('review');
select t.ok((select status = 'approved' and has_changes and not awaiting_review and review_note like 'Please%'
               from public.admin_counselors(null) where user_id = '00000000-0000-0000-0000-000000000001'),
            'rejecting edits keeps the approved listing and the old published version');
select public.admin_review_counselor(id, 'approve') from public.admin_counselors(null) where user_id = '00000000-0000-0000-0000-000000000001';
reset role;
set role anon;
select t.ok((select bio = 'New bio, not yet reviewed.' from public.counselor_directory(null, null)), 're-approval publishes the edit');
reset role;
select t.ok((select not has_changes from public.counselors where user_id = '00000000-0000-0000-0000-000000000001'),
            'has_changes cleared after re-approval');
select t.login('00000000-0000-0000-0000-000000000001');
set role authenticated;
select t.fails($$select public.submit_counselor_for_review()$$, 'no_changes', 'submit with nothing changed is refused');
reset role;

-- Suspension hides immediately, whatever the payment/founding state.
select t.login('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select public.admin_review_counselor(id, 'suspend', 'Under review after reports') from public.admin_counselors(null)
 where user_id = '00000000-0000-0000-0000-000000000001';
set role anon;
select t.ok(cardinality(t.dir()) = 0, 'suspended counselor hidden immediately (founding still running)');
reset role;
select t.login('00000000-0000-0000-0000-000000000001');
set role authenticated;
select t.fails($$select public.submit_counselor_for_review()$$, 'suspended', 'suspended counselor cannot submit');
reset role;
select t.login('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select public.admin_review_counselor(id, 'unsuspend') from public.admin_counselors('suspended');
set role anon;
select t.ok(cardinality(t.dir()) = 1, 'unsuspended counselor is listed again');
reset role;

-- Draft / pending / rejected stay hidden even when paid.
select t.login('00000000-0000-0000-0000-000000000003');
set role authenticated;
insert into public.counselors (name, bio, email, states, specialties, modes) values ('Cy', 'Bio', 'cy@example.com', '{CA}', '{arts}', '{virtual}');
reset role;
update public.counselors set subscription_status = 'active', plan = 'monthly' where user_id = '00000000-0000-0000-0000-000000000003';
set role anon;
select t.ok(cardinality(t.dir()) = 1, 'paid draft is hidden');
reset role;
update public.counselors set status = 'pending' where user_id = '00000000-0000-0000-0000-000000000003';
set role anon;
select t.ok(cardinality(t.dir()) = 1, 'paid pending is hidden');
reset role;
update public.counselors set status = 'rejected' where user_id = '00000000-0000-0000-0000-000000000003';
set role anon;
select t.ok(cardinality(t.dir()) = 1, 'paid rejected is hidden');
reset role;
update public.counselors set status = 'approved', published = null where user_id = '00000000-0000-0000-0000-000000000003';
set role anon;
select t.ok(cardinality(t.dir()) = 1, 'approved without a published snapshot is hidden');
reset role;
delete from public.counselors where user_id = '00000000-0000-0000-0000-000000000003';

-- ═════════════ 3. billing: Stripe → listing (service role) ═════════════
select t.mk('00000000-0000-0000-0000-000000000004', 'Dee', '{US}', '{essays,first_gen}');
select t.mk('00000000-0000-0000-0000-000000000005', 'Eve', '{TX}', '{athletics}');
select t.mk('00000000-0000-0000-0000-000000000006', 'Fay', '{NC}', '{financial_aid}');
create temp table ids as
  select (select id from public.counselors where user_id = '00000000-0000-0000-0000-000000000004') as dee,
         (select id from public.counselors where user_id = '00000000-0000-0000-0000-000000000005') as eve,
         (select id from public.counselors where user_id = '00000000-0000-0000-0000-000000000006') as fay;
grant select on ids to service_role, anon, authenticated;

set role service_role;
select t.ok((select public.billing_attach_customer(dee, 'cus_dee') = 'cus_dee' from ids), 'attach customer');
select t.ok((select public.billing_attach_customer(dee, 'cus_other') = 'cus_dee' from ids), 'existing customer wins');
select t.ok((public.billing_counselor_for_user('00000000-0000-0000-0000-000000000004') ->> 'stripe_customer_id') = 'cus_dee',
            'billing_counselor_for_user returns the customer');

-- Checkout completed → active monthly (counselor found via customer, no metadata).
select t.ok((select r ->> 'result' = 'applied' and r ->> 'subscription_status' = 'active' and r ->> 'plan' = 'monthly'
                    and (r ->> 'listed')::boolean
               from (select public.billing_apply_subscription('webhook', p_event_id => 'evt_1', p_event_type => 'checkout.session.completed',
                       p_customer => 'cus_dee', p_subscription => 'sub_dee', p_stripe_status => 'active', p_interval => 'month',
                       p_price => 'price_m', p_period_end => now() + interval '30 days') r) x),
            'active monthly subscription → listed');
select t.ok((public.billing_apply_subscription('webhook', p_event_id => 'evt_1', p_event_type => 'checkout.session.completed',
               p_customer => 'cus_dee', p_subscription => 'sub_dee', p_stripe_status => 'canceled') ->> 'result') = 'duplicate',
            'same Stripe event twice → duplicate, ignored');
select t.ok((select r ->> 'result' = 'unknown_counselor'
               from (select public.billing_apply_subscription('webhook', p_event_id => 'evt_x', p_customer => 'cus_nobody',
                       p_subscription => 'sub_x', p_stripe_status => 'active') r) x), 'unknown customer → unknown_counselor');
select t.ok((select (public.billing_apply_subscription('reconcile', p_counselor => dee, p_customer => 'cus_dee',
               p_subscription => 'sub_dee', p_stripe_status => 'active', p_interval => 'month', p_price => 'price_m',
               p_observed_at => now() - interval '1 hour') ->> 'result') = 'stale' from ids),
            'state observed before the last sync is ignored (stale)');

-- Cancel at period end: stays listed until Stripe ends the subscription.
select public.billing_apply_subscription('webhook', p_event_id => 'evt_2', p_counselor => dee, p_customer => 'cus_dee',
         p_subscription => 'sub_dee', p_stripe_status => 'active', p_interval => 'month', p_cancel_at_period_end => true,
         p_period_end => now() + interval '10 days') from ids;
reset role;
select t.ok((select cancel_at_period_end and subscription_status = 'active' and cc_private.counselor_listed(c)
               from public.counselors c, ids where c.id = ids.dee), 'cancel at period end → still listed until the period ends');
set role service_role;
select public.billing_apply_subscription('webhook', p_event_id => 'evt_3', p_event_type => 'customer.subscription.deleted',
         p_counselor => dee, p_customer => 'cus_dee', p_subscription => 'sub_dee', p_stripe_status => 'canceled',
         p_interval => 'month') from ids;
reset role;
select t.ok((select subscription_status = 'canceled' and plan is null and not cancel_at_period_end and not cc_private.counselor_listed(c)
               from public.counselors c, ids where c.id = ids.dee), 'subscription deleted → canceled, plan cleared, hidden');

-- Yearly plan.
set role service_role;
select public.billing_apply_subscription('webhook', p_event_id => 'evt_4', p_counselor => eve, p_customer => 'cus_eve',
         p_subscription => 'sub_eve', p_stripe_status => 'trialing', p_interval => 'year') from ids;
reset role;
select t.ok((select subscription_status = 'trialing' and plan = 'yearly' and cc_private.counselor_listed(c)
               from public.counselors c, ids where c.id = ids.eve), 'trialing yearly → listed, plan yearly; customer learned from metadata');
select t.ok((select stripe_customer_id = 'cus_eve' and stripe_subscription_id = 'sub_eve' from cc_private.counselor_billing b, ids
              where b.counselor_id = ids.eve), 'billing row stores customer and subscription ids');

-- Grace window: past_due counts from the first failure.
set role service_role;
select public.billing_apply_subscription('webhook', p_event_id => 'evt_5', p_event_type => 'invoice.payment_failed',
         p_event_created => now() - interval '6 days', p_counselor => eve, p_subscription => 'sub_eve',
         p_stripe_status => 'past_due', p_interval => 'year', p_payment_failed => true) from ids;
reset role;
select t.ok((select subscription_status = 'past_due' and past_due_since < now() - interval '5 days' and cc_private.counselor_listed(c)
               from public.counselors c, ids where c.id = ids.eve), 'past_due for 6 days → still listed (grace)');
set role anon;
select t.ok((select ids.eve = any (t.dir()) from ids), 'past_due 6 days → in the directory');
reset role;
set role service_role;
select public.billing_apply_subscription('webhook', p_event_id => 'evt_6', p_counselor => eve, p_subscription => 'sub_eve',
         p_stripe_status => 'past_due', p_interval => 'year') from ids;
reset role;
select t.ok((select past_due_since < now() - interval '5 days' from public.counselors c, ids where c.id = ids.eve),
            'later past_due events keep the first-failure time');
update public.counselors set past_due_since = now() - interval '8 days' from ids where counselors.id = ids.eve;
set role anon;
select t.ok((select not (ids.eve = any (t.dir())) from ids), 'past_due for 8 days → hidden automatically by the directory query');
reset role;
set role service_role;
select public.billing_apply_subscription('webhook', p_event_id => 'evt_7', p_event_type => 'invoice.paid', p_counselor => eve,
         p_subscription => 'sub_eve', p_stripe_status => 'active', p_interval => 'year') from ids;
reset role;
select t.ok((select subscription_status = 'active' and past_due_since is null and cc_private.counselor_listed(c)
               from public.counselors c, ids where c.id = ids.eve), 'paid again → past_due_since cleared, listed');

-- payment_failed while Stripe still says active: grace clock starts, still listed; next normal update clears it.
set role service_role;
select public.billing_apply_subscription('webhook', p_event_id => 'evt_8', p_event_type => 'invoice.payment_failed', p_counselor => eve,
         p_subscription => 'sub_eve', p_stripe_status => 'active', p_interval => 'year', p_payment_failed => true) from ids;
reset role;
select t.ok((select past_due_since is not null and cc_private.counselor_listed(c) from public.counselors c, ids where c.id = ids.eve),
            'invoice.payment_failed starts the grace clock');
set role service_role;
select public.billing_apply_subscription('reconcile', p_counselor => eve, p_subscription => 'sub_eve', p_stripe_status => 'active',
         p_interval => 'year') from ids;
reset role;
select t.ok((select past_due_since is null from public.counselors c, ids where c.id = ids.eve), 'active without failure clears it');

-- Status mapping (reconcile path).
create function t.map_case(stripe text, expect_status text, expect_listed boolean) returns void language plpgsql as $$
declare r jsonb; fay uuid := (select ids.fay from ids);
begin
  update public.counselors set past_due_since = null where id = fay;
  r := public.billing_apply_subscription('reconcile', p_counselor => fay, p_customer => 'cus_fay', p_subscription => 'sub_fay',
         p_stripe_status => stripe, p_interval => 'month');
  perform t.ok(r ->> 'subscription_status' = expect_status and (r ->> 'listed')::boolean = expect_listed,
               format('Stripe %s → %s, listed=%s', stripe, expect_status, expect_listed));
end $$;
select t.map_case('active', 'active', true);
select t.map_case('trialing', 'trialing', true);
select t.map_case('past_due', 'past_due', true);
select t.map_case('unpaid', 'unpaid', false);
select t.map_case('paused', 'unpaid', false);
select t.map_case('incomplete', 'none', false);
select t.map_case('incomplete_expired', 'none', false);
select t.map_case('canceled', 'canceled', false);
select t.map_case('some_new_status', 'unpaid', false);
select t.map_case('active', 'active', true);
-- Reconcile: Stripe has no subscription at all for a counselor marked active → canceled.
select t.ok((select r ->> 'subscription_status' = 'canceled' and not (r ->> 'listed')::boolean
               from (select public.billing_apply_subscription('reconcile', p_counselor => (select fay from ids), p_customer => 'cus_fay') r) x),
            'reconcile: no subscription in Stripe → canceled, hidden');
select t.ok((select r ->> 'result' = 'unchanged'
               from (select public.billing_apply_subscription('reconcile', p_counselor => (select fay from ids), p_customer => 'cus_fay') r) x),
            'reconcile with matching state → unchanged');
-- Founding counselor whose subscription ends keeps the founding plan and stays listed.
update public.counselors set founding_until = current_date + 5 from ids where counselors.id = ids.fay;
select t.ok((select r ->> 'plan' = 'founding' and (r ->> 'listed')::boolean
               from (select public.billing_apply_subscription('reconcile', p_counselor => (select fay from ids), p_subscription => 'sub_fay',
                       p_stripe_status => 'canceled') r) x), 'canceled during a founding listing → plan founding, still listed');
update public.counselors set founding_until = null from ids where counselors.id = ids.fay;
-- A second (duplicate) subscription being canceled doesn't hide a live one.
select public.billing_apply_subscription('reconcile', p_counselor => (select fay from ids), p_subscription => 'sub_fay',
         p_stripe_status => 'active', p_interval => 'month');
select t.ok((public.billing_apply_subscription('webhook', p_event_id => 'evt_9', p_counselor => (select fay from ids),
               p_subscription => 'sub_fay_dup', p_stripe_status => 'canceled') ->> 'result') = 'ignored_other_subscription',
            'cancellation of another subscription is ignored while one is live');
select t.ok((select count(*) = 3 from public.billing_reconcile_targets()), 'reconcile targets = counselors with Stripe state');
reset role;

-- Rotation + filters (Ann NC/VA stem+engineering founding; Dee US hidden (canceled); Eve TX; Fay NC).
select t.ok((select array_agg(d.id) = (select array_agg(c.id order by md5(c.id::text || current_date::text))
                                           from public.counselors c where cc_private.counselor_listed(c))
               from public.counselor_directory(null, null) d),
            'directory order is the daily rotation');
update public.counselors set subscription_status = 'active' from ids where counselors.id = ids.dee;
set role anon;
select t.ok((select cardinality(t.dir('nc')) = 3 and ids.dee = any (t.dir('nc')) and not (ids.eve = any (t.dir('NC'))) from ids),
            'state filter matches the state or nationwide (US)');
select t.ok((select t.dir('TX') @> array[ids.eve, ids.dee] and cardinality(t.dir('TX')) = 2 from ids), 'TX: Eve + nationwide Dee');
select t.ok((select t.dir(null, '{essays,athletics}') @> array[ids.dee, ids.eve] and cardinality(t.dir(null, '{essays,athletics}')) = 2 from ids),
            'specialty filter = any overlap');
select t.ok(cardinality(t.dir(null, '{}')) = 4 and cardinality(t.dir('')) = 4, 'empty filters = everyone listed');

-- ═════════════ 4. reports ═════════════
select t.from_ip('198.51.100.7, 10.0.0.1');
select t.ok((select (public.report_counselor(ids.eve, 'misleading', 'Claims guaranteed admission') ->> 'ok')::boolean from ids),
            'anon can report a listed counselor');
select t.ok((public.report_counselor(gen_random_uuid(), 'other') ->> 'reason') = 'unknown_counselor', 'unknown counselor rejected');
select t.ok((select public.report_counselor(ids.eve, 'spam') ->> 'reason' = 'bad_reason' from ids), 'bad reason rejected');
select public.report_counselor(ids.eve, 'other') from ids;
select public.report_counselor(ids.eve, 'other') from ids;
select t.ok((select (public.report_counselor(ids.eve, 'other') ->> 'ok')::boolean from ids), '5th report this hour accepted');
select t.ok((select public.report_counselor(ids.eve, 'other') ->> 'reason' = 'rate_limited' from ids), '6th report this hour rate-limited');
select t.from_ip('203.0.113.9');
select t.ok((select (public.report_counselor(ids.eve, 'unresponsive') ->> 'ok')::boolean from ids), 'another address is not limited');
select t.fails($$select * from cc_private.counselor_reports$$, 'permission denied', 'anon cannot read reports');
reset role;
select t.ok((select count(*) = 2 and bool_and(reporter_hash !~ '198\.51|203\.0') from cc_private.counselor_reports),
            'one stored report per address per counselor per day, address hashed');
select t.ok(not exists (select 1 from cc_private.rate where ip_hash like '%198.51%'), 'rate table holds only hashes');
select t.login('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select t.ok((select count(*) = 2 from public.admin_counselor_reports()), 'admin sees reports');
select t.ok((select report_count = 2 from public.admin_counselors(null) a, ids where a.id = ids.eve), 'admin_counselors includes report counts');
reset role;

-- ═════════════ 5. storage ═════════════
select t.ok((select public and file_size_limit = 2097152 and allowed_mime_types = '{image/jpeg,image/png,image/webp}'
               from storage.buckets where id = 'counselor-photos'), 'bucket: public, 2 MB, jpeg/png/webp');
select t.login('00000000-0000-0000-0000-000000000001');
set role authenticated;
insert into storage.objects (bucket_id, name) values ('counselor-photos', '00000000-0000-0000-0000-000000000001/photo.jpg');
select t.ok(true, 'counselor uploads into own folder');
select t.fails($$insert into storage.objects (bucket_id, name) values ('counselor-photos', '00000000-0000-0000-0000-000000000002/photo.jpg')$$,
               'row-level security', 'counselor cannot upload into another folder');
select t.fails($$insert into storage.objects (bucket_id, name) values ('counselor-photos', 'photo.jpg')$$,
               'row-level security', 'counselor cannot upload outside a folder');
reset role;
select t.login(null);
set role anon;
select t.fails($$insert into storage.objects (bucket_id, name) values ('counselor-photos', 'x/photo.jpg')$$,
               'row-level security', 'anon cannot upload');
reset role;

-- ═════════════ 6. account deletion ═════════════
delete from auth.users where id = '00000000-0000-0000-0000-000000000005';
select t.ok(not exists (select 1 from cc_private.counselor_reports) and
            not exists (select 1 from cc_private.counselor_billing b where b.stripe_customer_id = 'cus_eve'),
            'deleting the auth user removes the counselor, billing row and reports');

drop schema t cascade;
