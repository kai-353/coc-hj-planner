// Turns the village state into upgrade tasks (one task per level step).

import {
  type Catalog,
  type Category,
  HERO_HALL_ID,
  type ItemClass,
  LABORATORY_ID,
  type LevelInfo,
  PET_HOUSE_ID,
  type Queue,
} from "./catalog";
import type { Instance, Village } from "./village";

export interface Task {
  id: string;
  queue: Queue;
  itemClass: ItemClass;
  category: Category;
  name: string;
  label: string;
  /** e.g. "17→18" or "SC 1→2" */
  step: string;
  supercharge: boolean;
  /** Duration if started now (Hammer Jam discount applied). */
  durMin: number;
  fullDurMin: number;
  cost: number;
  resource: string;
  /** Task ids that must complete first (may live in another queue). */
  deps: string[];
  /** Set for upgrades already running in the export. */
  ongoing?: { remainingMin: number; extra: boolean };
}

export interface TaskOptions {
  excludeCategories: Set<string>;
  excludeNames: string[];
  /** Multiplier applied to time and cost of upgrades started during the event (0.5 for Hammer Jam). */
  discount: number;
  /** Minutes elapsed between the export and the plan start (shortens running timers). */
  elapsedMin: number;
}

export interface TaskSet {
  tasks: Task[];
  /** Upgrades left out because of exclusions or unmet prerequisites. */
  skipped: { label: string; step: string; reason: string }[];
}

const isExcluded = (inst: Instance, sc: boolean, o: TaskOptions) => {
  // Crafted defenses are replaced every crafting season, so upgrading them isn't permanent progress.
  if (inst.entity.category === "crafted-defenses") return "not permanent";
  if (o.excludeCategories.has(inst.entity.category)) return `category ${inst.entity.category}`;
  if (sc && o.excludeCategories.has("supercharges")) return "category supercharges";
  const name = inst.entity.name.toLowerCase();
  const hit = o.excludeNames.find((n) => name.includes(n.toLowerCase()));
  return hit ? `name "${hit}"` : undefined;
};

export function buildTasks(village: Village, catalog: Catalog, o: TaskOptions): TaskSet {
  const tasks: Task[] = [];
  const skipped: TaskSet["skipped"] = [];
  // "<dataId>:<level>" → task id, for prerequisites on single-instance buildings.
  const reaches = new Map<string, string>();

  const pending: { task: Task; requires: [number, number][] }[] = [];

  for (const inst of village.instances) {
    const e = inst.entity;
    const normal = catalog.reachableLevels(e, village.townHall);
    const maxNormal = Math.max(inst.level, ...normal.map((l) => l.level));
    const steps: LevelInfo[] = [
      ...normal.filter((l) => l.level > inst.level),
      ...(maxNormal === Math.max(0, ...e.levels.map((l) => l.level))
        ? e.supercharges.filter((l) => l.townHall <= village.townHall && l.level > inst.supercharge)
        : []),
    ];

    // Pets only speed up with pet potions, so there is nothing to plan for them.
    if (e.queue === "pet") {
      for (const l of steps)
        skipped.push({ label: inst.label, step: `${l.level - 1}→${l.level}`, reason: "pets aren't planned" });
      continue;
    }

    let prev: string | undefined;
    steps.forEach((l, i) => {
      const running = i === 0 && inst.timer != null;
      const step = l.supercharge ? `SC ${l.level - 1}→${l.level}` : `${l.level - 1}→${l.level}`;
      if (!running) {
        const why = isExcluded(inst, l.supercharge, o);
        if (why) {
          skipped.push({ label: inst.label, step, reason: `excluded (${why})` });
          prev = undefined;
          return;
        }
      }
      if (i > 0 && !prev) {
        skipped.push({ label: inst.label, step, reason: "earlier level excluded" });
        return;
      }
      const fullDurMin = Math.round(l.seconds / 60);
      const task: Task = {
        id: `${inst.label}|${step}`,
        queue: e.queue,
        itemClass: e.itemClass,
        category: e.category,
        name: e.name,
        label: inst.label,
        step,
        supercharge: l.supercharge,
        durMin: Math.round(fullDurMin * o.discount),
        fullDurMin,
        cost: Math.round(l.cost * o.discount),
        resource: l.resource,
        deps: prev ? [prev] : [],
        ongoing: running
          ? { remainingMin: Math.max(0, Math.round(inst.timer! / 60) - o.elapsedMin), extra: inst.extra }
          : undefined,
      };
      const requires: [number, number][] = [];
      if (l.laboratory) requires.push([LABORATORY_ID, l.laboratory]);
      if (l.petHouse) requires.push([PET_HOUSE_ID, l.petHouse]);
      if (l.heroHall) requires.push([HERO_HALL_ID, l.heroHall]);
      pending.push({ task, requires });
      if (!l.supercharge) reaches.set(`${e.dataId}:${l.level}`, task.id);
      prev = task.id;
    });
  }

  const dropped = new Set<string>();
  for (const { task, requires } of pending) {
    let ok = !task.deps.some((d) => dropped.has(d));
    for (const [id, lvl] of requires) {
      if (!ok || village.levelOf(id) >= lvl) continue;
      const dep = reaches.get(`${id}:${lvl}`);
      if (dep && !dropped.has(dep)) task.deps.push(dep);
      else ok = false;
    }
    if (ok || task.ongoing) tasks.push(task);
    else {
      dropped.add(task.id);
      skipped.push({ label: task.label, step: task.step, reason: "prerequisite building upgrade not planned" });
    }
  }

  return { tasks, skipped };
}
