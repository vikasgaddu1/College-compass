// @vitest-environment jsdom
/** Portal screens against a fake PortalApi: landing, sign-in, profile editor + preview, billing, admin. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EMPTY_DRAFT, type AdminRow, type CounselorRow, type PortalApi, type Report, type Session } from "./api";
import { Portal } from "./Portal";

const baseRow: CounselorRow = { ...EMPTY_DRAFT, id: "c1", user_id: "u1", status: "draft", published: null, has_changes: false, review_note: null, terms_accepted_at: null, submitted_at: null, approved_at: null, subscription_status: "none", plan: null, founding_until: null, current_period_end: null, cancel_at_period_end: false, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
const complete: CounselorRow = { ...baseRow, name: "Jane Doe", title: "Counselor", bio: "I help.", states: ["NC"], specialties: ["stem"], modes: ["virtual"], website: "https://jane.com/", email: "jane@example.com" };

function fakeApi(opts: { session?: Session | null; row?: CounselorRow | null; admin?: boolean; rows?: AdminRow[]; reports?: Report[] } = {}) {
  let row = opts.row === undefined ? null : opts.row;
  const api = {
    session: vi.fn(async () => opts.session ?? null),
    onAuthChange: vi.fn(() => () => {}),
    signIn: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    myCounselor: vi.fn(async () => row),
    saveDraft: vi.fn(async (id: string | null, d) => {
      row = { ...(row ?? baseRow), ...d, id: id ?? "new", updated_at: "2026-10-02T00:00:00Z" } as CounselorRow;
      return row;
    }),
    acceptTerms: vi.fn(async () => {
      row = { ...(row ?? baseRow), terms_accepted_at: "2026-10-02T00:00:00Z" };
    }),
    submitForReview: vi.fn(async () => {
      row = { ...(row ?? baseRow), status: "pending", submitted_at: "2026-10-02T00:00:01Z" };
    }),
    uploadPhoto: vi.fn(async () => "https://x.supabase.co/storage/v1/object/public/counselor-photos/u1/p.jpg"),
    checkout: vi.fn(async () => "https://checkout.stripe.com/pay/x"),
    billingPortal: vi.fn(async () => "https://billing.stripe.com/p/x"),
    isAdmin: vi.fn(async () => !!opts.admin),
    adminCounselors: vi.fn(async () => opts.rows ?? []),
    adminReview: vi.fn(async () => {}),
    adminReports: vi.fn(async () => opts.reports ?? []),
  };
  return api as unknown as PortalApi & typeof api;
}

const user: Session = { userId: "u1", email: "jane@example.com" };

beforeEach(() => {
  window.location.hash = "#/";
  window.scrollTo = vi.fn() as any;
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => cleanup());

describe("Landing", () => {
  it("shows the hero, steps, sample card in a phone, founding offer, pricing, trust, FAQ and footer", async () => {
    render(<Portal api={fakeApi()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Be the counselor families find" })).toBeTruthy();
    expect(screen.getByText(/free iPhone app that helps high-school students and parents/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Get your free founding listing" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "See pricing" })).toBeTruthy();
    expect(screen.getByText("Create your profile")).toBeTruthy();
    expect(screen.getByText("We review it")).toBeTruthy();
    expect(screen.getByText("Families find you")).toBeTruthy();
    // The real card component with the sample counselor, inert links.
    const card = within(screen.getByRole("article", { name: "Jordan Avery" }));
    expect(card.getByText("Paid listing")).toBeTruthy();
    expect(card.getByRole("link", { name: "Visit website" }).getAttribute("aria-disabled")).toBe("true");
    expect(card.getByRole("link", { name: "Call" })).toBeTruthy();
    expect(card.getByRole("link", { name: "Email" })).toBeTruthy();
    expect(screen.getByText("Free founding listing for our first 30 counselors")).toBeTruthy();
    expect(screen.getByText(/Free until 3 months after the public App Store launch\. No card needed to start/)).toBeTruthy();
    expect(screen.getByText("$29")).toBeTruthy();
    expect(screen.getByText("$290")).toBeTruthy();
    expect(screen.getByText("Student data stays with the family")).toBeTruthy();
    expect(screen.getByText("Who can list?")).toBeTruthy();
    expect(screen.getByText("What happens if I cancel?")).toBeTruthy();
    expect(screen.getByText(/Gaddu LLC/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "support@collegecompass.app" }).getAttribute("href")).toBe("mailto:support@collegecompass.app");
    expect(screen.getByRole("link", { name: "Counselor terms" }).getAttribute("href")).toBe("#/terms");
    fireEvent.click(screen.getAllByRole("button", { name: "Get your free founding listing" })[0]!);
    await waitFor(() => expect(window.location.hash).toBe("#/signin"));
  });
});

describe("Sign in", () => {
  it("sends a magic link that returns to #/profile", async () => {
    const api = fakeApi();
    window.location.hash = "#/signin";
    render(<Portal api={api} />);
    expect(screen.getByText("Sign in with your email — we'll send a link. No password to remember.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send sign-in link" }));
    expect(await screen.findByText(/Enter the email address/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "Jane@Example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send sign-in link" }));
    await waitFor(() => expect(api.signIn).toHaveBeenCalledWith("Jane@Example.com", expect.stringMatching(/#\/profile$/)));
    expect(await screen.findByText("Check your email")).toBeTruthy();
  });

  it("protected routes show sign-in when signed out; signed-in users skip #/signin", async () => {
    window.location.hash = "#/profile";
    render(<Portal api={fakeApi()} />);
    expect(await screen.findByText(/Sign in to open your profile/)).toBeTruthy();
    cleanup();
    window.location.hash = "#/signin";
    render(<Portal api={fakeApi({ session: user })} />);
    await waitFor(() => expect(window.location.hash).toBe("#/profile"));
  });
});

describe("Profile editor", () => {
  it("new counselor: draft banner, live preview follows typing, save then terms + submit", async () => {
    const api = fakeApi({ session: user });
    window.location.hash = "#/profile";
    render(<Portal api={api} />);
    expect(await screen.findByText(/isn't visible yet/)).toBeTruthy();
    const preview = () => within(screen.getByRole("complementary", { name: "Live preview" }));
    expect(preview().getByRole("article", { name: "Your name" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jane Doe" } });
    expect(preview().getByRole("article", { name: "Jane Doe" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Independent counselor" } });
    fireEvent.change(screen.getByLabelText("Bio"), { target: { value: "I help students." } });
    expect(screen.getByText("16 / 1200")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "North Carolina" }));
    fireEvent.click(screen.getByRole("button", { name: "Nationwide (virtual)" }));
    fireEvent.click(screen.getByRole("button", { name: "STEM" }));
    fireEvent.click(screen.getByRole("button", { name: "Virtual" }));
    fireEvent.change(screen.getByLabelText("Website"), { target: { value: "jane.com" } });
    expect(preview().getByText("Students anywhere (virtual)")).toBeTruthy();
    expect(preview().getByRole("link", { name: "Visit website" }).getAttribute("href")).toBe("https://jane.com/");
    // sign-in email prefilled as contact email
    expect((screen.getByLabelText("Contact email") as HTMLInputElement).value).toBe("jane@example.com");

    // Submit is blocked until saved and terms accepted.
    const submit = () => screen.getByRole("button", { name: "Submit for review" }) as HTMLButtonElement;
    expect(submit().disabled).toBe(true);
    expect(screen.getByText("Save your changes first.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalled());
    const [id, draft] = api.saveDraft.mock.calls[0]!;
    expect(id).toBeNull();
    expect(draft).toMatchObject({ name: "Jane Doe", website: "https://jane.com/", states: ["NC", "US"], specialties: ["stem"], modes: ["virtual"], email: "jane@example.com" });
    expect(await screen.findByText("Saved.")).toBeTruthy();
    expect(submit().disabled).toBe(true); // terms not accepted yet
    fireEvent.click(screen.getByRole("checkbox"));
    expect(submit().disabled).toBe(false);
    fireEvent.click(submit());
    await waitFor(() => expect(api.acceptTerms).toHaveBeenCalled());
    await waitFor(() => expect(api.submitForReview).toHaveBeenCalled());
    expect(await screen.findByText(/under review/)).toBeTruthy();
  });

  it("validation errors block saving", async () => {
    const api = fakeApi({ session: user, row: complete });
    window.location.hash = "#/profile";
    render(<Portal api={api} />);
    await screen.findByText(/Draft — not visible/);
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "call me" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringMatching(/phone number/));
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it("status banners: pending, approved live, approved with changes waiting, rejected with note, suspended", async () => {
    const pub = { ...EMPTY_DRAFT, name: "Jane Doe", states: ["NC"] };
    const cases: [Partial<CounselorRow>, RegExp][] = [
      [{ status: "pending" }, /under review/],
      [{ status: "approved", published: pub, subscription_status: "active", terms_accepted_at: "x" }, /Your listing is live/],
      [{ status: "approved", published: pub, founding_until: "2099-01-01", terms_accepted_at: "x" }, /Your listing is live/],
      [{ status: "approved", published: pub, terms_accepted_at: "x" }, /start a listing plan/],
      [{ status: "approved", published: pub, has_changes: true, submitted_at: "2026-10-05T00:00:00Z", approved_at: "2026-10-02T00:00:00Z", terms_accepted_at: "x" }, /Your changes are waiting for review — your current listing stays live/],
      [{ status: "rejected", review_note: "Please add real credentials." }, /Please add real credentials/],
      [{ status: "suspended", review_note: "Reports" }, /suspended/],
    ];
    for (const [patch, re] of cases) {
      window.location.hash = "#/profile";
      render(<Portal api={fakeApi({ session: user, row: { ...complete, ...patch } })} />);
      expect(await screen.findByText(re)).toBeTruthy();
      cleanup();
    }
  });
});

describe("Billing", () => {
  it("plans → checkout redirect; success/cancel return states; manage billing", async () => {
    const assign = vi.fn();
    const orig = window.location;
    Object.defineProperty(window, "location", { value: { ...orig, assign, hash: "#/billing", pathname: "/x/", origin: "http://h", search: "" }, writable: true });
    const api = fakeApi({ session: user, row: { ...complete, status: "approved" } });
    render(<Portal api={api} />);
    expect(await screen.findByText("No plan yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Choose $290/year" }));
    await waitFor(() => expect(api.checkout).toHaveBeenCalledWith("yearly"));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/pay/x"));
    cleanup();

    window.location.hash = "#/billing?checkout=success";
    render(<Portal api={fakeApi({ session: user, row: { ...complete, status: "approved", subscription_status: "active", plan: "monthly", current_period_end: "2026-11-21T00:00:00Z" } })} />);
    expect(await screen.findByText(/your payment went through/)).toBeTruthy();
    expect(screen.getByText("Active · $29/month")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Choose \$/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Manage billing" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://billing.stripe.com/p/x"));
    cleanup();

    window.location.hash = "#/billing?checkout=cancel";
    render(<Portal api={fakeApi({ session: user, row: { ...complete, plan: "founding", founding_until: "2099-01-01" } })} />);
    expect(await screen.findByText(/Checkout was cancelled/)).toBeTruthy();
    expect(screen.getByText("Founding listing — free")).toBeTruthy();
    expect(screen.getByText(/one of our first 30 counselors/)).toBeTruthy();
    Object.defineProperty(window, "location", { value: orig, writable: true });
  });
});

describe("Admin", () => {
  const admin = (p: Partial<AdminRow>): AdminRow => ({ ...complete, account_email: "jane@example.com", awaiting_review: false, listed: false, report_count: 0, recent_report_count: 0, ...p });
  const rows = [
    admin({ id: "p1", name: "Pending Pat", status: "pending", awaiting_review: true, website: "https://pat.example.com/" }),
    admin({ id: "a1", name: "Approved Al", status: "approved", published: { ...EMPTY_DRAFT, name: "Approved Al", bio: "Old bio", states: ["NC"], specialties: ["stem"], modes: ["virtual"], website: "https://jane.com/", email: "jane@example.com" }, bio: "New bio", has_changes: true, awaiting_review: true, submitted_at: "2026-10-05T00:00:00Z", approved_at: "2026-10-02T00:00:00Z", report_count: 2, recent_report_count: 1 }),
    admin({ id: "l1", name: "Live Lee", status: "approved", published: { ...EMPTY_DRAFT, name: "Live Lee" }, subscription_status: "active", listed: true }),
    admin({ id: "r1", name: "Rejected Rae", status: "rejected" }),
    admin({ id: "s1", name: "Suspended Sam", status: "suspended" }),
  ];
  const reports: Report[] = [{ id: 1, counselor_id: "a1", counselor_name: "Approved Al", counselor_status: "approved", reason: "misleading", detail: "Promises admission", reporter: "ab12cd34", created_at: "2026-10-10T00:00:00Z" }];

  it("non-admins see 'Admin only'; admins get tabs with counts, diff, links and actions", async () => {
    window.location.hash = "#/admin";
    render(<Portal api={fakeApi({ session: user, admin: false })} />);
    expect(await screen.findByText("Admin only")).toBeTruthy();
    cleanup();

    const api = fakeApi({ session: user, admin: true, rows, reports });
    window.location.hash = "#/admin";
    render(<Portal api={api} />);
    const tab = async (name: RegExp) => fireEvent.click(await screen.findByRole("tab", { name }));
    expect(await screen.findByRole("tab", { name: /Pending 1/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Changes waiting 1/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Live 1/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Rejected · Suspended 2/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Reports 1/ })).toBeTruthy();

    const pat = within(await screen.findByRole("article", { name: "Pending Pat" }));
    expect(pat.getByRole("link", { name: "Open website ↗" }).getAttribute("href")).toBe("https://pat.example.com/");
    // Reject needs a note.
    fireEvent.click(pat.getByRole("button", { name: "Reject" }));
    expect(await pat.findByText(/Add a note/)).toBeTruthy();
    expect(api.adminReview).not.toHaveBeenCalled();
    fireEvent.change(pat.getByLabelText("Founding listing until for Pending Pat"), { target: { value: "2027-03-01" } });
    fireEvent.click(pat.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(api.adminReview).toHaveBeenCalledWith("p1", "approve", null, "2027-03-01", complete.updated_at));

    await tab(/Changes waiting/);
    const al = within(await screen.findByRole("article", { name: "Approved Al" }));
    expect(al.getByText("2 reports · 1 recent")).toBeTruthy();
    const bioRow = al.getByText("Bio").closest(".cp-diff-row")!;
    expect(bioRow.getAttribute("data-changed")).toBe("true");
    expect(within(bioRow as HTMLElement).getByText("New bio")).toBeTruthy();
    expect(within(bioRow as HTMLElement).getByText("Old bio")).toBeTruthy();
    expect(al.getByText("Name").closest(".cp-diff-row")!.getAttribute("data-changed")).toBe("false");
    fireEvent.change(al.getByLabelText("Note for Approved Al"), { target: { value: "Tone it down" } });
    fireEvent.click(al.getByRole("button", { name: "Decline changes" }));
    await waitFor(() => expect(api.adminReview).toHaveBeenCalledWith("a1", "reject", "Tone it down", null, complete.updated_at));

    await tab(/Rejected · Suspended/);
    const sam = within(await screen.findByRole("article", { name: "Suspended Sam" }));
    fireEvent.click(sam.getByRole("button", { name: "Unsuspend" }));
    await waitFor(() => expect(api.adminReview).toHaveBeenCalledWith("s1", "unsuspend", null, null, complete.updated_at));
    const rae = within(screen.getByRole("article", { name: "Rejected Rae" }));
    fireEvent.click(rae.getByRole("button", { name: "Suspend" }));
    await waitFor(() => expect(api.adminReview).toHaveBeenCalledWith("r1", "suspend", null, null, complete.updated_at));

    await tab(/Reports/);
    expect(await screen.findByText("Promises admission")).toBeTruthy();
    expect(screen.getByText("Misleading claims or credentials")).toBeTruthy();
  });
});
