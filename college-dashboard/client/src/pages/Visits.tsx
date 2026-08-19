import { useMemo, useState } from "react";
import { schools as allSchools } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import visitsRaw from "@/data/visits.json";
import { FitBadge, NoteButton } from "@/components/SchoolBits";
import { ExternalLink, CalendarDays, Plane, Car, AlertTriangle, CheckCircle2, Clock } from "lucide-react";

/* ---------------------------------------------------------------------------
 * Campus visit planner.
 *
 * The whole page turns on one date: six of the eight unvisited schools are due
 * 1-2 November 2026, while Texas A&M and UT Austin are 1 December with no early
 * plan. That means the Texas trip belongs AFTER the November wall, which frees
 * three autumn weeks for the schools that actually close first.
 *
 * It deliberately separates two things that get conflated:
 *   interest credit — does the school say a visit counts in review?
 *   decision value  — does seeing it change what he should apply to?
 * Michigan is why. Its Common Data Set lists interest as "Considered", but its
 * visit page says attending an information session is not factored in. High
 * decision value, no interest credit.
 * ------------------------------------------------------------------------- */

const V = visitsRaw as any;

const INTEREST_META: Record<string, { label: string; hue: string; blurb: string }> = {
  counts:   { label: "Visit counts",      hue: "var(--fit-strong)",       blurb: "The school says in prose that demonstrated interest is part of the review." },
  likely:   { label: "Likely counts",     hue: "var(--fit-top)",          blurb: "The school's own Common Data Set lists level of applicant's interest as Considered, though its admissions prose is silent." },
  excluded: { label: "Explicitly excluded", hue: "var(--fit-lower)",      blurb: "The school states that attending a session is NOT factored into review." },
  none:     { label: "Not tracked",       hue: "var(--muted-foreground)", blurb: "The school states it does not consider demonstrated interest. Visit only if it helps HIM decide." },
};

function daysUntil(iso?: string) {
  if (!iso) return null;
  const today = new Date("2026-08-19T00:00:00");
  const d = new Date(iso + "T00:00:00");
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

export default function VisitsPage() {
  const { isHidden } = useHidden();
  const [openTrip, setOpenTrip] = useState<number | null>(1);
  const [openSchool, setOpenSchool] = useState<string | null>(null);

  const byslug = useMemo(() => {
    const m: Record<string, any> = {};
    allSchools.forEach(s => { m[s.slug] = s; });
    return m;
  }, []);

  const planned: string[] = V.trips.flatMap((t: any) => t.schools);
  const visited = Object.entries(V.schools).filter(([, v]: any) => v.visited).map(([k]) => k);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="card p-4">
        <div className="flex items-start gap-2.5">
          <CalendarDays size={18} className="mt-0.5 text-[hsl(var(--accent))]"/>
          <div>
            <div className="serif text-[17px] font-semibold">Campus visits — now to the deadline</div>
            <p className="text-[12px] text-[hsl(var(--muted-foreground))] mt-1 max-w-4xl leading-relaxed">
              {V.note}
            </p>
            <p className="text-[12px] mt-1.5 max-w-4xl leading-relaxed">{V.constraint}</p>
          </div>
        </div>

        {/* The structural point */}
        <div className="mt-3 rounded-md p-3 text-[12px] leading-relaxed"
             style={{ background: "hsl(var(--accent) / 0.07)", border: "1px solid hsl(var(--accent) / 0.35)" }}>
          <strong>The scheduling gift.</strong> Six of the eight are due <strong>1-2 November</strong>. Texas A&amp;M and
          UT Austin are <strong>1 December with no early plan</strong> — so they are the only two that can be visited{" "}
          <em>after</em> the November applications are in. Moving Texas to November frees three autumn weeks for the six
          schools that close first, and turns an impossible eight-school autumn into five manageable trips.
        </div>

        <div className="flex flex-wrap gap-3 mt-3 text-[11.5px]">
          <Stat label="Already visited" value={`${visited.length}`} detail="NC State · Georgia Tech"/>
          <Stat label="Left to see" value={`${planned.length}`} detail="across 5 trips"/>
          <Stat label="School days needed" value={`${V.trips.reduce((a: number, t: any) => a + t.school_days, 0)}`} detail="weekday excuses"/>
          <Stat label="Weeks to 1 Nov" value="10.6" detail="9 usable travel weeks"/>
        </div>
      </div>

      {/* Booking urgency — the actionable bit */}
      <div className="card p-4">
        <div className="text-[13px] font-medium mb-1">Book in this order — not the order you travel</div>
        <p className="text-[11.5px] text-[hsl(var(--muted-foreground))] mb-3 max-w-3xl leading-relaxed">
          Booking lead times differ by more than a month across these schools, so the first thing to reserve is not the
          first thing you visit. Michigan releases tours about two months out and some engineering slots are already
          waitlisted; Carnegie Mellon closes registration 48 hours before, so it is the easiest to book and the hardest
          to schedule around.
        </p>
        <div className="space-y-1.5">
          {Object.entries(V.schools)
            .filter(([, v]: any) => !v.visited && v.book_by)
            .sort((a: any, b: any) => {
              const rank = (w: string) => w.startsWith("Book now") ? 0 : w.startsWith("Book within") ? 1 : w.startsWith("Watch") ? 2 : 3;
              return rank(a[1].book_by.when) - rank(b[1].book_by.when);
            })
            .map(([slug, v]: any) => (
              <div key={slug} className="flex items-start gap-2.5 text-[11.5px] py-1.5 border-b border-[hsl(var(--border))] last:border-0">
                <span className="chip text-[10px] font-semibold whitespace-nowrap shrink-0 w-[168px] justify-center"
                      style={{ color: v.book_by.when.startsWith("Book now") ? "hsl(var(--fit-lower))" : undefined }}>
                  {v.book_by.when}
                </span>
                <span className="serif font-medium w-[130px] shrink-0">{byslug[slug]?.short ?? slug}</span>
                <span className="text-[hsl(var(--muted-foreground))] leading-snug">{v.book_by.why}</span>
              </div>
            ))}
        </div>
      </div>

      {/* Trips */}
      <div className="space-y-3">
        {V.trips.map((t: any) => {
          const open = openTrip === t.id;
          return (
            <div key={t.id} className="card overflow-hidden">
              <button onClick={() => setOpenTrip(open ? null : t.id)}
                      className="w-full text-left p-4 hover:bg-[hsl(var(--muted)/0.4)] transition-colors">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <div className="flex items-baseline gap-2.5">
                    <span className="num text-[13px] font-semibold text-[hsl(var(--accent))]">Trip {t.id}</span>
                    <span className="serif text-[15px] font-semibold">{t.name}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11.5px]">
                    <span className="chip chip-primary text-[10.5px] whitespace-nowrap">{t.dates}</span>
                    <span className="chip text-[10.5px] whitespace-nowrap">
                      {t.school_days} school day{t.school_days === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {t.schools.map((sl: string) => {
                    const s = byslug[sl]; const vs = V.schools[sl];
                    const im = INTEREST_META[vs?.interest?.level ?? "none"];
                    return (
                      <span key={sl} className="chip chip-outline text-[10.5px] inline-flex items-center gap-1.5">
                        {s?.short ?? sl}
                        <span style={{ color: `hsl(${im.hue})` }} className="font-semibold">· {im.label}</span>
                        <span className="text-[hsl(var(--muted-foreground))]">· {vs?.deadline?.label}</span>
                      </span>
                    );
                  })}
                  {isHidden(t.schools[0]) && <span className="chip text-[10px]">hidden from other views</span>}
                </div>
                <p className="text-[12px] leading-relaxed mt-2 text-[hsl(var(--muted-foreground))]">{t.why_first}</p>
              </button>

              {open && (
                <div className="px-4 pb-4 space-y-3 border-t border-[hsl(var(--border))] pt-3">
                  <div className="flex items-start gap-2 text-[11.5px]">
                    {t.travel.startsWith("Drive") ? <Car size={13} className="mt-0.5 shrink-0"/> : <Plane size={13} className="mt-0.5 shrink-0"/>}
                    <span>{t.travel}</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1.5">
                        Book these
                      </div>
                      <ul className="space-y-1">
                        {t.book.map((b: string, i: number) => (
                          <li key={i} className="flex items-start gap-1.5 text-[11.5px] leading-snug">
                            <CheckCircle2 size={12} className="mt-[3px] shrink-0" style={{ color: "hsl(var(--fit-strong))" }}/>
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1.5">
                        Watch out for
                      </div>
                      <ul className="space-y-1">
                        {t.watch.map((w: string, i: number) => (
                          <li key={i} className="flex items-start gap-1.5 text-[11.5px] leading-snug">
                            <AlertTriangle size={12} className="mt-[3px] shrink-0" style={{ color: "hsl(var(--fit-lower))" }}/>
                            <span>{w}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    {t.schools.map((sl: string) => {
                      const vs = V.schools[sl];
                      return (
                        <div key={sl} className="flex items-center gap-2">
                          {vs?.registration_url && (
                            <a href={vs.registration_url} target="_blank" rel="noreferrer"
                               className="chip chip-primary text-[10.5px] inline-flex items-center gap-1 no-underline">
                              Book {byslug[sl]?.short ?? sl} <ExternalLink size={10}/>
                            </a>
                          )}
                          <NoteButton slug={sl}/>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Two weeks not to travel */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <BlockedWeek icon={<AlertTriangle size={14}/>} title="Do not travel this week"
                     dates={V.dead_week.dates} why={V.dead_week.why} hue="var(--fit-lower)"/>
        <BlockedWeek icon={<Clock size={14}/>} title="Reserve for submitting"
                     dates={V.submit_week.dates} why={V.submit_week.why} hue="var(--accent)"/>
      </div>

      {/* If time runs short */}
      <div className="card p-4">
        <div className="text-[13px] font-medium mb-1">If there is not time for all five</div>
        <p className="text-[11.5px] text-[hsl(var(--muted-foreground))] mb-2.5 max-w-3xl leading-relaxed">
          Ranked by what you lose by skipping, measured against school days spent. Cut from the bottom.
        </p>
        <ol className="space-y-1.5">
          {[
            ["Boston — Northeastern + WPI", "1 school day", "Two schools, and the only two where a visit plausibly earns interest credit. WPI is also the only prospective-student robotics lab access on the list. Best ratio by a wide margin — keep this even if you cut everything else."],
            ["Pittsburgh — Carnegie Mellon", "2 school days", "Top fit, and the ED choice between SCS and the engineering colleges is the single highest-stakes decision in the whole application. Worth the days even though CMU gives no interest credit."],
            ["Midwest — Michigan + Purdue", "3 school days", "Two schools per trip. Purdue's visit may count; Michigan's explicitly does not, so if you have to shorten this, do Purdue as a one-night stop and see Michigan another year."],
            ["Texas — UT Austin + Texas A&M", "3 school days", "Only because it costs nothing in the autumn crunch — it happens after the deadline. If November gets busy, this is the easiest to drop: A&M's visit may count, UT's does not."],
            ["Ithaca — Cornell", "2 school days", "Cut first. Cornell says outright it does not track interest and that visiting is neither required nor expected, there is no in-person engineering session, and it is the hardest campus here to reach. Do the Duffield virtual session from home instead."],
          ].map(([name, cost, why], i) => (
            <li key={i} className="flex items-start gap-2.5 text-[11.5px] py-1.5 border-b border-[hsl(var(--border))] last:border-0">
              <span className="num font-semibold text-[hsl(var(--accent))] shrink-0 w-4">{i + 1}</span>
              <div>
                <span className="serif font-medium">{name}</span>
                <span className="chip text-[10px] ml-1.5">{cost}</span>
                <div className="text-[hsl(var(--muted-foreground))] leading-snug mt-0.5">{why}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* Per-school detail */}
      <div className="card p-4">
        <div className="text-[13px] font-medium mb-1">Per-school detail</div>
        <p className="text-[11.5px] text-[hsl(var(--muted-foreground))] mb-3">
          Tour programmes, engineering-specific sessions, robotics access, calendar closures and what each school says
          about whether a visit counts. Click a school to expand.
        </p>
        <div className="space-y-1.5">
          {Object.entries(V.schools)
            .sort((a: any, b: any) => (a[1].visited ? 1 : 0) - (b[1].visited ? 1 : 0))
            .map(([slug, v]: any) => {
              const s = byslug[slug];
              const open = openSchool === slug;
              const im = INTEREST_META[v.interest?.level ?? "none"];
              return (
                <div key={slug} className="border border-[hsl(var(--border))] rounded-md overflow-hidden">
                  <button onClick={() => setOpenSchool(open ? null : slug)}
                          className="w-full text-left px-3 py-2 hover:bg-[hsl(var(--muted)/0.4)] transition-colors">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="serif font-medium text-[13px]">{s?.short ?? slug}</span>
                        {s && <FitBadge fit={s.fit_classification}/>}
                        {v.visited
                          ? <span className="chip text-[10px]" style={{ color: "hsl(var(--fit-strong))" }}>already visited</span>
                          : <span className="chip chip-outline text-[10px]" style={{ color: `hsl(${im.hue})` }} title={im.blurb}>{im.label}</span>}
                      </div>
                      <span className="text-[11px] text-[hsl(var(--muted-foreground))] num">
                        {v.deadline?.label}
                        {!v.visited && daysUntil(v.deadline?.date) != null && ` · ${daysUntil(v.deadline?.date)} days`}
                      </span>
                    </div>
                  </button>

                  {open && (
                    <div className="px-3 pb-3 pt-1 border-t border-[hsl(var(--border))] space-y-2 text-[11.5px]">
                      {v.visited ? (
                        <p className="leading-snug">{v.visited_note}</p>
                      ) : (
                        <>
                          {v.interest && (
                            <Field label="Does a visit count?">
                              <span style={{ color: `hsl(${im.hue})` }} className="font-medium">{im.label}. </span>
                              {v.interest.quote && <em>&ldquo;{v.interest.quote}&rdquo; </em>}
                              <span className="text-[hsl(var(--muted-foreground))]">{v.interest.basis}</span>
                            </Field>
                          )}
                          {v.tours?.length > 0 && (
                            <Field label={`Tour programmes (${v.tours.length})`}>
                              <div className="space-y-1 mt-0.5">
                                {v.tours.map((t: any, i: number) => (
                                  <div key={i} className="pl-2 border-l-2" style={{ borderColor: "hsl(var(--border))" }}>
                                    <span className="chip text-[9.5px] mr-1.5">{String(t.audience ?? "general").replace(/_/g, " ")}</span>
                                    <span className="font-medium">{t.name}</span>
                                    <div className="text-[hsl(var(--muted-foreground))] leading-snug">
                                      {[t.days_offered, t.times, t.duration].filter(Boolean).join(" · ")}
                                    </div>
                                    {t.notes && <div className="text-[hsl(var(--muted-foreground))] leading-snug italic">{t.notes}</div>}
                                  </div>
                                ))}
                              </div>
                            </Field>
                          )}
                          {v.engineering_specific && <Field label="Engineering session">{v.engineering_specific}</Field>}
                          {v.robotics_lab_access && <Field label="Robotics access">{v.robotics_lab_access}</Field>}
                          {v.class_visit_possible && <Field label="Sit in on a class?">{v.class_visit_possible}</Field>}
                          {v.calendar?.fall_break && <Field label="Fall break">{v.calendar.fall_break}</Field>}
                          {v.calendar?.blackouts?.length > 0 && (
                            <Field label="Closures / blackouts">
                              <ul className="mt-0.5 space-y-0.5">
                                {v.calendar.blackouts.map((b: string, i: number) => (
                                  <li key={i} className="leading-snug">· {b}</li>
                                ))}
                              </ul>
                            </Field>
                          )}
                          {v.football?.length > 0 && (
                            <Field label="Home football (lodging)">{v.football.join(" · ")}</Field>
                          )}
                          {v.travel && (
                            <Field label="Getting there">
                              {[v.travel.airport, v.travel.drive_from_cary, v.travel.suggested_stay]
                                .filter(Boolean).join(" — ")}
                            </Field>
                          )}
                          {v.booking_lead_time && <Field label="Booking">{v.booking_lead_time}</Field>}
                          {v.cost_notes && <Field label="Cost notes">{v.cost_notes}</Field>}
                          <div className="flex flex-wrap gap-2 pt-1">
                            {v.visit_home_url && (
                              <a href={v.visit_home_url} target="_blank" rel="noreferrer"
                                 className="chip chip-outline text-[10.5px] inline-flex items-center gap-1 no-underline">
                                Visit page <ExternalLink size={10}/>
                              </a>
                            )}
                            {v.registration_url && v.registration_url !== v.visit_home_url && (
                              <a href={v.registration_url} target="_blank" rel="noreferrer"
                                 className="chip chip-primary text-[10.5px] inline-flex items-center gap-1 no-underline">
                                Register <ExternalLink size={10}/>
                              </a>
                            )}
                            <span className="chip text-[10px]">{(v.sources || []).length} sources</span>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-md border border-[hsl(var(--border))] px-3 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">{label}</div>
      <div className="num text-[15px] font-semibold leading-tight">{value}</div>
      <div className="text-[10px] text-[hsl(var(--muted-foreground))]">{detail}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">{label}</span>
      <div className="leading-snug">{children}</div>
    </div>
  );
}

function BlockedWeek({ icon, title, dates, why, hue }: { icon: React.ReactNode; title: string; dates: string; why: string; hue: string }) {
  return (
    <div className="card p-4" style={{ borderColor: `hsl(${hue} / 0.4)` }}>
      <div className="flex items-center gap-1.5 mb-1" style={{ color: `hsl(${hue})` }}>
        {icon}<span className="text-[12.5px] font-semibold">{title}</span>
      </div>
      <div className="num text-[12px] font-medium mb-1">{dates}</div>
      <p className="text-[11.5px] text-[hsl(var(--muted-foreground))] leading-relaxed">{why}</p>
    </div>
  );
}
