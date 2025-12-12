"use client";

import { useMemo, useState } from "react";
import { useGameSessionContext } from "../context/GameSessionContext";

type DropItem = {
  id: string;
  name: string;
  rarity: string;
  power_value: number;
  image_url: string | null;
};

type ChestResponse = {
  drop?: DropItem;
  newBalance?: {
    soft_balance: number;
    hard_balance: number;
  };
  totalPowerAfter?: number;
  error?: string;
  code?: string;
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

export default function ChestPage() {
  const { telegramId, bootstrap, isTelegramEnv, loading } =
    useGameSessionContext() as any;

  // локальный override — чтобы обновлять данные после открытия сундука
  const [overrideBootstrap, setOverrideBootstrap] = useState<any | null>(null);

  const [result, setResult] = useState<ChestResponse | null>(null);
  const [opening, setOpening] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const core = useMemo(() => unwrapCore(overrideBootstrap || bootstrap), [
    overrideBootstrap,
    bootstrap,
  ]);

  const soft = core?.balance?.soft_balance ?? 0;
  const hard = core?.balance?.hard_balance ?? 0;
  const totalPower = core?.totalPower ?? 0;

  async function refreshBootstrap(effectiveTelegramId: string) {
    setRefreshing(true);
    try {
      const res = await fetch("/api/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramId: effectiveTelegramId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Bootstrap refresh failed");

      setOverrideBootstrap(data);
    } finally {
      setRefreshing(false);
    }
  }

  const handleOpenChest = async () => {
    if (!telegramId) return;

    setOpening(true);
    setResult(null);

    try {
      const res = await fetch("/api/chest/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegramId,
          chestCode: "soft_basic",
        }),
      });

      const data: ChestResponse = await res.json();
      setResult(data);

      if (!res.ok) {
        // ошибка уже будет показана ниже
        return;
      }

      // ✅ важное: после открытия сундука обновляем bootstrap
      await refreshBootstrap(telegramId);
    } catch (e) {
      console.error(e);
      setResult({ error: "Request failed" });
    } finally {
      setOpening(false);
    }
  };

  // честно: только Telegram
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

  // если телега есть, но user ещё не подтянулся/нет telegramId
  if (loading || !telegramId) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <span>Loading...</span>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center pt-16 px-4">
      <h1 className="text-3xl font-bold tracking-[0.3em] uppercase mb-6">
        696 Chest
      </h1>

      <div className="flex gap-4 mb-6 flex-wrap justify-center">
        <div className="p-4 border border-zinc-700 rounded-xl min-w-[160px]">
          <div className="text-xs text-zinc-500 mb-1">BALANCE</div>
          <div>Shards: {soft}</div>
          <div>Crystals: {hard}</div>
          {refreshing && (
            <div className="text-[10px] text-zinc-500 mt-2">Syncing...</div>
          )}
        </div>

        <div className="p-4 border border-zinc-700 rounded-xl min-w-[160px]">
          <div className="text-xs text-zinc-500 mb-1">TOTAL POWER</div>
          <div className="text-xl font-semibold">{totalPower}</div>
        </div>
      </div>

      <div className="mt-4 flex flex-col items-center gap-4">
        <div className="w-48 h-32 border border-zinc-700 rounded-2xl flex items-center justify-center bg-zinc-900">
          <span className="text-zinc-400 text-sm">Basic Chest (50 Shards)</span>
        </div>

        <button
          onClick={handleOpenChest}
          disabled={opening}
          className="mt-2 px-6 py-2 rounded-full border border-zinc-600 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50"
        >
          {opening ? "Opening..." : "Open Chest"}
        </button>
      </div>

      {result && (
        <div className="mt-8 max-w-sm text-center">
          {result.error ? (
            <div className="text-red-400">
              {result.code === "INSUFFICIENT_FUNDS"
                ? "Недостаточно Shards для открытия сундука."
                : `Ошибка: ${result.error}`}
            </div>
          ) : result.drop ? (
            <div className="border border-zinc-700 rounded-xl p-4">
              <div className="text-xs text-zinc-500 mb-1">DROP</div>
              <div className="text-lg font-semibold mb-1">
                {result.drop.name}
              </div>
              <div className="text-sm text-zinc-400">
                Rarity: {result.drop.rarity.toUpperCase()}
              </div>
              <div className="text-sm text-zinc-400">
                Power: {result.drop.power_value}
              </div>
              <div className="text-xs text-zinc-500 mt-2">
                Total Power after drop:{" "}
                {typeof result.totalPowerAfter === "number"
                  ? result.totalPowerAfter
                  : totalPower}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </main>
  );
}
