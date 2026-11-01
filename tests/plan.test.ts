import { describe, expect, test } from "bun:test";
import { Catalog } from "../src/catalog";
import { DEFAULTS } from "../src/config";
import { makePlan, QUEUES } from "../src/plan";
import { buildTasks } from "../src/tasks";
import { boostAt, boostSteps, tierUnlock } from "../src/goldpass";
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

describe("Clock with an awake window past midnight (09:00 until 01:00)", () => {
  const clock = new Clock("Europe/Amsterdam", 9 * 60, 60);
  // Amsterdam is UTC+1 in November.
  const at = (utc: string) => parseIso(`2026-11-02T${utc}:00Z`);

  test("awake late evening and just after midnight, asleep in the early morning", () => {
    expect(clock.isAwake(at("08:00"))).toBe(true); // 09:00
    expect(clock.isAwake(at("22:30"))).toBe(true); // 23:30
    expect(clock.isAwake(parseIso("2026-11-03T00:00:00Z"))).toBe(true); // 01:00
    expect(clock.isAwake(parseIso("2026-11-03T00:01:00Z"))).toBe(false); // 01:01
    expect(clock.isAwake(at("07:59"))).toBe(false); // 08:59
  });

  test("next awake / asleep moments", () => {
    expect(clock.nextAwake(at("03:00"))).toBe(at("08:00"));
    expect(clock.nextAsleep(at("19:00"))).toBe(parseIso("2026-11-03T00:01:00Z"));
  });

  test("equal times mean always awake", () => {
    const always = new Clock("Europe/Amsterdam", 9 * 60, 9 * 60);
    expect(always.isAwake(at("03:00"))).toBe(true);
    expect(always.nextAsleep(at("03:00"))).toBe(Infinity);
  });

  test("a plan with that window completes and acts only while awake", () => {
    const plan = makePlan(
      {
        ...DEFAULTS,
        village: "",
        awake: { from: "09:00", to: "01:00" },
        inventory: { builderPotion: 4, researchPotion: 1, gems: 5751, leagueMedals: 2345, raidMedals: 3356 },
        exclude: { categories: ["siege-machines", "supercharges", "guardians"], names: [] },
      },
      village,
      catalog,
    );
    for (const q of QUEUES)
      for (const e of plan.results[q].events) if (e.kind !== "finish") expect(plan.clock.isAwake(e.t)).toBe(true);
    expect(QUEUES.some((q) => plan.results[q].events.some((e) => e.kind !== "finish" && plan.clock.minuteOfDay(e.t) < 60))).toBe(true);
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
    let checked = 0;
    for (const q of QUEUES) {
      const steps = boostSteps(DEFAULTS.goldPass!, q === "builder" ? "builder" : "research");
      for (const e of plan.results[q].events) {
        if (e.kind !== "start") continue;
        expect(e.durMin).toBe(Math.round(e.task.durMin * (1 - boostAt(steps, e.t))));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  test("Gold Pass tiers unlock at the daily reset that brings the maximum points to them", () => {
    const gp = { ...DEFAULTS.goldPass!, points: 440, pointsAsOf: "2026-11-01T18:33:00Z", pointsPerDay: 110 };
    expect(tierUnlock(gp, 440)).toBe(-Infinity);
    expect(tierUnlock(gp, 441)).toBe(parseIso("2026-11-02T08:00:00Z"));
    expect(tierUnlock(gp, 550)).toBe(parseIso("2026-11-02T08:00:00Z"));
    expect(tierUnlock(gp, 551)).toBe(parseIso("2026-11-03T08:00:00Z"));
    // Before the day's reset, that same day's reset is the next one.
    expect(tierUnlock({ ...gp, pointsAsOf: "2026-11-02T07:00:00Z" }, 441)).toBe(parseIso("2026-11-02T08:00:00Z"));
  });

  test("owned items are used before buying the same item", () => {
    for (const key of ["builderPotion", "researchPotion"] as const) {
      const bought = plan.acquisitions.some((a) => a.item === key && a.source !== "owned");
      const owned = plan.acquisitions.filter((a) => a.item === key && a.source === "owned").length;
      if (bought) expect(owned).toBe({ builderPotion: 4, researchPotion: 1 }[key]);
    }
  });

  test("by default every upgrade finishes by the event end (builders and lab free)", () => {
    for (const q of QUEUES) {
      expect(plan.results[q].projectedDone.size).toBe(0);
      for (const t of plan.results[q].doneAt.values()) expect(t).toBeLessThanOrEqual(plan.end);
    }
  });

  test("freeBy: null lets upgrades run past the event end", () => {
    const loose = makePlan(
      {
        ...DEFAULTS,
        village: "",
        freeBy: null,
        inventory: { builderPotion: 4, researchPotion: 1, gems: 6000, leagueMedals: 2000, raidMedals: 5000 },
        exclude: { categories: ["siege-machines", "supercharges", "guardians"], names: [] },
      },
      village,
      catalog,
    );
    expect(QUEUES.some((q) => loose.results[q].projectedDone.size > 0)).toBe(true);
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

describe("free-by with potions still to come", () => {
  test("long research can start late when potions will finish it in time (21:44 export)", async () => {
    const later = parseVillage(await Bun.file(`${import.meta.dir}/../base_export_26-11-01-2.json`).json(), catalog);
    const plan = makePlan(
      {
        ...DEFAULTS,
        village: "",
        inventory: { builderPotion: 4, researchPotion: 1, gems: 5751, leagueMedals: 2345, raidMedals: 3356 },
        exclude: { categories: ["siege-machines", "supercharges", "guardians"], names: [] },
      },
      later,
      catalog,
    );
    for (const q of QUEUES) {
      expect(plan.results[q].unstarted).toEqual([]);
      expect(plan.results[q].lateMin).toBe(0);
    }
  });

  test("potions arriving after the free-by time don't count toward finishing in time (free by 8 Nov)", async () => {
    const later = parseVillage(await Bun.file(`${import.meta.dir}/../base_export_26-11-01-2.json`).json(), catalog);
    const plan = makePlan(
      {
        ...DEFAULTS,
        village: "",
        freeBy: "2026-11-08T08:00:00Z",
        inventory: { builderPotion: 4, researchPotion: 1, gems: 5751, leagueMedals: 2345, raidMedals: 3356 },
        exclude: {
          categories: ["siege-machines", "supercharges", "guardians"],
          names: ["Clone Spell", "Recall Spell", "Earthquake Spell", "Bat Spell"],
        },
      },
      later,
      catalog,
    );
    for (const q of QUEUES) {
      expect(plan.results[q].lateMin).toBe(0);
      for (const t of [...plan.results[q].doneAt.values(), ...plan.results[q].projectedDone.values()])
        expect(t).toBeLessThanOrEqual(plan.freeBy);
    }
  });
});
