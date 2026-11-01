import { fmtDuration } from "./time";
import type { PlanView, ScheduleRow, TaskRef } from "./view";

const fmtNum = (n: number) => n.toLocaleString("en-US");
const taskName = (t: TaskRef) => `**${t.label}** ${t.step}`;
export const sourcesText = (sources: PlanView["items"][number]["sources"]) =>
  sources
    .map((s) => `${s.count} ${s.source}${s.cost != null ? ` (${fmtNum(s.cost)} ${s.currency})` : ""}`)
    .join(" · ");
const spentText = (spent: PlanView["spent"]) => spent.map((s) => `${fmtNum(s.amount)} ${s.label}`).join(", ");

function rowText(r: ScheduleRow): string {
  switch (r.kind) {
    case "start":
      return `▶ ${r.actor}: start ${taskName(r.task)} (${fmtDuration(r.durMin)}${r.gems ? `, ${fmtNum(r.gems)} gems` : ""}) → done ${r.doneAt ?? "?"}`;
    case "overnight":
      return `⚠ ${r.actor}: ${taskName(r.task)} finishes overnight`;
    case "potion":
      return `🧪 Drink **${r.count}× ${r.item}** (${r.sources}), boost until ${r.until}`;
    case "helper":
      return `👷 Assign ${r.helper} to ${taskName(r.task)}`;
    case "hammer":
      return `🔨 Use **${r.item}** on ${taskName(r.task)}`;
    case "book":
      return `📖 Start ${taskName(r.task)} and finish it with **${r.item}**`;
  }
}

export function renderMarkdown(v: PlanView): string {
  const out: string[] = [];
  const line = (s = "") => out.push(s);

  line(`# Hammer Jam plan for ${v.tag} (TH${v.townHall})`);
  line();
  line(`- Planned from **${v.start}** until the event ends **${v.end}** (${v.timezone})`);
  line(`- Awake window: ${v.awake.from}–${v.awake.to}. Every start/finish/item below falls inside it.`);
  line(`- Builders: ${v.builders}, plus 1 lab (pets aren't planned)`);
  if (v.freeBy) line(`- Builders and lab must be free by **${v.freeBy}**`);
  if (v.excluded.length) line(`- Excluded: ${v.excluded.join(", ")}`);
  if (v.neverUse.length) line(`- Never used: ${v.neverUse.join(", ")}`);
  line();

  line(`## Summary`);
  line();
  line(`| Queue | Upgrades planned | Started before event end | Not started | Idle while awake | Idle overnight | Last finish |`);
  line(`|---|---|---|---|---|---|---|`);
  for (const q of v.queues)
    line(
      `| ${q.name} | ${q.planned} | ${q.started} | ${q.unstarted} (${fmtDuration(q.unstartedMin)}) | ${fmtDuration(q.idleAwakeMin)} | ${fmtDuration(q.nightIdleMin)} | ${q.lastFinish ?? "–"}${v.freeBy ? (q.freeInTime ? " ✅" : " ⚠ after free-by") : ""} |`,
    );
  line();

  line(`## Special items`);
  line();
  if (!v.items.length && !v.goblins.length) line(`No special items used.`);
  for (const i of v.items) line(`- **${i.count}× ${i.label}**: ${sourcesText(i.sources)}`);
  for (const g of v.goblins) line(`- ${g.name} hired for ${g.upgrades} upgrade(s): ${fmtNum(g.gems)} gems`);
  if (v.spent.length) line(`- **Total spent:** ${spentText(v.spent)}`);
  line();

  if (v.shortfall) {
    line(`### Not enough to start everything`);
    line();
    if (!v.shortfall.items.length) {
      line(`More gems or medals wouldn't help: the upgrades below can't start in time, usually because they`);
      line(`wait for earlier levels of the same building. Consider skipping them or unlocking books/hammers.`);
    } else {
      line(`With unlimited gems and medals (still never using the items above), you would additionally need:`);
      line();
      for (const i of v.shortfall.items) line(`- ${i.count}× ${i.label}`);
      line(
        `- Total spend would be ${spentText(v.shortfall.spent)}${v.shortfall.stillUnstartedMin ? ` (still ${fmtDuration(v.shortfall.stillUnstartedMin)} of upgrades not started)` : ""}`,
      );
    }
    line();
  }

  line(`## Schedule`);
  for (const day of v.days) {
    line();
    line(`### ${day.label}`);
    line();
    for (const r of day.rows) line(`- \`${r.time}\` ${rowText(r)}`);
  }
  line();

  if (v.unstarted.length) {
    line(`## Not started before the event ends`);
    line();
    for (const t of v.unstarted) line(`- ${taskName(t)} (${fmtDuration(t.fullDurMin)} at full price)`);
    line();
  }

  if (v.walls.length) {
    line(`## Walls (instant, no builder needed)`);
    line();
    for (const w of v.walls)
      line(
        `- ${w.count}× level ${w.level} → ${w.maxLevel}: ${fmtNum(w.count * w.costEach)} ${w.resource} (${fmtNum(w.costEach)} each${w.goldPassReduction ? `, with the ${Math.round(w.goldPassReduction * 100)}% Gold Pass builder boost: upgrade them once it's active` : ""})`,
      );
    line();
  }

  if (v.resources.length) {
    line(`## Resources needed (Hammer Jam and Gold Pass discounts at each start; walls not included)`);
    line();
    for (const r of v.resources) line(`- ${r.resource}: ${fmtNum(r.amount)}`);
    line();
  }

  if (v.skipped.length) {
    line(`<details><summary>Skipped upgrades (${v.skipped.length})</summary>`);
    line();
    for (const s of v.skipped) line(`- ${s.label} ${s.step}: ${s.reason}`);
    line();
    line(`</details>`);
  }

  return out.join("\n");
}
