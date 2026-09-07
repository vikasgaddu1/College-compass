import { useMemo, useState } from "react";
import data from "@/data/rbe_compare.json";
import {
  Info, ChevronDown, ChevronRight, Bot, GraduationCap, GitBranch, Building2,
  AlertTriangle, CheckCircle2, Wrench, BrainCircuit, Users,
} from "lucide-react";

type Core = { code: string; title: string; credits: string; purpose: string };
type Side = {
  degree_name: string;
  department: string;
  total_credits: string;
  credit_or_unit_system: string;
  elective_structure: string;
  declaration_gate: string;
  flexibility: string;
  size: string;
  distinctive: string[];
  required_core: Core[];
  capstone: Record<string, string>;
  ai_ml: string;
  hands_on: string;
};
type Diff = { dimension: string; wpi: string; umich: string; why_it_matters_for_a_robotics_ai_job: string };

const DANGER = "0 70% 45%";
const WARN = "30 75% 45%";
const GOOD = "155 50% 38%";
const WPI_HUE = "265 50% 45%";
const UMICH_HUE = "200 65% 42%";

const PURPOSE_STYLE: Record<string, string> = {
  robotics: GOOD,
  ml: "270 50% 50%",
  cs: "215 60% 45%",
  ece: "30 75% 45%",
  me: "15 70% 45%",
  math: "220 15% 45%",
  capstone: "280 45% 48%",
  other: "220 15% 55%",
};

function Panel({ hue, title, sub, children }: { hue: string; title: string; sub: string; children: any }) {
  return (
    <section className="rounded-lg p-4" style={{ background: "hsl(var(--card))", border: `1px solid hsl(${hue} / 0.35)` }}>
      <header className="mb-3">
        <h3 className="text-[13.5px] font-semibold text-[hsl(var(--foreground))]">{title}</h3>
        <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">{sub}</p>
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  if (!v) return null;
  return (
    <p className="text-[11.5px] leading-relaxed">
      <span className="font-semibold text-[hsl(var(--foreground))]">{k}: </span>
      <span className="text-[hsl(var(--muted-foreground))]">{v}</span>
    </p>
  );
}

function CoreList({ core, open, onToggle }: { core: Core[]; open: boolean; onToggle: () => void }) {
  if (!open) {
    return (
      <button
        onClick={onToggle}
        className="flex items-center gap-1 text-[11px] font-medium text-[hsl(var(--foreground))] underline decoration-dotted"
      >
        <ChevronRight className="h-3.5 w-3.5" /> Show all {core.length} required entries
      </button>
    );
  }
  return (
    <div>
      <button
        onClick={onToggle}
        className="mb-2 flex items-center gap-1 text-[11px] font-medium text-[hsl(var(--foreground))] underline decoration-dotted"
      >
        <ChevronDown className="h-3.5 w-3.5" /> Hide full requirement list
      </button>
      <ul className="space-y-1">
        {core.map((c, i) => (
          <li key={`${c.code}-${i}`} className="relative pl-4 text-[11px] leading-relaxed">
            <span
              className="absolute left-0 top-[5px] h-2 w-2 rounded-sm"
              style={{ background: `hsl(${PURPOSE_STYLE[c.purpose] ?? PURPOSE_STYLE.other})` }}
              title={c.purpose}
            />
            <span className="text-[hsl(var(--foreground))]">
              {c.code && !c.code.startsWith("Other") && !c.code.startsWith("Humanities") && (
                <span className="font-mono font-semibold text-[hsl(var(--foreground))]">{c.code} </span>
              )}
              {c.title}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function RoboticsComparePage() {
  const wpi = data.wpi as Side;
  const umich = data.umich as Side;
  const diffs = data.differences as Diff[];
  const [openWpi, setOpenWpi] = useState(false);
  const [openUmich, setOpenUmich] = useState(false);

  const legend = useMemo(
    () => [
      { hue: PURPOSE_STYLE.robotics, label: "robotics" },
      { hue: PURPOSE_STYLE.cs, label: "computing" },
      { hue: PURPOSE_STYLE.ece, label: "ECE" },
      { hue: PURPOSE_STYLE.me, label: "mechanical" },
      { hue: PURPOSE_STYLE.math, label: "math" },
      { hue: PURPOSE_STYLE.capstone, label: "capstone / project" },
      { hue: PURPOSE_STYLE.other, label: "science / breadth / other" },
    ],
    [],
  );

  return (
    <div className="space-y-7">
      <header className="space-y-3">
        <h1 className="serif text-[22px] font-semibold leading-tight text-[hsl(var(--foreground))]">
          BS in Robotics: WPI vs Michigan, side by side
        </h1>
        <p className="max-w-3xl text-[13px] leading-relaxed text-[hsl(var(--muted-foreground))]">
          The two flagship dedicated robotics degrees, compared on what is actually required, what is
          guaranteed, and how you get in. Course codes verified on each catalog; accreditation is not
          evaluated because robotics has no professional licence.
        </p>
      </header>

      {/* THE HEADLINE FINDING */}
      <section className="rounded-lg p-4" style={{ background: `hsl(${WARN} / 0.06)`, border: `1px solid hsl(${WARN} / 0.35)` }}>
        <div className="flex items-start gap-2.5">
          <BrainCircuit className="mt-0.5 h-[18px] w-[18px] shrink-0" style={{ color: `hsl(${WARN})` }} />
          <div className="space-y-2">
            <h2 className="text-[13px] font-semibold text-[hsl(var(--foreground))]">
              Neither degree requires a machine-learning course
            </h2>
            <p className="text-[12.5px] leading-relaxed text-[hsl(var(--foreground))]">
              This is the most important fact on the page for a robotics-and-AI job target. At WPI, AI/ML
              enters only through electives (RBE 4701 Artificial Intelligence for Robotics, RBE 4540, CS
              4341/4342) against a smaller elective budget. At Michigan, the AI-flavoured intro (ROB 102) is
              only one of three options for a general requirement, but the elective menu is deeper and
              robotics-specific — ROB 429, ROB 430, EECS 442/ROB 432, ROB 530, ROB 535 — with 18 credits of
              technical electives and a Perception and Reasoning for Robotics concentration starting Fall
              2026.
            </p>
            <p className="text-[11.5px] leading-relaxed text-[hsl(var(--muted-foreground))]">
              Read that as: WPI guarantees more robot-building, Michigan offers more room to load up on AI.
              The degree you choose does not by itself deliver the AI depth — the elective plan inside it
              does, exactly like the CMU plan.
            </p>
          </div>
        </div>
      </section>

      {/* ADMISSION */}
      <section className="space-y-2.5">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          <GitBranch className="h-3.5 w-3.5" /> How you actually get in
        </h2>
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel hue={WPI_HUE} title="WPI — apply directly, no gate" sub="Fall 2025 Common Data Set">
            <p className="text-[11.5px] leading-relaxed text-[hsl(var(--muted-foreground))]">{data.admission.wpi}</p>
          </Panel>
          <Panel hue={UMICH_HUE} title="Michigan — admit to the College, declare later" sub="Fall 2025 Common Data Set">
            <p className="text-[11.5px] leading-relaxed text-[hsl(var(--muted-foreground))]">{data.admission.umich}</p>
          </Panel>
        </div>
        <p className="rounded-md p-2.5 text-[11.5px] leading-relaxed text-[hsl(var(--foreground))]"
           style={{ background: `hsl(${DANGER} / 0.05)`, border: `1px solid hsl(${DANGER} / 0.3)` }}>
          The asymmetry is stark: a 61.9% admit rate with no further gate at WPI, versus 16.4% at
          Michigan before any robotics-specific step. But note the direction of Michigan's risk — the
          major is not rationed. You are admitted to the College of Engineering undeclared, and the
          Robotics declaration needs one completed term, a 2.0 GPA and C-or-better in the foundation
          courses. The risk is timing and schedule compression, not exclusion.
        </p>
      </section>

      {/* DIFFERENCES TABLE */}
      <section className="space-y-2.5">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          <AlertTriangle className="h-3.5 w-3.5" /> The differences that matter ({diffs.length})
        </h2>
        <div className="space-y-3">
          {diffs.map((d, i) => (
            <article key={d.dimension} className="rounded-lg p-3.5" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
              <h3 className="text-[12.5px] font-semibold text-[hsl(var(--foreground))]">
                {i + 1}. {d.dimension}
              </h3>
              <div className="mt-2.5 grid gap-2.5 lg:grid-cols-2">
                <div className="rounded-md p-2.5" style={{ background: `hsl(${WPI_HUE} / 0.06)`, border: `1px solid hsl(${WPI_HUE} / 0.25)` }}>
                  <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--foreground))]"><span className="inline-block h-2 w-2 rounded-full" style={{ background: `hsl(${WPI_HUE})` }} />WPI</p>
                  <p className="text-[11.5px] leading-relaxed text-[hsl(var(--foreground))]">{d.wpi}</p>
                </div>
                <div className="rounded-md p-2.5" style={{ background: `hsl(${UMICH_HUE} / 0.06)`, border: `1px solid hsl(${UMICH_HUE} / 0.25)` }}>
                  <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--foreground))]"><span className="inline-block h-2 w-2 rounded-full" style={{ background: `hsl(${UMICH_HUE})` }} />Michigan</p>
                  <p className="text-[11.5px] leading-relaxed text-[hsl(var(--foreground))]">{d.umich}</p>
                </div>
              </div>
              {d.why_it_matters_for_a_robotics_ai_job && (
                <p className="mt-2 border-l-2 pl-2.5 text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]"
                   style={{ borderColor: `hsl(${WARN})` }}>
                  Why it matters for a robotics+AI job: {d.why_it_matters_for_a_robotics_ai_job}
                </p>
              )}
            </article>
          ))}
        </div>
      </section>

      {/* REQUIRED CURRICULUM */}
      <section className="space-y-2.5">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          <GraduationCap className="h-3.5 w-3.5" /> What each degree requires
        </h2>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
          {legend.map(l => (
            <span key={l.label} className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: `hsl(${l.hue})` }} />
              {l.label}
            </span>
          ))}
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel hue={WPI_HUE} title="WPI — RBE required set" sub={wpi.credit_or_unit_system}>
            <KV k="Degree size" v={wpi.total_credits} />
            <KV k="Capstone" v={wpi.capstone?.what} />
            <KV k="Elective structure" v={wpi.elective_structure} />
            <CoreList core={wpi.required_core} open={openWpi} onToggle={() => setOpenWpi(!openWpi)} />
          </Panel>
          <Panel hue={UMICH_HUE} title="Michigan — ROB required set" sub={umich.credit_or_unit_system}>
            <KV k="Degree size" v={umich.total_credits} />
            <KV k="Capstone" v={umich.capstone?.what} />
            <KV k="Elective structure" v={umich.elective_structure} />
            <CoreList core={umich.required_core} open={openUmich} onToggle={() => setOpenUmich(!openUmich)} />
          </Panel>
        </div>
      </section>

      {/* DISTINCTIVE */}
      <section className="space-y-2.5">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          <Building2 className="h-3.5 w-3.5" /> What is genuinely distinctive at each
        </h2>
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel hue={WPI_HUE} title="WPI" sub="">
            <ul className="space-y-1.5">
              {wpi.distinctive.map((x, i) => (
                <li key={i} className="flex gap-2 text-[11.5px] leading-relaxed text-[hsl(var(--foreground))]">
                  <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: `hsl(${WPI_HUE})` }} />
                  {x}
                </li>
              ))}
            </ul>
          </Panel>
          <Panel hue={UMICH_HUE} title="Michigan" sub="">
            <ul className="space-y-1.5">
              {umich.distinctive.map((x, i) => (
                <li key={i} className="flex gap-2 text-[11.5px] leading-relaxed text-[hsl(var(--foreground))]">
                  <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: `hsl(${UMICH_HUE})` }} />
                  {x}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </section>

      {/* SHARED GROUND */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          <Users className="h-3.5 w-3.5" /> Where they are genuinely equivalent ({(data.shared_ground as string[]).length})
        </h2>
        <div className="rounded-lg border border-[hsl(var(--border))] p-3.5">
          <ul className="space-y-1.5">
            {(data.shared_ground as string[]).map((g, i) => (
              <li key={i} className="flex gap-2 text-[11.5px] leading-relaxed text-[hsl(var(--foreground))]">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: `hsl(${GOOD})` }} />
                {g}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <footer className="rounded-lg border border-[hsl(var(--border))] p-4">
        <div className="flex items-start gap-2.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
          <p className="text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">
            {data.note} Admission figures are institution-wide from each Common Data Set 2025-26; Michigan
            does not publish a College of Engineering admit rate. Compiled {data.compiled}.
          </p>
        </div>
      </footer>
    </div>
  );
}
