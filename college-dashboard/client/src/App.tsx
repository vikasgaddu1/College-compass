import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { DashboardLayout } from "@/components/DashboardLayout";
import OverviewPage from "@/pages/Overview";
import WhyChoosePage from "@/pages/WhyChoose";
import DrawbacksPage from "@/pages/Drawbacks";
import CurriculumPage from "@/pages/Curriculum";
import CulturePage from "@/pages/CultureFit";
import CostPage from "@/pages/Cost";
import OutcomesPage from "@/pages/Outcomes";
import ComparePage from "@/pages/Compare";
import TimelinePage from "@/pages/Timeline";
import ShortlistPage from "@/pages/Shortlist";
import HiddenPage from "@/pages/Hidden";
import NotebookPage from "@/pages/Notebook";
import ScholarshipsPage from "@/pages/Scholarships";
import ChecklistPage from "@/pages/Checklist";
import CultureSignalsPage from "@/pages/CultureSignals";
import MyRankingPage from "@/pages/MyRanking";
import RoboticsPathsPage from "@/pages/RoboticsPaths";
import VisitsPage from "@/pages/Visits";
import OddsPage from "@/pages/Odds";
import StrategyPage from "@/pages/Strategy";
import SequencingPage from "@/pages/Sequencing";
import SyncPage from "@/pages/Sync";
import { HiddenSchoolsProvider } from "@/lib/hidden";
import { NotesProvider } from "@/lib/notes";
import { WeightsProvider } from "@/lib/weights";
import { RanksProvider } from "@/lib/ranks";
import { NoteDrawer } from "@/components/NoteDrawer";

function AppRouter() {
  return (
    <DashboardLayout>
      <Switch>
        <Route path="/" component={OverviewPage} />
        <Route path="/why" component={WhyChoosePage} />
        <Route path="/drawbacks" component={DrawbacksPage} />
        <Route path="/shortlist" component={ShortlistPage} />
        <Route path="/curriculum" component={CurriculumPage} />
        <Route path="/culture" component={CulturePage} />
        <Route path="/cost" component={CostPage} />
        <Route path="/outcomes" component={OutcomesPage} />
        <Route path="/scholarships" component={ScholarshipsPage} />
        <Route path="/culture-signals" component={CultureSignalsPage} />
        <Route path="/compare" component={ComparePage} />
        <Route path="/timeline" component={TimelinePage} />
        <Route path="/checklist" component={ChecklistPage} />
        <Route path="/robotics" component={RoboticsPathsPage} />
        <Route path="/visits" component={VisitsPage} />
        <Route path="/odds" component={OddsPage} />
        <Route path="/strategy" component={StrategyPage} />
        <Route path="/sequencing" component={SequencingPage} />
        <Route path="/sync" component={SyncPage} />
        <Route path="/ranking" component={MyRankingPage} />
        <Route path="/notebook" component={NotebookPage} />
        <Route path="/hidden" component={HiddenPage} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <HiddenSchoolsProvider>
          <NotesProvider>
            <WeightsProvider>
              <RanksProvider>
                <Toaster />
                <Router hook={useHashLocation}>
                  <AppRouter />
                </Router>
                <NoteDrawer />
              </RanksProvider>
            </WeightsProvider>
          </NotesProvider>
        </HiddenSchoolsProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
