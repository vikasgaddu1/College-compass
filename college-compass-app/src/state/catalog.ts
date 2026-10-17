/** Friendly labels, icons and option lists for everything the student picks from. */
import type { IncomeNetPrice, MajorArea, Region, StudentProfile, Tier } from "@/types";

export interface MajorInfo {
  id: MajorArea;
  label: string;
  icon: string;
  group: "STEM" | "Business" | "Health" | "Humanities & social" | "Arts & media" | "Other";
  keywords: string;
}

export const MAJORS: MajorInfo[] = [
  { id: "computer_science", label: "Computer science", icon: "💻", group: "STEM", keywords: "cs software programming ai" },
  { id: "engineering", label: "Engineering", icon: "⚙️", group: "STEM", keywords: "mechanical electrical civil chemical" },
  { id: "robotics_mechatronics", label: "Robotics & mechatronics", icon: "🤖", group: "STEM", keywords: "robots automation" },
  { id: "aerospace", label: "Aerospace", icon: "🚀", group: "STEM", keywords: "aeronautics space rockets planes" },
  { id: "data_science", label: "Data science", icon: "📊", group: "STEM", keywords: "analytics statistics ml" },
  { id: "math_stats", label: "Math & statistics", icon: "➗", group: "STEM", keywords: "mathematics" },
  { id: "physical_sciences", label: "Physics & chemistry", icon: "🔭", group: "STEM", keywords: "physical sciences astronomy geology" },
  { id: "biology", label: "Biology", icon: "🧬", group: "STEM", keywords: "pre-med life sciences neuroscience" },
  { id: "environmental_science", label: "Environmental science", icon: "🌱", group: "STEM", keywords: "climate sustainability ecology" },
  { id: "architecture", label: "Architecture", icon: "🏛️", group: "STEM", keywords: "design buildings urban planning" },
  { id: "business", label: "Business", icon: "💼", group: "Business", keywords: "finance marketing accounting management entrepreneurship" },
  { id: "economics_social", label: "Economics & social sciences", icon: "📈", group: "Business", keywords: "sociology anthropology" },
  { id: "health", label: "Health professions", icon: "🩺", group: "Health", keywords: "pre-med pharmacy physical therapy medicine" },
  { id: "nursing", label: "Nursing", icon: "🏥", group: "Health", keywords: "bsn rn" },
  { id: "public_health", label: "Public health", icon: "🌍", group: "Health", keywords: "epidemiology policy" },
  { id: "kinesiology_sports", label: "Kinesiology & sports", icon: "🏃", group: "Health", keywords: "exercise science athletic training" },
  { id: "psychology", label: "Psychology", icon: "🧠", group: "Humanities & social", keywords: "counseling cognitive" },
  { id: "political_science_law", label: "Political science & pre-law", icon: "⚖️", group: "Humanities & social", keywords: "government law policy" },
  { id: "english_humanities", label: "English & humanities", icon: "📚", group: "Humanities & social", keywords: "literature writing philosophy religion" },
  { id: "history_philosophy", label: "History & philosophy", icon: "🏺", group: "Humanities & social", keywords: "classics" },
  { id: "languages_international", label: "Languages & international studies", icon: "🗺️", group: "Humanities & social", keywords: "spanish french global relations linguistics" },
  { id: "communication", label: "Communication & journalism", icon: "🎙️", group: "Arts & media", keywords: "media pr news" },
  { id: "film_media", label: "Film & media", icon: "🎬", group: "Arts & media", keywords: "video production animation games" },
  { id: "arts_design", label: "Art & design", icon: "🎨", group: "Arts & media", keywords: "graphic fine arts illustration ux fashion" },
  { id: "performing_arts", label: "Music, theater & dance", icon: "🎭", group: "Arts & media", keywords: "performing arts acting" },
  { id: "education", label: "Education & teaching", icon: "🍎", group: "Other", keywords: "teacher" },
  { id: "agriculture_food", label: "Agriculture & food", icon: "🌾", group: "Other", keywords: "animal science nutrition culinary" },
  { id: "undecided", label: "Undecided", icon: "🧭", group: "Other", keywords: "not sure exploring" },
];

const majorById = new Map(MAJORS.map((m) => [m.id, m]));
export function majorLabel(id: MajorArea): string {
  return majorById.get(id)?.label ?? id.replace(/_/g, " ");
}
export function majorIcon(id: MajorArea): string {
  return majorById.get(id)?.icon ?? "📘";
}

export const REGIONS: { id: Region; label: string; hint: string }[] = [
  { id: "new_england", label: "New England", hint: "CT MA ME NH RI VT" },
  { id: "mid_atlantic", label: "Mid-Atlantic", hint: "NY NJ PA DE MD DC" },
  { id: "south_atlantic", label: "South Atlantic", hint: "VA NC SC GA FL WV" },
  { id: "southeast", label: "Southeast", hint: "TN KY AL MS AR LA" },
  { id: "midwest", label: "Midwest", hint: "OH MI IN IL WI MN IA MO" },
  { id: "great_plains", label: "Great Plains", hint: "ND SD NE KS" },
  { id: "southwest", label: "Southwest", hint: "TX OK NM AZ" },
  { id: "mountain", label: "Mountain", hint: "CO UT WY MT ID NV" },
  { id: "pacific", label: "Pacific", hint: "CA OR WA AK HI" },
];

const regionById = new Map(REGIONS.map((r) => [r.id, r.label]));
export function regionLabel(id: Region): string {
  return regionById.get(id) ?? "Other";
}

export const STATES: { code: string; name: string }[] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"],
  ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"],
  ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"],
  ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"],
  ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"],
  ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"],
  ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"],
  ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"],
  ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"],
  ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"], ["PR", "Puerto Rico"], ["XX", "Outside the US"],
].map(([code, name]) => ({ code, name }));

export function stateName(code: string): string {
  return STATES.find((s) => s.code === code)?.name ?? code;
}

export const INCOME_BANDS: { id: keyof IncomeNetPrice | "prefer_not"; label: string }[] = [
  { id: "0_30k", label: "Under $30k" },
  { id: "30_48k", label: "$30k – $48k" },
  { id: "48_75k", label: "$48k – $75k" },
  { id: "75_110k", label: "$75k – $110k" },
  { id: "110k_plus", label: "Over $110k" },
  { id: "prefer_not", label: "Prefer not to say" },
];

export const TIERS: { id: Tier; label: string; short: string; range: string; cssVar: string }[] = [
  { id: "high_reach", label: "High reach", short: "High reach", range: "under 15%", cssVar: "var(--tier-high-reach)" },
  { id: "reach", label: "Reach", short: "Reach", range: "15–35%", cssVar: "var(--tier-reach)" },
  { id: "target", label: "Target", short: "Target", range: "35–65%", cssVar: "var(--tier-target)" },
  { id: "likely", label: "Likely", short: "Likely", range: "65–85%", cssVar: "var(--tier-likely)" },
  { id: "safety", label: "Safety", short: "Safety", range: "85% or more", cssVar: "var(--tier-safety)" },
];
export const TIER_ORDER: Tier[] = ["high_reach", "reach", "target", "likely", "safety"];
export function tierInfo(t: Tier) {
  return TIERS.find((x) => x.id === t) ?? TIERS[2];
}

export const RIGOR: { id: StudentProfile["rigor"]; label: string; hint: string }[] = [
  { id: "most", label: "Most demanding", hint: "Nearly every AP/IB/honors class available to you" },
  { id: "very", label: "Very demanding", hint: "Most of the hardest classes, with a few regular ones" },
  { id: "average", label: "Average", hint: "A mix of honors and regular classes" },
  { id: "below", label: "Lighter", hint: "Mostly regular classes" },
];

export const ACTIVITIES: { id: StudentProfile["activities_strength"]; label: string; hint: string }[] = [
  { id: "national", label: "National or international recognition", hint: "Awards, publications, major competitions" },
  { id: "state", label: "State or regional recognition", hint: "Placed at state level, selective programs" },
  { id: "school_leader", label: "Leader at school", hint: "Captain, president, founder, section leader" },
  { id: "involved", label: "Steadily involved", hint: "A few activities, several years each" },
  { id: "light", label: "Just getting started", hint: "Limited time so far — jobs or family count too" },
];

export const PLANS: { id: StudentProfile["plan"]; label: string; hint: string }[] = [
  { id: "ed_ok", label: "Open to Early Decision", hint: "Binding commitment to one college if admitted" },
  { id: "ea_only", label: "Early Action only", hint: "Apply early, keep options open" },
  { id: "rd_only", label: "Regular Decision", hint: "Standard deadlines, compare offers" },
];

export const SIZES: { id: StudentProfile["size"]; label: string; hint: string }[] = [
  { id: "small", label: "Small", hint: "Under 5,000 undergrads" },
  { id: "medium", label: "Medium", hint: "5,000 – 15,000" },
  { id: "large", label: "Large", hint: "Over 15,000" },
  { id: "any", label: "No preference", hint: "" },
];

export const SETTINGS: { id: StudentProfile["setting"]; label: string; hint: string }[] = [
  { id: "city", label: "City", hint: "In or next to a major city" },
  { id: "suburb", label: "Suburb", hint: "Residential, city within reach" },
  { id: "town", label: "College town", hint: "The campus is the town" },
  { id: "rural", label: "Rural", hint: "Space and quiet" },
  { id: "any", label: "No preference", hint: "" },
];

export const OWNERSHIPS: { id: StudentProfile["ownership"]; label: string; hint: string }[] = [
  { id: "public", label: "Public", hint: "State universities; cheaper in-state" },
  { id: "private_nonprofit", label: "Private", hint: "Often more aid for lower incomes" },
  { id: "any", label: "Either", hint: "" },
];

export const PRIORITIES: { id: keyof StudentProfile["priorities"]; label: string; hint: string }[] = [
  { id: "academics_fit", label: "Strong program in my field", hint: "" },
  { id: "affordability", label: "Affordability", hint: "" },
  { id: "outcomes", label: "Graduation rate & earnings", hint: "" },
  { id: "location", label: "Location & campus feel", hint: "" },
  { id: "odds", label: "Good chance of getting in", hint: "" },
];

export function defaultProfile(): StudentProfile {
  const now = new Date();
  return {
    version: 1,
    home_state: "",
    grad_year: now.getFullYear() + (now.getMonth() >= 6 ? 2 : 1),
    gpa_unweighted: null,
    gpa_weighted: null,
    class_rank_pct: null,
    sat: null,
    act: null,
    rigor: "very",
    ap_ib_count: null,
    activities_strength: "involved",
    majors: [],
    interests_text: "",
    wanted_colleges: [],
    budget_per_year: null,
    income_band: "prefer_not",
    regions: [],
    max_distance_miles: null,
    size: "any",
    setting: "any",
    ownership: "any",
    plan: "ea_only",
    first_gen: false,
    priorities: { academics_fit: 4, affordability: 3, outcomes: 3, odds: 3, location: 2 },
  };
}

export const SUGGESTED_INTERESTS = [
  "game design", "marine biology", "pre-med", "startups", "sustainability", "creative writing",
  "cybersecurity", "music production", "sports analytics", "journalism", "AI", "fashion", "architecture",
];
