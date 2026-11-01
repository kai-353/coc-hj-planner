// Event-driven simulation of one upgrade queue (builders, laboratory or pet house).
//
// Rules modelled:
// - The player only acts while awake (Clock.isAwake); a slot that frees up at night waits until morning.
// - When picking an upgrade, prefer one that will finish inside the awake window and before the event
//   ends; the longest remaining upgrades are kept for last because they may run past the event end
//   (the discount is locked in when the upgrade starts).
// - Potions multiply the speed of every busy slot for one hour each and stack: drinking k at once boosts
//   for k hours. They are drunk when they keep slots busy (pulling a finish out of the night so the next
//   upgrade can start before bed) and otherwise spread evenly over the event, never at a fixed time.
// - A helper (Builder's Apprentice / Lab Assistant) adds `workRate` hours of progress to one regular slot for one hour, once per cooldown.
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
  /** Every upgrade must finish by this time (builders/lab free); Infinity = only start before `end`. */
  freeBy: number;
  clock: Clock;
  tasks: Task[];
  /** Completion times of tasks in other queues (for cross-queue prerequisites). */
  externalDone?: Map<string, number>;
  potionMultiplier: number;
  /** Extra time reduction (0–1) for upgrades started at t, e.g. the Gold Pass builder/research boost. */
  reductionAt?: (t: number) => number;
  helper?: Helper;
  goblin?: Goblin;
}

/** Slot id used for the goblin in events. */
export const GOBLIN_SLOT = 0;

export type SimEvent =
  | { t: number; kind: "start"; slot: number; task: Task; durMin: number; gems: number }
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
  /** Upgrade time (of started upgrades) that finishes after the free-by time; counts as not done. */
  lateMin: number;
  /** Progress made while the player can still act, in full-price minutes (so later, more discounted
   * upgrades count for more per timer minute). */
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
  /** Full-price minutes per timer minute of the current upgrade (progress value). */
  scale: number;
}

/** Largest potion batch considered at once. */
const MAX_BATCH = 6;

const longest = (xs: Task[]) => xs.reduce((a, b) => (b.durMin > a.durMin ? b : a));

export const goblinGems = (durMin: number, gemsPerDay: number) => Math.ceil((durMin / DAY) * gemsPerDay);

export function simulate(cfg: SimConfig, alloc: Alloc): SimResult {
  const { clock, start, end } = cfg;
  const M = cfg.potionMultiplier;
  const events: SimEvent[] = [];
  const doneAt = new Map<string, number>();
  const startedAt = new Map<string, number>();
  const ids = new Set(cfg.tasks.map((t) => t.id));
  const taskById = new Map(cfg.tasks.map((t) => [t.id, t]));
  const pending = new Set<Task>();
  const slots: Slot[] = Array.from({ length: cfg.slots }, (_, i) => ({ id: i + 1, temp: false, goblin: false, rem: 0, scale: 1 }));
  const goblinSlot: Slot | undefined = cfg.goblin ? { id: GOBLIN_SLOT, temp: false, goblin: true, rem: 0, scale: 1 } : undefined;
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
      slot = { id: slots.length + 1, temp: true, goblin: false, rem: 0, scale: 1 };
      slots.push(slot);
    }
    slot.task = task;
    slot.rem = task.ongoing.remainingMin;
  }

  const tokens = [...alloc.tokens].sort((a, b) => kindOrder(a) - kindOrder(b));
  const potionQueue = [...alloc.potions].sort((a, b) => a.availableAt - b.availableAt);
  let goblinLeft = cfg.goblin ? alloc.goblinTasks : 0;
  let potionUntil = -1;
  let lastPotion: Extract<SimEvent, { kind: "potion" }> | undefined;
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

  // Keep the longest stand-alone upgrades for each slot's last start: they may overrun the event, as long
  // as one started at the last chance still finishes by the free-by time.
  const reserved = () => {
    const free = [...pending].filter((x) => !dependents.has(x.id) && x.durMin <= cfg.freeBy - lastAction);
    if (pending.size <= cfg.slots) return new Set<Task>();
    return new Set(free.sort((a, b) => b.durMin - a.durMin).slice(0, cfg.slots));
  };
  /** Timer of an upgrade started at t (event discount is in durMin; the Gold Pass depends on t). */
  const durAt = (x: Task, t: number) => Math.round(x.durMin * (1 - (cfg.reductionAt?.(t) ?? 0)));
  const idleUntilMorning = (t: number) => clock.nextAwake(t) - t;

  // Last moment the player can act before the event ends; progress after it can't start anything new.
  let lastAction = end - 1;
  while (lastAction > start && !clock.isAwake(lastAction)) lastAction--;

  /** Slot-minutes a slot sits idle if its upgrade finishes at `f` (nothing can start until morning). */
  const idleAfter = (f: number) => (f >= lastAction || clock.isAwake(f) ? 0 : clock.nextAwake(f) - f);

  /**
   * Value of drinking k potions now, in slot-minutes: extra progress that isn't wasted plus idle time
   * saved by moving finishes out of the night (minus idle created by moving them into it).
   * `efficiency` compares that to the ideal of every slot using the full boost.
   */
  const batchValue = (t: number, k: number, busy: Slot[], boostable: number) => {
    const boost = k * HOUR;
    const extra = (M - 1) * boost;
    let gain = 0;
    let idleSaved = 0;
    for (const s of busy) {
      const before = t + s.rem;
      const after = s.rem >= M * boost ? before - extra : t + s.rem / M;
      idleSaved += idleAfter(before) - idleAfter(after);
      // A slot that finishes during the boost while awake gets a new upgrade and keeps the boost;
      // finishing while asleep wastes the rest of it.
      gain += s.rem >= M * boost || clock.isAwake(after) ? extra : Math.max(0, before - after);
    }
    const value = gain + idleSaved;
    return { idleSaved, value, efficiency: value / (boostable * extra) };
  };

  const choose = (t: number, candidates: Task[], res: Set<Task>): Task | undefined => {
    // Only upgrades that can finish by the free-by time. Potions still to come count, but only those
    // available before the deadline and not already needed by running upgrades (one potion speeds up
    // every running upgrade at once, so the running upgrade that needs the most sets that number).
    // A late finish forces the potions to be drunk (see below).
    const deadline = Math.min(cfg.freeBy, lastAction);
    const potionsNeeded = (finish: number) => Math.max(0, Math.ceil((finish - cfg.freeBy) / ((M - 1) * HOUR)));
    const committed = Math.max(0, ...slots.filter((s) => s.task).map((s) => potionsNeeded(t + s.rem)));
    const spare = potionQueue.filter((p) => p.availableAt < deadline).length - committed;
    const avail = candidates.filter((x) => potionsNeeded(t + durAt(x, t)) <= spare);
    if (!avail.length) return undefined;
    // An upgrade only "fits" if the slot frees up while the player can still start the next one.
    const fits = avail.filter((x) => !res.has(x) && t + durAt(x, t) <= lastAction);
    const good = fits.filter((x) => clock.isAwake(t + durAt(x, t)));
    if (good.length) return mostUrgent(good);
    if (fits.length)
      return fits.reduce((a, b) => {
        const ia = idleUntilMorning(t + durAt(a, t));
        const ib = idleUntilMorning(t + durAt(b, t));
        return ib < ia || (ib === ia && b.durMin > a.durMin) ? b : a;
      });
    // Nothing else fits before the event ends: this is the slot's last upgrade of the event.
    const awakeEnd = avail.filter((x) => clock.isAwake(t + durAt(x, t)));
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
      instantMin += task.fullDurMin;
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
      const dur = durAt(task, t);
      const gems = slot.goblin ? goblinGems(dur, cfg.goblin!.gemsPerDay) : 0;
      if (slot.goblin) goblinLeft--;
      gemsSpent += gems;
      pending.delete(task);
      startedAt.set(task.id, t);
      slot.task = task;
      slot.rem = dur;
      slot.scale = task.fullDurMin / Math.max(1, dur);
      events.push({ t, kind: "start", slot: slot.id, task, durMin: dur, gems });
    }

    const busy = slots.filter((s) => s.task);
    const regularFree = slots.some((s) => isRegular(s) && !s.task);

    // Potions (they stack, so a batch of k boosts for k hours). Drink when a batch keeps slots busy by
    // pulling finishes out of the night; otherwise keep pace with an even spread over the event, only
    // when nearly all of the boost is useful. Near the end, use whatever is left.
    const ready = potionQueue.filter((p) => p.availableAt <= t).length;
    if (ready > 0 && t >= potionUntil && t < lastAction && busy.length) {
      const boostable = slots.filter((s) => !s.temp && (s.task || !s.goblin)).length;
      const used = alloc.potions.length - potionQueue.length;
      const due = Math.ceil((alloc.potions.length * (t - start)) / (lastAction - start)) - used;
      const finalDay = lastAction - t < DAY;
      // An upgrade that would finish after the free-by time gets the potions it needs right away.
      const overrun = Math.max(0, ...busy.map((s) => t + s.rem - cfg.freeBy));
      const forced = overrun > 0 ? Math.min(ready, Math.ceil(overrun / ((M - 1) * HOUR))) : 0;
      let best: { k: number; per: number } | undefined = forced ? { k: forced, per: Infinity } : undefined;
      for (let k = 1; k <= Math.min(ready, MAX_BATCH); k++) {
        const v = batchValue(t, k, busy, boostable);
        const ok =
          (v.idleSaved > 0 && v.efficiency >= 0.6) ||
          (v.idleSaved >= 0 && k <= Math.max(due, finalDay ? ready : 0) && v.efficiency >= (finalDay ? 0.5 : 0.85));
        if (ok && !forced && (!best || v.efficiency > best.per + 1e-9)) best = { k, per: v.efficiency };
      }
      const k = best?.k ?? 0;
      if (k) {
        const uses = potionQueue.splice(0, k);
        potionUntil = t + k * HOUR;
        // Stacking makes a drink right as the previous boost ends the same as drinking them together
        // earlier, so report one batch (if the potions were already available back then).
        const prev = lastPotion?.until === t && uses.every((u) => u.availableAt <= lastPotion!.t) ? lastPotion : undefined;
        if (prev) {
          prev.uses.push(...uses);
          prev.until = potionUntil;
        } else {
          lastPotion = { t, kind: "potion", uses, until: potionUntil };
          events.push(lastPotion);
        }
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
        if (t < lastAction) work += progress * s.scale;
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
    lateMin: [...doneAt, ...projectedDone]
      .filter(([, at]) => at > cfg.freeBy)
      .reduce((a, [id]) => a + (taskById.get(id)?.durMin ?? 0), 0),
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
