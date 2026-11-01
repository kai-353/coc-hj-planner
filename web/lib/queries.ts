import { keepPreviousData, QueryClient, queryOptions, useQuery } from "@tanstack/react-query";
import { createPlan, getMeta, summarizeVillage } from "./api";

export const queryClient = new QueryClient({
  defaultOptions: {
    // Plans are deterministic for a given input, so cached results never go stale.
    queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false },
  },
});

/** Exports are identified by tag + export time; the full JSON is too big for a query key. */
const villageKey = (village: unknown) => {
  const v = village as { tag?: string; timestamp?: number } | null;
  return v ? `${v.tag}@${v.timestamp}` : null;
};

export const metaQuery = queryOptions({
  queryKey: ["meta"],
  queryFn: ({ signal }) => getMeta(signal),
});

export const villageQuery = (village: unknown) =>
  queryOptions({
    queryKey: ["village", villageKey(village)],
    queryFn: ({ signal }) => summarizeVillage(village, signal),
  });

export const useMeta = () => useQuery(metaQuery);

export const useVillageSummary = (village: unknown) =>
  useQuery({ ...villageQuery(village), enabled: village != null });

/** The plan for the given inputs; keeps showing the previous plan while a new one is computed. */
export const usePlan = (village: unknown, config: object | null) =>
  useQuery({
    queryKey: ["plan", villageKey(village), config],
    queryFn: ({ signal }) => createPlan(village, config!, signal),
    enabled: village != null && config != null,
    placeholderData: keepPreviousData,
  });
