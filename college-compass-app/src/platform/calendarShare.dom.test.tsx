// @vitest-environment jsdom
/** Web fallback of "Add to Calendar": a Blob download (or the Web Share API when it can take files). */
import { afterEach, describe, expect, it, vi } from "vitest";
import { shareCalendarFile, webDownloadText } from "./index";

afterEach(() => vi.restoreAllMocks());

describe("shareCalendarFile (web)", () => {
  it("downloads the .ics through a hidden anchor when sharing files isn't available", async () => {
    const created: string[] = [];
    (URL as any).createObjectURL = vi.fn((b: Blob) => {
      created.push(b.type);
      return "blob:cc/1";
    });
    (URL as any).revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("College deadlines.ics");
      expect(this.href).toBe("blob:cc/1");
    });
    const res = await shareCalendarFile("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", "College deadlines.ics");
    expect(res).toEqual({ completed: true });
    expect(click).toHaveBeenCalledTimes(1);
    expect(created).toEqual(["text/calendar;charset=utf-8"]);
  });

  it("prefers the Web Share API when it accepts files, and reports a cancelled share", async () => {
    (URL as any).createObjectURL = vi.fn(() => "blob:cc/2");
    (URL as any).revokeObjectURL = vi.fn();
    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    expect(await webDownloadText("x", "a.ics", "text/calendar")).toEqual({ completed: true });
    expect(share).toHaveBeenCalledTimes(1);
    expect(click).not.toHaveBeenCalled();
    share.mockRejectedValueOnce(new DOMException("cancel", "AbortError"));
    expect(await webDownloadText("x", "a.ics", "text/calendar")).toEqual({ completed: false });
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "canShare", { value: undefined, configurable: true });
  });
});
