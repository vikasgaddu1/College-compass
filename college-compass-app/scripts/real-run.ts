/**
 * Real end-to-end run of College Compass's AI research + ranking with a real ChatGPT account,
 * outside a browser (no CORS). Uses the app's own modules: src/ai (auth, client, research) and
 * src/engine (odds, fit, ranking) — the same code the iPhone app runs.
 *
 * Needs network access to auth.openai.com and api.openai.com. Tokens are kept in a local JSON
 * file (CC_STORE, default ./cc-real-run.json) and never printed.
 *
 *   npm run real-run -- login                 # prints the Sign in with ChatGPT URL
 *   npm run real-run -- exchange '<url>'      # the http://127.0.0.1:1455/auth/callback?... URL
 *   npm run real-run -- research [n]          # plan + research n colleges (default 6), rank, print
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { College, StudentProfile } from "../src/types";

const STORE = process.env.CC_STORE ?? "./cc-real-run.json";
const REDIRECT = "http://127.0.0.1:1455/auth/callback";
const AUTHORIZE = "https://auth.openai.com/api/accounts/authorize";
const TOKEN = "https://auth.openai.com/api/accounts/oauth/token";

/** localStorage backed by a JSON file, so tokens and results survive between commands. */
class FileStorage {
  private m: Record<string, string>;
  constructor(private path: string) {
    this.m = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  }
  private flush() { writeFileSync(this.path, JSON.stringify(this.m, null, 1), { mode: 0o600 }); }
  get length() { return Object.keys(this.m).length; }
  key(i: number) { return Object.keys(this.m)[i] ?? null; }
  getItem(k: string) { return k in this.m ? this.m[k]! : null; }
  setItem(k: string, v: string) { this.m[k] = String(v); this.flush(); }
  removeItem(k: string) { delete this.m[k]; this.flush(); }
  clear() { this.m = {}; this.flush(); }
}
Object.defineProperty(globalThis, "localStorage", { value: new FileStorage(STORE), configurable: true });

const b64u = (b: Buffer) => b.toString("base64url");

function login() {
  const verifier = b64u(randomBytes(48));
  const challenge = b64u(createHash("sha256").update(verifier).digest());
  const state = b64u(randomBytes(16));
  const nonce = b64u(randomBytes(16));
  const host = localStorage.getItem("realrun_host") ?? `urn:uuid:${randomUUID()}`;
  localStorage.setItem("realrun_host", host);
  localStorage.setItem("realrun_pending", JSON.stringify({ verifier, state, nonce }));
  const q = new URLSearchParams({
    response_type: "code",
    client_id: "dynamic_agent_client",
    agent_name_hint: "College Compass",
    ext_agent_host_id: host,
    redirect_uri: REDIRECT,
    scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    resource: "https://api.openai.com/v1",
    state, nonce, code_challenge: challenge, code_challenge_method: "S256",
  });
  console.log(`${AUTHORIZE}?${q}`);
}

async function exchange(callbackUrl: string) {
  const cb = new URL(callbackUrl).searchParams;
  const p = JSON.parse(localStorage.getItem("realrun_pending") ?? "null");
  if (!p) throw new Error("Run `login` first.");
  if (cb.get("error")) throw new Error(`authorize error: ${cb.get("error")}`);
  if (cb.get("state") !== p.state) throw new Error("state mismatch");
  const clientId = cb.get("client_id");
  if (!clientId) throw new Error("callback has no client_id");
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code", client_id: clientId, code: cb.get("code") ?? "",
      code_verifier: p.verifier, redirect_uri: REDIRECT, resource: "https://api.openai.com/v1",
    }),
  });
  const json: any = await res.json();
  if (!res.ok) throw new Error(`token ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  const claims = JSON.parse(Buffer.from(json.id_token.split(".")[1], "base64url").toString("utf8"));
  const audOk = claims.aud === clientId || (Array.isArray(claims.aud) && claims.aud.includes(clientId));
  if (claims.nonce !== p.nonce || !audOk) throw new Error("id_token nonce/aud check failed");
  const now = Date.now();
  localStorage.setItem("cc2:chatgpt", JSON.stringify({
    access_token: json.access_token, refresh_token: json.refresh_token ?? null,
    expires_at: now + (Number(json.expires_in) || 3600) * 1000, earliest_refresh_at: null,
    scope: json.scope || "", client_id: clientId,
    claims: { sub: String(claims.sub), name: claims.name ?? null, email: claims.email ?? null, picture: claims.picture ?? null, signature_verified: false },
    saved_at: now,
  }));
  localStorage.removeItem("realrun_pending");
  console.log(JSON.stringify({ signed_in: claims.name ?? claims.email, client_id: clientId, scope: json.scope }));
}

/** A typical general-interest student (not robotics-specific). Override with CC_PROFILE=<json file>. */
function profile(): StudentProfile {
  if (process.env.CC_PROFILE) return JSON.parse(readFileSync(process.env.CC_PROFILE, "utf8"));
  return {
    version: 1, home_state: "NC", grad_year: 2027, gpa_unweighted: 3.8, gpa_weighted: 4.3, class_rank_pct: null,
    sat: 1430, act: null, rigor: "very", ap_ib_count: 7, activities_strength: "school_leader",
    majors: ["biology", "public_health"], interests_text: "pre-med, global health research",
    wanted_colleges: ["UNC Chapel Hill"], budget_per_year: 30000, income_band: "110k_plus",
    regions: ["south_atlantic"], max_distance_miles: null, size: "any", setting: "any", ownership: "any",
    plan: "ea_only", first_gen: false, priorities: { academics_fit: 5, affordability: 4, outcomes: 3, odds: 3, location: 2 },
  } as StudentProfile;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

async function research(n: number) {
  const { auth } = await import("../src/ai/auth");
  const { aiClient } = await import("../src/ai/client");
  const { createResearch } = await import("../src/ai/research");
  const { rankColleges, buildBalancedList } = await import("../src/engine");
  const acct = auth.account();
  if (!acct) throw new Error("Not signed in. Run `login` then `exchange`.");
  console.log(`Signed in as ${acct.name ?? acct.email} · plan usage: ${acct.plan_usage}`);
  const models = await aiClient.listModels();
  console.log(`Models: ${models.map((m) => m.slug).join(", ")}`);

  const prof = profile();
  const t0 = Date.now();
  const sec = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
  const colleges: College[] = await createResearch({ client: aiClient }).run({
    profile: prof,
    wanted: prof.wanted_colleges,
    target_count: Math.max(n, prof.wanted_colleges.length),
    onEvent: (e) => {
      if (e.type === "planned") console.log(`[${sec()}] planner → ${e.candidates.map((c) => c.name).join("; ")}`);
      else if (e.type === "batch_started") console.log(`[${sec()}] agent ${e.batch} researching ${e.names.join(", ")}`);
      else if (e.type === "college_done") console.log(`[${sec()}] ✓ ${e.college.name} (confidence ${e.college.data_confidence}, ${e.college.sources.length} sources)`);
      else if (e.type === "college_failed") console.log(`[${sec()}] ✗ ${e.name}: ${e.error}`);
      else if (e.type === "error") console.log(`[${sec()}] ERROR ${e.code ?? ""} ${e.error}`);
    },
  });
  const ranked = rankColleges(colleges, prof);
  const list = buildBalancedList(ranked, undefined, prof);
  console.log(`\nResearched ${colleges.length} colleges in ${sec()}. Ranked by fit:\n`);
  for (const r of ranked) {
    const c = r.college;
    console.log(
      `${c.name.padEnd(38)} ${r.odds.tier.padEnd(10)} odds ${pct(r.odds.low)}–${pct(r.odds.high)} (${r.odds.confidence})`
      + `  fit ${Math.round(r.fit.total)}  admit ${c.admit_rate == null ? "?" : pct(c.admit_rate)}`
      + `  net $${r.est_net_price ?? "?"}  data ${c.data_year ?? "?"}`,
    );
  }
  console.log(`\nBalanced list: ${(["high_reach", "reach", "target", "likely", "safety"] as const).map((t) => `${t} ${list[t].length}`).join(" · ")}`);
  writeFileSync("cc-real-run-results.json", JSON.stringify({ profile: prof, ranked }, null, 1));
  console.log("Full results: cc-real-run-results.json");
}

const [cmd, arg] = process.argv.slice(2);
const main = cmd === "login" ? async () => login()
  : cmd === "exchange" ? () => exchange(arg ?? "")
  : cmd === "research" ? () => research(Number(arg) || 6)
  : async () => { console.log("usage: real-run login | exchange '<callback url>' | research [n]"); };
main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
