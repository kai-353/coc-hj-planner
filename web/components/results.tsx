import {
  AlertTriangle,
  BookOpen,
  ChartGantt,
  FlaskConical,
  FlaskRound,
  Gem,
  Hammer,
  List,
  Moon,
  Sparkles,
  UserCog,
  Wrench,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { fmtDuration } from "../../src/time";
import { TimelineChart } from "@/components/timeline";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { PlanView, ScheduleRow, TaskRef } from "@/lib/api";
import { cn } from "@/lib/utils";

const fmtNum = (n: number) => n.toLocaleString("en-US");

export function Results({ plan }: { plan: PlanView }) {
  return (
    <div className="space-y-6">
      <Summary plan={plan} />
      <Items plan={plan} />
      <Tabs defaultValue="schedule">
        <TabsList>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="unstarted">Not started ({plan.unstarted.length})</TabsTrigger>
          <TabsTrigger value="resources">Resources & walls</TabsTrigger>
          <TabsTrigger value="skipped">Skipped ({plan.skipped.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="schedule">
          <Schedule plan={plan} />
        </TabsContent>
        <TabsContent value="unstarted">
          <Unstarted plan={plan} />
        </TabsContent>
        <TabsContent value="resources">
          <Resources plan={plan} />
        </TabsContent>
        <TabsContent value="skipped">
          <Skipped plan={plan} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Summary({ plan }: { plan: PlanView }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {plan.queues.map((q) => {
        const done = q.planned ? q.started / q.planned : 1;
        return (
          <Card key={q.queue} className="gap-3">
            <CardHeader>
              <CardDescription className="flex items-center gap-2">
                {q.queue === "builder" ? <Wrench className="size-4" /> : <FlaskConical className="size-4" />}
                {q.queue === "builder" ? `${plan.builders} builders` : "Laboratory"}
              </CardDescription>
              <CardTitle className="text-3xl tabular-nums">
                {q.started}
                <span className="text-base font-normal text-muted-foreground"> / {q.planned} started</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(done * 100)}%` }} />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>
                  {q.unstarted ? `${q.unstarted} not started (${fmtDuration(q.unstartedMin)})` : "Everything starts in time"}
                </span>
                <span>Idle overnight {fmtDuration(q.nightIdleMin)}</span>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function Items({ plan }: { plan: PlanView }) {
  const none = !plan.items.length && !plan.goblins.length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Special items</CardTitle>
        <CardDescription>
          Plan window {plan.start} → {plan.end} ({plan.timezone})
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {none ? (
          <p className="text-sm text-muted-foreground">No special items used.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {plan.items.map((i) => (
              <li key={`${i.label}|${i.source}`} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
                <Sparkles className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex-1">
                  <span className="font-medium">
                    {i.count}× {i.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {i.source}
                    {i.price != null && ` · ${i.price} ${i.currency} each`}
                  </span>
                </span>
              </li>
            ))}
            {plan.goblins.map((g) => (
              <li key={g.name} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
                <Gem className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex-1">
                  <span className="font-medium">{g.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {g.upgrades} upgrade{g.upgrades === 1 ? "" : "s"} · {fmtNum(g.gems)} gems
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {plan.spent.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Total spent</span>
            {plan.spent.map((s) => (
              <Badge key={s.currency} variant="secondary">
                {fmtNum(s.amount)} {s.label}
              </Badge>
            ))}
          </div>
        )}
        {plan.shortfall && (
          <Alert>
            <AlertTriangle />
            <AlertTitle>Not everything starts before the event ends</AlertTitle>
            <AlertDescription>
              {plan.shortfall.items.length === 0 ? (
                <p>
                  More gems or medals wouldn't help: the upgrades under "Not started" can't begin in time, usually
                  because they wait for earlier levels of the same building. Skip them or unlock books/hammers.
                </p>
              ) : (
                <>
                  <p>With unlimited gems and medals (books and hammers still locked) you would additionally need:</p>
                  <ul className="list-inside list-disc">
                    {plan.shortfall.items.map((i) => (
                      <li key={i.label}>
                        {i.count}× {i.label}
                      </li>
                    ))}
                  </ul>
                  <p>
                    Total spend would be {plan.shortfall.spent.map((s) => `${fmtNum(s.amount)} ${s.label}`).join(", ")}
                    {plan.shortfall.stillUnstartedMin > 0 &&
                      ` (still ${fmtDuration(plan.shortfall.stillUnstartedMin)} of upgrades not started)`}
                    .
                  </p>
                </>
              )}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

type Filter = "all" | "builder" | "lab" | "items";

const isItemRow = (r: ScheduleRow) => r.kind === "potion" || r.kind === "helper" || r.kind === "book" || r.kind === "hammer";

function Schedule({ plan }: { plan: PlanView }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [mode, setMode] = useState<"list" | "timeline">("list");
  const nowMin = Math.floor(Date.now() / 60_000);
  const todayRef = useRef<HTMLDivElement>(null);

  const days = useMemo(
    () =>
      plan.days
        .map((d) => ({
          ...d,
          rows: d.rows.filter((r) =>
            filter === "all" ? true : filter === "items" ? isItemRow(r) : r.queue === filter,
          ),
        }))
        .filter((d) => d.rows.length),
    [plan, filter],
  );
  const currentDay = days.find((d) => d.rows.some((r) => r.t >= nowMin))?.key;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          value={mode}
          onValueChange={(v) => v && setMode(v as typeof mode)}
          aria-label="Schedule view"
        >
          <ToggleGroupItem value="list">
            <List /> List
          </ToggleGroupItem>
          <ToggleGroupItem value="timeline">
            <ChartGantt /> Timeline
          </ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup
          type="single"
          variant="outline"
          value={mode === "timeline" && filter === "items" ? "all" : filter}
          onValueChange={(v) => v && setFilter(v as Filter)}
          aria-label="Show"
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="builder">Builders</ToggleGroupItem>
          <ToggleGroupItem value="lab">Lab</ToggleGroupItem>
          {mode === "list" && <ToggleGroupItem value="items">Items</ToggleGroupItem>}
        </ToggleGroup>
        {mode === "list" && currentDay && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => todayRef.current?.scrollIntoView({ block: "start", behavior: "smooth" })}
          >
            Jump to now
          </Button>
        )}
      </div>
      {mode === "timeline" && (
        <TimelineChart
          timeline={plan.timeline}
          queues={filter === "builder" ? ["builder"] : filter === "lab" ? ["lab"] : ["builder", "lab"]}
        />
      )}
      {mode === "list" && days.map((day) => (
        <Card key={day.key} ref={day.key === currentDay ? todayRef : undefined} className="scroll-mt-4 gap-0 py-0">
          <div className="border-b px-4 py-3 text-sm font-semibold">
            {day.label}
            {day.key === currentDay && (
              <Badge className="ml-2" variant="secondary">
                Up next
              </Badge>
            )}
          </div>
          <ul className="divide-y">
            {day.rows.map((r, i) => (
              <Row key={i} row={r} past={r.t < nowMin} />
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

const ICONS = {
  start: Hammer,
  overnight: Moon,
  potion: FlaskRound,
  helper: UserCog,
  book: BookOpen,
  hammer: Hammer,
} as const;

export function TaskImage({ task, className }: { task: TaskRef; className?: string }) {
  if (!task.image) return null;
  return <img src={task.image} alt="" loading="lazy" className={cn("shrink-0 object-contain", className)} />;
}

function TaskName({ task, withImage = false }: { task: TaskRef; withImage?: boolean }) {
  return (
    <>
      {withImage && <TaskImage task={task} className="mr-1.5 inline size-5 align-text-bottom" />}
      <span className="font-medium">{task.label}</span> <span className="text-muted-foreground">{task.step}</span>
    </>
  );
}

function Row({ row: r, past }: { row: ScheduleRow; past: boolean }) {
  const Icon = r.kind === "start" && r.queue === "lab" ? FlaskConical : ICONS[r.kind];
  return (
    <li className={cn("flex gap-3 px-4 py-2.5 text-sm", past && "opacity-50", r.kind === "overnight" && "bg-amber-500/5")}>
      <span className="w-11 shrink-0 pt-0.5 font-mono text-xs tabular-nums text-muted-foreground">{r.time}</span>
      {r.kind === "start" && r.task.image ? (
        <TaskImage task={r.task} className="size-8 -my-1" />
      ) : (
        <span className="flex w-8 shrink-0 justify-center">
          <Icon
            className={cn(
              "mt-0.5 size-4",
              r.kind === "overnight" ? "text-amber-600" : r.kind === "start" ? "text-muted-foreground" : "text-primary",
            )}
          />
        </span>
      )}
      <div className="min-w-0 flex-1">
        {r.kind === "start" && (
          <>
            <div>
              <Badge variant="outline" className="mr-2">
                {r.actor}
              </Badge>
              <TaskName task={r.task} />
            </div>
            <div className="text-xs text-muted-foreground">
              {fmtDuration(r.durMin)}
              {r.gems > 0 && ` · ${fmtNum(r.gems)} gems`} · done {r.doneAt ?? "?"}
            </div>
          </>
        )}
        {r.kind === "overnight" && (
          <div className="text-amber-700 dark:text-amber-500">
            {r.actor}: <TaskName task={r.task} /> finishes overnight
          </div>
        )}
        {r.kind === "potion" && (
          <>
            <div>
              Drink{" "}
              <span className="font-medium">
                {r.count}× {r.item}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {r.sources} · boost until {r.until}
            </div>
          </>
        )}
        {r.kind === "helper" && (
          <div>
            Assign {r.helper} to <TaskName task={r.task} />
          </div>
        )}
        {r.kind === "book" && (
          <div>
            Start <TaskName task={r.task} /> and finish it with <span className="font-medium">{r.item}</span>
          </div>
        )}
        {r.kind === "hammer" && (
          <div>
            Use <span className="font-medium">{r.item}</span> on <TaskName task={r.task} />
          </div>
        )}
      </div>
    </li>
  );
}

function Unstarted({ plan }: { plan: PlanView }) {
  if (!plan.unstarted.length) return <Empty>Every planned upgrade starts before the event ends.</Empty>;
  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Upgrade</TableHead>
            <TableHead className="text-right">During Hammer Jam</TableHead>
            <TableHead className="text-right">Full price</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {plan.unstarted.map((t) => (
            <TableRow key={`${t.label}|${t.step}`}>
              <TableCell>
                <TaskName task={t} withImage />
              </TableCell>
              <TableCell className="text-right tabular-nums">{fmtDuration(t.durMin)}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">{fmtDuration(t.fullDurMin)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function Resources({ plan }: { plan: PlanView }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Resources needed</CardTitle>
          <CardDescription>Discounted cost of everything that starts</CardDescription>
        </CardHeader>
        <CardContent>
          {plan.resources.length ? (
            <dl className="space-y-2 text-sm">
              {plan.resources.map((r) => (
                <div key={r.resource} className="flex justify-between">
                  <dt className="text-muted-foreground">{r.resource}</dt>
                  <dd className="font-medium tabular-nums">{fmtNum(r.amount)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing to pay for.</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Walls</CardTitle>
          <CardDescription>Instant, no builder needed. Do them while costs are discounted.</CardDescription>
        </CardHeader>
        <CardContent>
          {plan.walls.length ? (
            <ul className="space-y-2 text-sm">
              {plan.walls.map((w) => (
                <li key={w.level}>
                  {w.count}× level {w.level} → {w.maxLevel}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">All walls are maxed.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Skipped({ plan }: { plan: PlanView }) {
  if (!plan.skipped.length) return <Empty>Nothing skipped.</Empty>;
  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Upgrade</TableHead>
            <TableHead>Reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {plan.skipped.map((s) => (
            <TableRow key={`${s.label}|${s.step}`}>
              <TableCell>
                <TaskName task={s} withImage />
              </TableCell>
              <TableCell className="text-muted-foreground">{s.reason}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{children}</p>;
}
