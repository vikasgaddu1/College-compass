import { describe, expect, it, vi } from "vitest";
import { createDirectoryApi, initials, sanitizeEmail, sanitizePhone, sanitizePhotoUrl, sanitizeWebsite, specialtiesForMajors, telHref, toCounselor } from "./counselors";

describe("sanitizers", () => {
  it("keeps http(s) websites, adds https to bare hosts and drops everything else", () => {
    expect(sanitizeWebsite("https://example.com/path?x=1")).toBe("https://example.com/path?x=1");
    expect(sanitizeWebsite("http://example.com")).toBe("http://example.com/");
    expect(sanitizeWebsite("example.com")).toBe("https://example.com/");
    expect(sanitizeWebsite("www.counsel.org/about")).toBe("https://www.counsel.org/about");
    expect(sanitizeWebsite("javascript:alert(1)")).toBeNull();
    expect(sanitizeWebsite("data:text/html,hi")).toBeNull();
    expect(sanitizeWebsite("file:///etc/passwd")).toBeNull();
    expect(sanitizeWebsite("ftp://example.com")).toBeNull();
    expect(sanitizeWebsite("not a url")).toBeNull();
    expect(sanitizeWebsite("")).toBeNull();
    expect(sanitizeWebsite(42)).toBeNull();
    // credentials in the URL are stripped
    expect(sanitizeWebsite("https://user:pw@example.com/")).toBe("https://example.com/");
  });

  it("phones: digits and punctuation only, 7–15 digits; tel: href keeps + and digits", () => {
    expect(sanitizePhone("(919) 555-0100")).toBe("(919) 555-0100");
    expect(sanitizePhone("+1 919 555 0100")).toBe("+1 919 555 0100");
    expect(sanitizePhone("call me")).toBeNull();
    expect(sanitizePhone("12345")).toBeNull();
    expect(sanitizePhone("919-555-0100; rm -rf")).toBeNull();
    expect(telHref("+1 (919) 555-0100")).toBe("tel:+19195550100");
    expect(telHref("919.555.0100")).toBe("tel:9195550100");
  });

  it("emails and photo urls", () => {
    expect(sanitizeEmail("jane@example.com")).toBe("jane@example.com");
    expect(sanitizeEmail("jane@example")).toBeNull();
    expect(sanitizeEmail("jane@exam ple.com")).toBeNull();
    expect(sanitizeEmail("mailto:jane@example.com?subject=x")).toBeNull();
    expect(sanitizePhotoUrl("https://cdn.example.com/a.jpg")).toBe("https://cdn.example.com/a.jpg");
    expect(sanitizePhotoUrl("http://cdn.example.com/a.jpg")).toBeNull();
    expect(sanitizePhotoUrl("javascript:void(0)")).toBeNull();
  });

  it("toCounselor drops rows without id/name and filters enum arrays", () => {
    expect(toCounselor(null)).toBeNull();
    expect(toCounselor({ id: "x" })).toBeNull();
    const c = toCounselor({ id: "1", name: "  Jane Doe ", title: "Counselor", states: ["NC", "us", "US", "Virginia"], specialties: ["stem", "bogus", "stem"], modes: ["virtual", "phone"], website: "javascript:x", bio: "a\u0000b" })!;
    expect(c.name).toBe("Jane Doe");
    expect(c.states).toEqual(["NC", "US"]);
    expect(c.specialties).toEqual(["stem"]);
    expect(c.modes).toEqual(["virtual"]);
    expect(c.website).toBeNull();
    expect(c.bio).toBe("a b");
  });

  it("initials and specialty preselection", () => {
    expect(initials("Jane Q. Public")).toBe("JP");
    expect(initials("Cher")).toBe("CH");
    expect(initials("  ")).toBe("?");
    expect(specialtiesForMajors(["computer_science", "film_media"]).sort()).toEqual(["arts", "stem"]);
    expect(specialtiesForMajors(["robotics_mechatronics"]).sort()).toEqual(["engineering", "stem"]);
    expect(specialtiesForMajors(["business"])).toEqual([]);
  });
});

describe("createDirectoryApi", () => {
  const cfg = { url: "https://x.supabase.co", key: "pk" };
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

  it("is null without config (shared data off)", () => {
    expect(createDirectoryApi(null)).toBeNull();
  });

  it("posts the filters to counselor_directory with the publishable key and sanitizes rows", async () => {
    const f = vi.fn(async () => ok([{ id: "1", name: "Jane", website: "example.com" }, { name: "no id" }]));
    const api = createDirectoryApi(cfg, f as unknown as typeof fetch)!;
    const rows = await api.list("NC", ["stem"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.website).toBe("https://example.com/");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.supabase.co/rest/v1/rpc/counselor_directory");
    expect(JSON.parse(init.body as string)).toEqual({ p_state: "NC", p_specialties: ["stem"] });
    expect((init.headers as Record<string, string>).apikey).toBe("pk");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer pk");
  });

  it("sends null filters for 'anywhere' and 'all specialties'", async () => {
    const f = vi.fn(async () => ok([]));
    const api = createDirectoryApi(cfg, f as unknown as typeof fetch)!;
    await api.list(null, []);
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ p_state: null, p_specialties: null });
  });

  it("maps network failure to 'offline' and non-2xx to 'unavailable'", async () => {
    const down = createDirectoryApi(cfg, vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch)!;
    await expect(down.list("NC", [])).rejects.toBe("offline");
    const broken = createDirectoryApi(cfg, vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch)!;
    await expect(broken.list("NC", [])).rejects.toBe("unavailable");
  });

  it("report_counselor gets the reason and a trimmed optional detail", async () => {
    const f = vi.fn(async () => ok({ ok: true }));
    const api = createDirectoryApi(cfg, f as unknown as typeof fetch)!;
    await api.report("abc", "misleading", "  claims 100% admits  ");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.supabase.co/rest/v1/rpc/report_counselor");
    expect(JSON.parse(init.body as string)).toEqual({ p_counselor: "abc", p_reason: "misleading", p_detail: "claims 100% admits" });
    await api.report("abc", "other", "   ");
    expect(JSON.parse((f.mock.calls[1] as unknown as [string, RequestInit])[1].body as string).p_detail).toBeNull();
  });

  it("report rejects when the database didn't store it (200 with ok:false)", async () => {
    const answer = (body: unknown) => createDirectoryApi(cfg, (async () => ok(body)) as unknown as typeof fetch)!;
    await expect(answer({ ok: false, reason: "rate_limited" }).report("abc", "other", null)).rejects.toBe("rate_limited");
    await expect(answer({ ok: false, reason: "unknown_counselor" }).report("abc", "other", null)).rejects.toBe("gone");
    await expect(answer({ ok: false, reason: "bad_reason" }).report("abc", "other", null)).rejects.toBe("unavailable");
    await expect(answer(null).report("abc", "other", null)).rejects.toBe("unavailable");
  });
});
