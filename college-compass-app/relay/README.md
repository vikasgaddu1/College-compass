# Token relay (optional, web build only)

A ~70-line Cloudflare Worker that forwards **only** `POST` form requests with
`grant_type=authorization_code` or `grant_type=refresh_token` to
`https://auth.openai.com/api/accounts/oauth/token` and returns the response unchanged.

- **Stateless:** no KV/D1/R2/Durable Objects, no logging, observability disabled.
- **Locked down:** CORS and requests restricted to `ALLOWED_ORIGIN`; any other path, method, grant,
  content type or a `client_secret` is rejected. It holds no secrets — the app is a public PKCE client.
- **Who needs it:** only the web/PWA build, and only if OpenAI's token endpoint blocks browser CORS.
  The native iOS app talks to the token endpoint directly (CapacitorHttp has no CORS).

Tokens do pass through the Worker in transit (TLS both ways). That is the trade-off of a backend-free
web app whose identity provider doesn't allow browser token requests.

## How to tell whether you need it
Sign in on the web build and open DevTools → Console. If the token exchange fails with
`… has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header …` for
`auth.openai.com/api/accounts/oauth/token`, the app shows "this browser may be blocking the request
(CORS)". Deploy the relay.

## Deploy
```bash
cd college-compass-app/relay
npx wrangler@3 login
# Edit ALLOWED_ORIGIN in wrangler.toml if the app is not on https://vikasgaddu1.github.io
npx wrangler@3 deploy
# → https://college-compass-token-relay.<your-subdomain>.workers.dev
```
Then set the GitHub Actions secret `VITE_CC_TOKEN_RELAY` to that URL and redeploy the site.
For local dev (`npm run dev`), create `college-compass-app/.env.local` with
`VITE_CC_TOKEN_RELAY=…` and add a second deployment whose `ALLOWED_ORIGIN = "http://localhost:5173"`
(e.g. `npx wrangler@3 deploy --env dev` after adding an `[env.dev.vars]` block).

The app tries the token endpoint directly first and only falls back to the relay when the browser
blocks the request, so leaving the secret set is harmless if OpenAI later allows CORS.
