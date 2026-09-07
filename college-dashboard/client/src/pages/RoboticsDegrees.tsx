import { useMemo, useState } from "react";
import data from "@/data/robotics_degrees.json";
import { AlertTriangle, Info, CalendarClock, Ban, GitBranch, ExternalLink, Search } from "lucide-react";

type Program = {
  institution: string;
  state: string;
  control: string;
  degree_name: string;
  bucket: string;
  home_unit: string;
  url: string;
  launched: string;
  route: string;
  gate: string;
  size: string;
  notes: string;
  in_dataset_slug: string | null;
};

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
  const programs = data.programs as Program[];
  const [bucket, setBucket] = useState<string>("robotics_engineering");
  const [onlyNew, setOnlyNew] = useState(false);
  const [q, setQ] = useState("");

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return programs.filter(p => {
      if (bucket !== "all" && p.bucket !== bucket) return false;
      if (onlyNew && p.in_dataset_slug) return false;
      if (needle) {
        const hay = `${p.institution} ${p.state} ${p.degree_name} ${p.home_unit}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [programs, bucket, onlyNew, q]);

  const meta = (data.bucket_meta as Record<string, { label: string; blurb: string }>)[bucket];
  const counts = data.counts as any;

  return (
    <div className="space-y-7">
      <header className="space-y-3">
        <h1 className="serif text-[22px] font-semibold leading-tight text-[hsl(var(--foreground))]">
          Undergraduate robotics degrees in the US
        </h1>
        <p className="max-w-3xl text-[13px] leading-relaxed text-[hsl(var(--muted-foreground))]">
          {counts.total} programs found, of which {counts.new_to_user} are outside the 33-school research set. The
          single most important thing on this page is that these are not all the same kind of degree.
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
              placeholder="Filter by school, state or degree"
              className="w-56 bg-transparent text-[11.5px] text-[hsl(var(--foreground))] outline-none placeholder:text-[hsl(var(--muted-foreground))]"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-[hsl(var(--foreground))]">
            <input type="checkbox" checked={onlyNew} onChange={e => setOnlyNew(e.target.checked)} />
            Only ones not already in my 33-school set
          </label>
          <span className="text-[11px] text-[hsl(var(--muted-foreground))]">{shown.length} shown</span>
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
              {p.in_dataset_slug && (
                <span
                  className="shrink-0 rounded px-1.5 py-[1px] text-[10px] font-medium text-[hsl(var(--foreground))]"
                  style={{ background: `hsl(${INFO} / 0.13)`, border: `1px solid hsl(${INFO} / 0.35)` }}
                >
                  already in my set
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

      {/* Excluded */}
      <section className="space-y-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          Checked and ruled out ({(data.excluded as any[]).length})
        </h2>
        <div className="rounded-lg border border-[hsl(var(--border))] p-3.5">
          <ul className="space-y-1.5">
            {(data.excluded as any[]).map(e => (
              <li key={e.institution} className="text-[11.5px] leading-relaxed">
                <span className="font-medium text-[hsl(var(--foreground))]">{e.institution}</span>
                <span className="text-[hsl(var(--muted-foreground))]"> — {e.why}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <footer className="rounded-lg border border-[hsl(var(--border))] p-4">
        <div className="flex items-start gap-2.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
          <p className="text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">
            {data.note} Enumerated from a national program search plus first-party catalog pages.
            Compiled {data.compiled}. Admission routes and gates change — confirm with each school before relying
            on them.
          </p>
        </div>
      </footer>
    </div>
  );
}
