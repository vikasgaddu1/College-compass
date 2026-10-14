import { useState, useMemo } from "react";
import { Link } from "wouter";
import { schools } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import { NoteButton, AbetBadge } from "@/components/SchoolBits";
import roboticsPaths from "@/data/robotics_paths.json";
import roboticsRoutes from "@/data/robotics_routes.json";
import { Bot, ExternalLink, Search, Filter, Cog, Cpu, Wrench, Trophy, Download, Building2, AlertTriangle, Info, ShieldCheck, HelpCircle } from "lucide-react";

type Row = typeof roboticsPaths.schools[keyof typeof roboticsPaths.schools];
type ApplicationRoute = {
  recommended_route: "bs_robotics" | "ece" | "cs";
  recommended_summary: string;
  site_degree: string;
  alternative: string;
  tradeoff: string;
  verified_on?: string;
  verification_note?: string;
  ece: { entry: string; url: string };
  cs: { entry: string; url: string };
};
const ROUTES = roboticsRoutes.schools as unknown as Record<string, ApplicationRoute>;
const routeLabels = { bs_robotics: "Primary robotics degree", ece: "ECE route", cs: "CS route" };

export default function RoboticsPathsPage() {
  const { hidden } = useHidden();
  const [q, setQ] = useState("");
  const [routeFilter, setRouteFilter] = useState<keyof typeof routeLabels | "all">("all");
  const [onlyMechatronics, setOnlyMechatronics] = useState(false);

  const visible = useMemo(() => schools
    .filter(s => !hidden.has(s.slug))
    .map(s => ({ s, d: (roboticsPaths.schools as Record<string, Row>)[s.slug], r: ROUTES[s.slug] }))
    .filter(x => !!x.d && !!x.r), [hidden]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return visible.filter(({ s, d, r }) => {
      if (routeFilter !== "all" && r.recommended_route !== routeFilter) return false;
      const extra = d as Row & { has_mechatronics_bs?: boolean; has_mechatronics_track?: boolean };
      if (onlyMechatronics && !(extra.has_mechatronics_bs || extra.has_mechatronics_track)) return false;
      return !needle || `${s.short} ${r.site_degree} ${r.recommended_summary} ${d.me_robotics_track_name || ""} ${d.ecs_robotics_alt || ""}`.toLowerCase().includes(needle);
    });
  }, [visible, q, routeFilter, onlyMechatronics]);
  const bsCount = visible.filter(({ r }) => r.recommended_route === "bs_robotics").length;
  const eceCount = visible.filter(({ r }) => r.recommended_route === "ece").length;

  const download = (content: string, extension: string, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `college-compass-application-routes-${new Date().toISOString().slice(0, 10)}.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const exportJSON = () => download(JSON.stringify({
    exported_at: new Date().toISOString(),
    research_snapshot: roboticsPaths.compiled_date,
    note: roboticsPaths.note,
    schools: rows.map(({ s, d, r }) => ({ slug: s.slug, name: s.name, ...d, recommended_degree: r.site_degree, recommended_route: r.recommended_route, recommendation: r.recommended_summary, ece_entry: r.ece.entry, cs_entry: r.cs.entry, verified_on: r.verified_on, verification_note: r.verification_note })),
  }, null, 2), "json", "application/json");
  const exportMarkdown = () => download([
    `# Robotics application routes — ${rows.length} selected schools`,
    `Research snapshot: ${roboticsPaths.compiled_date}. Admission structure does not establish an applicant’s admission probability.`,
    ...rows.flatMap(({ s, d, r }) => [
      `\n## ${s.short}`, `**Recommended degree:** ${r.site_degree}`, r.recommended_summary,
      `**ECE entry:** ${r.ece.entry} [Official source](${r.ece.url})`, `**CS entry:** ${r.cs.entry} [Official source](${r.cs.url})`, `**Trade-off:** ${r.tradeoff}`,
      `**ME comparison:** ${d.me_robotics_track_name || "No named ME robotics track verified"}`,
      `**Research snapshot:** ${r.verified_on || "See recorded source dates"}. ${r.verification_note || ""}`,
    ]),
  ].join("\n\n"), "md", "text/markdown");
  const exportCSV = () => {
    const records = rows.map(({ s, d, r }) => ({ slug: s.slug, school: s.name, ...d, recommended_degree: r.site_degree, recommended_route: r.recommended_route, recommendation: r.recommended_summary, ece_entry: r.ece.entry, ece_source: r.ece.url, cs_entry: r.cs.entry, cs_source: r.cs.url, tradeoff: r.tradeoff, verified_on: r.verified_on, verification_note: r.verification_note }));
    const fields = Array.from(new Set(records.flatMap(record => Object.keys(record))));
    const escape = (v: unknown) => {
      const text = Array.isArray(v) ? v.join("; ") : v !== null && typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
      return `"${text.replace(/"/g, '""')}"`;
    };
    download([fields.map(escape).join(","), ...records.map(record => fields.map(field => escape((record as Record<string, unknown>)[field])).join(","))].join("\n"), "csv", "text/csv");
  };

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex items-baseline gap-2 text-[hsl(var(--accent))]"><Bot size={16} /><div className="text-[11px] tracking-wider uppercase">Application routes</div></div>
        <h2 className="serif text-[22px] font-semibold mt-1">ECE and CS entry gates for robotics</h2>
        <p className="text-[13.5px] text-[hsl(var(--muted-foreground))] mt-2 leading-relaxed max-w-[860px]">
          Start with the recommended robotics degree, then check how a first-year reaches the major. This page separates initial admission from later declaration, transfer and capacity limits for Fall 2027 entry by a North Carolina resident. A different entry process does not establish easier admission. See <Link href="/routes" className="underline">Robotics routes</Link> for undergraduate hardware, controls and AI course choices.
        </p>
        <div className="mt-4 flex flex-wrap gap-4 text-[12.5px]">
          <div><span className="num text-[18px] font-semibold text-[hsl(var(--fit-strong))]">{bsCount}</span> primary robotics degree routes</div>
          <div><span className="num text-[18px] font-semibold text-[hsl(var(--accent))]">{eceCount}</span> recommended ECE routes</div>
          <div className="text-[hsl(var(--muted-foreground))]">{visible.length} visible schools · snapshot {roboticsPaths.compiled_date}</div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 items-center">
          <span className="text-[11px] text-[hsl(var(--muted-foreground))]">Export {rows.length} shown schools:</span>
          <button onClick={exportJSON} className="chip chip-outline inline-flex items-center gap-1"><Download size={11} /> JSON</button>
          <button onClick={exportCSV} className="chip chip-outline inline-flex items-center gap-1"><Download size={11} /> CSV</button>
          <button onClick={exportMarkdown} className="chip chip-outline inline-flex items-center gap-1"><Download size={11} /> Markdown</button>
        </div>
      </div>

      <div className="card p-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
          <input aria-label="Search application routes" value={q} onChange={e => setQ(e.target.value)} className="w-full pl-8 pr-2 py-1.5 text-[13px] rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))]" placeholder="Search school, degree or route…" />
        </div>
        <select aria-label="Recommended degree route" value={routeFilter} onChange={e => setRouteFilter(e.target.value as typeof routeFilter)} className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-1.5 text-[12px]">
          <option value="all">All recommended routes</option>
          {Object.entries(routeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-[12px] cursor-pointer"><input type="checkbox" checked={onlyMechatronics} onChange={e => setOnlyMechatronics(e.target.checked)} /> Has a mechatronics comparison</label>
        <div className="text-[11px] text-[hsl(var(--muted-foreground))] flex items-center gap-1"><Filter size={11} />{rows.length} shown</div>
      </div>
      <div className="space-y-3">
        {rows.map(({ s, d }) => <RoboticsPathCard key={s.slug} school={s} data={d} />)}
        {rows.length === 0 && <div className="card p-4 text-[12px] text-[hsl(var(--muted-foreground))]">No schools match these filters.</div>}
      </div>
      <details className="card p-4">
        <summary className="cursor-pointer text-[12px] font-medium">Compare research domains and degree accreditation</summary>
        <div className="mt-4 space-y-4"><AccreditationPanel /><DomainMatrix /></div>
      </details>
      <div className="card p-3 text-[11px] text-[hsl(var(--muted-foreground))] leading-relaxed">
        Research snapshot: {roboticsPaths.compiled_date}. Source-specific checks and inaccessible pages are recorded with each school’s research. Aggregate early-round rates describe different applicant pools and do not measure the benefit of applying early. Course prerequisites, major access and minor admission need separate planning.
      </div>
    </div>
  );
}

function RoboticsPathCard({ school, data }: { school: typeof schools[number]; data: Row }) {
  const hasBS = data.has_bs_robotics?.startsWith("Yes");
  const hasME = !!data.me_robotics_track_name;
  const route = ROUTES[school.slug];

  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h3 className="serif text-[16.5px] font-semibold">{school.short}</h3>
          <AbetBadge credential={school.robotics_credential} />
          <div className="text-[11.5px] text-[hsl(var(--muted-foreground))]">{school.city_state}</div>
          <NoteButton slug={school.slug}/>
        </div>
        {route && <span className="chip chip-outline">{routeLabels[route.recommended_route]}</span>}
      </div>

      {route && <div className="mb-3 rounded-md border border-[hsl(var(--accent)/0.25)] bg-[hsl(var(--accent)/0.06)] p-3 text-[12px] leading-relaxed">
        <div className="text-[10.5px] uppercase tracking-wider font-medium mb-1">Recommended robotics degree</div>
        <div className="font-medium text-[13px]">{route.site_degree}</div>
        <div className="text-[hsl(var(--muted-foreground))] mt-1">{route.recommended_summary}</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <div><a href={route.ece.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">ECE entry <ExternalLink size={10} className="inline" /></a><div className="text-[hsl(var(--muted-foreground))] mt-0.5">{route.ece.entry}</div></div>
          <div><a href={route.cs.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">CS entry <ExternalLink size={10} className="inline" /></a><div className="text-[hsl(var(--muted-foreground))] mt-0.5">{route.cs.entry}</div></div>
        </div>
        <div className="mt-2"><span className="font-medium">Access caution: </span>{route.tradeoff}</div>
        {(route.verified_on || route.verification_note) && <div className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">{route.verified_on ? `Research snapshot: ${route.verified_on}. ` : ""}{route.verification_note}</div>}
        <Link href={`/routes#route-${school.slug}`} className="inline-block mt-2 text-[11px] underline">Undergraduate robotics and AI courses</Link>
      </div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Path 1: Dedicated BS Robotics */}
        <div className={`rounded-md p-3 ${hasBS ? "bg-[hsl(var(--fit-strong)/0.08)] border border-[hsl(var(--fit-strong)/0.25)]" : "bg-[hsl(var(--elevate-1))]"}`}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Bot size={13} className={hasBS ? "text-[hsl(var(--fit-strong))]" : "text-[hsl(var(--muted-foreground))]"}/>
            <div className="text-[10.5px] uppercase tracking-wider font-medium">Dedicated BS Robotics</div>
          </div>
          {hasBS ? (
            <>
              <div className="text-[13px] font-medium leading-tight mb-1">{data.bs_robotics_name}</div>
              <div className="flex flex-wrap gap-1.5 text-[10.5px] mb-1">
                {data.bs_robotics_admit && (
                  data.bs_robotics_admit === "Not published"
                    ? <span className="chip chip-outline text-[hsl(var(--muted-foreground))]" title="The school does not publish how you get into this major">Admit path not published</span>
                    : <span className="chip chip-outline">{data.bs_robotics_admit} admit</span>
                )}
                {data.bs_robotics_year_started && <span className="chip chip-outline">Est. {data.bs_robotics_year_started}</span>}
                {data.bs_robotics_size && (
                  <span className="chip chip-outline">
                    {typeof data.bs_robotics_size === "number" ? `${data.bs_robotics_size} majors` : `${data.bs_robotics_size} majors`}
                  </span>
                )}
              </div>
              {data.bs_robotics_url && (
                <a href={data.bs_robotics_url} target="_blank" rel="noopener"
                  className="text-[10.5px] text-[hsl(var(--accent))] hover:underline inline-flex items-center gap-0.5 mt-1">
                  Program page <ExternalLink size={9}/>
                </a>
              )}
            </>
          ) : (
            <div className="text-[12px] text-[hsl(var(--muted-foreground))] italic">No dedicated BS in Robotics.</div>
          )}
        </div>

        {/* Path 2: ME + Robotics track */}
        <div className={`rounded-md p-3 ${hasME ? "bg-[hsl(var(--accent)/0.08)] border border-[hsl(var(--accent)/0.25)]" : "bg-[hsl(var(--elevate-1))]"}`}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Wrench size={13} className={hasME ? "text-[hsl(var(--accent))]" : "text-[hsl(var(--muted-foreground))]"}/>
            <div className="text-[10.5px] uppercase tracking-wider font-medium">ME + Robotics track</div>
          </div>
          {hasME ? (
            <>
              <div className="text-[13px] font-medium leading-tight mb-1">{data.me_robotics_track_name}</div>
              {data.me_robotics_courses && data.me_robotics_courses.length > 0 && (
                <div className="text-[11px] text-[hsl(var(--muted-foreground))] leading-snug mb-1">
                  Courses: {data.me_robotics_courses.slice(0, 4).join(" · ")}
                </div>
              )}
              {data.me_robotics_url && (
                <a href={data.me_robotics_url} target="_blank" rel="noopener"
                  className="text-[10.5px] text-[hsl(var(--accent))] hover:underline inline-flex items-center gap-0.5 mt-1">
                  Track page <ExternalLink size={9}/>
                </a>
              )}
            </>
          ) : (
            <div className="text-[12px] text-[hsl(var(--muted-foreground))] italic">No formal ME + Robotics track.</div>
          )}
        </div>

        {/* Path 3: Alternative + reason */}
        <div className="rounded-md p-3 bg-[hsl(var(--elevate-1))]">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Cpu size={13} className="text-[hsl(var(--muted-foreground))]"/>
            <div className="text-[10.5px] uppercase tracking-wider font-medium">Other routes & comparisons</div>
          </div>
          <div className="text-[12px] leading-snug">{data.ecs_robotics_alt || "n.a."}</div>
        </div>
      </div>

      {data.robotics_easier_than_cs_reason && (
        <div className="mt-3 pt-2 border-t border-[hsl(var(--border))]">
          <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-0.5">Entry structure and comparison limits</div>
          <div className="text-[12px] italic leading-snug">{data.robotics_easier_than_cs_reason}</div>
        </div>
      )}

      {/* NEW: admissions-strategy panel */}
      {(data as any).admission_strategy && (
        <div className="mt-3 rounded-md bg-[hsl(var(--accent)/0.06)] border border-[hsl(var(--accent)/0.2)] p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <ShieldCheck size={12} className="text-[hsl(var(--accent))]"/>
            <div className="text-[10.5px] uppercase tracking-wider font-medium text-[hsl(var(--accent))]">Admissions strategy</div>
          </div>
          <div className="text-[12px] leading-snug mb-2 italic">{(data as any).admission_strategy}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
            <DifferentialCell
              label="Initial university / college entry"
              verdict={(data as any).university_admit_differential}
              reason={(data as any).university_admit_differential_reason}
              source={(data as any).university_admit_differential_source}
            />
            <DifferentialCell
              label="Later major access / internal gate"
              verdict={(data as any).internal_gate_differential}
              reason={(data as any).internal_gate_differential_reason}
              source={(data as any).internal_gate_differential_source}
            />
          </div>
        </div>
      )}

      {/* NEW: Mechatronics panel */}
      {((data as any).has_mechatronics_bs || (data as any).has_mechatronics_track) && (
        <div className="mt-3 rounded-md bg-[hsl(var(--fit-top)/0.06)] border border-[hsl(var(--fit-top)/0.25)] p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Cog size={12} className="text-[hsl(var(--fit-top))]"/>
            <div className="text-[10.5px] uppercase tracking-wider font-medium text-[hsl(var(--fit-top))]">Mechatronics route</div>
          </div>
          {(data as any).has_mechatronics_bs && (data as any).mechatronics_bs_name && (
            <div className="mb-1.5">
              <div className="text-[12.5px] font-medium leading-tight">{(data as any).mechatronics_bs_name}</div>
              {(data as any).mechatronics_bs_url && (
                <a href={(data as any).mechatronics_bs_url} target="_blank" rel="noopener"
                  className="text-[10px] text-[hsl(var(--accent))] hover:underline inline-flex items-center gap-0.5">Program page <ExternalLink size={8}/></a>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11.5px]">
            <div>
              <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Entry vs ME: </span>
              <MechaBadge kind="admit" v={(data as any).mechatronics_admit_vs_me}/>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Robotics fit: </span>
              <MechaBadge kind="advantage" v={(data as any).mechatronics_advantage_verdict}/>
            </div>
          </div>
          {(data as any).mechatronics_summary && (
            <div className="text-[11.5px] leading-snug mt-2 italic text-[hsl(var(--muted-foreground))]">{(data as any).mechatronics_summary}</div>
          )}
          {(data as any).mechatronics_source && (
            <a href={(data as any).mechatronics_source} target="_blank" rel="noopener"
              className="text-[10px] text-[hsl(var(--accent))] hover:underline inline-flex items-center gap-0.5 mt-1">source <ExternalLink size={8}/></a>
          )}
        </div>
      )}

      {/* NEW: three broader strategy dimensions */}
      {((data as any).early_admit_lift_verdict || (data as any).oos_gap_verdict || (data as any).robotics_ecosystem_tier) && (
        <div className="mt-3 rounded-md bg-[hsl(var(--fit-strong)/0.05)] border border-[hsl(var(--fit-strong)/0.2)] p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Trophy size={12} className="text-[hsl(var(--fit-strong))]"/>
            <div className="text-[10.5px] uppercase tracking-wider font-medium text-[hsl(var(--fit-strong))]">Application context</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <StrategyLever
              label="Published early-round context"
              verdict={(data as any).early_admit_lift_verdict}
              reason={(data as any).early_admit_lift_reason}
              extra={(data as any).best_early_deadline}
              source={(data as any).early_admit_lift_source}
              scheme="early"
            />
            <StrategyLever
              label="NC residency"
              verdict={(data as any).oos_gap_verdict}
              reason={(data as any).nc_applicant_note}
              extra={(data as any).oos_gap_reason}
              source={(data as any).oos_gap_source}
              scheme="oos"
            />
            <StrategyLever
              label="Robotics ecosystem"
              verdict={(data as any).robotics_ecosystem_tier}
              reason={(data as any).robotics_ecosystem_reason}
              extra={(data as any).coop_pipeline}
              source={(data as any).robotics_ecosystem_source}
              scheme="tier"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// -------------------- Differential verdict cell --------------------

const verdictLabels: Record<string, string> = {
  "YES-MATERIAL":  "Different entry requirements",
  "YES-MODEST":    "Some entry differences",
  "SAME":          "Shared entry structure",
  "MORE_GATED":    "Additional major-access gate",
  "NOT_PUBLISHED": "Not published",
  "N/A":           "Not applicable",
  "DIFFERENT_STRUCTURE": "Different entry structure",
  "MAJOR_DEPENDENT": "Major-specific capacity / review",
};

const verdictClass: Record<string, string> = {
  "YES-MATERIAL":  "chip-primary",
  "YES-MODEST":    "chip-accent",
  "SAME":          "chip-outline",
  "MORE_GATED":    "chip-outline",
  "NOT_PUBLISHED": "chip-outline",
  "N/A":           "chip-outline",
};

const verdictColor: Record<string, string> = {
  "YES-MATERIAL":  "hsl(145 55% 35%)",
  "YES-MODEST":    "hsl(30 60% 40%)",
  "SAME":          "hsl(0 0% 50%)",
  "MORE_GATED":    "hsl(0 60% 45%)",
  "NOT_PUBLISHED": "hsl(0 0% 55%)",
  "N/A":           "hsl(0 0% 55%)",
};

// -------------------- Mechatronics badge --------------------

function MechaBadge({ kind, v }: { kind: "admit" | "advantage"; v: string | undefined }) {
  if (!v) return <span className="chip chip-outline text-[10.5px] py-0">Not specified</span>;
  let label = v;
  let color = "hsl(0 0% 50%)";
  if (kind === "admit") {
    label = v === "EASIER-MATERIAL" ? "Different entry requirements" :
            v === "EASIER-MODEST"   ? "Some entry differences" :
            v === "SAME"            ? "Shared entry process with ME" :
            v === "HARDER"          ? "Additional entry gate" :
            v === "NOT_PUBLISHED"   ? "Not published" : v === "DIFFERENT_STRUCTURE" ? "Different campus / entry route" : "N/A";
    color = v === "EASIER-MATERIAL" ? "hsl(145 55% 35%)" : v === "EASIER-MODEST" ? "hsl(30 60% 40%)" : v === "HARDER" ? "hsl(0 60% 45%)" : "hsl(0 0% 50%)";
  } else {
    label = v === "STRONG_ROBOTICS_FIT" ? "Better fit than ME for robotics" :
            v === "COMPARABLE"          ? "Comparable to ME" :
            v === "WEAKER_THAN_ME"      ? "Weaker than ME" : "N/A";
    color = v === "STRONG_ROBOTICS_FIT" ? "hsl(145 55% 35%)" : v === "WEAKER_THAN_ME" ? "hsl(0 60% 45%)" : "hsl(0 0% 50%)";
  }
  return <span className="chip chip-outline text-[10.5px] py-0" style={{ color }}>{label}</span>;
}

// -------------------- Strategy lever cell (early / oos / tier) --------------------

const earlyLabels: Record<string, string> = {
  LARGE: "Higher published early-round rate",
  MODERATE: "Higher published early-round rate",
  SMALL: "Small published rate difference",
  NONE: "No early plan or rate advantage established",
  NOT_PUBLISHED: "School doesn't publish",
};
const oosLabels: Record<string, string> = {
  MASSIVE: "NC applicant faces massive OOS gap",
  LARGE: "NC applicant faces large OOS gap",
  MODERATE: "NC applicant faces moderate OOS gap",
  SMALL: "Near residency parity",
  NONE: "No residency preference",
  NOT_PUBLISHED: "Split not published",
};
const tierLabels: Record<string, string> = {
  TIER_1: "Tier 1 — world-class robotics research",
  TIER_2: "Tier 2 — strong robotics depth",
  TIER_3: "Tier 3 — solid, mid-size ecosystem",
  TIER_4: "Tier 4 — limited robotics research",
};

function StrategyLever({ label, verdict, reason, extra, source, scheme }: {
  label: string; verdict: string | undefined; reason: string | undefined; extra: string | undefined; source: string | undefined; scheme: "early" | "oos" | "tier";
}) {
  if (!verdict) return null;
  const labels = scheme === "early" ? earlyLabels : scheme === "oos" ? oosLabels : tierLabels;
  // For NC-applicant advantage (from perspective of a NC student), MASSIVE/LARGE OOS gap is BAD except at NC schools where it's an advantage — we override that below via a smart label
  let displayLabel = labels[verdict] || verdict;
  let color = "hsl(0 0% 50%)";
  if (scheme === "early") {
    color = verdict === "LARGE" ? "hsl(145 55% 35%)" : verdict === "MODERATE" ? "hsl(30 60% 40%)" : verdict === "SMALL" ? "hsl(30 40% 55%)" : "hsl(0 0% 55%)";
  } else if (scheme === "oos") {
    // NC advantage detection
    if ((reason || "").includes("MAJOR ADVANTAGE") || (reason || "").includes("friendliest")) {
      displayLabel = "NC residency = MAJOR advantage";
      color = "hsl(145 60% 32%)";
    } else {
      color = verdict === "MASSIVE" ? "hsl(0 60% 45%)" : verdict === "LARGE" ? "hsl(0 50% 50%)" : verdict === "MODERATE" ? "hsl(30 60% 40%)" : verdict === "SMALL" ? "hsl(30 40% 55%)" : "hsl(0 0% 55%)";
    }
  } else if (scheme === "tier") {
    color = verdict === "TIER_1" ? "hsl(145 55% 35%)" : verdict === "TIER_2" ? "hsl(30 60% 40%)" : verdict === "TIER_3" ? "hsl(0 0% 45%)" : "hsl(0 0% 55%)";
  }
  return (
    <div className="rounded bg-[hsl(var(--card))] p-2 border border-[hsl(var(--border))]">
      <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-0.5">{label}</div>
      <span className="chip chip-outline inline-flex items-center gap-1 text-[10.5px] py-0" style={{ color }}>
        {displayLabel}
      </span>
      {reason && <div className="text-[11px] leading-snug text-[hsl(var(--muted-foreground))] mt-1">{reason}</div>}
      {extra && <div className="text-[10.5px] leading-snug text-[hsl(var(--muted-foreground))] mt-0.5 italic">{extra}</div>}
      {source && (
        <a href={source} target="_blank" rel="noopener" className="text-[10px] text-[hsl(var(--accent))] hover:underline inline-flex items-center gap-0.5 mt-1">
          source <ExternalLink size={8}/>
        </a>
      )}
    </div>
  );
}

function DifferentialCell({ label, verdict, reason, source }: {
  label: string; verdict: string | undefined; reason: string | undefined; source: string | undefined;
}) {
  if (!verdict) return null;
  return (
    <div className="rounded bg-[hsl(var(--card))] p-2 border border-[hsl(var(--border))]">
      <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-0.5">{label}</div>
      <span className={`chip ${verdictClass[verdict] || "chip-outline"} inline-flex items-center gap-1 text-[10.5px] py-0`}
        style={{ color: verdictColor[verdict] }}>
        {verdictLabels[verdict] || verdict}
      </span>
      {reason && (
        <div className="text-[11px] leading-snug text-[hsl(var(--muted-foreground))] mt-1">{reason}</div>
      )}
      {source && (
        <a href={source} target="_blank" rel="noopener"
          className="text-[10px] text-[hsl(var(--accent))] hover:underline inline-flex items-center gap-0.5 mt-1">
          source <ExternalLink size={8}/>
        </a>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Robotics subdomain coverage matrix
 * Research signals for the selected schools. Coverage is strong / present /
 * none, each cell carrying the lab or course that evidences it.
 * ------------------------------------------------------------------ */

const RD_DOMAINS: { key: string; label: string; short: string }[] = [
  { key: "humanoid_legged",       label: "Humanoid / legged",      short: "Humanoid" },
  { key: "swarm_multirobot",      label: "Swarm / multi-robot",    short: "Swarm" },
  { key: "autonomous_vehicles",   label: "Autonomous vehicles",    short: "AV" },
  { key: "manipulation_grasping", label: "Manipulation / grasping",short: "Manip." },
  { key: "aerial_uav",            label: "Aerial / UAV",           short: "UAV" },
  { key: "medical_surgical",      label: "Medical / surgical",     short: "Medical" },
  { key: "soft_robotics",         label: "Soft robotics",          short: "Soft" },
  { key: "hri",                   label: "Human-robot interaction",short: "HRI" },
  { key: "industrial_automation", label: "Industrial automation",  short: "Industrial" },
  { key: "space_field",           label: "Space / field",          short: "Space" },
];

function DomainMatrix() {
  const { hidden } = useHidden();
  const [focus, setFocus] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<string>("_breadth");

  const rows = useMemo(() => {
    return schools
      .filter(s => !hidden.has(s.slug) && s.robotics_domains)
      .map(s => {
        const dom = s.robotics_domains!;
        const strong = RD_DOMAINS.filter(d => dom[d.key]?.coverage === "strong").length;
        const present = RD_DOMAINS.filter(d => dom[d.key]?.coverage === "present").length;
        return {
          slug: s.slug, short: s.short, dom, strong, present,
          breadth: strong * 2 + present,
          curr: s.axes.robotics_curriculum ?? 0,
          access: s.axes.robotics_access ?? 0,
        };
      })
      .sort((a, b) => {
        if (sortKey === "_breadth") return b.breadth - a.breadth || a.short.localeCompare(b.short);
        if (sortKey === "_curr") return b.curr - a.curr || a.short.localeCompare(b.short);
        if (sortKey === "_access") return b.access - a.access || a.short.localeCompare(b.short);
        // sort by a specific domain: strong > present > none
        const rank = (r: typeof a) => {
          const c = r.dom[sortKey]?.coverage;
          return c === "strong" ? 2 : c === "present" ? 1 : 0;
        };
        return rank(b) - rank(a) || a.short.localeCompare(b.short);
      });
  }, [hidden, sortKey]);

  // Column totals across the visible rows
  const totals = useMemo(() => Object.fromEntries(RD_DOMAINS.map(d => [
    d.key,
    {
      strong: rows.filter(r => r.dom[d.key]?.coverage === "strong").length,
      present: rows.filter(r => r.dom[d.key]?.coverage === "present").length,
    },
  ])), [rows]);

  const cellStyle = (cov?: string) =>
    cov === "strong"
      ? { background: "hsl(var(--fit-strong) / 0.85)" }
      : cov === "present"
        ? { background: "hsl(var(--fit-strong) / 0.28)" }
        : { background: "transparent" };

  return (
    <div className="card p-5">
      <div className="flex items-baseline gap-2 text-[hsl(var(--accent))]">
        <Cpu size={15}/>
        <div className="text-[11px] tracking-wider uppercase">Robotics subdomain coverage</div>
      </div>
      <h3 className="serif text-[19px] font-semibold mt-1">Which schools actually work on the robotics you care about</h3>
      <p className="text-[13px] text-[hsl(var(--muted-foreground))] mt-1.5 leading-relaxed max-w-[820px]">
        Ten subdomains, researched per school from department, lab and catalog pages.
        <strong className="text-[hsl(var(--foreground))]"> Strong</strong> means a named lab, center or course sequence dedicated to it.
        <strong className="text-[hsl(var(--foreground))]"> Present</strong> means it appears in a lab's stated work or a course, without dedicated infrastructure.
        Blank means nothing published was found. Hover any cell for the evidence; click a column heading to sort by it.
      </p>

      <div className="flex flex-wrap items-center gap-3 mt-3 text-[11.5px]">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3.5 h-3.5 rounded-sm" style={cellStyle("strong")}/>
          <span className="text-[hsl(var(--muted-foreground))]">Strong</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3.5 h-3.5 rounded-sm" style={cellStyle("present")}/>
          <span className="text-[hsl(var(--muted-foreground))]">Present</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3.5 h-3.5 rounded-sm border border-[hsl(var(--border))]"/>
          <span className="text-[hsl(var(--muted-foreground))]">None found</span>
        </div>
        {sortKey !== "_breadth" && (
          <button className="chip chip-outline" onClick={()=>setSortKey("_breadth")}>Reset sort</button>
        )}
      </div>

      <div className="overflow-x-auto mt-3">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr className="border-b border-[hsl(var(--border))]">
              <th className="text-left font-medium py-1.5 pr-2 sticky left-0 bg-[hsl(var(--card))] z-10 min-w-[132px]">School</th>
              <th className="text-center font-medium px-1 cursor-pointer whitespace-nowrap"
                  title="Researched robotics curriculum score (1-5)"
                  onClick={()=>setSortKey("_curr")}>
                Curr.{sortKey==="_curr" && " ↓"}
              </th>
              <th className="text-center font-medium px-1 cursor-pointer whitespace-nowrap"
                  title="Researched robotics access score (1-5)"
                  onClick={()=>setSortKey("_access")}>
                Access{sortKey==="_access" && " ↓"}
              </th>
              {RD_DOMAINS.map(d => (
                <th key={d.key}
                    className="px-1 cursor-pointer align-bottom"
                    title={`${d.label} — click to sort`}
                    onClick={()=>setSortKey(d.key)}
                    onMouseEnter={()=>setFocus(d.key)}
                    onMouseLeave={()=>setFocus(null)}>
                  <div className="font-medium whitespace-nowrap text-[10.5px] text-center pb-1"
                       style={{ color: focus===d.key || sortKey===d.key ? "hsl(var(--accent))" : undefined }}>
                    {d.short}{sortKey===d.key && " ↓"}
                  </div>
                </th>
              ))}
              <th className="text-center font-medium px-1 cursor-pointer whitespace-nowrap"
                  title="Breadth = 2 points per strong subdomain + 1 per present"
                  onClick={()=>setSortKey("_breadth")}>
                Breadth{sortKey==="_breadth" && " ↓"}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.slug} className="border-b border-[hsl(var(--border)/0.5)] hover:bg-[hsl(var(--muted)/0.4)]">
                <td className="py-1 pr-2 sticky left-0 bg-[hsl(var(--card))] font-medium whitespace-nowrap">{r.short}</td>
                <td className="text-center num px-1">{r.curr.toFixed(0)}</td>
                <td className="text-center num px-1">{r.access.toFixed(0)}</td>
                {RD_DOMAINS.map(d => {
                  const cell = r.dom[d.key];
                  const cov = cell?.coverage;
                  const ev = cell?.lab_or_course;
                  return (
                    <td key={d.key} className="px-1 py-1"
                        style={{ background: focus===d.key ? "hsl(var(--muted) / 0.5)" : undefined }}>
                      <div
                        className="w-full h-4 rounded-sm mx-auto"
                        style={{
                          ...cellStyle(cov),
                          border: cov === "none" || !cov ? "1px solid hsl(var(--border))" : "none",
                          minWidth: 16,
                        }}
                        title={
                          cov && cov !== "none"
                            ? `${r.short} — ${d.label}: ${cov.toUpperCase()}${ev ? `\n${ev}` : ""}`
                            : `${r.short} — ${d.label}: nothing published found`
                        }
                      />
                    </td>
                  );
                })}
                <td className="text-center num px-1 font-semibold">{r.breadth}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-[hsl(var(--border))] text-[10.5px] text-[hsl(var(--muted-foreground))]">
              <td className="pt-1.5 pr-2 sticky left-0 bg-[hsl(var(--card))]">Schools w/ strong</td>
              <td/><td/>
              {RD_DOMAINS.map(d => (
                <td key={d.key} className="text-center pt-1.5 num">{totals[d.key].strong}</td>
              ))}
              <td/>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] mt-3 leading-relaxed">
        <strong className="text-[hsl(var(--foreground))]">Column key:</strong>{" "}
        {RD_DOMAINS.map(d => `${d.short} = ${d.label}`).join(" · ")}.
        <br/>
        These saved domain signals describe research activity, not guaranteed undergraduate coursework or lab placement.
        Source dates and any access limits are recorded in the school research; a blank cell means no supporting evidence was saved.
        Use the robotics routes page to assess the undergraduate curriculum and AI course access.
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * EAC vs ETAC: what kind of degree the robotics-titled credential is.
 * ------------------------------------------------------------------ */

function AccreditationPanel() {
  const { hidden } = useHidden();
  const rows = useMemo(() => schools
    .filter(s => !hidden.has(s.slug) && s.robotics_credential)
    .map(s => ({ s, c: s.robotics_credential! })), [hidden]);

  if (!rows.length) return null;
  const of = (k: string) => rows.filter(r => r.c.abet_commission === k);
  const eac = of("EAC"), etac = of("ETAC"), none = of("NOT_ABET_ACCREDITED");

  const Group = ({ title, items, tone, children }: {
    title: string; items: typeof rows; tone: string; children: React.ReactNode;
  }) => items.length === 0 ? null : (
    <div className="rounded-md border p-3"
      style={{ borderColor: `hsl(${tone} / 0.35)`, background: `hsl(${tone} / 0.06)` }}>
      <div className="text-[10.5px] uppercase tracking-wider font-medium mb-1"
        style={{ color: `hsl(${tone})` }}>
        {title} · {items.length}
      </div>
      <div className="text-[12px] leading-snug mb-2">{children}</div>
      <div className="flex flex-wrap gap-1">
        {items.map(({ s, c }) => (
          <a key={s.slug} href={c.abet_source_url ?? "#"} target="_blank" rel="noreferrer"
            className="chip chip-outline text-[10.5px] py-0 hover:underline"
            title={`${c.program_name}${c.notes ? ` — ${c.notes}` : ""}`}>
            {s.short}
          </a>
        ))}
      </div>
    </div>
  );

  return (
    <div className="card p-5">
      <div className="flex items-baseline gap-2 text-[hsl(var(--accent))]">
        <ShieldCheck size={15}/>
        <div className="text-[11px] tracking-wider uppercase">Degree type &amp; accreditation</div>
      </div>
      <h3 className="serif text-[19px] font-semibold mt-1">
        A robotics degree is not always an engineering degree
      </h3>
      <p className="text-[13px] text-[hsl(var(--muted-foreground))] mt-1.5 leading-relaxed max-w-[860px]">
        Accreditation identifies the published degree category. <strong className="text-[hsl(var(--foreground))]">EAC</strong> accredits engineering programs and <strong className="text-[hsl(var(--foreground))]">ETAC</strong> accredits engineering technology programs.
        Purdue’s Robotics Engineering Technology is a separate technology credential; its recommended Computer Engineering route is an engineering degree.
        Check individual curricula, graduate-program prerequisites and any licensing requirements relevant to the student’s goals. Click a school for its recorded accreditation source.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
        <Group title="ABET EAC — engineering" items={eac} tone="var(--fit-strong)">
          The recorded robotics-titled credential is accredited under the Engineering Accreditation Commission.
        </Group>
        <Group title="ABET ETAC — engineering technology" items={etac} tone="var(--score-unk)">
          The recorded credential is engineering technology. Compare its applied curriculum with the school’s engineering route and check prerequisites for the intended graduate program.
        </Group>
        <Group title="No ABET accreditation" items={none} tone="var(--score-unk)">
          No ABET accreditation was recorded for this credential. This alone does not establish curriculum strength or graduate-admission eligibility; use the degree plan and current program requirements.
        </Group>
      </div>

      <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] mt-3 leading-relaxed">
        This panel concerns each school’s recorded robotics or mechatronics credential. A robotics track inside ECE has the accreditation of its parent degree. Program accreditation and the recommended route are separate fields.
      </div>
    </div>
  );
}
