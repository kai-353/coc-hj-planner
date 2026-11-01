// All planner times are integer "epoch minutes" (Unix seconds / 60).

export const HOUR = 60;
export const DAY = 24 * HOUR;

export const toEpochMin = (unixSec: number) => Math.floor(unixSec / 60);
export const parseIso = (iso: string) => Math.floor(Date.parse(iso) / 60_000);

export function parseHHMM(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function fmtDuration(min: number): string {
  min = Math.round(min);
  const d = Math.floor(min / DAY);
  const h = Math.floor((min % DAY) / HOUR);
  const m = min % HOUR;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m || !parts.length) parts.push(`${m}m`);
  return parts.join(" ");
}

/** Local-time helper for a timezone plus the daily "awake" window in which the player can act. */
export class Clock {
  private offsetCache = new Map<number, number>();
  private fmt: Intl.DateTimeFormat;

  constructor(
    readonly timeZone: string,
    readonly awakeFrom: number, // minute of day, inclusive
    readonly awakeTo: number, // minute of day, inclusive
  ) {
    this.fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    });
  }

  private parts(t: number): Record<string, string> {
    return Object.fromEntries(this.fmt.formatToParts(new Date(t * 60_000)).map((p) => [p.type, p.value]));
  }

  /** UTC offset in minutes, cached per hour (offsets only change on hour boundaries). */
  private offset(t: number): number {
    const bucket = Math.floor(t / 60);
    let off = this.offsetCache.get(bucket);
    if (off === undefined) {
      const p = this.parts(bucket * 60);
      const local = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!) / 60_000;
      off = local - bucket * 60;
      this.offsetCache.set(bucket, off);
    }
    return off;
  }

  minuteOfDay(t: number): number {
    return (((t + this.offset(t)) % DAY) + DAY) % DAY;
  }

  isAwake(t: number): boolean {
    const m = this.minuteOfDay(t);
    return m >= this.awakeFrom && m <= this.awakeTo;
  }

  /** First awake minute at or after t. */
  nextAwake(t: number): number {
    if (this.isAwake(t)) return t;
    let n = t + ((this.awakeFrom - this.minuteOfDay(t) + DAY) % DAY);
    // DST shifts can move the target by up to an hour either way.
    if (!this.isAwake(n)) n -= HOUR;
    while (!this.isAwake(n)) n += 1;
    return n;
  }

  dayKey(t: number): string {
    const p = this.parts(t);
    return `${p.year}-${p.month}-${p.day}`;
  }

  dayLabel(t: number): string {
    const p = this.parts(t);
    return `${p.weekday} ${p.day}-${p.month}-${p.year}`;
  }

  time(t: number): string {
    const p = this.parts(t);
    return `${p.hour}:${p.minute}`;
  }

  dateTime(t: number): string {
    const p = this.parts(t);
    return `${p.weekday} ${p.day}-${p.month} ${p.hour}:${p.minute}`;
  }
}
