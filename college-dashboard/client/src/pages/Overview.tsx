import { useMemo, useState } from "react";
import { schools, School, stripSourceTags } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import {
  SchoolCard, ArchetypeChips, AxisBar, CostChip, ShortlistPill, AidChip,
} from "@/components/SchoolBits";
import { Search, ArrowUpDown, X, SlidersHorizontal, ArrowRight, CalendarClock } from "lucide-react";
import deadlinesData from "@/data/deadlines.json";
import scholarshipData from "@/data/scholarships.json";
import roboticsPaths from "@/data/robotics_paths.json";
import { PersonalPriorities } from "@/components/PersonalPriorities";
import { useWeights } from "@/lib/weights";
import { useRanks } from "@/lib/ranks";
import { Coins } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  ScatterChart, Scatter, ZAxis, LabelList,
} from "recharts";
import { Link } from "wouter";

type SortKey = "name" | "cost_for_nc_resident" | "undergrad_enrollment" | keyof School["axes"] | "fit_rank" | "personal_score" | "my_rank";
const fitRank: Record<string, number> = { "TOP FIT": 3, "STRONG FIT": 2, "CONDITIONAL FIT": 1, "LOWER FIT": 0 };
const fitColor: Record<string, string> = {
  "TOP FIT": "hsl(145 55% 35%)",
  "STRONG FIT": "hsl(200 65% 40%)",
  "CONDITIONAL FIT": "hsl(30 80% 45%)",
  "LOWER FIT": "hsl(0 60% 45%)",
};

export default function OverviewPage() {
  const { hidden, toggle, visible: allVisible } = useHidden();
  const { personalScore, isCustomized } = useWeights();
  const { ranks, rankedCount } = useRanks();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>(rankedCount > 0 ? "my_rank" : isCustomized ? "personal_score" : "fit_rank");
  const [asc, setAsc] = useState(false);
  const [regionFilter, setRegionFilter] = useState<string[]>([]);
  const [accessFilter, setAccessFilter] = useState<string[]>([]);
  const [archFilter, setArchFilter] = useState<string[]>([]);
  const [sizeFilter, setSizeFilter] = useState<string[]>([]);
  const [publicOnly, setPublicOnly] = useState<"all" | "public" | "private">("all");

  const filtered = useMemo(() => {
    const ql = q.toLowerCase().trim();
    let list = schools.filter(s => {
      if (ql && !(`${s.name} ${s.short} ${s.city_state} ${s.notable_ai_institute} ${s.degree_name}`.toLowerCase().includes(ql))) return false;
      if (regionFilter.length && !regionFilter.includes(s.region)) return false;
      if (accessFilter.length && !accessFilter.includes(s.major_access_status)) return false;
      if (archFilter.length && !archFilter.some(a => s.archetypes.includes(a))) return false;
      if (sizeFilter.length && !sizeFilter.includes(s.size_bucket)) return false;
      if (publicOnly === "public" && !s.is_public) return false;
      if (publicOnly === "private" && s.is_public) return false;
      return true;
    });
    list.sort((a,b) => {
      let av: number | string = 0, bv: number | string = 0;
      if (sort === "name") { av = a.short; bv = b.short; }
      else if (sort === "fit_rank") { av = fitRank[a.fit_classification] ?? 0; bv = fitRank[b.fit_classification] ?? 0; }
      else if (sort === "cost_for_nc_resident") { av = a.cost_for_nc_resident ?? 999999; bv = b.cost_for_nc_resident ?? 999999; }
      else if (sort === "undergrad_enrollment") { av = a.undergrad_enrollment ?? 0; bv = b.undergrad_enrollment ?? 0; }
      else if (sort === "personal_score") { av = personalScore(a) ?? -1; bv = personalScore(b) ?? -1; }
      else if (sort === "my_rank") {
        // Lower rank = better; unranked schools go to the bottom regardless of `asc`
        const ar = ranks[a.slug] ?? Infinity;
        const br = ranks[b.slug] ?? Infinity;
        if (ar === Infinity && br !== Infinity) return 1;
        if (br === Infinity && ar !== Infinity) return -1;
        av = -ar; bv = -br; // Negate so "desc" (default) puts rank 1 first
      }
      else { av = (a.axes as any)[sort] ?? -1; bv = (b.axes as any)[sort] ?? -1; }
      if (typeof av === "string" && typeof bv === "string") return asc ? av.localeCompare(bv) : bv.localeCompare(av);
      return asc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return list;
  }, [q, sort, asc, regionFilter, accessFilter, archFilter, sizeFilter, publicOnly, personalScore, ranks]);

  const visible = filtered.filter(s => !hidden.has(s.slug));
  const hiddenInView = filtered.filter(s => hidden.has(s.slug));

  return (
    <div className="space-y-6">
      {/* ===== HERO ===== */}
      <div className="card overflow-hidden relative">
        <div className="absolute inset-0 pointer-events-none opacity-[0.08]"
          style={{ backgroundImage: "radial-gradient(circle at 20% 30%, hsl(var(--accent)), transparent 50%), radial-gradient(circle at 80% 70%, hsl(var(--primary)), transparent 50%)" }} />
        <div className="relative p-6 md:p-8 grid md:grid-cols-[1.4fr_1fr] gap-6 items-center">
          <div>
            <div className="text-[11px] tracking-widest uppercase text-[hsl(var(--accent))] mb-2">The whole study, one screen</div>
            <h1 className="serif text-[32px] md:text-[38px] font-semibold leading-[1.05] max-w-xl">
              {schools.length} undergraduate AI programs, audited against what actually matters.
            </h1>
            <p className="mt-3 text-[13.5px] text-[hsl(var(--muted-foreground))] max-w-xl leading-relaxed">
              Not a ranking. A calm, filterable read on where the AI curriculum has real depth, where undergraduates actually get into labs, and where the culture is intense-but-not-cutthroat.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/why" className="chip chip-primary hover:bg-[hsl(var(--primary))] hover:text-white transition-colors inline-flex items-center gap-1">
                Why to choose each school <ArrowRight size={12}/>
              </Link>
              <Link href="/drawbacks" className="chip chip-outline hover:bg-[hsl(var(--elevate-1))] inline-flex items-center gap-1">
                Biggest drawback of each <ArrowRight size={12}/>
              </Link>
              <Link href="/compare" className="chip chip-outline hover:bg-[hsl(var(--elevate-1))] inline-flex items-center gap-1">
                Compare 2-4 side by side <ArrowRight size={12}/>
              </Link>
              <Link href="/timeline" className="chip chip-outline hover:bg-[hsl(var(--elevate-1))] inline-flex items-center gap-1">
                <CalendarClock size={12}/> Application timeline <ArrowRight size={12}/>
              </Link>
              <Link href="/scholarships" className="chip chip-outline hover:bg-[hsl(var(--elevate-1))] inline-flex items-center gap-1">
                <Coins size={12}/> Merit scholarships <ArrowRight size={12}/>
              </Link>
              <Link href="/ranking" className="chip chip-primary inline-flex items-center gap-1">
                Rank the schools yourself <ArrowRight size={12}/>
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <HeroKpi label="Schools" value={`${allVisible.length}`} sub={hidden.size ? `${hidden.size} hidden` : `all ${schools.length} visible`} />
            <HeroKpi label="Top-fit schools" value={`${allVisible.filter(s=>s.fit_classification==="TOP FIT").length}`} sub="Preliminary fit tier" />
            <HeroKpi label="With dedicated AI degree" value={`${allVisible.filter(s=>s.archetypes.includes("A")).length}`} sub="Program archetype A" />
            <HeroKpi label="Direct-admit majors" value={`${allVisible.filter(s=>s.major_access_status==="DIRECT").length}`} sub="No internal gate" />
          </div>
        </div>
      </div>

      {/* ===== CHARTS ROW ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <FitDistribution />
        <ArchetypeCounts />
        <ValueScatter />
      </div>

      {/* ===== PERSONAL PRIORITIES ===== */}
      <PersonalPriorities />

      {/* ===== APPLICATION TIMELINE PREVIEW ===== */}
      <UpcomingDeadlines />

      {/* ===== FILTERS ===== */}
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
            <input value={q} onChange={e=>setQ(e.target.value)}
              placeholder="Search name, city, degree, AI institute…"
              className="w-full pl-9 pr-3 py-2 text-[13px] rounded bg-[hsl(var(--muted))] border border-[hsl(var(--border))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--accent))]"/>
          </div>
          <div className="flex items-center gap-1.5 text-[12px]">
            <ArrowUpDown size={12} className="text-[hsl(var(--muted-foreground))]" />
            <span className="text-[hsl(var(--muted-foreground))]">Sort by</span>
            <select value={sort} onChange={e=>setSort(e.target.value as SortKey)}
              className="text-[12px] py-1 px-2 rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
              <option value="my_rank">My ranking</option>
              <option value="personal_score">My personal score</option>
              <option value="fit_rank">Fit tier</option>
              <option value="name">Name</option>
              <option value="cost_for_nc_resident">Cost for NC resident</option>
              <option value="undergrad_enrollment">Size</option>
              <option value="program_depth">AI curriculum</option>
              <option value="research_access">Research access</option>
              <option value="hands_on">Hands-on</option>
              <option value="campus_life">Campus life</option>
              <option value="ambition_healthy">Healthy ambition</option>
              <option value="outcomes">Outcomes</option>
            </select>
            <button onClick={()=>setAsc(a=>!a)} className="text-[12px] py-1 px-2 rounded border border-[hsl(var(--border))]" title="Toggle direction">{asc ? "↑" : "↓"}</button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-[hsl(var(--muted-foreground))] inline-flex items-center gap-1"><SlidersHorizontal size={12}/> Region</span>
          {["Northeast","Midwest","Southeast"].map(r => (
            <Toggle key={r} on={regionFilter.includes(r)} onClick={()=>setRegionFilter(v => v.includes(r) ? v.filter(x=>x!==r) : [...v, r])}>{r}</Toggle>
          ))}
          <Sep />
          <span className="text-[hsl(var(--muted-foreground))]">Access</span>
          {["DIRECT","MIXED","GATED"].map(a => (
            <Toggle key={a} on={accessFilter.includes(a)} onClick={()=>setAccessFilter(v => v.includes(a) ? v.filter(x=>x!==a) : [...v, a])}>{a}</Toggle>
          ))}
          <Sep />
          <span className="text-[hsl(var(--muted-foreground))]">Program type</span>
          {["A","B","C","D","E"].map(a => (
            <Toggle key={a} on={archFilter.includes(a)}
              onClick={()=>setArchFilter(v => v.includes(a) ? v.filter(x=>x!==a) : [...v, a])}
              title={{A:"Dedicated AI",B:"Deep CS+AI",C:"AI+Robotics",D:"Undergrad-centered",E:"Large AI ecosystem"}[a as "A"|"B"|"C"|"D"|"E"]}>{a}</Toggle>
          ))}
          <Sep />
          <span className="text-[hsl(var(--muted-foreground))]">Size</span>
          {[{v:"very-small",l:"< 3k"},{v:"small",l:"3–8k"},{v:"medium",l:"8–20k"},{v:"large",l:"20k+"}].map(o => (
            <Toggle key={o.v} on={sizeFilter.includes(o.v)} onClick={()=>setSizeFilter(v => v.includes(o.v) ? v.filter(x=>x!==o.v) : [...v, o.v])}>{o.l}</Toggle>
          ))}
          <Sep />
          <select value={publicOnly} onChange={e=>setPublicOnly(e.target.value as any)}
            className="text-[12px] py-1 px-2 rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
            <option value="all">Public & private</option>
            <option value="public">Public only</option>
            <option value="private">Private only</option>
          </select>
          {(regionFilter.length || accessFilter.length || archFilter.length || sizeFilter.length || publicOnly!=="all" || q) ?
            <button className="ml-auto text-[12px] text-[hsl(var(--accent))] hover:underline inline-flex items-center gap-1"
              onClick={()=>{setRegionFilter([]);setAccessFilter([]);setArchFilter([]);setSizeFilter([]);setPublicOnly("all");setQ("");}}>
              <X size={12}/> Clear filters
            </button> : null}
        </div>
      </div>

      {/* ===== SCHOOL CARDS ===== */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {visible.map(s => (
          <SchoolCard key={s.slug} s={s}>
            <div className="text-[12px] text-[hsl(var(--muted-foreground))] mb-2 line-clamp-2">{s.degree_name}</div>
            <ArchetypeChips codes={s.archetypes} />
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-3">
              <AxisBar value={s.axes.program_depth} label="AI curriculum" />
              <AxisBar value={s.axes.research_access} label="Research access" />
              <AxisBar value={s.axes.hands_on} label="Hands-on" />
              <AxisBar value={s.axes.campus_life} label="Campus life" />
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-3">
              <CostChip s={s} />
              <AidChip s={s} />
              <span className="chip">{s.region}</span>
              <ShortlistPill group={s.shortlist_group} />
              {ranks[s.slug] != null && (
                <Link href="/ranking" className="chip chip-primary" title="Your rank for this school">
                  My #{ranks[s.slug]}
                </Link>
              )}
              {isCustomized && personalScore(s) != null && (
                <span className="chip chip-accent" title="Your personal weighted score for this school">
                  My score {personalScore(s)!.toFixed(1)}
                </span>
              )}
              <ScholarshipChip slug={s.slug}/>
              <RoboticsChip slug={s.slug}/>
            </div>
            <div className="text-[12px] mt-2.5 leading-relaxed">
              <div><span className="text-[hsl(var(--muted-foreground))]">Why here:</span> {trunc(stripSourceTags(s.best_fit_reason), 180)}</div>
              <div className="mt-1"><span className="text-[hsl(var(--muted-foreground))]">Concern:</span> {trunc(stripSourceTags(s.biggest_concern), 160)}</div>
            </div>
          </SchoolCard>
        ))}
      </div>

      {hiddenInView.length > 0 && (
        <div className="card p-4">
          <div className="text-[13px] font-medium mb-2">
            {hiddenInView.length} hidden school{hiddenInView.length>1?"s":""} match{hiddenInView.length===1?"es":""} these filters
          </div>
          <div className="flex flex-wrap gap-1.5">
            {hiddenInView.map(s => (
              <button key={s.slug} onClick={()=>toggle(s.slug)} className="chip chip-outline hover:bg-[hsl(var(--elevate-1))]">
                + {s.short}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Hero + small helpers ---------- */

function RoboticsChip({ slug }: { slug: string }) {
  const d = (roboticsPaths.schools as any)[slug];
  if (!d) return null;
  const hasBS = d.has_bs_robotics?.startsWith("Yes");
  const easier = d.robotics_easier_than_cs === "Yes";
  if (!hasBS && !easier) return null;
  return (
    <Link href="/robotics" className={`chip inline-flex items-center gap-1 ${hasBS ? "chip-primary" : "chip-outline"}`}
      title={hasBS ? `Dedicated BS Robotics: ${d.bs_robotics_name}` : "Robotics is an easier admit than CS here"}>
      🤖 {hasBS ? "BS Robotics" : "Easier via ME"}
    </Link>
  );
}

function ScholarshipChip({ slug }: { slug: string }) {
  const d = (scholarshipData.schools as any)[slug];
  if (!d || d.offers_merit === "None") return null;
  const flag = d.flagship_amount ? d.flagship_amount.split(";")[0].trim() : null;
  const isBig = d.generosity && (d.generosity.includes("Very generous") || d.generosity.includes("Generous"));
  if (!isBig) return null;
  return (
    <Link href="/scholarships" className="chip chip-primary inline-flex items-center gap-1" title={flag ? `Merit: ${flag}` : "Merit available"}>
      <Coins size={10}/> {d.ed_specific ? "ED bonus" : "Merit"}
    </Link>
  );
}

function HeroKpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-[hsl(var(--card))] rounded-lg border border-[hsl(var(--card-border))] p-4">
      <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">{label}</div>
      <div className="serif text-[28px] leading-none font-semibold num mt-1">{value}</div>
      {sub && <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] mt-1">{sub}</div>}
    </div>
  );
}

function Toggle({ on, onClick, children, title }: { on: boolean; onClick: ()=>void; children: any; title?: string }) {
  return (
    <button onClick={onClick} title={title}
      className={`chip ${on ? "chip-accent" : "chip-outline"} hover:bg-[hsl(var(--elevate-1))]`}>{children}</button>
  );
}
function Sep() { return <span className="text-[hsl(var(--muted-foreground))]">·</span>; }
function trunc(s: string, n: number) { return s && s.length > n ? s.slice(0, n-1).trimEnd() + "…" : s; }

/* ---------- Upcoming Deadlines widget ---------- */

type Round = "ed1" | "ed2" | "ea" | "rea_scea" | "rd";
const roundMeta: Record<Round, { short: string; color: string; long: string }> = {
  ed1:      { short: "ED I",      long: "Early Decision I",              color: "hsl(var(--fit-lower))" },
  ed2:      { short: "ED II",     long: "Early Decision II",             color: "hsl(var(--fit-conditional))" },
  rea_scea: { short: "REA/SCEA",  long: "Restrictive/Single-Choice EA",   color: "hsl(var(--chart-5))" },
  ea:       { short: "EA",        long: "Early Action",                  color: "hsl(var(--fit-strong))" },
  rd:       { short: "RD",        long: "Regular Decision",              color: "hsl(var(--primary))" },
};

function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s === "—" || /^n\.a/i.test(s) || /^none$/i.test(s) || /^rolling/i.test(s)) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  const long = /^([A-Za-z]+)\.?\s+(\d{1,2})(?:,\s*(\d{4}))?/.exec(s);
  if (long) {
    const ix = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(long[1].slice(0,3).toLowerCase());
    if (ix < 0) return null;
    const y = long[3] ? +long[3] : (ix >= 7 ? 2026 : 2027);
    return new Date(y, ix, +long[2]);
  }
  return null;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function UpcomingDeadlines() {
  const { hidden } = useHidden();
  // App is anchored to Fall 2027 entry, so pin "today" to the study's data date
  // (July 29 2026) rather than real wall-clock — dates in the deadline dataset
  // are for the 2026-27 cycle and would otherwise look "in the past" during
  // your reading window in 2026.
  const anchor = new Date(2026, 7, 15); // Aug 15, 2026

  const rows = (deadlinesData.rows || []) as any[];
  const items: { slug: string; short: string; round: Round; label: string; date: Date; daysAway: number; cycle: string }[] = [];
  for (const r of rows) {
    if (hidden.has(r.slug)) continue;
    const school = schools.find(s => s.slug === r.slug);
    if (!school) continue;
    for (const key of Object.keys(roundMeta) as Round[]) {
      const dt = parseDate(r[key]);
      if (!dt) continue;
      const days = daysBetween(anchor, dt);
      items.push({
        slug: r.slug, short: school.short,
        round: key, label: r[key],
        date: dt, daysAway: days, cycle: r.cycle_label,
      });
    }
  }

  const upcoming = items.filter(i => i.daysAway >= -14).sort((a,b) => a.daysAway - b.daysAway).slice(0, 10);

  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between mb-1">
        <div className="flex items-baseline gap-2">
          <CalendarClock size={15} className="text-[hsl(var(--accent))]"/>
          <div className="text-[13.5px] font-medium">Next application deadlines</div>
          <div className="text-[11px] text-[hsl(var(--muted-foreground))]">Fall 2027 entry cycle</div>
        </div>
        <Link href="/timeline" className="text-[11.5px] text-[hsl(var(--accent))] hover:underline inline-flex items-center gap-0.5">
          Full timeline <ArrowRight size={11}/>
        </Link>
      </div>
      <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] mb-3">Sorted by how far away each deadline is from Aug 15, 2026. Colors match the timeline page's rounds.</div>
      {upcoming.length === 0 ? (
        <div className="text-[12px] text-[hsl(var(--muted-foreground))] py-4 text-center">No upcoming deadlines for visible schools.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1.5">
          {upcoming.map((i, ix) => {
            const meta = roundMeta[i.round];
            const daysLabel = i.daysAway < 0
              ? `${Math.abs(i.daysAway)}d ago`
              : i.daysAway === 0 ? "today"
              : i.daysAway < 30 ? `in ${i.daysAway}d`
              : `in ${Math.round(i.daysAway/30)}mo`;
            const dateStr = i.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
            return (
              <Link key={`${i.slug}-${i.round}-${ix}`} href="/timeline"
                className="flex items-center gap-2 py-1 px-1.5 rounded hover:bg-[hsl(var(--elevate-1))] cursor-pointer">
                <span className="dot shrink-0" style={{ background: meta.color }}/>
                <span className="text-[12.5px] font-medium min-w-[120px] truncate">{i.short}</span>
                <span className="chip chip-outline text-[10px] py-0 px-1" title={meta.long}>{meta.short}</span>
                <span className="text-[11.5px] num text-[hsl(var(--muted-foreground))] flex-1">{dateStr}</span>
                <span className={`text-[11px] num shrink-0 ${i.daysAway < 30 ? "text-[hsl(var(--fit-lower))] font-semibold" : "text-[hsl(var(--muted-foreground))]"}`}>{daysLabel}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- CHART: Fit distribution ---------- */

function FitDistribution() {
  const { visible } = useHidden();
  const tiers = ["TOP FIT","STRONG FIT","CONDITIONAL FIT","LOWER FIT"];
  const data = tiers.map(t => ({
    tier: t.replace(" FIT",""),
    full: t,
    count: visible.filter(s => s.fit_classification === t).length,
    color: fitColor[t] || "hsl(var(--muted))",
  })).filter(d => d.count > 0 || d.full !== "LOWER FIT");
  return (
    <div className="card p-4">
      <div className="text-[12.5px] font-medium mb-1">Fit distribution of visible schools</div>
      <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] mb-3">Fit is documented program + campus fit, not admissions probability.</div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 14, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" vertical={false}/>
          <XAxis dataKey="tier" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false}/>
          <YAxis allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} width={22}/>
          <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12, borderRadius: 6 }}
            formatter={(v: any) => [v, "Schools"]} labelFormatter={(l:any) => data.find(d=>d.tier===l)?.full || l}/>
          <Bar dataKey="count" radius={[3,3,0,0]}>
            {data.map((d, i) => <Cell key={i} fill={d.color} />)}
            <LabelList dataKey="count" position="top" style={{ fontSize: 11, fill: "hsl(var(--foreground))", fontWeight: 600 }}/>
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- CHART: Archetype counts ---------- */

function ArchetypeCounts() {
  const { visible } = useHidden();
  const labels: Record<string,string> = { A:"Dedicated AI", B:"Deep CS+AI", C:"AI+Robotics", D:"Undergrad-centered", E:"Large AI ecosystem" };
  const data = ["A","B","C","D","E"].map(k => ({
    code: k, label: labels[k],
    count: visible.filter(s => s.archetypes.includes(k)).length,
  }));
  return (
    <div className="card p-4">
      <div className="text-[12.5px] font-medium mb-1">Program-type coverage</div>
      <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] mb-3">A school can be more than one archetype.</div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 22, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" horizontal={false}/>
          <XAxis type="number" allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false}/>
          <YAxis type="category" dataKey="label" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} width={112}/>
          <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12, borderRadius: 6 }}
            formatter={(v: any) => [v, "Schools"]}/>
          <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0,3,3,0]}>
            <LabelList dataKey="count" position="right" style={{ fontSize: 11, fill: "hsl(var(--foreground))", fontWeight: 600 }}/>
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- CHART: Cost vs AI curriculum depth scatter ---------- */

function ValueScatter() {
  const { visible } = useHidden();
  const data = visible
    .filter(s => s.cost_for_nc_resident != null && s.axes.program_depth != null)
    .map(s => ({
      name: s.short, x: s.cost_for_nc_resident, y: s.axes.program_depth,
      fit: s.fit_classification, color: fitColor[s.fit_classification] || "hsl(var(--muted))",
    }));
  return (
    <div className="card p-4">
      <div className="text-[12.5px] font-medium mb-1">Value map · cost vs. AI depth</div>
      <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] mb-3">Up-and-left is more program for less money. In-state cost used for NC publics.</div>
      <ResponsiveContainer width="100%" height={180}>
        <ScatterChart margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))"/>
          <XAxis type="number" dataKey="x" tickFormatter={(v)=>`$${Math.round(v/1000)}k`}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} name="Cost"/>
          <YAxis type="number" dataKey="y" domain={[1,5]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} width={26} name="AI depth"/>
          <ZAxis range={[70, 70]} />
          <Tooltip cursor={{ strokeDasharray: "3 3" }}
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12, borderRadius: 6 }}
            formatter={(v: any, k: any) => k === "x" ? [`$${(v as number).toLocaleString()}`, "Cost"] : [v, "AI depth"]}
            labelFormatter={(_, payload: any) => payload?.[0]?.payload?.name || ""}/>
          <Scatter data={data}>
            {data.map((d, i) => <Cell key={i} fill={d.color}/>)}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
