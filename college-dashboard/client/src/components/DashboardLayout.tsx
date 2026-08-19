import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  Layers, Sparkles, AlertTriangle, GraduationCap, Users, DollarSign,
  Columns3, CalendarClock, Award, EyeOff, NotebookPen, TrendingUp,
  Coins, ClipboardCheck, MessageCircle, ListOrdered, Bot,
  Target, Grid3x3, GitBranch, Cloud, MapPin
} from "lucide-react";
import { useHidden } from "@/lib/hidden";
import { useNotes, hasContent } from "@/lib/notes";
import { schools } from "@/lib/data";

const nav: { section: string; items: { path: string; label: string; icon: any; hint: string }[] }[] = [
  {
    section: "Start here",
    items: [
      { path: "/",           label: "Overview",              icon: Layers,        hint: "All schools at a glance" },
      { path: "/shortlist",  label: "Shortlist tiers",       icon: Award,         hint: "Grouped by fit tier" },
    ],
  },
  {
    section: "Choose or rule out",
    items: [
      { path: "/why",        label: "Why to choose",         icon: Sparkles,      hint: "What each school does uniquely well" },
      { path: "/drawbacks",  label: "Biggest drawback",      icon: AlertTriangle, hint: "The single reason to walk away" },
    ],
  },
  {
    section: "Dig into detail",
    items: [
      { path: "/curriculum", label: "Curriculum & access",   icon: GraduationCap, hint: "AI courses, gates, research" },
      { path: "/robotics",   label: "Robotics paths",         icon: Bot,           hint: "CS-AI vs ME vs BS Robotics" },
      { path: "/culture",    label: "Culture & campus",      icon: Users,         hint: "Greek life, ambition, rec" },
      { path: "/cost",       label: "Cost & value",          icon: DollarSign,    hint: "What it costs a NC family" },
      { path: "/scholarships", label: "Scholarships & merit", icon: Coins,        hint: "Merit awards, named scholarships" },
      { path: "/outcomes",   label: "Aid, outcomes & careers", icon: TrendingUp,   hint: "Net price, grad rates, CS careers" },
      { path: "/culture-signals", label: "Culture signals",  icon: MessageCircle, hint: "Reddit sentiment · anecdotal" },
      { path: "/compare",    label: "Side-by-side compare",  icon: Columns3,      hint: "Pick 2-4 and diff them" },
      { path: "/timeline",   label: "Application timeline",  icon: CalendarClock, hint: "ED / EA / RD deadlines" },
      { path: "/visits",     label: "Campus visits",         icon: MapPin,        hint: "Trip plan to the deadline" },
      { path: "/checklist",  label: "Application checklist", icon: ClipboardCheck, hint: "Essays, recs, fees per school" },
    ],
  },
  {
    section: "Odds & strategy",
    items: [
      { path: "/odds",       label: "Applicant odds",        icon: Target,        hint: "Client-side likely/target/reach classifier" },
      { path: "/strategy",   label: "Strategy map",          icon: Grid3x3,       hint: "CDS C7 effort heatmap + interest tracker" },
      { path: "/sequencing", label: "Sequencing & FRC",      icon: GitBranch,     hint: "Decision dependencies + FRC season overlay" },
    ],
  },
  {
    section: "My take",
    items: [
      { path: "/ranking",    label: "My ranking",            icon: ListOrdered,   hint: "Drag-order the schools" },
      { path: "/notebook",   label: "My notebook",           icon: NotebookPen,   hint: "All my notes in one place" },
      { path: "/sync",       label: "Cloud sync",            icon: Cloud,         hint: "Sign in + counselor sharing (Supabase)" },
    ],
  },
  {
    section: "Manage",
    items: [
      { path: "/hidden",     label: "Hidden schools",        icon: EyeOff,        hint: "Exclude schools from every view" },
    ],
  },
];

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <svg aria-label="College Compass logo" viewBox="0 0 32 32" width="28" height="28" fill="none">
        <rect x="3" y="5" width="26" height="22" rx="3" fill="hsl(var(--sidebar-primary))" />
        <path d="M7.5 20 L11.5 13 L16 20 L20.5 11 L25 20"
          stroke="hsl(var(--sidebar-foreground))" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold text-[hsl(var(--sidebar-foreground))]">College Compass</div>
        <div className="text-[11px] text-[hsl(var(--sidebar-foreground)/0.55)]">Undergraduate AI programs</div>
      </div>
    </div>
  );
}

export function DashboardLayout({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const { hidden, visible, clear } = useHidden();
  const { notes } = useNotes();
  const noteCount = Object.values(notes).filter(hasContent).length;
  const allNav = nav.flatMap(g => g.items);
  // Match exact path first, then longest-prefix match so /culture-signals doesn't get stolen by /culture.
  const exact = allNav.find(n => n.path === loc);
  const prefix = exact ? null : allNav
    .filter(n => n.path !== "/" && loc.startsWith(n.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
  const active = exact || prefix;

  return (
    <div className="grid-dashboard">
      <aside className="grid-sidebar bg-[hsl(var(--sidebar))] text-[hsl(var(--sidebar-foreground))] border-r border-[hsl(var(--sidebar-border))] py-5 px-4 flex flex-col">
        <div className="px-1 pb-5"><Logo /></div>

        {nav.map(group => (
          <div key={group.section} className="mb-3">
            <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--sidebar-foreground)/0.5)] px-1 pb-1.5">
              {group.section}
            </div>
            <div className="flex flex-col gap-0.5">
              {group.items.map(({ path, label, icon: Icon, hint }) => {
                const isActive = active?.path === path;
                return (
                  <Link key={path} href={path} className={`side-item ${isActive ? "active" : ""}`}>
                    <Icon size={14} strokeWidth={1.8} />
                    <div className="flex-1 min-w-0">
                      <div>{label}</div>
                      <div className="text-[10px] text-[hsl(var(--sidebar-foreground)/0.5)] leading-tight truncate">
                        {hint}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}

        <div className="mt-auto pt-4 border-t border-[hsl(var(--sidebar-border))]">
          <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--sidebar-foreground)/0.5)] px-1 pb-1.5">Selection</div>
          <div className="text-[13px] px-1 leading-relaxed">
            <div>
              <span className="num font-semibold text-[hsl(var(--sidebar-foreground))]">{visible.length}</span>
              <span className="text-[hsl(var(--sidebar-foreground)/0.55)]"> of {schools.length} visible</span>
            </div>
            {hidden.size > 0 && (
              <button onClick={clear} className="text-[11px] text-[hsl(var(--accent))] hover:underline mt-1">
                Restore all {hidden.size} hidden
              </button>
            )}
          </div>
          {noteCount > 0 && (
            <div className="mt-2 px-1 text-[12px] text-[hsl(var(--sidebar-foreground)/0.75)]">
              <span className="num font-semibold text-[hsl(var(--sidebar-foreground))]">{noteCount}</span> note{noteCount>1?"s":""} saved
            </div>
          )}
          <div className="text-[9.5px] text-[hsl(var(--sidebar-foreground)/0.4)] mt-3 px-1 leading-relaxed">
            Fall 2027 entry · Data through Aug 2026
          </div>
        </div>
      </aside>

      <header className="grid-header bg-[hsl(var(--background))] border-b border-[hsl(var(--border))]">
        <div className="px-6 py-4 flex items-baseline justify-between">
          <div>
            <div className="text-[11px] tracking-wider uppercase text-[hsl(var(--muted-foreground))]">
              For a Fall 2027 college applicant · Broad AI focus
            </div>
            <h1 className="serif text-[24px] font-semibold leading-tight">{active?.label || "Overview"}</h1>
          </div>
          <div className="text-right text-[11px] text-[hsl(var(--muted-foreground))]">
            No admissions-chance data used. Fit is about the program and the place.
          </div>
        </div>
      </header>

      <main className="grid-main px-6 py-6">{children}</main>
    </div>
  );
}
