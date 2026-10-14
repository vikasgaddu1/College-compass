import { useMemo, useState } from "react";
import { schools, School, stripSourceTags, archetypeLabels } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import {
  SchoolCard, ArchetypeChips, AxisBar, CostChip, ShortlistPill, AidChip,
} from "@/components/SchoolBits";
import { Search, ArrowUpDown, X, SlidersHorizontal, ArrowRight, CalendarClock } from "lucide-react";
import deadlinesData from "@/data/deadlines.json";
import { todayIso, dateUTC, daysUntil, parseCycleDates } from "@/lib/calendar";
import scholarshipData from "@/data/scholarships.json";
import roboticsRoutes from "@/data/robotics_routes.json";
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
  const [sort, setSort] = useState<SortKey>(rankedCount > 0 ? "my_rank" : isCustomized ? "personal_score" : "robotics_curriculum");
  const [asc, setAsc] = useState(false);
  const [regionFilter, setRegionFilter] = useState<string[]>([]);
  const [accessFilter, setAccessFilter] = useState<string[]>([]);
  const [archFilter, setArchFilter] = useState<string[]>([]);
  const [sizeFilter, setSizeFilter] = useState<string[]>([]);
  const [publicOnly, setPublicOnly] = useState<"all" | "public" | "private">("all");

  const filtered = useMemo(() => {
    const ql = q.toLowerCase().trim();
    let list = schools.filter(s => {
      if (ql && !(`${s.name} ${s.short} ${s.city_state} ${s.robotics_access_detail?.institute_or_center ?? ""} ${s.degree_name} ${s.recommended_major_route}`.toLowerCase().includes(ql))) return false;
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
              {schools.length} schools, one question: the best way into robotics.
            </h1>
            <p className="mt-3 text-[13.5px] text-[hsl(var(--muted-foreground))] max-w-xl leading-relaxed">
              Not a ranking. For each school: a dedicated BS in Robotics if it has a real one, otherwise the ECE or CS route, how a first-year actually gets in, and where undergraduates get into robotics labs.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/routes" className="chip chip-primary hover:bg-[hsl(var(--primary))] hover:text-white transition-colors inline-flex items-center gap-1">
                Robotics route at each school <ArrowRight size={12}/>
              </Link>
              <Link href="/why" className="chip chip-outline hover:bg-[hsl(var(--elevate-1))] inline-flex items-center gap-1">
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
            <HeroKpi label="Robotics engineering technology" value={`${allVisible.filter(s=>(roboticsRoutes.schools as any)[s.slug]?.bs_robotics?.kind==="engineering_technology").length}`} sub="A distinct degree type; Purdue Polytechnic" />
            <HeroKpi label="Primary robotics majors" value={`${allVisible.filter(s=>(roboticsRoutes.schools as any)[s.slug]?.bs_robotics?.kind==="primary_major").length}`} sub="Primary robotics majors; Purdue technology is separate" />
            <HeroKpi label="Best via ECE" value={`${allVisible.filter(s=>(roboticsRoutes.schools as any)[s.slug]?.recommended_route==="ece").length}`} sub="No robotics BS, ECE route recommended" />
          </div>
        </div>
      </div>

      {/* ===== CHARTS ROW ===== */}
      <div className="card p-4 space-y-3">
        <div className="serif text-[17px] font-semibold">Start with these different robotics routes</div>
        <p className="text-[12px] text-[hsl(var(--muted-foreground))]">Compare hardware, sensing and controls with autonomy and supporting AI electives. These are qualitative starting points; major entry, elective seats and lab places depend on each route's rules.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            { slug: "wpi", reason: "Integrated robot-building and required projects in an established robotics engineering degree." },
            { slug: "michigan", reason: "A broad Robotics BSE combining engineering foundations with selectable robotics depth." },
            { slug: "carnegie-mellon", reason: "An ambitious primary Robotics BS in SCS; apply to that school for this degree." },
            { slug: "nc-state", reason: "In-state value through Electrical Engineering's Controls and Robotics concentration, after CODA." },
          ].filter(choice => !hidden.has(choice.slug)).map(choice => {
            const school = schools.find(s => s.slug === choice.slug);
            if (!school) return null;
            return <div key={choice.slug} className="rounded border border-[hsl(var(--border))] p-3 text-[12px]">
              <Link href="/routes" className="font-semibold hover:underline">{school.short}</Link>
              <div className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1">{school.degree_name}</div>
              <p className="mt-1.5 leading-relaxed">{choice.reason}</p>
            </div>;
          })}
        </div>
      </div>

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
              placeholder="Search name, city, robotics degree or route…"
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
              <option value="robotics_curriculum">Robotics curriculum</option>
              <option value="robotics_access">Undergraduate robotics access</option>
              <option value="program_depth">AI electives (supporting)</option>
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
              title={archetypeLabels[a]}>{a}</Toggle>
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
              <AxisBar value={s.axes.robotics_curriculum ?? null} label="Robotics curriculum" />
              <AxisBar value={s.axes.robotics_access ?? null} label="Robotics access" />
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
  const r = (roboticsRoutes.schools as any)[slug];
  if (!r) return null;
  const text = r.recommended_route === "bs_robotics" ? "Primary robotics major"
    : r.recommended_route === "ece" ? "ECE + robotics" : "CS + robotics";
  return <Link href="/routes" className="chip chip-outline text-[10px]" title={r.recommended_summary}>{text}</Link>;
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

function UpcomingDeadlines() {
  const { hidden } = useHidden();
  const today = todayIso();

  const rows = (deadlinesData.rows || []) as any[];
  const items: { slug: string; short: string; round: Round; label: string; date: Date; daysAway: number; cycle: string }[] = [];
  for (const r of rows) {
    if (hidden.has(r.slug)) continue;
    const school = schools.find(s => s.slug === r.slug);
    if (!school) continue;
    const events = Array.isArray(r.events) ? r.events : (Object.keys(roundMeta) as Round[]).flatMap(round =>
      parseCycleDates(r[round]).map(date => ({ round, date, label: r[round] }))
    );
    for (const event of events) {
      if (!(event.round in roundMeta)) continue;
      items.push({
        slug: r.slug, short: school.short, round: event.round as Round,
        label: event.label, date: dateUTC(event.date),
        daysAway: daysUntil(event.date, today), cycle: r.cycle_label,
      });
    }
  }

  const upcoming = items.filter(i => i.daysAway >= 0).sort((a,b) => a.daysAway - b.daysAway).slice(0, 10);

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
      <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] mb-3">Days remaining from today ({today}, America/New_York). Research reviewed October 14, 2026.</div>
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
            const dateStr = i.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
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
  const labels = archetypeLabels;
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

/* ---------- CHART: Historical sticker cost vs robotics curriculum ---------- */

function ValueScatter() {
  const { visible } = useHidden();
  const data = visible
    .filter(s => s.cost_for_nc_resident != null && s.axes.robotics_curriculum != null)
    .map(s => ({
      name: s.short, x: s.cost_for_nc_resident, y: s.axes.robotics_curriculum,
      fit: s.fit_classification, color: fitColor[s.fit_classification] || "hsl(var(--muted))",
    }));
  return (
    <div className="card p-4">
      <div className="text-[12.5px] font-medium mb-1">Value map · cost vs. robotics curriculum</div>
      <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] mb-3">Historical sticker budgets and an ordinal curriculum score; compare aid and route access separately.</div>
      <ResponsiveContainer width="100%" height={180}>
        <ScatterChart margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))"/>
          <XAxis type="number" dataKey="x" tickFormatter={(v)=>`$${Math.round(v/1000)}k`}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} name="Cost"/>
          <YAxis type="number" dataKey="y" domain={[1,5]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} width={26} name="Robotics curriculum"/>
          <ZAxis range={[70, 70]} />
          <Tooltip cursor={{ strokeDasharray: "3 3" }}
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12, borderRadius: 6 }}
            formatter={(v: any, k: any) => k === "x" ? [`$${(v as number).toLocaleString()}`, "Cost"] : [v, "Robotics curriculum"]}
            labelFormatter={(_, payload: any) => payload?.[0]?.payload?.name || ""}/>
          <Scatter data={data}>
            {data.map((d, i) => <Cell key={i} fill={d.color}/>)}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
