// Parses the in-game village export (Settings → "Export village data" JSON).

import {
  BOBS_HUT_ID,
  BUILDERS_HUT_ID,
  CRAFTING_STATION_ID,
  type Catalog,
  type Entity,
  TOWN_HALL_ID,
  WALL_ID,
} from "./catalog";

export interface Instance {
  entity: Entity;
  label: string;
  level: number;
  supercharge: number;
  /** Seconds left on an in-progress upgrade at export time. */
  timer?: number;
  /** Upgrade runs on a temporary extra builder/researcher (e.g. a Goblin event worker). */
  extra: boolean;
}

export interface HelperState {
  level: number;
  cooldownSec: number;
}

export interface Village {
  tag: string;
  timestamp: number;
  townHall: number;
  builders: number;
  instances: Instance[];
  walls: { level: number; count: number }[];
  apprentice?: HelperState;
  labAssistant?: HelperState;
  unknownIds: number[];
  levelOf(dataId: number): number;
}

const SECTIONS = ["buildings", "traps", "heroes", "pets", "units", "spells", "siege_machines", "guardians"];
const APPRENTICE_ID = 93000000;
const LAB_ASSISTANT_ID = 93000001;

export function parseVillage(raw: any, catalog: Catalog): Village {
  const instances: Instance[] = [];
  const walls: { level: number; count: number }[] = [];
  const unknownIds = new Set<number>();
  const counters = new Map<number, number>();
  const levels = new Map<number, number>();
  let builderHuts = 0;
  let bobs = 0;

  const add = (entity: Entity, e: any) => {
    const n = (counters.get(entity.dataId) ?? 0) + 1;
    counters.set(entity.dataId, n);
    instances.push({
      entity,
      label: `${entity.name} #${n}`,
      level: e.lvl,
      supercharge: e.supercharge ?? 0,
      timer: e.timer,
      extra: !!e.extra,
    });
  };

  for (const section of SECTIONS) {
    for (const e of raw[section] ?? []) {
      if (e.data === CRAFTING_STATION_ID) {
        for (const type of e.types ?? [])
          for (const m of type.modules ?? []) {
            const ent = catalog.get(m.data);
            if (ent) add(ent, m);
            else unknownIds.add(m.data);
          }
        continue;
      }
      if (e.lvl == null) continue;
      const cnt = e.cnt ?? 1;
      levels.set(e.data, Math.max(levels.get(e.data) ?? 0, e.lvl));
      if (e.data === BUILDERS_HUT_ID) builderHuts += cnt;
      if (e.data === BOBS_HUT_ID) bobs += cnt;
      if (e.data === WALL_ID) {
        walls.push({ level: e.lvl, count: cnt });
        continue;
      }
      const ent = catalog.get(e.data);
      if (!ent) {
        unknownIds.add(e.data);
        continue;
      }
      for (let i = 0; i < cnt; i++) add(ent, e);
    }
  }

  const helper = (id: number): HelperState | undefined => {
    const h = (raw.helpers ?? []).find((x: any) => x.data === id);
    return h ? { level: h.lvl, cooldownSec: h.helper_cooldown ?? 0 } : undefined;
  };

  // Disambiguate labels only where an entity has several instances.
  for (const inst of instances)
    if ((counters.get(inst.entity.dataId) ?? 0) === 1) inst.label = inst.entity.name;

  return {
    tag: raw.tag,
    timestamp: raw.timestamp,
    townHall: levels.get(TOWN_HALL_ID) ?? 0,
    builders: builderHuts + (bobs > 0 ? 1 : 0),
    instances,
    walls,
    apprentice: helper(APPRENTICE_ID),
    labAssistant: helper(LAB_ASSISTANT_ID),
    unknownIds: [...unknownIds],
    levelOf: (id) => levels.get(id) ?? 0,
  };
}
