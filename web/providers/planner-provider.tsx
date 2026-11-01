import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Meta, PlanView, VillageSummary } from "@/lib/api";
import { queryClient, useMeta, usePlan, useVillageSummary, villageQuery } from "@/lib/queries";
import { defaultSettings, loadStored, type Settings, store, toConfig } from "@/lib/settings";

/** How long typed input waits before the plan is recomputed. */
const TYPING_DELAY_MS = 700;

type Update = (patch: Partial<Settings>, opts?: { debounce?: boolean }) => void;

interface PlannerState {
  meta: Meta | undefined;
  settings: Settings | null;
  update: Update;
  village: unknown;
  summary: VillageSummary | undefined;
  loadFile: (file: File) => Promise<void>;
  plan: PlanView | undefined;
  isPlanning: boolean;
  error: string | null;
}

const PlannerContext = createContext<PlannerState | null>(null);

export function usePlanner() {
  const ctx = useContext(PlannerContext);
  if (!ctx) throw new Error("usePlanner must be used inside <PlannerProvider>");
  return ctx;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <PlannerProvider>{children}</PlannerProvider>
    </QueryClientProvider>
  );
}

function PlannerProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const meta = useMeta();
  const [stored] = useState(loadStored);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [village, setVillage] = useState<unknown>(stored.village ?? null);
  const [fileError, setFileError] = useState<string | null>(null);

  // Settings need the server defaults, so they start once meta has loaded.
  useEffect(() => {
    if (meta.data && !settings) setSettings({ ...defaultSettings(meta.data), ...stored.settings });
  }, [meta.data, settings, stored]);

  useEffect(() => {
    if (settings) store({ settings, village });
  }, [settings, village]);

  // The plan follows a debounced copy of the settings: toggles apply at once, typing after a pause.
  const delay = useRef(0);
  const [settled, setSettled] = useState<Settings | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(settings), delay.current);
    delay.current = 0;
    return () => clearTimeout(timer);
  }, [settings]);

  const update: Update = (patch, opts) => {
    delay.current = opts?.debounce ? TYPING_DELAY_MS : 0;
    setSettings((s) => (s ? { ...s, ...patch } : s));
  };

  // Built once per settled change (it may contain "now"), so the query key stays stable.
  const config = useMemo(() => (settled && meta.data ? toConfig(settled, meta.data) : null), [settled, meta.data]);

  const summary = useVillageSummary(village);
  const plan = usePlan(summary.isSuccess ? village : null, config);

  const loadFile = async (file: File) => {
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      setFileError("That file isn't valid JSON.");
      return;
    }
    try {
      await client.fetchQuery(villageQuery(raw));
      setVillage(raw);
      setFileError(null);
    } catch (e) {
      setFileError(`Couldn't read that export: ${(e as Error).message}`);
    }
  };

  const error =
    fileError ??
    meta.error?.message ??
    (summary.error ? `Couldn't read the saved export: ${summary.error.message}` : null) ??
    plan.error?.message ??
    null;

  return (
    <PlannerContext.Provider
      value={{
        meta: meta.data,
        settings,
        update,
        village,
        summary: summary.data,
        loadFile,
        plan: plan.data,
        isPlanning: plan.isFetching,
        error,
      }}
    >
      {children}
    </PlannerContext.Provider>
  );
}

/** For components that only render once meta and settings are loaded. */
export function useReadyPlanner() {
  const p = usePlanner();
  if (!p.meta || !p.settings) throw new Error("Planner settings aren't loaded yet");
  return { ...p, meta: p.meta, settings: p.settings };
}
