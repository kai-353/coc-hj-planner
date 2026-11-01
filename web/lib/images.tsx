import { Medal } from "lucide-react";
import { cn } from "@/lib/utils";

// Pictures from clash-of-clans-data's images/other. The package has none for League or Raid Medals,
// so those fall back to a generic medal icon.
const CURRENCY_IMAGE: Record<string, string> = { gems: "/img/other/gem.png" };

export const RESOURCE_IMAGE: Record<string, string> = {
  Gold: "/img/other/gold.png",
  Elixir: "/img/other/elixir.png",
  "Dark Elixir": "/img/other/dark-elixir.png",
};

/** Icon for "gems" | "leagueMedals" | "raidMedals". */
export function CurrencyIcon({ currency, className }: { currency: string; className?: string }) {
  const src = CURRENCY_IMAGE[currency];
  return src ? (
    <img src={src} alt="" className={cn("shrink-0 object-contain", className)} />
  ) : (
    <Medal className={cn("shrink-0 text-muted-foreground", className)} aria-hidden />
  );
}
