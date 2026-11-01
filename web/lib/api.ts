import type { Meta, VillageSummary } from "../../src/server";
import type { PlanView } from "../../src/view";

export type { Meta, PlanView, VillageSummary };
export type { ScheduleRow, TaskRef } from "../../src/view";

async function call<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(
    url,
    body === undefined ? { signal } : { method: "POST", body: JSON.stringify(body), signal },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const getMeta = (signal?: AbortSignal) => call<Meta>("/api/meta", undefined, signal);
export const summarizeVillage = (village: unknown, signal?: AbortSignal) =>
  call<VillageSummary>("/api/village", { village }, signal);
export const createPlan = (village: unknown, config: object, signal?: AbortSignal) =>
  call<PlanView>("/api/plan", { village, config }, signal);
