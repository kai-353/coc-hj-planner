import type { Meta } from "./api";

export interface Settings {
  /** Owned items and currencies. */
  inventory: Record<string, number>;
  /** Books/hammers the user unlocked (everything else in the default `neverUse` stays saved). */
  allowedItems: string[];
  excludeCategories: string[];
  excludeNames: string;
  awakeFrom: string;
  awakeTo: string;
  eventEnd: string;
  planFromNow: boolean;
  goblinGemsPerDay: number;
}

export const CURRENCIES = [
  { key: "gems", label: "Gems" },
  { key: "leagueMedals", label: "League Medals" },
  { key: "raidMedals", label: "Raid Medals" },
] as const;

export function defaultSettings(meta: Meta): Settings {
  return {
    inventory: {},
    allowedItems: [],
    excludeCategories: ["siege-machines", "supercharges"],
    excludeNames: "",
    awakeFrom: meta.defaults.awake.from,
    awakeTo: meta.defaults.awake.to,
    eventEnd: meta.defaults.event.end,
    planFromNow: false,
    goblinGemsPerDay: meta.defaults.goblinGemsPerDay ?? 40,
  };
}

export function toConfig(s: Settings, meta: Meta) {
  return {
    inventory: s.inventory,
    neverUse: meta.defaults.neverUse.filter((k) => !s.allowedItems.includes(k)),
    exclude: {
      categories: s.excludeCategories,
      names: s.excludeNames
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean),
    },
    awake: { from: s.awakeFrom, to: s.awakeTo },
    event: { ...meta.defaults.event, end: s.eventEnd },
    planStart: s.planFromNow ? new Date().toISOString() : undefined,
    goblinGemsPerDay: s.goblinGemsPerDay,
  };
}

// Browser storage is a convenience only; every access may throw (private mode, blocked storage).
const KEY = "hj-planner:v1";

export function loadStored(): { settings?: Partial<Settings>; village?: unknown } {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function store(value: { settings: Settings; village: unknown }) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export const CATEGORY_LABEL: Record<string, string> = {
  "town-hall": "Town Hall",
  defenses: "Defenses",
  traps: "Traps",
  resources: "Resource buildings",
  army: "Army buildings",
  other: "Other buildings",
  guardians: "Guardians",
  heroes: "Heroes",
  troops: "Troops",
  spells: "Spells",
  "siege-machines": "Siege machines",
  supercharges: "Supercharges (overclocks)",
};
