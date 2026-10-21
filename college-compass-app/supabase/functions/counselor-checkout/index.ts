// POST /functions/v1/counselor-checkout { plan: "monthly" | "yearly" } → { url } (Stripe Checkout, subscription).
// Requires the counselor's Supabase Auth access token. See docs/COUNSELORS.md.
import { realDeps } from "../_shared/deps.ts";
import { handleCheckout } from "../_shared/handlers.ts";

Deno.serve((req) => handleCheckout(req, realDeps()));
