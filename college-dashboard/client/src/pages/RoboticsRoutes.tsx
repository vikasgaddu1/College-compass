import { useMemo, useState } from "react";
import data from "@/data/robotics_routes.json";
import { schools } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import { NoteButton } from "@/components/SchoolBits";
import { Bot, Cpu, Code2, Award, ExternalLink, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Info } from "lucide-react";

type RouteKey = "bs_robotics" | "ece" | "cs";
type Course = { code: string; title: string };
type AiCourse = Course & { url: string; access_note: string };
type Route = {
  degree_names: string[];
  home_unit: string;
  robotics_track: string | null;
  key_courses: Course[];
  entry: string;
  first_year_direct_admit: boolean | null;
  notes: string | null;
  url: string;
};
type BsRobotics = {
  offered: boolean;
  degree_name: string | null;
  kind: "primary_major" | "additional_major_only" | "engineering_technology" | "satellite_campus" | "none";
  home_unit: string | null;
  entry: string | null;
  first_year_direct_admit: boolean | null;
  notes: string | null;
  url: string | null;
};
type SchoolRoutes = {
  slug: string;
  name: string;
  recommended_route: RouteKey;
  recommended_summary: string;
  site_degree: string;
  alternative: string;
  bs_robotics: BsRobotics;
  ece: Route;
  cs: Route;
  robotics_minor: { name: string; kind: string; open_to: string; url: string } | null;
  ecosystem: string;
  tradeoff: string;
  corrections_to_existing: string[];
  ai_electives?: AiCourse[];
  verified_on?: string;
  verification_note?: string;
  sources: { url: string; supports: string; verified_on?: string; verification_note?: string }[];
};

const ROUTES = data.schools as unknown as Record<string, SchoolRoutes>;

const META: Record<RouteKey, { label: string; icon: any; hue: string }> = {
  bs_robotics: { label: "BS in Robotics", icon: Bot, hue: "var(--fit-top)" },
  ece: { label: "ECE route", icon: Cpu, hue: "var(--fit-strong)" },
  cs: { label: "CS route", icon: Code2, hue: "var(--accent)" },
};

const KIND_LABEL: Record<BsRobotics["kind"], string> = {
  primary_major: "Primary major",
  additional_major_only: "Additional major only",
  engineering_technology: "Engineering technology degree",
  satellite_campus: "Satellite campus",
  none: "Not offered",
};

function entryLabel(v: boolean | null) {
  if (v === true) return { text: "Direct admit as a first-year", tone: "var(--fit-top)" };
  if (v === false) return { text: "Major declared after admission", tone: "var(--fit-conditional)" };
  return { text: "Entry not confirmed", tone: "var(--muted-foreground)" };
}

function host(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

export default function RoboticsRoutesPage() {
  const { isHidden } = useHidden();
  const [filter, setFilter] = useState<RouteKey | "all">("all");

  const rows = useMemo(
    () =>
      schools
        .filter(s => !isHidden(s.slug) && ROUTES[s.slug])
        .map(s => ({ s, r: ROUTES[s.slug] }))
        .filter(({ r }) => filter === "all" || r.recommended_route === filter),
    [isHidden, filter],
  );

  const all = useMemo(() => schools.filter(s => !isHidden(s.slug) && ROUTES[s.slug]).map(s => ROUTES[s.slug]), [isHidden]);
  const count = (k: RouteKey) => all.filter(r => r.recommended_route === k).length;
  const withRealBs = all.filter(r => r.bs_robotics.offered && r.bs_robotics.kind === "primary_major").length;

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex items-baseline gap-2 text-[hsl(var(--accent))]">
          <Bot size={16} />
          <div className="text-[11px] tracking-wider uppercase">Robotics routes</div>
        </div>
        <h2 className="serif text-[22px] font-semibold mt-1">Robotics degrees with hardware, controls and AI</h2>
        <p className="text-[13.5px] text-[hsl(var(--muted-foreground))] mt-2 leading-relaxed max-w-[860px]">
          Three ways in: a dedicated <strong>BS in Robotics</strong> where the school has a real one, otherwise the{" "}
          <strong>ECE route</strong> (electrical or computer engineering plus its controls/robotics track) or the{" "}
          <strong>CS route</strong> (computer science plus its robotics courses). Each school shows all three, how a
          first-year enters the program, the recommended route, and undergraduate AI choices with their access limits.
          This comparison covers the 15 selected schools for Fall 2027 entry by a North Carolina resident.
          Research snapshot: {data.compiled_date}; school-specific source notes appear below.
        </p>

        <div className="mt-4 flex flex-wrap gap-5 text-[12.5px]">
          <div>
            <span className="num text-[18px] font-semibold" style={{ color: `hsl(var(--fit-top))` }}>{withRealBs}</span>
            <span className="text-[hsl(var(--muted-foreground))]"> of {all.length} have a primary undergraduate robotics degree</span>
          </div>
          {(Object.keys(META) as RouteKey[]).map(k => (
            <div key={k}>
              <span className="num text-[18px] font-semibold" style={{ color: `hsl(${META[k].hue})` }}>{count(k)}</span>
              <span className="text-[hsl(var(--muted-foreground))]"> recommended via {META[k].label}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {(["all", "bs_robotics", "ece", "cs"] as const).map(k => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`chip ${filter === k ? "" : "chip-outline"} hover:bg-[hsl(var(--elevate-1))]`}
              style={filter === k ? { background: "hsl(var(--foreground))", color: "hsl(var(--background))" } : undefined}
            >
              {k === "all" ? `All (${all.length})` : `${META[k].label} (${count(k)})`}
            </button>
          ))}
        </div>
      </div>

      {/* At-a-glance matrix */}
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-[12px] min-w-[760px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] border-b border-[hsl(var(--border))]">
              <th className="p-3 font-medium">School</th>
              <th className="p-3 font-medium">BS in Robotics</th>
              <th className="p-3 font-medium">ECE robotics track</th>
              <th className="p-3 font-medium">CS robotics track</th>
              <th className="p-3 font-medium">Minor / add-on</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ s, r }) => {
              const cell = (k: RouteKey, text: string) => {
                const rec = r.recommended_route === k;
                return (
                  <td className="p-3 align-top" style={rec ? { background: `hsl(${META[k].hue} / 0.09)` } : undefined}>
                    {rec && (
                      <div className="text-[10px] uppercase tracking-wider font-semibold mb-0.5 inline-flex items-center gap-1" style={{ color: `hsl(${META[k].hue})` }}>
                        <CheckCircle2 size={10} /> Recommended
                      </div>
                    )}
                    <div className="leading-snug">{text}</div>
                  </td>
                );
              };
              const b = r.bs_robotics;
              return (
                <tr key={s.slug} className="border-b border-[hsl(var(--border))] last:border-0">
                  <td className="p-3 align-top font-medium whitespace-nowrap">
                    <a href={`#route-${s.slug}`} className="hover:underline">{s.short}</a>
                  </td>
                  {cell("bs_robotics", b.offered ? `${b.degree_name ?? "Yes"}${b.kind !== "primary_major" ? ` (${KIND_LABEL[b.kind].toLowerCase()})` : ""}` : "None")}
                  {cell("ece", r.ece.robotics_track ? shortTrack(r.ece.robotics_track) : "ECE electives / robotics projects")}
                  {cell("cs", r.cs.robotics_track ? shortTrack(r.cs.robotics_track) : "No named track")}
                  <td className="p-3 align-top text-[hsl(var(--muted-foreground))]">{r.robotics_minor ? shortTrack(r.robotics_minor.name) : "None"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-4">
        {rows.map(({ s, r }) => <SchoolRoutesCard key={s.slug} short={s.short} cityState={s.city_state} r={r} />)}
      </div>

      <div className="card p-3 text-[11px] text-[hsl(var(--muted-foreground))] leading-relaxed">
        <Info size={11} className="inline mr-1 opacity-70" />
        {data.note} Admission rules change year to year, so confirm the declaring rules with each school's engineering or
        computing advising office before the application goes in.
      </div>
    </div>
  );
}

/** Keep table cells short: drop parenthetical detail from long track names. */
function shortTrack(t: string) {
  const cut = t.split(" (")[0].split("; ")[0];
  return cut.length > 70 ? cut.slice(0, 68) + "…" : cut;
}

function SchoolRoutesCard({ short, cityState, r }: { short: string; cityState: string; r: SchoolRoutes }) {
  const [open, setOpen] = useState(false);
  const rec = META[r.recommended_route];
  const RecIcon = rec.icon;

  return (
    <div id={`route-${r.slug}`} className="card p-4 scroll-mt-20">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h3 className="serif text-[17px] font-semibold">{short}</h3>
          <div className="text-[11.5px] text-[hsl(var(--muted-foreground))]">{cityState}</div>
          <NoteButton slug={r.slug} />
        </div>
        <span
          className="chip inline-flex items-center gap-1"
          style={{ background: `hsl(${rec.hue} / 0.12)`, color: `hsl(${rec.hue})`, borderColor: `hsl(${rec.hue} / 0.35)` }}
        >
          <RecIcon size={11} /> Go {rec.label}
        </span>
      </div>

      <div className="mt-2 rounded-md p-3 text-[13px] leading-relaxed" style={{ background: `hsl(${rec.hue} / 0.07)`, border: `1px solid hsl(${rec.hue} / 0.25)` }}>
        <div className="font-medium">{r.site_degree}</div>
        <div className="text-[hsl(var(--muted-foreground))] mt-1">{r.recommended_summary}</div>
        <div className="mt-2 text-[12px]"><span className="font-medium">Alternative inside this school:</span> <span className="text-[hsl(var(--muted-foreground))]">{r.alternative}</span></div>
        <div className="mt-1 text-[12px] flex gap-1.5">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" style={{ color: "hsl(var(--fit-conditional))" }} />
          <span><span className="font-medium">Trade-off:</span> <span className="text-[hsl(var(--muted-foreground))]">{r.tradeoff}</span></span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-3">
        <BsPanel b={r.bs_robotics} recommended={r.recommended_route === "bs_robotics"} />
        <RoutePanel k="ece" route={r.ece} recommended={r.recommended_route === "ece"} />
        <RoutePanel k="cs" route={r.cs} recommended={r.recommended_route === "cs"} />
      </div>

      <div className="mt-3 rounded-md border border-[hsl(var(--border))] p-3 text-[12px]">
        <div className="text-[10.5px] uppercase tracking-wider font-medium mb-1 inline-flex items-center gap-1"><Code2 size={11} /> AI course choices</div>
        <div className="text-[11px] text-[hsl(var(--muted-foreground))] mb-2">Undergraduate options to pair with robotics. Check prerequisites, major restrictions and the degree’s elective rules before planning a course.</div>
        {r.ai_electives?.length ? (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2">
            {r.ai_electives.map(c => (
              <li key={c.code + c.url} className="leading-snug">
                <a href={c.url} target="_blank" rel="noreferrer" className="font-medium hover:underline inline-flex items-center gap-1">{c.code} · {c.title} <ExternalLink size={10} className="shrink-0" /></a>
                <div className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5">{c.access_note}</div>
              </li>
            ))}
          </ul>
        ) : <div className="text-[hsl(var(--muted-foreground))]">Undergraduate AI electives and access conditions still need confirmation for this route.</div>}
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-[12px]">
        <div className="rounded-md border border-[hsl(var(--border))] p-3">
          <div className="text-[10.5px] uppercase tracking-wider font-medium mb-1 inline-flex items-center gap-1"><Award size={11} /> Robotics minor or add-on</div>
          {r.robotics_minor ? (
            <div className="leading-snug">
              <a href={r.robotics_minor.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">{r.robotics_minor.name}</a>
              <div className="text-[hsl(var(--muted-foreground))] mt-0.5">{r.robotics_minor.open_to}</div>
            </div>
          ) : (
            <div className="text-[hsl(var(--muted-foreground))]">No undergraduate robotics minor or certificate found.</div>
          )}
        </div>
        <div className="rounded-md border border-[hsl(var(--border))] p-3">
          <div className="text-[10.5px] uppercase tracking-wider font-medium mb-1 inline-flex items-center gap-1"><Bot size={11} /> Robotics labs and teams</div>
          <div className="leading-snug text-[hsl(var(--muted-foreground))]">{r.ecosystem}</div>
        </div>
      </div>

      {(r.verified_on || r.verification_note) && (
        <div className="mt-3 text-[11px] text-[hsl(var(--muted-foreground))] leading-relaxed">
          {r.verified_on && <span className="font-medium">Research snapshot: {r.verified_on}. </span>}{r.verification_note}
        </div>
      )}
      <button aria-expanded={open} aria-controls={`route-sources-${r.slug}`} onClick={() => setOpen(o => !o)} className="mt-3 text-[11.5px] inline-flex items-center gap-1 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {open ? "Hide" : "Show"} sources ({r.sources.length})
        {r.corrections_to_existing.length > 0 && ` and ${r.corrections_to_existing.length} corrections to earlier research`}
      </button>
      {open && (
        <div id={`route-sources-${r.slug}`} className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3 text-[11.5px]">
          <ul className="space-y-1">
            {r.sources.map(src => (
              <li key={src.url + src.supports} className="leading-snug">
                <a href={src.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                  {host(src.url)} <ExternalLink size={10} />
                </a>{" "}
                <span className="text-[hsl(var(--muted-foreground))]">· {src.supports}{src.verified_on ? ` · checked ${src.verified_on}` : ""}{src.verification_note ? ` · ${src.verification_note}` : ""}</span>
              </li>
            ))}
          </ul>
          {r.corrections_to_existing.length > 0 && (
            <div>
              <div className="font-medium mb-1">Research corrections and access cautions</div>
              <ul className="list-disc pl-4 space-y-1 text-[hsl(var(--muted-foreground))]">
                {r.corrections_to_existing.map(c => <li key={c}>{c}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PanelShell({ k, recommended, children }: { k: RouteKey; recommended: boolean; children: React.ReactNode }) {
  const m = META[k];
  const Icon = m.icon;
  return (
    <div
      className="rounded-md p-3 text-[12px]"
      style={{
        border: `1px solid hsl(${recommended ? m.hue : "var(--border)"}${recommended ? " / 0.55" : ""})`,
        background: recommended ? `hsl(${m.hue} / 0.05)` : undefined,
      }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[10.5px] uppercase tracking-wider font-semibold inline-flex items-center gap-1" style={{ color: `hsl(${m.hue})` }}>
          <Icon size={12} /> {m.label}
        </div>
        {recommended && <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: `hsl(${m.hue})` }}>Recommended</span>}
      </div>
      {children}
    </div>
  );
}

function EntryLine({ v, text }: { v: boolean | null; text: string | null }) {
  const e = entryLabel(v);
  return (
    <div className="mt-2">
      <div className="text-[10.5px] font-medium" style={{ color: `hsl(${e.tone})` }}>{e.text}</div>
      {text && <div className="text-[hsl(var(--muted-foreground))] leading-snug mt-0.5">{text}</div>}
    </div>
  );
}

function BsPanel({ b, recommended }: { b: BsRobotics; recommended: boolean }) {
  return (
    <PanelShell k="bs_robotics" recommended={recommended}>
      {b.offered ? (
        <>
          <div className="font-medium leading-snug">{b.degree_name}</div>
          <div className="text-[11px] text-[hsl(var(--muted-foreground))]">{[KIND_LABEL[b.kind], b.home_unit].filter(Boolean).join(" · ")}</div>
          <EntryLine v={b.first_year_direct_admit} text={b.entry} />
        </>
      ) : (
        <>
          <div className="font-medium">No BS in Robotics</div>
          {b.entry && <div className="text-[hsl(var(--muted-foreground))] leading-snug mt-1">{b.entry}</div>}
        </>
      )}
      {b.notes && <div className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))] leading-snug">{b.notes}</div>}
      {b.url && (
        <a href={b.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[11px] hover:underline">
          Source <ExternalLink size={10} />
        </a>
      )}
    </PanelShell>
  );
}

function RoutePanel({ k, route, recommended }: { k: "ece" | "cs"; route: Route; recommended: boolean }) {
  return (
    <PanelShell k={k} recommended={recommended}>
      <div className="font-medium leading-snug">{route.degree_names.join(" · ")}</div>
      <div className="text-[11px] text-[hsl(var(--muted-foreground))]">{route.home_unit}</div>
      <div className="mt-2 text-[11.5px]">
        <span className="font-medium">Robotics track: </span>
        <span className="text-[hsl(var(--muted-foreground))]">{route.robotics_track ?? "None formally named"}</span>
      </div>
      {route.key_courses.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {route.key_courses.map(c => (
            <li key={c.code} className="leading-snug">
              <span className="num text-[11px] font-medium">{c.code}</span>{" "}
              <span className="text-[hsl(var(--muted-foreground))]">{c.title}</span>
            </li>
          ))}
        </ul>
      )}
      <EntryLine v={route.first_year_direct_admit} text={route.entry} />
      {route.notes && <div className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))] leading-snug">{route.notes}</div>}
      <a href={route.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[11px] hover:underline">
        Source <ExternalLink size={10} />
      </a>
    </PanelShell>
  );
}
