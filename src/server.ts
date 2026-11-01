// Web UI + JSON API. `bun run dev` for hot reload, `bun start` for production.

import { serve } from "bun";
import index from "../web/index.html";
import { resolve, sep } from "node:path";
import { CATEGORIES, Catalog, PACKAGE_DIR } from "./catalog";
import { DEFAULTS, ITEM_KEYS, resolveConfig } from "./config";
import { ITEMS, makePlan } from "./plan";
import { buildTasks } from "./tasks";
import { toEpochMin } from "./time";
import { buildPlanView } from "./view";
import { parseVillage } from "./village";

const catalog = await Catalog.load();
const IMAGES_DIR = resolve(PACKAGE_DIR, "images");

/** Categories that are always skipped, so the UI doesn't offer them. */
const ALWAYS_SKIPPED = new Set(["crafted-defenses", "pets"]);

export interface Meta {
  defaults: typeof DEFAULTS;
  categories: string[];
  items: { key: string; label: string; kind: string }[];
}

export interface VillageSummary {
  tag: string;
  townHall: number;
  builders: number;
  exportedAt: string;
  apprenticeLevel: number;
  labAssistantLevel: number;
  categories: { category: string; upgrades: number; durMin: number }[];
  /** Everything with upgrades left, for the "skip by name" suggestions. */
  names: { name: string; category: string; upgrades: number; durMin: number }[];
}

const badRequest = (e: unknown) =>
  Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });

const server = serve({
  routes: {
    "/*": index,

    // Pictures from clash-of-clans-data (WebP files despite the .png names).
    "/img/*": async (req) => {
      const rel = decodeURIComponent(new URL(req.url).pathname.slice("/img/".length));
      const path = resolve(IMAGES_DIR, rel);
      if (!path.startsWith(IMAGES_DIR + sep)) return new Response("Not found", { status: 404 });
      const file = Bun.file(path);
      if (!(await file.exists())) return new Response("Not found", { status: 404 });
      const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      const isWebp = String.fromCharCode(...head) === "RIFF";
      return new Response(file, {
        headers: {
          "Content-Type": isWebp ? "image/webp" : file.type,
          "Cache-Control": "public, max-age=86400",
        },
      });
    },

    "/api/meta": {
      GET: () =>
        Response.json({
          defaults: DEFAULTS,
          categories: CATEGORIES.filter((c) => !ALWAYS_SKIPPED.has(c)),
          items: ITEM_KEYS.map((key) => ({ key, label: ITEMS[key].label, kind: ITEMS[key].kind })),
        } satisfies Meta),
    },

    "/api/village": {
      async POST(req) {
        try {
          const { village: raw } = (await req.json()) as { village: unknown };
          const village = parseVillage(raw, catalog);
          const { tasks } = buildTasks(village, catalog, {
            excludeCategories: new Set(),
            excludeNames: [],
            discount: DEFAULTS.event.discount,
            elapsedMin: 0,
          });
          const byCategory = new Map<string, { upgrades: number; durMin: number }>();
          const byName = new Map<string, VillageSummary["names"][number]>();
          for (const t of tasks) {
            if (t.ongoing) continue;
            const n = byName.get(t.name) ?? { name: t.name, category: t.category, upgrades: 0, durMin: 0 };
            n.upgrades++;
            n.durMin += t.durMin;
            byName.set(t.name, n);
            const key = t.supercharge ? "supercharges" : t.category;
            const c = byCategory.get(key) ?? { upgrades: 0, durMin: 0 };
            c.upgrades++;
            c.durMin += t.durMin;
            byCategory.set(key, c);
          }
          return Response.json({
            tag: village.tag,
            townHall: village.townHall,
            builders: village.builders,
            exportedAt: new Date(toEpochMin(village.timestamp) * 60_000).toISOString(),
            apprenticeLevel: village.apprentice?.level ?? 0,
            labAssistantLevel: village.labAssistant?.level ?? 0,
            categories: [...byCategory].map(([category, c]) => ({ category, ...c })),
            names: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
          } satisfies VillageSummary);
        } catch (e) {
          return badRequest(e);
        }
      },
    },

    "/api/plan": {
      async POST(req) {
        try {
          const { village: raw, config: user } = (await req.json()) as { village: unknown; config: object };
          const config = resolveConfig({ ...user, village: "(uploaded)" });
          const plan = makePlan(config, parseVillage(raw, catalog), catalog);
          return Response.json(buildPlanView(plan));
        } catch (e) {
          return badRequest(e);
        }
      },
    },
  },

  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
});

console.log(`Hammer Jam planner running at ${server.url}`);
