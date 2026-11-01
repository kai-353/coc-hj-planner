# coc-hj-planner

Plans a Clash of Clans **Hammer Jam** for one Home Village: which upgrade each builder, the lab and the
pet house should start when, and when to use potions, helpers and the Goblin Builder/Researcher, so that
as much as possible is *started* before the event ends, with as few special items as possible.

Game data (levels, times, costs, TH requirements) comes from the
[`clash-of-clans-data`](https://www.npmjs.com/package/clash-of-clans-data) package.

## Web app

```bash
bun install
bun run dev        # http://localhost:3000 with hot reload (bun start for production)
```

Load your village export, fill in your inventory, tick what to skip and hit **Generate plan**. Settings
and the last export are remembered in the browser. The schedule dims past actions and can jump to the
next one, so you can keep it open during the event.

The UI lives in `web/` (React + Tailwind + shadcn/ui, add components with
`bunx --bun shadcn@latest add <name>`). `src/server.ts` serves it with a small JSON API:
`GET /api/meta`, `POST /api/village` and `POST /api/plan` (returns the `PlanView` from `src/view.ts`).

## CLI

```bash
bun run plan                       # reads planner.config.json, writes plan.md
bun run plan -c other.json -o out.md
bun run plan --remaining           # list what's left to upgrade and exit
bun test
```

1. Export your village in-game (Settings → More Settings → Data Export) and save the JSON in this folder.
2. Edit `planner.config.json`: point `village` at the export, fill in `inventory`, choose exclusions.
3. Run `bun run plan` and follow `plan.md`. Re-export and re-run whenever reality drifts from the plan.

## Config (`planner.config.json`)

| Key | Meaning |
|---|---|
| `village` | Path to the export JSON |
| `timezone`, `awake.from`, `awake.to` | When you can act. Everything is scheduled inside this window. |
| `event.start`, `event.end`, `event.discount` | Hammer Jam window (2026: 1 Nov to 16 Nov 08:00 GMT) and time/cost multiplier (0.5) |
| `planStart` | Optional ISO time to plan from (defaults to the export timestamp) |
| `inventory` | Owned items plus `gems`, `leagueMedals`, `raidMedals`. Item keys: `builderPotion`, `researchPotion`, `bookOfBuilding`, `bookOfHeroes`, `bookOfFighting`, `bookOfSpells`, `bookOfEverything`, `hammerOfBuilding`, `hammerOfHeroes`, `hammerOfFighting`, `hammerOfSpells` |
| `neverUse` | Items never used or bought. Defaults to all books and hammers (saved for the next Town Hall). |
| `exclude.categories` | Any of `town-hall`, `defenses`, `traps`, `resources`, `army`, `other`, `guardians`, `heroes`, `troops`, `spells`, `siege-machines`, `supercharges` |
| `exclude.names` | Names to skip, e.g. `"Gold Storage"` (case, spaces and punctuation are ignored) |
| `goblinGemsPerDay` | Goblin Builder / Researcher price (40 gems per day of upgrade time); `null` disables them |
| `value` | Gem-equivalent "price" of each item/currency. The planner minimises the total value spent. |
| `shop` | What can be bought, where and for how much (League Shop / Raid Medal Trader), with optional `limit`, `limitPerWeek` and `cooldownDays` |
| `shopWeekReset` | Any moment the weekly shop limits reset (Trader: Tuesdays 08:00 UTC) |
| `builders` | Override the builder count (default: Builder's Huts + B.O.B) |

Crafted defenses are always skipped because they're replaced each crafting season.

## How it plans

- Every upgrade level is a task with prerequisites: the previous level, plus Lab or Hero Hall
  levels. Times and costs get the event discount.
- `src/sim.ts` simulates each queue (6 builders + Goblin Builder, lab + Goblin Researcher)
  minute by minute. Upgrades only start while you're awake. It prefers upgrades that will finish inside
  the awake window and before the event ends, and keeps the longest ones for last, since they may
  finish after the event at the discounted price.
- `src/plan.ts` greedily adds whichever item buys the most upgrade time per unit of `value` (owned
  items, shop purchases, goblin hires) until everything starts or the budget runs out. It then removes
  anything that wasn't needed. If the budget falls short, the report also says what would close the gap.
