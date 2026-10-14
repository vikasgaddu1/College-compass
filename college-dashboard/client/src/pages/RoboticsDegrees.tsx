import { useMemo, useState } from "react";
import data from "@/data/robotics_degrees.json";
import { schools } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import { AlertTriangle, Info, CalendarClock, Ban, GitBranch, ExternalLink, Search } from "lucide-react";

type Program = {
  institution: string;
  state: string;
  control: string;
  degree_name: string;
  bucket: string;
  home_unit: string;
  url: string;
  launched?: string;
  route: string;
  gate: string;
  size: string;
  notes: string;
  in_dataset_slug: string | null;
};

const ROSTER = new Set(schools.map(s => s.slug));
const inList = (p: { in_dataset_slug: string | null }) => !!p.in_dataset_slug && ROSTER.has(p.in_dataset_slug);

const DANGER = "0 70% 45%";
const WARN = "30 75% 45%";
const GOOD = "155 50% 38%";
const INFO = "215 60% 45%";

const CALLOUT_ICON: Record<string, any> = {
  timing: CalendarClock,
  trap: AlertTriangle,
  gap: Ban,
  gate: GitBranch,
};
const CALLOUT_HUE: Record<string, string> = {
  timing: GOOD,
  trap: DANGER,
  gap: WARN,
  gate: INFO,
};

export default function RoboticsDegreesPage() {
  const { hidden } = useHidden();
  const programs = useMemo(() => (data.programs as Program[]).filter(p => inList(p) && !hidden.has(p.in_dataset_slug!)), [hidden]);
  const [bucket, setBucket] = useState<string>("all");
  const [q, setQ] = useState("");

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return programs.filter(p => {
      if (bucket !== "all" && p.bucket !== bucket) return false;
      if (needle) {
        const hay = `${p.institution} ${p.state} ${p.degree_name} ${p.home_unit}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [programs, bucket, q]);

  const meta = (data.bucket_meta as Record<string, { label: string; blurb: string }>)[bucket];
  const visibleSchools = new Set(programs.map(p => p.in_dataset_slug)).size;
  const primaryRobotics = programs.filter(p => p.bucket === "robotics_engineering").length;
  const eceRoutes = programs.filter(p => p.bucket === "ece_robotics_route").length;
  const technologyOptions = programs.filter(p => p.bucket === "robotics_engineering_technology").length;
  const counts = { total: programs.length, by_bucket: Object.fromEntries((data.bucket_order as string[]).map(b => [b, programs.filter(p => p.bucket === b).length])) };

  return (
    <div className="space-y-7">
      <header className="space-y-3">
        <h1 className="serif text-[22px] font-semibold leading-tight text-[hsl(var(--foreground))]">
          Robotics degree routes across the selected schools
        </h1>
        <p className="max-w-3xl text-[13px] leading-relaxed text-[hsl(var(--muted-foreground))]">
          {visibleSchools} visible schools · {primaryRobotics} primary robotics degrees · {eceRoutes} recommended ECE routes.
          {technologyOptions > 0 && <> {technologyOptions} additional engineering technology option{technologyOptions === 1 ? "" : "s"} shown separately.</>}
          {" "}The degree title, curriculum and entry gate matter: Purdue’s Robotics Engineering Technology is a separate credential from its recommended Computer Engineering route.
        </p>
      </header>

      {/* Callouts: the facts that change a decision */}
      <section className="grid gap-3 lg:grid-cols-2">
        {(data.callouts as any[]).map(c => {
          const Icon = CALLOUT_ICON[c.kind] ?? Info;
          const hue = CALLOUT_HUE[c.kind] ?? INFO;
          return (
            <article
              key={c.title}
              className="rounded-lg p-3.5"
              style={{ background: `hsl(${hue} / 0.05)`, border: `1px solid hsl(${hue} / 0.3)` }}
            >
              <div className="flex items-start gap-2.5">
                <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: `hsl(${hue})` }} />
                <div className="space-y-1.5">
                  <h2 className="text-[12.5px] font-semibold text-[hsl(var(--foreground))]">{c.title}</h2>
                  <p className="text-[11.5px] leading-relaxed text-[hsl(var(--muted-foreground))]">{c.body}</p>
                  {c.url && (
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-[hsl(var(--foreground))] underline decoration-dotted"
                    >
                      Source <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </section>

      {/* Controls */}
      <section className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {(data.bucket_order as string[]).concat(["all"]).map(b => {
            const label =
              b === "all"
                ? `All (${counts.total})`
                : `${(data.bucket_meta as any)[b].label.split(" — ")[0]} (${counts.by_bucket[b] ?? 0})`;
            const active = bucket === b;
            return (
              <button
                key={b}
                onClick={() => setBucket(b)}
                className="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
                style={{
                  background: active ? "hsl(var(--foreground))" : "hsl(var(--card))",
                  color: active ? "hsl(var(--background))" : "hsl(var(--foreground))",
                  border: "1px solid hsl(var(--border))",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {meta && (
          <p
            className="rounded-md p-2.5 text-[11.5px] leading-relaxed text-[hsl(var(--foreground))]"
            style={{ background: "hsl(var(--accent) / 0.07)", border: "1px solid hsl(var(--accent) / 0.3)" }}
          >
            {meta.blurb}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <div
            className="flex items-center gap-1.5 rounded-md px-2 py-1"
            style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
          >
            <Search className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              aria-label="Filter robotics degree routes"
              placeholder="Filter by school, state or degree"
              className="w-56 bg-transparent text-[11.5px] text-[hsl(var(--foreground))] outline-none placeholder:text-[hsl(var(--muted-foreground))]"
            />
          </div>

          <span className="text-[11px] text-[hsl(var(--muted-foreground))]">{shown.length} degree entries shown; hidden schools are excluded</span>
        </div>
      </section>

      {/* Program list */}
      <section className="space-y-2.5">
        {shown.length === 0 && (
          <p className="rounded-md border border-[hsl(var(--border))] p-4 text-[12px] text-[hsl(var(--muted-foreground))]">
            Nothing matches that filter.
          </p>
        )}
        {shown.map(p => (
          <article
            key={`${p.institution}-${p.degree_name}`}
            className="rounded-lg p-3.5"
            style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
          >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h3 className="text-[13px] font-semibold text-[hsl(var(--foreground))]">{p.institution}</h3>
              <span className="font-mono text-[10.5px] text-[hsl(var(--muted-foreground))]">
                {p.state} · {p.control}
              </span>
              <span className="chip chip-outline text-[10px]">{(data.bucket_meta as Record<string, { label: string }>)[p.bucket]?.label.split(" — ")[0] ?? p.bucket}</span>
              {inList(p) && (
                <span
                  className="shrink-0 rounded px-1.5 py-[1px] text-[10px] font-medium text-[hsl(var(--foreground))]"
                  style={{ background: `hsl(${INFO} / 0.13)`, border: `1px solid hsl(${INFO} / 0.35)` }}
                >
                  selected school
                </span>
              )}
            </div>

            <p className="mt-1.5 text-[12px] leading-relaxed text-[hsl(var(--foreground))]">
              <span className="font-medium">Degree as published: </span>
              {p.degree_name}
            </p>

            <dl className="mt-2 grid gap-x-5 gap-y-1 text-[11px] leading-relaxed sm:grid-cols-2">
              {p.home_unit && p.home_unit !== "UNK" && (
                <div>
                  <dt className="inline font-medium text-[hsl(var(--foreground))]">Housed in: </dt>
                  <dd className="inline text-[hsl(var(--muted-foreground))]">{p.home_unit}</dd>
                </div>
              )}
              {p.launched && p.launched !== "UNK" && (
                <div>
                  <dt className="inline font-medium text-[hsl(var(--foreground))]">Launched: </dt>
                  <dd className="inline text-[hsl(var(--muted-foreground))]">{p.launched}</dd>
                </div>
              )}
              {p.route && p.route !== "UNK" && (
                <div className="sm:col-span-2">
                  <dt className="inline font-medium text-[hsl(var(--foreground))]">How you get in: </dt>
                  <dd className="inline text-[hsl(var(--muted-foreground))]">{p.route}</dd>
                </div>
              )}
              {p.gate && p.gate !== "none published" && (
                <div className="sm:col-span-2">
                  <dt className="inline font-medium text-[hsl(var(--foreground))]">Gate: </dt>
                  <dd className="inline text-[hsl(var(--muted-foreground))]">{p.gate}</dd>
                </div>
              )}
              {p.size && p.size !== "UNK" && (
                <div className="sm:col-span-2">
                  <dt className="inline font-medium text-[hsl(var(--foreground))]">Size signal: </dt>
                  <dd className="inline text-[hsl(var(--muted-foreground))]">{p.size}</dd>
                </div>
              )}
            </dl>

            {p.notes && (
              <p className="mt-2 border-l-2 pl-2.5 text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]"
                 style={{ borderColor: "hsl(var(--border))" }}>
                {p.notes}
              </p>
            )}

            {p.url && (
              <a
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-[hsl(var(--foreground))] underline decoration-dotted"
              >
                Official page <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </article>
        ))}
      </section>

      <footer className="rounded-lg border border-[hsl(var(--border))] p-4">
        <div className="flex items-start gap-2.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
          <p className="text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">
            {data.note} This explorer covers the selected schools only; it does not enumerate programs nationwide.
            Research snapshot: {data.compiled}. Source dates and inaccessible-page limits are recorded in the route research.
            Admission gates, electives and project access can change before Fall 2027.
          </p>
        </div>
      </footer>
    </div>
  );
}
