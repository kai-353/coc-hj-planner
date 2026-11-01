import { CalendarClock, Loader2, Moon, Sun } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Results } from "@/components/results";
import { ExclusionsCard, InventoryCard, SettingsCard, VillageCard } from "@/components/setup";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createPlan, getMeta, type Meta, type PlanView, summarizeVillage, type VillageSummary } from "@/lib/api";
import { defaultSettings, loadStored, type Settings, store, toConfig } from "@/lib/settings";
import "./index.css";

function useDarkMode() {
  const [dark, setDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  return [dark, setDark] as const;
}

export function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [village, setVillage] = useState<unknown>(null);
  const [summary, setSummary] = useState<VillageSummary | null>(null);
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dark, setDark] = useDarkMode();

  useEffect(() => {
    getMeta()
      .then((m) => {
        const stored = loadStored();
        setMeta(m);
        setSettings({ ...defaultSettings(m), ...stored.settings });
        if (stored.village) loadVillage(stored.village);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (settings) store({ settings, village });
  }, [settings, village]);

  const loadVillage = useCallback(async (raw: unknown) => {
    try {
      setSummary(await summarizeVillage(raw));
      setVillage(raw);
      setPlan(null);
      setError(null);
    } catch (e) {
      setError(`Couldn't read that export: ${(e as Error).message}`);
    }
  }, []);

  const onFile = async (file: File) => {
    try {
      await loadVillage(JSON.parse(await file.text()));
    } catch {
      setError("That file isn't valid JSON.");
    }
  };

  // Re-plan whenever the inputs change: right away for toggles, after a pause for typed fields.
  // Only the latest request may update the screen.
  const delay = useRef(0);
  const latest = useRef(0);
  useEffect(() => {
    if (!meta || !settings || !village) return;
    const id = ++latest.current;
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const next = await createPlan(village, toConfig(settings, meta));
        if (id === latest.current) {
          setPlan(next);
          setError(null);
        }
      } catch (e) {
        if (id === latest.current) setError((e as Error).message);
      } finally {
        if (id === latest.current) setBusy(false);
      }
    }, delay.current);
    delay.current = 0;
    return () => clearTimeout(timer);
  }, [meta, settings, village]);

  const update = (patch: Partial<Settings>, opts?: { debounce?: boolean }) => {
    delay.current = opts?.debounce ? 700 : 0;
    setSettings((s) => (s ? { ...s, ...patch } : s));
  };

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
              <VillageCard summary={summary} onFile={onFile} />
              <InventoryCard meta={meta} settings={settings} update={update} />
              <ExclusionsCard meta={meta} summary={summary} settings={settings} update={update} />
              <SettingsCard settings={settings} update={update} />
            </>
          ) : (
            !error && <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
          )}
        </aside>

        <section className="min-w-0 space-y-4">
          {busy && (
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
            <div className={cn("transition-opacity", busy && "opacity-60")}>
              <Results plan={plan} />
            </div>
          ) : (
            <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-8 text-center">
              <CalendarClock className="size-8 text-muted-foreground" />
              <p className="font-medium">No plan yet</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                {village
                  ? "Working out your plan…"
                  : "Start by loading your village export on the left."}
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
