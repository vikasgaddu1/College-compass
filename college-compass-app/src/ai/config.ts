/**
 * Sign in with ChatGPT + Responses API configuration.
 * Values verified against developers.openai.com/siwc (Oct 2026); see docs/CHATGPT_SIGNIN.md.
 */
import { redirectUri } from "../platform";

function env(name: "VITE_CC_CHATGPT_CLIENT_ID" | "VITE_CC_TOKEN_RELAY"): string {
  try {
    const v = (import.meta as ImportMeta).env?.[name];
    return typeof v === "string" ? v.trim() : "";
  } catch {
    return "";
  }
}

/** Public OAuth client ID (build-time). Empty string when not configured. */
export const CLIENT_ID: string = env("VITE_CC_CHATGPT_CLIENT_ID");
/** Optional stateless token relay (web builds only, when the token endpoint blocks browser CORS). */
export const TOKEN_RELAY: string = env("VITE_CC_TOKEN_RELAY");

/** Read at call time (lets tests stub env with vi.stubEnv). */
export function clientId(): string {
  return env("VITE_CC_CHATGPT_CLIENT_ID") || CLIENT_ID;
}
export function tokenRelay(): string {
  return env("VITE_CC_TOKEN_RELAY") || TOKEN_RELAY;
}

export const ISSUER = "https://auth.openai.com";
export const AUTHORIZE_URL = "https://auth.openai.com/api/accounts/authorize";
export const TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token";
export const JWKS_URL = "https://auth.openai.com/.well-known/jwks.json";
export const OIDC_DISCOVERY_URL = "https://auth.openai.com/.well-known/openid-configuration";

export const RESOURCE = "https://api.openai.com/v1";
export const RESPONSES_URL = "https://api.openai.com/v1/responses";
export const MODELS_URL = "https://api.openai.com/v1/models";

export const PLAN_USAGE_SCOPE = "chatgpt.tokens.use.direct";
export const SCOPES = ["openid", "profile", "email", "offline_access", "resource.invoke", PLAN_USAGE_SCOPE] as const;
export const SCOPE = SCOPES.join(" ");

/** Where users manage ChatGPT plan usage ("Manage usage" link per OpenAI's UI guidelines). */
export const MANAGE_USAGE_URL = "https://chatgpt.com/settings/usage";

/** UI copy from developers.openai.com/siwc/ui-ux-guidelines (Oct 2026). */
export const UI_COPY = {
  button: "Continue with ChatGPT",
  welcomeTitle: "You\u2019re using your ChatGPT plan",
  welcomeBody: "Eligible usage in this app uses your ChatGPT plan. Manage usage in your ChatGPT settings.",
  welcomeDismiss: "Got it",
  settingsHeading: "Use your ChatGPT plan",
  settingsBody: "Complete eligible AI requests in this app with usage included in your ChatGPT plan or credits balance.",
  indicator: "Using ChatGPT plan",
  manageUsage: "Manage usage",
  manageUsageSub: "View and manage your ChatGPT usage",
  limitTitle: "Usage limit reached",
  limitBody: "Review your plan or this app\u2019s limit in ChatGPT settings.",
} as const;

/** Same HTTPS redirect URI for web and native (callback.html forwards to the app). */
export function getRedirectUri(): string {
  return redirectUri();
}

/** Suffix appended to `state` so callback.html knows to forward to the native app. */
export const NATIVE_STATE_SUFFIX = ".n";

/**
 * Self-serve sign-in for open-source, locally run apps (developers.openai.com/siwc/token-sharing-open-source,
 * Oct 2026). Used by the native iOS app when no partner client ID is configured: the first sign-in
 * registers this install with `client_id=dynamic_agent_client`; OpenAI returns an issued client ID
 * (`oaiapp_…`) on the redirect, which is reused for later sign-ins, the token exchange and refresh.
 */
export const SELF_SERVE_CLIENT_ID = "dynamic_agent_client";
/** `agent_name_hint` — display metadata, identical across installs. Sent on first registration only. */
export const AGENT_NAME_HINT = "College Compass";

/** Storage keys (all under the `cc2:` namespace, written via src/lib/storage). */
export const KEYS = {
  pending: "oauth_pending",
  tokens: "chatgpt",
  models: "chatgpt_models",
  devKey: "dev_openai_key",
  devModel: "dev_openai_model",
  model: "ai_model",
  caps: "ai_caps",
  researchCache: "research_cache",
  /** Stable per-device `ext_agent_host_id` (`urn:uuid:…`) for self-serve sign-in. */
  hostId: "host_id",
  /** Issued self-serve client IDs for this device (by account `sub`, plus the latest). */
  issuedClientIds: "issued_client_id",
} as const;

/** Default model for the developer API-key demo mode (override with localStorage `cc2:dev_openai_model`). */
export const DEV_DEFAULT_MODEL = "gpt-5";

/** Sign-in attempts older than this are rejected on the callback. */
export const PENDING_TTL_MS = 10 * 60 * 1000;
/** Refresh the access token this long before it expires. */
export const REFRESH_SKEW_MS = 2 * 60 * 1000;
/** Model list cache lifetime. */
export const MODELS_TTL_MS = 60 * 60 * 1000;
