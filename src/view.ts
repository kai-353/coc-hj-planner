// JSON-serialisable view of a plan, shared by the Markdown report and the web UI.

import type { Currency, ItemKey } from "./config";
import { ITEMS, type Plan, type PlanQueue, QUEUES } from "./plan";
import { GOBLIN_SLOT } from "./sim";
import { DAY } from "./time";
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
  /** URL of the upgrade's picture, served by the web server under /img/. */
  image?: string;
}

export type ScheduleRow = {
  /** Epoch minutes. */
  t: number;
  time: string;
  queue: PlanQueue;
} & (
  | { kind: "start"; actor: string; task: TaskRef; durMin: number; gems: number; doneAt: string | null }
  | { kind: "overnight"; actor: string; task: TaskRef }
  | { kind: "potion"; item: string; image: string; count: number; sources: string; until: string }
  | { kind: "helper"; helper: string; image: string; task: TaskRef }
  | { kind: "book" | "hammer"; item: string; image: string; task: TaskRef }
);

export interface Timeline {
  /** Epoch minutes; the chart spans start → last bar end. */
  start: number;
  end: number;
  eventEnd: number;
  /** Builders/lab free-by time when it differs from the event end. */
  freeBy: number | null;
  rows: { id: string; queue: PlanQueue; label: string }[];
  bars: {
    row: string;
    task: TaskRef;
    start: number;
    end: number;
    startLabel: string;
    endLabel: string;
    durMin: number;
    gems: number;
    /** Already running in the export (started before the plan). */
    running: boolean;
  }[];
  /** Potion batches, drawn as a line at the moment they're drunk. */
  boosts: { queue: PlanQueue; from: number; to: number; label: string; image: string; at: string; until: string }[];
  nights: { from: number; to: number }[];
  /** Local midnights inside the span, for the day axis. */
  days: { t: number; label: string }[];
}

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
    /** When the last upgrade in this queue finishes, and whether that's by the free-by time. */
    lastFinish: string | null;
    freeInTime: boolean;
  }[];
  /** Builders and lab must be free by this time (null = no requirement). */
  freeBy: string | null;
  /** One entry per magic item: total used, broken down by where it comes from. */
  items: {
    label: string;
    image: string;
    count: number;
    sources: { source: string; count: number; cost: number | null; currency: string | null }[];
  }[];
  goblins: { name: string; upgrades: number; gems: number }[];
  spent: { currency: Currency; label: string; amount: number }[];
  shortfall: {
    items: { label: string; count: number }[];
    spent: { currency: Currency; label: string; amount: number }[];
    stillUnstartedMin: number;
  } | null;
  days: { key: string; label: string; rows: ScheduleRow[] }[];
  timeline: Timeline;
  unstarted: (TaskRef & { durMin: number; fullDurMin: number })[];
  walls: { level: number; count: number; maxLevel: number }[];
  resources: { resource: string; amount: number }[];
  skipped: (TaskRef & { reason: string })[];
}

/** Picture of a magic item, e.g. builderPotion → /img/magic-items/potions/builder-potion.png. */
export const itemImage = (key: string) =>
  `/img/magic-items/${ITEMS[key as ItemKey].kind}s/${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}.png`;

const HELPER_IMAGE: Record<PlanQueue, string> = {
  builder: "/img/home/other/helpers/builders-apprentice/normal.png",
  lab: "/img/home/other/helpers/lab-assistant/normal.png",
};

const ref = (t: Task): TaskRef => ({
  label: t.label,
  step: t.step,
  image: t.image ? `/img/${t.image.replace(/^images\//, "")}` : undefined,
});

const spentList = (spent: Record<Currency, number>) =>
  (Object.keys(spent) as Currency[])
    .filter((c) => spent[c] > 0)
    .map((c) => ({ currency: c, label: CURRENCY_LABEL[c], amount: spent[c] }));

// Same-minute events: warnings first, then instant items, starts, potions, helpers.
const ORDER: Record<ScheduleRow["kind"], number> = { overnight: 0, book: 1, hammer: 1, start: 2, potion: 3, helper: 4 };

export function buildPlanView(plan: Plan): PlanView {
  const { clock, results, village, config } = plan;

  const items = new Map<string, PlanView["items"][number]>();
  // Inventory first, then shops, so the breakdown reads "4 from inventory · 24 from League Shop".
  const bySource = [...plan.acquisitions].sort((a, b) => Number(b.source === "owned") - Number(a.source === "owned"));
  for (const a of bySource) {
    if (a.item === "goblin") continue;
    const row = items.get(a.item) ?? { label: ITEMS[a.item].label, image: itemImage(a.item), count: 0, sources: [] };
    row.count++;
    let src = row.sources.find((s) => s.source === SOURCE_LABEL[a.source]);
    if (!src) {
      src = {
        source: SOURCE_LABEL[a.source],
        count: 0,
        cost: a.source === "owned" ? null : 0,
        currency: a.source === "owned" ? null : CURRENCY_LABEL[a.source],
      };
      row.sources.push(src);
    }
    src.count++;
    if (src.cost != null) src.cost += a.price;
    items.set(a.item, row);
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
            durMin: e.durMin,
            gems: e.gems,
            doneAt: fin != null ? clock.dateTime(fin) : null,
          });
          break;
        }
        case "finish":
          if (!clock.isAwake(e.t)) rows.push({ ...base(e.t), kind: "overnight", actor: actor(e.slot), task: ref(e.task) });
          break;
        case "potion": {
          const bySource = new Map<string, number>();
          for (const u of e.uses) {
            const src = SOURCE_LABEL[u.source as keyof typeof SOURCE_LABEL];
            bySource.set(src, (bySource.get(src) ?? 0) + 1);
          }
          rows.push({
            ...base(e.t),
            kind: "potion",
            item: e.uses[0]!.label,
            image: itemImage(e.uses[0]!.item),
            count: e.uses.length,
            sources:
              bySource.size === 1 ? [...bySource.keys()][0]! : [...bySource].map(([s, n]) => `${n} ${s}`).join(", "),
            until: clock.time(e.until),
          });
          break;
        }
        case "helper":
          rows.push({ ...base(e.t), kind: "helper", helper: e.helper, image: HELPER_IMAGE[q], task: ref(e.task) });
          break;
        case "instant":
          rows.push({
            ...base(e.t),
            kind: e.token.kind,
            item: e.token.label,
            image: itemImage(e.token.item),
            task: ref(e.task),
          });
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

  const timeline = buildTimeline(plan);

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
    freeBy: Number.isFinite(plan.freeBy) ? clock.dateTime(plan.freeBy) : null,
    queues: QUEUES.map((q) => {
      const r = results[q];
      const last = Math.max(-Infinity, ...r.doneAt.values(), ...r.projectedDone.values());
      return {
        queue: q,
        name: plan.simConfigs[q].slotName,
        planned: plan.simConfigs[q].tasks.filter((t) => !t.ongoing).length,
        started: r.startedAt.size,
        unstarted: r.unstarted.length,
        unstartedMin: r.unstartedMin,
        idleAwakeMin: r.idleAwakeMin,
        nightIdleMin: r.nightIdleMin,
        lastFinish: last > -Infinity ? clock.dateTime(last) : null,
        freeInTime: last <= plan.freeBy,
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
    timeline,
    unstarted: QUEUES.flatMap((q) => results[q].unstarted)
      .sort((a, b) => b.durMin - a.durMin)
      .map((t) => ({ ...ref(t), durMin: t.durMin, fullDurMin: t.fullDurMin })),
    walls: plan.walls,
    resources: [...resources].map(([resource, amount]) => ({ resource, amount })),
    skipped: plan.taskSet.skipped,
  };
}

function buildTimeline(plan: Plan): Timeline {
  const { clock, results } = plan;
  const rows: Timeline["rows"] = [];
  const bars: Timeline["bars"] = [];
  const boosts: Timeline["boosts"] = [];

  for (const q of QUEUES) {
    const sc = plan.simConfigs[q];
    const r = results[q];
    const rowId = (slot: number) => `${q}:${slot}`;
    const slotIds = new Set<number>();
    const bar = (slot: number, task: Task, start: number, end: number, durMin: number, gems: number, running: boolean) => {
      slotIds.add(slot);
      bars.push({
        row: rowId(slot),
        task: ref(task),
        start,
        end,
        startLabel: running ? "before the plan" : clock.dateTime(start),
        endLabel: clock.dateTime(end),
        durMin,
        gems,
        running,
      });
    };

    for (let i = 1; i <= sc.slots; i++) slotIds.add(i);
    if (sc.goblin) slotIds.add(GOBLIN_SLOT);
    for (const e of r.events) {
      if (e.kind === "start") {
        const end = r.doneAt.get(e.task.id) ?? r.projectedDone.get(e.task.id) ?? e.t + e.durMin;
        bar(e.slot, e.task, e.t, end, e.durMin, e.gems, false);
      } else if (e.kind === "finish" && e.task.ongoing) {
        bar(e.slot, e.task, plan.start, e.t, e.task.ongoing.remainingMin, 0, true);
      } else if (e.kind === "potion") {
        boosts.push({
          queue: q,
          from: e.t,
          to: e.until,
          label: `${e.uses.length}× ${e.uses[0]!.label}`,
          image: itemImage(e.uses[0]!.item),
          at: clock.dateTime(e.t),
          until: clock.time(e.until),
        });
      }
    }

    const ordered = [...slotIds].sort((a, b) => (a === GOBLIN_SLOT ? 1 : b === GOBLIN_SLOT ? -1 : a - b));
    for (const slot of ordered)
      rows.push({
        id: rowId(slot),
        queue: q,
        label:
          slot === GOBLIN_SLOT
            ? sc.goblin!.name
            : slot > sc.slots
              ? `Extra ${sc.slotName.toLowerCase()}`
              : sc.slots > 1
                ? `${sc.slotName} ${slot}`
                : sc.slotName,
      });
  }

  const start = plan.start;
  const end = Math.max(plan.end, ...bars.map((b) => b.end));

  const nights: Timeline["nights"] = [];
  for (let t = start; t < end; ) {
    const from = clock.isAwake(t) ? t - clock.minuteOfDay(t) + clock.awakeTo + 1 : t;
    const to = clock.nextAwake(from);
    nights.push({ from, to: Math.min(to, end) });
    t = to + 1;
  }

  const days: Timeline["days"] = [];
  for (let t = start - clock.minuteOfDay(start) + DAY; t < end; t += DAY) {
    // Re-align to local midnight in case a DST change happened since the start.
    const midnight = t - (clock.minuteOfDay(t) > 12 * 60 ? clock.minuteOfDay(t) - DAY : clock.minuteOfDay(t));
    days.push({ t: midnight, label: clock.dayLabel(midnight).slice(0, 9) });
  }

  const freeBy = Number.isFinite(plan.freeBy) && plan.freeBy !== plan.end ? plan.freeBy : null;
  return { start, end: Math.max(end, freeBy ?? end), eventEnd: plan.end, freeBy, rows, bars, boosts, nights, days };
}
