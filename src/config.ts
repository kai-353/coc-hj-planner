import { CATEGORIES } from "./catalog";
import type { GoldPass } from "./goldpass";

export const ITEM_KEYS = [
  "builderPotion",
  "researchPotion",
  "bookOfBuilding",
  "bookOfHeroes",
  "bookOfFighting",
  "bookOfSpells",
  "bookOfEverything",
  "hammerOfBuilding",
  "hammerOfHeroes",
  "hammerOfFighting",
  "hammerOfSpells",
] as const;
export type ItemKey = (typeof ITEM_KEYS)[number];

export type Currency = "gems" | "leagueMedals" | "raidMedals";

export interface ShopOffer {
  item: ItemKey;
  currency: Currency;
  price: number;
  /** Max purchases during the plan (omit for unlimited). */
  limit?: number;
  /** Max purchases per shop week (see `shopWeekReset`). */
  limitPerWeek?: number;
  /** Days between purchases (League Shop hammers: 7). */
  cooldownDays?: number;
}

export interface Config {
  village: string;
  timezone: string;
  awake: { from: string; to: string };
  event: { start: string; end: string; discount: number };
  /** ISO time to plan from; defaults to the export timestamp. */
  planStart?: string;
  builders?: number;
  inventory: Partial<Record<ItemKey | Currency, number>>;
  /** Items that must never be used or bought (e.g. books/hammers saved for a new Town Hall). */
  neverUse: ItemKey[];
  /** Gems per day of upgrade time for the Goblin Builder / Goblin Researcher; null disables them. */
  goblinGemsPerDay: number | null;
  /** Gold Pass builder/research boosts (unlocked by season points); null = no Gold Pass. */
  goldPass: GoldPass | null;
  exclude: { categories: string[]; names: string[] };
  /** How "expensive" each special item is to spend, in gem-equivalents. The planner minimises the total. */
  value: Partial<Record<ItemKey | Currency, number>>;
  shop: ShopOffer[];
  /** Any moment the weekly shop limits reset (the Trader refreshes Tuesdays 08:00 UTC). */
  shopWeekReset: string;
  helperCooldownHours: number;
}

export const DEFAULTS: Omit<Config, "village"> = {
  timezone: "Europe/Amsterdam",
  awake: { from: "09:00", to: "23:00" },
  // Hammer Jam 2026: 1 Nov – 16 Nov 08:00 GMT.
  event: { start: "2026-11-01T08:00:00Z", end: "2026-11-16T08:00:00Z", discount: 0.5 },
  inventory: {},
  neverUse: [
    "bookOfBuilding",
    "bookOfHeroes",
    "bookOfFighting",
    "bookOfSpells",
    "bookOfEverything",
    "hammerOfBuilding",
    "hammerOfHeroes",
    "hammerOfFighting",
    "hammerOfSpells",
  ],
  goblinGemsPerDay: 40,
  // The user's points on 1 Nov (110/day max incl. bonus). Tier thresholds are PLACEHOLDERS that
  // could not be confirmed; take them from the in-game Gold Pass screen.
  goldPass: {
    points: 440,
    pointsAsOf: "2026-11-01T18:33:00Z",
    pointsPerDay: 110,
    builder: [
      { points: 10, reduction: 0.1 },
      { points: 640, reduction: 0.15 },
      { points: 1060, reduction: 0.2 },
    ],
    research: [
      { points: 20, reduction: 0.1 },
      { points: 580, reduction: 0.15 },
      { points: 1000, reduction: 0.2 },
    ],
  },
  exclude: { categories: [], names: [] },
  value: {
    gems: 1,
    leagueMedals: 9.5,
    raidMedals: 0.6,
    builderPotion: 285,
    researchPotion: 120,
    bookOfBuilding: 925,
    bookOfFighting: 925,
    bookOfSpells: 925,
    bookOfHeroes: 500,
    bookOfEverything: 1500,
    hammerOfBuilding: 1140,
    hammerOfFighting: 1140,
    hammerOfSpells: 1140,
    hammerOfHeroes: 1570,
  },
  shop: [
    { item: "builderPotion", currency: "leagueMedals", price: 30 },
    { item: "researchPotion", currency: "leagueMedals", price: 20 },
    { item: "researchPotion", currency: "raidMedals", price: 200, limitPerWeek: 3 },
    { item: "hammerOfBuilding", currency: "leagueMedals", price: 120, cooldownDays: 7 },
    { item: "hammerOfFighting", currency: "leagueMedals", price: 120, cooldownDays: 7 },
    { item: "hammerOfSpells", currency: "leagueMedals", price: 120, cooldownDays: 7 },
    { item: "hammerOfHeroes", currency: "leagueMedals", price: 165, cooldownDays: 7 },
  ],
  shopWeekReset: "2026-11-03T08:00:00Z",
  helperCooldownHours: 23,
};

export async function loadConfig(path: string): Promise<Config> {
  return resolveConfig(await Bun.file(path).json());
}

/** Fills in defaults and validates a user config object. */
export function resolveConfig(user: any): Config {
  const cfg: Config = {
    ...DEFAULTS,
    ...user,
    awake: { ...DEFAULTS.awake, ...user.awake },
    event: { ...DEFAULTS.event, ...user.event },
    exclude: { ...DEFAULTS.exclude, ...user.exclude },
    value: { ...DEFAULTS.value, ...user.value },
    goldPass: user.goldPass === null ? null : { ...DEFAULTS.goldPass!, ...user.goldPass },
  };
  for (const c of cfg.exclude.categories)
    if (!(CATEGORIES as readonly string[]).includes(c))
      throw new Error(`Unknown category "${c}". Valid: ${CATEGORIES.join(", ")}`);
  for (const k of [...Object.keys(cfg.inventory), ...cfg.neverUse])
    if (![...ITEM_KEYS, "gems", "leagueMedals", "raidMedals"].includes(k))
      throw new Error(`Unknown item "${k}". Valid: ${ITEM_KEYS.join(", ")}, gems, leagueMedals, raidMedals`);
  return cfg;
}
