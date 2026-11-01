import { ITEMS, type Plan, type PlanQueue, QUEUES } from "./plan";
import { GOBLIN_SLOT, type SimEvent } from "./sim";
import type { Task } from "./tasks";
import { fmtDuration } from "./time";

const CURRENCY_LABEL = { gems: "gems", leagueMedals: "League Medals", raidMedals: "Raid Medals" } as const;
const SOURCE_LABEL = {
  owned: "from inventory",
  gems: "for gems",
  leagueMedals: "from League Shop",
  raidMedals: "from Raid Medal Trader",
} as const;

const fmtNum = (n: number) => n.toLocaleString("en-US");
const taskName = (t: Task) => `**${t.label}** ${t.step}`;

export function renderMarkdown(plan: Plan): string {
  const { clock, results, village, config } = plan;
  const out: string[] = [];
  const line = (s = "") => out.push(s);

  const finishOf = (q: PlanQueue, t: Task) => results[q].doneAt.get(t.id) ?? results[q].projectedDone.get(t.id);

  line(`# Hammer Jam plan for ${village.tag} (TH${village.townHall})`);
  line();
  line(`- Planned from **${clock.dateTime(plan.start)}** until the event ends **${clock.dateTime(plan.end)}** (${config.timezone})`);
  line(`- Awake window: ${config.awake.from}–${config.awake.to}. Every start/finish/item below falls inside it.`);
  line(`- Builders: ${plan.simConfigs.builder.slots}, plus 1 lab (pets aren't planned)`);
  if (config.exclude.categories.length || config.exclude.names.length)
    line(`- Excluded: ${[...config.exclude.categories, ...config.exclude.names.map((n) => `"${n}"`)].join(", ")}`);
  if (config.neverUse.length) line(`- Never used: ${config.neverUse.map((k) => ITEMS[k].label).join(", ")}`);
  line();

  // Summary
  line(`## Summary`);
  line();
  line(`| Queue | Upgrades planned | Started before event end | Not started | Idle while awake | Idle overnight |`);
  line(`|---|---|---|---|---|---|`);
  for (const q of QUEUES) {
    const r = results[q];
    const planned = plan.simConfigs[q].tasks.filter((t) => !t.ongoing).length;
    line(
      `| ${plan.simConfigs[q].slotName} | ${planned} | ${r.startedAt.size} | ${r.unstarted.length} (${fmtDuration(r.unstartedMin)}) | ${fmtDuration(r.idleAwakeMin)} | ${fmtDuration(r.nightIdleMin)} |`,
    );
  }
  line();

  // Items
  line(`## Special items`);
  line();
  const counts = new Map<string, number>();
  for (const a of plan.acquisitions) {
    if (a.item === "goblin") continue;
    const key = `${ITEMS[a.item].label} ${SOURCE_LABEL[a.source]}${a.source === "owned" ? "" : ` (${a.price} ${CURRENCY_LABEL[a.source]} each)`}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (!counts.size && !plan.spent.gems) line(`No special items used.`);
  for (const [k, n] of counts) line(`- ${n}× ${k}`);
  for (const q of QUEUES) {
    const r = results[q];
    if (!r.goblinTasksUsed) continue;
    line(`- ${plan.simConfigs[q].goblin!.name} hired for ${r.goblinTasksUsed} upgrade(s): ${fmtNum(r.gemsSpent)} gems`);
  }
  const spent = (Object.keys(plan.spent) as (keyof typeof plan.spent)[]).filter((c) => plan.spent[c] > 0);
  if (spent.length)
    line(`- **Total spent:** ${spent.map((c) => `${fmtNum(plan.spent[c])} ${CURRENCY_LABEL[c]}`).join(", ")}`);
  line();

  if (plan.shortfall) {
    const sf = plan.shortfall;
    line(`### Not enough to start everything`);
    line();
    line(`With unlimited gems and medals (still never using the items above), you would additionally need:`);
    line();
    const extra = new Map<string, number>();
    for (const a of sf.acquisitions) {
      const key =
        a.item === "goblin"
          ? `${plan.simConfigs[a.queue].goblin!.name} upgrade(s)`
          : `${ITEMS[a.item].label} ${SOURCE_LABEL[a.source]}`;
      extra.set(key, (extra.get(key) ?? 0) + 1);
    }
    for (const [k, n] of extra) line(`- ${n}× ${k}`);
    line(
      `- Total spend would be ${(Object.keys(sf.spent) as (keyof typeof sf.spent)[])
        .filter((c) => sf.spent[c] > 0)
        .map((c) => `${fmtNum(sf.spent[c])} ${CURRENCY_LABEL[c]}`)
        .join(", ")}${sf.stillUnstarted ? ` (still ${fmtDuration(sf.stillUnstarted)} of upgrades not started)` : ""}`,
    );
    line();
  }

  // Schedule
  line(`## Schedule`);
  line();
  type Row = { t: number; order: number; text: string };
  const rows: Row[] = [];
  for (const q of QUEUES) {
    const slotName = plan.simConfigs[q].slotName;
    const slotLabel = (n: number) =>
      n === GOBLIN_SLOT
        ? plan.simConfigs[q].goblin!.name
        : plan.simConfigs[q].slots > 1
          ? `${slotName} ${n}`
          : slotName;
    for (const e of results[q].events as SimEvent[]) {
      switch (e.kind) {
        case "start": {
          const fin = finishOf(q, e.task);
          rows.push({
            t: e.t,
            order: 2,
            text: `▶ ${slotLabel(e.slot)}: start ${taskName(e.task)} (${fmtDuration(e.task.durMin)}${e.gems ? `, ${fmtNum(e.gems)} gems` : ""}) → done ${fin != null ? clock.dateTime(fin) : "?"}`,
          });
          break;
        }
        case "finish":
          if (!clock.isAwake(e.t))
            rows.push({ t: e.t, order: 0, text: `⚠ ${slotLabel(e.slot)}: ${taskName(e.task)} finishes overnight` });
          break;
        case "potion":
          rows.push({ t: e.t, order: 3, text: `🧪 Drink **${e.use.label}** (${SOURCE_LABEL[e.use.source as keyof typeof SOURCE_LABEL]})` });
          break;
        case "helper":
          rows.push({ t: e.t, order: 4, text: `👷 Assign ${e.helper} to ${taskName(e.task)}` });
          break;
        case "instant":
          rows.push({
            t: e.t,
            order: 1,
            text:
              e.token.kind === "hammer"
                ? `🔨 Use **${e.token.label}** on ${taskName(e.task)}`
                : `📖 Start ${taskName(e.task)} and finish it with **${e.token.label}**`,
          });
          break;
      }
    }
  }
  rows.sort((a, b) => a.t - b.t || a.order - b.order);
  let day = "";
  for (const r of rows) {
    const d = clock.dayKey(r.t);
    if (d !== day) {
      day = d;
      line();
      line(`### ${clock.dayLabel(r.t)}`);
      line();
    }
    line(`- \`${clock.time(r.t)}\` ${r.text}`);
  }
  line();

  // Leftovers
  const unstarted = QUEUES.flatMap((q) => results[q].unstarted);
  if (unstarted.length) {
    line(`## Not started before the event ends`);
    line();
    for (const t of unstarted.sort((a, b) => b.durMin - a.durMin))
      line(`- ${taskName(t)} (${fmtDuration(t.fullDurMin)} at full price)`);
    line();
  }

  if (plan.walls.length) {
    line(`## Walls (instant, no builder needed)`);
    line();
    for (const w of plan.walls)
      line(`- ${w.count}× level ${w.level} → ${w.maxLevel}: upgrade during the event while costs are discounted`);
    line();
  }

  // Resources for everything started
  const totals = new Map<string, number>();
  for (const q of QUEUES)
    for (const t of plan.simConfigs[q].tasks)
      if (results[q].startedAt.has(t.id) && t.cost) totals.set(t.resource, (totals.get(t.resource) ?? 0) + t.cost);
  if (totals.size) {
    line(`## Resources needed (discounted)`);
    line();
    for (const [res, n] of totals) line(`- ${res}: ${fmtNum(n)}`);
    line();
  }

  if (plan.taskSet.skipped.length) {
    line(`<details><summary>Skipped upgrades (${plan.taskSet.skipped.length})</summary>`);
    line();
    for (const s of plan.taskSet.skipped) line(`- ${s.label} ${s.step}: ${s.reason}`);
    line();
    line(`</details>`);
  }

  return out.join("\n");
}
