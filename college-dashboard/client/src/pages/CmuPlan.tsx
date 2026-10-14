import plan from "@/data/cmu_plan.json";
import { AlertTriangle, Bot, BrainCircuit, ExternalLink, GraduationCap, GitBranch, Info, Wrench } from "lucide-react";
import type { ReactNode } from "react";

function References({ ids }: { ids: string[] }) {
  return <span className="ml-1 inline-flex flex-wrap gap-1">
    {ids.map(id => {
      const source = plan.sources.find(item => item.id === id);
      return source ? <a key={id} href={source.url} target="_blank" rel="noreferrer" className="underline decoration-dotted text-[hsl(var(--muted-foreground))]" title={source.title}>[{id}]</a> : null;
    })}
  </span>;
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return <section className="space-y-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
    <h2 className="flex items-center gap-2 text-[13px] font-semibold text-[hsl(var(--foreground))]">{icon}{title}</h2>
    {children}
  </section>;
}

export default function CmuPlanPage() {
  return <div className="space-y-7">
    <header className="space-y-3">
      <h1 className="serif text-[22px] font-semibold leading-tight text-[hsl(var(--foreground))]">CMU: the primary Robotics BS pathway</h1>
      <p className="max-w-3xl text-[13px] leading-relaxed text-[hsl(var(--muted-foreground))]">{plan.degree} · {plan.minimum_units}-unit minimum. <References ids={["C1"]} /></p>
      <p className="max-w-3xl text-[12px] leading-relaxed text-[hsl(var(--muted-foreground))]">{plan.note}</p>
    </header>

    <Panel title="Apply to SCS, then declare Robotics" icon={<GitBranch className="h-4 w-4" />}>
      <p className="text-[12.5px] leading-relaxed">{plan.entry}</p>
      <p className="text-[12px] leading-relaxed text-[hsl(var(--muted-foreground))]">{plan.balance_summary}</p>
    </Panel>

    <Panel title="What the degree actually requires" icon={<GraduationCap className="h-4 w-4" />}>
      <div className="grid gap-3 lg:grid-cols-2">
        {plan.requirements.map(group => <article key={group.name} className="rounded-md border border-[hsl(var(--border))] p-3">
          <h3 className="text-[12px] font-semibold">{group.name}</h3>
          <p className="mt-1 text-[11.5px] leading-relaxed text-[hsl(var(--muted-foreground))]">{group.detail} <References ids={group.sources} /></p>
        </article>)}
      </div>
    </Panel>

    <Panel title="A topic progression, with room for AI electives" icon={<Bot className="h-4 w-4" />}>
      <ol className="space-y-3">
        {plan.progression.map((stage, index) => <li key={stage.title} className="border-l-2 border-[hsl(var(--primary)/0.4)] pl-3">
          <h3 className="text-[12px] font-semibold">{index + 1}. {stage.title}</h3>
          <p className="mt-1 text-[11.5px] leading-relaxed text-[hsl(var(--muted-foreground))]">{stage.detail} <References ids={stage.sources} /></p>
        </li>)}
      </ol>
    </Panel>

    <Panel title="Core courses and prepared elective choices" icon={<BrainCircuit className="h-4 w-4" />}>
      <div className="space-y-3">
        {plan.courses.map(course => <article key={course.code} className="rounded-md border border-[hsl(var(--border))] p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-1">
            <h3 className="text-[12px] font-semibold"><span className="font-mono">{course.code}</span> · {course.title}</h3>
            <span className="text-[10.5px] text-[hsl(var(--muted-foreground))]">{course.units} units · {course.role}</span>
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-[hsl(var(--muted-foreground))]">{course.preparation} <References ids={course.sources} /></p>
        </article>)}
      </div>
    </Panel>

    <Panel title="Constraints to resolve with an advisor" icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}>
      <div className="space-y-3">
        {plan.risks.map(risk => <article key={risk.risk}>
          <h3 className="text-[12px] font-semibold">{risk.risk}</h3>
          <p className="mt-1 text-[11.5px] leading-relaxed text-[hsl(var(--muted-foreground))]">{risk.detail} <References ids={risk.sources} /></p>
        </article>)}
      </div>
    </Panel>

    <Panel title="Alternatives are different primary-major choices" icon={<Wrench className="h-4 w-4" />}>
      {plan.alternatives.map(route => <article key={route.name}>
        <h3 className="text-[12px] font-semibold">{route.name}</h3>
        <p className="mt-1 text-[11.5px] leading-relaxed text-[hsl(var(--muted-foreground))]">{route.detail} <References ids={route.sources} /></p>
      </article>)}
    </Panel>

    <footer className="rounded-lg border border-[hsl(var(--border))] p-4">
      <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold"><Info className="h-4 w-4" /> Official sources · checked {plan.compiled}</h2>
      <ul className="space-y-1.5 text-[11px] leading-relaxed">
        {plan.sources.map(source => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline decoration-dotted">[{source.id}] {source.title}<ExternalLink className="h-3 w-3" /></a></li>)}
      </ul>
    </footer>
  </div>;
}
