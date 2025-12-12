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
  rarityStats?: {
    common?: number;
    rare?: number;
    epic?: number;
    legendary?: number;
  };
  error?: string;
};

type CoreBootstrap = {
  user: { id: string; telegram_id: string; username: string | null };
  balance: { user_id: string; soft_balance: number; hard_balance: number };
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

function normalizeRarity(rarity: string | null | undefined): Exclude<RarityFilter, "all"> {
  const r = String(rarity || "").trim().toLowerCase();
  if (r === "common" || r === "rare" || r === "epic" || r === "legendary") return r;
  return "common";
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

  useEffect(() => {
    if (!telegramId) return;

    let cancelled = false;

    async function loadInventory() {
      try {
        setLoading(true);

        const res = await fetch(
          `/api/inventory?telegram_id=${encodeURIComponent(telegramId)}`
        );

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

  const handleResync = () => {
    setInventory(null);
    refreshSession?.();
  };

  // ✅ ВАЖНО: вычисления ДО любых return (фикс React #310)
  const items = inventory?.items ?? [];
  const totalPower =
    typeof inventory?.totalPower === "number"
      ? inventory.totalPower
      : core?.totalPower ?? 0;

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

  // ---------- UI ----------

  if (!isTelegramEnv) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <div className="text-lg font-semibold mb-2">Open in Telegram</div>
          <div className="text-sm text-zinc-400">
            This page works only inside Telegram WebApp.
          </div>
        </div>
      </main>
    );
  }

  if ((sessionLoading && !hasCore) || (!hasCore && (timedOut || !!sessionError))) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
        <div className="max-w-md w-full">
          <div className="text-lg font-semibold">
            {timedOut ? "Connection timeout" : "Couldn’t load your session"}
          </div>

          <div className="mt-2 text-sm text-zinc-400">
            {timedOut
              ? "Telegram or network didn’t respond in time. Tap Re-sync to try again."
              : "Something went wrong while syncing your profile."}
          </div>

          {sessionError && (
            <div className="mt-4 p-3 rounded-lg border border-zinc-800 bg-zinc-950">
              <div className="text-[11px] text-zinc-500 mb-1">DETAILS</div>
              <div className="text-xs text-zinc-200 break-words">
                {String(sessionError)}
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-col gap-3">
            <button
              onClick={handleResync}
              className="w-full px-4 py-2 rounded-lg border border-zinc-700 text-sm hover:bg-zinc-900"
            >
              Re-sync
            </button>

            <div className="text-[11px] text-zinc-500 text-center">
              If it keeps failing, reopen the Mini App from the bot menu.
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (sessionLoading || !telegramId) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-black text-white px-4">
        <div className="text-center">
          <div className="text-lg font-semibold">Loading inventory...</div>
          <div className="mt-2 text-sm text-zinc-400">Syncing session.</div>
        </div>
      </main>
    );
  }

  if (!core) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-black text-white px-4">
        <div className="text-center">
          <div className="text-lg font-semibold">Loading profile...</div>
          <div className="mt-2 text-sm text-zinc-400">Please wait a moment.</div>
        </div>
      </main>
    );
  }

  const rarityOptions: { key: RarityFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "common", label: "Common" },
    { key: "rare", label: "Rare" },
    { key: "epic", label: "Epic" },
    { key: "legendary", label: "Legendary" },
  ];

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center pt-16 px-4 pb-24">
      <h1 className="text-3xl font-bold tracking-[0.3em] uppercase mb-6">
        Inventory
      </h1>

      <button
        onClick={handleResync}
        className="mb-6 px-4 py-1 rounded-full border border-zinc-800 text-[11px] text-zinc-300 hover:bg-zinc-900"
      >
        Re-sync session
      </button>

      <div className="flex flex-wrap gap-4 mb-6 justify-center">
        <div className="p-4 border border-zinc-700 rounded-xl min-w-[160px]">
          <div className="text-xs text-zinc-500 mb-1">TOTAL POWER</div>
          <div className="text-xl font-semibold">{totalPower}</div>
        </div>

        <div className="p-4 border border-zinc-700 rounded-xl min-w-[160px]">
          <div className="text-xs text-zinc-500 mb-1">ITEMS</div>
          <div className="text-xl font-semibold">{items.length}</div>
          <div className="text-[11px] text-zinc-500 mt-1">
            Showing: {shownCount}
          </div>
        </div>
      </div>

      <div className="w-full max-w-3xl mb-6 flex flex-col gap-3">
        <div className="flex flex-wrap gap-2 justify-center">
          {rarityOptions.map((opt) => {
            const active = rarityFilter === opt.key;
            return (
              <button
                key={opt.key}
                onClick={() => setRarityFilter(opt.key)}
                className={[
                  "px-3 py-1 rounded-full border text-xs",
                  active
                    ? "border-zinc-400 text-white bg-zinc-900"
                    : "border-zinc-800 text-zinc-300 hover:bg-zinc-900",
                ].join(" ")}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-center gap-2 flex-wrap">
          <div className="text-xs text-zinc-500">Sort:</div>

          <button
            onClick={() => setSortMode("power_desc")}
            className={[
              "px-3 py-1 rounded-full border text-xs",
              sortMode === "power_desc"
                ? "border-zinc-400 text-white bg-zinc-900"
                : "border-zinc-800 text-zinc-300 hover:bg-zinc-900",
            ].join(" ")}
          >
            Power ↓
          </button>

          <button
            onClick={() => setSortMode("power_asc")}
            className={[
              "px-3 py-1 rounded-full border text-xs",
              sortMode === "power_asc"
                ? "border-zinc-400 text-white bg-zinc-900"
                : "border-zinc-800 text-zinc-300 hover:bg-zinc-900",
            ].join(" ")}
          >
            Power ↑
          </button>

          <button
            onClick={() => setSortMode("newest")}
            className={[
              "px-3 py-1 rounded-full border text-xs",
              sortMode === "newest"
                ? "border-zinc-400 text-white bg-zinc-900"
                : "border-zinc-800 text-zinc-300 hover:bg-zinc-900",
            ].join(" ")}
          >
            Newest
          </button>
        </div>
      </div>

      {loading && <div className="text-sm text-zinc-400 mb-4">Loading items...</div>}

      {inventory?.error && (
        <div className="text-red-400 mb-4">Error loading inventory: {inventory.error}</div>
      )}

      {!loading && !inventory?.error && filteredSortedItems.length === 0 && (
        <div className="w-full max-w-3xl border border-zinc-800 bg-zinc-950 rounded-2xl p-6 text-center">
          <div className="text-lg font-semibold">No items yet</div>
          <div className="mt-2 text-sm text-zinc-400">
            Open chests to collect emblems, items, characters and pets.
          </div>
          <a
            href="/chest"
            className="inline-block mt-4 px-4 py-2 rounded-lg border border-zinc-800 text-sm text-zinc-200 hover:bg-zinc-900"
          >
            Go to Chest
          </a>
        </div>
      )}

      {filteredSortedItems.length > 0 && (
        <div className="grid gap-4 w-full max-w-3xl sm:grid-cols-2 md:grid-cols-3">
          {filteredSortedItems.map((ui) => (
            <div
              key={ui.id}
              className="border border-zinc-700 rounded-xl p-3 bg-zinc-900/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold leading-snug">{ui.item.name}</div>
                <div className="text-[10px] px-2 py-1 rounded-full border border-zinc-800 text-zinc-300">
                  {String(ui.item.rarity || "").toUpperCase()}
                </div>
              </div>

              <div className="mt-2 text-xs text-zinc-400">
                Type: {String(ui.item.type || "").toUpperCase()}
              </div>

              <div className="mt-1 text-xs text-zinc-400">
                Power:{" "}
                <span className="text-zinc-100 font-semibold">
                  {ui.item.power_value}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
