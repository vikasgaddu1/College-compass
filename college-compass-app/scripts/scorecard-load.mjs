#!/usr/bin/env node
/**
 * Load federal College Scorecard data into the shared Supabase database (no student data).
 *
 * Fetches every operating, predominantly bachelor's-degree, public or private nonprofit institution
 * from the College Scorecard API, maps it to `colleges` + `college_stats`, and upserts with the
 * project's service key (looked up through the Supabase Management API, never printed).
 *
 * Env:
 *   SCORECARD_API_KEY        api.data.gov key (free)
 *   SUPABASE_PROJECT_REF     e.g. abcd1234 (from https://abcd1234.supabase.co)
 *   SUPABASE_ACCESS_TOKEN    personal access token (Management API) — or SUPABASE_SERVICE_KEY directly
 *   DRY_RUN=1                fetch + map + report only, no writes
 *   LIMIT_PAGES=n            only the first n pages (testing)
 *
 * Writes a Markdown summary to $GITHUB_STEP_SUMMARY when set, including how many rows had each field,
 * so a renamed Scorecard field shows up as "0 of N" instead of silently loading nulls.
 */
import { appendFileSync } from "node:fs";

const API = "https://api.data.gov/ed/collegescorecard/v1/schools";
const KEY = process.env.SCORECARD_API_KEY;
const REF = process.env.SUPABASE_PROJECT_REF;
const DRY = process.env.DRY_RUN === "1";
const LIMIT_PAGES = Number(process.env.LIMIT_PAGES || 0);

/** Scorecard 2-digit CIP families → app major areas (share of bachelor's degrees awarded). */
export const PROGRAM_MAP = {
  computer: ["computer_science", "data_science"],
  engineering: ["engineering", "aerospace"],
  mathematics: ["math_stats"],
  physical_science: ["physical_sciences"],
  biological: ["biology"],
  health: ["health", "nursing", "public_health"],
  business_marketing: ["business"],
  social_science: ["economics_social", "political_science_law"],
  psychology: ["psychology"],
  communication: ["communication", "film_media"],
  english: ["english_humanities"],
  humanities: ["english_humanities"],
  visual_performing: ["arts_design", "performing_arts"],
  education: ["education"],
  resources: ["environmental_science"],
  architecture: ["architecture"],
  history: ["history_philosophy"],
  philosophy_religious: ["history_philosophy"],
  language: ["languages_international"],
  agriculture: ["agriculture_food"],
  parks_recreation_fitness: ["kinesiology_sports"],
  legal: ["political_science_law"],
  public_administration_social_service: ["political_science_law"],
};

const LOCALE = (code) => {
  const c = Number(code);
  if (c >= 11 && c <= 13) return "city";
  if (c >= 21 && c <= 23) return "suburb";
  if (c >= 31 && c <= 33) return "town";
  if (c >= 41 && c <= 43) return "rural";
  return null;
};
const OWNERSHIP = { 1: "public", 2: "private_nonprofit", 3: "private_forprofit" };
const INCOME = { "0-30000": "0_30k", "30001-48000": "30_48k", "48001-75000": "48_75k", "75001-110000": "75_110k", "110001-plus": "110k_plus" };

export const FIELDS = [
  "id", "school.name", "school.alias", "school.city", "school.state", "school.ownership", "school.school_url", "school.locale",
  "school.minority_serving.historically_black", "school.women_only", "school.religious_affiliation",
  "location.lat", "location.lon",
  "latest.student.size",
  "latest.admissions.admission_rate.overall",
  "latest.admissions.sat_scores.25th_percentile.critical_reading", "latest.admissions.sat_scores.25th_percentile.math",
  "latest.admissions.sat_scores.75th_percentile.critical_reading", "latest.admissions.sat_scores.75th_percentile.math",
  "latest.admissions.act_scores.25th_percentile.cumulative", "latest.admissions.act_scores.75th_percentile.cumulative",
  "latest.cost.tuition.in_state", "latest.cost.tuition.out_of_state", "latest.cost.attendance.academic_year",
  "latest.cost.avg_net_price.public", "latest.cost.avg_net_price.private",
  ...Object.keys(INCOME).flatMap((b) => [`latest.cost.net_price.public.by_income_level.${b}`, `latest.cost.net_price.private.by_income_level.${b}`]),
  "latest.completion.completion_rate_4yr_150nt",
  "latest.student.retention_rate.four_year.full_time",
  "latest.earnings.10_yrs_after_entry.median",
  ...Object.keys(PROGRAM_MAP).map((k) => `latest.academics.program_percentage.${k}`),
];

const num = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const int = (v) => (num(v) === null ? null : Math.round(num(v)));
const rate = (v) => {
  const n = num(v);
  return n === null || n < 0 || n > 1 ? null : Math.round(n * 10000) / 10000;
};
const sum2 = (a, b) => (num(a) === null || num(b) === null ? null : int(num(a) + num(b)));
const url = (u) => (!u ? null : /^https?:\/\//i.test(u) ? u : `https://${String(u).replace(/^\/+/, "")}`);

/** Map one Scorecard API result (dotted keys) to { college, stats }. Exported for tests. */
export function mapSchool(r, fetchedYear) {
  const own = OWNERSHIP[r["school.ownership"]] ?? null;
  const pub = own === "public";
  const aliases = String(r["school.alias"] ?? "")
    .split(/[|,;]/)
    .map((s) => s.trim())
    .filter((s) => s && s.length <= 80);
  const college = {
    unitid: String(r.id),
    name: String(r["school.name"]).trim(),
    aliases: Array.from(new Set(aliases)),
    city: r["school.city"] ?? null,
    state: r["school.state"] ?? null,
    lat: num(r["location.lat"]),
    lon: num(r["location.lon"]),
    ownership: own,
    locale: LOCALE(r["school.locale"]),
    url: url(r["school.school_url"]),
    undergrad_size: int(r["latest.student.size"]),
    hbcu: Number(r["school.minority_serving.historically_black"]) === 1,
    women_only: Number(r["school.women_only"]) === 1,
    religious: num(r["school.religious_affiliation"]) !== null && Number(r["school.religious_affiliation"]) > 0,
    updated_at: new Date().toISOString(),
  };
  const side = pub ? "public" : "private";
  const npi = {};
  for (const [band, key] of Object.entries(INCOME)) npi[key] = int(r[`latest.cost.net_price.${side}.by_income_level.${band}`]);
  const share = {};
  for (const [cip, areas] of Object.entries(PROGRAM_MAP)) {
    const v = rate(r[`latest.academics.program_percentage.${cip}`]);
    if (v === null || v === 0) continue;
    for (const a of areas) share[a] = Math.round(((share[a] ?? 0) + v) * 10000) / 10000;
  }
  const stats = {
    unitid: college.unitid,
    source: "scorecard",
    data_year: `College Scorecard (fetched ${fetchedYear})`,
    admit_rate: rate(r["latest.admissions.admission_rate.overall"]),
    sat_25: sum2(r["latest.admissions.sat_scores.25th_percentile.critical_reading"], r["latest.admissions.sat_scores.25th_percentile.math"]),
    sat_75: sum2(r["latest.admissions.sat_scores.75th_percentile.critical_reading"], r["latest.admissions.sat_scores.75th_percentile.math"]),
    act_25: int(r["latest.admissions.act_scores.25th_percentile.cumulative"]),
    act_75: int(r["latest.admissions.act_scores.75th_percentile.cumulative"]),
    tuition_in_state: int(r["latest.cost.tuition.in_state"]),
    tuition_out_of_state: int(r["latest.cost.tuition.out_of_state"]),
    // Scorecard's cost of attendance uses in-state tuition at publics.
    cost_of_attendance: int(r["latest.cost.attendance.academic_year"]),
    cost_of_attendance_basis: pub ? "in_state" : "same",
    avg_net_price: int(r[`latest.cost.avg_net_price.${side}`]),
    net_price_by_income: npi,
    grad_rate_6yr: rate(r["latest.completion.completion_rate_4yr_150nt"]),
    retention_rate: rate(r["latest.student.retention_rate.four_year.full_time"]),
    median_earnings_10yr: int(r["latest.earnings.10_yrs_after_entry.median"]),
    program_share: share,
    fetched_at: new Date().toISOString(),
    stale_after: new Date(Date.now() + 395 * 864e5).toISOString(),
  };
  return { college, stats };
}

async function getJson(u, init = {}, tries = 4) {
  for (let i = 0; ; i++) {
    const res = await fetch(u, init);
    if (res.ok) return res.json();
    const body = (await res.text()).slice(0, 300);
    if (i < tries - 1 && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
      continue;
    }
    throw new Error(`${res.status} ${new URL(u).host}${new URL(u).pathname}: ${body}`);
  }
}

async function fetchScorecard() {
  const base = new URLSearchParams({
    api_key: KEY,
    "school.degrees_awarded.predominant": "3",
    "school.operating": "1",
    "school.ownership": "1,2",
    fields: FIELDS.join(","),
    per_page: "100",
  });
  const out = [];
  for (let page = 0; ; page++) {
    base.set("page", String(page));
    const j = await getJson(`${API}?${base}`);
    out.push(...(j.results ?? []));
    const total = j.metadata?.total ?? 0;
    if (!j.results?.length || out.length >= total || (LIMIT_PAGES && page + 1 >= LIMIT_PAGES)) {
      return { rows: out, total };
    }
  }
}

async function serviceKey() {
  if (process.env.SUPABASE_SERVICE_KEY) return process.env.SUPABASE_SERVICE_KEY;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token || !REF) throw new Error("Need SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF (or SUPABASE_SERVICE_KEY).");
  const keys = await getJson(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${token}` } });
  const legacy = keys.find((k) => k.name === "service_role" && k.api_key);
  const secret = keys.find((k) => k.type === "secret" && k.api_key);
  const key = (legacy ?? secret)?.api_key;
  if (!key) throw new Error("No service_role/secret key returned by the Management API.");
  return key;
}

async function upsert(table, rows, key, conflict) {
  const base = `https://${REF}.supabase.co/rest/v1/${table}?on_conflict=${conflict}`;
  const headers = { apikey: key, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`; // legacy JWT service_role
  for (let i = 0; i < rows.length; i += 500) {
    const res = await fetch(base, { method: "POST", headers, body: JSON.stringify(rows.slice(i, i + 500)) });
    if (!res.ok) throw new Error(`${table} upsert ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

function report(lines) {
  const text = lines.join("\n");
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + "\n");
}

async function main() {
  if (!KEY) throw new Error("SCORECARD_API_KEY is not set.");
  const { rows, total } = await fetchScorecard();
  const year = new Date().toISOString().slice(0, 7);
  const mapped = rows.map((r) => mapSchool(r, year)).filter((m) => m.college.name && m.college.unitid);

  // Field coverage: catches renamed/removed Scorecard fields.
  const coverage = FIELDS.filter((f) => f !== "id").map((f) => [f, rows.filter((r) => r[f] !== null && r[f] !== undefined && r[f] !== "").length]);
  const missing = coverage.filter(([, n]) => n === 0).map(([f]) => f);
  const lines = [
    `### College Scorecard load${DRY ? " (dry run)" : ""}`,
    `Fetched ${rows.length} of ${total} institutions (operating, predominantly bachelor's, public/private nonprofit).`,
    "",
    "| field | rows with a value |",
    "|---|---|",
    ...coverage.map(([f, n]) => `| \`${f}\` | ${n} |`),
  ];
  if (missing.length) lines.push("", `**No values at all for:** ${missing.map((f) => `\`${f}\``).join(", ")} — check the Scorecard data dictionary for renamed fields.`);
  const sample = mapped.find((m) => m.college.name.startsWith("Duke")) ?? mapped[0];
  if (sample) lines.push("", "Sample row:", "```json", JSON.stringify(sample, null, 1).slice(0, 2500), "```");

  if (!DRY) {
    const key = await serviceKey();
    await upsert("colleges", mapped.map((m) => m.college), key, "unitid");
    await upsert("college_stats", mapped.map((m) => m.stats), key, "unitid,source");
    lines.push("", `Upserted ${mapped.length} colleges and their Scorecard stats into Supabase project \`${REF}\`.`);
  }
  report(lines);
  // A load where key admissions/cost fields are entirely empty is a mapping failure, not data.
  if (["latest.admissions.admission_rate.overall", "latest.cost.tuition.in_state", "school.name"].some((f) => missing.includes(f))) process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
