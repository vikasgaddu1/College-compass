// Real dependencies for the counselor Edge Functions (Deno / Supabase Edge Runtime only).
// Secrets come from the function environment (`supabase secrets set …`); none are ever logged.
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_MONTHLY, STRIPE_PRICE_YEARLY   (owner sets)
//   PORTAL_URL (optional), COUNSELOR_ALLOWED_ORIGINS (optional, comma-separated)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY                                              (built in)
import Stripe from "npm:stripe@22.6.2";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import type { Db, Deps, StripeLike } from "./handlers.ts";
import { parseOrigins, portalUrl } from "./http.ts";

const env = (k: string): string | undefined => Deno.env.get(k)?.trim() || undefined;

let cached: Deps | null = null;

export function realDeps(): Deps {
  if (cached) return cached;
  const url = env("SUPABASE_URL")!;
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY")!;
  const stripeKey = env("STRIPE_SECRET_KEY");
  const noSession = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const admin = createClient(url, serviceKey, noSession);

  const stripe = stripeKey
    ? new Stripe(stripeKey, {
        // Deno: use fetch instead of Node's http module.
        httpClient: Stripe.createFetchHttpClient(),
        maxNetworkRetries: 2,
        appInfo: { name: "college-compass-counselors" },
      })
    : null;

  cached = {
    config: {
      portalUrl: portalUrl(env("PORTAL_URL")),
      origins: parseOrigins(env("COUNSELOR_ALLOWED_ORIGINS")),
      priceMonthly: env("STRIPE_PRICE_MONTHLY"),
      priceYearly: env("STRIPE_PRICE_YEARLY"),
      webhookSecret: env("STRIPE_WEBHOOK_SECRET"),
    },
    db: admin as unknown as Db,
    stripe: stripe as unknown as StripeLike | null,
    // Deno has no Node crypto for HMAC: verify webhook signatures with Web Crypto (SubtleCrypto).
    cryptoProvider: Stripe.createSubtleCryptoProvider(),
    async getUser(token) {
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data?.user) return null;
      return { id: data.user.id, email: data.user.email ?? null };
    },
    dbWithKey: (key) => createClient(url, key, noSession) as unknown as Db,
  };
  return cached;
}
