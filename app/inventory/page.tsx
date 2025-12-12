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

type RarityStats = {
  common?: number;
  rare?: number;
  epic?: number;
  legendary?: number;
};

type InventoryResponse = {
  items?: InventoryItem[];
  totalPower?: number;
  rarityStats?: RarityStats;
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

export default function InventoryPage() {
  const {
    loading: sessionLoading,
    error: sessionError,
    telegramId,
    bootstrap,
    isTelegramEnv,
  } = useGameSessionContext() as any;

  const core = useMemo(() => unwrapCore(bootstrap), [bootstrap]);

  const [inventory, setInventory] = useState<InventoryResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // ✅ hooks ВСЕГДА наверху
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
        if (!cancelled) {
          setInventory({ error: "Request failed" });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadInventory();

    return () => {
      cancelled = true;
    };
  }, [telegramId]);

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

  if (sessionLoading || !telegramId) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-black text-white">
        <span>Loading inventory...</span>
      </main>
    );
  }

  if (sessionError) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-black text-white">
        <pre className="text-xs">{sessionError}</pre>
      </main>
    );
  }

  if (!core) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-black text-white">
        <span>Loading profile...</span>
      </main>
    );
  }

  const items = inventory?.items ?? [];
  const rarityStats = inventory?.rarityStats ?? {};
  const totalPower =
    typeof inventory?.totalPower === "number"
      ? inventory.totalPower
      : core.totalPower ?? 0;

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center pt-16 px-4">
      <h1 className="text-3xl font-bold tracking-[0.3em] uppercase mb-6">
        Inventory
      </h1>

      <div className="flex flex-wrap gap-4 mb-6 justify-center">
        <div className="p-4 border border-zinc-700 rounded-xl min-w-[160px]">
          <div className="text-xs text-zinc-500 mb-1">TOTAL POWER</div>
          <div className="text-xl font-semibold">{totalPower}</div>
        </div>

        <div className="p-4 border border-zinc-700 rounded-xl min-w-[160px]">
          <div className="text-xs text-zinc-500 mb-1">ITEMS</div>
          <div className="text-xl font-semibold">{items.length}</div>
        </div>
      </div>

      {loading && (
        <div className="text-sm text-zinc-400 mb-4">Loading items...</div>
      )}

      {inventory?.error && (
        <div className="text-red-400 mb-4">
          Error loading inventory: {inventory.error}
        </div>
      )}

      <div className="grid gap-4 w-full max-w-3xl sm:grid-cols-2 md:grid-cols-3">
        {items.length === 0 && !loading && !inventory?.error && (
          <div className="col-span-full text-center text-zinc-500 text-sm">
            У тебя пока нет предметов. Открой сундук 😈
          </div>
        )}

        {items.map((ui) => (
          <div
            key={ui.id}
            className="border border-zinc-700 rounded-xl p-3 bg-zinc-900/40"
          >
            <div className="font-semibold">{ui.item.name}</div>
            <div className="text-xs text-zinc-400">
              Power: {ui.item.power_value}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
