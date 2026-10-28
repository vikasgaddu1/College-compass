/**
 * Apple App Attest for shared-research contributions (iOS app only).
 *
 * Proves to the shared database that a contribution comes from the genuine Tierwise app on a
 * real Apple device, so nobody can fake "independent students" by calling the database with made-up
 * install IDs. Server: supabase/functions/attest (verification) + the `contribute_research_attested`
 * database function. Sequence for one contribution:
 *
 *   1. status()                                 → supported? already registered?
 *   once per install (at most one try a day):
 *   2. POST {op:"challenge", purpose:"attest"}  → challenge
 *   3. attestKey({challenge})                    → Secure Enclave key + Apple attestation over SHA256(challenge)
 *   4. POST {op:"register", key_id, attestation, challenge} → server checks the chain to Apple's root, stores the key
 *   5. confirmKey({keyId})
 *   every contribution:
 *   6. POST {op:"challenge", purpose:"assert"}  → fresh single-use challenge
 *   7. clientData = JSON {"v":1,"op":"contribute","challenge":…,"payload":<the contribution>}
 *      generateAssertion({clientData})           → signature over SHA256(clientData) (binds the exact payload)
 *   8. POST {op:"contribute", key_id, client_data, assertion} → verified, then stored as an attested contribution
 *
 * Never on the critical path and never blocking: contributions are fire-and-forget, each attested
 * attempt is time-boxed, and any failure (unsupported device, Simulator, offline, Apple or server
 * error) returns false so the caller sends the contribution the old, unattested way.
 * Nothing personal is sent: the key is generated for this app only and identifies nothing.
 */
import type { AppAttestPlugin } from "../platform";
import { load, save } from "../lib/storage";
import type { Contribution } from "./shared";

export interface Attestor {
  /** True when the attested path delivered the contribution; false → send it unattested. Never throws. */
  contribute(c: Contribution): Promise<boolean>;
}

export interface AttestorOptions {
  /** `${supabaseUrl}/functions/v1/attest` */
  endpoint: string;
  /** The project's publishable key (sent as `apikey`; the function itself doesn't need it). */
  apiKey: string;
  native: AppAttestPlugin;
  fetch: typeof fetch;
  /** Budget for one contribution's attested attempt, including a first-time attestation (default 20 s). */
  timeoutMs?: number;
  now?: () => number;
  /** When the next key registration may be tried (ms since epoch); persisted in local storage by default. */
  retry?: { get(): number; set(ms: number): void };
}

/** One attestation attempt per day at most (Apple rate-limits attestKey; failures are rare and sticky). */
export const ATTEST_RETRY_MS = 24 * 60 * 60 * 1000;
const RETRY_KEY = "app_attest_retry_after";

const storedRetry = { get: () => load<number>(RETRY_KEY, 0), set: (ms: number) => void save(RETRY_KEY, ms) };

export function createAttestor(o: AttestorOptions): Attestor {
  const now = o.now ?? (() => Date.now());
  const timeoutMs = o.timeoutMs ?? 20_000;
  let retryAfterMem = 0;
  const retry = {
    get: () => Math.max(retryAfterMem, (o.retry ?? storedRetry).get() || 0),
    set: (ms: number) => {
      retryAfterMem = ms;
      (o.retry ?? storedRetry).set(ms);
    },
  };
  let unsupported = false;
  // Assertions are sent one at a time so their counters reach the server in order.
  let queue: Promise<void> = Promise.resolve();

  async function post(body: Record<string, unknown>, signal: AbortSignal): Promise<{ ok: boolean; status: number; body: Record<string, unknown> | null }> {
    const r = await o.fetch(o.endpoint, {
      method: "POST",
      headers: { apikey: o.apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    let json: Record<string, unknown> | null = null;
    try {
      json = (await r.json()) as Record<string, unknown>;
    } catch {
      json = null;
    }
    return { ok: r.ok, status: r.status, body: json };
  }

  async function challenge(purpose: "attest" | "assert", signal: AbortSignal): Promise<string> {
    const r = await post({ op: "challenge", purpose }, signal);
    const c = r.body?.challenge;
    if (!r.ok || typeof c !== "string") throw new Error("no challenge");
    return c;
  }

  /** A key the server knows, registering one first if needed. False → contribute unattested. */
  async function ensureKey(signal: AbortSignal): Promise<boolean> {
    const st = await o.native.status();
    if (!st?.supported) {
      unsupported = true;
      return false;
    }
    if (st.registered) return true;
    if (retry.get() > now()) return false;
    retry.set(now() + ATTEST_RETRY_MS); // before trying, so a crash mid-way can't cause a retry loop
    const ch = await challenge("attest", signal);
    const { keyId, attestation } = await o.native.attestKey({ challenge: ch });
    if (signal.aborted) throw new Error("aborted"); // (AbortSignal.throwIfAborted needs iOS 15.4)
    const r = await post({ op: "register", key_id: keyId, attestation, challenge: ch }, signal);
    if (!r.ok) return false;
    await o.native.confirmKey({ keyId });
    retry.set(0);
    return true;
  }

  async function attempt(c: Contribution, signal: AbortSignal): Promise<boolean> {
    if (!(await ensureKey(signal))) return false;
    const ch = await challenge("assert", signal);
    const clientData = JSON.stringify({ v: 1, op: "contribute", challenge: ch, payload: c });
    const { keyId, assertion } = await o.native.generateAssertion({ clientData });
    if (signal.aborted) throw new Error("aborted");
    const r = await post({ op: "contribute", key_id: keyId, client_data: clientData, assertion }, signal);
    if (r.status === 404 || (r.status === 403 && r.body?.reason === "revoked_key")) {
      // The server doesn't (or no longer) accept this key: attest a fresh one next time.
      await o.native.resetKey().catch(() => {});
    }
    return r.ok;
  }

  return {
    contribute(c) {
      if (unsupported) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        let settled = false;
        const ctl = new AbortController();
        const finish = (v: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(v);
        };
        const timer = setTimeout(() => {
          ctl.abort();
          finish(false);
        }, timeoutMs);
        queue = queue.then(async () => {
          if (settled) return; // timed out while waiting: the caller already sent it unattested
          try {
            finish(await attempt(c, ctl.signal));
          } catch {
            finish(false);
          }
        });
      });
    },
  };
}
