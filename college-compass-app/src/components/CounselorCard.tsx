/**
 * One counselor listing. Used by the directory screen in the app and, unchanged, by the counselor
 * portal's live preview so counselors see exactly what families see.
 *
 * Contact actions are plain links: `tel:` and `mailto:` are handed to the OS, the website opens in
 * the system browser (target=_blank). Every value has already been sanitized in data/counselors.ts.
 */
import { useState } from "react";
import type { Counselor } from "@/data/counselors";
import { NATIONWIDE, hostOf, initials, specialtyLabel, telHref } from "@/data/counselors";
import { stateName } from "@/state/catalog";
import { IconChat, IconExternal, IconPhone, IconWarning } from "./icons";

export function CounselorCard({ counselor: c, onReport, preview }: { counselor: Counselor; onReport?: (c: Counselor) => void; /** Portal preview: show the card as the app does, with contact links inert. */ preview?: boolean }) {
  const [more, setMore] = useState(false);
  const virtual = c.modes.includes("virtual");
  const nationwide = c.states.includes(NATIONWIDE);
  const where = c.city ? c.city : virtual ? "Virtual" : null;
  const serves = nationwide ? "Students anywhere (virtual)" : c.states.length ? c.states.map(stateName).join(", ") : null;
  const longBio = (c.bio?.length ?? 0) > 180;
  const linkProps = preview ? { onClick: (e: React.MouseEvent) => e.preventDefault(), "aria-disabled": true as const } : {};

  return (
    <article className="cc-card p-4" aria-label={c.name}>
      <div className="flex items-start gap-3">
        {c.photo_url ? (
          <img src={c.photo_url} alt="" className="h-14 w-14 shrink-0 rounded-full bg-surface-2 object-cover" loading="lazy" />
        ) : (
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-accent-soft text-title3 text-accent" aria-hidden>
            {initials(c.name)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-headline break-words">{c.name}</h3>
            <span className="cc-pill shrink-0 bg-surface-2 text-text-muted" title="This counselor pays to be listed. Listings never affect your college list.">
              Paid listing
            </span>
          </div>
          {(c.title || where) && (
            <p className="mt-0.5 text-subhead text-text-muted">
              {[c.title, where].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      </div>

      {c.specialties.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Specialties">
          {c.specialties.map((s) => (
            <li key={s} className="cc-pill bg-accent-soft text-accent">
              {specialtyLabel(s)}
            </li>
          ))}
        </ul>
      )}

      <dl className="mt-3 space-y-1 text-footnote text-text-muted">
        {c.credentials && (
          <div className="flex gap-1.5">
            <dt className="shrink-0 font-medium">Credentials</dt>
            <dd className="min-w-0 break-words">{c.credentials}</dd>
          </div>
        )}
        {serves && (
          <div className="flex gap-1.5">
            <dt className="shrink-0 font-medium">Serves</dt>
            <dd className="min-w-0 break-words">{serves}{!nationwide && virtual && c.modes.includes("in_person") ? " · virtual or in person" : !nationwide && virtual ? " · virtual" : ""}</dd>
          </div>
        )}
      </dl>

      {c.bio && (
        <div className="mt-3">
          <p className={`whitespace-pre-line text-subhead ${more ? "" : "line-clamp-3"}`}>{c.bio}</p>
          {longBio && (
            <button type="button" className="cc-link mt-1 min-h-tap text-subhead" aria-expanded={more} onClick={() => setMore((v) => !v)}>
              {more ? "Show less" : "Read more"}
            </button>
          )}
        </div>
      )}

      {(c.website || c.phone || c.email) && (
        <div className="mt-4 flex flex-wrap gap-2 [&>a]:flex-1 [&>a]:whitespace-nowrap">
          {c.website && (
            <a className="cc-btn cc-btn-secondary cc-btn-sm cc-press" href={c.website} target="_blank" rel="noopener noreferrer" title={hostOf(c.website)} {...linkProps}>
              <IconExternal size={16} />
              Visit website
            </a>
          )}
          {c.phone && (
            <a className="cc-btn cc-btn-secondary cc-btn-sm cc-press" href={telHref(c.phone)} {...linkProps}>
              <IconPhone size={16} />
              Call
            </a>
          )}
          {c.email && (
            <a className="cc-btn cc-btn-secondary cc-btn-sm cc-press" href={`mailto:${c.email}`} {...linkProps}>
              <IconChat size={16} />
              Email
            </a>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3 text-caption text-text-muted">
        <span>Contact happens outside the app. Tierwise never shares your answers.</span>
        <button type="button" className="inline-flex min-h-tap shrink-0 items-center gap-1 text-caption font-medium text-text-muted" onClick={() => onReport?.(c)} disabled={preview || !onReport} aria-label={`Report ${c.name}`}>
          <IconWarning size={14} />
          Report
        </button>
      </div>
    </article>
  );
}
