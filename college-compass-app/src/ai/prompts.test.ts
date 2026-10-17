import { describe, expect, it } from "vitest";
import {
  chatInstructions, listAdvicePrompt, plannerInput, plannerInstructions, profileBrief, proposeCollegesTool,
  researcherInput, researcherInstructions, submitResearchTool,
} from "./prompts";
import { baseProfile } from "./test-helpers";

/** OpenAI strict mode: every object lists all properties as required and forbids extras. */
function assertStrict(schema: any, path = "$"): void {
  if (schema.type === "object" || (Array.isArray(schema.type) && schema.type.includes("object"))) {
    expect(schema.additionalProperties, path).toBe(false);
    expect([...schema.required].sort(), path).toEqual(Object.keys(schema.properties).sort());
    for (const [k, v] of Object.entries(schema.properties)) assertStrict(v, `${path}.${k}`);
  }
  if (schema.items) assertStrict(schema.items, `${path}[]`);
  if (schema.enum && Array.isArray(schema.type) && schema.type.includes("null")) expect(schema.enum, path).toContain(null);
}

describe("prompts", () => {
  const p = baseProfile({ name: "Secret Name" });

  it("never includes the student's name", () => {
    const all = [
      profileBrief(p), plannerInstructions(), JSON.stringify(plannerInput({ profile: p, existing: [], count: 10 })),
      researcherInstructions(), JSON.stringify(researcherInput([{ name: "Elon University", state: "NC" }], p)),
      chatInstructions(p, "list"), JSON.stringify(listAdvicePrompt(p, "list")),
    ].join("\n");
    expect(all).not.toContain("Secret Name");
  });

  it("describes the profile and entry cycle in plain English", () => {
    const b = profileBrief(p);
    expect(b).toContain("Fall 2027 entry");
    expect(b).toContain("North Carolina (NC)");
    expect(b).toContain("nursing (BSN) (primary)");
    expect(b).toContain("pediatric nursing");
    expect(b).toContain("$30,000 per year");
    expect(b).toContain("South Atlantic (VA, NC, SC, GA, FL, WV)");
    expect(b).toContain("Early Action");
  });

  it("planner input asks for the right count and excludes existing picks", () => {
    const msg = plannerInput({ profile: p, existing: ["Duke University"], count: 14 })[0]!.content;
    expect(msg).toContain("Propose exactly 14 additional colleges");
    expect(msg).toContain("- Duke University");
    expect(msg).toContain("do NOT repeat");
  });

  it("researcher input lists colleges with states and the major enum values", () => {
    const msg = researcherInput([{ name: "Elon University", state: "NC" }, { name: "Clemson University", state: null }], p)[0]!.content;
    expect(msg).toContain("1. Elon University (NC)");
    expect(msg).toContain("2. Clemson University");
    expect(msg).toContain("nursing = nursing (BSN)");
  });

  it("tool schemas are strict-mode valid", () => {
    assertStrict(proposeCollegesTool.parameters);
    assertStrict(submitResearchTool.parameters);
    expect(proposeCollegesTool.strict).toBe(true);
    expect(submitResearchTool.strict).toBe(true);
  });
});
