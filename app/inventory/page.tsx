"use client";

import { useEffect, useMemo, useState } from "react";
import { useGameSessionContext } from "../context/GameSessionContext";

type InventoryItem = {
  id: string;
  created_at?: string;
  obtained_from?: string | null;
  item: {
    id: string;
    name: string;
    rarity: string;
    type: string;
    power_value: number;
    image_url?: string | null;
  };
};

type InventoryResponse = {
  items?: InventoryItem[];
  totalPower?: number;
  error?: string;
};

type CoreBootstrap = {
  user: {
    id: string;
    telegram_id: string;
    username: string | null;
  };
  balance: {
    user_id: string;
    soft_balance: number;
    hard_balance: number;
  };
  totalPower: number;
  level: number;
  progress: number;
};

function unwrapCore(bootstrap: any): CoreBootstrap | null {
  const core = (bootstrap && bootstrap.bootstrap) || bootstrap || null;
  if (!core || !core.user || !core.balance) return null;
  return core as CoreBootstrap;
}

type RarityFilter = "all" | "common" | "rare" | "epic" | "legendary";
type SortMode = "power_desc" | "power_asc" | "newest";

function normalizeRarity(rarity: string | null | undefined): RarityFilter {
  const r = String(rarity || "").trim().toLowerCase();
  if (r === "common" || r === "rare" || r === "epic" || r === "legendary") return r;
  return "common";
}

function rarityLabel(r: string | null | undefined) {
  return String(r || "").trim().toUpperCase() || "COMMON";
}

function rarityFxClass(r: string | null | undefined) {
  const rr = normalizeRarity(r);
  if (rr === "legendary") return "ui-rarity-legendary";
  if (rr === "epic") return "ui-rarity-epic";
  if (rr === "rare") return "ui-rarity-rare";
  return "ui-rarity-common";
}

function rarityColorVar(r: string | null | undefined) {
  const rr = normalizeRarity(r);
  if (rr === "legendary") return "var(--rarity-legendary)";
  if (rr === "epic") return "var(--rarity-epic)";
  if (rr === "rare") return "var(--rarity-rare)";
  return "var(--rarity-common)";
}

function formatCompact(n: number) {
  const x = Number.isFinite(n) ? n : 0;
  if (x >= 1_000_000_000) return `${(x / 1_000_000_000).toFixed(1)}B`;
  if (x >= 1_000_000) return `${(x / 1_000_000).toFixed(1)}M`;
  if (x >= 10_000) return `${Math.round(x / 1000)}K`;
  return `${x}`;
}

function formatDate(iso?: string) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

export default function InventoryPage() {
  const {
    loading: sessionLoading,
    error: sessionError,
    telegramId,
    bootstrap,
    isTelegramEnv,
    timedOut,
    refreshSession,
  } = useGameSessionContext() as any;

  const core = useMemo(() => unwrapCore(bootstrap), [bootstrap]);
  const hasCore = !!core;

  const [inventory, setInventory] = useState<InventoryResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const [rarityFilter, setRarityFilter] = useState<RarityFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("power_desc");

  const [selected, setSelected] = useState<InventoryItem | null>(null);

  const [showGate, setShowGate] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShowGate(true), 900);
    return () => clearTimeout(t);
  }, []);

  const handleResync = () => {
    setInventory(null);
    setSelected(null);
    refreshSession?.();
  };

  useEffect(() => {
    if (!telegramId) return;

    let cancelled = false;

    async function loadInventory() {
      try {
        setLoading(true);
        const res = await fetch(`/api/inventory?telegram_id=${encodeURIComponent(telegramId)}`);
        const data: InventoryResponse = await res.json();
        if (cancelled) return;
        setInventory(data);
      } catch (err) {
        console.error("Inventory load error:", err);
        if (!cancelled) setInventory({ error: "Request failed" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadInventory();

    return () => {
      cancelled = true;
    };
  }, [telegramId]);

  // lock scroll when modal open
  useEffect(() => {
    if (!selected) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selected]);

  const items: InventoryItem[] = inventory?.items ?? [];
  const totalPower =
    typeof inventory?.totalPower === "number" ? inventory.totalPower : core?.totalPower ?? 0;

  const filteredSortedItems = useMemo(() => {
    const base =
      rarityFilter === "all"
        ? items
        : items.filter((ui) => normalizeRarity(ui.item?.rarity) === rarityFilter);

    const copy = [...base];

    copy.sort((a, b) => {
      const ap = Number(a?.item?.power_value ?? 0);
      const bp = Number(b?.item?.power_value ?? 0);

      if (sortMode === "power_asc") return ap - bp;
      if (sortMode === "power_desc") return bp - ap;

      const at = a.created_at ? Date.parse(a.created_at) : 0;
      const bt = b.created_at ? Date.parse(b.created_at) : 0;
      return bt - at;
    });

    return copy;
  }, [items, rarityFilter, sortMode]);

  const shownCount = filteredSortedItems.length;

  const rarityOptions: { key: RarityFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "common", label: "Common" },
    { key: "rare", label: "Rare" },
    { key: "epic", label: "Epic" },
    { key: "legendary", label: "Legendary" },
  ];

  const pillBase =
    "ui-pill transition-transform duration-150 active:translate-y-[1px]";
  const pillActive =
    "border-[rgba(255,255,255,0.40)] text-[color:var(--text)] bg-[rgba(255,255,255,0.08)]";
  const pillIdle = "hover:bg-[rgba(255,255,255,0.06)]";

  // ---------- UI ----------
  if (!isTelegramEnv) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-md ui-card p-5 text-center">
          <div className="text-lg font-semibold mb-2">Open in Telegram</div>
          <div className="text-sm ui-subtle">
            This page works only inside Telegram WebApp.
          </div>
        </div>
      </main>
    );
  }

  if (!hasCore) {
    if (!showGate || sessionLoading) {
      return (
        <main className="min-h-screen flex items-center justify-center px-4">
          <div className="w-full max-w-md ui-card p-5 text-center">
            <div className="text-sm font-semibold">Loading inventory...</div>
            <div className="mt-2 text-sm ui-subtle">Syncing session.</div>
            <div className="mt-4 ui-progress">
              <div className="w-1/3 opacity-70 animate-pulse" />
            </div>
          </div>
        </main>
      );
    }

    if (timedOut || !!sessionError) {
      return (
        <main className="min-h-screen flex items-center justify-center px-4">
          <div className="w-full max-w-md ui-card p-5">
            <div className="text-lg font-semibold">
              {timedOut ? "Connection timeout" : "Couldn’t load your session"}
            </div>

            <div className="mt-2 text-sm ui-subtle">
              {timedOut
                ? "Telegram or network didn’t respond in time. Tap Re-sync to try again."
                : "Something went wrong while syncing your profile."}
            </div>

            {sessionError && (
              <div className="mt-4 p-3 rounded-[var(--r-md)] border border-[color:var(--border)] bg-[rgba(255,255,255,0.03)]">
                <div className="ui-subtitle mb-1">Details</div>
                <div className="text-xs break-words">{String(sessionError)}</div>
              </div>
            )}

            <div className="mt-6 flex flex-col gap-3">
              <button onClick={handleResync} className="ui-btn ui-btn-primary w-full">
                Re-sync
              </button>

              <div className="text-[11px] ui-subtle text-center">
                If it keeps failing, reopen the Mini App from the bot menu.
              </div>
            </div>
          </div>
        </main>
      );
    }

    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-md ui-card p-5 text-center">
          <div className="text-sm font-semibold">Loading...</div>
          <div className="mt-2 text-sm ui-subtle">Still syncing.</div>
        </div>
      </main>
    );
  }

  if (!telegramId) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-md ui-card p-5 text-center">
          <div className="text-sm font-semibold">Loading inventory...</div>
          <div className="mt-2 text-sm ui-subtle">Getting Telegram ID.</div>
          <div className="mt-4 ui-progress">
            <div className="w-1/3 opacity-70 animate-pulse" />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center pt-10 px-4 pb-28">
      <div className="w-full max-w-5xl">
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 className="ui-title text-696">Inventory</h1>
            <div className="ui-subtitle mt-2">Your drops & power</div>
          </div>

          <button onClick={handleResync} className="ui-btn ui-btn-ghost">
            Re-sync
          </button>
        </div>

        {/* KPIs */}
        <div className="ui-grid grid-cols-2 mb-5">
          <div className="ui-card p-4">
            <div className="flex items-center justify-between">
              <div className="ui-subtitle">Total Power</div>
              <span className="ui-pill">CORE</span>
            </div>
            <div className="text-3xl font-semibold mt-3 tabular-nums">
              {formatCompact(totalPower)}
            </div>
            <div className="text-xs ui-subtle mt-2">Inventory power (fallback: core power).</div>
          </div>

          <div className="ui-card p-4">
            <div className="flex items-center justify-between">
              <div className="ui-subtitle">Items</div>
              <span className="ui-pill">{shownCount}/{items.length}</span>
            </div>
            <div className="text-3xl font-semibold mt-3 tabular-nums">
              {formatCompact(items.length)}
            </div>
            <div className="text-xs ui-subtle mt-2">
              Showing: <span className="text-[color:var(--text)]">{shownCount}</span>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="ui-card p-4 mb-5">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2 justify-center">
              {rarityOptions.map((opt) => {
                const active = rarityFilter === opt.key;
                return (
                  <button
                    key={opt.key}
                    onClick={() => setRarityFilter(opt.key)}
                    className={[pillBase, active ? pillActive : pillIdle].join(" ")}
                    aria-pressed={active}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-center gap-2 flex-wrap">
              <div className="ui-subtitle">Sort</div>

              <button
                onClick={() => setSortMode("power_desc")}
                className={[pillBase, sortMode === "power_desc" ? pillActive : pillIdle].join(" ")}
                aria-pressed={sortMode === "power_desc"}
              >
                Power ↓
              </button>

              <button
                onClick={() => setSortMode("power_asc")}
                className={[pillBase, sortMode === "power_asc" ? pillActive : pillIdle].join(" ")}
                aria-pressed={sortMode === "power_asc"}
              >
                Power ↑
              </button>

              <button
                onClick={() => setSortMode("newest")}
                className={[pillBase, sortMode === "newest" ? pillActive : pillIdle].join(" ")}
                aria-pressed={sortMode === "newest"}
              >
                Newest
              </button>
            </div>
          </div>
        </div>

        {loading && (
          <div className="mb-4 ui-subtle text-sm text-center">Loading items...</div>
        )}

        {inventory?.error && (
          <div className="mb-4 ui-card p-4 border border-[rgba(255,80,80,0.35)]">
            <div className="text-sm font-semibold text-red-300">Error</div>
            <div className="mt-1 text-sm text-red-200/80 break-words">
              {inventory.error}
            </div>
          </div>
        )}

        {!loading && !inventory?.error && filteredSortedItems.length === 0 && (
          <div className="ui-card p-6 text-center">
            <div className="text-lg font-semibold">No items yet</div>
            <div className="mt-2 text-sm ui-subtle">
              Open chests to collect emblems, items, characters and pets.
            </div>
            <a href="/chest" className="ui-btn ui-btn-primary mt-4">
              Go to Chest
            </a>
          </div>
        )}

        {/* Fortnite-ish loot grid */}
        {filteredSortedItems.length > 0 && (
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {filteredSortedItems.map((ui) => {
              const rClass = rarityFxClass(ui.item?.rarity);
              const rColor = rarityColorVar(ui.item?.rarity);

              return (
                <button
                  key={ui.id}
                  type="button"
                  onClick={() => setSelected(ui)}
                  className={[
                    "ui-card p-3 text-left w-full relative overflow-hidden",
                    "transition-transform duration-150 active:translate-y-[1px]",
                    "hover:bg-[rgba(255,255,255,0.06)]",
                    rClass,
                  ].join(" ")}
                >
                  {/* rarity glow */}
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background: `radial-gradient(220px 120px at 50% 0%, color-mix(in srgb, ${rColor} 22%, transparent), transparent 60%)`,
                      opacity: 0.9,
                    }}
                  />

                  {/* badge */}
                  <div className="relative z-10 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold leading-snug truncate">
                        {ui.item.name}
                      </div>
                      <div className="mt-1 text-[11px] ui-subtle">
                        {String(ui.item.type || "").toUpperCase()}
                      </div>
                    </div>

                    <span
                      className="ui-pill whitespace-nowrap"
                      style={{ borderColor: rColor, color: "var(--text)" }}
                    >
                      {rarityLabel(ui.item.rarity)}
                    </span>
                  </div>

                  {/* image (square loot tile) */}
                  <div className="relative z-10 mt-3 rounded-[var(--r-md)] border border-[color:var(--border)] bg-[rgba(0,0,0,0.25)] overflow-hidden aspect-square">
                    {ui.item.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={ui.item.image_url}
                        alt={ui.item.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <div className="ui-subtitle">No image</div>
                      </div>
                    )}
                  </div>

                  {/* power */}
                  <div className="relative z-10 mt-3 flex items-center justify-between">
                    <div className="text-[11px] ui-subtle">POWER</div>
                    <div className="text-base font-semibold tabular-nums">
                      {formatCompact(Number(ui.item.power_value ?? 0))}
                    </div>
                  </div>

                  <div className="relative z-10 mt-2 text-[11px] ui-subtle">
                    Tap to preview
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      {selected && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center px-4 pb-6 sm:pb-0"
          role="dialog"
          aria-modal="true"
          aria-label="Item preview"
        >
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="absolute inset-0 bg-black/75"
            aria-label="Close preview"
          />

          <div
            className={[
              "relative w-full max-w-md ui-card-strong p-4 rounded-[var(--r-xl)]",
              "motion-safe:animate-[invModalIn_180ms_ease-out_1]",
              rarityFxClass(selected.item?.rarity),
              "overflow-hidden",
            ].join(" ")}
          >
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background: `radial-gradient(520px 260px at 50% 0%, color-mix(in srgb, ${rarityColorVar(
                  selected.item?.rarity
                )} 18%, transparent), transparent 62%)`,
                opacity: 0.95,
              }}
            />

            <div className="relative z-10 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-lg font-semibold truncate">
                  {selected.item.name}
                </div>
                <div className="mt-1 flex items-center gap-2 flex-wrap">
                  <span
                    className="ui-pill"
                    style={{
                      borderColor: rarityColorVar(selected.item?.rarity),
                      color: "var(--text)",
                    }}
                  >
                    {rarityLabel(selected.item.rarity)}
                  </span>
                  <span className="ui-pill">
                    {String(selected.item.type || "").toUpperCase()}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelected(null)}
                className="ui-btn ui-btn-ghost"
              >
                Close
              </button>
            </div>

            <div className="relative z-10 mt-4 rounded-[var(--r-lg)] border border-[color:var(--border)] bg-[rgba(0,0,0,0.25)] overflow-hidden aspect-square">
              {selected.item.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selected.item.image_url}
                  alt={selected.item.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="ui-subtitle">No image</div>
                </div>
              )}
            </div>

            <div className="relative z-10 mt-4 ui-card p-4">
              <div className="flex items-center justify-between">
                <div className="ui-subtitle">Power</div>
                <div className="text-2xl font-semibold tabular-nums">
                  {formatCompact(Number(selected.item.power_value ?? 0))}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <div className="ui-subtitle">Obtained</div>
                  <div className="text-sm ui-muted mt-1">
                    {formatDate(selected.created_at) || "Unknown"}
                  </div>
                </div>

                <div>
                  <div className="ui-subtitle">Source</div>
                  <div className="text-sm ui-muted mt-1 break-words">
                    {selected.obtained_from ? String(selected.obtained_from) : "Unknown"}
                  </div>
                </div>
              </div>
            </div>

            <div className="relative z-10 mt-4 flex gap-2">
              <a href="/chest" className="ui-btn ui-btn-primary flex-1">
                Open more
              </a>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="ui-btn ui-btn-ghost flex-1"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
