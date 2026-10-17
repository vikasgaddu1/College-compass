// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { KeepTabOpenNote, LeaveAppCard, PhaseSteps } from "./ResearchStatus";

afterEach(() => cleanup());

describe("PhaseSteps", () => {
  it("asks the student to stay during the planner and shows the elapsed clock", () => {
    render(<PhaseSteps phase="planning" total={0} done={0} failed={0} elapsedMs={12_000} />);
    expect(screen.getByText("Picking colleges for you")).toBeTruthy();
    expect(screen.getByText(/About 30 seconds — please stay on this screen for this part/)).toBeTruthy();
    expect(screen.getByText("0:12")).toBeTruthy();
    expect(screen.getByText("about 30 seconds for this step")).toBeTruthy();
  });

  it("shows colleges done / total and a rough time left while agents work", () => {
    render(<PhaseSteps phase="researching" total={12} done={3} failed={1} elapsedMs={90_000} />);
    expect(screen.getByText("12 colleges picked")).toBeTruthy();
    expect(screen.getByText("3 of 12 done, 1 failed")).toBeTruthy();
    expect(screen.getByText("about 2 min left")).toBeTruthy();
  });

  it("never shows a negative estimate", () => {
    render(<PhaseSteps phase="researching" total={12} done={11} failed={0} elapsedMs={9 * 60_000} />);
    expect(screen.getByText("almost done…")).toBeTruthy();
    expect(screen.queryByText(/-\d/)).toBeNull();
  });

  it("hides the clock once finished", () => {
    render(<PhaseSteps phase="done" total={12} done={12} failed={0} elapsedMs={222_000} />);
    expect(screen.getByText("Finished in 3:42")).toBeTruthy();
    expect(screen.queryByText(/elapsed/)).toBeNull();
  });
});

describe("LeaveAppCard", () => {
  it("offers a notification and arms on tap", () => {
    const onArm = vi.fn();
    render(<LeaveAppCard state="idle" onArm={onArm} />);
    expect(screen.getByText("You don't have to wait here")).toBeTruthy();
    expect(screen.getByText(/Leave the app and we'll send a notification when your list is ready/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Notify me when it's ready/ }));
    expect(onArm).toHaveBeenCalledTimes(1);
  });

  it("confirms once armed and drops the button", () => {
    render(<LeaveAppCard state="armed" onArm={() => {}} />);
    expect(screen.getByText("We'll notify you — you can close the app")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("explains what to do when notifications were declined", () => {
    render(<LeaveAppCard state="declined" onArm={() => {}} />);
    expect(screen.getByText(/keep the app open while we finish/)).toBeTruthy();
    expect(screen.getByText(/iOS Settings/)).toBeTruthy();
    // iOS won't ask twice once declined, so no dead button.
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("KeepTabOpenNote", () => {
  it("tells web users to keep the tab open", () => {
    render(<KeepTabOpenNote />);
    expect(screen.getByText(/research takes a few minutes/)).toBeTruthy();
  });
});
