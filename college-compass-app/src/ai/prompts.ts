/**
 * The prompts and structured-output tools that power College Compass.
 *
 * - PLANNER   → `propose_colleges`        (picks a balanced candidate list when the student named too few)
 * - RESEARCHER → `submit_college_research` (one call per batch of 2–3 colleges; schema mirrors `College`)
 * - Ask tab   → chatInstructions() / listAdvicePrompt()
 *
 * Student data is kept minimal: no name, email or other identifiers ever go into a prompt.
 * Everything here is pure (no I/O) so it can be unit-tested and reviewed like copy.
 */
import type { AiFunctionTool, AiMessage, IncomeNetPrice, MajorArea, StudentProfile, Tier } from "../types";
import { REGION_LABELS, REGION_STATES, stateName } from "./geo";

// ───────────────────────────── enums (runtime copies of the type unions) ─────────────────────────────

export const MAJOR_AREAS = [
  "computer_science", "engineering", "robotics_mechatronics", "math_stats", "physical_sciences", "biology", "health",
  "business", "economics_social", "psychology", "communication", "english_humanities", "arts_design", "education",
  "data_science", "nursing", "public_health", "political_science_law", "environmental_science", "architecture",
  "performing_arts", "film_media", "history_philosophy", "languages_international", "agriculture_food",
  "kinesiology_sports", "aerospace", "undecided",
] as const satisfies readonly MajorArea[];
// Compile-time check that the list is exhaustive.
type _MissingMajor = Exclude<MajorArea, (typeof MAJOR_AREAS)[number]>;
const _majorsExhaustive: _MissingMajor extends never ? true : false = true;
void _majorsExhaustive;

export const TIERS = ["high_reach", "reach", "target", "likely", "safety"] as const satisfies readonly Tier[];
export const PLAN_KINDS = ["ED", "ED2", "EA", "REA", "RD", "Rolling", "Priority"] as const;
export const TEST_POLICIES = ["required", "optional", "blind", "considered", "unknown"] as const;
export const LOCALES = ["city", "suburb", "town", "rural"] as const;
export const OWNERSHIPS = ["public", "private_nonprofit"] as const;
export const CONFIDENCE = ["high", "medium", "low"] as const;

export const PLANNER_TOOL_NAME = "propose_colleges";
export const RESEARCH_TOOL_NAME = "submit_college_research";

// ───────────────────────────── plain-English profile ─────────────────────────────

const MAJOR_TEXT: Record<MajorArea, string> = {
  computer_science: "computer science", engineering: "engineering", robotics_mechatronics: "robotics / mechatronics",
  math_stats: "mathematics & statistics", physical_sciences: "physics / chemistry / physical sciences", biology: "biology / life sciences",
  health: "health professions (pre-med, pharmacy, PT, etc.)", business: "business", economics_social: "economics & social sciences",
  psychology: "psychology", communication: "communication & journalism", english_humanities: "English & humanities",
  arts_design: "art & design", education: "education / teaching", data_science: "data science", nursing: "nursing (BSN)",
  public_health: "public health", political_science_law: "political science / pre-law", environmental_science: "environmental science",
  architecture: "architecture", performing_arts: "performing arts (music, theater, dance)", film_media: "film & media production",
  history_philosophy: "history & philosophy", languages_international: "languages & international studies",
  agriculture_food: "agriculture & food science", kinesiology_sports: "kinesiology & sports science", aerospace: "aerospace engineering",
  undecided: "undecided / exploring",
};

const INCOME_TEXT: Record<keyof IncomeNetPrice | "prefer_not", string> = {
  "0_30k": "under $30k", "30_48k": "$30k–$48k", "48_75k": "$48k–$75k", "75_110k": "$75k–$110k", "110k_plus": "over $110k",
  prefer_not: "not shared",
};

const RIGOR_TEXT: Record<StudentProfile["rigor"], string> = {
  most: "most demanding curriculum available at their school",
  very: "very demanding (most of the hardest courses)",
  average: "average rigor (a mix of honors and regular courses)",
  below: "lighter course load",
};

const ACTIVITY_TEXT: Record<StudentProfile["activities_strength"], string> = {
  national: "national/international-level recognition",
  state: "state/regional-level recognition",
  school_leader: "leadership roles at school",
  involved: "steady involvement in a few activities",
  light: "limited activities so far",
};

const PLAN_TEXT: Record<StudentProfile["plan"], string> = {
  ed_ok: "open to a binding Early Decision application",
  ea_only: "will apply Early Action (non-binding) but not Early Decision",
  rd_only: "Regular Decision only",
};

const SIZE_TEXT: Record<StudentProfile["size"], string> = {
  small: "small (under ~5,000 undergraduates)", medium: "medium (~5,000–15,000)", large: "large (over ~15,000)", any: "no preference",
};

function fmtMoney(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function val(v: number | null | undefined, fmt: (n: number) => string = String): string {
  return v == null || !Number.isFinite(v) ? "not provided" : fmt(v);
}

/** Entry term for a high-school class: class of 2027 → "Fall 2027". */
export function entryTerm(profile: Pick<StudentProfile, "grad_year">): string {
  return `Fall ${profile.grad_year}`;
}

function cycleLine(profile: StudentProfile): string {
  const y = profile.grad_year;
  return `${entryTerm(profile)} entry (high-school class of ${y}; applications are filed roughly Aug ${y - 1} – Feb ${y})`;
}

/** Compact, identifier-free description of the student for prompts. */
export function profileBrief(p: StudentProfile): string {
  const majors = p.majors.length ? p.majors.map((m, i) => MAJOR_TEXT[m] + (i === 0 ? " (primary)" : "")).join("; ") : "undecided";
  const regions = p.regions.length
    ? p.regions.map((r) => `${REGION_LABELS[r]}${r !== "other" ? ` (${REGION_STATES[r].join(", ")})` : ""}`).join("; ")
    : "anywhere in the US";
  const pr = p.priorities;
  const lines = [
    `- Entry: ${cycleLine(p)}`,
    `- Home state: ${stateName(p.home_state)} (${p.home_state}) — in-state tuition applies at ${p.home_state} public universities`,
    `- GPA: unweighted ${val(p.gpa_unweighted, (n) => n.toFixed(2))}; weighted ${val(p.gpa_weighted, (n) => n.toFixed(2))}` +
      (p.class_rank_pct != null ? `; class rank top ${p.class_rank_pct}%` : ""),
    `- Tests: SAT ${val(p.sat)}; ACT ${val(p.act)}` + (p.sat == null && p.act == null ? " (applying test-optional where allowed)" : ""),
    `- Course rigor: ${RIGOR_TEXT[p.rigor]}` + (p.ap_ib_count != null ? `; ${p.ap_ib_count} AP/IB courses` : ""),
    `- Activities: ${ACTIVITY_TEXT[p.activities_strength]}`,
    `- Intended majors: ${majors}`,
    p.interests_text.trim() ? `- Interests in their own words: "${p.interests_text.trim().slice(0, 300)}"` : "",
    `- Budget after aid: ${p.budget_per_year != null ? fmtMoney(p.budget_per_year) + " per year" : "not sure yet"}; family income: ${INCOME_TEXT[p.income_band]}`,
    `- Regions: ${regions}` + (p.max_distance_miles ? `; within about ${p.max_distance_miles} miles of home` : ""),
    `- Size: ${SIZE_TEXT[p.size]}; setting: ${p.setting === "any" ? "no preference" : p.setting}; type: ${p.ownership === "any" ? "public or private" : p.ownership === "public" ? "public only" : "private nonprofit only"}`,
    `- Application plans: ${PLAN_TEXT[p.plan]}`,
    `- First-generation college student: ${p.first_gen ? "yes" : "no"}`,
    `- What matters most (0–5): academics/program fit ${pr.academics_fit}, affordability ${pr.affordability}, career outcomes ${pr.outcomes}, chance of admission ${pr.odds}, location ${pr.location}`,
  ];
  return lines.filter(Boolean).join("\n");
}

function today(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// ───────────────────────────── JSON Schema helpers (strict-mode compatible) ─────────────────────────────

type Schema = Record<string, unknown>;
const str = (description?: string): Schema => ({ type: "string", ...(description ? { description } : {}) });
const nstr = (description?: string): Schema => ({ type: ["string", "null"], ...(description ? { description } : {}) });
const nnum = (description?: string): Schema => ({ type: ["number", "null"], ...(description ? { description } : {}) });
const nint = (description?: string): Schema => ({ type: ["integer", "null"], ...(description ? { description } : {}) });
const bool = (description?: string): Schema => ({ type: "boolean", ...(description ? { description } : {}) });
const nbool = (description?: string): Schema => ({ type: ["boolean", "null"], ...(description ? { description } : {}) });
const enm = (values: readonly string[], description?: string): Schema => ({ type: "string", enum: [...values], ...(description ? { description } : {}) });
const nenm = (values: readonly string[], description?: string): Schema => ({ type: ["string", "null"], enum: [...values, null], ...(description ? { description } : {}) });
const arr = (items: Schema, description?: string): Schema => ({ type: "array", items, ...(description ? { description } : {}) });
/** Strict objects: every property required, no extras (nullable types express "optional"). */
function obj(properties: Record<string, Schema>, description?: string): Schema {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false, ...(description ? { description } : {}) };
}

// ───────────────────────────── PLANNER ─────────────────────────────

export const proposeCollegesTool: AiFunctionTool = {
  type: "function",
  name: PLANNER_TOOL_NAME,
  description: "Return the proposed colleges for this student. Call exactly once with the full list.",
  strict: true,
  parameters: obj({
    candidates: arr(
      obj({
        name: str("Official institution name, e.g. \"University of Washington\" (main campus unless a campus is named)."),
        state: nstr("Two-letter US state code of the campus, e.g. \"WA\"."),
        why: str("One specific sentence (max ~25 words) on why it fits THIS student: the program, cost angle, or setting."),
        expected_tier: nenm(TIERS, "Rough admission tier for this student: high_reach <15% chance, reach 15–35%, target 35–65%, likely 65–85%, safety ≥85%."),
      }),
      "Distinct colleges, none of which is already on the student's list.",
    ),
  }),
};

export interface PlannerPromptInput {
  profile: StudentProfile;
  /** Colleges already on the list (the student's own picks), exactly as typed. */
  existing: string[];
  /** How many NEW colleges to propose. */
  count: number;
  now?: Date;
}

export function plannerInstructions(now: Date = new Date()): string {
  return `You are an experienced, candid US college admissions counselor who has helped thousands of students from every background build their college lists. Today is ${today(now)}.

Your job: propose a balanced, realistic list of US four-year colleges for ONE student, using everything in their profile. You return the list by calling the \`${PLANNER_TOOL_NAME}\` function exactly once — never answer in prose.

How to think about it:
1. Read the whole profile first: academics (GPA, rigor, tests), intended majors AND their own words about interests, budget and family income, home state, regions, size, setting, public/private preference, which application plans they'll use, first-generation status, and their priorities.
2. Fit the student's actual interests, whatever the field. Prefer colleges that are genuinely strong in the specific thing they want, not just "good schools". Examples: nursing → direct-admit BSN programs with strong NCLEX pass rates; performing arts → conservatories and BFA programs (note audition/portfolio requirements); marine biology → coastal campuses with marine labs; architecture → accredited 5-year B.Arch programs; aerospace → ABET aerospace programs with flight/space labs; game design → programs with dedicated game design degrees; undecided → strong breadth and easy major exploration. Use the free-text interests to go beyond the major category.
3. Balance by THIS student's chances (not by prestige): about 20% high reach/reach, 45% target and 35% likely/safety. A college with an admit rate under ~15% is a high reach for every applicant, however strong. Use the student's GPA/test scores relative to each college's middle 50% to judge; if the student has no test score, judge by GPA and rigor and favor test-optional colleges.
4. Respect constraints:
   - Hard constraints (never violate): the student's chosen regions and maximum distance (if any) and public/private choice. If the regions list is "anywhere", consider the whole US.
   - Strong preferences (follow for nearly all picks; at most one or two exceptions with an exceptional, stated reason): size and setting.
   - Money: when affordability matters or a budget is given, make sure most picks are plausibly affordable for this family's income band through need-based aid or merit aid, and include the student's own in-state public universities (often the best value). Name merit-aid opportunities in "why" when they are the reason a pick is affordable. Don't fill the list with colleges that will clearly cost far more than the budget unless they meet full need or give big merit.
   - Application plans: if the student is open to Early Decision, it's fine to include a reach or two where ED meaningfully helps; if they are EA/RD only, don't lean on ED advantages.
   - First-generation students: favor colleges with strong first-gen support and generous need-based aid where relevant.
5. Go beyond the famous names. Include excellent but less obvious options — honors colleges at public universities, strong regional publics, specialized institutes, liberal arts colleges with standout programs in the student's interest — so the list is useful, not a rankings printout.
6. No duplicates, no branch campuses confused with flagships, no colleges already on the student's list, no for-profit institutions, no colleges that have closed or merged. Use official names and correct states.
7. If a web search tool is available, use it sparingly to confirm anything you are unsure about (e.g. that a program exists or a recent test-policy change). Detailed research happens later, so don't over-research.

Each "why" must be specific to this student (a program, a cost angle, a setting match) — not generic praise. Then call \`${PLANNER_TOOL_NAME}\` once with the complete list.`;
}

export function plannerInput({ profile, existing, count }: PlannerPromptInput): AiMessage[] {
  const existingText = existing.length
    ? `Already on the student's list (their own picks — do NOT repeat these; balance your picks around them):\n${existing.map((n) => `- ${n}`).join("\n")}`
    : "The student has not named any colleges yet.";
  return [
    {
      role: "user",
      content: `Student profile:\n${profileBrief(profile)}\n\n${existingText}\n\nPropose exactly ${count} additional colleges for ${entryTerm(profile)} entry, balanced as described, and return them with \`${PLANNER_TOOL_NAME}\`.`,
    },
  ];
}

// ───────────────────────────── RESEARCHER ─────────────────────────────

const incomeSchema = obj({
  "0_30k": nint("Average net price, family income $0–30k (USD/yr)."),
  "30_48k": nint("$30,001–48k."),
  "48_75k": nint("$48,001–75k."),
  "75_110k": nint("$75,001–110k."),
  "110k_plus": nint("Over $110k."),
});

const collegeSchema = obj({
  name: str("Official institution name (as the college writes it)."),
  short: nstr("Common short name, max ~22 characters (e.g. \"Georgia Tech\", \"UNC Chapel Hill\")."),
  city: str("Campus city."),
  state: str("Two-letter state code."),
  ownership: enm(OWNERSHIPS),
  locale: nenm(LOCALES, "Campus setting."),
  url: nstr("Official website (https://…)."),
  lat: nnum("Campus latitude (approximate is fine)."),
  lon: nnum("Campus longitude (approximate is fine)."),
  undergrad_size: nint("Degree-seeking undergraduates (CDS B1)."),
  admit_rate: nnum("Overall first-year admit rate as a decimal 0–1 (CDS C1: admitted ÷ applied)."),
  sat_25: nint("SAT composite (EBRW+Math) 25th percentile of enrolled first-years (CDS C9); if only section scores exist, the sum of section 25ths (say so in data_notes)."),
  sat_75: nint("SAT composite 75th percentile (same rules)."),
  act_25: nint("ACT composite 25th percentile (CDS C9)."),
  act_75: nint("ACT composite 75th percentile."),
  test_policy: enm(TEST_POLICIES, "Policy for the student's entry cycle: required / optional / blind (not considered) / considered (used if sent, e.g. some publics) / unknown."),
  tuition_in_state: nint("Annual tuition + required fees, in-state (privates: same as out-of-state)."),
  tuition_out_of_state: nint("Annual tuition + required fees, out-of-state."),
  cost_of_attendance: nint("Published total cost of attendance for an on-campus first-year (out-of-state for publics)."),
  avg_net_price: nint("Average annual net price after grants (College Scorecard / IPEDS)."),
  net_price_by_income: incomeSchema,
  grad_rate_6yr: nnum("Six-year graduation rate 0–1."),
  retention_rate: nnum("First-year retention rate 0–1."),
  median_earnings_10yr: nint("Median earnings 10 years after entry (College Scorecard), USD."),
  program_share: arr(
    obj({ major: enm(MAJOR_AREAS), share: nnum("Share of bachelor's degrees awarded in this area, 0–1 (CDS J1 / IPEDS).") }),
    "Only for the student's major areas.",
  ),
  hbcu: bool("Historically Black college or university."),
  women_only: bool("Admits women only."),
  religious: bool("Religiously affiliated."),
  cds: obj({
    cds_year: nstr("Common Data Set year used, e.g. \"2025-2026\"."),
    offers_ed: nbool("Offers Early Decision (ED I or ED II) for this cycle."),
    offers_ea: nbool("Offers Early Action / Restrictive Early Action for this cycle."),
    ed_admit_rate: nnum("ED admit rate 0–1 (CDS C21: ED admitted ÷ ED applicants)."),
    ea_admit_rate: nnum("EA admit rate 0–1 (CDS C22 or official release)."),
    rd_admit_rate: nnum("Regular-round admit rate 0–1 if published or computable from C1 minus C21 (note if computed)."),
    in_state_admit_rate: nnum("In-state applicant admit rate 0–1 (official reports; null if not published)."),
    out_of_state_admit_rate: nnum("Out-of-state applicant admit rate 0–1."),
    avg_gpa: nnum("Average high-school GPA of enrolled first-years (CDS C12), as reported."),
    gated_majors: arr(enm(MAJOR_AREAS), "Student's major areas that are capacity-limited / need separate or competitive admission / are hard to switch into."),
    notes: nstr("One short note about admissions specifics (e.g. 'admits by college; CS admits ~8%')."),
    source_url: nstr("URL of the Common Data Set used."),
  }),
  application: obj({
    cycle: str("e.g. \"Fall 2027 entry\"."),
    plans: arr(
      obj({
        plan: enm(PLAN_KINDS),
        deadline: nstr("Deadline as 'YYYY-MM-DD' for this cycle; null if unknown."),
        notes: nstr("Binding? Notification date? 'Based on last cycle — confirm' when this cycle's date isn't published."),
      }),
    ),
    test_policy_note: nstr("Plain-English policy for this cycle, incl. score-reporting rules."),
    essays_note: nstr("Supplemental essays / portfolio / audition / interview requirements."),
    fee: nstr("Application fee, e.g. '$75 (waivers available)'."),
  }),
  programs: arr(
    obj({
      major: enm(MAJOR_AREAS),
      offered: bool("A bachelor's program in this area exists."),
      degree: nstr("Exact degree name(s), e.g. 'B.S. in Marine Biology'."),
      how_to_enter: nstr("Direct admit to the major / admitted to the university then apply to the major (how competitive) / declare later / audition or portfolio required."),
      notes: nstr("What stands out for this student: labs, co-ops, accreditation, pass rates, notable tracks."),
    }),
    "One entry per student major area (and the closest match for their free-text interests).",
  ),
  scholarships: arr(
    obj({
      name: str("Named scholarship or merit program."),
      amount: nstr("Amount or range, e.g. '$5,000–$20,000/yr' or 'full tuition'."),
      note: nstr("Eligibility relevant to this student (automatic vs competitive, separate application, deadline)."),
    }),
    "Merit/named scholarships this student could realistically be considered for. Empty if none found.",
  ),
  sources: arr(obj({ title: str(), url: str("A real URL you actually used.") }), "Most important sources first."),
  data_year: str("The year the main figures describe, e.g. \"2025-26 CDS\"."),
  data_confidence: enm(CONFIDENCE, "high: mostly current official figures; medium: mixed/older; low: largely estimates or major gaps."),
  data_notes: arr(str(), "Short plain-English notes: what is estimated, older, computed, conflicting, or missing."),
});

export const submitResearchTool: AiFunctionTool = {
  type: "function",
  name: RESEARCH_TOOL_NAME,
  description: "Submit the researched facts for every requested college in one call (one entry per college, in the requested order).",
  strict: true,
  parameters: obj({ colleges: arr(collegeSchema) }),
};

export function researcherInstructions(now: Date = new Date()): string {
  return `You are a meticulous college data researcher working for a high-school student and their family. Today is ${today(now)}. Accuracy matters more than completeness: a wrong number can mislead a family's decisions.

Task: research each named US college for the student's entry cycle and return the facts by calling \`${RESEARCH_TOOL_NAME}\` exactly once, with one entry per requested college in the order given. Do not answer in prose.

Where to look (in this order of trust):
1. The college's most recent Common Data Set (CDS). As of today that is usually CDS 2025-2026 (describing the class that entered in Fall 2025); if only an older one is published, use it and say so. Key sections: B1 enrollment, B4–B11 graduation rate, B22 retention, C1 applicants/admits, C8 test policy, C9 SAT/ACT percentiles, C11/C12 GPA, C21 Early Decision, C22 Early Action, G tuition/cost, H financial aid, J degrees by field.
2. Official admissions, financial-aid, scholarship and academic-catalog pages for the student's cycle (deadlines, test policy, how to enter a major, named merit scholarships).
3. U.S. Dept. of Education College Scorecard / IPEDS for net price by income, average net price and median earnings.
Use web search to find and read these when it is available. Record the year of the figures you used in data_year.

Rules — never break these:
- Never invent. If you can't find or verify a value, use null and add a short note in data_notes. Do not fill gaps with guesses that look like real data. If you are relying on remembered figures because you could not browse, set data_confidence to "medium" or "low" and say so.
- Make sure you research the exact institution: use the state to disambiguate (e.g. Miami University in Ohio vs. University of Miami in Florida; the main campus unless another campus is named). Return the official name.
- Formats: rates as decimals 0–1 (0.27, not 27); dollars as whole numbers without symbols; SAT composite 400–1600 (EBRW + Math; if only section percentiles exist, add the section 25ths and the 75ths and note that it is an approximation); ACT composite 1–36; dates as YYYY-MM-DD.
- Application plans and deadlines must be for the student's entry term. If that cycle's dates aren't published yet, give last cycle's dates and put "Based on last cycle — confirm" in that plan's notes. Only list plans the college actually offers (ED, ED2, EA, REA, RD, Rolling, Priority). Set offers_ed / offers_ea accordingly.
- Programs: for each of the student's major areas (and their free-text interests), say whether a bachelor's program exists, its exact degree name, and how students get in: direct admission to the major, admission to a college/school within the university, a competitive internal application after enrollment (give the bar if published), declaring later, or a required audition/portfolio. List any of the student's areas that are capacity-limited or hard to switch into in cds.gated_majors.
- Costs: published tuition and fees and cost of attendance for the most recent year; for public universities give both in-state and out-of-state. Net price by income from College Scorecard.
- Scholarships: only named merit or program scholarships you found on official pages that this student could plausibly be considered for (note automatic vs competitive, separate applications and deadlines). Empty list if none.
- program_share: share of bachelor's degrees in each of the student's major areas (CDS J1 or IPEDS completions), null if unknown.
- Sources: cite the pages you actually used (CDS PDF, admissions/aid pages, College Scorecard). Never fabricate URLs; if you could not browse, cite only the college's official home page.
- data_confidence: "high" when most figures come from the latest or previous CDS and official pages for this cycle; "medium" when figures are older or mixed; "low" when much is estimated or missing.
- If a requested name isn't a US four-year college or can't be identified, still return an entry for it with the name as given, nulls, data_confidence "low" and a note explaining.

Keep notes short and plain-English (they are shown to a teenager and their parents). Then call \`${RESEARCH_TOOL_NAME}\` once with all colleges.`;
}

export interface ResearchTarget {
  name: string;
  state: string | null;
}

export function researcherInput(targets: ResearchTarget[], profile: StudentProfile): AiMessage[] {
  const list = targets.map((t, i) => `${i + 1}. ${t.name}${t.state ? ` (${t.state})` : ""}`).join("\n");
  const majors = profile.majors.length ? profile.majors.map((m) => `${m} = ${MAJOR_TEXT[m]}`).join("; ") : "undecided";
  const needs = [
    `- Entry: ${cycleLine(profile)}`,
    `- Home state: ${profile.home_state} (so note in-state vs out-of-state differences at public universities)`,
    `- Major areas (use these enum values in programs/program_share/gated_majors): ${majors}`,
    profile.interests_text.trim() ? `- Specific interests: "${profile.interests_text.trim().slice(0, 300)}"` : "",
    `- Family income band: ${INCOME_TEXT[profile.income_band]}${profile.budget_per_year != null ? `; budget about ${fmtMoney(profile.budget_per_year)}/yr after aid` : ""}`,
    `- Academic snapshot for scholarship relevance: unweighted GPA ${val(profile.gpa_unweighted, (n) => n.toFixed(2))}, SAT ${val(profile.sat)}, ACT ${val(profile.act)}`,
    `- Application plans: ${PLAN_TEXT[profile.plan]}`,
  ].filter(Boolean);
  const content = [
    `Research these colleges for ${entryTerm(profile)} entry:\n${list}`,
    `What this student needs from the research (no personal identifiers):\n${needs.join("\n")}`,
    `Return all ${targets.length} with \`${RESEARCH_TOOL_NAME}\`.`,
  ].join("\n\n");
  return [{ role: "user", content }];
}

// ───────────────────────────── Ask tab ─────────────────────────────

/** Instructions for the Ask tab chat. `summary` is the engine's plain-text summary of the list. */
export function chatInstructions(profile: StudentProfile, summary: string, now: Date = new Date()): string {
  return `You are College Compass, a warm, honest college-search guide talking with a high-school student (and sometimes their parents) on a phone. Today is ${today(now)}.

What you know about the student (no names or contact details are shared with you):
${profileBrief(profile)}

Their current college list, as computed by the app (admission odds are heuristic estimate bands from published data, not predictions):
${summary.trim() || "(The list is empty so far.)"}

How to answer:
- Be concise: usually under 150 words, short paragraphs or a few bullets. Plain language a 16-year-old understands. Offer to go deeper instead of writing an essay.
- Be honest about odds. Never promise admission, scholarships or aid. At colleges admitting under ~15%, everyone — even top applicants — should treat admission as a reach. Present odds as ranges.
- Ground answers in the list above and the student's profile. If you don't know something specific (a deadline, a scholarship, a policy), say so rather than guessing, and suggest checking the college's official admissions or financial-aid page — or tapping "Refresh research" on that college in the app.
- Facts change every year (test policies, deadlines, essay prompts). Encourage verifying important details on official sites before acting.
- Money: explain net price vs sticker price simply, and suggest each college's Net Price Calculator for a personal estimate.
- Be encouraging and practical; there are many great colleges for every student. For big decisions (binding Early Decision, financial commitments), suggest talking it over with family and their school counselor.
- Stay on college planning. Don't ask for personal identifying information. If asked about something unrelated or unsafe, gently steer back.`;
}

/** A complete call spec for "Review my list" (use with aiClient.call({...listAdvicePrompt(p, s), onDelta})). */
export function listAdvicePrompt(profile: StudentProfile, summary: string, now: Date = new Date()): { instructions: string; input: AiMessage[] } {
  return {
    instructions: chatInstructions(profile, summary, now),
    input: [
      {
        role: "user",
        content: `Please review my college list like a counselor would. In under 220 words:
1. Is it balanced? Count reach / target / likely-safety and say if I need more of any tier (a healthy list has at least 2–3 likely or safety colleges I'd be happy to attend and can afford).
2. Affordability: flag colleges likely to be well over my budget and point to cheaper strong options already on my list.
3. Fit for my interests: which colleges look strongest for what I want to study, and any program-entry catches (competitive majors, auditions, portfolios).
4. Strategy for my application plans (${PLAN_TEXT[profile.plan]}): which early options to consider — only ones the list says the college offers.
5. Two or three concrete next steps.
Be honest and specific; don't invent facts that aren't in my list.`,
      },
    ],
  };
}
