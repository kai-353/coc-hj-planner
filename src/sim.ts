// Event-driven simulation of one upgrade queue (builders, laboratory or pet house).
//
// Rules modelled:
// - The player only acts while awake (Clock.isAwake); a slot that frees up at night waits until morning.
// - When picking an upgrade, prefer one that will finish inside the awake window and before the event
//   ends; the longest remaining upgrades are kept for last because they may run past the event end
//   (the discount is locked in when the upgrade starts).
// - Potions multiply the speed of every busy slot for one hour each and stack: drinking k at once boosts
//   for k hours. Batches are drunk at the end of the day so the boost runs while the player sleeps;
//   daytime batches only happen when there are more potions than the remaining nights can absorb.
// - A helper (Builder's Apprentice /
//   Lab Assistant) adds `workRate` hours of progress to one regular slot for one hour, once per cooldown.
// - The Goblin Builder / Goblin Researcher is an extra slot paid in gems per day of upgrade time; the
//   allocation says how many upgrades it may take on.
// - Books complete an upgrade right after it is started; hammers complete one without needing a slot.

import type { Task } from "./tasks";
import { type Clock, DAY, HOUR } from "./time";

export interface Token {
  item: string;
  kind: "book" | "hammer";
  label: string;
  source: string;
  applies: (t: Task) => boolean;
  availableAt: number;
}

export interface PotionUse {
  item: string;
  label: string;
  source: string;
  /** When the potion can be had (shop purchases may have to wait for a weekly reset). */
  availableAt: number;
}

export interface Alloc {
  potions: PotionUse[];
  tokens: Token[];
  /** Number of upgrades the goblin may be hired for. */
  goblinTasks: number;
}

export interface Helper {
  name: string;
  workRate: number;
  availableAt: number;
  cooldownMin: number;
}

export interface Goblin {
  name: string;
  gemsPerDay: number;
}

export interface SimConfig {
  slots: number;
  slotName: string;
  start: number;
  end: number;
  clock: Clock;
  tasks: Task[];
  /** Completion times of tasks in other queues (for cross-queue prerequisites). */
  externalDone?: Map<string, number>;
  potionMultiplier: number;
  helper?: Helper;
  goblin?: Goblin;
}

/** Slot id used for the goblin in events. */
export const GOBLIN_SLOT = 0;

export type SimEvent =
  | { t: number; kind: "start"; slot: number; task: Task; gems: number }
  | { t: number; kind: "finish"; slot: number; task: Task }
  | { t: number; kind: "potion"; uses: PotionUse[]; until: number }
  | { t: number; kind: "helper"; slot: number; task: Task; helper: string }
  | { t: number; kind: "instant"; token: Token; task: Task };

export interface SimResult {
  events: SimEvent[];
  doneAt: Map<string, number>;
  /** Expected finish of upgrades still running when the event ends (no further boosts). */
  projectedDone: Map<string, number>;
  startedAt: Map<string, number>;
  unstarted: Task[];
  unstartedMin: number;
  workBeforeEnd: number;
  /** Upgrade time skipped by books and hammers. */
  instantMin: number;
  idleAwakeMin: number;
  nightIdleMin: number;
  gemsSpent: number;
  potionsUsed: number;
  tokensUsed: number;
  goblinTasksUsed: number;
}

interface Slot {
  id: number;
  /** Temporary slot for an "extra" upgrade running in the export when no goblin is configured. */
  temp: boolean;
  goblin: boolean;
  task?: Task;
  rem: number;
}

/** Potions per night that typically still land on running upgrades. */
const NIGHT_BATCH = 3;

const longest = (xs: Task[]) => xs.reduce((a, b) => (b.durMin > a.durMin ? b : a));

export const goblinGems = (task: Task, gemsPerDay: number) => Math.ceil((task.durMin / DAY) * gemsPerDay);

export function simulate(cfg: SimConfig, alloc: Alloc): SimResult {
  const { clock, start, end } = cfg;
  const M = cfg.potionMultiplier;
  const events: SimEvent[] = [];
  const doneAt = new Map<string, number>();
  const startedAt = new Map<string, number>();
  const ids = new Set(cfg.tasks.map((t) => t.id));
  const pending = new Set<Task>();
  const slots: Slot[] = Array.from({ length: cfg.slots }, (_, i) => ({ id: i + 1, temp: false, goblin: false, rem: 0 }));
  const goblinSlot: Slot | undefined = cfg.goblin ? { id: GOBLIN_SLOT, temp: false, goblin: true, rem: 0 } : undefined;
  if (goblinSlot) slots.push(goblinSlot);
  const isRegular = (s: Slot) => !s.temp && !s.goblin;

  for (const task of cfg.tasks) {
    if (!task.ongoing) {
      pending.add(task);
      continue;
    }
    let slot = task.ongoing.extra
      ? goblinSlot && !goblinSlot.task
        ? goblinSlot
        : undefined
      : slots.find((s) => isRegular(s) && !s.task);
    if (!slot) {
      slot = { id: slots.length + 1, temp: true, goblin: false, rem: 0 };
      slots.push(slot);
    }
    slot.task = task;
    slot.rem = task.ongoing.remainingMin;
  }

  const tokens = [...alloc.tokens].sort((a, b) => kindOrder(a) - kindOrder(b));
  const potionQueue = [...alloc.potions].sort((a, b) => a.availableAt - b.availableAt);
  let goblinLeft = cfg.goblin ? alloc.goblinTasks : 0;
  let potionUntil = -1;
  let helperUntil = -1;
  let helperSlot: Slot | undefined;
  let helperNext = cfg.helper?.availableAt ?? Infinity;
  let gemsSpent = 0;
  let work = 0;
  let idleAwake = 0;
  let nightIdle = 0;
  let tokensUsed = 0;
  let instantMin = 0;

  const isDone = (id: string, t: number) =>
    ((ids.has(id) ? doneAt.get(id) : cfg.externalDone?.get(id)) ?? Infinity) <= t;
  const available = (t: number) => [...pending].filter((x) => x.deps.every((d) => isDone(d, t)));
  // Critical path: an upgrade's own time plus the longest chain of later levels waiting on it.
  const dependents = new Map<string, Task[]>();
  for (const x of cfg.tasks) for (const d of x.deps) dependents.set(d, [...(dependents.get(d) ?? []), x]);
  const chainMin = new Map<string, number>();
  const chain = (x: Task): number => {
    let v = chainMin.get(x.id);
    if (v === undefined) {
      v = x.durMin + Math.max(0, ...(dependents.get(x.id) ?? []).map(chain));
      chainMin.set(x.id, v);
    }
    return v;
  };
  const mostUrgent = (xs: Task[]) => xs.reduce((a, b) => (chain(b) > chain(a) ? b : a));

  // Keep the longest stand-alone upgrades for each slot's last start (they may overrun the event).
  const reserved = () => {
    const free = [...pending].filter((x) => !dependents.has(x.id));
    if (pending.size <= cfg.slots) return new Set<Task>();
    return new Set(free.sort((a, b) => b.durMin - a.durMin).slice(0, cfg.slots));
  };
  const idleUntilMorning = (t: number) => clock.nextAwake(t) - t;

  // Last moment the player can act before the event ends; progress after it can't start anything new.
  let lastAction = end - 1;
  while (lastAction > start && !clock.isAwake(lastAction)) lastAction--;

  const isEvening = (t: number) => !clock.isAwake(t + HOUR);
  /** Evenings (including this one) after which there is still an awake period before the event ends. */
  const eveningsLeft = (t: number) => {
    const days = Math.round((lastAction - clock.minuteOfDay(lastAction) - (t - clock.minuteOfDay(t))) / DAY);
    return Math.max(0, days);
  };

  /** Share of a k-hour boost that turns into useful progress. */
  const boostUse = (t: number, k: number, busy: Slot[], boostable: number) => {
    const cap = M * k * HOUR;
    let useful = 0;
    for (const s of busy) {
      if (s.rem >= cap) useful += cap;
      // Finishing while awake is fine: the slot gets a new upgrade and keeps using the boost.
      else useful += clock.isAwake(t + s.rem / M) ? cap : s.rem;
    }
    return useful / (boostable * cap);
  };

  const bestBatch = (t: number, max: number, minUse: number, busy: Slot[], boostable: number) => {
    for (let k = max; k >= 1; k--) if (boostUse(t, k, busy, boostable) >= minUse) return k;
    return 0;
  };

  const choose = (t: number, avail: Task[], res: Set<Task>): Task | undefined => {
    if (!avail.length) return undefined;
    // An upgrade only "fits" if the slot frees up while the player can still start the next one.
    const fits = avail.filter((x) => !res.has(x) && t + x.durMin <= lastAction);
    const good = fits.filter((x) => clock.isAwake(t + x.durMin));
    if (good.length) return mostUrgent(good);
    if (fits.length)
      return fits.reduce((a, b) => {
        const ia = idleUntilMorning(t + a.durMin);
        const ib = idleUntilMorning(t + b.durMin);
        return ib < ia || (ib === ia && b.durMin > a.durMin) ? b : a;
      });
    // Nothing else fits before the event ends: this is the slot's last upgrade of the event.
    const awakeEnd = avail.filter((x) => clock.isAwake(t + x.durMin));
    return longest(awakeEnd.length ? awakeEnd : avail);
  };

  const useTokens = (t: number, kind: Token["kind"]) => {
    for (const token of [...tokens]) {
      if (token.kind !== kind || token.availableAt > t) continue;
      const res = reserved();
      const cands = available(t).filter(token.applies);
      if (!cands.length) continue;
      const nonRes = cands.filter((x) => !res.has(x));
      const task = longest(nonRes.length ? nonRes : cands);
      pending.delete(task);
      startedAt.set(task.id, t);
      doneAt.set(task.id, t);
      tokensUsed++;
      instantMin += task.durMin;
      tokens.splice(tokens.indexOf(token), 1);
      events.push({ t, kind: "instant", token, task });
    }
  };

  const decide = (t: number) => {
    useTokens(t, "hammer");
    for (const slot of slots) {
      if (slot.temp || slot.task) continue;
      if (slot.goblin && goblinLeft <= 0) continue;
      if (!slot.goblin) useTokens(t, "book");
      const task = choose(t, available(t), reserved());
      if (!task) break;
      const gems = slot.goblin ? goblinGems(task, cfg.goblin!.gemsPerDay) : 0;
      if (slot.goblin) goblinLeft--;
      gemsSpent += gems;
      pending.delete(task);
      startedAt.set(task.id, t);
      slot.task = task;
      slot.rem = task.durMin;
      events.push({ t, kind: "start", slot: slot.id, task, gems });
    }

    const busy = slots.filter((s) => s.task);
    const regularFree = slots.some((s) => isRegular(s) && !s.task);

    // Potions, drunk in batches (they stack). Evening batches bridge the night; spread what's left
    // over the remaining evenings and only drink during the day when the nights can't absorb it all.
    const ready = potionQueue.filter((p) => p.availableAt <= t).length;
    if (ready > 0 && t >= potionUntil && t < lastAction && busy.length) {
      const boostable = slots.filter((s) => !s.temp && (s.task || !s.goblin)).length;
      const evenings = eveningsLeft(t);
      let k = 0;
      if (isEvening(t) && evenings > 0) {
        const target = Math.min(ready, Math.ceil(potionQueue.length / evenings));
        k = bestBatch(t, target, 0.6, busy, boostable);
      }
      // Long overnight batches waste boost on upgrades that finish while asleep, so assume the
      // remaining nights take a few potions each and drink the rest during the day.
      const surplus = potionQueue.length - (evenings - (isEvening(t) ? 1 : 0)) * NIGHT_BATCH;
      if (!k && surplus > 0) k = bestBatch(t, Math.min(ready, surplus), 0.8, busy, boostable);
      if (k) {
        const uses = potionQueue.splice(0, k);
        potionUntil = t + k * HOUR;
        events.push({ t, kind: "potion", uses, until: potionUntil });
      }
    }

    // Helper: free, so always use it; prefer a slot whose finish moves from night into the day.
    if (cfg.helper && t >= helperNext && busy.length) {
      const gain = cfg.helper.workRate * HOUR;
      const scored = busy
        .filter(isRegular)
        .map((s) => {
          const before = t + s.rem;
          const after = before - Math.min(gain, Math.max(0, s.rem - HOUR));
          const fix = (clock.isAwake(after) ? 1 : 0) - (clock.isAwake(before) ? 1 : 0);
          return { s, fix, full: s.rem >= gain + HOUR ? 1 : 0 };
        })
        .sort((a, b) => b.full - a.full || b.fix - a.fix || b.s.rem - a.s.rem);
      const pick = scored[0];
      if (pick) {
        helperSlot = pick.s;
        helperUntil = t + HOUR;
        helperNext = t + HOUR + cfg.helper.cooldownMin;
        events.push({ t, kind: "helper", slot: pick.s.id, task: pick.s.task!, helper: cfg.helper.name });
      }
    }
  };

  const rate = (s: Slot, t: number) =>
    (t < potionUntil ? M : 1) + (s === helperSlot && t < helperUntil ? cfg.helper!.workRate : 0);

  let t = start;
  while (t < end) {
    if (clock.isAwake(t)) decide(t);

    let next = clock.isAwake(t) ? t - (t % HOUR) + HOUR : clock.nextAwake(t);
    if (!clock.isAwake(next)) next = clock.nextAwake(next);
    for (const s of slots) if (s.task) next = Math.min(next, t + Math.ceil(s.rem / rate(s, t)));
    if (potionUntil > t) next = Math.min(next, potionUntil);
    if (helperUntil > t) next = Math.min(next, helperUntil);
    next = Math.max(t + 1, Math.min(next, end));

    const dt = next - t;
    const awake = clock.isAwake(t);
    for (const s of slots) {
      if (s.task) {
        const progress = Math.min(s.rem, rate(s, t) * dt);
        s.rem -= progress;
        if (t < lastAction) work += progress;
        if (s.rem <= 1e-9) {
          doneAt.set(s.task.id, next);
          events.push({ t: next, kind: "finish", slot: s.id, task: s.task });
          s.task = undefined;
          s.rem = 0;
        }
      } else if (isRegular(s) && pending.size) {
        if (awake) idleAwake += dt;
        else nightIdle += dt;
      }
    }
    t = next;
  }

  const projectedDone = new Map<string, number>();
  for (const s of slots) if (s.task) projectedDone.set(s.task.id, end + Math.ceil(s.rem));

  const unstarted = [...pending];
  return {
    events,
    doneAt,
    projectedDone,
    startedAt,
    unstarted,
    unstartedMin: unstarted.reduce((a, x) => a + x.durMin, 0),
    workBeforeEnd: work,
    instantMin,
    idleAwakeMin: idleAwake,
    nightIdleMin: nightIdle,
    gemsSpent,
    potionsUsed: alloc.potions.length - potionQueue.length,
    tokensUsed,
    goblinTasksUsed: (cfg.goblin ? alloc.goblinTasks : 0) - goblinLeft,
  };
}

// Narrow items before Book of Everything.
function kindOrder(t: Token) {
  return t.item === "bookOfEverything" ? 1 : 0;
}
