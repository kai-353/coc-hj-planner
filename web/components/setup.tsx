import { ChevronsUpDown, FileJson, Lock, LockOpen, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { fmtDuration } from "../../src/time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import type { Meta, VillageSummary } from "@/lib/api";
import { CATEGORY_LABEL, CURRENCIES, type Settings } from "@/lib/settings";
import { cn } from "@/lib/utils";

/** `debounce` marks typed input, so the plan waits until the user pauses. */
type Update = (patch: Partial<Settings>, opts?: { debounce?: boolean }) => void;

export function VillageCard({
  summary,
  onFile,
}: {
  summary: VillageSummary | null;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Village</CardTitle>
        <CardDescription>In game: Settings → More Settings → Data Export, then drop the JSON here.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) onFile(file);
          }}
          className={cn(
            "flex w-full flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground transition-colors hover:bg-muted/50",
            dragging && "border-primary bg-muted",
          )}
        >
          <Upload className="size-5" />
          {summary ? "Replace export" : "Choose or drop village export (.json)"}
        </button>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = "";
          }}
        />
        {summary && (
          <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-3 text-sm">
            <FileJson className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="space-y-1">
              <div className="font-medium">
                {summary.tag} <Badge variant="secondary">TH{summary.townHall}</Badge>
              </div>
              <div className="text-muted-foreground">
                {summary.builders} builders · Apprentice lvl {summary.apprenticeLevel} · Lab Assistant lvl{" "}
                {summary.labAssistantLevel}
              </div>
              <div className="text-muted-foreground">Exported {new Date(summary.exportedAt).toLocaleString()}</div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NumberField({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        min={0}
        inputMode="numeric"
        value={value || ""}
        placeholder="0"
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      />
    </div>
  );
}

export function InventoryCard({ meta, settings, update }: { meta: Meta; settings: Settings; update: Update }) {
  const setCount = (key: string, n: number) =>
    update({ inventory: { ...settings.inventory, [key]: n } }, { debounce: true });
  const potions = meta.items.filter((i) => i.kind === "potion");
  const saved = meta.items.filter((i) => meta.defaults.neverUse.includes(i.key as never));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Inventory</CardTitle>
        <CardDescription>
          Gems only hire the Goblin Builder and Goblin Researcher. Medals buy potions in the shops.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {potions.map((i) => (
            <NumberField key={i.key} id={i.key} label={i.label} value={settings.inventory[i.key] ?? 0} onChange={(n) => setCount(i.key, n)} />
          ))}
          {CURRENCIES.map((c) => (
            <NumberField key={c.key} id={c.key} label={c.label} value={settings.inventory[c.key] ?? 0} onChange={(n) => setCount(c.key, n)} />
          ))}
        </div>
        <Separator />
        <div className="space-y-2">
          <div className="text-sm font-medium">Books & hammers</div>
          <p className="text-xs text-muted-foreground">
            Saved for TH19 unless you unlock them. Locked items are never used or bought.
          </p>
          <div className="space-y-2">
            {saved.map((i) => {
              const allowed = settings.allowedItems.includes(i.key);
              return (
                <div key={i.key} className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    aria-label={allowed ? `Lock ${i.label}` : `Unlock ${i.label}`}
                    onClick={() =>
                      update({
                        allowedItems: allowed
                          ? settings.allowedItems.filter((k) => k !== i.key)
                          : [...settings.allowedItems, i.key],
                      })
                    }
                  >
                    {allowed ? <LockOpen className="size-4" /> : <Lock className="size-4 text-muted-foreground" />}
                  </Button>
                  <span className={cn("flex-1 text-sm", !allowed && "text-muted-foreground")}>{i.label}</span>
                  <Input
                    aria-label={`${i.label} owned`}
                    type="number"
                    min={0}
                    className="h-8 w-20"
                    disabled={!allowed}
                    value={settings.inventory[i.key] || ""}
                    placeholder="0"
                    onChange={(e) => setCount(i.key, Math.max(0, Number(e.target.value) || 0))}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ExclusionsCard({
  meta,
  summary,
  settings,
  update,
}: {
  meta: Meta;
  summary: VillageSummary | null;
  settings: Settings;
  update: Update;
}) {
  const stats = new Map(summary?.categories.map((c) => [c.category, c]));
  const toggle = (c: string, on: boolean) =>
    update({
      excludeCategories: on ? [...settings.excludeCategories, c] : settings.excludeCategories.filter((x) => x !== c),
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Skip</CardTitle>
        <CardDescription>Crafted defenses and pets are always skipped.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {meta.categories.map((c) => {
            const s = stats.get(c);
            if (summary && !s) return null;
            return (
              <label key={c} className="flex cursor-pointer items-center gap-3 rounded-md px-1 py-1 hover:bg-muted/50">
                <Checkbox
                  checked={settings.excludeCategories.includes(c)}
                  onCheckedChange={(v) => toggle(c, v === true)}
                />
                <span className="flex-1 text-sm">{CATEGORY_LABEL[c] ?? c}</span>
                {s && (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {s.upgrades} · {fmtDuration(s.durMin)}
                  </span>
                )}
              </label>
            );
          })}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Also skip by name</Label>
          <NamePicker
            options={summary?.names ?? []}
            selected={settings.excludeNames}
            onChange={(excludeNames) => update({ excludeNames })}
          />
        </div>
      </CardContent>
    </Card>
  );
}

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export function SettingsCard({ settings, update }: { settings: Settings; update: Update }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Schedule</CardTitle>
        <CardDescription>Upgrades start, and preferably finish, only while you're awake.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="awake-from" className="text-xs text-muted-foreground">
              Awake from
            </Label>
            <Input id="awake-from" type="time" value={settings.awakeFrom} onChange={(e) => update({ awakeFrom: e.target.value }, { debounce: true })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="awake-to" className="text-xs text-muted-foreground">
              Until
            </Label>
            <Input id="awake-to" type="time" value={settings.awakeTo} onChange={(e) => update({ awakeTo: e.target.value }, { debounce: true })} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="event-end" className="text-xs text-muted-foreground">
            Hammer Jam ends (your local time)
          </Label>
          <Input
            id="event-end"
            type="datetime-local"
            value={toLocalInput(settings.eventEnd)}
            onChange={(e) =>
              e.target.value && update({ eventEnd: new Date(e.target.value).toISOString() }, { debounce: true })
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="goblin" className="text-xs text-muted-foreground">
            Goblin Builder / Researcher (gems per day)
          </Label>
          <Input
            id="goblin"
            type="number"
            min={0}
            value={settings.goblinGemsPerDay}
            onChange={(e) =>
              update({ goblinGemsPerDay: Math.max(0, Number(e.target.value) || 0) }, { debounce: true })
            }
          />
        </div>
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span className="text-sm">
            Plan from now
            <span className="block text-xs text-muted-foreground">Off: plan from the export's timestamp</span>
          </span>
          <Switch checked={settings.planFromNow} onCheckedChange={(v) => update({ planFromNow: v })} />
        </label>
      </CardContent>
    </Card>
  );
}

/** Searchable multi-select of everything that still has upgrades left. */
function NamePicker({
  options,
  selected,
  onChange,
}: {
  options: VillageSummary["names"];
  selected: string[];
  onChange: (names: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const remaining = options.filter((o) => !selected.includes(o.name));

  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((name) => (
            <Badge key={name} variant="secondary" className="gap-1 pr-1">
              {name}
              <button
                type="button"
                aria-label={`Stop skipping ${name}`}
                className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                onClick={() => onChange(selected.filter((n) => n !== name))}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={!options.length}
            className="w-full justify-between font-normal text-muted-foreground"
          >
            {options.length ? "Search buildings, troops, spells…" : "Load a village export first"}
            <ChevronsUpDown className="size-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
          <Command>
            <CommandInput placeholder="Search…" />
            <CommandList>
              <CommandEmpty>Nothing left to upgrade with that name.</CommandEmpty>
              <CommandGroup>
                {remaining.map((o) => (
                  <CommandItem
                    key={o.name}
                    value={o.name}
                    onSelect={() => {
                      onChange([...selected, o.name]);
                      setOpen(false);
                    }}
                  >
                    <span className="flex-1">{o.name}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {o.upgrades} · {fmtDuration(o.durMin)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
