// POST /functions/v1/counselor-billing {} → { url } (Stripe customer portal: cancel, change plan, update card).
// Requires the counselor's Supabase Auth access token. See docs/COUNSELORS.md.
import { realDeps } from "../_shared/deps.ts";
import { handleBilling } from "../_shared/handlers.ts";

Deno.serve((req) => handleBilling(req, realDeps()));
