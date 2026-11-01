// Game data from the `clash-of-clans-data` package, indexed by the in-game data id
// (the same ids that appear in the village export).

import { dirname, join } from "node:path";
import { Glob } from "bun";
import { calculators } from "clash-of-clans-data";

export type Queue = "builder" | "lab" | "pet";
/** Which magic items apply: books/hammers are split by these classes. */
export type ItemClass = "building" | "hero" | "troop" | "spell" | "pet";

export const CATEGORIES = [
  "town-hall",
  "defenses",
  "crafted-defenses",
  "traps",
  "resources",
  "army",
  "other",
  "guardians",
  "heroes",
  "pets",
  "troops",
  "spells",
  "siege-machines",
  // Not a data category: matches every supercharge level regardless of building.
  "supercharges",
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface LevelInfo {
  level: number;
  supercharge: boolean;
  seconds: number;
  cost: number;
  resource: string;
  townHall: number;
  laboratory?: number;
  petHouse?: number;
  heroHall?: number;
}

export interface Entity {
  dataId: number;
  name: string;
  category: Category;
  queue: Queue;
  itemClass: ItemClass;
  levels: LevelInfo[];
  supercharges: LevelInfo[];
}

export const LABORATORY_ID = 1000007;
export const PET_HOUSE_ID = 1000068;
export const HERO_HALL_ID = 1000071;
export const WALL_ID = 1000010;
export const TOWN_HALL_ID = 1000001;
export const BUILDERS_HUT_ID = 1000015;
export const BOBS_HUT_ID = 1000064;
export const CRAFTING_STATION_ID = 1000097;

const DIRS: Record<string, Pick<Entity, "category" | "queue" | "itemClass">> = {
  "town-hall": { category: "town-hall", queue: "builder", itemClass: "building" },
  defenses: { category: "defenses", queue: "builder", itemClass: "building" },
  traps: { category: "traps", queue: "builder", itemClass: "building" },
  walls: { category: "defenses", queue: "builder", itemClass: "building" },
  "resource-buildings": { category: "resources", queue: "builder", itemClass: "building" },
  "army-buildings": { category: "army", queue: "builder", itemClass: "building" },
  other: { category: "other", queue: "builder", itemClass: "building" },
  guardians: { category: "guardians", queue: "builder", itemClass: "building" },
  heroes: { category: "heroes", queue: "builder", itemClass: "hero" },
  pets: { category: "pets", queue: "pet", itemClass: "pet" },
  troops: { category: "troops", queue: "lab", itemClass: "troop" },
  "siege-machines": { category: "siege-machines", queue: "lab", itemClass: "troop" },
  spells: { category: "spells", queue: "lab", itemClass: "spell" },
};

interface RawTime {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

const toSeconds = (t?: RawTime) => (t ? t.days * 86400 + t.hours * 3600 + t.minutes * 60 + t.seconds : 0);

function toLevel(l: any): LevelInfo {
  return {
    level: l.level,
    supercharge: !!l.supercharge,
    seconds: toSeconds(l.buildTime ?? l.upgradeTime ?? l.researchTime),
    cost: l.buildCost ?? l.upgradeCost ?? l.researchCost ?? 0,
    resource: l.buildCostResource ?? l.upgradeCostResource ?? l.researchCostResource ?? "",
    townHall: l.townHallRequired ?? 0,
    laboratory: l.laboratoryRequired || undefined,
    petHouse: l.petHouseLevelRequired || undefined,
    heroHall: l.heroHallLevelRequired || undefined,
  };
}

export class Catalog {
  readonly byId = new Map<number, Entity>();

  private constructor() {}

  static async load(): Promise<Catalog> {
    const cat = new Catalog();
    const dataDir = join(dirname(Bun.resolveSync("clash-of-clans-data", import.meta.dir)), "..", "data", "home");

    for await (const rel of new Glob("*/*.json").scan(dataDir)) {
      const dir = rel.split("/")[0]!;
      const raw = await Bun.file(join(dataDir, rel)).json();

      if (dir === "crafted-defenses") {
        for (const m of raw.modules ?? []) {
          cat.byId.set(m.dataId, {
            dataId: m.dataId,
            name: `${raw.name} ${m.name}`,
            category: "crafted-defenses",
            queue: "builder",
            itemClass: "building",
            levels: m.upgrades.map(toLevel),
            supercharges: [],
          });
        }
        continue;
      }

      const meta = DIRS[dir];
      if (!meta || raw.dataId == null || !raw.levels) continue;
      const levels = (raw.levels as any[]).map(toLevel);
      cat.byId.set(raw.dataId, {
        dataId: raw.dataId,
        name: raw.name,
        ...meta,
        levels: levels.filter((l) => !l.supercharge),
        supercharges: levels.filter((l) => l.supercharge),
      });
    }
    return cat;
  }

  get(dataId: number): Entity | undefined {
    return this.byId.get(dataId);
  }

  /** Highest normal level of a building that the given Town Hall allows. */
  maxLevelAt(dataId: number, townHall: number): number {
    const e = this.byId.get(dataId);
    if (!e) return 0;
    return Math.max(0, ...e.levels.filter((l) => l.townHall <= townHall).map((l) => l.level));
  }

  /** Levels of an entity that can be reached at this Town Hall (normal levels only). */
  reachableLevels(e: Entity, townHall: number): LevelInfo[] {
    const labMax = this.maxLevelAt(LABORATORY_ID, townHall);
    const petMax = this.maxLevelAt(PET_HOUSE_ID, townHall);
    const heroMax = this.maxLevelAt(HERO_HALL_ID, townHall);
    return e.levels.filter(
      (l) =>
        l.townHall <= townHall &&
        (l.laboratory ?? 0) <= labMax &&
        (l.petHouse ?? 0) <= petMax &&
        (l.heroHall ?? 0) <= heroMax,
    );
  }
}

const gems = calculators().gems();

/** Gems needed to instantly finish the given remaining time. */
export function gemCost(minutes: number): number {
  const m = Math.max(0, Math.ceil(minutes));
  return gems.cost({ days: Math.floor(m / 1440), hours: Math.floor((m % 1440) / 60), minutes: m % 60, seconds: 0 });
}
