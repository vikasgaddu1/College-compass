// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AiError } from "@/types";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn<(returnTo?: string) => Promise<void>>(),
  configured: vi.fn(() => true),
  account: vi.fn<() => unknown>(() => null),
  lastError: vi.fn<() => string | null>(() => null),
  listeners: new Set<() => void>(),
  isNative: vi.fn(() => true),
}));

vi.mock("@/state/services", async () => {
  const actual = await vi.importActual<typeof import("@/state/services")>("@/state/services");
  return {
    ...actual,
    auth: {
      signIn: mocks.signIn,
      configured: mocks.configured,
      account: mocks.account,
      lastError: mocks.lastError,
      subscribe(fn: () => void) {
        mocks.listeners.add(fn);
        return () => mocks.listeners.delete(fn);
      },
    },
  };
});
vi.mock("@/platform", async () => {
  const actual = await vi.importActual<typeof import("@/platform")>("@/platform");
  return { ...actual, isNative: () => mocks.isNative() };
});

import { SIGN_IN_COPY, SignInAgain } from "./SignInAgain";

beforeEach(() => {
  mocks.signIn.mockReset();
  mocks.configured.mockReturnValue(true);
  mocks.lastError.mockReturnValue(null);
  mocks.isNative.mockReturnValue(true);
  mocks.listeners.clear();
});
afterEach(() => cleanup());

const button = () => screen.getByRole("button", { name: "Continue with ChatGPT" });

describe("SignInAgain", () => {
  it("renders the session-ended card with the OpenAI button label and calls signIn with returnTo", async () => {
    let resolve!: () => void;
    mocks.signIn.mockReturnValue(new Promise<void>((r) => (resolve = r)));
    render(<SignInAgain returnTo="/research" />);
    expect(screen.getByText(SIGN_IN_COPY.expired.title)).toBeTruthy();
    expect(screen.getByText(SIGN_IN_COPY.expired.line)).toBeTruthy();
    const btn = button();
    expect(btn.textContent).toContain("Continue with ChatGPT");
    fireEvent.click(btn);
    expect(mocks.signIn).toHaveBeenCalledWith("/research");
    // Busy while ChatGPT opens: label swaps and the button can't be tapped twice.
    const busy = await screen.findByRole("button", { name: "Opening ChatGPT…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(busy);
    expect(mocks.signIn).toHaveBeenCalledTimes(1);
    resolve();
    // iPhone: the in-app browser is up; the button rests so a cancelled attempt can be retried.
    await waitFor(() => expect(button()).toBeTruthy());
  });

  it("keeps the button busy on the web, where the page is leaving for ChatGPT", async () => {
    mocks.isNative.mockReturnValue(false);
    mocks.signIn.mockResolvedValue(undefined);
    render(<SignInAgain returnTo="/ask" />);
    fireEvent.click(button());
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledWith("/ask"));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByRole("button", { name: "Opening ChatGPT…" })).toBeTruthy();
  });

  it("shows a friendly error when sign-in fails or is cancelled, and lets them retry", async () => {
    mocks.signIn.mockRejectedValueOnce(new AiError("reauth_required", "Sign-in was cancelled."));
    render(<SignInAgain returnTo="/research" />);
    fireEvent.click(button());
    expect(await screen.findByText("Your ChatGPT session expired.")).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
    const again = button();
    expect((again as HTMLButtonElement).disabled).toBe(false);
    mocks.signIn.mockResolvedValueOnce(undefined);
    fireEvent.click(again);
    expect(mocks.signIn).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByText("Your ChatGPT session expired.")).toBeNull());
  });

  it("picks up a failure reported through the auth listener (iPhone partner flow)", async () => {
    mocks.signIn.mockResolvedValue(undefined);
    render(<SignInAgain returnTo="/research" />);
    fireEvent.click(button());
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalled());
    mocks.lastError.mockReturnValue("ChatGPT sign-in failed (access_denied). Please try again.");
    for (const fn of mocks.listeners) fn();
    expect(await screen.findByText(/access_denied/)).toBeTruthy();
    expect((button() as HTMLButtonElement).disabled).toBe(false);
  });

  it("uses the never-signed-in copy and a custom line", () => {
    render(<SignInAgain returnTo="/ask" reason="signed_out" line="Sign in to ask about your list." />);
    expect(screen.getByText(SIGN_IN_COPY.signed_out.title)).toBeTruthy();
    expect(screen.getByText("Sign in to ask about your list.")).toBeTruthy();
    expect(screen.queryByText(SIGN_IN_COPY.signed_out.line)).toBeNull();
  });

  it("disables the button and explains when this build has no ChatGPT sign-in", () => {
    mocks.configured.mockReturnValue(false);
    render(<SignInAgain returnTo="/research" />);
    expect((button() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/works in the College Compass iPhone app/)).toBeTruthy();
  });
});
