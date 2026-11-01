// JSON-serialisable view of a plan, shared by the Markdown report and the web UI.

import type { Currency } from "./config";
import { ITEMS, type Plan, type PlanQueue, QUEUES } from "./plan";
import { GOBLIN_SLOT } from "./sim";
import type { Task } from "./tasks";

export const CURRENCY_LABEL: Record<Currency, string> = {
  gems: "gems",
  leagueMedals: "League Medals",
  raidMedals: "Raid Medals",
};

export const SOURCE_LABEL = {
  owned: "from inventory",
  gems: "for gems",
  leagueMedals: "from League Shop",
  raidMedals: "from Raid Medal Trader",
} as const;

export interface TaskRef {
  label: string;
  step: string;
}

export type ScheduleRow = {
  /** Epoch minutes. */
  t: number;
  time: string;
  queue: PlanQueue;
} & (
  | { kind: "start"; actor: string; task: TaskRef; durMin: number; gems: number; doneAt: string | null }
  | { kind: "overnight"; actor: string; task: TaskRef }
  | { kind: "potion"; item: string; source: string }
  | { kind: "helper"; helper: string; task: TaskRef }
  | { kind: "book" | "hammer"; item: string; task: TaskRef }
);

export interface PlanView {
  tag: string;
  townHall: number;
  timezone: string;
  awake: { from: string; to: string };
  start: string;
  end: string;
  builders: number;
  excluded: string[];
  neverUse: string[];
  queues: {
    queue: PlanQueue;
    name: string;
    planned: number;
    started: number;
    unstarted: number;
    unstartedMin: number;
    idleAwakeMin: number;
    nightIdleMin: number;
  }[];
  items: { label: string; source: string; price: number | null; currency: string | null; count: number }[];
  goblins: { name: string; upgrades: number; gems: number }[];
  spent: { currency: Currency; label: string; amount: number }[];
  shortfall: {
    items: { label: string; count: number }[];
    spent: { currency: Currency; label: string; amount: number }[];
    stillUnstartedMin: number;
  } | null;
  days: { key: string; label: string; rows: ScheduleRow[] }[];
  unstarted: (TaskRef & { durMin: number; fullDurMin: number })[];
  walls: { level: number; count: number; maxLevel: number }[];
  resources: { resource: string; amount: number }[];
  skipped: (TaskRef & { reason: string })[];
}

const ref = (t: Task): TaskRef => ({ label: t.label, step: t.step });

const spentList = (spent: Record<Currency, number>) =>
  (Object.keys(spent) as Currency[])
    .filter((c) => spent[c] > 0)
    .map((c) => ({ currency: c, label: CURRENCY_LABEL[c], amount: spent[c] }));

// Same-minute events: warnings first, then instant items, starts, potions, helpers.
const ORDER: Record<ScheduleRow["kind"], number> = { overnight: 0, book: 1, hammer: 1, start: 2, potion: 3, helper: 4 };

export function buildPlanView(plan: Plan): PlanView {
  const { clock, results, village, config } = plan;

  const items = new Map<string, PlanView["items"][number]>();
  for (const a of plan.acquisitions) {
    if (a.item === "goblin") continue;
    const key = `${a.item}|${a.source}`;
    const row = items.get(key) ?? {
      label: ITEMS[a.item].label,
      source: SOURCE_LABEL[a.source],
      price: a.source === "owned" ? null : a.price,
      currency: a.source === "owned" ? null : CURRENCY_LABEL[a.source],
      count: 0,
    };
    row.count++;
    items.set(key, row);
  }

  let shortfall: PlanView["shortfall"] = null;
  if (plan.shortfall) {
    const extra = new Map<string, number>();
    for (const a of plan.shortfall.acquisitions) {
      const key =
        a.item === "goblin"
          ? `${plan.simConfigs[a.queue].goblin!.name} upgrade`
          : `${ITEMS[a.item].label} ${SOURCE_LABEL[a.source]}`;
      extra.set(key, (extra.get(key) ?? 0) + 1);
    }
    shortfall = {
      items: [...extra].map(([label, count]) => ({ label, count })),
      spent: spentList(plan.shortfall.spent),
      stillUnstartedMin: plan.shortfall.stillUnstarted,
    };
  }

  const rows: ScheduleRow[] = [];
  for (const q of QUEUES) {
    const sc = plan.simConfigs[q];
    const actor = (n: number) => (n === GOBLIN_SLOT ? sc.goblin!.name : sc.slots > 1 ? `${sc.slotName} ${n}` : sc.slotName);
    const base = (t: number) => ({ t, time: clock.time(t), queue: q });
    for (const e of results[q].events) {
      switch (e.kind) {
        case "start": {
          const fin = results[q].doneAt.get(e.task.id) ?? results[q].projectedDone.get(e.task.id);
          rows.push({
            ...base(e.t),
            kind: "start",
            actor: actor(e.slot),
            task: ref(e.task),
            durMin: e.task.durMin,
            gems: e.gems,
            doneAt: fin != null ? clock.dateTime(fin) : null,
          });
          break;
        }
        case "finish":
          if (!clock.isAwake(e.t)) rows.push({ ...base(e.t), kind: "overnight", actor: actor(e.slot), task: ref(e.task) });
          break;
        case "potion":
          rows.push({
            ...base(e.t),
            kind: "potion",
            item: e.use.label,
            source: SOURCE_LABEL[e.use.source as keyof typeof SOURCE_LABEL],
          });
          break;
        case "helper":
          rows.push({ ...base(e.t), kind: "helper", helper: e.helper, task: ref(e.task) });
          break;
        case "instant":
          rows.push({ ...base(e.t), kind: e.token.kind, item: e.token.label, task: ref(e.task) });
          break;
      }
    }
  }
  rows.sort((a, b) => a.t - b.t || ORDER[a.kind] - ORDER[b.kind]);

  const days: PlanView["days"] = [];
  for (const r of rows) {
    const key = clock.dayKey(r.t);
    if (days.at(-1)?.key !== key) days.push({ key, label: clock.dayLabel(r.t), rows: [] });
    days.at(-1)!.rows.push(r);
  }

  const resources = new Map<string, number>();
  for (const q of QUEUES)
    for (const t of plan.simConfigs[q].tasks)
      if (results[q].startedAt.has(t.id) && t.cost) resources.set(t.resource, (resources.get(t.resource) ?? 0) + t.cost);

  return {
    tag: village.tag,
    townHall: village.townHall,
    timezone: config.timezone,
    awake: config.awake,
    start: clock.dateTime(plan.start),
    end: clock.dateTime(plan.end),
    builders: plan.simConfigs.builder.slots,
    excluded: [...config.exclude.categories, ...config.exclude.names.map((n) => `"${n}"`)],
    neverUse: config.neverUse.map((k) => ITEMS[k].label),
    queues: QUEUES.map((q) => {
      const r = results[q];
      return {
        queue: q,
        name: plan.simConfigs[q].slotName,
        planned: plan.simConfigs[q].tasks.filter((t) => !t.ongoing).length,
        started: r.startedAt.size,
        unstarted: r.unstarted.length,
        unstartedMin: r.unstartedMin,
        idleAwakeMin: r.idleAwakeMin,
        nightIdleMin: r.nightIdleMin,
      };
    }),
    items: [...items.values()],
    goblins: QUEUES.filter((q) => results[q].goblinTasksUsed).map((q) => ({
      name: plan.simConfigs[q].goblin!.name,
      upgrades: results[q].goblinTasksUsed,
      gems: results[q].gemsSpent,
    })),
    spent: spentList(plan.spent),
    shortfall,
    days,
    unstarted: QUEUES.flatMap((q) => results[q].unstarted)
      .sort((a, b) => b.durMin - a.durMin)
      .map((t) => ({ ...ref(t), durMin: t.durMin, fullDurMin: t.fullDurMin })),
    walls: plan.walls,
    resources: [...resources].map(([resource, amount]) => ({ resource, amount })),
    skipped: plan.taskSet.skipped,
  };
}
