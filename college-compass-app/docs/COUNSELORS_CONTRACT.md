# Counselor directory — shared contract (backend ↔ frontend)

Owner decisions: counselors pay **$29/month or $290/year** (Stripe, Gaddu LLC is the merchant). The owner
(Vikas) **approves every counselor** before they appear. Families see the directory in the iPhone app via
Settings ("Get expert help"), a dismissible card on the list screen, and a link in the PDF share sheet.
Payment and sign-up happen ONLY on the website (counselor portal) — the iOS app never shows a purchase
flow or a "list your practice" link (Apple payment rules). Most app users are minors: no in-app
messaging; families contact counselors via website/phone/email; every listing is labelled "Paid listing";
listings never influence college recommendations; the app never sends student data to counselors.

Supabase project: ref `nspbxlnocelknibrajkv`, URL + publishable key in `src/data/shared.ts` (`sharedConfig`).
Migrations live in `college-compass-app/supabase/migrations/` (follow existing naming/style).

## Data (backend owns)
`public.counselors` — one row per counselor account:
- `id uuid pk`, `user_id uuid unique → auth.users` (on delete cascade)
- `status`: `draft | pending | approved | rejected | suspended` (default draft)
- Draft (editable by the counselor): `name, title, photo_url, bio (≤1200 chars), website, phone, email, city,
  states text[] (2-letter codes; 'US' = serves students nationwide virtually), specialties text[],
  modes text[] ('virtual','in_person'), credentials text`
- `published jsonb` — snapshot of the draft fields taken at approval; the directory shows ONLY this.
  `has_changes boolean` — draft differs from published (edits after approval need re-approval; the old
  published version stays live meanwhile).
- `subscription_status`: `none | trialing | active | past_due | unpaid | canceled` (default none); `plan`:
  `monthly | yearly | founding | null`; `founding_until date` (free "founding" listing set by admin);
  `past_due_since timestamptz` (first failed payment; cleared when paid), `current_period_end timestamptz`,
  `cancel_at_period_end boolean` — all written only by Stripe sync (webhook + daily reconcile)
- `review_note text` (admin's message to the counselor), `terms_accepted_at, submitted_at, approved_at,
  created_at, updated_at`
- Counselors may NOT change status/published/has_changes/subscription/plan/founding_until/review_note/
  approved_at (enforce with a trigger or column-level grants). *(Implemented: column grants — counselors can
  write only `user_id` + the draft fields — plus a guard trigger.)*

Specialties enum: `stem, engineering, arts, athletics, international, financial_aid, essays, test_prep,
transfer, learning_differences, first_gen, general`.

Listed (visible) = `status='approved' AND published IS NOT NULL AND (founding_until >= current_date OR
subscription_status IN ('active','trialing') OR (subscription_status='past_due' AND past_due_since >
now() - interval '7 days'))`. Supabase is the source of truth; the directory query applies this itself, so
nothing has to run for a listing to disappear. In words (owner decisions, 2026-10-21):
1. **Cancel** → listed until the end of the period already paid for (Stripe `cancel_at_period_end`; the
   subscription stays `active` until then), hidden once Stripe ends it (`customer.subscription.deleted` →
   `canceled`).
2. **Failed payment** → 7-day grace from the first failure (`past_due_since`, set on `invoice.payment_failed`
   or status `past_due`, cleared when paid/active), then hidden automatically. `unpaid` (also Stripe
   `paused`/unknown statuses) → hidden; `incomplete`/`incomplete_expired` → `none` (never paid) → hidden.
3. **Missed webhooks** → a daily reconcile (`counselor-reconcile` Edge Function, run by
   `.github/workflows/counselor-reconcile.yml`) re-reads every counselor's subscription from Stripe and fixes
   `subscription_status/plan/past_due_since`.
4. **Suspended** (admin) → hidden immediately whatever the payment state. **Founding** → payment ignored
   until `founding_until` (inclusive).
5. The app doesn't cache the directory beyond the screen session, so changes show the next time a family
   opens it.

## API (frontend calls these)
Anonymous (publishable key), from the app:
- `POST /rest/v1/rpc/counselor_directory` `{ p_state: text|null, p_specialties: text[]|null }` →
  `[{ id, name, title, photo_url, bio, website, phone, email, city, states, specialties, modes,
  credentials }]` (published fields only; listed counselors only; state filter matches `p_state` or `'US'`;
  specialty filter = any overlap; order rotates daily so no one is always first).
- `POST /rest/v1/rpc/report_counselor` `{ p_counselor: uuid, p_reason: text, p_detail: text|null }` →
  `{ ok: true }` (rate-limited per salted IP hash like contributions; reasons: `inappropriate, misleading,
  unresponsive, other`).

Counselor portal (Supabase Auth email magic link, user JWT):
- `select/insert/update` own row on `public.counselors` via PostgREST (RLS: `user_id = auth.uid()`;
  insert creates status draft).
- `POST /rest/v1/rpc/submit_counselor_for_review` `{}` → sets `pending` (from draft/rejected) or sets
  `has_changes` review flag for approved; requires terms accepted (`terms_accepted_at` set via
  `accept_counselor_terms()` RPC).
- Photo upload: Storage bucket `counselor-photos`, public read, owner writes only under `<uid>/…`,
  ≤ 2 MB, image/jpeg|png|webp.
- Edge Functions (JWT required): `POST /functions/v1/counselor-checkout` `{ plan: 'monthly'|'yearly' }` →
  `{ url }` (Stripe Checkout, subscription mode); `POST /functions/v1/counselor-billing` `{}` → `{ url }`
  (Stripe customer portal). `stripe-webhook` (no JWT; Stripe signature) keeps subscription_status/plan
  in sync. Checkout success_url = `<portal>#/billing?checkout=success`, cancel_url = `<portal>#/billing?checkout=cancel`;
  the customer portal's return_url = `<portal>#/billing`.

Admin (owner) — `cc_private.admins(email)` (the project's existing private schema; not API-reachable);
`public.is_admin()` (signed-in user's *confirmed* email is in the list; callable by anyone, returns boolean):
- `POST /rest/v1/rpc/admin_counselors` `{ p_status: text|null }` → full rows incl. draft vs published and
  report counts (admins only). Extra columns: `account_email, awaiting_review, listed, past_due_since,
  report_count, recent_report_count` (30 days). `p_status` also accepts `'review'` (awaiting review) and
  `'listed'`. Ordered awaiting-review first, then most recently updated.
- `POST /rest/v1/rpc/admin_review_counselor` `{ p_id, p_decision: 'approve'|'reject'|'suspend'|'unsuspend'|'founding',
  p_note: text|null, p_founding_until: date|null, p_expected_updated_at: timestamptz|null }` — approve copies
  draft → published. `reject` on an approved counselor declines the submitted edits (published version and
  `approved` status stay). `founding` only sets `founding_until` (required). `p_founding_until` with any
  decision sets the founding end date (a past date ends it). `p_expected_updated_at` (optional) → error
  `changed_since_viewed` if the row changed since the admin loaded it. Returns `{ ok, id, status, listed,
  has_changes, plan, founding_until, updated_at }`.
- `POST /rest/v1/rpc/admin_counselor_reports` `{}` → recent reports.

## Website
Portal at `college-compass-app/counselors/index.html` (second Vite entry), deployed with the app to
`https://vikasgaddu1.github.io/College-compass/app/counselors/` (deploy.yml copies the app's dist to
`_site/app`). Hash routes: `#/` public landing page for counselors (the outreach link), `#/signin` email
magic link (`emailRedirectTo` = portal URL + `#/profile`, so the Supabase Auth redirect allow-list must
include `https://vikasgaddu1.github.io/College-compass/app/counselors/**`), `#/profile`, `#/billing`,
`#/admin` (admins only), `#/terms` counselor terms. Founding offer copy on the landing page: free for the
first 30 counselors until 3 months after the public App Store launch (admin sets `founding_until`; the
cap is enforced manually by the owner).

## Backend notes (implemented — `supabase/migrations/20261021020000_counselors.sql`)
- **Errors from RPCs** are raised with a short code as the message (PostgREST `{ code, message, hint,
  details }`): `not_signed_in, no_profile, terms_not_accepted, incomplete_profile` (hint `Missing: name, bio,
  states, specialties, modes, contact`; details = comma list), `no_changes, suspended, not_authorized` (42501
  → HTTP 403), `not_found, bad_decision, changed_since_viewed, not_suspended, founding_until_required`.
  Table writes: `photo_url_invalid` (23514), `protected_column`, check-constraint violations.
- **Submit requirements**: terms accepted; name, bio, ≥1 state, ≥1 specialty, ≥1 mode, and at least one of
  website/phone/email. `submit_counselor_for_review()` → `{ ok, status, awaiting_review, submitted_at }`.
  `accept_counselor_terms()` creates the draft row if none exists → `{ ok, terms_accepted_at }`.
- **Normalisation** (trigger): text trimmed, `''` → null, email lower-cased, states upper-cased/de-duplicated,
  arrays sorted. `has_changes` = published exists and differs from the draft.
- **Field limits**: name/title ≤ 120, bio ≤ 1200, website ≤ 300 and `http(s)://host.tld…`, phone 7–30 of
  `0-9 + ( ) . - / x` and spaces, email ≤ 254, city ≤ 80, credentials ≤ 300; states = 50 states + DC, PR, GU,
  VI, AS, MP, `US`.
- **photo_url** must be the bucket's public URL inside the counselor's own folder:
  `https://nspbxlnocelknibrajkv.supabase.co/storage/v1/object/public/counselor-photos/<uid>/<file>` (file
  `[A-Za-z0-9._-]`, optional `?v=…`), i.e. exactly what `getPublicUrl('<uid>/photo-123.jpg')` returns. This
  keeps the app from loading images from hosts a counselor controls.
- **report_counselor** → `{ ok: true }`, or `{ ok: false, reason: 'bad_reason'|'rate_limited'|'unknown_counselor' }`
  (only listed counselors can be reported; 5 per network address per hour; repeats from the same address
  for the same counselor within a day are acknowledged but not stored).
- **counselor_directory** rotation: `order by md5(id || current_date)` (UTC day); at most 500 rows.
- **Edge Functions**: errors are `{ error: <code>, message: <text> }`. `counselor-checkout`: 400 `bad_plan`,
  401 `not_signed_in`, 404 `no_profile`, 409 `terms_not_accepted`, 403 `suspended`, 409 `already_subscribed`
  (active/trialing/past_due/unpaid — use billing portal), 503 `billing_not_configured`, 502 `stripe_error`.
  Checkout returns to `PORTAL_URL#/billing?checkout=success` or `#/billing?checkout=cancel`.
  `counselor-billing`: 409 `no_billing_account` before the first checkout; returns to `PORTAL_URL#/billing`.
- **Not exposed**: `billing_*` RPCs are service-role only (Edge Functions). `counselor-reconcile` requires
  the project's service key.
