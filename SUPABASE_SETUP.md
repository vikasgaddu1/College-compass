# Supabase setup for College Compass

The dashboard is fully functional signed-out on localStorage. To enable cloud
sync + counselor sharing, follow these steps once.

## 1. Create the Supabase project (5 min)

- supabase.com → New project → US East (or nearest to you)
- Save the database password (shown once)
- Wait ~2 min for provisioning

## 2. Run the migration (2 min)

- Sidebar → SQL Editor → New query
- Paste the contents of `supabase/migrations/20260816_initial.sql`
- Click Run — should say "Success. No rows returned."

Creates: `workspaces`, `workspace_members`, `school_notes`, `applicant_profile`,
`interest_log`. Full RLS enabled; anon key cannot read anything without auth.

## 3. Configure auth redirects (2 min)

Sidebar → Authentication → URL Configuration:
- Site URL: `https://vikasgaddu1.github.io/College-compass/`
- Redirect URLs: `https://vikasgaddu1.github.io/College-compass/` and
  optionally `http://localhost:5173`

## 4. Add GitHub repo secrets (3 min)

github.com/Vikasgaddu1/College-compass → Settings → Secrets and variables →
Actions → New repository secret. Add:

- `VITE_SUPABASE_URL` = your project URL (like `https://abcdefg.supabase.co`)
- `VITE_SUPABASE_ANON_KEY` = the anon public key (starts with `eyJ...`)

## 5. Trigger a rebuild (2 min)

- Actions → Deploy → Run workflow, or push any commit to main.
- The workflow (`.github/workflows/deploy.yml`) injects the env vars at build
  time and deploys to Pages.

## 6. Invite a counselor

- Sign in via magic link on the dashboard's Cloud sync page
- The `claim_pending_invites()` function auto-attaches any invites for your
  email to your user id
- Enter counselor's email in the invite form; they sign in with that email and
  join the workspace as viewer or editor
