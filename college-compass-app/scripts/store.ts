/**
 * localStorage for the Node harnesses (scripts/real-run.ts, scripts/review-compare.ts).
 *
 * The sign-in token store is a JSON file (CC_STORE, default ./cc-real-run.json, mode 0600, git-ignored),
 * so `npm run real-run -- login` / `exchange` signs in once and both harnesses reuse — and refresh,
 * through the app's own src/ai/auth.ts — the same tokens. Nothing here ever prints a token.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const STORE = process.env.CC_STORE ?? "./cc-real-run.json";

/** localStorage backed by a JSON file, so tokens and results survive between commands. */
export class FileStorage {
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

/** In-memory localStorage (dry runs: no token file is read or written). */
export class MemoryStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

/** Install as globalThis.localStorage — before importing any src/ module. */
export function installStorage(s: FileStorage | MemoryStorage): void {
  Object.defineProperty(globalThis, "localStorage", { value: s, configurable: true });
}
