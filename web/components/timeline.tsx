import { Fragment, useEffect, useRef } from "react";
import { fmtDuration } from "../../src/time";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { PlanView } from "@/lib/api";

type Timeline = PlanView["timeline"];

const PX_PER_HOUR = 5;
const ROW_H = 32;
const BAR_H = 20;
/** Day labels on the first line of the axis band, marker labels (Now, event end) on the second. */
const AXIS_H = 46;
const GROUP_H = 24;
/** Rough width of an 11px label character, to decide whether a name fits inside its bar. */
const CHAR_PX = 6.2;

const GROUP_LABEL = { builder: "Builders", lab: "Laboratory" } as const;

/** Gantt view of the schedule: one row per builder/researcher, one bar per upgrade. */
export function TimelineChart({ timeline: tl, queues }: { timeline: Timeline; queues: ("builder" | "lab")[] }) {
  const x = (t: number) => ((t - tl.start) / 60) * PX_PER_HOUR;
  const width = x(tl.end) + 24;
  const now = Math.floor(Date.now() / 60_000);
  const scroller = useRef<HTMLDivElement>(null);

  // Open on the current moment when the plan is running.
  useEffect(() => {
    if (scroller.current && now > tl.start && now < tl.end) scroller.current.scrollLeft = Math.max(0, x(now) - 120);
  }, [tl]);

  const groups = queues
    .map((q) => ({ queue: q, rows: tl.rows.filter((r) => r.queue === q) }))
    .filter((g) => g.rows.length);
  const barsByRow = new Map<string, Timeline["bars"]>();
  for (const b of tl.bars) barsByRow.set(b.row, [...(barsByRow.get(b.row) ?? []), b]);
  const plotH = groups.reduce((a, g) => a + GROUP_H + g.rows.length * ROW_H, 0);

  return (
    <TooltipProvider delayDuration={100}>
      <div className="space-y-3">
        <Legend />
        <div className="flex overflow-hidden rounded-xl border bg-card text-sm">
          {/* Station labels stay put while the timeline scrolls. */}
          <div className="w-36 shrink-0 border-r">
            <div style={{ height: AXIS_H }} className="border-b" />
            {groups.map((g) => (
              <Fragment key={g.queue}>
                <div style={{ height: GROUP_H }} className="flex items-end px-3 pb-1 text-xs font-medium text-muted-foreground">
                  {GROUP_LABEL[g.queue]}
                </div>
                {g.rows.map((r) => (
                  <div key={r.id} style={{ height: ROW_H }} className="flex items-center truncate px-3 text-secondary-foreground">
                    {r.label}
                  </div>
                ))}
              </Fragment>
            ))}
          </div>

          <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto" tabIndex={0} aria-label="Schedule timeline">
            <div className="relative" style={{ width, height: AXIS_H + plotH }}>
              {/* Background: nights, day gridlines, event end and now. */}
              {tl.nights.map((n) => (
                <div
                  key={n.from}
                  className="absolute bottom-0"
                  style={{ left: x(n.from), width: x(n.to) - x(n.from), top: AXIS_H, background: "var(--viz-night)" }}
                />
              ))}
              {tl.days.map((d) => (
                <Fragment key={d.t}>
                  <div className="absolute top-0 bottom-0 w-px" style={{ left: x(d.t), background: "var(--viz-grid)" }} />
                  <div
                    className="absolute whitespace-nowrap text-xs tabular-nums text-muted-foreground"
                    style={{ left: x(d.t) + 6, top: 7 }}
                  >
                    {d.label}
                  </div>
                </Fragment>
              ))}
              <div className="absolute inset-x-0 border-b" style={{ top: 0, height: AXIS_H }} />
              <Marker x={x(tl.eventEnd)} label="Hammer Jam ends" />
              {tl.freeBy != null && <Marker x={x(tl.freeBy)} label="Free by" />}
              {now > tl.start && now < tl.end && <Marker x={x(now)} label="Now" />}

              {/* Rows */}
              <div className="absolute inset-x-0" style={{ top: AXIS_H }}>
                {groups.map((g) => (
                  <Fragment key={g.queue}>
                    <div style={{ height: GROUP_H }} />
                    {g.rows.map((r) => (
                      <div key={r.id} className="relative" style={{ height: ROW_H }}>
                        {tl.boosts
                          .filter((b) => b.queue === g.queue)
                          .map((b) => (
                            <div
                              key={b.from}
                              className="absolute inset-y-0"
                              style={{
                                left: x(b.from),
                                width: Math.max(2, x(b.to) - x(b.from)),
                                background: "color-mix(in srgb, var(--viz-series-2) 18%, transparent)",
                              }}
                            />
                          ))}
                        {(barsByRow.get(r.id) ?? []).map((b) => (
                          <Bar key={`${b.task.label}|${b.task.step}`} bar={b} left={x(b.start)} right={x(b.end)} />
                        ))}
                      </div>
                    ))}
                  </Fragment>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

function Bar({ bar: b, left, right }: { bar: Timeline["bars"][number]; left: number; right: number }) {
  // 1px inset on both ends leaves a 2px surface gap between back-to-back upgrades.
  const width = Math.max(2, right - left - 2);
  const full = `${b.task.label} ${b.task.step}`;
  const iconPx = b.task.image ? 16 : 0;
  const fits = (s: string) => s.length * CHAR_PX + 12 + iconPx <= width;
  const label = fits(full) ? full : fits(b.task.label) ? b.task.label : "";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="absolute flex items-center overflow-hidden rounded px-1.5 text-left text-[11px] font-medium whitespace-nowrap transition-[filter] outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring"
          style={{
            left: left + 1,
            width,
            top: (ROW_H - BAR_H) / 2,
            height: BAR_H,
            background: b.running ? "var(--viz-running)" : "var(--viz-series-1)",
            color: "var(--viz-on-fill)",
          }}
          aria-label={`${full}, ${b.startLabel} to ${b.endLabel}`}
        >
          {b.task.image && width >= 26 && (
            <img src={b.task.image} alt="" loading="lazy" className="-ml-1 mr-1 size-4 shrink-0 object-contain" />
          )}
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="flex items-center gap-3">
        {b.task.image && <img src={b.task.image} alt="" className="size-10 object-contain" />}
        <div className="space-y-0.5">
          <div className="font-semibold">{full}</div>
          <div className="opacity-80">
            {b.startLabel} → {b.endLabel}
          </div>
          <div className="opacity-80">
            {fmtDuration(b.durMin)}
            {b.running && " left at export"}
            {b.gems > 0 && ` · ${b.gems.toLocaleString("en-US")} gems (goblin)`}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function Marker({ x, label }: { x: number; label: string }) {
  return (
    <>
      <div className="absolute top-0 bottom-0 w-px bg-foreground/60" style={{ left: x }} />
      <div
        className="absolute rounded bg-background px-1 text-[11px] font-medium whitespace-nowrap text-foreground"
        style={{ left: x + 4, top: 25 }}
      >
        {label}
      </div>
    </>
  );
}

function Legend() {
  const swatch = (background: string) => (
    <span className="inline-block h-3 w-5 rounded-[3px]" style={{ background }} aria-hidden />
  );
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">{swatch("var(--viz-series-1)")}Upgrade</span>
      <span className="flex items-center gap-1.5">{swatch("var(--viz-running)")}Already running</span>
      <span className="flex items-center gap-1.5">
        {swatch("color-mix(in srgb, var(--viz-series-2) 18%, transparent)")}Potion boost
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-5 rounded-[3px] ring-1 ring-border" style={{ background: "var(--viz-night)" }} aria-hidden />
        Asleep
      </span>
    </div>
  );
}
