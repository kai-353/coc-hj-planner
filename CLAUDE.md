# coc-hj-planner

Hammer Jam upgrade scheduler for Clash of Clans (see README.md for usage and architecture).
Runtime is **Bun** (Node is not installed): `bun run dev` (web app), `bun run plan` (CLI), `bun test`,
`bunx tsc --noEmit -p .`.

- `src/` is the planner (Bun-only APIs; runs on the server). `src/view.ts` is the JSON view both the
  Markdown report and the UI render. `src/server.ts` is the Bun.serve web server + API.
- `web/` is the React + shadcn/ui frontend (`@/*` → `web/*`). It may import *types* from `src/`, and
  runtime code only from browser-safe modules (e.g. `src/time.ts`).
- Frontend state lives in `web/providers/planner-provider.tsx` (`usePlanner()` / `useReadyPlanner()`):
  settings, uploaded village, debouncing, localStorage. All API calls go through TanStack Query hooks
  in `web/lib/queries.ts`; `App.tsx` is layout only. Don't add API state to components.
- Pictures come from `clash-of-clans-data` (`levels[n].images.normal`, or `images.icon` for troops,
  spells, heroes, pets); they're WebP despite `.png` names and are served under `/img/` by
  `src/server.ts`. Tasks carry the target level's picture.
- Chart colours are the `--viz-*` tokens in `web/index.css` (validated with the dataviz palette
  checker for light and dark); the schedule timeline is `web/components/timeline.tsx`.
- Adding shadcn components: `bunx --bun shadcn@latest add <name>`. The CLI has written
  `import { cn } from "cn"` before; fix it to `@/lib/utils`.
- Commit regularly in small steps.

## User goals and preferences

- Max the base during Hammer Jam while spending as few special items as possible.
- Builders and the lab should never sit idle: upgrades should finish between **09:00 and 23:00
  Europe/Amsterdam**, and every action (start, potion, helper) happens inside that window.
- **Builders and lab must be free when Hammer Jam ends** (configurable `freeBy`, default = event end)
  so the user can start TH19 and its new upgrades right away: every upgrade must *finish* by then,
  not just start. An upgrade only starts if it finishes by `freeBy` at normal speed.
- **Books and hammers are saved for the TH19 release.** Never use them by default (`neverUse`).
- **Gems are not for finishing upgrades.** They are only for the Goblin Builder / Goblin Researcher.
- Exclude non-permanent upgrades: crafted defenses are always skipped (they rotate each crafting season).
- Storage caps of magic items don't matter for planning.
- **Pets are not planned.** The only speed-up is pet potions (bought with gems, a few from the Raid
  Medal Trader), so there is nothing to optimise. Pet upgrades are skipped with "pets aren't planned".
- The user wants to choose categories to skip (e.g. siege machines, supercharges, which in-game are
  also called "overclocks"). Name exclusions match entity names ignoring case/spaces/punctuation
  ("cloneSpell" = "Clone Spell").

## Hammer Jam

- 2026 edition: **1 Nov – 16 Nov 08:00 GMT** (= 09:00 Amsterdam). With a 23:00 bedtime, the last
  practical start is Sun 15 Nov 23:00.
- Home Village upgrades paid with Gold, Elixir or Dark Elixir cost **50% less and take 50% less time**
  (TH3+). This covers buildings, traps, heroes, guardians, lab research, pets and supercharges.
- The discount is locked in **when an upgrade starts**. Starting before the end is what matters; it may
  finish after the event. So the longest upgrades go last, one per builder.
- Upgrades already running when the event starts keep their old (full) timer.

## Magic items, helpers and boosts

| Item | Effect | Notes / prices (configurable, verify in game) |
|---|---|---|
| Builder Potion | All builders 10× speed for 1 h → each busy builder gains 9 h | League Shop 30 medals; ~285 gems |
| Research Potion | Lab 24× for 1 h → +23 h | League Shop 20 medals; Raid Trader 200 raid medals (**max 3 per week**); ~120 gems |
| Pet Potion | Pet House 24× for 1 h → +23 h | Raid Trader 200 raid medals; ~120 gems |
| Book of Building / Fighting / Spells / Heroes | Instantly finish an *ongoing* upgrade of that type (Heroes also covers pets) | 925 / 925 / 925 / 500 gems. Saved for TH19. |
| Book of Everything | Finish any ongoing upgrade | Not purchasable. Saved for TH19. |
| Hammer of Building / Fighting / Spells / Heroes | Upgrade one item one level instantly, no builder or resources | League Shop 120 (Heroes 165) medals, 7-day cooldown. Saved for TH19. |
| Builder's Apprentice (helper) | Lvl N adds N h of progress to one builder upgrade during 1 h; ~23 h cooldown | Export: helper `93000000`, `helper_cooldown` in seconds |
| Lab Assistant (helper) | Same for research | Export: helper `93000001` |
| Goblin Builder / Goblin Researcher | Extra temporary builder / researcher, **40 gems per day** of upgrade time | In the lab this doubles throughput on top of the halved times (4× normal pace) |
| Gem finishing | 1 min = 1 gem, 1 h = 20, 1 d = 260, 7 d = 1000 (interpolated) | `calculators().gems().cost()` in the package. Not used, per user preference. |

- **Potions stack**: drinking k at once extends the boost to k hours ("Drink 3× Builder Potion").
  There is no preferred time of day: the planner optimises builder/lab uptime with as few items as
  possible. A batch is drunk when it pulls finishes out of the night (so the next upgrade starts before
  bed) and otherwise potions are spread evenly; back-to-back drinks are merged into one batch. Boost on
  an upgrade that finishes while asleep is wasted.
- The Raid Medal Trader's weekly limits reset **Tuesdays 08:00 UTC** (`shopWeekReset`, `limitPerWeek`).
- Nothing can start after the last awake moment before the event ends, so progress after it doesn't
  help; an upgrade only "fits" if it ends before that moment.
- Upgrade chains (e.g. a guardian's 4 levels) are scheduled by critical path so they start early.
- The user doesn't care about guardians (excluded in their config).
- **Gold Pass** (the user has it): builder & research time boost of 10% → 15% → 20% during the season,
  stacking multiplicatively with Hammer Jam (0.5 × 0.8 = 0.4, "60% off"). Locked in at upgrade start.
  Tiers unlock with Gold Pass **points**. Assume the user always has the maximum points attainable
  by each day: max **110 points/day** (bonus included), **440 points on 1 Nov 2026** (taken to include
  that day's points). A tier unlocks at the daily reset (08:00 UTC) that brings the maximum to its
  threshold (`src/goldpass.ts`). Research tiers confirmed: 10% at 20, **15% at 580, 20% at 1000**
  points. Builder tier thresholds (10/640/1060) are still unconfirmed placeholders.
  Progress is valued in full-price minutes, so boosting more-discounted upgrades counts for more.
- The user prefers using potions sooner rather than later (even pacing over the event).
- Potions drunk before the 15%/20% Gold Pass tiers are timing potions (they keep builders/lab busy
  by avoiding overnight idle). Holding them until the best tier (`potionPacing: "strict"`) was
  measured to cost more (2026 export: +10 research potions, +230 League Medals, +15 h idle).
- Owned items are always used before buying the same item.

Assumptions in the model that are worth verifying in game: potions also speed up the goblin's upgrade;
the Apprentice/Assistant can't be put on the goblin's upgrade; the helper cooldown is 23 h.

## Village export format (`base_export_*.json`)

- `timestamp`: Unix seconds of the export. `buildings`, `traps`, `units` (troops), `spells`,
  `siege_machines`, `heroes`, `pets`, `guardians`: entries `{ data: <id>, lvl, cnt? }`.
  Fields ending in `2` (`buildings2`, …) are the Builder Base, which is ignored here.
- `cnt` groups identical instances. An entry with `timer` (seconds left) is one instance that is currently
  upgrading from `lvl` to `lvl + 1`. It's listed separately from the `cnt` group.
- `extra: true` means the upgrade runs on the Goblin Builder/Researcher. `helper_recurrent: true` means
  the Builder's Apprentice is assigned to it.
- `gear_up: 1` marks a geared-up building. Supercharge levels are probably a `supercharge` field
  (not seen in an export yet).
- Crafting Station (`1000097`) has `types[].modules[]` with module ids (`102000xxx`).
- `helpers`: `93000000` Builder's Apprentice, `93000001` Lab Assistant, `93000002` Prospector,
  `93000003` Alchemist. `boosts.lab_boost` / `clocktower_cooldown` are seconds.
- Walls (`1000010`) take no builder time, so they're listed separately in the report.
- Builder count = Builder's Huts (`1000015`, `cnt`) + 1 if B.O.B's Hut (`1000064`) exists.
- `coc_mapping.json` maps ids to names (hand-made; the package is the source of truth).

## `clash-of-clans-data` package

- Data files live at `node_modules/clash-of-clans-data/data/home/<category>/<name>.json` and are keyed
  by `dataId` (same ids as the export). `src/catalog.ts` reads them directly because the query API
  doesn't expose every namespace uniformly.
- Levels have `buildTime|upgradeTime|researchTime` (`{days,hours,minutes,seconds}`), matching cost
  fields, and `townHallRequired`, `laboratoryRequired`, `petHouseLevelRequired`, `heroHallLevelRequired`.
- **Supercharge levels** are appended after the normal levels with `supercharge: true`, numbered from 1
  again. They require the building at max normal level and TH18.
- Crafted defenses: `modules[].upgrades[]` with module `dataId`s. `availablePerTownHall` gives counts,
  with `countAfterMerges` for merged buildings.
