import { useState } from "react";
import { schools } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import placeData from "@/data/place_context.json";
import { Sun, Snowflake, Car, Plane, ChevronDown, ChevronRight, Cloud } from "lucide-react";

type Loc = typeof placeData.cities[keyof typeof placeData.cities];

/** Compact "getting there + being there" strip for the Cost tab.
 *  Winter/summer temp, snow, flight cost band from RDU, driving hours. */
export function PlaceContextStrip() {
  const { hidden } = useHidden();
  const [open, setOpen] = useState(false);
  const rows = schools
    .filter(s => !hidden.has(s.slug))
    .map(s => ({ s, d: (placeData.cities as any)[s.slug] as Loc | undefined }))
    .filter((x): x is { s: typeof schools[number]; d: Loc } => !!x.d);

  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full p-3 flex items-center justify-between hover:bg-[hsl(var(--elevate-1))]">
        <div className="flex items-center gap-2">
          <Cloud size={14} className="text-[hsl(var(--accent))]" />
          <div className="text-[13px] font-medium">Getting there + being there · weather, drive time, flight cost from RDU</div>
          <span className="text-[11px] text-[hsl(var(--muted-foreground))]">NOAA normals + Google Flights bands</span>
        </div>
        {open ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
      </button>
      {open && (
        <div className="border-t border-[hsl(var(--border))] overflow-x-auto">
          <table className="dense w-full">
            <thead>
              <tr>
                <th className="sticky left-0 z-[2] w-[160px]">School</th>
                <th className="min-w-[180px]">City · airport</th>
                <th className="text-right w-[80px]"><span className="inline-flex items-center gap-1"><Snowflake size={10}/>Jan low</span></th>
                <th className="text-right w-[80px]"><span className="inline-flex items-center gap-1"><Sun size={10}/>Jul high</span></th>
                <th className="text-right w-[100px]"><span className="inline-flex items-center gap-1"><Snowflake size={10}/>Snow/yr</span></th>
                <th className="text-right w-[120px]"><span className="inline-flex items-center gap-1"><Car size={10}/>Drive from RDU</span></th>
                <th className="min-w-[180px]"><span className="inline-flex items-center gap-1"><Plane size={10}/>Roundtrip flight</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ s, d }) => (
                <tr key={s.slug}>
                  <td className="sticky left-0 z-[1] bg-[hsl(var(--card))]">
                    <div className="serif font-medium text-[12.5px]">{s.short}</div>
                  </td>
                  <td className="text-[11.5px] leading-snug">
                    <div>{d.campus_city}</div>
                    <div className="text-[10.5px] text-[hsl(var(--muted-foreground))]">{d.nearest_airport}</div>
                  </td>
                  <td className="text-right num text-[12px]" style={{ color: d.temp_low_jan_f < 20 ? "hsl(210 60% 45%)" : undefined }}>{d.temp_low_jan_f}°F</td>
                  <td className="text-right num text-[12px]" style={{ color: d.temp_high_jul_f > 88 ? "hsl(20 65% 45%)" : undefined }}>{d.temp_high_jul_f}°F</td>
                  <td className="text-right num text-[12px]" style={{ color: d.snow_inches_annual >= 50 ? "hsl(210 60% 45%)" : undefined }}>{d.snow_inches_annual === 0 ? "—" : `${d.snow_inches_annual}"`}</td>
                  <td className="text-right num text-[12px]">
                    {d.drive_hours_from_rdu < 1 ? "in-town" : d.drive_hours_from_rdu <= 6 ? `${d.drive_hours_from_rdu}h drive` : `${d.drive_hours_from_rdu}h`}
                  </td>
                  <td className="text-[11.5px] num">{d.flight_from_rdu_band}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="p-3 text-[10.5px] text-[hsl(var(--muted-foreground))] border-t border-[hsl(var(--border))]">
            {placeData.note}
          </div>
        </div>
      )}
    </div>
  );
}
