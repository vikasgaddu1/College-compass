import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { roboticsAiFit, buildRoboticsFocus } from "../client/src/lib/focusPreset";
import { pickUnitRate, compareGpa } from "../client/src/lib/applicantProfile";
import type { School } from "../client/src/lib/data";

const data = (name: string): any => JSON.parse(readFileSync(new URL(`../client/src/data/${name}.json`, import.meta.url), "utf8"));
const schools = data("schools") as School[];
const selected = schools.map(s => s.slug).sort();

test("all school comparison datasets cover exactly the selected thirteen", () => {
  assert.equal(selected.length, 13);
  assert.equal(new Set(selected).size, 13);
  for (const name of ["robotics_routes", "robotics_paths", "scholarships", "checklists", "admissions_context"]) {
    assert.deepEqual(Object.keys(data(name).schools).sort(), selected, name);
  }
  assert.deepEqual(data("outcomes").rows.map((r: any) => r.slug).sort(), selected, "outcomes");
});

test("displayed primary credentials no longer describe the former AI major", () => {
  for (const school of schools) {
    assert.doesNotMatch(school.degree_type, /Artificial Intelligence|AI degree|AI major|computer science diploma/i, school.slug);
    assert.ok((school as any).recommended_admission_door, school.slug);
  }
});

test("dedicated degree explorer cannot substitute another campus or an unselected school", () => {
  for (const p of data("robotics_degrees").programs) {
    assert.ok(selected.includes(p.in_dataset_slug), p.institution);
    if (p.in_dataset_slug === "purdue") assert.doesNotMatch(p.institution, /Northwest|Fort Wayne/i);
  }
});

test("CMU planning view follows the primary robotics degree, not the old Stats/ML plan", () => {
  assert.match(data("cmu_plan").degree, /Bachelor of Science in Robotics|B\.S\. in Robotics|BS in Robotics/i);
  assert.doesNotMatch(data("cmu_plan").degree, /Statistics/);
});

test("robotics foundations beat an AI-only ecosystem in the robotics fit score", () => {
  const strongRobotics = { axes: { robotics_curriculum: 5, robotics_access: 5, hands_on: 5, foundations: 5, program_depth: 1, research_access: 1 } } as School;
  const strongAi = { axes: { robotics_curriculum: 2, robotics_access: 2, hands_on: 2, foundations: 5, program_depth: 5, research_access: 5 }, robotics_domains: Object.fromEntries(Array.from({length: 10}, (_, i) => [String(i), {coverage: "strong"}])) } as School;
  assert.ok(roboticsAiFit(strongRobotics) > roboticsAiFit(strongAi));
});

test("historical college rates cannot be used as current admission rates", () => {
  const historical = { unit_admit_rates: [{ unit: "SCS", door: "computing", residency: "all", rate: .052, basis: "Historical 2015 report", year: 2015, current_for_cycle: false }] };
  assert.equal(pickUnitRate(historical, {home_state: "NC"} as any, "computing"), null);
});

test("inferred college rates are not treated as official published rates", () => {
  assert.equal(pickUnitRate({ unit_rates_official: false, unit_admit_rates: [{unit:"Computing",door:"computing",residency:"all",rate:.113,basis:"INFERRED"}] }, {home_state:"NC"} as any, "computing"), null);
});

test("unknown GPA scales cannot move an admissions tier", () => {
  assert.equal(compareGpa({avg_gpa:{value:3.9,basis:"unspecified"}}, {gpa_uw:4,gpa_w:4.6} as any).delta, null);
});

test("an ECE route cannot borrow a technology degree's perfect robotics core", () => {
  const purdue = schools.find(s => s.slug === "purdue")!;
  assert.ok(purdue.axes.robotics_curriculum! < 5);
  assert.match(purdue.robotics_curriculum_detail!.score_basis!, /Computer Engineering/);
});

test("robotics shortlist evaluates the recommended admission door for CMU BSR", () => {
  const cmu = { slug: "carnegie-mellon", short: "CMU", recommended_admission_door: "computing", axes: {robotics_curriculum: 5, robotics_access: 5, hands_on: 5, foundations: 5, program_depth: 5}, admissions: { overall_admit_rate: .2, unit_admit_rates: [ {unit: "Engineering",door: "engineering",residency: "all",rate: .2}, {unit: "SCS",door: "computing",residency: "all",rate: .04} ] } } as unknown as School;
  const thresholds = {likely_admit_min:.35,target_admit_min:.2,high_reach_admit_max:.1,sat_75_bonus:0,gated_downgrade:false,gpa_delta:.15,use_gpa:false,pathway:"engineering",use_unit_rates:true,use_door_gates:false,gate_pathway_aware:false} as any;
  const result = buildRoboticsFocus({home_state:"NC",gpa_uw:null,gpa_w:null,sat:null,act:null,test_plan:"optional_hold"} as any, thresholds, {high_reach:1,reach:1,target:1,likely:1}, [cmu]);
  assert.equal(result.picks[0]?.rate, .04);
  const explicitEngineering = buildRoboticsFocus({home_state:"NC",gpa_uw:null,gpa_w:null,sat:null,act:null,test_plan:"optional_hold"} as any, thresholds, {high_reach:1,reach:1,target:1,likely:1}, [{...cmu,recommended_admission_door:undefined}], false);
  assert.equal(explicitEngineering.picks[0]?.rate, .2);
  const unsupportedAlternative = buildRoboticsFocus({home_state:"NC",gpa_uw:null,gpa_w:null,sat:null,act:null,test_plan:"optional_hold"} as any, thresholds, {high_reach:1,reach:1,target:1,likely:1}, [cmu], false);
  assert.equal(unsupportedAlternative.picks.length, 0);
});

test("residency matches the selected university state, not only North Carolina", () => {
  const a={school_state:"MI",unit_admit_rates:[{unit:"Engineering",door:"engineering",residency:"in_state",rate:.8},{unit:"Engineering",door:"engineering",residency:"oos",rate:.2}]};
  assert.equal(pickUnitRate(a,{home_state:"MI"} as any,"engineering")?.unit.rate,.8);
});

test("published current-cycle deadline events have real dates and source provenance", () => {
  const rows = data("deadlines").rows;
  assert.deepEqual(rows.map((r: any) => r.slug).sort(), selected);
  for (const row of rows) {
    assert.ok(row.source_url, row.slug);
    assert.ok(Array.isArray(row.events), row.slug);
    for (const e of row.events) {
      assert.match(e.date, /^202[67]-\d\d-\d\d$/, row.slug);
      assert.ok(e.source_url && e.verified_on && e.cycle, row.slug);
    }
  }
  const gt = rows.find((r: any) => r.slug === "georgia-tech");
  assert.ok(gt.events.some((e: any) => e.round === "ea" && e.date === "2026-11-02"), "NC applicant needs EA2");
});

test("all thirteen applications match the user's selected rounds", () => {
  const plans = data("applications").applications;
  assert.equal(plans.length, 13);
  const expected = {"carnegie-mellon":"ED1","nc-state":"EA","northeastern":"EA","purdue":"EA","ohio-state":"EA","maryland":"EA","rpi":"EA","michigan":"EA","wpi":"EA1","georgia-tech":"EA2","cornell":"RD","johns-hopkins":"RD","duke":"RD"};
  assert.deepEqual(Object.fromEntries(plans.map((a: any) => [a.slug,a.plan_short])), expected);
  assert.deepEqual(plans.filter((a: any) => a.binding).map((a: any) => a.slug), ["carnegie-mellon"]);
  assert.equal(plans.find((a: any) => a.slug === "georgia-tech").deadline, "2026-11-02");
  assert.equal(plans.find((a: any) => a.slug === "rpi").deadline, "2026-12-01");
});
