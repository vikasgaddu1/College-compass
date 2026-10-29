// @vitest-environment jsdom
/** Text + link sharing ("Invite your counselor"): share sheet → clipboard → mailto, never an error. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { shareText, shareTextBody } from "./index";

const setNav = (key: "share" | "clipboard", value: unknown) => Object.defineProperty(navigator, key, { value, configurable: true });

afterEach(() => {
  setNav("share", undefined);
  setNav("clipboard", undefined);
  vi.restoreAllMocks();
});

describe("shareText", () => {
  it("uses navigator.share with title, text and url", async () => {
    const share = vi.fn(async () => {});
    setNav("share", share);
    expect(await shareText({ title: "T", text: "Hello", url: "https://x.test/#/?invited=1" })).toBe("shared");
    expect(share).toHaveBeenCalledWith({ title: "T", text: "Hello", url: "https://x.test/#/?invited=1" });
    // Optional fields are left out rather than sent as undefined.
    await shareText({ text: "Just text" });
    expect(share).toHaveBeenLastCalledWith({ text: "Just text" });
  });

  it("a dismissed share sheet (AbortError) is 'cancelled' and nothing is copied", async () => {
    setNav("share", vi.fn(async () => { throw new DOMException("cancel", "AbortError"); }));
    const writeText = vi.fn(async () => {});
    setNav("clipboard", { writeText });
    expect(await shareText({ text: "Hello", url: "https://x.test/" })).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("any other share failure falls back to the clipboard", async () => {
    setNav("share", vi.fn(async () => { throw new DOMException("busy", "NotAllowedError"); }));
    const writeText = vi.fn(async () => {});
    setNav("clipboard", { writeText });
    expect(await shareText({ text: "Hello", url: "https://x.test/" })).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("Hello\nhttps://x.test/");
  });

  it("without navigator.share: copies text + link on its own line", async () => {
    const writeText = vi.fn(async () => {});
    setNav("clipboard", { writeText });
    expect(await shareText({ text: "Hello", url: "https://x.test/" })).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("Hello\nhttps://x.test/");
    expect(shareTextBody("Hello")).toBe("Hello");
  });

  it("without a clipboard either: opens a mailto: draft with subject and body", async () => {
    setNav("clipboard", { writeText: vi.fn(async () => { throw new Error("denied"); }) });
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { value: { ...original, assign }, configurable: true, writable: true });
    try {
      expect(await shareText({ title: "Get listed", text: "Hello", url: "https://x.test/?a=1" })).toBe("mailto");
      expect(assign).toHaveBeenCalledWith(`mailto:?subject=Get%20listed&body=${encodeURIComponent("Hello\nhttps://x.test/?a=1")}`);
    } finally {
      Object.defineProperty(window, "location", { value: original, configurable: true, writable: true });
    }
  });
});
