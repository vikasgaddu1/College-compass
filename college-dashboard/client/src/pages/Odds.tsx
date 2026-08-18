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
  const rigorVeryImportant = visibleSchools.filter(
    s => (s as any).admissions?.c7_factors?.rigor === "very_important").length;

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
            </div>
            <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] italic">
              Admit rates are decimals (0.35 = 35%). Defaults: Likely ≥35%, Target ≥20%, High-reach &lt;10%. These are user-adjustable heuristics — the tier labels have no external authority.
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

      {/* Per-school table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="dense w-full">
            <thead>
              <tr>
                <th className="text-left w-[220px]">School</th>
                <th className="text-left w-[110px]">Tier</th>
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
                .map(({ school, result }) => {
                const m = tierMeta[result.tier];
                return (
                  <tr key={school.slug} style={{ background: m.bg }}>
                    <td className="serif font-medium">{school.short}<div className="text-[10.5px] text-[hsl(var(--muted-foreground))] font-normal">{school.city_state}</div></td>
                    <td><span className="chip chip-outline inline-flex text-[10.5px] font-semibold" style={{ color: m.color }}>{m.label}</span></td>
                    <td className="text-right num">{result.effective_admit_rate !== null ? `${(result.effective_admit_rate*100).toFixed(1)}%` : "—"}<div className="text-[10px] text-[hsl(var(--muted-foreground))]">{result.admit_rate_context}</div></td>
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
          <strong>How this works.</strong> Admit rates come from each school's Common Data Set. Residency splits are hand-verified per school: a <strong>{profile.home_state}</strong> applicant gets the <em>in-state</em> rate at the 3 NC schools (UNC-CH 37.0%, NC State 48.9%, Duke has no residency preference) and the <em>out-of-state</em> rate at the 10 other publics that publish one (Georgia Tech 10.1%, UIUC 29.0%, Purdue 43.6%, UW 39.0%, and so on). Schools with no published split fall back to the overall rate. The SAT modifier uses CDS C9 mid-50 and only applies when you're submitting scores. The gated-CS downgrade fires on a researched <code>cs_gate</code> value of <em>strong</em> — 16 schools where CS sits behind a separate admission or a hard internal gate — and never on schools that explicitly state they have no major-level gate. The GPA modifier compares your figure to each school's published CDS C12 average and moves at most one tier, but <strong>only when the weighting matches</strong> — comparing an unweighted 3.9 against Georgia Tech's weighted 4.17 would misread you badly. 18 of 33 schools publish a GPA; 12 of those never state whether it is weighted, so those comparisons are labelled. Five schools (Cornell, Duke, Carleton, Ohio State, UIUC) leave the CDS GPA fields blank entirely, so GPA cannot move their tier at all. The rigor index is your own self-report and deliberately does <em>not</em> feed the tier. Every threshold is adjustable above.
          <div className="mt-1.5"><strong>Known gaps:</strong> Kettering publishes no Common Data Set at all, so it shows as Needs data. Virginia Tech's CDS URLs returned 404 during research, so its C7 grid and test-score fields are empty. UC Berkeley, UT Austin, Texas A&amp;M and Michigan publish no residency split, so those use the overall rate and understate the out-of-state difficulty.</div>
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
