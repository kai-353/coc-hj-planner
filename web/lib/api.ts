import type { Meta, VillageSummary } from "../../src/server";
import type { PlanView } from "../../src/view";

export type { Meta, PlanView, VillageSummary };
export type { ScheduleRow, TaskRef } from "../../src/view";

async function call<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? undefined : { method: "POST", body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const getMeta = () => call<Meta>("/api/meta");
export const summarizeVillage = (village: unknown) => call<VillageSummary>("/api/village", { village });
export const createPlan = (village: unknown, config: object) => call<PlanView>("/api/plan", { village, config });
