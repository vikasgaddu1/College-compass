import raw from "../data/schools.json";
import outcomesRaw from "../data/outcomes.json";

export type Score = number | null;

export interface School {
  slug: string;
  name: string;
  short: string;
  city_state: string;
  state: string;
  region: string;
  institution_type: string;
  is_public: boolean;
  undergrad_enrollment: number | null;
  size_bucket: "very-small" | "small" | "medium" | "large" | "unknown";
  degree_name: string;
  degree_type: string;
  program_archetype: string;
  archetypes: string[];
  major_access_status: "DIRECT" | "GATED" | "MIXED" | "UNK";
  major_access_full: string;
  recommended_major_route: string;
  alternative_route: string;
  primary_structural_risk: string;
  notable_ai_institute: string;
  notable_undergraduate_research_program: string;
  fourplusone_available: string;
  fourplusone_name: string;
  cost_total_instate: number | null;
  cost_total_outofstate: number | null;
  cost_for_nc_resident: number | null;
  housing_guarantee: string;
  greek_participation: string;
  sports_influence: string;
  recreation_center: string;
  scores: Record<string, Score>;
  score_notes: Record<string, string>;
  axes: {
    program_depth: number | null;
    foundations: number | null;
    hands_on: number | null;
    research_access: number | null;
    campus_life: number | null;
    ambition_healthy: number | null;
    outcomes: number | null;
    /** Robotics coursework an undergraduate can actually take (1-5). */
    robotics_curriculum?: number | null;
    /** Whether an undergraduate can get into robotics research/labs/teams (1-5). */
    robotics_access?: number | null;
  };
  /**
   * Verified ABET accreditation for the school's robotics/mechatronics-titled
   * credential. EAC = engineering, ETAC = engineering technology (applied; carries
   * a graduate-school and PE-licensure trade-off), CAC = computing.
   */
  robotics_credential?: {
    program_name: string;
    credential_type: "degree" | "concentration_within_degree" | "minor" | "certificate" | "none";
    parent_degree?: string | null;
    abet_commission: "EAC" | "ETAC" | "CAC" | "NOT_ABET_ACCREDITED" | "n.a.";
    abet_evidence_quote?: string | null;
    abet_source_url?: string | null;
    eac_alternative?: string | null;
    eac_alternative_url?: string | null;
    notes?: string | null;
  };
  /** Researched caveat on a school's robotics route, when one exists. */
  robotics_pathway_risk?: {
    severity: "closed" | "internal_gate" | "accreditation" | "not_freshman";
    affects: string;
    note: string;
    url: string;
    verify_with?: string;
    /** True when the school's robotics score depends on this route. */
    undermines_robotics_score?: boolean;
  };
  /** Per-subdomain robotics coverage, researched per school. */
  robotics_domains?: Record<string, {
    coverage: "strong" | "present" | "none";
    lab_or_course?: string | null;
    url?: string | null;
  }>;
  robotics_curriculum_detail?: {
    score_basis?: string;
    course_count_undergrad?: number | null;
    dedicated_degree?: string | null;
    minor_or_concentration?: string | null;
    capstone?: string | null;
    undergrad_courses?: { code?: string; title?: string; cite?: string }[];
  };
  robotics_access_detail?: {
    score_basis?: string;
    institute_or_center?: string | null;
    documented_lab_count?: string | null;
    undergrad_access_mode?: string | null;
    named_undergrad_program?: string | null;
    makerspaces?: string[];
    competition_teams?: string[];
  };
  fit_classification: "TOP FIT" | "STRONG FIT" | "CONDITIONAL FIT" | "LOWER FIT" | string;
  best_fit_reason: string;
  biggest_concern: string;
  evidence_confidence: string;
  source_urls: string[];
  shortlist_group: "strongest" | "alternative" | "reserve" | "weakened";
  distance_from_rdu: string;
  outcomes?: SchoolOutcomes | null;
}

export interface SchoolOutcomes {
  cds_year: string;
  // Aid
  meets_full_need: string | null;              // "Yes" | "No" | null
  need_blind: string | null;
  pct_receiving_need_aid: string | null;       // raw text — may include an inline caveat
  avg_need_grant: number | null;
  pct_receiving_merit_aid: string | null;
  avg_merit_grant: number | null;
  // Net price by income band
  avg_net_price_all: number | null;
  avg_net_price_under_30k: number | null;
  avg_net_price_30_to_48k: number | null;
  avg_net_price_48_to_75k: number | null;
  avg_net_price_75_to_110k: number | null;
  avg_net_price_over_110k: number | null;
  net_price_calculator_url: string | null;
  // Persistence
  grad_rate_4yr: number | null;                // percentage 0-100
  grad_rate_6yr: number | null;
  retention_rate: number | null;
  // Careers
  first_dest_report_url: string | null;
  first_dest_year: string | null;
  first_dest_knowledge_rate: string | null;
  cs_median_starting_salary: number | null;
  cs_salary_scope: string | null;              // "CS BS" | "College of Engineering" | "university-wide"
  cs_top_employers: string[];
  cs_top_grad_schools: string[];
  cs_pct_continuing_edu: string | null;
  source_urls: string[];
  notes?: string;                              // free-form caveats
}

// Fields whose prose we clean of source-ID tags for display.
const proseFields: (keyof School)[] = [
  "best_fit_reason", "biggest_concern", "primary_structural_risk",
  "recommended_major_route", "alternative_route",
  "notable_ai_institute", "notable_undergraduate_research_program",
  "fourplusone_name", "degree_name", "degree_type",
  "major_access_full", "institution_type",
  "greek_participation", "sports_influence", "recreation_center",
  "housing_guarantee",
];

function cleanForDisplay(s: any): School {
  const out = { ...s };
  for (const f of proseFields) if (typeof out[f] === "string") out[f] = stripSourceTagsInternal(out[f]);
  // Also clean score notes
  if (out.score_notes && typeof out.score_notes === "object") {
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(out.score_notes)) {
      cleaned[k] = typeof v === "string" ? stripSourceTagsInternal(v as string) : (v as string);
    }
    out.score_notes = cleaned;
  }
  return out as School;
}

function stripSourceTagsInternal(s: string): string {
  if (!s) return s;
  // Citation tags come in three shapes across the research batches: admissions
  // [SLUG-S##], robotics [SLUG-R##] and ECE [SLUG-E##]. They appear bracketed,
  // parenthesised, and as comma-separated groups. The original pattern matched
  // only bracketed -S tags, so robotics and ECE tags leaked into visible prose.
  return s
    // whole bracketed or parenthesised groups that contain nothing but tags
    .replace(
      /\s*[\[(]\s*[A-Z]{2,8}-[SRE]\d+(?:\s*[,;]?\s*(?:\[)?[A-Z]{2,8}-[SRE]\d+(?:\])?)*\s*[\])]/g,
      " ",
    )
    // any stragglers left bare in the sentence
    .replace(/\s*\b[A-Z]{2,8}-[SRE]\d+\b/g, " ")
    .replace(/\s*(?:\[[A-Za-z]+-S\d+\]\s*)+/g, " ")
    .replace(/\(\s*[,;]?\s*\)/g, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([,;])\s*([,.;])/g, "$2")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Build a slug -> outcomes map, tolerant of a few name/slug variants.
const outcomesRows: (SchoolOutcomes & { slug?: string; name?: string; short?: string })[] =
  ((outcomesRaw as any).rows || []) as any[];
const outcomesBySlug: Record<string, SchoolOutcomes> = {};
for (const r of outcomesRows) {
  const key = (r.slug || "").toLowerCase();
  if (key) outcomesBySlug[key] = r as SchoolOutcomes;
}

export const schools: School[] = (raw as unknown as School[]).map(s => {
  const cleaned = cleanForDisplay(s);
  cleaned.outcomes = outcomesBySlug[cleaned.slug] || null;
  return cleaned;
});

export const archetypeLabels: Record<string, string> = {
  A: "Dedicated AI",
  B: "Deep CS + AI",
  C: "AI + Robotics",
  D: "Undergrad-centered",
  E: "Large AI ecosystem",
};

export const scoreGroups: { key: string; label: string; short: string; keys: string[] }[] = [
  {
    key: "program_depth",
    label: "AI curriculum depth & breadth",
    short: "AI curriculum",
    keys: [
      "ai_curriculum_breadth",
      "ai_curriculum_depth",
      "emerging_ai_topics",
      "course_availability",
      "curricular_flexibility",
    ],
  },
  {
    key: "foundations",
    label: "CS & math foundations",
    short: "Foundations",
    keys: ["cs_foundations", "math_foundations"],
  },
  {
    key: "hands_on",
    label: "Hands-on projects & robotics",
    short: "Hands-on",
    keys: ["project_based_learning", "robotics_autonomy_options", "technical_club_ecosystem"],
  },
  {
    key: "research_access",
    label: "Undergrad research & faculty access",
    short: "Research access",
    keys: ["undergraduate_research_access", "faculty_mentorship", "computing_resources"],
  },
  {
    key: "ambition_healthy",
    label: "Ambition (healthy, not cutthroat)",
    short: "Ambition",
    keys: ["intellectual_energy", "healthy_ambition", "student_agency", "community_within_scale"],
  },
  {
    key: "campus_life",
    label: "Non-Greek social life & daily life",
    short: "Campus life",
    keys: [
      "non_greek_social_life",
      "nonacademic_club_variety",
      "campus_engagement",
      "recreation_facilities",
      "daily_life",
    ],
  },
  {
    key: "outcomes",
    label: "Industry, grad school & 4+1 outcomes",
    short: "Outcomes",
    keys: ["industry_preparation", "graduate_school_preparation", "fourplusone_quality"],
  },
  // Robotics is researched per school as its own pair of axes rather than
  // composed from the `scores` sub-keys, so `keys` is empty here: consumers that
  // flatMap over `keys` (the Curriculum score-note grid) correctly add nothing,
  // while consumers that read `axes[key]` (the Compare radar) pick them up.
  //
  // Without these the radar showed robotics only as one third of "Hands-on",
  // diluted by project work and club ecosystem -- so two schools with very
  // different robotics offerings could trace nearly the same shape.
  {
    key: "robotics_curriculum",
    label: "Robotics coursework you can actually take",
    short: "Robotics curriculum",
    keys: [],
  },
  {
    key: "robotics_access",
    label: "Robotics labs, teams & undergraduate research access",
    short: "Robotics access",
    keys: [],
  },
];

export function fitClass(f: string) {
  const k = (f || "").toUpperCase();
  if (k.startsWith("TOP")) return "fit-top";
  if (k.startsWith("STRONG")) return "fit-strong";
  if (k.startsWith("CONDITIONAL")) return "fit-conditional";
  if (k.startsWith("LOWER")) return "fit-lower";
  return "fit-lower";
}

export function scoreClass(v: Score) {
  if (v == null) return "unk";
  return `s${v}`;
}

export function fmtCost(v: number | null) {
  if (v == null) return "—";
  return `$${v.toLocaleString()}`;
}

export function fmtEnroll(n: number | null) {
  if (n == null) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

export const shortlistLabel: Record<string, string> = {
  strongest: "Strongest overall fit",
  alternative: "Strong alternative",
  reserve: "Held in reserve",
  weakened: "Weakened after research",
};

/** Strip source-ID tags like [CMU-S1] or [MIT-S8][UM-S3] from any string.
 *  (Public schools data is already pre-cleaned by cleanForDisplay above,
 *  but this is exported for ad-hoc use.) */
export const stripSourceTags = stripSourceTagsInternal;
