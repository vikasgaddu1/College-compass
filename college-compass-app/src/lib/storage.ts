/** Tiny typed localStorage helpers. Every key lives under the `cc2:` namespace; every call is try/catch-safe. */

export const NS = "cc2:";

function store(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = store()?.getItem(NS + key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Returns true if the value was persisted. */
export function save<T>(key: string, value: T): boolean {
  try {
    const s = store();
    if (!s) return false;
    s.setItem(NS + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function remove(key: string): void {
  try {
    store()?.removeItem(NS + key);
  } catch {
    /* ignore */
  }
}

/** True when the key is stored (even if its value is `null`). */
export function has(key: string): boolean {
  try {
    return store()?.getItem(NS + key) != null;
  } catch {
    return false;
  }
}

/** Stored keys (without the `cc2:` prefix) that start with `prefix`. */
export function keysWithPrefix(prefix: string): string[] {
  try {
    const s = store();
    if (!s) return [];
    return nsKeys(s)
      .map((k) => k.slice(NS.length))
      .filter((k) => k.startsWith(prefix));
  } catch {
    return [];
  }
}

function nsKeys(s: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k && k.startsWith(NS)) keys.push(k);
  }
  return keys;
}

/** Serialize every `cc2:` entry (keys without the prefix) to a JSON string. */
/** Keys that hold credentials and must never leave the device in an export file. */
/** `host_id` / `issued_client_id` are device-bound sign-in registrations: copying them to another device would be wrong. */
// Excluded from export/import. install_id: a copied install ID would make two devices look like one
// "independent" contributor to shared research.
const SECRET_KEYS = new Set(["chatgpt", "oauth_pending", "dev_openai_key", "ai_session", "host_id", "issued_client_id", "install_id"]);

export function exportAll(): string {
  const out: Record<string, unknown> = {};
  try {
    const s = store();
    if (s) {
      for (const k of nsKeys(s)) {
        if (SECRET_KEYS.has(k.slice(NS.length))) continue;
        const raw = s.getItem(k);
        if (raw == null) continue;
        try {
          out[k.slice(NS.length)] = JSON.parse(raw);
        } catch {
          out[k.slice(NS.length)] = raw;
        }
      }
    }
  } catch {
    /* ignore */
  }
  return JSON.stringify({ app: "college-compass", version: 1, exported_at: new Date().toISOString(), data: out }, null, 2);
}

/** Import a string produced by exportAll(). Returns the number of keys written (0 on invalid input). */
export function importAll(json: string): number {
  try {
    const parsed = JSON.parse(json) as { app?: string; data?: Record<string, unknown> };
    if (!parsed || typeof parsed !== "object" || parsed.app !== "college-compass" || !parsed.data || typeof parsed.data !== "object") {
      return 0;
    }
    let n = 0;
    for (const [k, v] of Object.entries(parsed.data)) {
      if (SECRET_KEYS.has(k)) continue;
      if (save(k, v)) n++;
    }
    return n;
  } catch {
    return 0;
  }
}

/** Remove every `cc2:` entry. */
export function clearAll(): void {
  try {
    const s = store();
    if (!s) return;
    for (const k of nsKeys(s)) s.removeItem(k);
  } catch {
    /* ignore */
  }
}
