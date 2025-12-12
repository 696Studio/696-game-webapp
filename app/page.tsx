"use client";

import { useMemo, useState } from "react";
import { useGameSessionContext } from "./context/GameSessionContext";

type DailyInfo = {
  canClaim: boolean;
  remainingSeconds: number;
  streak: number;
  amount: number;
};

type CoreBootstrap = {
  user: {
    id: string;
    telegram_id: string;
    username: string | null;
    first_name?: string | null;
    avatar_url?: string | null;
  };
  balance: {
    user_id: string;
    soft_balance: number;
    hard_balance: number;
  };
  totalPower: number;
  itemsCount: number;
  level: number;
  currentLevelPower: number;
  nextLevelPower: number;
  progress: number; // 0..1
  spinsCount: number;
  lastSpinAt: string | null;
  totalShardsSpent: number;
  daily: DailyInfo;
};

function unwrapCore(bootstrap: any): CoreBootstrap | null {
  // bootstrap у нас сейчас может быть:
  // { telegramId: "...", bootstrap: {...} } или просто {...}
  const core = (bootstrap && bootstrap.bootstrap) || bootstrap || null;
  if (!core || !core.user || !core.balance) return null;
  return core as CoreBootstrap;
}

export default function HomePage() {
  const { loading, error, telegramId, bootstrap, isTelegramEnv } =
    useGameSessionContext() as any;

  // локальный override, чтобы обновлять UI после claim без правок контекста
  const [overrideBootstrap, setOverrideBootstrap] = useState<any | null>(null);
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const core: CoreBootstrap | null = useMemo(() => {
    return unwrapCore(overrideBootstrap || bootstrap);
  }, [overrideBootstrap, bootstrap]);

  const hasCore = !!core;

  async function refreshBootstrap(effectiveTelegramId: string) {
    const res = await fetch("/api/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        telegramId: effectiveTelegramId,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || "Bootstrap refresh failed");
    }
    setOverrideBootstrap(data);
  }

  async function handleClaimDaily() {
    if (!telegramId) return;

    try {
      setClaimLoading(true);
      setClaimError(null);

      const res = await fetch("/api/daily/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramId }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Daily claim failed");
      }

      // ✅ после claim обновляем balance + daily через bootstrap
      await refreshBootstrap(telegramId);
    } catch (e: any) {
      console.error("Claim daily error:", e);
      setClaimError(e?.message ? String(e.message) : String(e));
    } finally {
      setClaimLoading(false);
    }
  }

  // 0) Если не в Telegram — честно говорим
  if (!isTelegramEnv) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-black text-white px-4">
        <div className="max-w-md text-center">
          <div className="text-lg font-semibold mb-2">Open in Telegram</div>
          <div className="text-sm text-zinc-400">
            This game works only inside Telegram WebApp.
          </div>
        </div>
      </main>
    );
  }

  // 1) Лоадер: если ещё грузимся и нет данных
  if (loading && !hasCore) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-black text-white">
        <span>Loading 696 Game...</span>
      </main>
    );
  }

  // 2) Жёсткий фоллбек: если так и не получили core-данные
  if (!hasCore) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-black text-white">
        <div className="max-w-md">
          <div className="mb-2 text-red-400 text-sm">
            Error loading profile / bootstrap
          </div>
          <pre className="text-[10px] max-h-[300px] overflow-auto bg-zinc-900 p-2 rounded-lg border border-zinc-700">
            {JSON.stringify(
              {
                error,
                telegramId,
                bootstrap,
              },
              null,
              2
            )}
          </pre>
        </div>
      </main>
    );
  }

  // 3) Нормальный сценарий — данные есть, рендерим дашборд
  const {
    user,
    balance,
    totalPower,
    level,
    progress,
    spinsCount,
    totalShardsSpent,
    daily,
  } = core;

  const progressPercent = Math.round((progress || 0) * 100);

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center pt-12 px-4">
      <h1 className="text-3xl font-bold tracking-[0.35em] uppercase mb-6">
        696 Game
      </h1>

      {/* Блок игрока */}
      <div className="mb-6 text-center">
        <div className="text-xs text-zinc-500 mb-1">PLAYER</div>
        <div className="text-lg font-semibold">
          {user.username || "Unknown"}{" "}
          <span className="text-zinc-500 text-xs">
            ({user.telegram_id || telegramId})
          </span>
        </div>
      </div>

      {/* Основные статы */}
      <div className="flex flex-wrap gap-4 justify-center mb-8">
        <div className="p-4 border border-zinc-700 rounded-xl min-w-[180px]">
          <div className="text-xs text-zinc-500">TOTAL POWER</div>
          <div className="text-2xl font-semibold mt-1">{totalPower}</div>
        </div>

        <div className="p-4 border border-zinc-700 rounded-xl min-w-[180px]">
          <div className="text-xs text-zinc-500 mb-1">BALANCE</div>
          <div>Shards: {balance.soft_balance}</div>
          <div>Crystals: {balance.hard_balance}</div>
        </div>

        <div className="p-4 border border-zinc-700 rounded-xl min-w-[180px]">
          <div className="text-xs text-zinc-500 mb-1">SPINS</div>
          <div>Total spins: {spinsCount}</div>
          <div className="text-xs text-zinc-400">
            Shards spent: {totalShardsSpent}
          </div>
        </div>
      </div>

      {/* Уровень / прогресс */}
      <div className="w-full max-w-md mb-8">
        <div className="flex justify-between text-xs text-zinc-500 mb-1">
          <span>LEVEL {level}</span>
          <span>{progressPercent}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-zinc-900 overflow-hidden border border-zinc-700">
          <div
            className="h-full bg-zinc-100"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Daily reward */}
      <div className="w-full max-w-md mb-10 p-4 border border-zinc-700 rounded-xl">
        <div className="text-xs text-zinc-500 mb-1 uppercase">
          Daily Shards
        </div>

        <div className="flex items-center justify-between">
          <div className="text-sm text-zinc-300">
            Reward: <span className="font-semibold">{daily.amount} Shards</span>
          </div>
          <div className="text-xs text-zinc-400">
            Streak: <span className="font-semibold">{daily.streak}</span>
          </div>
        </div>

        <div className="mt-2 text-xs text-zinc-400">
          {daily.canClaim
            ? "You can claim your daily reward."
            : `Next in ~${Math.ceil(daily.remainingSeconds / 3600)}h`}
        </div>

        {/* ✅ кнопка claim */}
        {daily.canClaim && (
          <button
            onClick={handleClaimDaily}
            disabled={claimLoading || !telegramId}
            className="mt-3 w-full px-4 py-2 rounded-lg border border-zinc-700 text-sm hover:bg-zinc-900 disabled:opacity-50"
          >
            {claimLoading ? "Claiming..." : "Claim Daily"}
          </button>
        )}

        {claimError && (
          <div className="mt-2 text-xs text-red-400">{claimError}</div>
        )}
      </div>

      {/* Навигация */}
      <div className="flex gap-4">
        <a
          href="/chest"
          className="px-4 py-2 rounded-full border border-zinc-700 text-sm text-zinc-200 hover:bg-zinc-900"
        >
          Go to Chest
        </a>
        <a
          href="/inventory"
          className="px-4 py-2 rounded-full border border-zinc-700 text-sm text-zinc-200 hover:bg-zinc-900"
        >
          Inventory
        </a>
        <a
          href="/profile"
          className="px-4 py-2 rounded-full border border-zinc-700 text-sm text-zinc-200 hover:bg-zinc-900"
        >
          Profile
        </a>
      </div>
    </main>
  );
}
