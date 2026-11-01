import { describe, expect, test } from "bun:test";
import { Catalog } from "../src/catalog";
import { DEFAULTS } from "../src/config";
import { makePlan, QUEUES } from "../src/plan";
import { buildTasks } from "../src/tasks";
import { Clock, parseIso } from "../src/time";
import { parseVillage } from "../src/village";

const catalog = await Catalog.load();
const village = parseVillage(await Bun.file(`${import.meta.dir}/../base_export_26-11-01.json`).json(), catalog);

describe("Clock", () => {
  const clock = new Clock("Europe/Amsterdam", 9 * 60, 23 * 60);

  test("awake window uses local time", () => {
    expect(clock.isAwake(parseIso("2026-11-02T08:00:00Z"))).toBe(true); // 09:00 CET
    expect(clock.isAwake(parseIso("2026-11-02T07:59:00Z"))).toBe(false);
    expect(clock.isAwake(parseIso("2026-11-02T22:00:00Z"))).toBe(true); // 23:00 CET
    expect(clock.isAwake(parseIso("2026-11-02T22:01:00Z"))).toBe(false);
  });

  test("nextAwake jumps to 09:00 local", () => {
    expect(clock.nextAwake(parseIso("2026-11-02T23:30:00Z"))).toBe(parseIso("2026-11-03T08:00:00Z"));
  });
});

describe("village", () => {
  test("parses the export", () => {
    expect(village.townHall).toBe(18);
    expect(village.builders).toBe(6);
    expect(village.unknownIds).toEqual([]);
  });
});

describe("plan invariants", () => {
  const plan = makePlan(
    {
      ...DEFAULTS,
      village: "",
      inventory: { builderPotion: 5, researchPotion: 5, gems: 3000, leagueMedals: 400, raidMedals: 3000 },
      exclude: { categories: ["siege-machines", "supercharges"], names: [] },
    },
    village,
    catalog,
  );

  test("every action happens while awake and before the event ends", () => {
    for (const q of QUEUES)
      for (const e of plan.results[q].events) {
        if (e.kind === "finish") continue;
        expect(plan.clock.isAwake(e.t)).toBe(true);
        expect(e.t).toBeLessThan(plan.end);
      }
  });

  test("upgrades start only after their prerequisites finish", () => {
    const done = new Map<string, number>();
    for (const q of QUEUES) for (const [id, t] of plan.results[q].doneAt) done.set(id, t);
    for (const q of QUEUES)
      for (const task of plan.simConfigs[q].tasks) {
        const started = plan.results[q].startedAt.get(task.id);
        if (started == null) continue;
        for (const d of task.deps) expect(done.get(d)).toBeLessThanOrEqual(started);
      }
  });

  test("respects budgets and never uses books or hammers", () => {
    expect(plan.spent.gems).toBeLessThanOrEqual(3000);
    expect(plan.spent.leagueMedals).toBeLessThanOrEqual(400);
    expect(plan.spent.raidMedals).toBeLessThanOrEqual(3000);
    expect(plan.acquisitions.some((a) => a.item.startsWith("book") || a.item.startsWith("hammer"))).toBe(false);
  });

  test("crafted defenses are never planned", () => {
    expect(plan.taskSet.tasks.some((t) => t.category === "crafted-defenses")).toBe(false);
  });
});

describe("shop limits and potions", () => {
  const plan = makePlan(
    {
      ...DEFAULTS,
      village: "",
      inventory: { builderPotion: 4, researchPotion: 1, gems: 6000, leagueMedals: 2000, raidMedals: 5000 },
      exclude: { categories: ["siege-machines", "supercharges", "guardians"], names: [] },
    },
    village,
    catalog,
  );

  test("raid medal research potions respect 3 per shop week", () => {
    const bought = plan.acquisitions.filter((a) => a.item === "researchPotion" && a.source === "raidMedals");
    const perWeek = new Map<number, number>();
    for (const a of bought) {
      const week = Math.floor((a.availableAt - parseIso(DEFAULTS.shopWeekReset)) / (7 * 24 * 60));
      perWeek.set(week, (perWeek.get(week) ?? 0) + 1);
    }
    for (const n of perWeek.values()) expect(n).toBeLessThanOrEqual(3);
  });

  test("potions are drunk in batches and only once available", () => {
    for (const q of QUEUES)
      for (const e of plan.results[q].events) {
        if (e.kind !== "potion") continue;
        expect(e.until - e.t).toBe(e.uses.length * 60);
        for (const u of e.uses) expect(u.availableAt).toBeLessThanOrEqual(e.t);
      }
  });

  test("Gold Pass shortens upgrades by the boost active at their start", () => {
    const steps = DEFAULTS.goldPass.map((s) => ({ from: parseIso(s.from), reduction: s.reduction }));
    const at = (t: number) => steps.findLast((s) => s.from <= t)?.reduction ?? 0;
    let checked = 0;
    for (const q of QUEUES)
      for (const e of plan.results[q].events) {
        if (e.kind !== "start") continue;
        expect(e.durMin).toBe(Math.round(e.task.durMin * (1 - at(e.t))));
        checked++;
      }
    expect(checked).toBeGreaterThan(0);
  });

  test("owned items are used before buying the same item", () => {
    for (const key of ["builderPotion", "researchPotion"] as const) {
      const bought = plan.acquisitions.some((a) => a.item === key && a.source !== "owned");
      const owned = plan.acquisitions.filter((a) => a.item === key && a.source === "owned").length;
      if (bought) expect(owned).toBe({ builderPotion: 4, researchPotion: 1 }[key]);
    }
  });

  test("back-to-back potion drinks are merged into one batch", () => {
    for (const q of QUEUES) {
      const drinks = plan.results[q].events.filter((e) => e.kind === "potion");
      for (let i = 1; i < drinks.length; i++) expect(drinks[i]!.t).not.toBe(drinks[i - 1]!.until);
    }
  });

  test("name exclusions ignore case, spaces and punctuation", () => {
    const { tasks } = buildTasks(village, catalog, {
      excludeCategories: new Set(),
      excludeNames: ["cloneSpell", "GOLD storage"],
      discount: 0.5,
      elapsedMin: 0,
    });
    const names = new Set(tasks.map((t) => t.name));
    expect(names.has("Clone Spell")).toBe(false);
    expect(names.has("Gold Storage")).toBe(false);
    expect(names.has("Elixir Storage")).toBe(true);
  });
});
