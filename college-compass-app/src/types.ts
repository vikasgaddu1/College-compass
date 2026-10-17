/**
 * Shared contracts for the College Compass app.
 * Every module (data pipeline, engine, AI layer, UI) builds against these types.
 * Change them only in coordination — they are the seams between parallel work.
 */

// ───────────────────────────── College dataset ─────────────────────────────

/** Broad intended-major areas. Each maps to one or more CIP 2-digit families. */
export type MajorArea =
  | "computer_science"      // CIP 11
  | "engineering"           // CIP 14 (+ 15 engineering tech counted separately)
  | "robotics_mechatronics" // proxied by CIP 14 + 15 + 11 until finer data exists
  | "math_stats"            // CIP 27
  | "physical_sciences"     // CIP 40
  | "biology"               // CIP 26
  | "health"                // CIP 51 (pre-med students usually pick biology)
  | "business"              // CIP 52
  | "economics_social"      // CIP 45
  | "psychology"            // CIP 42
  | "communication"         // CIP 09
  | "english_humanities"    // CIP 23, 38, 54, 16
  | "arts_design"           // CIP 50
  | "education"             // CIP 13
  | "data_science"
  | "nursing"
  | "public_health"
  | "political_science_law"
  | "environmental_science"
  | "architecture"
  | "performing_arts"       // music, theater, dance
  | "film_media"
  | "history_philosophy"
  | "languages_international"
  | "agriculture_food"
  | "kinesiology_sports"
  | "aerospace"
  | "undecided";

export type Ownership = "public" | "private_nonprofit";
export type Locale = "city" | "suburb" | "town" | "rural";
export type Region =
  | "new_england" | "mid_atlantic" | "south_atlantic" | "southeast" | "midwest"
  | "great_plains" | "southwest" | "mountain" | "pacific" | "other";

export interface IncomeNetPrice {
  /** Average net price by family income band, USD/year (IPEDS / College Scorecard). */
  "0_30k": number | null;
  "30_48k": number | null;
  "48_75k": number | null;
  "75_110k": number | null;
  "110k_plus": number | null;
}

/** One college as shipped in public/data/colleges.json. Compact but explicit. */
export interface College {
  id: string;                 // IPEDS UNITID as string
  name: string;
  short: string;              // display name ≤ 22 chars where possible
  city: string;
  state: string;              // 2-letter
  region: Region;
  lat: number | null;
  lon: number | null;
  ownership: Ownership;
  locale: Locale | null;
  url: string | null;         // institution website
  undergrad_size: number | null;
  /** Admissions (IPEDS ADM survey = CDS sections C1/C9 equivalents). */
  admit_rate: number | null;          // 0..1
  sat_25: number | null;              // composite (math+EBRW) 25th percentile
  sat_75: number | null;
  act_25: number | null;              // composite
  act_75: number | null;
  test_policy: "required" | "optional" | "blind" | "considered" | "unknown";
  /** Cost (USD/year). */
  tuition_in_state: number | null;
  tuition_out_of_state: number | null;
  cost_of_attendance: number | null;  // published COA (on-campus)
  /** Which budget `cost_of_attendance` describes (publics differ by residency). Absent on older data. */
  cost_of_attendance_basis?: "out_of_state" | "in_state" | "same" | null;
  avg_net_price: number | null;
  net_price_by_income: IncomeNetPrice;
  /** Outcomes. */
  grad_rate_6yr: number | null;       // 0..1
  retention_rate: number | null;      // 0..1
  median_earnings_10yr: number | null;
  /** Share of bachelor's degrees awarded by area, 0..1. Missing areas = 0. */
  program_share: Partial<Record<Exclude<MajorArea, "undecided" | "robotics_mechatronics">, number>>;
  /** Flags. */
  hbcu: boolean;
  women_only: boolean;
  religious: boolean;
  data_year: string;                  // e.g. "2025-26 CDS" — the year the figures describe
  source: "ai_research" | "curated";
  /** Optional Common Data Set details found by research (ED/EA rates, GPA, residency rates, gated majors). */
  cds?: CuratedCds;
  /** Application facts for the student's entry cycle, as researched. */
  application?: ApplicationFacts;
  /** Program notes for the student's majors (named degrees, tracks, how you get in). */
  programs?: ProgramNote[];
  /** Merit / named scholarships relevant to this student. */
  scholarships?: { name: string; amount: string | null; note: string | null }[];
  /** Citations backing the figures above. */
  sources: { title: string; url: string }[];
  researched_at: string;              // ISO timestamp
  /** Researcher's own confidence in the figures. */
  data_confidence: "high" | "medium" | "low";
  /** Short plain-English notes: what is unverified, conflicting or estimated. */
  data_notes: string[];
}

export interface ApplicationFacts {
  cycle: string;                      // e.g. "Fall 2027 entry"
  plans: { plan: "ED" | "ED2" | "EA" | "REA" | "RD" | "Rolling" | "Priority"; deadline: string | null; notes?: string }[];
  test_policy_note: string | null;
  essays_note: string | null;
  fee: string | null;
}

export interface ProgramNote {
  major: MajorArea;
  offered: boolean;
  degree: string | null;              // e.g. "B.S. in Robotics Engineering"
  how_to_enter: string | null;        // direct admit / declare later / competitive transfer
  notes: string | null;
}

export interface CuratedCds {
  cds_year: string;
  ed_admit_rate?: number | null;
  ea_admit_rate?: number | null;
  rd_admit_rate?: number | null;
  offers_ed?: boolean;
  offers_ea?: boolean;
  in_state_admit_rate?: number | null;
  out_of_state_admit_rate?: number | null;
  avg_gpa?: number | null;            // CDS C12 (scale as reported)
  /** Majors that are capacity-limited / hard to switch into after enrollment. */
  gated_majors?: MajorArea[];
  robotics_degree?: string | null;    // e.g. "B.S. in Robotics Engineering"
  notes?: string;
  source_url?: string;
}

/** A college the student may consider, before research fills in the details. */
export interface CollegeCandidate {
  name: string;                       // official name, e.g. "Purdue University"
  state: string | null;
  why: string;                        // one line: why it fits this student
  expected_tier: Tier | null;         // planner's rough guess, replaced by the engine
  user_added: boolean;
}

// ───────────────────────────── Student profile ─────────────────────────────

export type SizePref = "small" | "medium" | "large" | "any";        // <5k, 5–15k, >15k
export type SettingPref = Locale | "any";
export type PlanWillingness = "ed_ok" | "ea_only" | "rd_only";

export interface StudentProfile {
  version: 1;
  name?: string;                      // optional, display only
  home_state: string;                 // 2-letter
  grad_year: number;                  // high-school graduation year
  gpa_unweighted: number | null;      // 0–4.0
  gpa_weighted: number | null;        // as reported, optional
  class_rank_pct: number | null;      // top X% (e.g. 10 = top 10%), optional
  sat: number | null;                 // 400–1600 composite
  act: number | null;                 // 1–36 composite
  rigor: "most" | "very" | "average" | "below";   // course rigor vs what school offers
  ap_ib_count: number | null;
  activities_strength: "national" | "state" | "school_leader" | "involved" | "light";
  majors: MajorArea[];                // 1–3, first is primary
  /** Free-text interests in the student's words, e.g. "marine biology", "game design". */
  interests_text: string;
  /** Colleges the student already likes (names as typed). */
  wanted_colleges: string[];
  /** Budget the family can pay per year after aid, USD. null = not sure. */
  budget_per_year: number | null;
  income_band: keyof IncomeNetPrice | "prefer_not";
  regions: Region[];                  // empty = anywhere
  max_distance_miles: number | null;  // optional, from home state centroid
  size: SizePref;
  setting: SettingPref;
  ownership: Ownership | "any";
  plan: PlanWillingness;
  first_gen: boolean;
  /** Weights 0–5 for what matters most. */
  priorities: {
    academics_fit: number;
    affordability: number;
    outcomes: number;
    odds: number;
    location: number;
  };
}

// ───────────────────────────── Engine outputs ─────────────────────────────

export type Tier = "safety" | "likely" | "target" | "reach" | "high_reach";

export interface OddsFactor {
  label: string;                      // plain English, e.g. "Your SAT is above the middle 50%"
  effect: "up" | "down" | "neutral";
  logit_delta: number;                // contribution to log-odds
}

export interface OddsResult {
  /** Point estimate 0..1 after caps. Display as a band, never as a precise promise. */
  p: number;
  low: number;                        // band low
  high: number;                       // band high
  tier: Tier;
  confidence: "low" | "medium" | "high"; // how much data backs this
  factors: OddsFactor[];
  caveats: string[];
}

export interface FitBreakdown {
  academics: number;                  // 0..1
  affordability: number;              // 0..1
  outcomes: number;                   // 0..1
  location: number;                   // 0..1
  odds: number;                       // 0..1
  total: number;                      // 0..100 weighted by profile.priorities
}

export interface RankedCollege {
  college: College;
  odds: OddsResult;
  fit: FitBreakdown;
  est_net_price: number | null;       // for this student's income band / residency
  est_net_price_note: string;
  reasons: string[];                  // 2–4 short "why it's on your list"
  watchouts: string[];                // 0–3 short concerns
}

export interface BalancedList {
  high_reach: RankedCollege[];
  reach: RankedCollege[];
  target: RankedCollege[];
  likely: RankedCollege[];
  safety: RankedCollege[];
}

// ───────────────────────────── AI layer ─────────────────────────────

export type AiConnection =
  | { kind: "none" }
  | { kind: "chatgpt"; account: ChatGPTAccount }
  | { kind: "api_key" };              // developer-only fallback (hidden in Settings → Developer)

export interface AiMessage { role: "user" | "assistant"; content: string }

export interface AiFunctionTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  strict?: boolean;
}

export interface AiCallResult {
  text: string;
  tool_calls: { name: string; arguments: string }[];  // raw JSON argument strings
  model: string;
}

export interface AiClient {
  connection(): AiConnection;
  /** One Responses API call (store:false, stream:true). Throws AiError. */
  call(opts: {
    instructions: string;
    input: AiMessage[];
    model?: string;                   // default: first listed model for the account
    tools?: AiFunctionTool[];
    tool_choice?: "auto" | "required" | { type: "function"; name: string };
    webSearch?: boolean;              // adds the web_search tool; silently retried without it if rejected
    reasoning?: "low" | "medium" | "high";
    onDelta?: (text: string) => void;
    signal?: AbortSignal;
  }): Promise<AiCallResult>;
}

export class AiError extends Error {
  constructor(
    public code: "not_connected" | "usage_limit" | "reauth_required" | "network" | "server" | "unsupported",
    message: string,
  ) { super(message); }
}

// ───────────────────────────── Auth (Sign in with ChatGPT) ─────────────────────────────

export interface ChatGPTAccount {
  sub: string;
  name: string | null;
  email: string | null;
  picture: string | null;
  plan_usage: boolean;                // granted chatgpt.tokens.use.direct
}

export interface AuthApi {
  /** True when a client ID is configured at build time. */
  configured(): boolean;
  account(): ChatGPTAccount | null;
  /** Redirects the browser to ChatGPT sign-in. */
  signIn(returnTo?: string): Promise<void>;
  /** Called on the callback route with the URL query; resolves to the signed-in account. */
  completeSignIn(query: URLSearchParams): Promise<ChatGPTAccount>;
  signOut(): void;
  /** Models the account can use (GET /v1/models, visibility=list). */
  listModels(): Promise<{ slug: string; display_name: string }[]>;
  subscribe(fn: () => void): () => void;
}

// ───────────────────────────── Research orchestration ─────────────────────────────

export type ResearchEvent =
  | { type: "planning" }
  | { type: "planned"; candidates: CollegeCandidate[] }
  | { type: "batch_started"; batch: number; names: string[] }
  | { type: "college_done"; college: College }
  | { type: "college_failed"; name: string; error: string }
  | { type: "batch_done"; batch: number }
  | { type: "summary_delta"; text: string }
  | { type: "done"; colleges: College[] }
  | { type: "error"; error: string; code?: AiError["code"] };

export interface ResearchOptions {
  profile: StudentProfile;
  /** Colleges the student named; if empty the planner picks candidates. */
  wanted: string[];
  /** How many colleges to research in total (planner target). Default 15. */
  target_count?: number;
  /** Colleges per agent call. Default 3. */
  batch_size?: number;
  /** Parallel agent calls in flight. Default 4. */
  concurrency?: number;
  /** Already researched colleges to reuse (cache, keyed by normalized name). */
  cache?: College[];
  model?: string;
  /** Model for the planner only (defaults to `model`). A quick list needs less than deep research. */
  planner_model?: string;
  /** Reasoning effort per agent role; omitted = the model's default. Lower is faster. */
  effort?: { planner?: "low" | "medium" | "high"; researcher?: "low" | "medium" | "high" };
  signal?: AbortSignal;
  onEvent: (e: ResearchEvent) => void;
}

export interface ResearchApi {
  /** Plan (if needed) → research in parallel batches → resolve with all researched colleges. */
  run(opts: ResearchOptions): Promise<College[]>;
  /** Re-research one college (e.g. user taps "refresh"). */
  researchOne(name: string, profile: StudentProfile, model?: string, signal?: AbortSignal): Promise<College>;
}
