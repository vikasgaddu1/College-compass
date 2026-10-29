/**
 * The deadline proof check wired to the app's HTTP: in the iPhone app pages are fetched natively
 * (no CORS); on the web most college sites block cross-origin reads, which simply leaves the
 * deadline "unchecked". See ./verify.ts for the logic.
 */
import type { College } from "@/types";
import { httpFetch } from "@/platform";
import { needsDeadlineCheck, verifyCollegeDeadlines } from "./verify";

export { needsDeadlineCheck };

/** Check a college's deadlines against its own pages. Resolves to the college itself when there is nothing to check; never throws. */
export async function checkCollegeDeadlines(college: College, signal?: AbortSignal, now: Date = new Date()): Promise<College> {
  if (!needsDeadlineCheck(college, now)) return college;
  try {
    return await verifyCollegeDeadlines(college, { fetch: (url, init) => httpFetch(url, init), signal, now: () => now });
  } catch {
    return college;
  }
}

/**
 * Carry the check results of `checked` over to `current` (a possibly newer copy of the same college),
 * plan by plan, only where plan, deadline and page still agree — so a refresh that landed while the
 * check ran never gets a stale verdict.
 */
export function applyChecks(current: College, checked: College): College {
  const app = current.application;
  if (!app?.plans?.length || !checked.application?.plans?.length) return current;
  let changed = false;
  const plans = app.plans.map((p) => {
    const m = checked.application!.plans.find((q) => q.plan === p.plan && q.deadline === p.deadline && (q.source_url ?? null) === (p.source_url ?? null));
    if (!m?.check || m.check === p.check) return p;
    changed = true;
    return { ...p, check: m.check };
  });
  return changed ? { ...current, application: { ...app, plans } } : current;
}
