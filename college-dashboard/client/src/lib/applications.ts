import applicationsData from "@/data/applications.json";

export type AppPlan = "ED" | "EA" | "RD" | "PENDING";
export interface Application {
  slug: string;
  plan: AppPlan;
  plan_short?: string;
  plan_label: string;
  round: string;
  deadline: string | null;
  deadline_label: string;
  binding: boolean;
  note: string | null;
}

export const applications: Application[] = applicationsData.applications as Application[];
export const applicationsBySlug: Record<string, Application> = Object.fromEntries(
  applications.map(a => [a.slug, a]),
);
export function getApplication(slug: string): Application | undefined {
  return applicationsBySlug[slug];
}
export function planClass(plan: AppPlan): string {
  return plan === "ED" ? "fit-lower" : plan === "EA" ? "fit-strong" : "chip-primary";
}
