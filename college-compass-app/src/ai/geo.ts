/** US state ↔ region mapping (matches the region hints in the onboarding UI). */
import type { Region } from "../types";

export const REGION_STATES: Readonly<Record<Exclude<Region, "other">, readonly string[]>> = {
  new_england: ["CT", "MA", "ME", "NH", "RI", "VT"],
  mid_atlantic: ["NY", "NJ", "PA", "DE", "MD", "DC"],
  south_atlantic: ["VA", "NC", "SC", "GA", "FL", "WV"],
  southeast: ["TN", "KY", "AL", "MS", "AR", "LA"],
  midwest: ["OH", "MI", "IN", "IL", "WI", "MN", "IA", "MO"],
  great_plains: ["ND", "SD", "NE", "KS"],
  southwest: ["TX", "OK", "NM", "AZ"],
  mountain: ["CO", "UT", "WY", "MT", "ID", "NV"],
  pacific: ["CA", "OR", "WA", "AK", "HI"],
};

export const REGION_LABELS: Readonly<Record<Region, string>> = {
  new_england: "New England",
  mid_atlantic: "Mid-Atlantic",
  south_atlantic: "South Atlantic",
  southeast: "Southeast",
  midwest: "Midwest",
  great_plains: "Great Plains",
  southwest: "Southwest",
  mountain: "Mountain West",
  pacific: "Pacific",
  other: "Other",
};

const STATE_TO_REGION = new Map<string, Region>();
for (const [region, states] of Object.entries(REGION_STATES)) for (const s of states) STATE_TO_REGION.set(s, region as Region);

export const STATE_NAMES: Readonly<Record<string, string>> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  PR: "Puerto Rico", GU: "Guam", VI: "U.S. Virgin Islands", AS: "American Samoa", MP: "Northern Mariana Islands",
};

const NAME_TO_CODE = new Map(Object.entries(STATE_NAMES).map(([code, name]) => [name.toLowerCase(), code]));

/** "nc", "N.C.", "North Carolina" → "NC"; unknown → null. */
export function stateCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  const compact = s.replace(/\./g, "").toUpperCase();
  if (compact.length === 2 && STATE_NAMES[compact]) return compact;
  return NAME_TO_CODE.get(s.toLowerCase().replace(/\s+/g, " ")) ?? null;
}

export function regionFromState(state: string | null | undefined): Region {
  return (state && STATE_TO_REGION.get(state.toUpperCase())) || "other";
}

export function stateName(code: string | null | undefined): string {
  return (code && STATE_NAMES[code.toUpperCase()]) || String(code ?? "");
}
