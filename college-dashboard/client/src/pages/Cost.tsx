import { useMemo } from "react";
import { schools, School, fmtCost } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import { FitBadge, HideButton } from "@/components/SchoolBits";
import { PlaceContextStrip } from "@/components/PlaceContextStrip";
import { MIN_ROBOTICS_CURRICULUM } from "@/lib/focusPreset";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList, ScatterChart, Scatter, ZAxis, ReferenceLine, ReferenceArea,
} from "recharts";

/**
 * Direct label for the cost-efficient schools only.
 *
 * Robotics curriculum is an ordinal 1-5, so a third of the field stacks on the
 * y=5 and y=4 lines and a label on every point would be unreadable. The handful
 * on the efficient frontier are the ones the chart is actually about; the rest
 * are carried by the axis and the hover tooltip.
 */
function FrontierLabel(props: any) {
  const { x, y, index, rows } = props;
  const d = rows?.[index];
  if (!d?.efficient) return null;
  // A school at the top of the 1-5 domain has no room above it, and the label
  // was being clipped straight out of the plot area -- Michigan-Dearborn (5/5)
  // vanished entirely. Flip below the marker up there.
  const below = d.curriculum >= 4.5;
  // Flipping below fixed the clipping, but the label then sat on the marker: the
  // access bubble runs to roughly a 10px radius, so a 20px offset still collided.
  // 27px clears the largest bubble plus its ring.
  return (
    <text x={x} y={below ? y + 27 : y - 15} textAnchor="middle"
      style={{ fontSize: 10.5, fontWeight: 600, fill: "hsl(var(--foreground))", pointerEvents: "none" }}>
      {d.name}
    </text>
  );
}

const fitColor: Record<string, string> = {
  "TOP FIT": "hsl(145 55% 35%)",
  "STRONG FIT": "hsl(200 65% 40%)",
  "CONDITIONAL FIT": "hsl(30 80% 45%)",
  "LOWER FIT": "hsl(0 60% 45%)",
};

export default function CostPage() {
  const { hidden } = useHidden();
  const list = useMemo(() => schools.filter(s => !hidden.has(s.slug)), [hidden]);

  const costData = list
    .filter(s => s.cost_for_nc_resident != null)
    .map(s => ({
      name: s.short,
      cost: s.cost_for_nc_resident!,
      fit: s.fit_classification,
      color: fitColor[s.fit_classification] || "hsl(var(--muted))",
      inState: s.state === "NC" && s.is_public,
      slug: s.slug,
    }))
    .sort((a,b) => a.cost - b.cost);

  const median = (() => {
    const nums = costData.map(d => d.cost).sort((a,b)=>a-b);
    return nums.length ? nums[Math.floor(nums.length/2)] : null;
  })();
  const mean = costData.length ? Math.round(costData.reduce((s,d)=>s+d.cost,0) / costData.length) : null;
  const cheapest = costData[0];
  const priciest = costData[costData.length - 1];

  const valueData = list
    .filter(s => s.cost_for_nc_resident != null && s.axes.program_depth != null)
    .map(s => ({
      name: s.short,
      cost: s.cost_for_nc_resident!,
      depth: s.axes.program_depth!,
      research: s.axes.research_access ?? 3,
      outcomes: s.axes.outcomes ?? 3,
      fit: s.fit_classification,
      color: fitColor[s.fit_classification] || "hsl(var(--muted))",
    }));

  // Robotics strength against price. The existing value map plots AI curriculum
  // depth; robotics is scored separately and the two diverge sharply -- UIUC is
  // near the top on AI and near the bottom on robotics -- so a shortlist built
  // around robotics needs its own view of what the money buys.
  const roboticsValue = useMemo(() => {
    const rows = list
      .filter(s => s.cost_for_nc_resident != null && s.axes.robotics_curriculum != null)
      .map(s => ({
        name: s.short,
        slug: s.slug,
        cost: s.cost_for_nc_resident!,
        curriculum: s.axes.robotics_curriculum!,
        access: s.axes.robotics_access ?? 1,
        courses: s.robotics_curriculum_detail?.course_count_undergrad ?? null,
        credential: s.robotics_credential?.credential_type ?? null,
        fit: s.fit_classification,
        color: fitColor[s.fit_classification] || "hsl(var(--muted))",
      }));

    // Pareto frontier: a school is efficient when nothing else is both no more
    // expensive AND no weaker on robotics. This is the honest answer to "what
    // does the money actually buy" -- everything off the frontier is beaten
    // outright by something cheaper or stronger.
    const frontier = new Set(
      rows.filter(d => !rows.some(o =>
        o.slug !== d.slug &&
        o.cost <= d.cost &&
        o.curriculum >= d.curriculum &&
        (o.cost < d.cost || o.curriculum > d.curriculum)
      )).map(d => d.slug),
    );
    return { rows: rows.map(d => ({ ...d, efficient: frontier.has(d.slug) })), frontier };
  }, [list]);

  const frontierRows = roboticsValue.rows
    .filter(d => d.efficient)
    .sort((a, b) => a.cost - b.cost);

  return (
    <div className="space-y-4">
      <PlaceContextStrip />

      <div className="card p-4">
        <div className="serif text-[17px] font-semibold mb-1">Cost & value, from a North Carolina family's viewpoint</div>
        <div className="text-[12.5px] text-[hsl(var(--muted-foreground))] max-w-3xl leading-relaxed">
          Cost is <strong>total published cost of attendance</strong>: tuition + fees + housing + food. Public NC schools show in-state cost; other publics show out-of-state; privates show published sticker. This is the number <em>before</em> financial aid — most of the private schools here have generous aid, so the effective cost can be much lower.
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Cheapest option" value={fmtCost(cheapest?.cost)} sub={cheapest?.name} tone="pos"/>
        <Stat label="Priciest option" value={fmtCost(priciest?.cost)} sub={priciest?.name} tone="neg"/>
        <Stat label="Median COA" value={fmtCost(median)} sub={`across ${costData.length} schools`}/>
        <Stat label="Average COA" value={fmtCost(mean)} sub="unweighted mean"/>
      </div>

      {/* Cost bar chart */}
      <div className="card p-4">
        <div className="text-[13px] font-medium mb-1">Total cost of attendance, sorted low → high</div>
        <div className="text-[11px] text-[hsl(var(--muted-foreground))] mb-3">Bar color indicates fit tier. Green NC-in-state markers show where the resident tuition break applies.</div>
        <ResponsiveContainer width="100%" height={Math.max(320, costData.length * 30)}>
          <BarChart data={costData} layout="vertical" margin={{ top: 5, right: 60, left: 12, bottom: 5 }} barCategoryGap={4}>
            <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" horizontal={false}/>
            <XAxis type="number" tickFormatter={v => `$${Math.round(v/1000)}k`}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false}/>
            <YAxis type="category" dataKey="name" width={132} interval={0}
              tick={{ fill: "hsl(var(--foreground))", fontSize: 11 }} axisLine={false} tickLine={false}/>
            <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12, borderRadius: 6 }}
              formatter={(v: any, _n, p: any) => [
                `${fmtCost(v as number)}${p.payload.inState ? " (in-state NC)" : ""}`,
                "Cost of attendance"
              ]}/>
            <Bar dataKey="cost" radius={[0, 3, 3, 0]}>
              {costData.map((d, i) => <Cell key={i} fill={d.color}/>)}
              <LabelList dataKey="cost" position="right"
                formatter={(v:any) => `$${Math.round(v/1000)}k`}
                style={{ fontSize: 10.5, fill: "hsl(var(--muted-foreground))" }}/>
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap gap-3 text-[11px] text-[hsl(var(--muted-foreground))] pt-3">
          <span className="inline-flex items-center gap-1"><span className="dot" style={{background: fitColor["TOP FIT"]}}/> Top fit</span>
          <span className="inline-flex items-center gap-1"><span className="dot" style={{background: fitColor["STRONG FIT"]}}/> Strong fit</span>
          <span className="inline-flex items-center gap-1"><span className="dot" style={{background: fitColor["CONDITIONAL FIT"]}}/> Conditional fit</span>
        </div>
      </div>

      {/* Value scatter (bigger version than overview) */}
      <div className="card p-4">
        <div className="text-[13px] font-medium mb-1">Value map · sticker price vs. AI curriculum depth</div>
        <div className="text-[11px] text-[hsl(var(--muted-foreground))] mb-3">
          Up-and-to-the-left is more program for less money. Aid can dramatically move the horizontal axis; this shows the published starting point.
        </div>
        <ResponsiveContainer width="100%" height={380}>
          <ScatterChart margin={{ top: 20, right: 30, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))"/>
            <XAxis type="number" dataKey="cost" tickFormatter={v => `$${Math.round(v/1000)}k`}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false}
              label={{ value: "Cost of attendance (for a NC resident)", position: "bottom", offset: 5, style: { fontSize: 11, fill: "hsl(var(--muted-foreground))" }}}/>
            <YAxis type="number" dataKey="depth" domain={[1, 5]}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false}
              label={{ value: "AI curriculum depth (1-5)", angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "hsl(var(--muted-foreground))", textAnchor: "middle" }}}/>
            <ZAxis range={[100, 100]}/>
            <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12, borderRadius: 6 }}
              content={(props: any) => {
                if (!props.active || !props.payload?.length) return null;
                const p = props.payload[0].payload;
                return (
                  <div className="p-2 rounded" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
                    <div className="serif font-semibold text-[13px]">{p.name}</div>
                    <div className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1 space-y-0.5">
                      <div>Cost: <span className="num font-medium text-[hsl(var(--foreground))]">{fmtCost(p.cost)}</span></div>
                      <div>AI depth: <span className="num font-medium text-[hsl(var(--foreground))]">{p.depth.toFixed(1)}/5</span></div>
                      <div>Research access: <span className="num font-medium text-[hsl(var(--foreground))]">{p.research.toFixed(1)}/5</span></div>
                      <div>Outcomes: <span className="num font-medium text-[hsl(var(--foreground))]">{p.outcomes.toFixed(1)}/5</span></div>
                      <div className="pt-1"><FitBadge fit={p.fit}/></div>
                    </div>
                  </div>
                );
              }}/>
            <Scatter data={valueData}>
              {valueData.map((d, i) => <Cell key={i} fill={d.color}/>)}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Robotics depth vs cost */}
      <div className="card p-4">
        <div className="text-[13px] font-medium mb-1">Robotics depth vs. cost</div>
        <div className="text-[11px] text-[hsl(var(--muted-foreground))] mb-3 max-w-3xl leading-relaxed">
          The value map above plots <em>AI</em> curriculum depth. Robotics is scored separately and the two
          pull apart — a school can be near the top on AI and near the bottom on robotics — so this plots
          what the money buys on the robotics side specifically. Vertical axis is researched robotics
          curriculum; <strong>bubble size is robotics access</strong> (labs, teams and undergraduate
          research you can actually get into). Below the dashed line a school has fewer than
          {" "}{MIN_ROBOTICS_CURRICULUM}/5 robotics coursework, the bar the balanced shortlist uses before it
          will auto-pick a school.
        </div>
        <ResponsiveContainer width="100%" height={400}>
          <ScatterChart margin={{ top: 20, right: 30, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))"/>
            <ReferenceArea y1={1} y2={MIN_ROBOTICS_CURRICULUM} fill="hsl(var(--muted-foreground))" fillOpacity={0.07} />
            <ReferenceLine y={MIN_ROBOTICS_CURRICULUM} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4"
              label={{ value: `robotics bar ${MIN_ROBOTICS_CURRICULUM}/5`, position: "insideTopRight",
                style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" } }}/>
            <XAxis type="number" dataKey="cost" tickFormatter={v => `$${Math.round(v/1000)}k`}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false}
              label={{ value: "Cost of attendance (for a NC resident)", position: "bottom", offset: 5, style: { fontSize: 11, fill: "hsl(var(--muted-foreground))" }}}/>
            <YAxis type="number" dataKey="curriculum" domain={[1, 5]} ticks={[1,2,3,4,5]}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false}
              label={{ value: "Robotics curriculum (1-5)", angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "hsl(var(--muted-foreground))", textAnchor: "middle" }}}/>
            <ZAxis type="number" dataKey="access" domain={[1, 5]} range={[60, 300]} name="Robotics access"/>
            <Tooltip
              content={(props: any) => {
                if (!props.active || !props.payload?.length) return null;
                const p = props.payload[0].payload;
                return (
                  <div className="p-2 rounded" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
                    <div className="serif font-semibold text-[13px]">
                      {p.name}{p.efficient && <span className="ml-1.5 chip chip-outline text-[9.5px] py-0" style={{ color: "hsl(var(--fit-top))" }}>best value</span>}
                    </div>
                    <div className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1 space-y-0.5">
                      <div>Cost: <span className="num font-medium text-[hsl(var(--foreground))]">{fmtCost(p.cost)}</span></div>
                      <div>Robotics curriculum: <span className="num font-medium text-[hsl(var(--foreground))]">{p.curriculum.toFixed(1)}/5</span></div>
                      <div>Robotics access: <span className="num font-medium text-[hsl(var(--foreground))]">{p.access.toFixed(1)}/5</span></div>
                      {p.courses != null && <div>Undergraduate robotics courses: <span className="num font-medium text-[hsl(var(--foreground))]">{p.courses}</span></div>}
                      <div>Credential: <span className="font-medium text-[hsl(var(--foreground))]">{p.credential ? String(p.credential).replace(/_/g, " ") : "none"}</span></div>
                      <div className="pt-1"><FitBadge fit={p.fit}/></div>
                    </div>
                  </div>
                );
              }}/>
            <Scatter data={roboticsValue.rows}>
              {/* A 2px ring in the surface colour separates markers that overlap --
                  and at four distinct y values, most of them do. The efficient
                  schools take a green ring instead of the surface one. */}
              {roboticsValue.rows.map((d, i) => (
                <Cell key={i} fill={d.color}
                  stroke={d.efficient ? "hsl(var(--fit-top))" : "hsl(var(--card))"}
                  strokeWidth={2}/>
              ))}
              <LabelList dataKey="name" content={(p: any) => <FrontierLabel {...p} rows={roboticsValue.rows}/>}/>
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap gap-3 text-[11px] text-[hsl(var(--muted-foreground))] pt-2">
          <span className="inline-flex items-center gap-1"><span className="dot" style={{background: fitColor["TOP FIT"]}}/> Top fit</span>
          <span className="inline-flex items-center gap-1"><span className="dot" style={{background: fitColor["STRONG FIT"]}}/> Strong fit</span>
          <span className="inline-flex items-center gap-1"><span className="dot" style={{background: fitColor["CONDITIONAL FIT"]}}/> Conditional fit</span>
          <span className="inline-flex items-center gap-1"><span className="dot" style={{background: fitColor["LOWER FIT"]}}/> Lower fit</span>
          <span className="inline-flex items-center gap-1">
            <span className="dot" style={{ background: "transparent", boxShadow: "inset 0 0 0 2px hsl(var(--fit-top))" }}/> Best value (named)
          </span>
        </div>
        <div className="text-[11.5px] text-[hsl(var(--muted-foreground))] pt-3 leading-relaxed border-t border-[hsl(var(--border))] mt-2">
          <strong className="text-[hsl(var(--foreground))]">Best value ({frontierRows.length} ringed and named):</strong>{" "}
          {frontierRows.map(d => `${d.name} (${fmtCost(d.cost)}, robotics ${d.curriculum.toFixed(0)}/5)`).join(" · ")}.
          {" "}Nothing on this list is both cheaper and stronger on robotics than these — every other school is
          beaten outright on one axis or the other. Read UNC-Chapel Hill with care: it is the cheapest point on
          the axis, but it has no electrical or computer engineering department and no ABET-accredited
          engineering degree, so what robotics coursework exists sits inside other departments.
          That is a statement about published sticker price only:
          aid moves the horizontal axis a long way at the private schools, so re-read this after net-price
          figures rather than before.
        </div>
      </div>

      {/* Detail table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="dense w-full">
            <thead>
              <tr>
                <th>School</th>
                <th>Fit</th>
                <th className="text-right">In-state</th>
                <th className="text-right">Out-of-state / private</th>
                <th className="text-right">Cost for NC resident</th>
                <th>Housing guarantee</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {list.sort((a,b) => (a.cost_for_nc_resident ?? 0) - (b.cost_for_nc_resident ?? 0)).map(s => (
                <tr key={s.slug}>
                  <td className="serif font-medium">{s.short}<div className="text-[10px] text-[hsl(var(--muted-foreground))]">{s.city_state}</div></td>
                  <td><FitBadge fit={s.fit_classification}/></td>
                  <td className="num text-right">{fmtCost(s.cost_total_instate)}</td>
                  <td className="num text-right">{fmtCost(s.cost_total_outofstate)}</td>
                  <td className="num text-right font-medium">{fmtCost(s.cost_for_nc_resident)}</td>
                  <td className="text-[11.5px] max-w-[220px]">{s.housing_guarantee}</td>
                  <td><HideButton slug={s.slug} compact/></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pos"|"neg" }) {
  const c = tone === "pos" ? "hsl(var(--fit-top))" : tone === "neg" ? "hsl(var(--fit-lower))" : undefined;
  return (
    <div className="card p-4">
      <div className="text-[11px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">{label}</div>
      <div className="serif text-[26px] leading-tight font-semibold num mt-1" style={c ? { color: c } : undefined}>{value}</div>
      {sub && <div className="text-[11px] text-[hsl(var(--muted-foreground))] truncate">{sub}</div>}
    </div>
  );
}
