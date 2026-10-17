/** Test-only helpers for src/ai/*.test.ts (not imported by app code). */
import type { College, StudentProfile } from "../types";
import type { Jwk } from "./jwt";
import { base64url } from "./pkce";

export class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}

export function installMemoryStorage(): MemoryStorage {
  const s = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", { value: s, configurable: true, writable: true });
  return s;
}

/** A ReadableStream that yields the given string chunks. */
export function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (i < chunks.length) ctrl.enqueue(enc.encode(chunks[i++]!));
      else ctrl.close();
    },
  });
}

/** SSE text for a list of Responses events. */
export function sseText(events: Record<string, unknown>[]): string {
  return events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

export function sseResponse(events: Record<string, unknown>[], init: ResponseInit = {}): Response {
  return new Response(streamOf([sseText(events)]), { status: 200, headers: { "Content-Type": "text/event-stream" }, ...init });
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

export function baseProfile(over: Partial<StudentProfile> = {}): StudentProfile {
  return {
    version: 1,
    name: "Should Not Appear",
    home_state: "NC",
    grad_year: 2027,
    gpa_unweighted: 3.8,
    gpa_weighted: 4.3,
    class_rank_pct: null,
    sat: 1420,
    act: null,
    rigor: "very",
    ap_ib_count: 7,
    activities_strength: "school_leader",
    majors: ["nursing", "public_health"],
    interests_text: "pediatric nursing, global health",
    wanted_colleges: [],
    budget_per_year: 30000,
    income_band: "75_110k",
    regions: ["south_atlantic"],
    max_distance_miles: null,
    size: "any",
    setting: "any",
    ownership: "any",
    plan: "ea_only",
    first_gen: false,
    priorities: { academics_fit: 5, affordability: 4, outcomes: 3, odds: 3, location: 2 },
    ...over,
  };
}

/** Minimal valid researcher output for one college. */
export function rawCollege(name: string, state = "NC", over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name, short: null, city: "Somewhere", state, ownership: "public", locale: "city", url: "https://example.edu",
    lat: 35.9, lon: -79.0, undergrad_size: 20000, admit_rate: 0.4, sat_25: 1200, sat_75: 1400, act_25: 25, act_75: 31,
    test_policy: "optional", tuition_in_state: 9000, tuition_out_of_state: 38000, cost_of_attendance: 30000, cost_of_attendance_basis: "in_state",
    avg_net_price: 15000, net_price_by_income: { "0_30k": 5000, "30_48k": 7000, "48_75k": 11000, "75_110k": 17000, "110k_plus": 24000 },
    grad_rate_6yr: 0.8, retention_rate: 0.9, median_earnings_10yr: 60000, program_share: [], hbcu: false, women_only: false,
    religious: false, cds: {}, application: { cycle: "Fall 2027 entry", plans: [], test_policy_note: null, essays_note: null, fee: null },
    programs: [], scholarships: [], sources: [{ title: "CDS", url: "https://example.edu/cds.pdf" }],
    data_year: "2025-26 CDS", data_confidence: "high", data_notes: [],
    ...over,
  };
}

export function fakeCollege(name: string, researchedAt: string): College {
  return {
    id: `ai-${name.toLowerCase().replace(/\s+/g, "-")}`, name, short: name, city: "", state: "NC", region: "south_atlantic",
    lat: null, lon: null, ownership: "public", locale: null, url: null, undergrad_size: null, admit_rate: 0.5,
    sat_25: null, sat_75: null, act_25: null, act_75: null, test_policy: "unknown", tuition_in_state: null,
    tuition_out_of_state: null, cost_of_attendance: null, avg_net_price: null,
    net_price_by_income: { "0_30k": null, "30_48k": null, "48_75k": null, "75_110k": null, "110k_plus": null },
    grad_rate_6yr: null, retention_rate: null, median_earnings_10yr: null, program_share: {}, hbcu: false,
    women_only: false, religious: false, data_year: "2025-26", source: "ai_research", sources: [],
    researched_at: researchedAt, data_confidence: "medium", data_notes: [],
  };
}

/** RSA key pair + RS256 JWT signer for ID-token tests. */
export async function makeSigner(kid = "k1") {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as Jwk;
  const sign = async (payload: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid, typ: "JWT" }) => {
    const enc = (o: unknown) => base64url(new TextEncoder().encode(JSON.stringify(o)));
    const input = `${enc(header)}.${enc(payload)}`;
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(input));
    return `${input}.${base64url(sig)}`;
  };
  return { jwk: { ...jwk, kid, use: "sig", alg: "RS256" } as Jwk, sign };
}

