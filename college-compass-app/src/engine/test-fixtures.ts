/** Inline fixtures for engine tests. Figures are realistic approximations, not authoritative data. */
import type { College, StudentProfile } from "../types";

/** A college with every optional/numeric field null — what a failed research pass might return. */
export function blankCollege(over: Partial<College> = {}): College {
  return {
    id: "x",
    name: "Unknown College",
    short: "Unknown",
    city: "",
    state: "",
    region: "other",
    lat: null,
    lon: null,
    ownership: "private_nonprofit",
    locale: null,
    url: null,
    undergrad_size: null,
    admit_rate: null,
    sat_25: null,
    sat_75: null,
    act_25: null,
    act_75: null,
    test_policy: "unknown",
    tuition_in_state: null,
    tuition_out_of_state: null,
    cost_of_attendance: null,
    avg_net_price: null,
    net_price_by_income: { "0_30k": null, "30_48k": null, "48_75k": null, "75_110k": null, "110k_plus": null },
    grad_rate_6yr: null,
    retention_rate: null,
    median_earnings_10yr: null,
    program_share: {},
    hbcu: false,
    women_only: false,
    religious: false,
    data_year: "",
    source: "ai_research",
    sources: [],
    researched_at: "2026-10-01T00:00:00Z",
    data_confidence: "low",
    data_notes: [],
    ...over,
  };
}

export const ncState = blankCollege({
  id: "199193", name: "North Carolina State University", short: "NC State", city: "Raleigh", state: "NC",
  region: "south_atlantic", lat: 35.785, lon: -78.682, ownership: "public", locale: "city", undergrad_size: 27000,
  admit_rate: 0.40, sat_25: 1270, sat_75: 1440, act_25: 27, act_75: 32, test_policy: "optional",
  tuition_in_state: 9100, tuition_out_of_state: 31900, cost_of_attendance: 27000, avg_net_price: 15500,
  net_price_by_income: { "0_30k": 9000, "30_48k": 10500, "48_75k": 14000, "75_110k": 19000, "110k_plus": 23000 },
  grad_rate_6yr: 0.85, retention_rate: 0.94, median_earnings_10yr: 68000,
  program_share: { engineering: 0.22, computer_science: 0.06, business: 0.11, biology: 0.07 },
  data_year: "2025-26 CDS", data_confidence: "high",
  cds: { cds_year: "2025-26", in_state_admit_rate: 0.47, out_of_state_admit_rate: 0.30, avg_gpa: 4.4, offers_ea: true, gated_majors: ["engineering"] },
  application: { cycle: "Fall 2027 entry", plans: [{ plan: "EA", deadline: "Nov 1" }, { plan: "RD", deadline: "Jan 15" }], test_policy_note: null, essays_note: null, fee: "$85" },
});

export const gaTech = blankCollege({
  id: "139755", name: "Georgia Institute of Technology", short: "Georgia Tech", city: "Atlanta", state: "GA",
  region: "southeast", lat: 33.776, lon: -84.398, ownership: "public", locale: "city", undergrad_size: 18400,
  admit_rate: 0.16, sat_25: 1370, sat_75: 1530, act_25: 31, act_75: 35, test_policy: "required",
  tuition_in_state: 11800, tuition_out_of_state: 33800, cost_of_attendance: 31000, avg_net_price: 17000,
  net_price_by_income: { "0_30k": 6000, "30_48k": 8500, "48_75k": 13000, "75_110k": 19500, "110k_plus": 26000 },
  grad_rate_6yr: 0.93, retention_rate: 0.98, median_earnings_10yr: 101000,
  program_share: { engineering: 0.6, computer_science: 0.18 },
  data_year: "2025-26 CDS", data_confidence: "high",
  cds: { cds_year: "2025-26", in_state_admit_rate: 0.33, out_of_state_admit_rate: 0.12, offers_ea: true },
});

export const duke = blankCollege({
  id: "198419", name: "Duke University", short: "Duke", city: "Durham", state: "NC", region: "south_atlantic",
  lat: 36.001, lon: -78.939, ownership: "private_nonprofit", locale: "suburb", undergrad_size: 6600,
  admit_rate: 0.06, sat_25: 1510, sat_75: 1570, act_25: 34, act_75: 35, test_policy: "optional",
  cost_of_attendance: 92000, avg_net_price: 28000,
  net_price_by_income: { "0_30k": 2000, "30_48k": 3500, "48_75k": 8000, "75_110k": 18000, "110k_plus": 52000 },
  grad_rate_6yr: 0.96, retention_rate: 0.98, median_earnings_10yr: 98000,
  program_share: { computer_science: 0.12, economics_social: 0.2, biology: 0.1, public_health: 0.03 },
  data_year: "2025-26 CDS", data_confidence: "high",
  cds: { cds_year: "2025-26", offers_ed: true, ed_admit_rate: 0.17, rd_admit_rate: 0.045 },
  application: { cycle: "Fall 2027 entry", plans: [{ plan: "ED", deadline: "Nov 1" }, { plan: "RD", deadline: "Jan 2" }], test_policy_note: null, essays_note: null, fee: "$85" },
});

export const pitt = blankCollege({
  id: "215293", name: "University of Pittsburgh", short: "Pitt", city: "Pittsburgh", state: "PA", region: "mid_atlantic",
  lat: 40.444, lon: -79.953, ownership: "public", locale: "city", undergrad_size: 19900,
  admit_rate: 0.50, sat_25: 1260, sat_75: 1430, test_policy: "optional",
  tuition_in_state: 21000, tuition_out_of_state: 39000, cost_of_attendance: 38000, avg_net_price: 26000,
  net_price_by_income: { "0_30k": 14000, "30_48k": 16000, "48_75k": 20000, "75_110k": 25000, "110k_plus": 30000 },
  grad_rate_6yr: 0.84, median_earnings_10yr: 66000,
  program_share: { nursing: 0.07, health: 0.12, biology: 0.08, psychology: 0.06 },
  data_year: "2025-26 CDS", data_confidence: "medium",
  programs: [{ major: "nursing", offered: true, degree: "BSN", how_to_enter: "Direct admission to the School of Nursing; limited enrollment", notes: null }],
});

export const ithaca = blankCollege({
  id: "191968", name: "Ithaca College", short: "Ithaca", city: "Ithaca", state: "NY", region: "mid_atlantic",
  lat: 42.422, lon: -76.497, ownership: "private_nonprofit", locale: "town", undergrad_size: 4600,
  admit_rate: 0.80, test_policy: "optional", cost_of_attendance: 70000, avg_net_price: 33000,
  net_price_by_income: { "0_30k": 22000, "30_48k": 24000, "48_75k": 27000, "75_110k": 31000, "110k_plus": 38000 },
  grad_rate_6yr: 0.76, median_earnings_10yr: 52000,
  program_share: { performing_arts: 0.14, communication: 0.15, film_media: 0.08, health: 0.12 },
  data_year: "2024-25 CDS", data_confidence: "medium",
  programs: [{ major: "performing_arts", offered: true, degree: "BFA in Musical Theatre", how_to_enter: "Audition required", notes: null }],
});

export function baseProfile(over: Partial<StudentProfile> = {}): StudentProfile {
  return {
    version: 1,
    home_state: "NC",
    grad_year: 2027,
    gpa_unweighted: 3.85,
    gpa_weighted: 4.45,
    class_rank_pct: null,
    sat: 1450,
    act: null,
    rigor: "very",
    ap_ib_count: 8,
    activities_strength: "school_leader",
    majors: ["engineering"],
    interests_text: "",
    wanted_colleges: [],
    budget_per_year: 30000,
    income_band: "110k_plus",
    regions: [],
    max_distance_miles: null,
    size: "any",
    setting: "any",
    ownership: "any",
    plan: "ea_only",
    first_gen: false,
    priorities: { academics_fit: 4, affordability: 3, outcomes: 3, odds: 3, location: 2 },
    ...over,
  };
}
