import { useMemo, useState } from "react";
import plan from "@/data/cmu_plan.json";
import { AlertTriangle, Info, GraduationCap, Bot, Sigma, CircleDot, ArrowRight, ShieldAlert, LifeBuoy } from "lucide-react";

type Course = {
  code: string;
  title: string;
  units: number;
  role: string;
  note?: string;
  critical?: boolean;
};
type Semester = { term: string; courses: Course[]; units: number; why: string };
type Risk = { risk: string; detail: string; mitigation: string; severity: string };

// Semantic colors as HSL literals so they read correctly in both the light
// parchment theme and the dark theme, matching the convention in Sequencing.tsx.
const DANGER = "0 70% 45%";
const WARN = "30 75% 45%";
const ROBOTICS = "155 50% 38%";
const STATS = "215 60% 45%";
const MLSLOT = "270 50% 50%";

const ROLE_STYLE: Record<string, { hue: string; label: string; icon: any }> = {
  "major core": { hue: STATS, label: "Stats & ML core", icon: Sigma },
  "robotics additional major": { hue: ROBOTICS, label: "Robotics additional major", icon: Bot },
  "ML advanced elective": { hue: MLSLOT, label: "Fills the ML elective slot", icon: GraduationCap },
  "major elective": { hue: STATS, label: "Stats elective", icon: CircleDot },
  supporting: { hue: WARN, label: "Prerequisite builder", icon: ArrowRight },
  placeholder: { hue: "220 15% 55%", label: "Not researched", icon: Info },
  free: { hue: "220 15% 55%", label: "Open", icon: CircleDot },
};

function roleStyle(role: string) {
  return ROLE_STYLE[role] ?? ROLE_STYLE.free;
}

// The two chains that decide whether the robotics credential survives. Rendered
// explicitly because the risk is invisible in a semester grid: most of these
// courses run in only one semester per year, so a slip costs a year, not a term.
const CHAINS = [
  {
    name: "The controls chain — the one that can end the plan",
    steps: ["15-112", "15-122 + 21-122", "16-299 (needs a B)", "16-450 (Fall only)", "16-474 Capstone"],
    note: "16-299 runs in Spring only and 16-450 in Fall only. That is why controls sits in Year 2: it buys one extra Spring to retake if the grade lands below B.",
    hue: DANGER,
  },
  {
    name: "The learning chain — lower risk, higher payoff",
    steps: ["15-112", "15-122", "21-241", "10-301", "10-403 Deep RL & Control"],
    note: "Every prerequisite here is already required by the major, so this chain costs no extra courses. 10-403 also fills the major's required ML Advanced Elective slot.",
    hue: ROBOTICS,
  },
];

const LEGEND = [
  { hue: STATS, label: "Stats & ML core" },
  { hue: ROBOTICS, label: "Robotics additional major" },
  { hue: MLSLOT, label: "ML elective slot" },
  { hue: WARN, label: "Prerequisite builder" },
  { hue: "220 15% 55%", label: "Gen-ed — not researched" },
];

export default function CmuPlanPage() {
  const semesters = plan.semesters as Semester[];
  const risks = plan.risks as Risk[];
  const [openTerm, setOpenTerm] = useState<string | null>(null);

  const counts = useMemo(() => {
    let robotics = 0;
    let core = 0;
    let placeholder = 0;
    for (const s of semesters) {
      for (const c of s.courses) {
        if (c.role === "robotics additional major") robotics += 1;
        else if (c.role === "major core") core += 1;
        else if (c.role === "placeholder" || c.role === "free") placeholder += 1;
      }
    }
    return { robotics, core, placeholder };
  }, [semesters]);

  return (
    <div className="space-y-7">
      <header className="space-y-3">
        <h1 className="serif text-[22px] font-semibold leading-tight text-[hsl(var(--foreground))]">
          Four-year plan · Carnegie Mellon
        </h1>
        <p className="max-w-3xl text-[13px] leading-relaxed text-[hsl(var(--muted-foreground))]">{plan.degree}</p>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span
            className="rounded-full px-2.5 py-1 font-medium text-[hsl(var(--foreground))]"
            style={{ background: `hsl(${WARN} / 0.14)`, border: `1px solid hsl(${WARN} / 0.4)` }}
          >
            Assumption: {plan.assumption}
          </span>
          <span className="rounded-full border border-[hsl(var(--border))] px-2.5 py-1 text-[hsl(var(--muted-foreground))]">
            {counts.core} stats &amp; ML core · {counts.robotics} robotics · {counts.placeholder} not researched
          </span>
        </div>
      </header>

      {/* The headline consequence of the B assumption leads the page, because it
          is the single fact that changes how the plan should be sequenced. */}
      <section
        className="rounded-lg p-4"
        style={{ background: `hsl(${DANGER} / 0.06)`, border: `1px solid hsl(${DANGER} / 0.35)` }}
      >
        <div className="flex items-start gap-2.5">
          <ShieldAlert className="mt-0.5 h-[18px] w-[18px] shrink-0" style={{ color: `hsl(${DANGER})` }} />
          <div className="space-y-2">
            <h2 className="text-[13px] font-semibold text-[hsl(var(--foreground))]">
              A straight-B average lands exactly on the line — twice
            </h2>
            <p className="text-[12.5px] leading-relaxed text-[hsl(var(--foreground))]">
              A B average is exactly 3.00. The Additional Major in Robotics requires a 3.0 QPA in the robotics
              curriculum to graduate, and 16-450 requires a minimum <strong>grade of B</strong> — not a pass — in both
              an intro robotics course and a controls course. Under this assumption he clears both with zero margin, so
              a single B-minus in a robotics course is the difference between finishing the credential and not.
            </p>
            <p className="text-[12px] leading-relaxed text-[hsl(var(--muted-foreground))]">
              The plan below is sequenced around that fact rather than around convenience: every course carrying a
              grade threshold is pulled as early as its prerequisites allow, so there is room to recover.
            </p>
          </div>
        </div>
      </section>

      {/* Prerequisite chains */}
      <section className="space-y-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          The two chains that matter
        </h2>
        {CHAINS.map(chain => (
          <div
            key={chain.name}
            className="rounded-lg p-3.5"
            style={{ background: `hsl(${chain.hue} / 0.05)`, border: `1px solid hsl(${chain.hue} / 0.3)` }}
          >
            <h3 className="flex items-center gap-2 text-[12.5px] font-semibold text-[hsl(var(--foreground))]">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: `hsl(${chain.hue})` }} />
              {chain.name}
            </h3>
            <ol className="mt-2.5 flex flex-wrap items-center gap-x-1 gap-y-2">
              {chain.steps.map((step, i) => (
                <li key={step} className="flex items-center gap-1">
                  <span
                    className="rounded border px-2 py-1 font-mono text-[11px] text-[hsl(var(--foreground))]"
                    style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
                  >
                    {step}
                  </span>
                  {i < chain.steps.length - 1 && (
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
                  )}
                </li>
              ))}
            </ol>
            <p className="mt-2.5 text-[11.5px] leading-relaxed text-[hsl(var(--muted-foreground))]">{chain.note}</p>
          </div>
        ))}
      </section>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
        {LEGEND.map(l => (
          <span key={l.label} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: `hsl(${l.hue})` }} />
            {l.label}
          </span>
        ))}
      </div>

      {/* Semester grid */}
      <section className="space-y-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          Semester by semester
        </h2>
        <div className="grid gap-3 lg:grid-cols-2">
          {semesters.map(sem => {
            const open = openTerm === sem.term;
            const hasCritical = sem.courses.some(c => c.critical);
            return (
              <article
                key={sem.term}
                className="rounded-lg p-3.5"
                style={{
                  background: "hsl(var(--card))",
                  border: hasCritical ? `1px solid hsl(${DANGER} / 0.35)` : "1px solid hsl(var(--border))",
                }}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-[13px] font-semibold text-[hsl(var(--foreground))]">{sem.term}</h3>
                  <span className="shrink-0 font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
                    {sem.units} units
                  </span>
                </div>

                <ul className="mt-2.5 space-y-2">
                  {sem.courses.map((c, i) => {
                    const st = roleStyle(c.role);
                    const Icon = st.icon;
                    return (
                      <li key={`${c.code}-${i}`} className="flex items-start gap-2">
                        <span
                          className="mt-0.5 flex shrink-0 items-center rounded border p-[3px]"
                          style={{
                            background: `hsl(${st.hue} / 0.12)`,
                            borderColor: `hsl(${st.hue} / 0.35)`,
                            color: `hsl(${st.hue})`,
                          }}
                          title={st.label}
                        >
                          <Icon className="h-3 w-3" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            {c.code !== "\u2014" && (
                              <span className="font-mono text-[11.5px] font-semibold text-[hsl(var(--foreground))]">
                                {c.code}
                              </span>
                            )}
                            <span className="text-[12px] text-[hsl(var(--foreground))]">{c.title}</span>
                            <span className="font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                              {c.units}u
                            </span>
                            {c.critical && (
                              <span
                                className="rounded px-1.5 py-[1px] text-[10px] font-semibold"
                                style={{ background: `hsl(${DANGER} / 0.16)`, color: "hsl(var(--foreground))", border: `1px solid hsl(${DANGER} / 0.4)` }}
                              >
                                grade gate
                              </span>
                            )}
                          </div>
                          {c.note && (
                            <p className="mt-0.5 text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                              {c.note}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>

                <button
                  onClick={() => setOpenTerm(open ? null : sem.term)}
                  className="mt-2.5 text-[11px] font-medium text-[hsl(var(--foreground))] underline decoration-dotted"
                >
                  {open ? "Hide reasoning" : "Why this semester?"}
                </button>
                {open && (
                  <p
                    className="mt-2 border-l-2 pl-2.5 text-[11.5px] leading-relaxed text-[hsl(var(--muted-foreground))]"
                    style={{ borderColor: "hsl(var(--border))" }}
                  >
                    {sem.why}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {/* Risks */}
      <section className="space-y-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          What could go wrong ({risks.length})
        </h2>
        <div className="space-y-2.5">
          {risks.map(r => {
            const hue = r.severity === "high" ? DANGER : WARN;
            return (
              <article
                key={r.risk}
                className="rounded-lg p-3.5"
                style={{ background: `hsl(${hue} / 0.05)`, border: `1px solid hsl(${hue} / 0.3)` }}
              >
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: `hsl(${hue})` }} />
                  <div className="space-y-1.5">
                    <h3 className="text-[12.5px] font-semibold text-[hsl(var(--foreground))]">{r.risk}</h3>
                    <p className="text-[11.5px] leading-relaxed text-[hsl(var(--muted-foreground))]">{r.detail}</p>
                    <p className="text-[11.5px] leading-relaxed text-[hsl(var(--foreground))]">
                      <span className="font-semibold text-[hsl(var(--foreground))]">What to do: </span>
                      {r.mitigation}
                    </p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Fallback */}
      <section
        className="rounded-lg p-4"
        style={{ background: "hsl(var(--accent) / 0.06)", border: "1px solid hsl(var(--accent) / 0.35)" }}
      >
        <div className="flex items-start gap-2.5">
          <LifeBuoy className="mt-0.5 h-[18px] w-[18px] shrink-0" style={{ color: "hsl(var(--accent))" }} />
          <div className="space-y-1.5">
            <h2 className="text-[13px] font-semibold text-[hsl(var(--foreground))]">
              If the grades slip: {plan.fallback.name}
            </h2>
            <p className="text-[12px] leading-relaxed text-[hsl(var(--foreground))]">{plan.fallback.why}</p>
            <p className="text-[11.5px] leading-relaxed text-[hsl(var(--muted-foreground))]">{plan.fallback.cost}</p>
            <p className="text-[11.5px] leading-relaxed text-[hsl(var(--muted-foreground))]">{plan.fallback.also}</p>
          </div>
        </div>
      </section>

      {/* Honesty footer */}
      <footer className="rounded-lg border border-[hsl(var(--border))] p-4">
        <div className="flex items-start gap-2.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
          <div className="space-y-2 text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">
            <p>{plan.note}</p>
            <p>
              <span className="font-semibold text-[hsl(var(--foreground))]">Registration policy, verbatim: </span>
              &ldquo;{plan.registration_rule}&rdquo;
            </p>
            <p>
              <span className="font-semibold text-[hsl(var(--foreground))]">Full-time rule: </span>
              {plan.fulltime_rule} Every semester above is between 36 and 41 units, so none requires an overload
              approval. {plan.total_units_planned} units are planned here against the 360 the degree requires — the
              gap is Dietrich general education and free electives, which were not researched.
            </p>
            <p>
              Sources: the{" "}
              <a
                className="font-medium text-[hsl(var(--foreground))] underline decoration-dotted"
                href="http://coursecatalog.web.cmu.edu/schools-colleges/dietrichcollegeofhumanitiesandsocialsciences/departmentofstatistics/"
                target="_blank"
                rel="noreferrer"
              >
                Statistics &amp; Data Science catalog
              </a>
              , the{" "}
              <a
                className="font-medium text-[hsl(var(--foreground))] underline decoration-dotted"
                href="https://www.ri.cmu.edu/education/academic-programs/additional-major-in-robotics/"
                target="_blank"
                rel="noreferrer"
              >
                Additional Major in Robotics
              </a>{" "}
              page, and{" "}
              <a
                className="font-medium text-[hsl(var(--foreground))] underline decoration-dotted"
                href="http://coursecatalog.web.cmu.edu/aboutcmu/undergraduateacademicregulations/"
                target="_blank"
                rel="noreferrer"
              >
                CMU&rsquo;s undergraduate academic regulations
              </a>
              . Compiled {plan.compiled}. Confirm every requirement with a Statistics advisor before relying on it.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
