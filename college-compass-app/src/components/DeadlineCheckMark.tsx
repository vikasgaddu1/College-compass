/**
 * The small marker under a deadline that says whether the date was found on the college's own page:
 *   ✓ Checked on gatech.edu                              (link to the page)
 *   Couldn't find this date on gatech.edu — confirm      (amber; link to the page)
 *   Not checked — confirm on the college's site          (muted; link to the researcher's page, if any)
 * Nothing is ever shown as proven that wasn't. `link={false}` renders plain text for use inside a
 * button (the Deadlines rows), where the row's own external-link icon opens the page.
 */
import { checkText, type ProofFields } from "@/deadlines/verify";

const TONE = {
  verified: "text-good",
  mismatch: "text-warn",
  unchecked: "text-text-muted",
} as const;

export function DeadlineCheckMark({ plan, link = true, className = "" }: { plan: ProofFields & { deadline: string | null }; link?: boolean; className?: string }) {
  if (!plan.deadline) return null;
  const t = checkText(plan);
  const text = (
    <>
      {t.status === "verified" && <span aria-hidden>✓ </span>}
      {t.label}
    </>
  );
  const cls = `text-footnote ${TONE[t.status]} ${className}`.trim();
  if (link && t.url) {
    return (
      <a className={`${cls} underline underline-offset-2`} href={t.url} target="_blank" rel="noopener noreferrer" data-check={t.status}>
        {text}
      </a>
    );
  }
  return (
    <span className={cls} data-check={t.status}>
      {text}
    </span>
  );
}
