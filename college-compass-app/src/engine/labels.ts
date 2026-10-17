/** Plain-English names used in engine-generated text (reasons, watchouts, factors). */
import type { MajorArea, Tier } from "../types";

export const MAJOR_LABELS: Readonly<Record<MajorArea, string>> = {
  computer_science: "computer science",
  engineering: "engineering",
  robotics_mechatronics: "robotics / mechatronics",
  math_stats: "math & statistics",
  physical_sciences: "physical sciences",
  biology: "biology",
  health: "health sciences",
  business: "business",
  economics_social: "economics & social sciences",
  psychology: "psychology",
  communication: "communication",
  english_humanities: "English & humanities",
  arts_design: "art & design",
  education: "education",
  data_science: "data science",
  nursing: "nursing",
  public_health: "public health",
  political_science_law: "political science / pre-law",
  environmental_science: "environmental science",
  architecture: "architecture",
  performing_arts: "performing arts",
  film_media: "film & media",
  history_philosophy: "history & philosophy",
  languages_international: "languages & international studies",
  agriculture_food: "agriculture & food science",
  kinesiology_sports: "kinesiology & sports science",
  aerospace: "aerospace engineering",
  undecided: "undecided",
};

export function majorLabel(m: MajorArea | string | undefined | null): string {
  if (!m) return "your major";
  return (MAJOR_LABELS as Record<string, string>)[m] ?? String(m).replace(/_/g, " ");
}

export const TIER_LABELS: Readonly<Record<Tier, string>> = {
  high_reach: "High reach",
  reach: "Reach",
  target: "Target",
  likely: "Likely",
  safety: "Safety",
};

/** Normalized name for matching ("The University of X" ≈ "university of x"). */
export function normName(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\bthe\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
