import { schools, School, shortlistLabel, stripSourceTags } from "@/lib/data";
import { SchoolCard, ArchetypeChips, AxisBar, CostChip } from "@/components/SchoolBits";

const order: School["shortlist_group"][] = ["strongest","alternative","reserve","weakened"];
const blurb: Record<string,string> = {
  strongest: "Best combination of AI-program depth, real undergraduate access, and campus fit.",
  alternative: "Each brings a specific distinct advantage — different size, cost, or approach.",
  reserve: "Cleared the candidate screen but not carried to the shortlist. Held for consideration.",
  weakened: "Looked promising initially, but deeper research surfaced a decisive weakness.",
};
const tone: Record<string, string> = {
  strongest: "border-l-[hsl(var(--fit-top))]",
  alternative: "border-l-[hsl(var(--fit-strong))]",
  reserve: "border-l-[hsl(var(--muted-foreground))]",
  weakened: "border-l-[hsl(var(--fit-lower))]",
};

export default function ShortlistPage() {
  return (
    <div className="space-y-6">
      <div className="card p-4">
        <div className="serif text-[18px] font-semibold mb-1">The final shortlist, grouped by fit tier</div>
        <div className="text-[12.5px] text-[hsl(var(--muted-foreground))] max-w-3xl leading-relaxed">
          These groupings come from the underlying research report. No admissions probability is used — grouping is based only on documented program strengths, undergraduate access, and campus fit. Hidden schools are excluded automatically.
        </div>
      </div>
      {order.map(group => {
        const list = schools.filter(s => s.shortlist_group === group);
        return (
          <section key={group} className={`border-l-4 pl-4 -ml-4 ${tone[group]}`}>
            <div className="flex items-baseline gap-3">
              <h2 className="serif text-[20px] font-semibold">{shortlistLabel[group]}</h2>
              <span className="text-[12px] text-[hsl(var(--muted-foreground))]">{list.length} schools</span>
            </div>
            <p className="text-[12.5px] text-[hsl(var(--muted-foreground))] max-w-2xl -mt-0.5 mb-3">{blurb[group]}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {list.map(s => (
                <SchoolCard key={s.slug} s={s}>
                  <div className="text-[12px] text-[hsl(var(--muted-foreground))] mb-2 line-clamp-2">{s.degree_name}</div>
                  <ArchetypeChips codes={s.archetypes} />
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-3">
                    <AxisBar value={s.axes.program_depth} label="AI curriculum" />
                    <AxisBar value={s.axes.research_access} label="Research access" />
                    <AxisBar value={s.axes.robotics_curriculum ?? null} label="Robotics curriculum" />
                    <AxisBar value={s.axes.robotics_access ?? null} label="Robotics access" />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                    <CostChip s={s} />
                    <span className="chip">{s.region}</span>
                  </div>
                  <div className="text-[12px] mt-2.5">
                    <div className="text-[hsl(var(--muted-foreground))]">Why here</div>
                    <div>{trunc(stripSourceTags(s.best_fit_reason), 160)}</div>
                    <div className="text-[hsl(var(--muted-foreground))] mt-1.5">Biggest concern</div>
                    <div>{trunc(stripSourceTags(s.biggest_concern), 140)}</div>
                  </div>
                </SchoolCard>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
function trunc(s: string, n: number) { return s && s.length > n ? s.slice(0, n-1).trimEnd() + "…" : s; }
