# Counselor directory — backend and owner guide

Families see a directory of independent college counselors in the iPhone app ("Get expert help"). Counselors
sign up, pay and edit their listing **only on the website portal**
(`https://vikasgaddu1.github.io/College-compass/app/counselors/`). Gaddu LLC is the merchant (Stripe); the
owner approves every counselor before they appear. Interface contract: [COUNSELORS_CONTRACT.md](COUNSELORS_CONTRACT.md).

## How it works

```
counselor ──magic link──▶ portal ──PostgREST (own row only)──▶ public.counselors (draft)
                            │  accept terms → submit for review          │
                            │                                            ▼
                            │                              owner approves (#/admin) → published snapshot
                            ├─ counselor-checkout ─▶ Stripe Checkout ─▶ subscription
                            └─ counselor-billing  ─▶ Stripe customer portal (cancel / change plan / card)
Stripe ──signed events──▶ stripe-webhook ─┐
GitHub daily ─────────▶ counselor-reconcile ─┴─▶ billing_apply_subscription() → subscription_status / plan
iPhone app (anon key) ──▶ counselor_directory() → listed counselors' published fields only
```

**Listed** = approved **and** published **and** not suspended **and** (founding listing still running **or**
subscription active/trialing **or** past_due for under 7 days since the first failed payment). The directory
query applies this itself, so a listing disappears the moment it stops qualifying — no job has to run.

| Situation | What families see |
|---|---|
| Draft, pending, rejected, suspended | nothing |
| Approved, never paid, no founding listing | nothing |
| Paying (active/trialing) | the **published** version |
| Edits after approval | still the old published version until the owner re-approves |
| Cancelled in the billing portal | listed until the paid period ends, then hidden |
| Card failed | listed for 7 days from the first failure, then hidden; back as soon as payment succeeds |
| Stripe gives up (`unpaid`) or the subscription ends | hidden |
| Founding listing | listed through `founding_until` regardless of payment |

The app doesn't cache the directory beyond the screen session, so every change shows the next time a family
opens it.

## Pieces

**Database** — `supabase/migrations/20261021020000_counselors.sql` (+ `…000100_counselor_admins.sql`, the owner's email).

| Object | Purpose | Who can use it |
|---|---|---|
| `public.counselors` | one row per counselor: draft fields, `published` snapshot, review + billing state | counselor: select own row; insert/update **only** draft columns (column grants + guard trigger + RLS). Apps: no access |
| `cc_private.counselor_billing` | Stripe customer/subscription/price ids | service role via `billing_*` RPCs only |
| `cc_private.counselor_reports` | reports from families (reason, detail, salted address hash) | admins via `admin_counselor_reports()` |
| `cc_private.stripe_events` | processed webhook event ids (idempotency, 90 days) | internal |
| `cc_private.admins` | admin emails | SQL editor / migrations only |
| storage `counselor-photos` | public bucket, ≤ 2 MB, jpeg/png/webp | anyone reads by URL; signed-in users write only under `<their uid>/` |

| RPC | Caller | Does |
|---|---|---|
| `counselor_directory(p_state, p_specialties)` | anyone (app) | listed counselors, published fields, daily rotating order |
| `report_counselor(p_counselor, p_reason, p_detail)` | anyone (app) | stores a report; 5/hour per network address (salted hash) |
| `is_admin()` | anyone | true if the signed-in user's confirmed email is an admin |
| `accept_counselor_terms()` | signed-in counselor | records terms acceptance (creates the draft row if needed) |
| `submit_counselor_for_review()` | signed-in counselor | draft/rejected → pending; approved with edits → awaiting re-review |
| `admin_counselors(p_status)` | admins | everything incl. account email, draft vs published, report counts |
| `admin_review_counselor(p_id, p_decision, …)` | admins | approve / reject / suspend / unsuspend / founding |
| `admin_counselor_reports()` | admins | latest 200 reports |
| `billing_counselor_for_user`, `billing_attach_customer`, `billing_reconcile_targets`, `billing_apply_subscription` | service role only | used by the Edge Functions |

**Edge Functions** — `supabase/functions/` (Deno; `npm:stripe@22.6.2`, `npm:@supabase/supabase-js@2.117.2`).

| Function | Caller / auth | Does |
|---|---|---|
| `counselor-checkout` | portal; user JWT (gateway + `auth.getUser`) | creates/reuses the Stripe customer, returns a Checkout URL ($29/mo or $290/yr) |
| `counselor-billing` | portal; user JWT | returns a Stripe customer-portal URL |
| `stripe-webhook` | Stripe; **no JWT**, Stripe signature required | re-reads the subscription from Stripe and applies it (idempotent per event) |
| `counselor-reconcile` | GitHub Actions daily; **service key** required | compares every counselor with Stripe and fixes drift |

CORS allows only `https://vikasgaddu1.github.io` (override with the `COUNSELOR_ALLOWED_ORIGINS` secret, e.g. to
add `http://localhost:5173` while developing). Logic lives in `_shared/` (pure, unit-tested); `deps.ts` wires
the real Stripe/Supabase clients.

**Workflows**
- `.github/workflows/supabase.yml` → job **counselor-functions** (after `migrate`): deploys the four
  functions (`stripe-webhook` and `counselor-reconcile` with `--no-verify-jwt`), warns if Stripe secrets are
  missing (checks names only), and adds the portal to Auth → URL Configuration. A failure there never affects
  migrations or the Scorecard load.
- `.github/workflows/counselor-reconcile.yml` → daily 08:41 UTC (or Run workflow): calls
  `counselor-reconcile` with the service key (fetched through the Management API with
  `SUPABASE_ACCESS_TOKEN`, masked). Skips quietly until the function and Stripe secrets exist.

## Owner setup checklist (one time)

Do everything in **Stripe test mode** first, check the flow end-to-end, then repeat steps 2–5 in live mode.

1. **Stripe account for Gaddu LLC** — <https://dashboard.stripe.com/register>. Business type: LLC (S corp),
   Gaddu LLC's EIN and bank account. Public business name / statement descriptor: `COLLEGE COMPASS` (what
   counselors see on their card statement). Support email and website (the portal URL). Decide with your
   accountant whether to enable **Stripe Tax** (Settings → Tax); the functions work either way.
2. **Product and prices** — Product catalog → Add product **"College Compass counselor listing"**:
   - price 1: **$29.00 USD, recurring, monthly**
   - price 2: **$290.00 USD, recurring, yearly**

   Copy both **price IDs** (`price_…`).
3. **Customer portal** — Settings → Billing → Customer portal: allow *update payment method*, *view invoice
   history*, *cancel subscriptions* → **at end of billing period**, and *switch plans* between the two prices
   above. Save. (`counselor-billing` returns 502 until the portal is saved once.)
4. **Failed payments** — Settings → Billing → Subscriptions and emails: turn on Smart Retries and the
   "payment failed" customer emails; for "if all retries fail" choose **mark the subscription as unpaid** or
   **cancel the subscription** (both hide the listing; our own 7-day grace hides it earlier regardless).
5. **Webhook** — Developers → Webhooks → Add endpoint:
   - URL: `https://nspbxlnocelknibrajkv.supabase.co/functions/v1/stripe-webhook`
   - API version: the account default (or `2026-08-26.dahlia`, the version stripe-node 22.6.2 uses)
   - Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
     `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.paid`

   Copy the **signing secret** (`whsec_…`).
6. **Function secrets** — Supabase dashboard → Edge Functions → **Secrets** (simplest; nothing touches your
   shell history), add:

   | Name | Value |
   |---|---|
   | `STRIPE_SECRET_KEY` | `sk_test_…` / `sk_live_…` (or a restricted key with write access to Customers, Checkout Sessions and Customer portal, read access to Subscriptions) |
   | `STRIPE_WEBHOOK_SECRET` | `whsec_…` from step 5 |
   | `STRIPE_PRICE_MONTHLY` | monthly `price_…` |
   | `STRIPE_PRICE_YEARLY` | yearly `price_…` |
   | `STRIPE_PORTAL_CONFIGURATION` (optional) | `bpc_…` customer-portal configuration for counselors (switch monthly ↔ yearly, cancel at period end). Without it the account's default portal settings are used. |
   | `PORTAL_URL` | optional; default `https://vikasgaddu1.github.io/College-compass/app/counselors/` |

   CLI alternative: put the lines in a file outside the repo and run
   `supabase secrets set --project-ref nspbxlnocelknibrajkv --env-file ~/stripe-counselors.env`, then delete the
   file. Never commit or paste secrets into GitHub. Test and live mode have different keys, webhook secrets
   and price IDs — replace all four when going live.
7. **Supabase Auth (magic links)**
   - Authentication → URL Configuration: the **counselor-functions** job adds
     `https://vikasgaddu1.github.io/College-compass/app/counselors/` and `…/counselors/**` to *Redirect URLs*
     (and sets *Site URL* to the portal if it is still `localhost`). `supabase db push` does **not** apply
     `[auth]` settings from `config.toml` to a hosted project, and `supabase config push` would overwrite the
     project's whole auth config, so don't use it. If the job's step is skipped, add those two URLs by hand.
   - **Custom SMTP is required**: Supabase's built-in email only delivers to members of your Supabase
     organization and a few emails per hour, so counselors would never get their sign-in link. Authentication →
     Emails → SMTP Settings: use a provider (Resend, Postmark, SendGrid, Amazon SES) with a sender such as
     `no-reply@<your domain>`; then raise Authentication → Rate Limits → emails per hour (e.g. 30).
   - Optional: edit the *Magic Link* email template to mention College Compass.
8. **Deploy** — merge to `main` (or Actions → *Shared college data (Supabase)* → Run workflow). Check the
   **counselor-functions** job: no "Counselor billing not configured" warning means the secrets are in place.
9. **Test (test mode)** — sign in on the portal with a non-admin email, fill the profile, accept terms,
   submit, pay with card `4242 4242 4242 4242`. In Stripe → Webhooks the delivery shows `200 {"received":true,
   "result":"applied"}`. Approve yourself in `#/admin`; the counselor appears in the app. Try card
   `4000 0000 0000 0341` (attach succeeds, charges fail) and the billing portal's cancel to see the grace and
   end-of-period rules. Actions → *Counselor billing reconcile* → Run workflow should report `checked: N`.
10. **Go live** — repeat steps 2–6 in live mode (live product/prices, live webhook endpoint + its secret, live
    secret key), then delete or disable the test webhook endpoint.

## Day to day

Everything below is in the portal's **#/admin** page (signed in as `vikasgaddu@gmail.com`). The SQL
equivalents run in the Supabase SQL editor (it runs as the owner, so the checks are bypassed — take care).

- **Approve** — *Awaiting review* lists new profiles and edits to live listings. Approve publishes the draft
  exactly as shown (if the counselor changed it after you opened it, you're asked to reload). *Reject* with a
  note: new profiles go to `rejected` (they can fix and resubmit); for a live listing, rejecting only declines
  the edits and the published version stays.
- **Founding listing** (free) — decision *founding* with an end date (or set a date while approving). The
  listing ignores payment through that date (inclusive); give a past date to end it early.
  SQL editor equivalent:
  `update public.counselors set founding_until = '2027-06-30', plan = coalesce(plan, 'founding') where user_id = (select id from auth.users where email = 'name@example.com');`
  (the counselor's sign-in email).
- **Suspend** — hides the listing immediately, whatever the payment state; the counselor can't resubmit.
  Suspension does **not** stop billing: also cancel (and refund if appropriate) the subscription in Stripe →
  Customers (search the counselor's email). *Unsuspend* restores the last approved version.
- **Reports** — families can report a listing (inappropriate / misleading / unresponsive / other). The admin
  page shows them with counts per counselor; only a short hashed reporter tag is kept (to spot repeats).
- **Admins** — add another admin with
  `insert into cc_private.admins (email) values ('someone@example.com');` (lower-case; the account's email
  must be confirmed). Remove with `delete from cc_private.admins where email = …`.
- **Remove a counselor completely** — cancel their Stripe subscription, then Authentication → Users → delete
  the user; their counselor row, billing ids and reports are deleted with it (photos: Storage →
  counselor-photos → their folder).
- **Billing looks wrong?** — Actions → *Counselor billing reconcile* → Run workflow re-reads Stripe for
  everyone. Stripe → Webhooks shows each delivery and our response (`result: applied/unchanged/duplicate/
  unknown_counselor`). Edge Functions → logs show event ids and outcomes (never card or secret data).

## Safety and privacy

- **No student data reaches counselors.** The app only reads the public directory; nothing about the family,
  their list or searches is sent. There is no in-app messaging — families contact counselors by their own
  website/phone/email. Most app users are minors; every listing is labelled "Paid listing"; listings never
  influence college recommendations.
- **The app can only see published, listed data.** Apps use one security-definer function that returns 13
  published fields of listed counselors; the counselors table, billing, reports and admin lists are not
  readable with the app's key.
- **Counselors can only edit their own draft.** Column grants + guard trigger + RLS; approval, status, billing
  and founding fields are written only by admin RPCs, the webhook and the reconcile.
- **Photos only from our bucket.** `photo_url` must be the public URL of the counselor's own upload in
  `counselor-photos`, so the app never loads images from a host a counselor controls (which could log
  families' network addresses). Uploads ≤ 2 MB, JPEG/PNG/WebP, own folder only.
- **Payments never touch our servers.** Card details go to Stripe Checkout; we store only Stripe customer,
  subscription and price ids (private schema). The webhook rejects unsigned/forged/replayed requests and is
  idempotent per event; it re-reads the subscription from Stripe rather than trusting event order.
- **Reports** store the reason, optional detail and a salted hash of the reporter's network address (same
  salt as research contributions, different purpose prefix); rate-limit rows are hashes kept two days.
- **Secrets** live only in Supabase function secrets and GitHub secrets; CI checks secret *names* and masks
  the service key.

## Tests

From `college-compass-app/`:

```sh
bash scripts/db-test/run.sh                          # SQL behaviour tests (needs postgresql-16 server binaries)
npx vitest run --config supabase/vitest.config.mjs    # Edge Function logic (Stripe/Supabase faked)
```

`scripts/db-test/run.sh` starts a throwaway Postgres 16, loads a small stand-in for Supabase (roles, default
grants, `auth`, `storage`), applies every migration and runs `scripts/db-test/*.test.sql` (115 checks: what
anon/counselors/admins can see and do, protected columns, approval and re-approval, founding dates,
suspension, every Stripe status mapping, the 7-day grace window, cancel at period end, idempotency, stale
updates, reconcile, report rate limits, storage policies, cascade on account deletion).

## Known limits / later

- Suspending doesn't cancel the Stripe subscription automatically (owner decides on refunds).
- `supabase.yml` runs on any change under `supabase/functions/**`, which also re-runs the (idempotent)
  Scorecard load; with `SCORECARD_API_KEY` set that's harmless.
- If the project switches to Supabase's new asymmetric JWT signing keys and the gateway starts rejecting
  user tokens for `counselor-checkout` / `counselor-billing`, set `verify_jwt = false` for them in
  `supabase/config.toml` — both functions verify the user with `auth.getUser` themselves.
