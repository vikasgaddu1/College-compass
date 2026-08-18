import { useMemo, useState } from "react";
import { Target, Settings, AlertTriangle, Info, CheckCircle } from "lucide-react";
import { schools } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import { useApplicantProfile, useOddsThresholds, classify, computeRigor,
  HIGHEST_MATH_LABEL, type OddsTier, type HighestMath } from "@/lib/applicantProfile";
import roboticsPaths from "@/data/robotics_paths.json";

const tierMeta: Record<OddsTier, { label: string; color: string; bg: string }> = {
  LIKELY:     { label: "Likely",     color: "hsl(145 55% 30%)", bg: "hsl(145 55% 30% / 0.10)" },
  TARGET:     { label: "Target",     color: "hsl(200 65% 35%)", bg: "hsl(200 65% 35% / 0.10)" },
  REACH:      { label: "Reach",      color: "hsl(30 75% 40%)",  bg: "hsl(30 75% 40% / 0.10)"  },
  HIGH_REACH: { label: "High reach", color: "hsl(0 65% 42%)",   bg: "hsl(0 65% 42% / 0.10)"   },
  NEEDS_DATA: { label: "Needs data", color: "hsl(0 0% 45%)",    bg: "hsl(0 0% 45% / 0.08)"    },
};

export default function OddsPage() {
  const { hidden } = useHidden();
  const [profile, setProfile] = useApplicantProfile();
  const [thresholds, setThresholds, resetThresholds] = useOddsThresholds();
  const rigor = computeRigor(profile);
  const [showSettings, setShowSettings] = useState(false);

  const visibleSchools = schools.filter(s => !hidden.has(s.slug));

  const classifications = useMemo(() => {
    return visibleSchools.map(s => {
      const adm = (s as any).admissions;
      const nc = (roboticsPaths.schools as any)[s.slug]?.nc_applicant_note;
      const result = classify(adm, nc, profile, thresholds);
      return { school: s, result, adm };
    });
  }, [visibleSchools, profile, thresholds]);

  // How many visible schools call rigor "very important" in CDS C7 -- the honest
  // justification for asking about course load at all.
  const unitSchoolCount = visibleSchools.filter(
    s => ((s as any).admissions?.unit_admit_rates?.length ?? 0) > 0).length;
  const gatedUnpublishedCount = visibleSchools.filter(s => {
    const a = (s as any).admissions;
    return a && a.admission_unit && a.admission_unit !== "university"
      && (a.unit_admit_rates?.length ?? 0) === 0;
  }).length;

  const rigorVeryImportant = visibleSchools.filter(
    s => (s as any).admissions?.c7_factors?.rigor === "very_important").length;

  // Every figure quoted in the "How this works" note is derived here rather than
  // typed into the prose. The previous hardcoded copy had drifted: it said "10
  // other publics" publish an out-of-state rate when 11 schools do, two of them
  // private, and it named five schools as lacking a CDS GPA when 15 do.
  const facts = useMemo(() => {
    const A = (s: any) => (s as any).admissions ?? {};
    const home = visibleSchools.filter(s => A(s).is_home_state_nc);
    const oosPublishers = visibleSchools.filter(
      s => !A(s).is_home_state_nc && A(s).oos_admit_rate != null);
    const gpaRows = visibleSchools.map(s => A(s).avg_gpa)
      .filter(g => g && typeof g === "object" && g.basis !== "not_published" && g.value != null);
    return {
      home,
      homeWithSplit: home.filter(s => A(s).in_state_admit_rate != null),
      oosCount: oosPublishers.length,
      oosPublicCount: oosPublishers.filter(s => s.is_public).length,
      strongGates: visibleSchools.filter(s => A(s).cs_gate === "strong").length,
      gpaPublished: gpaRows.length,
      gpaUnspecified: gpaRows.filter((g: any) => (g.basis ?? "unspecified") === "unspecified").length,
      gpaMissing: visibleSchools.length - gpaRows.length,
      needsData: visibleSchools.filter(s => A(s).overall_admit_rate == null).map(s => s.short),
    };
  }, [visibleSchools]);

  // Sanity audit: at a school that publishes both doors, computing must never
  // classify as EASIER than engineering. Georgia Tech did exactly that before the
  // residency clamp, because its computing figure blends residencies while the
  // engineering fallback is out-of-state only.
  const doorInversions = useMemo(() => {
    const out: { short: string; eng: number; comp: number }[] = [];
    for (const s of visibleSchools) {
      const adm = (s as any).admissions;
      const nc = (roboticsPaths.schools as any)[s.slug]?.nc_applicant_note;
      const eng = classify(adm, nc, profile, { ...thresholds, pathway: "engineering" });
      const comp = classify(adm, nc, profile, { ...thresholds, pathway: "computing" });
      const e = eng.effective_admit_rate, c = comp.effective_admit_rate;
      if (e != null && c != null && c > e + 1e-9) out.push({ short: s.short, eng: e, comp: c });
    }
    return out;
  }, [visibleSchools, profile, thresholds]);

  // Portfolio balance counts
  const counts: Record<OddsTier, number> = { LIKELY: 0, TARGET: 0, REACH: 0, HIGH_REACH: 0, NEEDS_DATA: 0 };
  classifications.forEach(({ result }) => { counts[result.tier]++; });

  const balanceWarnings: string[] = [];
  if (counts.LIKELY < 2) balanceWarnings.push(`Only ${counts.LIKELY} Likely — most guidance recommends at least 2.`);
  if (counts.TARGET < 3) balanceWarnings.push(`Only ${counts.TARGET} Target — most guidance recommends at least 3.`);
  if (counts.HIGH_REACH + counts.REACH > (counts.LIKELY + counts.TARGET) * 2) balanceWarnings.push("Portfolio is heavily reach-weighted.");

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="flex items-baseline gap-2 text-[hsl(var(--accent))]">
          <Target size={16}/>
          <div className="text-[11px] tracking-wider uppercase">Applicant odds</div>
        </div>
        <h2 className="serif text-[22px] font-semibold mt-1">Client-side likelihood classifier</h2>
        <p className="text-[13px] text-[hsl(var(--muted-foreground))] mt-2 leading-relaxed max-w-[820px]">
          Enter your profile below; this page classifies each school as Likely / Target / Reach / High Reach based on the researched admissions data + your stats. All computation runs in your browser — profile data never leaves this device (or your Supabase workspace if signed in). Thresholds are heuristics, not truth — adjust them in Settings.
        </p>
      </div>

      {/* Applicant profile panel */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[11px] tracking-wider uppercase text-[hsl(var(--muted-foreground))]">Your profile (stays on this device)</div>
          <button className="chip chip-outline inline-flex items-center gap-1 text-[11px]" onClick={() => setShowSettings(!showSettings)}>
            <Settings size={11}/> {showSettings ? "Hide" : "Adjust"} thresholds
          </button>
        </div>
        {/* Which door -- the single biggest lever at schools that admit by college */}
        <div className="rounded-md border border-[hsl(var(--accent)/0.35)] bg-[hsl(var(--accent)/0.06)] px-3 py-2.5 mb-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-[11px] uppercase tracking-wider text-[hsl(var(--accent))]">Which door are you applying through?</div>
            <div className="flex gap-1">
              {(["engineering","computing"] as const).map(k => (
                <button key={k}
                  onClick={() => setThresholds({ pathway: k })}
                  className={thresholds.pathway === k ? "chip chip-primary" : "chip chip-outline"}>
                  {k === "engineering" ? "Engineering / ME / ECE" : "Computing / CS / SCS"}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-[11.5px] text-[hsl(var(--muted-foreground))] ml-auto">
              <input type="checkbox" checked={thresholds.use_unit_rates}
                onChange={e => setThresholds({ use_unit_rates: e.target.checked })}/>
              Use per-college rates where published
            </label>
          </div>
          <div className="text-[11.5px] text-[hsl(var(--muted-foreground))] mt-1.5 leading-snug max-w-[880px]">
            A university-wide admit rate describes nobody at a school that admits by college.
            The same UW application is roughly <strong className="text-[hsl(var(--foreground))]">2%</strong> through
            Direct-to-Major CS and <strong className="text-[hsl(var(--foreground))]">37%</strong> through
            Direct-to-College Engineering for an out-of-state applicant. {unitSchoolCount} schools in
            view publish a per-college split; {gatedUnpublishedCount} admit by college or major but publish
            no unit-level rate, and those keep the university figure with a caveat.
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <NumberInput label="GPA (unweighted)" value={profile.gpa_uw} onChange={v => setProfile({ gpa_uw: v })} step={0.01} max={4.5} min={0} placeholder="3.85"/>
          <NumberInput label="GPA (weighted)"   value={profile.gpa_w}  onChange={v => setProfile({ gpa_w: v })}  step={0.01} max={6.0} min={0} placeholder="4.35"/>
          <NumberInput label="SAT (400-1600)"   value={profile.sat}    onChange={v => setProfile({ sat: v })}    step={10}   max={1600} min={400} placeholder="1470"/>
          <NumberInput label="ACT (1-36)"       value={profile.act}    onChange={v => setProfile({ act: v })}    step={1}    max={36}   min={1}   placeholder="33"/>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Test plan</label>
            <select className="w-full px-2 py-1 mt-0.5 text-[12.5px] bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded"
              value={profile.test_plan} onChange={e => setProfile({ test_plan: e.target.value as any })}>
              <option value="submitting">Submitting scores</option>
              <option value="optional_hold">Hold — decide per school</option>
              <option value="not_submitting">Not submitting</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Home state</label>
            <input className="w-full px-2 py-1 mt-0.5 text-[12.5px] bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded"
              value={profile.home_state} onChange={e => setProfile({ home_state: e.target.value.toUpperCase().slice(0,2) })}/>
          </div>
        </div>
        {/* Academic rigor -- structured, no transcript needed */}
        <div className="border-t border-[hsl(var(--border))] pt-3 mt-1">
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              Academic rigor — no transcript required
            </div>
            {rigor.index !== null && (
              <div className="text-[11.5px]">
                <span className="text-[hsl(var(--muted-foreground))]">Rigor index </span>
                <span className="num font-semibold">{rigor.index.toFixed(1)}</span>
                <span className="text-[hsl(var(--muted-foreground))]"> / 5 · {rigor.band}</span>
              </div>
            )}
          </div>
          <div className="text-[11.5px] text-[hsl(var(--muted-foreground))] mt-1 mb-2 max-w-[820px] leading-snug">
            Count the courses instead of uploading anything. {rigorVeryImportant} of {visibleSchools.length} schools
            in view rate rigor of secondary school record <strong className="text-[hsl(var(--foreground))]">very important</strong> in
            CDS C7 — more than rate test scores that way — so this is usually the highest-leverage row on the page.
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <NumberInput label="AP / IB / DE completed" value={profile.ap_ib_de_completed}
              onChange={v => setProfile({ ap_ib_de_completed: v })} step={1} min={0} max={30} placeholder="6"/>
            <NumberInput label="AP / IB / DE senior year" value={profile.ap_ib_de_planned}
              onChange={v => setProfile({ ap_ib_de_planned: v })} step={1} min={0} max={30} placeholder="4"/>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Highest math</label>
              <select className="w-full px-2 py-1 mt-0.5 text-[12.5px] bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded"
                value={profile.highest_math ?? ""}
                onChange={e => setProfile({ highest_math: (e.target.value || null) as HighestMath | null })}>
                <option value="">Select…</option>
                {(Object.keys(HIGHEST_MATH_LABEL) as HighestMath[]).map(k => (
                  <option key={k} value={k}>{HIGHEST_MATH_LABEL[k]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Your school offers</label>
              <select className="w-full px-2 py-1 mt-0.5 text-[12.5px] bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded"
                value={profile.school_offers_advanced}
                onChange={e => setProfile({ school_offers_advanced: e.target.value as any })}>
                <option value="unknown">Not sure</option>
                <option value="many">Many advanced courses (15+)</option>
                <option value="some">Some (6–14)</option>
                <option value="few">Few (5 or fewer)</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Honors core</label>
              <select className="w-full px-2 py-1 mt-0.5 text-[12.5px] bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded"
                value={profile.has_honors_core ? "yes" : "no"}
                onChange={e => setProfile({ has_honors_core: e.target.value === "yes" })}>
                <option value="no">Not all core subjects</option>
                <option value="yes">All core subjects honors+</option>
              </select>
            </div>
          </div>
          {rigor.index !== null && rigor.drivers.length > 0 && (
            <div className="text-[11.5px] mt-2 rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.4)] px-2.5 py-2">
              <strong>What this reflects:</strong> {rigor.drivers.join("; ")}.
              {rigor.context_limited && (
                <> Colleges state they read rigor against what your school actually offered, so a short
                course list at a school with few options is not read as a weak one.</>
              )}
              <div className="text-[hsl(var(--muted-foreground))] mt-1">
                This index is a planning aid built from your own self-report. It is not a school-published
                figure and no admissions office computes it — it does not feed the tier classification.
              </div>
            </div>
          )}
          <div className="mt-2">
            <label className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Anything else worth noting (optional)</label>
            <input className="w-full px-2 py-1 mt-0.5 text-[12.5px] bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded"
              placeholder="e.g. AP Physics C self-studied; dual enrollment at community college"
              value={profile.rigor_note} onChange={e => setProfile({ rigor_note: e.target.value })}/>
          </div>
        </div>

        {/* Threshold settings drawer */}
        {showSettings && (
          <div className="border-t border-[hsl(var(--border))] pt-3 space-y-2 bg-[hsl(var(--card))/0.5]">
            <div className="flex items-center justify-between">
              <div className="text-[11px] tracking-wider uppercase text-[hsl(var(--muted-foreground))]">Classifier thresholds</div>
              <button className="chip chip-outline text-[10.5px]" onClick={resetThresholds}>Reset to defaults</button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11.5px]">
              <NumberInput label="Likely min admit rate" value={thresholds.likely_admit_min} onChange={v => v!==null && setThresholds({ likely_admit_min: v })} step={0.01} max={1} min={0}/>
              <NumberInput label="Target min admit rate" value={thresholds.target_admit_min} onChange={v => v!==null && setThresholds({ target_admit_min: v })} step={0.01} max={1} min={0}/>
              <NumberInput label="High-reach max admit rate" value={thresholds.high_reach_admit_max} onChange={v => v!==null && setThresholds({ high_reach_admit_max: v })} step={0.01} max={1} min={0}/>
              <NumberInput label="GPA gap that moves a tier" value={thresholds.gpa_delta} onChange={v => v!==null && setThresholds({ gpa_delta: v })} step={0.01} max={1} min={0}/>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Let GPA move the tier</label>
                <select className="w-full px-2 py-1 mt-0.5 text-[12px] bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded"
                  value={thresholds.use_gpa ? "yes" : "no"}
                  onChange={e => setThresholds({ use_gpa: e.target.value === "yes" })}>
                  <option value="yes">Yes</option>
                  <option value="no">No — admit rate and tests only</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Downgrade gated CS</label>
                <select className="w-full px-2 py-1 mt-0.5 text-[12px] bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded"
                  value={thresholds.gated_downgrade ? "yes":"no"}
                  onChange={e => setThresholds({ gated_downgrade: e.target.value === "yes" })}>
                  <option value="yes">Yes — downgrade one tier</option>
                  <option value="no">No — treat CS same as overall</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Gate applies to</label>
                <select className="w-full px-2 py-1 mt-0.5 text-[12px] bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded"
                  value={thresholds.gate_pathway_aware ? "computing":"both"}
                  onChange={e => setThresholds({ gate_pathway_aware: e.target.value === "computing" })}>
                  <option value="computing">The computing door only</option>
                  <option value="both">Both doors</option>
                </select>
              </div>
            </div>
            <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] italic">
              Admit rates are decimals (0.35 = 35%). Defaults: Likely ≥35%, Target ≥20%, High-reach &lt;10%. These are user-adjustable heuristics — the tier labels have no external authority.
              {" "}<strong>Gate applies to</strong> defaults to the computing door only: <code>cs_gate</code> describes a CS/AI-specific obstacle, so on the engineering door it is reported as a risk to reaching the major rather than as a higher admission bar. Set it to "both doors" for the older, more pessimistic behaviour.
            </div>
          </div>
        )}
      </div>

      {/* Portfolio balance bar */}
      <div className="card p-4">
        <div className="text-[11px] tracking-wider uppercase text-[hsl(var(--muted-foreground))] mb-2">Portfolio balance ({visibleSchools.length} visible)</div>
        <div className="flex h-6 rounded-md overflow-hidden bg-[hsl(var(--border))]">
          {(["LIKELY","TARGET","REACH","HIGH_REACH","NEEDS_DATA"] as OddsTier[]).map(t => {
            const pct = visibleSchools.length ? (counts[t] / visibleSchools.length) * 100 : 0;
            if (pct === 0) return null;
            return <div key={t} title={`${tierMeta[t].label}: ${counts[t]}`} style={{ width: `${pct}%`, background: tierMeta[t].color }} className="text-[10px] text-white flex items-center justify-center font-semibold">{counts[t]}</div>;
          })}
        </div>
        <div className="flex flex-wrap gap-3 mt-2 text-[11.5px]">
          {(["LIKELY","TARGET","REACH","HIGH_REACH","NEEDS_DATA"] as OddsTier[]).map(t => (
            <div key={t} className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: tierMeta[t].color }}/> {tierMeta[t].label}: <strong>{counts[t]}</strong></div>
          ))}
        </div>
        {balanceWarnings.length > 0 && (
          <div className="mt-3 text-[11.5px] text-[hsl(var(--fit-lower))] flex flex-col gap-1">
            {balanceWarnings.map((w,i) => <div key={i} className="flex items-start gap-1.5"><AlertTriangle size={11} className="mt-0.5 flex-shrink-0"/> {w}</div>)}
          </div>
        )}
        {balanceWarnings.length === 0 && counts.NEEDS_DATA === 0 && (
          <div className="mt-3 text-[11.5px] text-[hsl(145_55%_30%)] flex items-center gap-1.5"><CheckCircle size={11}/> Balance looks reasonable — at least 2 Likely and 3 Target.</div>
        )}
      </div>

      {doorInversions.length > 0 && (
        <div className="card p-4 border-[hsl(var(--fit-lower)/0.4)]">
          <div className="text-[11.5px] flex items-start gap-1.5 text-[hsl(var(--fit-lower))]">
            <AlertTriangle size={12} className="mt-0.5 flex-shrink-0"/>
            <div>
              <strong>Door ordering looks wrong at {doorInversions.length} school{doorInversions.length === 1 ? "" : "s"}.</strong>{" "}
              The computing door classifies as <em>easier</em> than the engineering door here, which is almost
              always a sign that the two figures rest on different bases rather than a real difference:{" "}
              {doorInversions.map(d => `${d.short} (engineering ${(d.eng*100).toFixed(1)}%, computing ${(d.comp*100).toFixed(1)}%)`).join("; ")}.
              Check the source notes before trusting either number.
            </div>
          </div>
        </div>
      )}

      {/* Per-school table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="dense w-full">
            <thead>
              <tr>
                <th className="text-left w-[220px]">School</th>
                <th className="text-left w-[110px]">Tier</th>
                <th className="text-left w-[132px]">You apply to</th>
                <th className="text-right w-[100px]">Eff. admit</th>
                <th className="text-left">Reason</th>
              </tr>
            </thead>
            <tbody>
              {classifications
                .sort((a,b) => {
                  const order: OddsTier[] = ["LIKELY","TARGET","REACH","HIGH_REACH","NEEDS_DATA"];
                  return order.indexOf(a.result.tier) - order.indexOf(b.result.tier);
                })
                .map(({ school, result, adm }) => {
                const m = tierMeta[result.tier];
                return (
                  <tr key={school.slug} style={{ background: m.bg }}>
                    <td className="serif font-medium">{school.short}<div className="text-[10.5px] text-[hsl(var(--muted-foreground))] font-normal">{school.city_state}</div></td>
                    <td><span className="chip chip-outline inline-flex text-[10.5px] font-semibold" style={{ color: m.color }}>{m.label}</span></td>
                    <td className="text-[11px] leading-tight">
                      <StructureCell admissions={adm} />
                    </td>
                    <td className="text-right num">{result.effective_admit_rate !== null ? `${(result.effective_admit_rate*100).toFixed(1)}%` : "—"}<div className="text-[10px] text-[hsl(var(--muted-foreground))]">{result.admit_rate_context}</div>
                      {result.unit_used && (
                        <div className="text-[9.5px] mt-0.5" style={{ color: "hsl(var(--accent))" }}
                          title={result.unit_used.note ?? undefined}>
                          per-college rate
                          {result.unit_residency_blended && (
                            <span className="block" style={{ color: "hsl(30 75% 40%)" }}>
                              {result.unit_clamped_to != null ? "blended · capped" : "blended residency"}
                            </span>
                          )}
                          {result.unit_used.note && (
                            <span className="block text-[hsl(var(--muted-foreground))] font-normal">source note</span>
                          )}
                        </div>
                      )}</td>
                    <td className="text-[11.5px] leading-snug">{result.reason}
                      {result.gated_downgrade_applied && <span className="ml-2 chip chip-outline text-[10px] py-0" style={{ color: "hsl(30 75% 40%)" }}>gated CS downgrade</span>}
                      {!result.gated_downgrade_applied && result.cs_gate === "mild" && <span className="ml-2 chip chip-outline text-[10px] py-0" style={{ color: "hsl(30 55% 48%)" }}>mild CS gate</span>}
                      {result.cs_gate === "none" && <span className="ml-2 chip chip-outline text-[10px] py-0" style={{ color: "hsl(145 50% 35%)" }}>no CS gate</span>}
                      {result.gpa_moved_tier && <span className="ml-2 chip chip-outline text-[10px] py-0" style={{ color: "hsl(200 70% 38%)" }}>GPA moved tier</span>}
                      {result.gpa?.delta === null && result.gpa?.caveat && (
                        <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] mt-1 italic">{result.gpa.caveat}</div>
                      )}
                      {result.gpa?.delta !== null && result.gpa?.caveat && (
                        <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] mt-1">{result.gpa.caveat}</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-3 text-[11px] text-[hsl(var(--muted-foreground))] flex items-start gap-1.5">
        <Info size={11} className="mt-0.5 flex-shrink-0"/>
        <div>
          <strong>How this works.</strong> Admit rates come from each school's Common Data Set, and every count in this paragraph is computed from the loaded data rather than written by hand.
          Residency splits are hand-verified per school: a <strong>{profile.home_state}</strong> applicant gets the <em>in-state</em> rate at the {facts.homeWithSplit.length} of {facts.home.length} home-state schools that publish one ({facts.homeWithSplit.map(s => `${s.short} ${(( (s as any).admissions.in_state_admit_rate)*100).toFixed(1)}%`).join(", ")}), and the <em>out-of-state</em> rate at the {facts.oosCount} other schools that publish one ({facts.oosPublicCount} public, {facts.oosCount - facts.oosPublicCount} private). Schools with no published split fall back to the overall rate.
          {" "}The test modifier uses CDS C9 and accepts either the SAT or the ACT — whichever you and the school both have — and moves at most one tier in either direction. It only applies when you are submitting; on the "hold" plan a below-25th score is treated as one you would withhold.
          {" "}The gated-CS downgrade fires on a researched <code>cs_gate</code> value of <em>strong</em> ({facts.strongGates} schools in view), never on schools that state they have no major-level gate, and never on top of a per-college rate that already prices the same obstacle in.
          {" "}The GPA modifier compares your figure to each school's published CDS C12 average and moves at most one tier, but <strong>only when the weighting matches</strong> — comparing an unweighted 3.9 against a weighted 4.17 would misread you badly. {facts.gpaPublished} of {visibleSchools.length} schools publish a usable GPA; {facts.gpaUnspecified} of those never state whether it is weighted, so those comparisons are labelled. The other {facts.gpaMissing} publish nothing usable, so GPA cannot move their tier at all.
          {" "}The rigor index is your own self-report and deliberately does <em>not</em> feed the tier. Every threshold is adjustable above.
          <div className="mt-1.5"><strong>Per-college rates and residency.</strong> Where a school publishes admit rates by college, the rate for your chosen door replaces the university figure. Some schools publish that split for <em>all residencies combined</em> while also publishing a separate in-state/out-of-state split for the university — two different measurements. A blended figure can show a door is harder, never that it is easier than your own residency rate; where it would, it is capped and labelled <em>capped</em> in the table. Without that cap, Georgia Tech's computing door (11.3%, blended) read as easier than its published out-of-state rate (10.1%), so picking the harder door made the school look more attainable.</div>
          <div className="mt-1.5"><strong>Known gaps:</strong> {facts.needsData.length > 0 ? `${facts.needsData.join(", ")} publish${facts.needsData.length === 1 ? "es" : ""} no usable overall admit rate, so ${facts.needsData.length === 1 ? "it shows" : "they show"} as Needs data. ` : ""}Schools that publish no residency split use the overall rate, which understates out-of-state difficulty. Per-college figures marked as inferred in the source notes are shown with that note attached.</div>
        </div>
      </div>
    </div>
  );
}

function NumberInput({ label, value, onChange, step = 1, min, max, placeholder }: { label: string; value: number | null; onChange: (v: number | null) => void; step?: number; min?: number; max?: number; placeholder?: string; }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">{label}</label>
      <input type="number" step={step} min={min} max={max} placeholder={placeholder}
        value={value ?? ""} onChange={e => onChange(e.target.value === "" ? null : parseFloat(e.target.value))}
        className="w-full px-2 py-1 mt-0.5 text-[12.5px] bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded"/>
    </div>
  );
}


/* ------------------------------------------------------------------ *
 * What the applicant actually selects on the application.
 * Kept visible because "the CDS reports one funnel" is NOT the same as
 * "admission is university-wide" -- conflating those two mislabelled 12 of 33
 * schools, Duke among them.
 * ------------------------------------------------------------------ */

const APPLIES_LABEL: Record<string, { short: string; hue: string }> = {
  university:     { short: "University-wide",  hue: "var(--muted-foreground)" },
  college:        { short: "A college",        hue: "var(--accent)" },
  major:          { short: "A named major",   hue: "var(--accent)" },
  first_year_eng: { short: "First-yr eng.",    hue: "var(--fit-top)" },
  pre_major:      { short: "Pre-major",        hue: "var(--fit-top)" },
  unknown:        { short: "Unverified",       hue: "var(--score-unk)" },
};

function StructureCell({ admissions }: { admissions: any }) {
  const st = admissions?.admission_structure;
  const key = st?.applies_to ?? admissions?.admission_unit ?? "unknown";
  const meta = APPLIES_LABEL[key] ?? APPLIES_LABEL.unknown;
  const units: string[] = Array.isArray(st?.units_named) ? st.units_named : [];
  const published = st?.separate_rates_published === true;

  const title = [
    st?.applies_to_note ? `Structure: ${st.applies_to_note}` : `Structure: ${meta.short}`,
    units.length ? `Selectable units: ${units.join("; ")}` : null,
    published
      ? "This school publishes admit rates broken out by unit."
      : key !== "university"
        ? "This school admits by unit but does NOT publish separate rates, so the university figure is used."
        : null,
    st?.internal_mobility ? `Moving between units later: ${st.internal_mobility}` : null,
  ].filter(Boolean).join("\n\n");

  return (
    <span title={title} className="inline-flex flex-col gap-0.5">
      <span style={{ color: `hsl(${meta.hue})` }} className="font-medium">{meta.short}</span>
      {key !== "university" && (
        <span className="text-[9.5px] text-[hsl(var(--muted-foreground))]">
          {published ? "rates published" : "rates not published"}
        </span>
      )}
    </span>
  );
}
