// @vitest-environment jsdom
/** Admin review rows: busy state, inline confirmation from the RPC result, immediate refresh, founding-date guard, errors. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EMPTY_DRAFT, type AdminRow, type CounselorRow, type PortalApi, type ReviewResult, type Session } from "./api";
import { Portal } from "./Portal";
import { describeOutcome, fmt } from "./screens/Admin";

const base: CounselorRow = { ...EMPTY_DRAFT, id: "c1", user_id: "u1", status: "draft", published: null, has_changes: false, review_note: null, terms_accepted_at: "2026-10-01T00:00:00Z", submitted_at: "2026-10-01T00:00:00Z", approved_at: null, subscription_status: "none", plan: null, founding_until: null, current_period_end: null, cancel_at_period_end: false, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
const complete: CounselorRow = { ...base, name: "Jane Doe", title: "Counselor", bio: "I help.", states: ["NC"], specialties: ["stem"], modes: ["virtual"], website: "https://jane.com/", email: "jane@example.com" };
const admin = (p: Partial<AdminRow>): AdminRow => ({ ...complete, account_email: "jane@example.com", awaiting_review: false, listed: false, report_count: 0, recent_report_count: 0, ...p });
const user: Session = { userId: "u1", email: "owner@example.com" };
const pub = { ...EMPTY_DRAFT, name: "Live Lee", bio: "I help.", states: ["NC"], specialties: ["stem"], modes: ["virtual"], website: "https://jane.com/", email: "jane@example.com" };

/**
 * Fake PortalApi whose admin_review_counselor behaves like the database: it updates the row the list returns and
 * answers with the saved status / listed / founding_until, so the screen's message comes from "server truth".
 */
function fakeAdminApi(initial: AdminRow[]) {
  let rows = initial.map((r) => ({ ...r }));
  const result = (r: AdminRow): ReviewResult => ({ ok: true, id: r.id, status: r.status, listed: r.listed, has_changes: r.has_changes, plan: r.plan, founding_until: r.founding_until, updated_at: "2026-10-02T00:00:00Z" });
  const api = {
    session: vi.fn(async () => user),
    onAuthChange: vi.fn(() => () => {}),
    signIn: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    myCounselor: vi.fn(async () => null),
    saveDraft: vi.fn(async () => complete),
    acceptTerms: vi.fn(async () => {}),
    submitForReview: vi.fn(async () => {}),
    uploadPhoto: vi.fn(async () => ""),
    checkout: vi.fn(async () => ""),
    billingPortal: vi.fn(async () => ""),
    isAdmin: vi.fn(async () => true),
    adminCounselors: vi.fn(async () => rows.map((r) => ({ ...r }))),
    adminReports: vi.fn(async () => []),
    adminReview: vi.fn(async (id: string, decision: string, note: string | null, foundingUntil: string | null): Promise<ReviewResult | null> => {
      const r = rows.find((x) => x.id === id)!;
      if (decision === "approve") Object.assign(r, { status: "approved", published: { ...EMPTY_DRAFT, ...r }, awaiting_review: false, has_changes: false, approved_at: "2026-10-02T00:00:00Z", review_note: note });
      if (decision === "reject") Object.assign(r, r.status === "approved" ? { submitted_at: null, awaiting_review: false, review_note: note } : { status: "rejected", review_note: note });
      if (decision === "suspend") r.status = "suspended";
      if (decision === "unsuspend") r.status = r.published ? "approved" : "draft";
      if (foundingUntil) Object.assign(r, { founding_until: foundingUntil, plan: r.subscription_status === "none" ? "founding" : r.plan });
      const foundingLive = !!r.founding_until && new Date(r.founding_until + "T23:59:59") >= new Date();
      r.listed = r.status === "approved" && !!r.published && (foundingLive || r.subscription_status === "active");
      r.updated_at = "2026-10-02T00:00:00Z";
      return result(r);
    }),
  };
  return api as unknown as PortalApi & typeof api;
}

/** The row's action buttons (Approve / Reject / Suspend / Set founding date), whatever they currently say. */
const buttons = (scope: ReturnType<typeof within>) => {
  const all = scope.getAllByRole("button").filter((b: HTMLElement) => b.className.includes("cc-btn")) as HTMLButtonElement[];
  expect(all).toHaveLength(4);
  return all;
};

beforeEach(() => {
  window.location.hash = "#/admin";
  window.scrollTo = vi.fn() as any;
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => cleanup());

describe("Admin row feedback", () => {
  it("Set founding date: busy label + every action disabled while saving, then a specific confirmation and the row flips to listed", async () => {
    const api = fakeAdminApi([admin({ id: "l1", name: "Live Lee", status: "approved", published: pub })]);
    let finish!: (v: ReviewResult | null) => void;
    const impl = api.adminReview.getMockImplementation()!;
    api.adminReview.mockImplementationOnce((...a: Parameters<typeof impl>) => new Promise<ReviewResult | null>((res) => (finish = (v) => res(v ?? impl(...a)))));
    render(<Portal api={api} />);
    fireEvent.click(await screen.findByRole("tab", { name: /Live/ }));
    const lee = within(await screen.findByRole("article", { name: "Live Lee" }));
    expect(lee.getByText(/approved · not listed · none/)).toBeTruthy();

    const setBtn = () => lee.getByRole("button", { name: /Set founding date|Saving…/ }) as HTMLButtonElement;
    expect(setBtn().disabled).toBe(true); // nothing to save yet
    fireEvent.change(lee.getByLabelText("Founding listing until for Live Lee"), { target: { value: "2027-06-30" } });
    expect(setBtn().disabled).toBe(false);
    fireEvent.click(setBtn());

    // In flight: the tapped button says so and nothing else on the row can be tapped.
    await waitFor(() => expect(lee.getByRole("button", { name: "Saving…" }).getAttribute("aria-busy")).toBe("true"));
    for (const b of buttons(lee)) expect(b.disabled).toBe(true);
    expect(api.adminReview).toHaveBeenCalledWith("l1", "founding", null, "2027-06-30", "2026-10-01T00:00:00Z");
    expect(lee.queryByRole("status")).toBeNull();

    finish(null);
    const status = await lee.findByRole("status");
    expect(status.textContent).toBe("Founding listing set until Jun 30, 2027 — now listed in the app.");
    // The row shows the saved values straight away.
    expect(lee.getByText(/approved · listed · none \(founding\) · founding until Jun 30, 2027/)).toBeTruthy();
    expect((lee.getByLabelText("Founding listing until for Live Lee") as HTMLInputElement).value).toBe("2027-06-30");
    expect(setBtn().textContent).toBe("Set founding date");
    expect(setBtn().disabled).toBe(true); // same date as saved → nothing to do
    expect(lee.getByText("Saved — the free listing runs until Jun 30, 2027. Pick a different date to change it.")).toBeTruthy();
    expect((lee.getByRole("button", { name: "Approve changes" }) as HTMLButtonElement).disabled).toBe(false);
    // The confirmation stays until the next action on the row.
    await new Promise((r) => setTimeout(r, 50));
    expect(lee.getByRole("status").textContent).toContain("Founding listing set until");
  });

  it("Set founding date is disabled whenever the date equals the saved one, and the hint says why", async () => {
    const api = fakeAdminApi([admin({ id: "l1", name: "Live Lee", status: "approved", published: pub, founding_until: "2027-03-01", plan: "founding" })]);
    render(<Portal api={api} />);
    fireEvent.click(await screen.findByRole("tab", { name: /Live/ }));
    const lee = within(await screen.findByRole("article", { name: "Live Lee" }));
    const input = () => lee.getByLabelText("Founding listing until for Live Lee") as HTMLInputElement;
    const setBtn = () => lee.getByRole("button", { name: "Set founding date" }) as HTMLButtonElement;
    expect(input().value).toBe("2027-03-01");
    expect(setBtn().disabled).toBe(true);
    expect(lee.getByText(/Saved — the free listing runs until Mar 1, 2027/)).toBeTruthy();
    fireEvent.change(input(), { target: { value: "2027-09-01" } });
    expect(setBtn().disabled).toBe(false);
    expect(lee.getByText(/Replaces the saved date \(Mar 1, 2027\)/)).toBeTruthy();
    fireEvent.change(input(), { target: { value: "2027-03-01" } });
    expect(setBtn().disabled).toBe(true);
    fireEvent.change(input(), { target: { value: "" } });
    expect(setBtn().disabled).toBe(true);
    expect(api.adminReview).not.toHaveBeenCalled();
  });

  it("Approve without a founding date says the counselor is not listed yet, follows the row to the Live queue, and Reject confirms", async () => {
    const api = fakeAdminApi([admin({ id: "p1", name: "Pending Pat", status: "pending", awaiting_review: true }), admin({ id: "p2", name: "Pending Pam", status: "pending", awaiting_review: true })]);
    render(<Portal api={api} />);
    const pat = within(await screen.findByRole("article", { name: "Pending Pat" }));
    fireEvent.click(pat.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(api.adminReview).toHaveBeenCalledWith("p1", "approve", null, null, "2026-10-01T00:00:00Z"));
    // The row left the Pending queue, so the result is shown above the list instead of vanishing.
    const notice = await screen.findByRole("status");
    expect(notice.textContent).toBe("Pending Pat: Approved — not listed yet: set a founding date or the counselor subscribes. Now under “Live”. Show");
    expect(screen.queryByRole("article", { name: "Pending Pat" })).toBeNull();
    fireEvent.click(within(notice).getByRole("button", { name: "Show" }));
    const live = within(await screen.findByRole("article", { name: "Pending Pat" }));
    expect(live.getByRole("status").textContent).toBe("Approved — not listed yet: set a founding date or the counselor subscribes.");
    expect(live.getByText(/approved · not listed · none · submitted/)).toBeTruthy();
    expect(screen.getAllByRole("status")).toHaveLength(1); // only on the row now

    // Rejecting (with the required note) confirms inline; the row stays until the list is left.
    fireEvent.click(screen.getByRole("tab", { name: /Pending/ }));
    const pam = within(await screen.findByRole("article", { name: "Pending Pam" }));
    fireEvent.change(pam.getByLabelText("Note for Pending Pam"), { target: { value: "Add credentials." } });
    fireEvent.click(pam.getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(api.adminReview).toHaveBeenCalledWith("p2", "reject", "Add credentials.", null, "2026-10-01T00:00:00Z"));
    expect((await screen.findByRole("status")).textContent).toContain("Pending Pam: Rejected — the counselor will see your note. Now under “Rejected · Suspended”.");
  });

  it("errors stay inline and specific; a stale row says to reload and offers a refresh; nothing is marked done", async () => {
    const api = fakeAdminApi([admin({ id: "l1", name: "Live Lee", status: "approved", published: pub })]);
    api.adminReview.mockRejectedValueOnce({ message: "changed_since_viewed", hint: "The profile changed after you opened it; reload and review again." });
    render(<Portal api={api} />);
    fireEvent.click(await screen.findByRole("tab", { name: /Live/ }));
    const lee = within(await screen.findByRole("article", { name: "Live Lee" }));
    fireEvent.change(lee.getByLabelText("Founding listing until for Live Lee"), { target: { value: "2027-06-30" } });
    fireEvent.click(lee.getByRole("button", { name: "Set founding date" }));
    const alert = await lee.findByRole("alert");
    expect(alert.textContent).toContain("This profile changed after you opened it. Reload and review again.");
    expect(lee.queryByRole("status")).toBeNull();
    for (const b of buttons(lee)) expect(b.disabled).toBe(false); // re-enabled after the failure (Approve changes label)
    expect(api.adminCounselors).toHaveBeenCalledTimes(1);
    fireEvent.click(within(alert).getByRole("button", { name: "Refresh now" }));
    await waitFor(() => expect(api.adminCounselors).toHaveBeenCalledTimes(2));

    // A plain failure: the message, no refresh link, and the date the owner typed is kept.
    api.adminReview.mockRejectedValueOnce(new Error("Failed to fetch"));
    fireEvent.click(lee.getByRole("button", { name: "Set founding date" }));
    expect((await lee.findByRole("alert")).textContent).toBe("Couldn't reach the server. Check your connection and try again.");
    expect((lee.getByLabelText("Founding listing until for Live Lee") as HTMLInputElement).value).toBe("2027-06-30");
  });
});

describe("describeOutcome", () => {
  const row = admin({ id: "x", status: "pending" });
  const t = (p: Partial<ReviewResult>) => ({ status: "approved" as const, listed: false, founding_until: null, ...p });
  it("spells out each decision from the saved state", () => {
    expect(describeOutcome("approve", row, t({ listed: true, founding_until: "2027-06-30" }), "2027-06-30")).toBe("Approved — now listed in the app. Founding listing until Jun 30, 2027.");
    expect(describeOutcome("approve", { ...row, status: "approved" }, t({ listed: true }), null)).toBe("Changes approved — now listed in the app.");
    expect(describeOutcome("founding", row, t({ status: "pending", founding_until: "2027-06-30" }), "2027-06-30")).toBe("Founding listing set until Jun 30, 2027 — not listed yet: approve the listing to publish it.");
    expect(describeOutcome("founding", row, t({ founding_until: "2020-01-01" }), "2020-01-01")).toBe("Founding listing set until Jan 1, 2020 — not listed: Jan 1, 2020 has passed — pick a future date, or the counselor subscribes.");
    expect(describeOutcome("reject", { ...row, status: "approved" }, t({ listed: true }), null)).toBe("Changes declined — the published listing stays as it was.");
    expect(describeOutcome("suspend", row, t({ status: "suspended" }), null)).toBe("Suspended — hidden from the app.");
    expect(describeOutcome("unsuspend", row, t({ status: "approved" }), null)).toBe("Unsuspended — not listed yet: set a founding date or the counselor subscribes.");
    expect(describeOutcome("unsuspend", row, t({ status: "draft" }), null)).toBe("Unsuspended — back to draft; the counselor can finish the profile and resubmit.");
    expect(describeOutcome("founding", row, null, "2027-06-30")).toBe("Founding date saved. Refresh to see the listing state.");
  });
  it("fmt reads a date-only value as a calendar day", () => {
    expect(fmt("2027-06-30")).toBe("Jun 30, 2027");
    expect(fmt(null)).toBe("—");
  });
});
