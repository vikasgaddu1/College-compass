// POST /functions/v1/stripe-webhook — called by Stripe only. No Supabase JWT (verify_jwt = false); every
// request must carry a valid Stripe-Signature for STRIPE_WEBHOOK_SECRET. Keeps subscription_status/plan in
// sync. See docs/COUNSELORS.md for the events to subscribe to.
import { realDeps } from "../_shared/deps.ts";
import { handleWebhook } from "../_shared/handlers.ts";

Deno.serve((req) => handleWebhook(req, realDeps()));
