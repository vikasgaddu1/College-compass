import { describe, expect, it } from "vitest";
import { EMPTY_DRAFT, describeError, type Draft } from "./api";
import { diffFields, draftDiffers, missingForSubmit, normalizeDraft, validateDraft } from "./validate";
import { bucket } from "./screens/Admin";
import { parsePortalRoute } from "./router";
import { squareCrop, checkPhotoFile } from "./image";
import { isListed } from "./screens/Profile";
import { subscriptionSummary } from "./screens/Billing";
import type { AdminRow, CounselorRow } from "./api";

const full: Draft = { ...EMPTY_DRAFT, name: " Jane Doe ", bio: "Hi", states: ["nc", "NC", "va"], specialties: ["stem"], modes: ["virtual"], website: "jane.com", email: "Jane@Example.com ", phone: "(919) 555-0100" };

describe("normalizeDraft / validateDraft", () => {
  it("trims, upper-cases states, de-duplicates, lower-cases email and adds https to the website", () => {
    const d = normalizeDraft(full);
    expect(d.name).toBe("Jane Doe");
    expect(d.states).toEqual(["NC", "VA"]);
    expect(d.email).toBe("jane@example.com");
    expect(d.website).toBe("https://jane.com/");
    expect(d.title).toBeNull();
  });
  it("flags bad formats and long fields", () => {
    const e = validateDraft(normalizeDraft({ ...full, website: "javascript:alert(1)", phone: "call me", email: "nope", bio: "x".repeat(1201) }));
    expect(e.website).toMatch(/full web address/);
    expect(e.phone).toBeTruthy();
    expect(e.email).toBeTruthy();
    expect(e.bio).toMatch(/1200/);
    expect(validateDraft(normalizeDraft(full))).toEqual({});
  });
  it("lists what's missing for submission", () => {
    expect(missingForSubmit(normalizeDraft(full))).toEqual([]);
    const m = missingForSubmit({ ...EMPTY_DRAFT });
    expect(m).toContain("your name");
    expect(m).toContain("a way to contact you (website, phone or email)");
    expect(missingForSubmit({ ...EMPTY_DRAFT, name: "a", bio: "b", states: ["US"], specialties: ["general"], modes: ["virtual"], phone: "9195550100" })).toEqual([]);
  });
  it("draft vs published diff ignores order and spacing", () => {
    const pub = normalizeDraft(full);
    expect(draftDiffers({ ...full, states: ["VA", "nc"] }, pub)).toBe(false);
    expect(draftDiffers({ ...full, bio: "New bio" }, pub)).toBe(true);
    expect(diffFields({ ...full, bio: "New bio", title: "Coach" }, pub).sort()).toEqual(["bio", "title"]);
    expect(diffFields(full, null)).toEqual([]);
  });
});

describe("describeError", () => {
  it("maps backend codes to friendly text", () => {
    expect(describeError({ message: "incomplete_profile", hint: "Missing: bio, states" })).toBe("Your profile is missing something — bio, states.");
    expect(describeError({ message: "terms_not_accepted" })).toMatch(/accept the counselor terms/);
    expect(describeError({ message: "TypeError: Failed to fetch" })).toMatch(/connection/);
    expect(describeError("plain")).toBe("plain");
    expect(describeError(null)).toBe("Something went wrong.");
  });
});

describe("router / image / status helpers", () => {
  it("parses portal routes with a fallback to the landing page", () => {
    expect(parsePortalRoute("#/billing?checkout=success")).toEqual({ path: "/billing", query: { checkout: "success" } });
    expect(parsePortalRoute("#/nope").path).toBe("/");
    expect(parsePortalRoute("").path).toBe("/");
    expect(parsePortalRoute("#/signin").path).toBe("/signin");
  });
  it("square crop is centered", () => {
    expect(squareCrop(1000, 600)).toEqual({ x: 200, y: 0, size: 600 });
    expect(squareCrop(600, 1000)).toEqual({ x: 0, y: 200, size: 600 });
  });
  it("rejects non-image files", () => {
    expect(checkPhotoFile(new File(["x"], "a.pdf", { type: "application/pdf" }))).toMatch(/JPEG, PNG or WebP/);
    expect(checkPhotoFile(new File(["x"], "a.jpg", { type: "image/jpeg" }))).toBeNull();
  });
  const base: CounselorRow = { ...EMPTY_DRAFT, id: "1", user_id: "u", status: "approved", published: { ...EMPTY_DRAFT, name: "J", states: ["NC"] }, has_changes: false, review_note: null, terms_accepted_at: "2026-10-01T00:00:00Z", submitted_at: null, approved_at: "2026-10-02T00:00:00Z", subscription_status: "none", plan: null, founding_until: null, current_period_end: null, cancel_at_period_end: false, created_at: "", updated_at: "" };
  it("isListed follows the contract rule", () => {
    const today = new Date("2026-10-21T12:00:00");
    expect(isListed(base, today)).toBe(false);
    expect(isListed({ ...base, subscription_status: "active" }, today)).toBe(true);
    expect(isListed({ ...base, founding_until: "2026-12-31" }, today)).toBe(true);
    expect(isListed({ ...base, founding_until: "2026-10-20" }, today)).toBe(false);
    expect(isListed({ ...base, subscription_status: "active", status: "suspended" }, today)).toBe(false);
    expect(isListed({ ...base, subscription_status: "active", published: null }, today)).toBe(false);
    // A failed payment keeps the listing up for 7 days, like the directory query.
    expect(isListed({ ...base, subscription_status: "past_due", past_due_since: "2026-10-15T12:00:00" }, today)).toBe(true);
    expect(isListed({ ...base, subscription_status: "past_due", past_due_since: "2026-10-13T12:00:00" }, today)).toBe(false);
    expect(isListed({ ...base, subscription_status: "unpaid" }, today)).toBe(false);
  });
  it("subscriptionSummary explains founding, active, cancelling and no-plan states", () => {
    const today = new Date("2026-10-21T12:00:00");
    expect(subscriptionSummary({ ...base, plan: "founding", founding_until: "2027-03-01" }, today).title).toBe("Founding listing — free");
    expect(subscriptionSummary({ ...base, subscription_status: "active", plan: "yearly" }, today).title).toBe("Active · $290/year");
    expect(subscriptionSummary({ ...base, subscription_status: "active", plan: "monthly", cancel_at_period_end: true, current_period_end: "2026-11-15T00:00:00Z" }, today).title).toMatch(/^Cancels/);
    expect(subscriptionSummary({ ...base, subscription_status: "past_due" }, today).tone).toBe("error");
    expect(subscriptionSummary(base, today).title).toBe("No plan yet");
  });
  it("admin buckets", () => {
    const a = (p: Partial<AdminRow>): AdminRow => ({ ...base, account_email: "a@b.co", awaiting_review: false, listed: false, report_count: 0, recent_report_count: 0, ...p });
    expect(bucket(a({ status: "pending" }))).toBe("pending");
    expect(bucket(a({ status: "approved", awaiting_review: true, has_changes: true }))).toBe("changes");
    expect(bucket(a({ status: "approved" }))).toBe("live");
    expect(bucket(a({ status: "rejected" }))).toBe("closed");
    expect(bucket(a({ status: "suspended" }))).toBe("closed");
  });
});
