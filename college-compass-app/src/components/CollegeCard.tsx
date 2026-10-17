import type { RankedCollege } from "@/types";
import { navigate } from "@/lib/router";
import { tierInfo } from "@/state/catalog";
import { fmt } from "@/state/store";
import { IconStar } from "./icons";
import { ConfidenceDot, OddsChip } from "./ui";

export function CollegeCard({ item, saved, onToggleSave, compact, pop, note }: { item: RankedCollege; saved: boolean; onToggleSave: () => void; compact?: boolean; pop?: boolean; note?: string }) {
  const { college: c, odds, fit } = item;
  const t = tierInfo(odds.tier);
  return (
    <article className={`cc-card ${pop ? "cc-pop" : ""}`} style={{ ["--rail" as string]: t.cssVar }}>
      <span className="cc-card-rail" aria-hidden />
      <div className="flex items-start gap-2 py-3 pl-4 pr-2">
        <button type="button" className="cc-press min-w-0 flex-1 text-left" onClick={() => navigate(`/college/${encodeURIComponent(c.id)}`)} aria-label={`${c.name}, ${t.label}, odds ${fmt.band(odds.low, odds.high)}`}>
          <div className="flex items-baseline gap-2">
            <h3 className="min-w-0 text-headline line-clamp-2">{c.name}</h3>
          </div>
          <p className="mt-0.5 truncate text-footnote text-text-muted">
            {c.city}, {c.state}
            {c.ownership === "public" ? " · Public" : " · Private"}
            {c.undergrad_size != null ? ` · ${fmt.num(c.undergrad_size)} undergrads` : ""}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <OddsChip low={odds.low} high={odds.high} tier={odds.tier} />
            <span className="tnum text-subhead">
              <span className="font-semibold">{Math.round(fit.total)}</span>
              <span className="text-text-muted"> fit</span>
            </span>
            <span className="tnum text-subhead">
              <span className="font-semibold">{item.est_net_price != null ? fmt.usd(item.est_net_price, { k: true }) : "—"}</span>
              <span className="text-text-muted">/yr est.</span>
            </span>
          </div>
          {!compact && item.reasons.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-footnote text-text-muted">
              {item.reasons.slice(0, 2).map((r) => (
                <li key={r} className="line-clamp-2">
                  {r}
                </li>
              ))}
            </ul>
          )}
          {note && <p className="mt-2 text-footnote italic text-text-muted">{note}</p>}
          <div className="mt-2 flex items-center gap-2">
            <ConfidenceDot level={c.data_confidence} withLabel />
            <span className="text-caption text-text-muted">· {c.data_year}</span>
          </div>
        </button>
        <button type="button" className={`cc-press -mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-full ${saved ? "text-warn" : "text-text-muted"}`} aria-pressed={saved} aria-label={saved ? "Remove from shortlist" : "Add to shortlist"} onClick={onToggleSave}>
          <IconStar size={24} filled={saved} />
        </button>
      </div>
    </article>
  );
}
