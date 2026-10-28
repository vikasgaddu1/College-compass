/**
 * Tierwise — stateless token relay (Cloudflare Worker).
 *
 * Only needed by the WEB/PWA build, and only if https://auth.openai.com/api/accounts/oauth/token
 * refuses cross-origin requests from the browser. The native iOS app never uses it.
 *
 * It forwards one thing: a form-encoded POST to OpenAI's token endpoint (authorization_code and
 * refresh_token grants of a PUBLIC client — PKCE, no client secret). It stores nothing, logs nothing,
 * adds no credentials and rejects every other method, path, origin, content type and grant.
 */
const UPSTREAM = "https://auth.openai.com/api/accounts/oauth/token";
const ALLOWED_GRANTS = new Set(["authorization_code", "refresh_token"]);
const MAX_BODY = 16 * 1024;

function cors(origin, allowed) {
  const h = new Headers({ "Vary": "Origin", "Cache-Control": "no-store" });
  if (origin && origin === allowed) {
    h.set("Access-Control-Allow-Origin", origin);
    h.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    h.set("Access-Control-Allow-Headers", "Content-Type, Accept");
    h.set("Access-Control-Max-Age", "600");
  }
  return h;
}

function reply(status, obj, headers) {
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(obj), { status, headers });
}

export default {
  async fetch(request, env) {
    const allowed = (env.ALLOWED_ORIGIN || "").trim();
    const origin = request.headers.get("Origin") || "";
    const headers = cors(origin, allowed);
    const url = new URL(request.url);

    if (url.pathname !== "/" && url.pathname !== "/token") return reply(404, { error: "not_found" }, headers);
    if (!allowed || origin !== allowed) return reply(403, { error: "origin_not_allowed" }, headers);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return reply(405, { error: "method_not_allowed" }, headers);

    const ct = (request.headers.get("Content-Type") || "").toLowerCase();
    if (!ct.startsWith("application/x-www-form-urlencoded")) return reply(415, { error: "unsupported_media_type" }, headers);

    const body = await request.text();
    if (body.length > MAX_BODY) return reply(413, { error: "payload_too_large" }, headers);
    const form = new URLSearchParams(body);
    if (!ALLOWED_GRANTS.has(form.get("grant_type") || "")) return reply(400, { error: "unsupported_grant_type" }, headers);
    if (form.has("client_secret")) return reply(400, { error: "invalid_request" }, headers);

    let upstream;
    try {
      upstream = await fetch(UPSTREAM, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
        body: form.toString(),
        redirect: "manual",
      });
    } catch {
      return reply(502, { error: "upstream_unreachable" }, headers);
    }
    headers.set("Content-Type", upstream.headers.get("Content-Type") || "application/json");
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
