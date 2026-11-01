import { parseArgs } from "node:util";
import { CATEGORIES, Catalog } from "./catalog";
import { loadConfig } from "./config";
import { makePlan, QUEUES } from "./plan";
import { renderMarkdown } from "./report";
import { buildPlanView } from "./view";
import { buildTasks } from "./tasks";
import { fmtDuration } from "./time";
import { parseVillage } from "./village";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    config: { type: "string", short: "c", default: "planner.config.json" },
    out: { type: "string", short: "o", default: "plan.md" },
    remaining: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(`Usage: bun run plan [-c planner.config.json] [-o plan.md] [--remaining]

  --remaining   only list what is left to upgrade (respecting exclusions) and exit
Categories you can exclude: ${CATEGORIES.join(", ")}`);
  process.exit(0);
}

const config = await loadConfig(values.config!);
const catalog = await Catalog.load();
const village = parseVillage(await Bun.file(config.village).json(), catalog);
if (village.unknownIds.length) console.warn(`Unknown data ids in export (ignored): ${village.unknownIds.join(", ")}`);

if (values.remaining) {
  const { tasks } = buildTasks(village, catalog, {
    excludeCategories: new Set(config.exclude.categories),
    excludeNames: config.exclude.names,
    discount: config.event.discount,
    elapsedMin: 0,
  });
  for (const q of QUEUES) {
    const qt = tasks.filter((t) => t.queue === q && !t.ongoing);
    console.log(`\n${q}: ${qt.length} upgrades, ${fmtDuration(qt.reduce((a, t) => a + t.durMin, 0))} discounted work`);
    for (const t of qt) console.log(`  [${t.category}] ${t.label} ${t.step}  ${fmtDuration(t.durMin)}`);
  }
  process.exit(0);
}

const t0 = performance.now();
const plan = makePlan(config, village, catalog);
await Bun.write(values.out!, renderMarkdown(buildPlanView(plan)));

for (const q of QUEUES) {
  const r = plan.results[q];
  console.log(
    `${plan.simConfigs[q].slotName.padEnd(10)} started ${String(r.startedAt.size).padStart(3)}, not started ${r.unstarted.length} (${fmtDuration(r.unstartedMin)})`,
  );
}
console.log(`Spent: ${JSON.stringify(plan.spent)}; owned items used: ${JSON.stringify(plan.ownedUsed)}`);
console.log(`Wrote ${values.out} in ${Math.round(performance.now() - t0)} ms`);
