// Supabase Edge Function `attest` — Apple App Attest for shared-research contributions.
// Protocol and responses: ./handler.ts. Verification: ./appattest/verify.ts (pinned Apple root).
// Database side: supabase/migrations/20261021000000_app_attest.sql (service-role-only functions).
//
// Deploy: `supabase functions deploy attest --no-verify-jwt` (.github/workflows/supabase.yml). The
// app calls it with the publishable key, which is not a JWT, so the gateway's JWT check is off;
// every request is authenticated by App Attest itself.
//
// Environment (provided by Supabase): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Optional secret
// CC_SERVICE_KEY overrides the service key (e.g. a new-style sb_secret_… key).
import { createHandler, createRestRpc } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const key = Deno.env.get("CC_SERVICE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const handler = createHandler({
  rpc: createRestRpc(url, key),
  log: (msg) => console.log(msg),
});

Deno.serve(handler);
