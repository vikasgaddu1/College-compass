// HTTP helpers shared by the counselor Edge Functions. Pure (no Deno/npm imports) so it runs under Vitest.

export const DEFAULT_PORTAL_URL = "https://vikasgaddu1.github.io/College-compass/app/counselors/";
export const DEFAULT_ORIGINS = ["https://vikasgaddu1.github.io"];

/** Comma-separated origins (e.g. "https://vikasgaddu1.github.io,http://localhost:5173"); default: the portal's. */
export function parseOrigins(raw: string | undefined | null): string[] {
  const list = (raw ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter((s) => /^https?:\/\/[^/\s]+$/.test(s));
  return list.length ? list : DEFAULT_ORIGINS;
}

/** The portal URL with a trailing slash; falls back to the default when unset or not https. */
export function portalUrl(raw: string | undefined | null): string {
  const v = (raw ?? "").trim();
  if (!/^https:\/\/[^\s#?]+$/.test(v)) return DEFAULT_PORTAL_URL;
  return v.endsWith("/") ? v : `${v}/`;
}

export function corsHeaders(req: Request, origins: string[]): Record<string, string> {
  const h: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
  };
  const origin = req.headers.get("origin");
  if (origin && origins.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Error body shared by all functions: { error: <code>, message: <human text> }. */
export function fail(status: number, error: string, message: string, headers: Record<string, string> = {}): Response {
  return json({ error, message }, status, headers);
}

export function bearerToken(req: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  return m ? m[1] : null;
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
