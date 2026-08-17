import { useState, useMemo } from "react";
import { schools } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import { NoteButton, AbetBadge } from "@/components/SchoolBits";
import roboticsPaths from "@/data/robotics_paths.json";
import { Bot, ExternalLink, Search, Filter, Cog, Cpu, Wrench, Trophy, Download, Building2, AlertTriangle, Info, ShieldCheck, HelpCircle } from "lucide-react";

type Row = typeof roboticsPaths.schools[keyof typeof roboticsPaths.schools];

const easierColor: Record<string, string> = {
  "Yes": "chip-primary",
  "Similar": "chip-outline",
  "No": "chip-outline",
};

const easierTone: Record<string, string> = {
  "Yes": "hsl(145 55% 35%)",
  "Similar": "hsl(30 60% 40%)",
  "No": "hsl(0 60% 45%)",
};

export default function RoboticsPathsPage() {
  const { hidden } = useHidden();
  const [q, setQ] = useState("");
  const [onlyBSRobotics, setOnlyBSRobotics] = useState(false);
  const [onlyEasier, setOnlyEasier] = useState(false);
  const [onlyMaterialUniv, setOnlyMaterialUniv] = useState(false);
  const [onlyMaterialGate, setOnlyMaterialGate] = useState(false);
  const [onlyMechatronics, setOnlyMechatronics] = useState(false);

  const rows = useMemo(() => {
    const list = schools
      .filter(s => !hidden.has(s.slug))
      .map(s => ({ s, d: (roboticsPaths.schools as any)[s.slug] as Row | undefined }))
      .filter((x): x is { s: typeof schools[number]; d: Row } => !!x.d);
    return list.filter(({ s, d }) => {
      const dx = d as any;
      if (onlyBSRobotics && d.has_bs_robotics === "No") return false;
      if (onlyEasier && d.robotics_easier_than_cs !== "Yes") return false;
      if (onlyMaterialUniv && dx.university_admit_differential !== "YES-MATERIAL") return false;
      if (onlyMaterialGate && dx.internal_gate_differential !== "YES-MATERIAL") return false;
      if (onlyMechatronics && !(dx.has_mechatronics_bs || dx.has_mechatronics_track)) return false;
      if (q.trim()) {
        const needle = q.toLowerCase();
        const hay = `${s.short} ${d.bs_robotics_name || ""} ${d.me_robotics_track_name || ""} ${d.ecs_robotics_alt || ""} ${dx.admission_strategy || ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [q, hidden, onlyBSRobotics, onlyEasier, onlyMaterialUniv, onlyMaterialGate, onlyMechatronics]);

  const bsRoboticsCount = Object.values(roboticsPaths.schools).filter((x: any) => x.has_bs_robotics.startsWith("Yes")).length;
  const meTrackCount = Object.values(roboticsPaths.schools).filter((x: any) => x.me_robotics_track_name).length;
  const easierCount = Object.values(roboticsPaths.schools).filter((x: any) => x.robotics_easier_than_cs === "Yes").length;
  // NEW: bucket counts for the strategy summary card
  const univMaterial = Object.values(roboticsPaths.schools).filter((x: any) => x.university_admit_differential === "YES-MATERIAL").length;
  const univModest = Object.values(roboticsPaths.schools).filter((x: any) => x.university_admit_differential === "YES-MODEST").length;
  const gateMaterial = Object.values(roboticsPaths.schools).filter((x: any) => x.internal_gate_differential === "YES-MATERIAL").length;
  // NEW: broader strategy dimension counts
  const earlyLarge = Object.values(roboticsPaths.schools).filter((x: any) => x.early_admit_lift_verdict === "LARGE").length;
  const oosNC = Object.values(roboticsPaths.schools).filter((x: any) => (x.nc_applicant_note || "").includes("MAJOR ADVANTAGE") || (x.nc_applicant_note || "").includes("friendliest")).length;
  const tier1 = Object.values(roboticsPaths.schools).filter((x: any) => x.robotics_ecosystem_tier === "TIER_1").length;
  const tier2 = Object.values(roboticsPaths.schools).filter((x: any) => x.robotics_ecosystem_tier === "TIER_2").length;
  const mechaBS = Object.values(roboticsPaths.schools).filter((x: any) => x.has_mechatronics_bs === true).length;
  const mechaEasier = Object.values(roboticsPaths.schools).filter((x: any) => x.mechatronics_admit_vs_me === "EASIER-MATERIAL").length;
  const mechaFit = Object.values(roboticsPaths.schools).filter((x: any) => x.mechatronics_advantage_verdict === "STRONG_ROBOTICS_FIT").length;

  const exportJSON = () => {
    const payload = {
      version: 1,
      exported_at: new Date().toISOString(),
      source: "College Compass — Robotics Paths",
      note: roboticsPaths.note,
      compiled_date: roboticsPaths.compiled_date,
      counts: { dedicated_bs_robotics: bsRoboticsCount, me_robotics_track: meTrackCount, robotics_easier_than_cs: easierCount, total_schools: rows.length },
      schools: rows.map(({ s, d }) => ({
        slug: s.slug,
        name: s.short,
        city_state: s.city_state,
        fit: s.fit_classification,
        has_bs_robotics: d.has_bs_robotics,
        bs_robotics_name: d.bs_robotics_name,
        bs_robotics_year_started: d.bs_robotics_year_started,
        bs_robotics_size: d.bs_robotics_size,
        bs_robotics_admit: d.bs_robotics_admit,
        bs_robotics_url: d.bs_robotics_url,
        me_robotics_track_name: d.me_robotics_track_name,
        me_robotics_courses: d.me_robotics_courses,
        me_robotics_url: d.me_robotics_url,
        ecs_robotics_alt: d.ecs_robotics_alt,
        robotics_easier_than_cs: d.robotics_easier_than_cs,
        robotics_easier_than_cs_reason: d.robotics_easier_than_cs_reason,
        university_admit_differential: (d as any).university_admit_differential,
        university_admit_differential_reason: (d as any).university_admit_differential_reason,
        university_admit_differential_source: (d as any).university_admit_differential_source,
        internal_gate_differential: (d as any).internal_gate_differential,
        internal_gate_differential_reason: (d as any).internal_gate_differential_reason,
        internal_gate_differential_source: (d as any).internal_gate_differential_source,
        admission_strategy: (d as any).admission_strategy,
        early_admit_lift_verdict: (d as any).early_admit_lift_verdict,
        early_admit_lift_reason: (d as any).early_admit_lift_reason,
        early_admit_lift_source: (d as any).early_admit_lift_source,
        offers_ED: (d as any).offers_ED,
        offers_ED2: (d as any).offers_ED2,
        offers_EA: (d as any).offers_EA,
        best_early_deadline: (d as any).best_early_deadline,
        oos_gap_verdict: (d as any).oos_gap_verdict,
        oos_gap_reason: (d as any).oos_gap_reason,
        nc_applicant_note: (d as any).nc_applicant_note,
        oos_gap_source: (d as any).oos_gap_source,
        robotics_ecosystem_tier: (d as any).robotics_ecosystem_tier,
        robotics_ecosystem_reason: (d as any).robotics_ecosystem_reason,
        undergrad_research_program: (d as any).undergrad_research_program,
        coop_pipeline: (d as any).coop_pipeline,
        robotics_ecosystem_source: (d as any).robotics_ecosystem_source,
        has_mechatronics_bs: (d as any).has_mechatronics_bs,
        mechatronics_bs_name: (d as any).mechatronics_bs_name,
        mechatronics_bs_url: (d as any).mechatronics_bs_url,
        has_mechatronics_track: (d as any).has_mechatronics_track,
        has_mechatronics_minor: (d as any).has_mechatronics_minor,
        mechatronics_admit_vs_me: (d as any).mechatronics_admit_vs_me,
        mechatronics_advantage_verdict: (d as any).mechatronics_advantage_verdict,
        mechatronics_summary: (d as any).mechatronics_summary,
        mechatronics_source: (d as any).mechatronics_source,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `college-compass-robotics-paths-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportMarkdown = () => {
    const lines: string[] = [
      `# Robotics paths across ${rows.length} schools`,
      `_Exported ${new Date().toLocaleString()} · data compiled ${roboticsPaths.compiled_date}_`,
      "",
      `**${bsRoboticsCount}** schools with a dedicated BS Robotics · **${meTrackCount}** with an ME + Robotics track · **${easierCount}** where robotics is an easier admit than CS.`,
      "",
      "> " + roboticsPaths.note.replace(/\n/g, "\n> "),
      "",
    ];

    // Group by dedicated BS first, then ME track only, then neither
    const withBS = rows.filter(r => (r.d.has_bs_robotics || "").startsWith("Yes"));
    const meOnly = rows.filter(r => !(r.d.has_bs_robotics || "").startsWith("Yes") && r.d.me_robotics_track_name);
    const neither = rows.filter(r => !(r.d.has_bs_robotics || "").startsWith("Yes") && !r.d.me_robotics_track_name);

    const writeSection = (title: string, group: typeof rows) => {
      if (!group.length) return;
      lines.push(`## ${title}`, "");
      group.forEach(({ s, d }) => {
        lines.push(`### ${s.short} — ${s.city_state}`);
        lines.push(`_${s.fit_classification}${d.robotics_easier_than_cs === "Yes" ? " · robotics is an easier admit than CS" : d.robotics_easier_than_cs === "No" ? " · robotics NOT easier than CS" : " · robotics similar to CS"}_`);
        lines.push("");
        if ((d.has_bs_robotics || "").startsWith("Yes") && d.bs_robotics_name) {
          lines.push(`**Dedicated BS Robotics:** ${d.bs_robotics_name}`);
          const bits: string[] = [];
          if (d.bs_robotics_admit) bits.push(d.bs_robotics_admit === "Not published" ? "admit path not published" : `${d.bs_robotics_admit} admit`);
          if (d.bs_robotics_year_started) bits.push(`est. ${d.bs_robotics_year_started}`);
          if (d.bs_robotics_size) bits.push(`${d.bs_robotics_size} majors`);
          if (bits.length) lines.push(`- ${bits.join(" · ")}`);
          if (d.bs_robotics_url) lines.push(`- [Program page](${d.bs_robotics_url})`);
          lines.push("");
        }
        if (d.me_robotics_track_name) {
          lines.push(`**ME + Robotics track:** ${d.me_robotics_track_name}`);
          if (d.me_robotics_courses && d.me_robotics_courses.length) {
            lines.push(`- Courses: ${d.me_robotics_courses.join("; ")}`);
          }
          if (d.me_robotics_url) lines.push(`- [Track page](${d.me_robotics_url})`);
          lines.push("");
        }
        if (d.ecs_robotics_alt) {
          lines.push(`**Alt paths:** ${d.ecs_robotics_alt}`);
          lines.push("");
        }
        if (d.robotics_easier_than_cs_reason) {
          lines.push(`> ${d.robotics_easier_than_cs_reason}`);
          lines.push("");
        }
        if ((d as any).admission_strategy) {
          lines.push(`**Admissions strategy:** ${(d as any).admission_strategy}`);
          lines.push("");
          const uv = (d as any).university_admit_differential;
          const uvR = (d as any).university_admit_differential_reason;
          const uvS = (d as any).university_admit_differential_source;
          if (uv) {
            lines.push(`- **University-admissions differential:** ${verdictLabels[uv] || uv}${uvR ? " — " + uvR : ""}${uvS ? ` [source](${uvS})` : ""}`);
          }
          const gv = (d as any).internal_gate_differential;
          const gvR = (d as any).internal_gate_differential_reason;
          const gvS = (d as any).internal_gate_differential_source;
          if (gv) {
            lines.push(`- **Internal-gate differential:** ${verdictLabels[gv] || gv}${gvR ? " — " + gvR : ""}${gvS ? ` [source](${gvS})` : ""}`);
          }
          lines.push("");
        }
        lines.push("---", "");
      });
    };

    writeSection(`Schools with a dedicated BS in Robotics (${withBS.length})`, withBS);
    writeSection(`Schools with an ME + Robotics track only (${meOnly.length})`, meOnly);
    writeSection(`Schools with neither documented (${neither.length})`, neither);

    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `robotics-paths-${new Date().toISOString().slice(0,10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCSV = () => {
    // CSV for spreadsheet import
    const esc = (v: any) => {
      if (v == null) return "";
      const s = Array.isArray(v) ? v.join("; ") : String(v);
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const header = ["slug","school","city_state","fit","has_bs_robotics","bs_robotics_name","bs_robotics_year_started","bs_robotics_size","bs_robotics_admit","bs_robotics_url","me_robotics_track_name","me_robotics_courses","me_robotics_url","ecs_robotics_alt","robotics_easier_than_cs","robotics_easier_than_cs_reason","university_admit_differential","university_admit_differential_reason","university_admit_differential_source","internal_gate_differential","internal_gate_differential_reason","internal_gate_differential_source","admission_strategy","early_admit_lift_verdict","early_admit_lift_reason","best_early_deadline","early_admit_lift_source","oos_gap_verdict","oos_gap_reason","nc_applicant_note","oos_gap_source","robotics_ecosystem_tier","robotics_ecosystem_reason","undergrad_research_program","coop_pipeline","robotics_ecosystem_source","has_mechatronics_bs","mechatronics_bs_name","mechatronics_bs_url","has_mechatronics_track","has_mechatronics_minor","mechatronics_admit_vs_me","mechatronics_advantage_verdict","mechatronics_summary","mechatronics_source"];
    const csvLines = [header.join(",")];
    rows.forEach(({ s, d }) => {
      const dx = d as any;
      csvLines.push([
        s.slug, s.short, s.city_state, s.fit_classification,
        d.has_bs_robotics, d.bs_robotics_name, d.bs_robotics_year_started, d.bs_robotics_size,
        d.bs_robotics_admit, d.bs_robotics_url,
        d.me_robotics_track_name, d.me_robotics_courses, d.me_robotics_url,
        d.ecs_robotics_alt, d.robotics_easier_than_cs, d.robotics_easier_than_cs_reason,
        dx.university_admit_differential, dx.university_admit_differential_reason, dx.university_admit_differential_source,
        dx.internal_gate_differential, dx.internal_gate_differential_reason, dx.internal_gate_differential_source,
        dx.admission_strategy,
        dx.early_admit_lift_verdict, dx.early_admit_lift_reason, dx.best_early_deadline, dx.early_admit_lift_source,
        dx.oos_gap_verdict, dx.oos_gap_reason, dx.nc_applicant_note, dx.oos_gap_source,
        dx.robotics_ecosystem_tier, dx.robotics_ecosystem_reason, dx.undergrad_research_program, dx.coop_pipeline, dx.robotics_ecosystem_source,
        dx.has_mechatronics_bs, dx.mechatronics_bs_name, dx.mechatronics_bs_url, dx.has_mechatronics_track, dx.has_mechatronics_minor,
        dx.mechatronics_admit_vs_me, dx.mechatronics_advantage_verdict, dx.mechatronics_summary, dx.mechatronics_source,
      ].map(esc).join(","));
    });
    const blob = new Blob([csvLines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `robotics-paths-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="card p-5">
        <div className="flex items-baseline gap-2 text-[hsl(var(--accent))]">
          <Bot size={16}/>
          <div className="text-[11px] tracking-wider uppercase">Robotics paths</div>
        </div>
        <h2 className="serif text-[22px] font-semibold mt-1">Three routes into robotics — CS-AI, ME, or a dedicated Robotics BS</h2>
        <p className="text-[13.5px] text-[hsl(var(--muted-foreground))] mt-2 leading-relaxed max-w-[820px]">
          CS is often the hardest way into robotics. Many schools have a documented ME + Robotics track with no competitive gate, and a growing number offer a <em>dedicated</em> BS in Robotics — WPI (2007), Michigan-Dearborn (2014), Virginia Tech (2020), Michigan (2022), CMU (2023), Maryland-Shady Grove (2024), plus RPI, Purdue Polytechnic, RIT and Kettering. This page compares all three routes at every school on the list.
        </p>
        <div className="mt-4 flex flex-wrap gap-4 text-[12.5px]">
          <div><span className="num text-[18px] font-semibold text-[hsl(var(--fit-strong))]">{bsRoboticsCount}</span><span className="text-[hsl(var(--muted-foreground))]"> of {Object.keys(roboticsPaths.schools).length} have a dedicated BS Robotics</span></div>
          <div><span className="num text-[18px] font-semibold text-[hsl(var(--accent))]">{meTrackCount}</span><span className="text-[hsl(var(--muted-foreground))]"> have an ME + Robotics track</span></div>
          <div><span className="num text-[18px] font-semibold text-[hsl(var(--fit-top))]">{easierCount}</span><span className="text-[hsl(var(--muted-foreground))]"> where robotics is easier admit than CS</span></div>
        </div>

        {/* NEW: Mechatronics fourth-route card */}
        <div className="mt-5 rounded-lg bg-[hsl(var(--fit-top)/0.08)] border border-[hsl(var(--fit-top)/0.3)] p-4">
          <div className="flex items-baseline gap-2 mb-2">
            <Cog size={14} className="text-[hsl(var(--fit-top))]"/>
            <div className="text-[11px] tracking-wider uppercase text-[hsl(var(--fit-top))]">Mechatronics — the fourth robotics route</div>
          </div>
          <p className="text-[13px] leading-relaxed mb-3">
            Mechatronics = ME + ECE + control/embedded systems, deliberately blended. At some schools it's a full BS, at others a formal ME track, and at most it's absent. When it exists as a real degree, it's often <strong>curricularly closer to robotics than plain ME</strong> and sometimes lives in a less-competitive admissions pool than the traditional engineering college.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-md bg-[hsl(var(--card))] p-3 border border-[hsl(var(--border))]">
              <div className="text-[10.5px] uppercase tracking-wider font-medium mb-1">Dedicated BS Mechatronics</div>
              <div className="text-[12px] leading-snug text-[hsl(var(--muted-foreground))]">
                <strong className="text-[hsl(var(--foreground))]">{mechaBS} schools:</strong> Maryland (Shady Grove, launched 2024), NC State (joint w/ UNC Asheville), Kettering, Purdue (Polytechnic), RIT, Penn State (EMET), TAMU (MXET), Northeastern (degree-completion only — not first-year).
              </div>
            </div>
            <div className="rounded-md bg-[hsl(var(--card))] p-3 border border-[hsl(var(--border))]">
              <div className="text-[10.5px] uppercase tracking-wider font-medium mb-1">Easier admit than ME</div>
              <div className="text-[12px] leading-snug text-[hsl(var(--muted-foreground))]">
                <strong className="text-[hsl(var(--foreground))]">{mechaEasier} schools</strong> with measurably easier mechatronics admit: <strong>Purdue Polytechnic Mechatronics ET 54% admit</strong> (vs CoE ME 46%), and <strong>Northeastern Lowell Institute Mechatronics BS</strong> (but that's degree-completion, not freshman). Trade-off at both: ETAC/ABET (engineering technology) accreditation instead of EAC/ABET.
              </div>
            </div>
            <div className="rounded-md bg-[hsl(var(--card))] p-3 border border-[hsl(var(--border))]">
              <div className="text-[10.5px] uppercase tracking-wider font-medium mb-1">Better fit for robotics than ME</div>
              <div className="text-[12px] leading-snug text-[hsl(var(--muted-foreground))]">
                <strong className="text-[hsl(var(--foreground))]">{mechaFit} schools</strong> where mechatronics curriculum is a stronger robotics prep than ME: <strong>Maryland</strong>, <strong>NC State</strong>, <strong>UW Seattle ME-Mechatronics option</strong>, <strong>TAMU MXET</strong>, <strong>Kettering</strong>, <strong>Purdue Polytechnic</strong>, <strong>RIT MET</strong>, <strong>Olin</strong> (whole degree is mechatronics-flavored).
              </div>
            </div>
          </div>
          <div className="mt-3 text-[11.5px] text-[hsl(var(--muted-foreground))] italic">
            <AlertTriangle size={10} className="inline text-[hsl(var(--fit-conditional))] mr-1"/>
            <strong>Watch out:</strong> Virginia Tech's Robotics and Mechatronics major was CLOSED to new declarations in January 2026 — do not apply expecting this route. UW Seattle's Mechatronics option requires a junior-year competitive application (not guaranteed after ME admission).
          </div>
          <div className="mt-1.5 text-[11.5px] text-[hsl(var(--muted-foreground))]">
            <Info size={10} className="inline mr-1 opacity-70"/>
            For reference: Penn State EMET and TAMU MXET are Engineering Technology (ETAC/ABET) rather
            than EAC. That shapes how applied the coursework is, but nothing in a robotics or AI career
            turns on it — see the accreditation panel below.
          </div>
        </div>

        {/* Broader strategy card - 3 dimensions beyond CS-vs-ME */}
        <div className="mt-5 rounded-lg bg-[hsl(var(--fit-strong)/0.06)] border border-[hsl(var(--fit-strong)/0.25)] p-4">
          <div className="flex items-baseline gap-2 mb-2">
            <Trophy size={14} className="text-[hsl(var(--fit-strong))]"/>
            <div className="text-[11px] tracking-wider uppercase text-[hsl(var(--fit-strong))]">Broader admission-strategy levers</div>
          </div>
          <p className="text-[13px] leading-relaxed mb-3">
            Beyond CS-vs-ME framing, three structural levers usually move the needle more than any individual applicant essay: <strong>early-plan timing</strong>, <strong>state residency</strong>, and <strong>which robotics ecosystem you actually land in</strong>.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-md bg-[hsl(var(--card))] p-3 border border-[hsl(var(--border))]">
              <div className="text-[10.5px] uppercase tracking-wider font-medium mb-1">Early Decision / Early Action lift</div>
              <div className="text-[12px] leading-snug text-[hsl(var(--muted-foreground))]">
                <strong className="text-[hsl(var(--foreground))]">{earlyLarge} schools</strong> where the early round is ≥2× the RD rate. Biggest: <strong>Northeastern ED ~8.8×</strong>, <strong>Duke ED 3×</strong>, <strong>Swarthmore ED 2.8×</strong>, <strong>UNC EA 2.3×</strong>, <strong>WPI ED 2.2×</strong>.
              </div>
            </div>
            <div className="rounded-md bg-[hsl(var(--card))] p-3 border border-[hsl(var(--border))]">
              <div className="text-[10.5px] uppercase tracking-wider font-medium mb-1">NC residency advantage</div>
              <div className="text-[12px] leading-snug text-[hsl(var(--muted-foreground))]">
                <strong className="text-[hsl(var(--foreground))]">{oosNC} schools</strong> where NC residency is a structural advantage: <strong>UNC-CH</strong> (NC 37% vs OOS 9.6%, 18% OOS cap) and <strong>NC State</strong> (NC 46% vs OOS 34%, 18% cap). Meanwhile UT-Austin, Berkeley, UGA-Tech, UW-Seattle CS all have massive OOS gaps that hurt NC applicants.
              </div>
            </div>
            <div className="rounded-md bg-[hsl(var(--card))] p-3 border border-[hsl(var(--border))]">
              <div className="text-[10.5px] uppercase tracking-wider font-medium mb-1">Robotics-ecosystem depth</div>
              <div className="text-[12px] leading-snug text-[hsl(var(--muted-foreground))]">
                <strong className="text-[hsl(var(--foreground))]">{tier1} Tier-1</strong> (world-class robotics research): CMU, MIT, Georgia Tech, Michigan, Berkeley, UT Austin, Maryland. <strong>{tier2} Tier-2</strong>: Penn, UIUC, WPI, JHU, UW Seattle, Texas A&amp;M.
              </div>
            </div>
          </div>
        </div>

        {/* Existing: CS-vs-ME admissions strategy summary */}
        <div className="mt-3 rounded-lg bg-[hsl(var(--accent)/0.06)] border border-[hsl(var(--accent)/0.25)] p-4">
          <div className="flex items-baseline gap-2 mb-2">
            <ShieldCheck size={14} className="text-[hsl(var(--accent))]"/>
            <div className="text-[11px] tracking-wider uppercase text-[hsl(var(--accent))]">Admissions-strategy summary</div>
          </div>
          <p className="text-[13px] leading-relaxed mb-2">
            Two different questions to keep separate: (1) does applying via robotics/ME give you a <strong>materially different bar at the admissions office</strong>, and (2) once admitted, is the robotics/ME path <strong>less gated internally</strong> than CS?
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <div className="rounded-md bg-[hsl(var(--card))] p-3 border border-[hsl(var(--border))]">
              <div className="flex items-center gap-1.5 mb-1">
                <Building2 size={13} className="text-[hsl(var(--fit-top))]"/>
                <div className="text-[10.5px] uppercase tracking-wider font-medium">University-admissions differential</div>
              </div>
              <div className="text-[12px] leading-snug text-[hsl(var(--muted-foreground))]">
                <strong className="text-[hsl(var(--foreground))]">{univMaterial} schools</strong> where robotics/ME is a <em>materially</em> easier admit than CS (CMU, Georgia Tech, UIUC, Berkeley, UW).
                <strong className="text-[hsl(var(--foreground))]"> {univModest} schools</strong> where it's <em>modestly</em> easier (RIT, Illinois Tech, UT Austin).
              </div>
            </div>
            <div className="rounded-md bg-[hsl(var(--card))] p-3 border border-[hsl(var(--border))]">
              <div className="flex items-center gap-1.5 mb-1">
                <Trophy size={13} className="text-[hsl(var(--fit-strong))]"/>
                <div className="text-[10.5px] uppercase tracking-wider font-medium">Internal-gate differential</div>
              </div>
              <div className="text-[12px] leading-snug text-[hsl(var(--muted-foreground))]">
                <strong className="text-[hsl(var(--foreground))]">{gateMaterial} schools</strong> where the ME/robotics path is materially less gated once you're on campus (CMU CoE, Cornell ME affiliation, Purdue FYE, Georgia Tech, UMD, Berkeley, UW).
                <span className="block mt-1"><AlertTriangle size={10} className="inline text-[hsl(var(--fit-lower))] mr-1"/> Watch out: Virginia Tech and Florida <em>reverse</em> this — ME is HARDER internally than CS.</span>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 items-center">
          <span className="text-[11px] text-[hsl(var(--muted-foreground))] mr-1">Export {rows.length === Object.keys(roboticsPaths.schools).length ? "all" : `these ${rows.length}`} schools:</span>
          <button onClick={exportJSON} title="Machine-readable JSON with all robotics-path data + citations"
            className="chip chip-outline inline-flex items-center gap-1 hover:bg-[hsl(var(--elevate-1))]">
            <Download size={11}/> JSON
          </button>
          <button onClick={exportCSV} title="Spreadsheet-friendly CSV — open in Excel or Google Sheets"
            className="chip chip-outline inline-flex items-center gap-1 hover:bg-[hsl(var(--elevate-1))]">
            <Download size={11}/> CSV
          </button>
          <button onClick={exportMarkdown} title="Human-readable Markdown for sharing with family or counselor"
            className="chip chip-outline inline-flex items-center gap-1 hover:bg-[hsl(var(--elevate-1))]">
            <Download size={11}/> Markdown
          </button>
        </div>
        <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] mt-2 leading-relaxed">
          Exports respect your current filters and hidden-school selection. JSON preserves all fields and citation URLs; CSV opens in Excel; Markdown groups schools by whether they have a BS, ME track, or neither.
        </div>
      </div>

      {/* Accreditation of robotics-titled credentials */}
      <AccreditationPanel />

      {/* Robotics subdomain coverage matrix */}
      <DomainMatrix />

      {/* Filters */}
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"/>
          <input value={q} onChange={e=>setQ(e.target.value)}
            className="w-full pl-8 pr-2 py-1.5 text-[13px] rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))]"
            placeholder="Search program name, track, or school…"/>
        </div>
        <label className="flex items-center gap-1.5 text-[12px] cursor-pointer">
          <input type="checkbox" checked={onlyBSRobotics} onChange={e=>setOnlyBSRobotics(e.target.checked)}/>
          Only schools with dedicated BS Robotics
        </label>
        <label className="flex items-center gap-1.5 text-[12px] cursor-pointer">
          <input type="checkbox" checked={onlyEasier} onChange={e=>setOnlyEasier(e.target.checked)}/>
          Only where robotics is easier admit than CS
        </label>
        <label className="flex items-center gap-1.5 text-[12px] cursor-pointer">
          <input type="checkbox" checked={onlyMaterialUniv} onChange={e=>setOnlyMaterialUniv(e.target.checked)}/>
          Only material univ-admissions differential
        </label>
        <label className="flex items-center gap-1.5 text-[12px] cursor-pointer">
          <input type="checkbox" checked={onlyMaterialGate} onChange={e=>setOnlyMaterialGate(e.target.checked)}/>
          Only material internal-gate differential
        </label>
        <label className="flex items-center gap-1.5 text-[12px] cursor-pointer">
          <input type="checkbox" checked={onlyMechatronics} onChange={e=>setOnlyMechatronics(e.target.checked)}/>
          Only schools with mechatronics BS or track
        </label>
        <div className="text-[11px] text-[hsl(var(--muted-foreground))] flex items-center gap-1"><Filter size={11}/>{rows.length} shown</div>
      </div>

      {/* Rows */}
      <div className="space-y-3">
        {rows.map(({ s, d }) => <RoboticsPathCard key={s.slug} school={s} data={d as any}/>)}
      </div>

      <div className="card p-3 text-[11px] text-[hsl(var(--muted-foreground))]">
        Compiled Aug 2026 from each school's official catalog and departmental pages. "Easier admit than CS" is analyst judgment based on documented direct-admit rules, secondary-admission gates, and general reputation — always verify with the school's own admissions FAQ.
      </div>
    </div>
  );
}

function RoboticsPathCard({ school, data }: { school: typeof schools[number]; data: Row }) {
  const hasBS = data.has_bs_robotics?.startsWith("Yes");
  const hasME = !!data.me_robotics_track_name;

  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h3 className="serif text-[16.5px] font-semibold">{school.short}</h3>
          <AbetBadge credential={school.robotics_credential} />
          <div className="text-[11.5px] text-[hsl(var(--muted-foreground))]">{school.city_state}</div>
          <NoteButton slug={school.slug}/>
        </div>
        {data.robotics_easier_than_cs && (
          <span className={`chip ${easierColor[data.robotics_easier_than_cs] || "chip-outline"} inline-flex items-center gap-1`}
            style={{ color: easierTone[data.robotics_easier_than_cs] }}
            title={data.robotics_easier_than_cs_reason || undefined}>
            <Trophy size={11}/> {data.robotics_easier_than_cs === "Yes" ? "Easier than CS" : data.robotics_easier_than_cs === "No" ? "Not easier" : "Similar to CS"}
          </span>
        )}
      </div>

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
            <div className="text-[10.5px] uppercase tracking-wider font-medium">Alt paths & note</div>
          </div>
          <div className="text-[12px] leading-snug">{data.ecs_robotics_alt || "n.a."}</div>
        </div>
      </div>

      {data.robotics_easier_than_cs_reason && (
        <div className="mt-3 pt-2 border-t border-[hsl(var(--border))]">
          <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-0.5">Why {data.robotics_easier_than_cs === "Yes" ? "robotics is easier" : "the comparison"}</div>
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
              label="At the university admissions office"
              verdict={(data as any).university_admit_differential}
              reason={(data as any).university_admit_differential_reason}
              source={(data as any).university_admit_differential_source}
            />
            <DifferentialCell
              label="Once admitted (internal gate)"
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
              <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Admit vs ME: </span>
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
            <div className="text-[10.5px] uppercase tracking-wider font-medium text-[hsl(var(--fit-strong))]">Broader strategy levers</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <StrategyLever
              label="ED/EA lift"
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
  "YES-MATERIAL":  "Materially easier via robotics/ME",
  "YES-MODEST":    "Modestly easier via robotics/ME",
  "SAME":          "Same bar",
  "MORE_GATED":    "ME/robotics is HARDER than CS",
  "NOT_PUBLISHED": "Not published",
  "N/A":           "Not applicable",
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
    label = v === "EASIER-MATERIAL" ? "Materially easier than ME" :
            v === "EASIER-MODEST"   ? "Modestly easier than ME" :
            v === "SAME"            ? "Same admissions bar as ME" :
            v === "HARDER"          ? "Harder than ME" :
            v === "NOT_PUBLISHED"   ? "Not published" : "N/A";
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
  LARGE: "Large early lift (≥2× RD)",
  MODERATE: "Moderate early lift (1.3-2×)",
  SMALL: "Small early lift (<1.3×)",
  NONE: "No early plan or no lift",
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
 * 10 researched subdomains x 33 schools. Coverage is strong / present /
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
        Coverage was researched from first-party department, lab and catalog pages, with 408 sources recorded across
        the {rows.length} schools shown. A blank cell means nothing published was found — not that the school does no
        work in that area. Several pages blocked automated reading (MIT robotics, UF's Machine Intelligence Lab), so
        equivalent first-party evidence was substituted; those substitutions are noted in the research files.
        Virginia Tech's robotics coverage reflects an option that stops accepting new declarations after January 2026.
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
        <strong className="text-[hsl(var(--foreground))]">Read this as background, not as a
        ranking.</strong> Robotics and AI are unlicensed fields: no certificate or licence depends on
        which ABET commission accredited a degree, and employers and CS and robotics graduate programs
        do not filter on it. What the commission does tell you is the flavour of the coursework.{" "}
        <strong className="text-[hsl(var(--foreground))]">EAC</strong> covers engineering degrees
        (theory and calculus-heavy). <strong className="text-[hsl(var(--foreground))]">ETAC</strong>{" "}
        covers engineering technology (applied and hands-on). Purdue's "Robotics Engineering
        Technology" and RIT's "Robotics and Manufacturing Engineering Technology" both contain the word
        engineering and are both ETAC. Every entry below was checked against the school's own
        accreditation page or catalog — click a school to open its source.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
        <Group title="ABET EAC — engineering" items={eac} tone="var(--fit-strong)">
          The robotics-titled credential is a full engineering degree: theory-heavy, and the cleanest
          route to PE licensure if you ever want it.
        </Group>
        <Group title="ABET ETAC — engineering technology" items={etac} tone="var(--score-unk)">
          Applied rather than theory-heavy. Not a factor for robotics or AI roles; it matters mainly
          for PE licensure or a traditional engineering master's, where it can mean some catch-up
          coursework. Each of these schools also offers EAC engineering degrees.
        </Group>
        <Group title="No ABET accreditation" items={none} tone="var(--score-unk)">
          Common and unremarkable at strong CS schools, and not the same as engineering technology:
          these curricula are still theory-heavy. Robotics and AI hiring and graduate admissions do
          not look at ABET. Michigan's bulletin notes accreditation is under departmental discussion.
        </Group>
      </div>

      <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] mt-3 leading-relaxed">
        Only schools with a robotics or mechatronics-titled credential appear here; schools where
        robotics is a track inside a conventional engineering degree inherit that degree's
        accreditation. None of this should move a school up or down your list on its own: PE licensure
        matters most in civil, structural and building-systems work, so for a robotics and AI path the
        practical question is just whether the coursework leans theoretical or applied.
      </div>
    </div>
  );
}
