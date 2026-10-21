// POST /functions/v1/counselor-reconcile — daily safety net for missed webhooks (called by
// .github/workflows/counselor-reconcile.yml). Compares every counselor with Stripe and fixes
// subscription_status / plan / past_due_since. Only callers holding the project's service key get past the
// first database call; returns { skipped } until STRIPE_SECRET_KEY is set.
import { realDeps } from "../_shared/deps.ts";
import { handleReconcile } from "../_shared/handlers.ts";

Deno.serve((req) => handleReconcile(req, realDeps()));
