import { Cloud } from "lucide-react";
import { SyncPanel } from "@/components/SyncPanel";

export default function SyncPage() {
  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="flex items-baseline gap-2 text-[hsl(var(--accent))]">
          <Cloud size={16}/>
          <div className="text-[11px] tracking-wider uppercase">Cloud sync</div>
        </div>
        <h2 className="serif text-[22px] font-semibold mt-1">Sign in to sync + share with a counselor</h2>
        <p className="text-[13px] text-[hsl(var(--muted-foreground))] mt-2 leading-relaxed max-w-[820px]">
          Sign in with a magic link to sync your school notes across devices and invite a counselor as a viewer or editor. You can also use the notebook signed out with notes saved in this browser when local storage is available. Your notes, ratings and sharing choices remain yours; syncing does not change the researched robotics recommendations.
        </p>
      </div>
      <SyncPanel/>
    </div>
  );
}
