import { useState, useMemo } from "react";
import { schools, School, stripSourceTags } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import { FitBadge, ArchetypeChips, AccessBadge, HideButton, CostChip, AxisBar, NoteButton, MyRatingChip } from "@/components/SchoolBits";
import { Sparkles, ChevronRight } from "lucide-react";

/**
 * "Why to choose" — a story per school built entirely from the concrete
 * documented facts already in the CSV (score notes + best_fit_reason +
 * notable_ai_institute + notable_undergraduate_research_program +
 * fourplusone_name + recommended_major_route).
 *
 * The point of this page is that a senior can scan it and see, for every
 * school, the two or three sharpest reasons to actually pick it, with the
 * concrete evidence right underneath.
 */

// The scores that most often indicate a "signature strength" (a 5 here is worth mentioning)
const strengthKeys: { key: string; label: string; icon: string }[] = [
  { key: "ai_curriculum_depth", label: "Deep AI curriculum", icon: "🧠" },
  { key: "ai_curriculum_breadth", label: "Broad AI coverage", icon: "📚" },
  { key: "emerging_ai_topics", label: "LLMs / agents / RL taught", icon: "🤖" },
  { key: "undergraduate_research_access", label: "Undergrads get into labs", icon: "🔬" },
  { key: "faculty_mentorship", label: "Real faculty mentorship", icon: "👥" },
  { key: "project_based_learning", label: "Learn by building", icon: "🛠️" },
  { key: "robotics_autonomy_options", label: "Robotics/autonomy path", icon: "🦾" },
  { key: "computing_resources", label: "GPU/compute access", icon: "⚡" },
  { key: "curricular_flexibility", label: "Flexible curriculum", icon: "🎛️" },
  { key: "course_availability", label: "Advanced courses actually run", icon: "📖" },
  { key: "fourplusone_quality", label: "Strong accelerated MS", icon: "🎓" },
  { key: "graduate_school_preparation", label: "Grad-school preparation", icon: "🧪" },
  { key: "industry_preparation", label: "Industry preparation", icon: "💼" },
  { key: "healthy_ambition", label: "Healthy (not cutthroat) ambition", icon: "🕊️" },
  { key: "intellectual_energy", label: "Buzzing intellectual energy", icon: "⚡" },
  { key: "student_agency", label: "Student agency to shape studies", icon: "🧭" },
  { key: "community_within_scale", label: "Finds community even at scale", icon: "🏛️" },
  { key: "technical_club_ecosystem", label: "Strong technical clubs", icon: "🧑‍💻" },
  { key: "non_greek_social_life", label: "Great non-Greek social life", icon: "🎭" },
  { key: "recreation_facilities", label: "Top rec facilities", icon: "🏋️" },
];

// Extract top strengths from a school (score >= 4)
function pickStrengths(s: School, threshold = 4) {
  return strengthKeys
    .map(k => ({ ...k, score: s.scores[k.key], note: s.score_notes[k.key] || "" }))
    .filter(x => typeof x.score === "number" && (x.score as number) >= threshold)
    .sort((a, b) => (b.score as number) - (a.score as number));
}

export default function WhyChoosePage() {
  const { hidden } = useHidden();
  const [sortBy, setSortBy] = useState<"fit"|"depth"|"name">("fit");

  const list = useMemo(() => {
    const arr = schools.filter(s => !hidden.has(s.slug));
    if (sortBy === "name") arr.sort((a,b) => a.short.localeCompare(b.short));
    else if (sortBy === "depth") arr.sort((a,b) => (b.axes.program_depth ?? 0) - (a.axes.program_depth ?? 0));
    else {
      const rank: Record<string, number> = { "TOP FIT": 3, "STRONG FIT": 2, "CONDITIONAL FIT": 1, "LOWER FIT": 0 };
      arr.sort((a,b) => (rank[b.fit_classification] ?? 0) - (rank[a.fit_classification] ?? 0) || a.short.localeCompare(b.short));
    }
    return arr;
  }, [hidden, sortBy]);

  return (
    <div className="space-y-4">
      {/* Intro card */}
      <div className="card p-4 md:p-5 flex items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-[hsl(var(--accent)/0.14)] text-[hsl(var(--accent))]">
            <Sparkles size={18}/>
          </div>
          <div>
            <div className="serif text-[18px] font-semibold">Why to choose — the case for each school</div>
            <div className="text-[12.5px] text-[hsl(var(--muted-foreground))] max-w-2xl leading-relaxed">
              Every school on this list has at least one thing it does uniquely well. This page distills the sharpest reasons to pick each one — with the concrete fact behind each claim.
            </div>
          </div>
        </div>
        <div className="text-[12px] shrink-0">
          <span className="text-[hsl(var(--muted-foreground))] mr-2">Sort</span>
          <select value={sortBy} onChange={e=>setSortBy(e.target.value as any)}
            className="text-[12px] py-1 px-2 rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
            <option value="fit">Fit tier</option>
            <option value="depth">AI curriculum depth</option>
            <option value="name">School name</option>
          </select>
        </div>
      </div>

      {/* One card per school */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {list.map(s => {
          const strengths = pickStrengths(s, 4);
          const top = strengths.slice(0, 5);
          return (
            <div key={s.slug} className="card p-5 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="serif text-[19px] font-semibold leading-tight">{s.short}</div>
                  <div className="text-[11.5px] text-[hsl(var(--muted-foreground))]">{s.city_state} · {s.institution_type.split(",")[0]}</div>
                </div>
                <div className="flex items-center gap-1">
                  <NoteButton slug={s.slug} />
                  <HideButton slug={s.slug} compact />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <FitBadge fit={s.fit_classification} />
                <AccessBadge status={s.major_access_status} />
                <CostChip s={s} />
                <MyRatingChip slug={s.slug} />
              </div>

              {/* The headline sentence */}
              <div className="border-l-2 border-[hsl(var(--accent))] pl-3 py-1">
                <div className="text-[11px] uppercase tracking-wider text-[hsl(var(--accent))] font-medium mb-0.5">Headline reason</div>
                <div className="text-[13.5px] leading-relaxed">{stripSourceTags(s.best_fit_reason)}</div>
              </div>

              {/* Top strengths list */}
              {top.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1.5">What sets it apart</div>
                  <div className="space-y-2">
                    {top.map(str => (
                      <div key={str.key} className="flex gap-2.5">
                        <div className="text-[16px] leading-[1.4]">{str.icon}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className="text-[12.5px] font-medium">{str.label}</span>
                            <span className={`score-cell ${str.score === 5 ? "s5" : "s4"}`}>{str.score}</span>
                          </div>
                          <div className="text-[11.5px] text-[hsl(var(--muted-foreground))] leading-snug">{stripSourceTags(str.note)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Institute + program facts */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11.5px] pt-1">
                <FactBox label="Degree route" value={stripSourceTags(s.degree_name)} />
                {s.notable_ai_institute && s.notable_ai_institute !== "—" &&
                  <FactBox label="AI research home" value={stripSourceTags(s.notable_ai_institute)} />}
                {s.notable_undergraduate_research_program && s.notable_undergraduate_research_program !== "—" &&
                  <FactBox label="UG research program" value={stripSourceTags(s.notable_undergraduate_research_program)} />}
                {s.fourplusone_available && s.fourplusone_available.toLowerCase().startsWith("y") &&
                  <FactBox label="Accelerated master's (4+1)" value={stripSourceTags(s.fourplusone_name) || "Available"} />}
              </div>

              {/* Sparkline of the 7 axes */}
              <div className="pt-1">
                <div className="text-[11px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1.5">Program profile</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  <AxisBar value={s.axes.program_depth} label="AI curriculum" />
                  <AxisBar value={s.axes.research_access} label="Research access" />
                  <AxisBar value={s.axes.robotics_curriculum ?? null} label="Robotics curriculum" />
                  <AxisBar value={s.axes.robotics_access ?? null} label="Robotics access" />
                  <AxisBar value={s.axes.hands_on} label="Hands-on" />
                  <AxisBar value={s.axes.ambition_healthy} label="Healthy ambition" />
                </div>
                <RoboticsDomainChips domains={s.robotics_domains} />
              </div>

              <EcePanel ece={(s as any).ece} />

              <ChevronRight size={12} className="opacity-0"/> {/* spacer */}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Compact chips for the robotics subdomains a school actually covers.
const DOMAIN_LABELS: Record<string, string> = {
  humanoid_legged: "Humanoid / legged",
  swarm_multirobot: "Swarm / multi-robot",
  autonomous_vehicles: "Autonomous vehicles",
  manipulation_grasping: "Manipulation",
  aerial_uav: "Aerial / UAV",
  medical_surgical: "Medical / surgical",
  soft_robotics: "Soft robotics",
  hri: "Human-robot interaction",
  industrial_automation: "Industrial automation",
  space_field: "Space / field",
};

export function RoboticsDomainChips({ domains }: { domains?: Record<string, { coverage: string; lab_or_course?: string | null; url?: string | null }> }) {
  if (!domains) return null;
  const strong = Object.entries(domains).filter(([, v]) => v.coverage === "strong");
  const present = Object.entries(domains).filter(([, v]) => v.coverage === "present");
  if (strong.length === 0 && present.length === 0) return null;
  return (
    <div className="pt-2">
      <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1">Robotics focus areas</div>
      <div className="flex flex-wrap gap-1">
        {strong.map(([k, v]) => (
          <span key={k} className="chip text-[10.5px] py-0"
            style={{ color: "hsl(145 55% 30%)", borderColor: "hsl(145 45% 55%)", background: "hsl(145 55% 30% / 0.08)" }}
            title={v.lab_or_course ? `${DOMAIN_LABELS[k] || k}: ${v.lab_or_course}` : DOMAIN_LABELS[k] || k}>
            {DOMAIN_LABELS[k] || k}
          </span>
        ))}
        {present.map(([k, v]) => (
          <span key={k} className="chip chip-outline text-[10.5px] py-0 opacity-70"
            title={v.lab_or_course ? `${DOMAIN_LABELS[k] || k} (present): ${v.lab_or_course}` : `${DOMAIN_LABELS[k] || k} (present)`}>
            {DOMAIN_LABELS[k] || k}
          </span>
        ))}
      </div>
    </div>
  );
}

function FactBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-[hsl(var(--muted)/0.5)] px-2.5 py-1.5 border border-[hsl(var(--border))]">
      <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">{label}</div>
      <div className="leading-snug">{value}</div>
    </div>
  );
}


/* ------------------------------------------------------------------------- *
 * ECE as an alternative door.
 *
 * The list was built around CS/AI, but ECE is usually EAC-accredited
 * engineering and is often a less gated admit than CS while still carrying
 * controls, embedded systems, perception and hardware for ML. Two cautions are
 * surfaced deliberately rather than buried: schools with no ECE at all, and
 * schools whose NEW ECE degree is not yet EAC-accredited.
 * ------------------------------------------------------------------------- */

const EASIER_META: Record<string, { label: string; hue: string; blurb: string }> = {
  yes: {
    label: "Easier door than CS",
    hue: "var(--fit-strong)",
    blurb: "Published evidence shows the ECE route is less gated than CS here.",
  },
  same: {
    label: "Same door as CS",
    hue: "var(--muted-foreground)",
    blurb: "Admission does not distinguish ECE from CS at this school.",
  },
  no: {
    label: "Harder than CS",
    hue: "var(--fit-lower)",
    blurb: "The ECE route is the more competitive of the two here.",
  },
  unpublished: {
    label: "Not published",
    hue: "var(--score-unk)",
    blurb:
      "This school admits by unit but publishes no per-unit rate, so whether ECE is easier than CS is genuinely unknown — verify with admissions.",
  },
};

const STRUCTURE_LABEL: Record<string, string> = {
  combined_ece: "Combined ECE department",
  separate_ee_and_cpe: "Separate EE and CpE degrees",
  ee_only: "Electrical engineering only",
  eecs_combined_with_cs: "EECS — fused with CS",
  none: "No ECE program",
};

const COVERS_LABEL: Record<string, string> = {
  controls: "Controls",
  embedded: "Embedded",
  perception_cv: "Perception / CV",
  signal_processing: "Signal processing",
  ml_hardware: "ML hardware",
  power: "Power",
  vlsi: "VLSI",
};

function EcePanel({ ece }: { ece?: any }) {
  if (!ece) return null;

  const easier = String(ece.door?.easier_than_cs ?? "unpublished");
  const meta = EASIER_META[easier] ?? EASIER_META.unpublished;
  const covers: string[] = Array.isArray(ece.robotics_ai?.covers) ? ece.robotics_ai.covers : [];
  const courseCount = ece.robotics_ai?.course_count ?? 0;
  const conc = ece.robotics_ai?.concentration_name;
  const abetPending = ece.abet?.pending_or_absent === true;

  // No ECE at all is the single most decision-relevant state, so it replaces
  // the panel rather than rendering an empty shell.
  if (ece.exists === false) {
    return (
      <div className="mt-2 rounded-md border border-dashed p-2.5"
           style={{ borderColor: "hsl(var(--fit-lower))" }}>
        <div className="text-[11px] uppercase tracking-wider font-semibold mb-1"
             style={{ color: "hsl(var(--fit-lower))" }}>
          ECE route · none
        </div>
        <p className="text-[11.5px] leading-snug">{stripSourceTags(ece.vs_cs)}</p>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-md border p-2.5"
         style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.35)" }}>
      <div className="flex items-baseline justify-between gap-2 mb-1.5 flex-wrap">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-[hsl(var(--muted-foreground))]">
          ECE route
        </div>
        <span className="chip chip-outline text-[10px] font-semibold"
              style={{ color: `hsl(${meta.hue})` }}
              title={`${meta.blurb}${ece.door?.easier_than_cs_basis ? "\n\n" + ece.door.easier_than_cs_basis : ""}`}>
          {meta.label}
        </span>
      </div>

      <div className="flex flex-wrap gap-1 mb-1.5 items-center">
        <span className="chip text-[10px]">{STRUCTURE_LABEL[ece.structure] ?? ece.structure}</span>
        <span className="chip text-[10px]"
              style={ece.abet?.eac_accredited
                ? { color: "hsl(var(--fit-strong))" }
                : { color: "hsl(var(--fit-lower))" }}
              title={ece.abet?.quote || undefined}>
          {ece.abet?.eac_accredited ? "ABET EAC" : abetPending ? "ABET pending / absent" : "Not EAC"}
        </span>
        {courseCount > 0 && (
          <span className="chip text-[10px]">{courseCount} robotics/AI course{courseCount === 1 ? "" : "s"}</span>
        )}
      </div>

      {abetPending && ece.abet?.quote && (
        <p className="text-[10.5px] leading-snug mb-1.5 pl-2 border-l-2"
           style={{ borderColor: "hsl(var(--fit-lower))", color: "hsl(var(--fit-lower))" }}>
          {stripSourceTags(ece.abet.quote)}
        </p>
      )}

      {conc && (
        <div className="text-[11px] mb-1">
          <span className="text-[hsl(var(--muted-foreground))]">Track: </span>{stripSourceTags(conc)}
        </div>
      )}

      {covers.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {covers.map(c => (
            <span key={c} className="chip chip-outline text-[9.5px]">{COVERS_LABEL[c] ?? c}</span>
          ))}
        </div>
      )}

      {ece.door?.how_you_enter && (
        <p className="text-[11px] leading-snug text-[hsl(var(--muted-foreground))] mb-1">
          <span className="font-medium text-[hsl(var(--foreground))]">Getting in: </span>
          {stripSourceTags(ece.door.how_you_enter)}
        </p>
      )}

      {ece.vs_cs && <p className="text-[11.5px] leading-snug">{stripSourceTags(ece.vs_cs)}</p>}
    </div>
  );
}
