// Gold Pass builder/research boosts. Tiers unlock with season points; the player is assumed to earn
// the maximum each day, so a tier unlocks at the first daily reset after which that maximum reaches
// its threshold. Browser-safe (used by the web UI to show unlock dates).

import { DAY } from "./time";

/** Season challenges reset daily at 08:00 UTC (09:00 Amsterdam in winter). */
const DAILY_RESET_MIN = 8 * 60;

export interface GoldPassTier {
  points: number;
  /** Extra time reduction (0–1), stacking multiplicatively with the event discount. */
  reduction: number;
}

export interface GoldPass {
  /** Season points at `pointsAsOf`, including everything already earned that day. */
  points: number;
  pointsAsOf: string;
  /** Most points attainable per day, Gold Pass bonus included. */
  pointsPerDay: number;
  builder: GoldPassTier[];
  research: GoldPassTier[];
}

/** Epoch minute from which a tier needing `points` is available (-Infinity if it already is). */
export function tierUnlock(gp: GoldPass, points: number): number {
  if (points <= gp.points) return -Infinity;
  if (gp.pointsPerDay <= 0) return Infinity;
  const asOf = Math.floor(Date.parse(gp.pointsAsOf) / 60_000);
  const firstReset = asOf - (((asOf - DAILY_RESET_MIN) % DAY) + DAY) % DAY + DAY;
  const days = Math.ceil((points - gp.points) / gp.pointsPerDay);
  return firstReset + (days - 1) * DAY;
}

/** Boost steps for builders or research, sorted by unlock time. */
export function boostSteps(gp: GoldPass, kind: "builder" | "research") {
  return gp[kind]
    .map((t) => ({ from: tierUnlock(gp, t.points), reduction: t.reduction }))
    .sort((a, b) => a.from - b.from);
}

/** Reduction active at epoch minute t for upgrades started then (the best unlocked tier). */
export function boostAt(steps: { from: number; reduction: number }[], t: number) {
  return Math.max(0, ...steps.filter((s) => s.from <= t).map((s) => s.reduction));
}
