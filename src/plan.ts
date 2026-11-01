// Builds the queues, then greedily adds the cheapest special items until every planned upgrade
// can be started before the event ends (or the budget runs out).

import { type Catalog, type ItemClass, type Queue, WALL_ID } from "./catalog";
import { boostAt, boostSteps } from "./goldpass";
import { type Config, type Currency, ITEM_KEYS, type ItemKey } from "./config";
import { type Alloc, type SimConfig, type SimResult, simulate, type Token } from "./sim";
import { buildTasks, type Task, type TaskSet } from "./tasks";
import { Clock, DAY, HOUR, parseHHMM, parseIso, toEpochMin } from "./time";
import type { Village } from "./village";

/** Queues the planner schedules. Pets are left out: only pet potions speed them up, so there is nothing to optimise. */
export type PlanQueue = Exclude<Queue, "pet">;
export const QUEUES: PlanQueue[] = ["builder", "lab"];

interface ItemInfo {
  label: string;
  kind: "potion" | "book" | "hammer";
  classes: ItemClass[];
}

const ALL: ItemClass[] = ["building", "hero", "troop", "spell", "pet"];
export const ITEMS: Record<ItemKey, ItemInfo> = {
  builderPotion: { label: "Builder Potion", kind: "potion", classes: ["building", "hero"] },
  researchPotion: { label: "Research Potion", kind: "potion", classes: ["troop", "spell"] },
  bookOfBuilding: { label: "Book of Building", kind: "book", classes: ["building"] },
  bookOfHeroes: { label: "Book of Heroes", kind: "book", classes: ["hero", "pet"] },
  bookOfFighting: { label: "Book of Fighting", kind: "book", classes: ["troop"] },
  bookOfSpells: { label: "Book of Spells", kind: "book", classes: ["spell"] },
  bookOfEverything: { label: "Book of Everything", kind: "book", classes: ALL },
  hammerOfBuilding: { label: "Hammer of Building", kind: "hammer", classes: ["building"] },
  hammerOfHeroes: { label: "Hammer of Heroes", kind: "hammer", classes: ["hero", "pet"] },
  hammerOfFighting: { label: "Hammer of Fighting", kind: "hammer", classes: ["troop"] },
  hammerOfSpells: { label: "Hammer of Spells", kind: "hammer", classes: ["spell"] },
};

const QUEUE_CLASSES: Record<PlanQueue, ItemClass[]> = {
  builder: ["building", "hero"],
  lab: ["troop", "spell"],
};

export const POTION_FOR: Record<PlanQueue, ItemKey> = {
  builder: "builderPotion",
  lab: "researchPotion",
};

export interface Acquisition {
  /** "goblin": hire the Goblin Builder/Researcher for one more upgrade (paid in gems per day). */
  item: ItemKey | "goblin";
  queue: PlanQueue;
  source: "owned" | Currency;
  price: number;
  availableAt: number;
  costPoints: number;
}

type Budget = { owned: Partial<Record<ItemKey, number>>; currency: Record<Currency, number> };

export interface Plan {
  config: Config;
  village: Village;
  clock: Clock;
  start: number;
  end: number;
  /** Infinity when builders don't need to be free at a given time. */
  freeBy: number;
  taskSet: TaskSet;
  results: Record<PlanQueue, SimResult>;
  simConfigs: Record<PlanQueue, SimConfig>;
  acquisitions: Acquisition[];
  spent: Record<Currency, number>;
  ownedUsed: Partial<Record<ItemKey, number>>;
  /** Extra purchases that would be needed to start everything, if the budget falls short. */
  shortfall?: { acquisitions: Acquisition[]; spent: Record<Currency, number>; stillUnstarted: number };
  walls: { level: number; count: number; maxLevel: number }[];
}

export function makePlan(config: Config, village: Village, catalog: Catalog): Plan {
  const clock = new Clock(config.timezone, parseHHMM(config.awake.from), parseHHMM(config.awake.to));
  const exportAt = toEpochMin(village.timestamp);
  const start = Math.max(config.planStart ? parseIso(config.planStart) : exportAt, parseIso(config.event.start));
  const end = parseIso(config.event.end);
  if (end <= start) throw new Error("Plan start is after the event end.");
  const freeBy = config.freeBy === null ? Infinity : parseIso(config.freeBy ?? config.event.end);

  const taskSet = buildTasks(village, catalog, {
    excludeCategories: new Set(config.exclude.categories),
    excludeNames: config.exclude.names,
    discount: config.event.discount,
    elapsedMin: Math.max(0, start - exportAt),
  });

  const goldPass = config.goldPass;
  const reductionFor = (q: PlanQueue) => {
    if (!goldPass) return undefined;
    const steps = boostSteps(goldPass, q === "builder" ? "builder" : "research");
    return (t: number) => boostAt(steps, t);
  };

  const helperFor = (q: PlanQueue) => {
    const h = q === "builder" ? village.apprentice : q === "lab" ? village.labAssistant : undefined;
    if (!h || h.level <= 0) return undefined;
    return {
      name: q === "builder" ? "Builder's Apprentice" : "Lab Assistant",
      workRate: h.level,
      availableAt: exportAt + Math.ceil(h.cooldownSec / 60),
      cooldownMin: config.helperCooldownHours * HOUR,
    };
  };

  const simConfigs = Object.fromEntries(
    QUEUES.map((q) => [
      q,
      {
        slots: q === "builder" ? (config.builders ?? village.builders) : 1,
        slotName: q === "builder" ? "Builder" : "Lab",
        start,
        end,
        freeBy,
        clock,
        tasks: taskSet.tasks.filter((t) => t.queue === q),
        potionMultiplier: q === "builder" ? 10 : 24,
        helper: helperFor(q),
        reductionAt: reductionFor(q),
        goblin:
          config.goblinGemsPerDay == null
            ? undefined
            : { name: q === "builder" ? "Goblin Builder" : "Goblin Researcher", gemsPerDay: config.goblinGemsPerDay },
      } satisfies SimConfig,
    ]),
  ) as Record<PlanQueue, SimConfig>;

  const budget: Budget = {
    owned: Object.fromEntries(ITEM_KEYS.map((k) => [k, config.inventory[k] ?? 0])),
    currency: {
      gems: config.inventory.gems ?? 0,
      leagueMedals: config.inventory.leagueMedals ?? 0,
      raidMedals: config.inventory.raidMedals ?? 0,
    },
  };

  const opt = optimize(config, simConfigs, budget, []);
  const plan: Plan = {
    config,
    village,
    clock,
    start,
    end,
    freeBy,
    taskSet,
    results: opt.results,
    simConfigs,
    acquisitions: opt.acquisitions,
    spent: opt.spent,
    ownedUsed: opt.ownedUsed,
    walls: village.walls
      .map((w) => ({ ...w, maxLevel: catalog.maxLevelAt(WALL_ID, village.townHall) }))
      .filter((w) => w.level < w.maxLevel),
  };

  const unstarted = totalUnstarted(opt.results);
  if (unstarted > 0) {
    // What would it take with unlimited gems and medals (still honouring neverUse)?
    const unlimited: Budget = {
      owned: budget.owned,
      currency: { gems: Infinity, leagueMedals: Infinity, raidMedals: Infinity },
    };
    const more = optimize(config, simConfigs, unlimited, opt.acquisitions);
    plan.shortfall = {
      acquisitions: more.acquisitions.slice(opt.acquisitions.length),
      spent: more.spent,
      stillUnstarted: totalUnstarted(more.results),
    };
  }
  return plan;
}

const totalUnstarted = (r: Record<PlanQueue, SimResult>) => QUEUES.reduce((a, q) => a + r[q].unstartedMin, 0);
/** Upgrade time cleared before the event ends: timer progress plus upgrades finished instantly. */
const totalWork = (r: Record<PlanQueue, SimResult>) =>
  QUEUES.reduce((a, q) => a + r[q].workBeforeEnd + r[q].instantMin, 0);
const totalGems = (r: Record<PlanQueue, SimResult>) => QUEUES.reduce((a, q) => a + r[q].gemsSpent, 0);

function toAlloc(acqs: Acquisition[], queue: PlanQueue): Alloc {
  const alloc: Alloc = { potions: [], tokens: [], goblinTasks: 0 };
  for (const a of acqs) {
    if (a.queue !== queue) continue;
    if (a.item === "goblin") {
      alloc.goblinTasks++;
      continue;
    }
    const info = ITEMS[a.item];
    if (info.kind === "potion") {
      alloc.potions.push({ item: a.item, label: info.label, source: a.source, availableAt: a.availableAt });
    } else {
      const classes = new Set(info.classes);
      alloc.tokens.push({
        item: a.item,
        kind: info.kind,
        label: info.label,
        source: a.source,
        applies: (t: Task) => classes.has(t.itemClass),
        availableAt: a.availableAt,
      } satisfies Token);
    }
  }
  return alloc;
}

function simulateAll(simConfigs: Record<PlanQueue, SimConfig>, acqs: Acquisition[]): Record<PlanQueue, SimResult> {
  const builder = simulate(simConfigs.builder, toAlloc(acqs, "builder"));
  const externalDone = new Map([...builder.doneAt, ...builder.projectedDone]);
  const sub = (q: PlanQueue) => simulate({ ...simConfigs[q], externalDone }, toAlloc(acqs, q));
  return { builder, lab: sub("lab") };
}

function optimize(
  config: Config,
  simConfigs: Record<PlanQueue, SimConfig>,
  budget: Budget,
  initial: Acquisition[],
) {
  const acqs = [...initial];
  const value = (k: ItemKey | Currency) => config.value[k] ?? 1;
  const start = simConfigs.builder.start;

  const spentOf = (list: Acquisition[], results: Record<PlanQueue, SimResult>) => {
    const spent: Record<Currency, number> = { gems: totalGems(results), leagueMedals: 0, raidMedals: 0 };
    for (const a of list) if (a.source !== "owned" && a.item !== "goblin") spent[a.source] += a.price;
    return spent;
  };
  const ownedOf = (list: Acquisition[]) => {
    const used: Partial<Record<ItemKey, number>> = {};
    for (const a of list) if (a.source === "owned" && a.item !== "goblin") used[a.item] = (used[a.item] ?? 0) + 1;
    return used;
  };
  const withinBudget = (list: Acquisition[], results: Record<PlanQueue, SimResult>) => {
    const spent = spentOf(list, results);
    const used = ownedOf(list);
    return (
      (Object.keys(spent) as Currency[]).every((c) => spent[c] <= budget.currency[c]) &&
      (Object.keys(used) as ItemKey[]).every((k) => used[k]! <= (budget.owned[k] ?? 0))
    );
  };

  /** The next copy of `item` from `source`, given what `list` already holds (undefined if not possible). */
  const nextAcq = (
    queue: PlanQueue,
    item: Acquisition["item"],
    source: Acquisition["source"],
    list: Acquisition[],
  ): Acquisition | undefined => {
    if (item === "goblin") return { item, queue, source: "gems", price: 0, availableAt: start, costPoints: 0 };
    const count = list.filter((a) => a.item === item && a.source === source).length;
    if (source === "owned")
      return count < (budget.owned[item] ?? 0)
        ? { item, queue, source, price: 0, availableAt: start, costPoints: value(item) * 0.999 }
        : undefined;
    const offer = config.shop.find((o) => o.item === item && o.currency === source);
    if (!offer || (offer.limit != null && count >= offer.limit)) return undefined;
    let availableAt = start + count * (offer.cooldownDays ?? 0) * DAY;
    if (offer.limitPerWeek) {
      // The n-th purchase has to wait for the shop week it falls in.
      const anchor = parseIso(config.shopWeekReset);
      const currentWeek = anchor + Math.floor((start - anchor) / (7 * DAY)) * 7 * DAY;
      availableAt = Math.max(availableAt, currentWeek + Math.floor(count / offer.limitPerWeek) * 7 * DAY);
    }
    if (availableAt >= simConfigs[queue].end) return undefined;
    return { item, queue, source, price: offer.price, availableAt, costPoints: offer.price * value(source) };
  };

  // Every (item, source) pair that could help this queue; the score decides between sources.
  const sources = (queue: PlanQueue) => {
    const out: [Acquisition["item"], Acquisition["source"]][] = [];
    for (const item of ITEM_KEYS) {
      if (config.neverUse.includes(item)) continue;
      const info = ITEMS[item];
      if (!info.classes.some((c) => QUEUE_CLASSES[queue].includes(c))) continue;
      if (info.kind === "potion" && POTION_FOR[queue] !== item) continue;
      out.push([item, "owned"]);
      for (const offer of config.shop) if (offer.item === item) out.push([item, offer.currency]);
    }
    if (simConfigs[queue].goblin) out.push(["goblin", "gems"]);
    return out;
  };

  let results = simulateAll(simConfigs, acqs);
  for (let iter = 0; iter < 1000 && totalUnstarted(results) > 0; iter++) {
    let best: { batch: Acquisition[]; results: Record<PlanQueue, SimResult>; ratio: number } | undefined;
    for (const queue of QUEUES) {
      if (results[queue].unstartedMin <= 0) continue;
      for (const [item, source] of sources(queue)) {
        // Timing effects make single items noisy (one potion can shift finishes into the night) and
        // progress has plateaus, so also try batches. Each copy gets its own availability.
        const batch: Acquisition[] = [];
        for (const k of [1, 2, 3, 5, 8, 13]) {
          while (batch.length < k) {
            const next = nextAcq(queue, item, source, [...acqs, ...batch]);
            if (!next) break;
            batch.push(next);
          }
          if (batch.length < k) break;
          const trial = [...acqs, ...batch];
          const r = simulateAll(simConfigs, trial);
          if (!withinBudget(trial, r)) break;
          // Score by capacity gained; the started-upgrade count alone is too lumpy.
          const gain =
            totalWork(r) - totalWork(results) + 0.25 * (totalUnstarted(results) - totalUnstarted(r));
          const cost =
            item === "goblin"
              ? (totalGems(r) - totalGems(results)) * value("gems")
              : batch.reduce((a, b) => a + b.costPoints, 0);
          if (gain <= 0 || cost <= 0) continue;
          const ratio = gain / cost;
          if (!best || ratio > best.ratio) best = { batch: [...batch], results: r, ratio };
        }
      }
    }
    if (!best) break;
    acqs.push(...best.batch);
    results = best.results;
  }

  // Use what's already in the inventory before anything bought: swap purchases for owned copies.
  for (const item of ITEM_KEYS) {
    let spare = (budget.owned[item] ?? 0) - acqs.filter((a) => a.item === item && a.source === "owned").length;
    const bought = acqs
      .filter((a) => a.item === item && a.source !== "owned")
      .sort((a, b) => b.costPoints - a.costPoints);
    for (const a of bought) {
      if (spare-- <= 0) break;
      acqs[acqs.indexOf(a)] = { ...a, source: "owned", price: 0, availableAt: start, costPoints: value(item) * 0.999 };
    }
  }
  results = simulateAll(simConfigs, acqs);

  // Drop anything the greedy pass added that turned out not to be needed. While upgrades are still
  // left over, an item only counts as unneeded if removing it costs no progress at all; single
  // potions often don't change the set of started upgrades on their own.
  const removable = acqs.slice(initial.length).sort((a, b) => b.costPoints - a.costPoints);
  for (const acq of removable) {
    const trial = acqs.filter((a) => a !== acq);
    const r = simulateAll(simConfigs, trial);
    const unstarted = totalUnstarted(results);
    const unneeded =
      totalUnstarted(r) <= unstarted && (unstarted === 0 || totalWork(r) >= totalWork(results) - 1);
    if (unneeded && withinBudget(trial, r)) {
      acqs.splice(acqs.indexOf(acq), 1);
      results = r;
    }
  }

  return { acquisitions: acqs, results, spent: spentOf(acqs, results), ownedUsed: ownedOf(acqs) };
}
