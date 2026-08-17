import { useMemo, useState } from "react";
import { schools, School, fmtCost } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import { HideButton, NoteButton, MyRatingChip } from "@/components/SchoolBits";
import { AlumniStrip } from "@/components/AlumniStrip";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from "recharts";
import { GraduationCap, Briefcase, TrendingUp, ExternalLink, Info } from "lucide-react";

const fitColor: Record<string, string> = {
  "TOP FIT": "hsl(145 55% 35%)",
  "STRONG FIT": "hsl(200 65% 40%)",
  "CONDITIONAL FIT": "hsl(30 80% 45%)",
  "LOWER FIT": "hsl(0 60% 45%)",
};

export default function OutcomesPage() {
  const { hidden } = useHidden();
  const [tab, setTab] = useState<"aid"|"persistence"|"careers">("aid");
  const list = useMemo(() => schools.filter(s => !hidden.has(s.slug)), [hidden]);
  const withOutcomes = list.filter(s => s.outcomes);
  const missing = list.length - withOutcomes.length;

  return (
    <div className="space-y-4">
      <div className="card p-4 md:p-5">
        <div className="serif text-[17px] font-semibold mb-1">Financial aid, persistence, and career outcomes</div>
        <div className="text-[12.5px] text-[hsl(var(--muted-foreground))] max-w-3xl leading-relaxed">
          Data pulled from each school's Common Data Set, IPEDS record, and first-destination outcomes report — with the exact reporting year and source URL on every row. The sticker price on the Cost tab is misleading on its own; the aid and net-price-by-income figures below are what actually matter.
        </div>
        <div className="mt-3 inline-flex gap-1 bg-[hsl(var(--muted)/0.6)] p-1 rounded-lg">
          <button className={`tab-btn ${tab==="aid" ? "active" : ""}`} onClick={()=>setTab("aid")}>Aid & net price</button>
          <button className={`tab-btn ${tab==="persistence" ? "active" : ""}`} onClick={()=>setTab("persistence")}>Graduation & retention</button>
          <button className={`tab-btn ${tab==="careers" ? "active" : ""}`} onClick={()=>setTab("careers")}>Careers & grad school</button>
        </div>
      </div>

      {missing > 0 && (
        <div className="card p-3 border-l-4 border-l-[hsl(var(--accent))]">
          <div className="flex items-start gap-2 text-[12.5px]">
            <Info size={14} className="mt-0.5 shrink-0 text-[hsl(var(--accent))]"/>
            <div>
              <strong>{missing}</strong> visible school{missing>1?"s":""} do not yet have outcomes data loaded. The rest of this page shows only schools whose Tier 1 data is available.
            </div>
          </div>
        </div>
      )}

      {tab === "aid" && <AidTab list={withOutcomes}/>}
      {tab === "persistence" && <PersistenceTab list={withOutcomes}/>}
      {tab === "careers" && <CareersTab list={withOutcomes}/>}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pos"|"neg" }) {
  const c = tone === "pos" ? "hsl(var(--fit-top))" : tone === "neg" ? "hsl(var(--fit-lower))" : undefined;
  return (
    <div className="card p-4">
      <div className="text-[11px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">{label}</div>
      <div className="serif text-[24px] leading-tight font-semibold num mt-1" style={c ? { color: c } : undefined}>{value}</div>
      {sub && <div className="text-[11px] text-[hsl(var(--muted-foreground))] truncate">{sub}</div>}
    </div>
  );
}

function yesNoChip(v: string | null | undefined) {
  if (!v) return <span className="text-[hsl(var(--muted-foreground))] text-[11px]">n.a.</span>;
  const yes = v.toLowerCase().startsWith("y");
  return <span className={`chip ${yes ? "fit-top" : "chip-outline"}`}>{v}</span>;
}

function sourceLinks(urls: string[] | undefined) {
  if (!urls || !urls.length) return <span className="text-[hsl(var(--muted-foreground))] text-[11px]">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {urls.slice(0,3).map((u,i) => (
        <a key={i} href={u} target="_blank" rel="noreferrer noopener"
          className="text-[11px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--accent))] inline-flex items-center gap-0.5">
          src{i+1} <ExternalLink size={9}/>
        </a>
      ))}
    </div>
  );
}

/* ---------------------- AID TAB ---------------------- */

function AidTab({ list }: { list: School[] }) {
  const meets = list.filter(s => (s.outcomes?.meets_full_need || "").toLowerCase().startsWith("y")).length;
  const blind = list.filter(s => (s.outcomes?.need_blind || "").toLowerCase().startsWith("y")).length;
  const avgGrant = (() => {
    const nums = list.map(s => s.outcomes?.avg_need_grant).filter((n): n is number => typeof n === "number");
    return nums.length ? Math.round(nums.reduce((s,n)=>s+n,0) / nums.length) : null;
  })();
  const avgNetAll = (() => {
    const nums = list.map(s => s.outcomes?.avg_net_price_all).filter((n): n is number => typeof n === "number");
    return nums.length ? Math.round(nums.reduce((s,n)=>s+n,0) / nums.length) : null;
  })();

  const midBand = list
    .filter(s => s.outcomes?.avg_net_price_48_to_75k != null)
    .map(s => ({
      name: s.short,
      value: s.outcomes!.avg_net_price_48_to_75k!,
      sticker: s.cost_for_nc_resident || 0,
      fit: s.fit_classification,
      color: fitColor[s.fit_classification] || "hsl(var(--muted))",
    }))
    .sort((a,b) => a.value - b.value);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Meet full demonstrated need" value={`${meets} / ${list.length}`} tone="pos" sub="Reported yes"/>
        <Stat label="Need-blind admission" value={`${blind} / ${list.length}`} sub="For domestic applicants"/>
        <Stat label="Avg. institutional need grant" value={fmtCost(avgGrant)} sub="Across schools that report it"/>
        <Stat label="Avg. net price (all students)" value={fmtCost(avgNetAll)} sub="IPEDS, all first-year aid recipients"/>
      </div>

      {midBand.length > 0 && (
        <div className="card p-4">
          <div className="text-[13px] font-medium mb-1">Net price for a family earning $48k–$75k</div>
          <div className="text-[11px] text-[hsl(var(--muted-foreground))] mb-3">
            The gray bar is sticker COA for reference — the gap between the two is the aid a middle-income family typically receives. Use each school's Net Price Calculator to run your own family's numbers.
          </div>
          <ResponsiveContainer width="100%" height={Math.max(320, midBand.length * 30)}>
            <BarChart data={midBand} layout="vertical" margin={{ top: 5, right: 72, left: 12, bottom: 5 }} barCategoryGap={6}
              stackOffset="none">
              <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" horizontal={false}/>
              <XAxis type="number" tickFormatter={v => `$${Math.round(v/1000)}k`}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false}/>
              <YAxis type="category" dataKey="name" width={132} interval={0}
                tick={{ fill: "hsl(var(--foreground))", fontSize: 11 }} axisLine={false} tickLine={false}/>
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12, borderRadius: 6 }}
                content={(props: any) => {
                  if (!props.active || !props.payload?.length) return null;
                  const d = props.payload[0].payload;
                  const savings = d.sticker - d.value;
                  return (
                    <div className="p-2 rounded" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
                      <div className="serif font-semibold text-[13px]">{d.name}</div>
                      <div className="text-[11.5px] mt-1 space-y-0.5">
                        <div>Sticker: <span className="num">{fmtCost(d.sticker)}</span></div>
                        <div>Net for $48-75k: <span className="num font-semibold text-[hsl(var(--fit-top))]">{fmtCost(d.value)}</span></div>
                        {savings > 0 && <div>Effective aid: <span className="num text-[hsl(var(--accent))]">{fmtCost(savings)}</span></div>}
                      </div>
                    </div>
                  );
                }}/>
              {/* Sticker as a translucent background bar */}
              <Bar dataKey="sticker" fill="hsl(var(--muted-foreground))" fillOpacity={0.18} radius={[0, 3, 3, 0]} barSize={20}>
                <LabelList dataKey="sticker" position="right" formatter={(v:any) => `$${Math.round(v/1000)}k sticker`}
                  style={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}/>
              </Bar>
              {/* Net price as the solid, primary bar, drawn on top (recharts renders series in order) */}
              <Bar dataKey="value" radius={[0, 3, 3, 0]} barSize={20}>
                {midBand.map((d, i) => <Cell key={i} fill={d.color}/>)}
                <LabelList dataKey="value" position="right" formatter={(v:any) => `$${Math.round(v/1000)}k`}
                  style={{ fontSize: 10.5, fill: "hsl(var(--foreground))", fontWeight: 600 }}/>
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="dense w-full">
            <thead>
              <tr>
                <th>School</th>
                <th>Yr</th>
                <th>Meets need</th>
                <th>Need-blind</th>
                <th className="text-right">% got need aid</th>
                <th className="text-right">Avg need grant</th>
                <th className="text-right">% got merit</th>
                <th className="text-right">Avg merit grant</th>
                <th className="text-right">Net price avg</th>
                <th>NPC</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {list.map(s => {
                const o = s.outcomes!;
                return (
                  <tr key={s.slug}>
                    <td>
                      <div className="serif font-medium">{s.short}</div>
                      <div className="text-[10.5px] text-[hsl(var(--muted-foreground))]">{s.city_state}</div>
                    </td>
                    <td className="text-[11px]">{o.cds_year || "n.a."}</td>
                    <td>{yesNoChip(o.meets_full_need)}</td>
                    <td>{yesNoChip(o.need_blind)}</td>
                    <td className="text-[11.5px] text-right num">{o.pct_receiving_need_aid || "n.a."}</td>
                    <td className="text-right num">{fmtCost(o.avg_need_grant)}</td>
                    <td className="text-[11.5px] text-right num">{o.pct_receiving_merit_aid || "n.a."}</td>
                    <td className="text-right num">{fmtCost(o.avg_merit_grant)}</td>
                    <td className="text-right num">{fmtCost(o.avg_net_price_all)}</td>
                    <td>
                      {o.net_price_calculator_url ? (
                        <a href={o.net_price_calculator_url} target="_blank" rel="noreferrer noopener"
                          className="text-[11px] text-[hsl(var(--accent))] hover:underline inline-flex items-center gap-0.5">
                          NPC <ExternalLink size={9}/>
                        </a>
                      ) : <span className="text-[11px] text-[hsl(var(--muted-foreground))]">n.a.</span>}
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <NoteButton slug={s.slug}/>
                        <HideButton slug={s.slug} compact/>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="p-3 border-b border-[hsl(var(--border))]">
          <div className="text-[13px] font-medium">Average net price by family income band</div>
          <div className="text-[11px] text-[hsl(var(--muted-foreground))]">IPEDS data. Family income = the household income reported on the FAFSA.</div>
        </div>
        <div className="overflow-x-auto">
          <table className="dense w-full">
            <thead>
              <tr>
                <th>School</th>
                <th className="text-right">Under $30k</th>
                <th className="text-right">$30-48k</th>
                <th className="text-right">$48-75k</th>
                <th className="text-right">$75-110k</th>
                <th className="text-right">$110k+</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {list.map(s => {
                const o = s.outcomes!;
                return (
                  <tr key={s.slug}>
                    <td className="serif font-medium">{s.short}</td>
                    <td className="text-right num">{fmtCost(o.avg_net_price_under_30k)}</td>
                    <td className="text-right num">{fmtCost(o.avg_net_price_30_to_48k)}</td>
                    <td className="text-right num">{fmtCost(o.avg_net_price_48_to_75k)}</td>
                    <td className="text-right num">{fmtCost(o.avg_net_price_75_to_110k)}</td>
                    <td className="text-right num">{fmtCost(o.avg_net_price_over_110k)}</td>
                    <td>{sourceLinks(o.source_urls)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ------------------- PERSISTENCE TAB ------------------- */

function PersistenceTab({ list }: { list: School[] }) {
  const grad4 = list
    .filter(s => s.outcomes?.grad_rate_4yr != null)
    .map(s => ({
      name: s.short,
      grad4: s.outcomes!.grad_rate_4yr!,
      grad6: s.outcomes!.grad_rate_6yr ?? s.outcomes!.grad_rate_4yr!,
      retention: s.outcomes!.retention_rate ?? 0,
      color: fitColor[s.fit_classification] || "hsl(var(--muted))",
    }))
    .sort((a,b) => b.grad4 - a.grad4);

  const avg4 = grad4.length ? Math.round(grad4.reduce((s,d)=>s+d.grad4, 0) / grad4.length) : null;
  const avg6 = grad4.length ? Math.round(grad4.reduce((s,d)=>s+d.grad6, 0) / grad4.length) : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Avg 4-year graduation" value={avg4 != null ? `${avg4}%` : "—"} sub={`Across ${grad4.length} schools`}/>
        <Stat label="Avg 6-year graduation" value={avg6 != null ? `${avg6}%` : "—"} sub="US average is ~64%"/>
        <Stat label="Top 4-yr grad rate" value={grad4.length ? `${grad4[0].grad4}%` : "—"} sub={grad4[0]?.name} tone="pos"/>
        <Stat label="Lowest 4-yr grad rate" value={grad4.length ? `${grad4[grad4.length-1].grad4}%` : "—"} sub={grad4[grad4.length-1]?.name}/>
      </div>

      {grad4.length > 0 && (
        <div className="card p-4">
          <div className="text-[13px] font-medium mb-1">4-year vs. 6-year graduation rate</div>
          <div className="text-[11px] text-[hsl(var(--muted-foreground))] mb-3">
            4-year is the more meaningful metric for finishing on time. The gap between 4-year and 6-year shows how many take an extra year — often for co-ops, double majors, or difficulty passing gate courses.
          </div>
          <ResponsiveContainer width="100%" height={Math.max(340, grad4.length * 28)}>
            <BarChart data={grad4} layout="vertical" margin={{ top: 5, right: 60, left: 12, bottom: 5 }} barGap={2} barCategoryGap={6}>
              <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" horizontal={false}/>
              <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false}/>
              <YAxis type="category" dataKey="name" width={132} interval={0}
                tick={{ fill: "hsl(var(--foreground))", fontSize: 11 }} axisLine={false} tickLine={false}/>
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12, borderRadius: 6 }}
                formatter={(v: any, name: any) => [`${v}%`, name === "grad4" ? "4-year" : "6-year"]}/>
              <Bar dataKey="grad4" fill="hsl(var(--primary))" radius={[0,3,3,0]}>
                <LabelList dataKey="grad4" position="right" formatter={(v:any) => `${v}%`}
                  style={{ fontSize: 10.5, fill: "hsl(var(--foreground))", fontWeight: 600 }}/>
              </Bar>
              <Bar dataKey="grad6" fill="hsl(var(--muted-foreground))" radius={[0,3,3,0]} opacity={0.35}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="dense w-full">
            <thead>
              <tr>
                <th>School</th>
                <th>Yr</th>
                <th className="text-right">4-year grad</th>
                <th className="text-right">6-year grad</th>
                <th className="text-right">Freshman retention</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {list.map(s => {
                const o = s.outcomes!;
                return (
                  <tr key={s.slug}>
                    <td className="serif font-medium">{s.short}</td>
                    <td className="text-[11px]">{o.cds_year || "n.a."}</td>
                    <td className="text-right num">{o.grad_rate_4yr != null ? `${o.grad_rate_4yr}%` : "n.a."}</td>
                    <td className="text-right num">{o.grad_rate_6yr != null ? `${o.grad_rate_6yr}%` : "n.a."}</td>
                    <td className="text-right num">{o.retention_rate != null ? `${o.retention_rate}%` : "n.a."}</td>
                    <td>{sourceLinks(o.source_urls)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* -------------------- CAREERS TAB -------------------- */

function CareersTab({ list }: { list: School[] }) {
  const withSalary = list.filter(s => s.outcomes?.cs_median_starting_salary != null);
  const salaryData = withSalary
    .map(s => ({
      name: s.short,
      salary: s.outcomes!.cs_median_starting_salary!,
      scope: s.outcomes!.cs_salary_scope || "",
      color: fitColor[s.fit_classification] || "hsl(var(--muted))",
    }))
    .sort((a,b) => b.salary - a.salary);

  const median = (() => {
    const nums = salaryData.map(d => d.salary).sort((a,b) => a-b);
    return nums.length ? nums[Math.floor(nums.length/2)] : null;
  })();

  return (
    <div className="space-y-4">
      <AlumniStrip />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Schools reporting CS salary" value={String(withSalary.length)} sub={`of ${list.length}`}/>
        <Stat label="Median CS starting salary" value={fmtCost(median)} sub="Across reporting schools" tone="pos"/>
        <Stat label="Highest reported" value={salaryData[0] ? fmtCost(salaryData[0].salary) : "—"} sub={salaryData[0]?.name}/>
        <Stat label="Lowest reported" value={salaryData.length ? fmtCost(salaryData[salaryData.length-1].salary) : "—"} sub={salaryData[salaryData.length-1]?.name}/>
      </div>

      {salaryData.length > 0 && (
        <div className="card p-4">
          <div className="text-[13px] font-medium mb-1">Median starting salary for CS / AI graduates</div>
          <div className="text-[11px] text-[hsl(var(--muted-foreground))] mb-3">
            From each school's own first-destination report. Scope varies — some report CS-BS specific, some report the whole engineering college. Salaries reflect knowledge rates below 100% — see the table for the surveyed share.
          </div>
          <ResponsiveContainer width="100%" height={Math.max(320, salaryData.length * 26)}>
            <BarChart data={salaryData} layout="vertical" margin={{ top: 5, right: 60, left: 12, bottom: 5 }} barCategoryGap={4}>
              <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" horizontal={false}/>
              <XAxis type="number" tickFormatter={v => `$${Math.round(v/1000)}k`}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false}/>
              <YAxis type="category" dataKey="name" width={132} interval={0}
                tick={{ fill: "hsl(var(--foreground))", fontSize: 11 }} axisLine={false} tickLine={false}/>
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12, borderRadius: 6 }}
                formatter={(v: any, _n: any, p: any) => [`${fmtCost(v as number)} (${p.payload.scope || "scope unknown"})`, "Median salary"]}/>
              <Bar dataKey="salary" radius={[0,3,3,0]}>
                {salaryData.map((d, i) => <Cell key={i} fill={d.color}/>)}
                <LabelList dataKey="salary" position="right" formatter={(v:any) => `$${Math.round(v/1000)}k`}
                  style={{ fontSize: 10.5, fill: "hsl(var(--muted-foreground))" }}/>
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {list.map(s => {
          const o = s.outcomes!;
          const hasEmployers = (o.cs_top_employers?.length ?? 0) > 0;
          const hasGrad = (o.cs_top_grad_schools?.length ?? 0) > 0;
          if (!hasEmployers && !hasGrad && !o.cs_median_starting_salary) return null;
          return (
            <div key={s.slug} className="card p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <div className="serif text-[15px] font-semibold">{s.short}</div>
                  <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
                    {o.first_dest_year ? `Class of ${o.first_dest_year}` : ""}
                    {o.first_dest_knowledge_rate ? ` · ${o.first_dest_knowledge_rate} knowledge rate` : ""}
                    {o.first_dest_year && parseInt(o.first_dest_year) < 2023 && (
                      <span className="chip chip-outline ml-2 text-[9.5px] py-0 px-1 border-[hsl(var(--fit-conditional))] text-[hsl(var(--fit-conditional))]">stale</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <MyRatingChip slug={s.slug}/>
                  <NoteButton slug={s.slug}/>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[12px]">
                {o.cs_median_starting_salary != null && (
                  <div>
                    <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] flex items-center gap-1"><TrendingUp size={10}/> Median CS salary</div>
                    <div className="serif text-[18px] font-semibold num">{fmtCost(o.cs_median_starting_salary)}</div>
                    <div className="text-[10.5px] text-[hsl(var(--muted-foreground))]">{o.cs_salary_scope}</div>
                  </div>
                )}
                {o.cs_pct_continuing_edu && (
                  <div>
                    <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] flex items-center gap-1"><GraduationCap size={10}/> Continuing to grad school</div>
                    <div className="serif text-[18px] font-semibold num">{o.cs_pct_continuing_edu}</div>
                  </div>
                )}
              </div>

              {hasEmployers && (
                <div className="mt-3">
                  <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] flex items-center gap-1 mb-1"><Briefcase size={10}/> Top CS/AI employers</div>
                  <div className="flex flex-wrap gap-1">
                    {o.cs_top_employers.map((e,i) => (
                      <span key={i} className="chip chip-outline text-[11px]">{e}</span>
                    ))}
                  </div>
                </div>
              )}

              {hasGrad && (
                <div className="mt-2">
                  <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] flex items-center gap-1 mb-1"><GraduationCap size={10}/> Top grad-school destinations</div>
                  <div className="flex flex-wrap gap-1">
                    {o.cs_top_grad_schools.map((e,i) => (
                      <span key={i} className="chip chip-outline text-[11px]">{e}</span>
                    ))}
                  </div>
                </div>
              )}

              {o.first_dest_report_url && (
                <div className="mt-3 pt-2 border-t border-[hsl(var(--border))]/50">
                  <a href={o.first_dest_report_url} target="_blank" rel="noreferrer noopener"
                    className="text-[11px] text-[hsl(var(--accent))] hover:underline inline-flex items-center gap-0.5">
                    Full first-destination report <ExternalLink size={9}/>
                  </a>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
