"use client";

import { useEffect, useMemo, useState } from "react";
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

const CHEST_COST_SHARDS = 50;
const INVENTORY_PATH = "/inventory";

export default function ChestPage() {
  const {
    telegramId,
    bootstrap,
    isTelegramEnv,
    loading,
    error,
    timedOut,
    refreshSession,
  } = useGameSessionContext() as any;

  // ✅ grace delay
  const [showGate, setShowGate] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShowGate(true), 1200);
    return () => clearTimeout(t);
  }, []);

  // локальный override — чтобы обновлять данные после открытия сундука
  const [overrideBootstrap, setOverrideBootstrap] = useState<any | null>(null);

  const [result, setResult] = useState<ChestResponse | null>(null);
  const [opening, setOpening] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const core = useMemo(() => unwrapCore(overrideBootstrap || bootstrap), [
    overrideBootstrap,
    bootstrap,
  ]);

  const hasCore = !!core;

  const soft = core?.balance?.soft_balance ?? 0;
  const hard = core?.balance?.hard_balance ?? 0;
  const totalPower = core?.totalPower ?? 0;

  const canAfford = soft >= CHEST_COST_SHARDS;

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

  const handleResync = () => {
    setOverrideBootstrap(null);
    setResult(null);
    refreshSession?.();
  };

  const handleOpenChest = async () => {
    if (!telegramId) return;

    // ✅ pre-check (без запроса)
    if (!canAfford) {
      setResult({ error: "Insufficient funds", code: "INSUFFICIENT_FUNDS" });
      return;
    }

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

      if (!res.ok) return;

      // ✅ после открытия сундука обновляем bootstrap
      await refreshBootstrap(telegramId);
    } catch (e) {
      console.error(e);
      setResult({ error: "Request failed" });
    } finally {
      setOpening(false);
    }
  };

  const handleOpenAgain = async () => {
    setResult(null);
    await handleOpenChest();
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

  // ✅ gate с задержкой
  if (!hasCore) {
    if (!showGate || loading) {
      return (
        <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
          <div className="text-center">
            <div className="text-lg font-semibold">Loading...</div>
            <div className="mt-2 text-sm text-zinc-400">Syncing session.</div>
          </div>
        </main>
      );
    }

    if (timedOut || !!error) {
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

            {error && (
              <div className="mt-4 p-3 rounded-lg border border-zinc-800 bg-zinc-950">
                <div className="text-[11px] text-zinc-500 mb-1">DETAILS</div>
                <div className="text-xs text-zinc-200 break-words">
                  {String(error)}
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

    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
        <div className="text-center">
          <div className="text-lg font-semibold">Loading...</div>
          <div className="mt-2 text-sm text-zinc-400">Still syncing.</div>
        </div>
      </main>
    );
  }

  if (loading || !telegramId) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
        <div className="text-center">
          <div className="text-lg font-semibold">Loading...</div>
          <div className="mt-2 text-sm text-zinc-400">Syncing session.</div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center pt-16 px-4 pb-24">
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

      <button
        onClick={handleResync}
        className="mb-8 px-4 py-1 rounded-full border border-zinc-800 text-[11px] text-zinc-300 hover:bg-zinc-900"
      >
        Re-sync session
      </button>

      <div className="mt-4 flex flex-col items-center gap-4">
        <div className="w-48 h-32 border border-zinc-700 rounded-2xl flex items-center justify-center bg-zinc-900">
          <span className="text-zinc-400 text-sm">
            Basic Chest ({CHEST_COST_SHARDS} Shards)
          </span>
        </div>

        {!canAfford && (
          <div className="w-full max-w-sm text-center border border-zinc-800 bg-zinc-950 rounded-xl p-3">
            <div className="text-sm text-zinc-200 font-semibold">
              Not enough Shards
            </div>
            <div className="text-xs text-zinc-400 mt-1">
              You need{" "}
              <span className="font-semibold">
                {CHEST_COST_SHARDS - soft}
              </span>{" "}
              more Shards to open this chest.
            </div>
            <a
              href="/"
              className="inline-block mt-3 px-4 py-2 rounded-lg border border-zinc-800 text-xs text-zinc-200 hover:bg-zinc-900"
            >
              Go to Home
            </a>
          </div>
        )}

        <button
          onClick={handleOpenChest}
          disabled={opening || !canAfford}
          className="mt-2 px-6 py-2 rounded-full border border-zinc-600 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50"
        >
          {opening ? "Opening..." : "Open Chest"}
        </button>
      </div>

      {result && (
        <div className="mt-8 max-w-sm w-full text-center">
          {result.error ? (
            <div className="text-red-400">
              {result.code === "INSUFFICIENT_FUNDS"
                ? "Недостаточно Shards для открытия сундука."
                : `Ошибка: ${result.error}`}
            </div>
          ) : result.drop ? (
            <div className="border border-zinc-700 rounded-xl p-4 bg-zinc-900/30">
              <div className="text-xs text-zinc-500 mb-1">DROP</div>

              <div className="mb-3 flex justify-center">
                <div className="w-24 h-24 rounded-xl border border-zinc-700 bg-zinc-950 flex items-center justify-center overflow-hidden">
                  {result.drop.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={result.drop.image_url}
                      alt={result.drop.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-[10px] text-zinc-500 px-2">
                      No image
                    </div>
                  )}
                </div>
              </div>

              <div className="text-lg font-semibold mb-1">{result.drop.name}</div>
              <div className="text-sm text-zinc-400">
                Rarity: {String(result.drop.rarity || "").toUpperCase()}
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

              <div className="mt-4 flex gap-3 justify-center flex-wrap">
                <button
                  onClick={handleOpenAgain}
                  disabled={opening || !canAfford}
                  className="px-4 py-2 rounded-lg border border-zinc-700 text-sm hover:bg-zinc-900 disabled:opacity-50"
                >
                  {opening ? "Opening..." : "Open again"}
                </button>

                <a
                  href={INVENTORY_PATH}
                  className="px-4 py-2 rounded-lg border border-zinc-700 text-sm hover:bg-zinc-900"
                >
                  Go to Inventory
                </a>
              </div>

              {!canAfford && (
                <div className="mt-3 text-xs text-zinc-500">
                  Need {CHEST_COST_SHARDS - soft} more Shards to open again.
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </main>
  );
}
