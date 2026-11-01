import { CalendarClock, Loader2, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Results } from "@/components/results";
import { ExclusionsCard, GoldPassCard, InventoryCard, SettingsCard, VillageCard } from "@/components/setup";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePlanner } from "@/providers/planner-provider";
import "./index.css";

function useDarkMode() {
  const [dark, setDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  return [dark, setDark] as const;
}

export function App() {
  const { meta, settings, village, plan, isPlanning, error } = usePlanner();
  const [dark, setDark] = useDarkMode();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <CalendarClock className="size-5" />
          <h1 className="font-semibold">Hammer Jam Planner</h1>
          <div className="ml-auto">
            <Button variant="ghost" size="icon" aria-label="Toggle dark mode" onClick={() => setDark(!dark)}>
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 p-4 lg:grid-cols-[380px_1fr] lg:p-6">
        <aside className="space-y-4">
          {meta && settings ? (
            <>
              <VillageCard />
              <InventoryCard />
              <ExclusionsCard />
              <GoldPassCard />
              <SettingsCard />
            </>
          ) : (
            !error && <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
          )}
        </aside>

        <section className="min-w-0 space-y-4">
          {isPlanning && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" />
              Updating plan…
            </div>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Something went wrong</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {plan ? (
            <div className={cn("transition-opacity", isPlanning && "opacity-60")}>
              <Results plan={plan} />
            </div>
          ) : (
            <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-8 text-center">
              <CalendarClock className="size-8 text-muted-foreground" />
              <p className="font-medium">No plan yet</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                {village ? "Working out your plan…" : "Start by loading your village export on the left."}
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
