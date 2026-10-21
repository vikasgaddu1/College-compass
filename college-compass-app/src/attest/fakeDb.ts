/**
 * Test-only in-memory stand-in for the database functions the `attest` Edge Function calls
 * (supabase/migrations/20261021000000_app_attest.sql), with the same single-use challenge,
 * key registration and strictly-increasing-counter semantics.
 */
import type { Rpc } from "../../supabase/functions/attest/handler";

export interface FakeDb {
  rpc: Rpc;
  calls: { fn: string; args: Record<string, unknown> }[];
  keys: Map<string, { public_key: string; counter: number; environment: string; revoked: boolean }>;
  contributions: { payload: unknown; key_id: string }[];
  settings: { allowDevelopment: boolean };
  /** Force the next call to `fn` to return `value` (or throw when it's an Error). */
  override(fn: string, value: unknown): void;
}

export function fakeDb(): FakeDb {
  const challenges = new Map<string, { purpose: string; used: boolean }>();
  const keys: FakeDb["keys"] = new Map();
  const contributions: FakeDb["contributions"] = [];
  const calls: FakeDb["calls"] = [];
  const overrides = new Map<string, unknown>();
  const settings = { allowDevelopment: false };
  const consume = (c: unknown, purpose: string) => {
    const ch = typeof c === "string" ? challenges.get(c) : undefined;
    if (!ch || ch.used || ch.purpose !== purpose) return false;
    ch.used = true;
    return true;
  };
  const rpc: Rpc = async (fn, args) => {
    calls.push({ fn, args });
    if (overrides.has(fn)) {
      const v = overrides.get(fn);
      overrides.delete(fn);
      if (v instanceof Error) throw v;
      return v;
    }
    switch (fn) {
      case "attest_new_challenge":
        challenges.set(String(args.p_challenge), { purpose: String(args.p_purpose), used: false });
        return { status: "ok", expires_in: 300 };
      case "attest_register_key": {
        if (!consume(args.p_challenge, "attest")) return { status: "rejected", reason: "bad_challenge" };
        if (args.p_environment === "development" && !settings.allowDevelopment) return { status: "rejected", reason: "development_not_allowed" };
        const id = String(args.p_key_id);
        if (keys.has(id)) return { status: "rejected", reason: "key_exists" };
        keys.set(id, { public_key: String(args.p_public_key), counter: 0, environment: String(args.p_environment), revoked: false });
        return { status: "registered", environment: args.p_environment };
      }
      case "attest_key_info": {
        const k = keys.get(String(args.p_key_id));
        return k ? { ...k } : null;
      }
      case "contribute_research_attested": {
        if (!consume(args.p_challenge, "assert")) return { status: "rejected", reason: "bad_challenge" };
        const k = keys.get(String(args.p_key_id));
        if (!k) return { status: "rejected", reason: "unknown_key" };
        if (k.revoked) return { status: "rejected", reason: "revoked_key" };
        if (!(Number(args.p_counter) > k.counter)) return { status: "rejected", reason: "replay" };
        k.counter = Number(args.p_counter);
        contributions.push({ payload: args.payload, key_id: String(args.p_key_id) });
        return { status: "accepted", unitid: "199193", research: "pending", programs_published: 0 };
      }
      default:
        throw new Error(`unknown rpc ${fn}`);
    }
  };
  return { rpc, calls, keys, contributions, settings, override: (fn, v) => overrides.set(fn, v) };
}
