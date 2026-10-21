/** The portal's supabase-js client (never imported by the app bundle). */
import { createClient } from "@supabase/supabase-js";
import { sharedConfig } from "@/data/shared";
import { createPortalApi, type PortalApi } from "./api";

/** Null when shared data is turned off for this build (e.g. the mocked e2e build). */
export function createLivePortalApi(): PortalApi | null {
  const cfg = sharedConfig();
  if (!cfg) return null;
  const sb = createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" } });
  return createPortalApi(sb);
}
