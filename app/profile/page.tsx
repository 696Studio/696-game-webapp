"use client";

import { useEffect, useState } from "react";
import { useGameSessionContext } from "../context/GameSessionContext";

type DailyState = {
  canClaim: boolean;
  remainingSeconds: number;
  streak: number;
  amount: number;
};

type BalanceState = {
  soft_balance: number;
  hard_balance: number;
};

export default function ProfilePage() {
  const { loading, error, telegramId, bootstrap } = useGameSessionContext();

  const [dailyState, setDailyState] = useState<DailyState | null>(null);
  const [balanceState, setBalanceState] = useState<BalanceState | null>(null);

  const [claimLoading, setClaimLoading] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimSuccess, setClaimSuccess] = useState<string | null>(null);

  // Инициализируем локальный daily и баланс из bootstrap
  useEffect(() => {
    if (!bootstrap) return;

    const d = bootstrap.daily;
    if (d) {
      setDailyState({
        canClaim: d.canClaim,
        remainingSeconds: d.remainingSeconds,
        streak: d.streak,
        amount: d.amount,
      });
    }

    if (bootstrap.balance) {
      setBalanceState({
        soft_balance: bootstrap.balance.soft_balance,
        hard_balance: bootstrap.balance.hard_balance,
      });
    }
  }, [bootstrap]);

  const handleClaimDaily = async () => {
    if (!telegramId || !dailyState) return;

    if (!dailyState.canClaim) {
      setClaimError("Daily уже забран, подожди до следующего ресета.");
      return;
    }

    setClaimLoading(true);
    setClaimError(null);
    setClaimSuccess(null);

    try {
      const res = await fetch("/api/daily/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramId }),
      });

      const data = await res.json();

      if (!res.ok) {
        // Если уже забрано — обновим таймер и состояние
        if (data.code === "DAILY_ALREADY_CLAIMED") {
          setDailyState((prev) =>
            prev
              ? {
                  ...prev,
                  canClaim: false,
                  remainingSeconds: data.remainingSeconds ?? prev.remainingSeconds,
                }
              : prev
          );
        }

        setClaimError(data.error || "Failed to claim daily reward");
      } else {
        // Успех: обновляем баланс и daily
        if (data.newBalance) {
          setBalanceState({
            soft_balance: data.newBalance.soft_balance,
            hard_balance: data.newBalance.hard_balance,
          });
        }

        setDailyState((prev) =>
          prev
            ? {
                ...prev,
                canClaim: false,
                remainingSeconds: 24 * 3600, // условно до следующего дня
                streak: data.streak ?? prev.streak,
                amount: data.amount ?? prev.amount,
              }
            : prev
        );

        setClaimSuccess(`+${data.amount ?? dailyState.amount} Shards claimed!`);
      }
    } catch (e: any) {
      console.error(e);
      setClaimError("Unexpected error while claiming daily reward");
    } finally {
      setClaimLoading(false);
    }
  };

  if (loading || !bootstrap) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-black text-white">
        <span>Loading profile...</span>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-black text-white">
        <div>
          <div className="mb-2 text-red-400">Error loading profile</div>
          <pre className="text-xs max-w-sm overflow-auto">
            {JSON.stringify({ error, telegramId }, null, 2)}
          </pre>
        </div>
      </main>
    );
  }

  const {
    user,
    totalPower,
    level,
    currentLevelPower,
    nextLevelPower,
    progress,
    spinsCount,
    lastSpinAt,
    totalShardsSpent,
  } = bootstrap;

  const username = user?.username || "Unknown";
  const tid = user?.telegram_id || telegramId || "N/A";

  const shards = balanceState?.soft_balance ?? 0;
  const crystals = balanceState?.hard_balance ?? 0;

  const levelProgressPercent = Math.round((progress ?? 0) * 100);

  const lastSpinText = lastSpinAt
    ? new Date(lastSpinAt).toLocaleString()
    : "No spins yet";

  const daily = dailyState;

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center pt-16 px-4">
      <h1 className="text-3xl font-bold tracking-[0.3em] uppercase mb-6">
        Profile
      </h1>

      {/* Блок с ником и телеграмом */}
      <div className="w-full max-w-3xl mb-6 flex flex-col gap-2 items-center">
        <div className="text-sm text-zinc-400">
          Player: <span className="text-white font-semibold">{username}</span>
        </div>
        <div className="text-xs text-zinc-500">
          Telegram ID: <span className="text-zinc-300">{tid}</span>
        </div>
      </div>

      {/* Основные статы */}
      <div className="w-full max-w-3xl grid gap-4 mb-8 sm:grid-cols-3">
        <div className="p-4 border border-zinc-700 rounded-xl">
          <div className="text-xs text-zinc-500 mb-1">BALANCE</div>
          <div className="text-sm">
            Shards: <span className="font-semibold">{shards}</span>
          </div>
          <div className="text-sm">
            Crystals: <span className="font-semibold">{crystals}</span>
          </div>
        </div>

        <div className="p-4 border border-zinc-700 rounded-xl">
          <div className="text-xs text-zinc-500 mb-1">TOTAL POWER</div>
          <div className="text-2xl font-semibold">{totalPower ?? 0}</div>
        </div>

        <div className="p-4 border border-zinc-700 rounded-xl">
          <div className="text-xs text-zinc-500 mb-1">SPINS / SPENT</div>
          <div className="text-sm">
            Chest spins: <span className="font-semibold">{spinsCount ?? 0}</span>
          </div>
          <div className="text-sm">
            Shards spent:{" "}
            <span className="font-semibold">{totalShardsSpent ?? 0}</span>
          </div>
        </div>
      </div>

      {/* Уровень и прогресс */}
      <div className="w-full max-w-3xl mb-8 p-4 border border-zinc-700 rounded-xl">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-xs text-zinc-500">LEVEL</div>
            <div className="text-xl font-semibold">Level {level ?? 1}</div>
          </div>
          <div className="text-xs text-zinc-400 text-right">
            {currentLevelPower ?? 0} → {nextLevelPower ?? 100} power
          </div>
        </div>

        <div className="w-full h-2 rounded-full bg-zinc-900 overflow-hidden">
          <div
            className="h-full bg-zinc-200"
            style={{ width: `${levelProgressPercent}%` }}
          />
        </div>
        <div className="mt-1 text-[10px] text-zinc-500 text-right">
          {levelProgressPercent}% to next level
        </div>
      </div>

      {/* Инфо по daily и последнему спину */}
      <div className="w-full max-w-3xl grid gap-4 mb-10 sm:grid-cols-2">
        <div className="p-4 border border-zinc-700 rounded-xl">
          <div className="text-xs text-zinc-500 mb-2">DAILY REWARD</div>

          {daily ? (
            <>
              {daily.canClaim ? (
                <div className="text-sm text-green-400 mb-2">
                  Можно забрать +{daily.amount} Shards сегодня.
                </div>
              ) : (
                <div className="text-sm text-zinc-300 mb-2">
                  Уже забрал, до следующей ещё{" "}
                  <span className="font-semibold">
                    {daily.remainingSeconds ?? 0} сек
                  </span>
                  .
                </div>
              )}

              <div className="text-[10px] text-zinc-500 mb-3">
                Streak: {daily.streak ?? 0}
              </div>

              <button
                onClick={handleClaimDaily}
                disabled={claimLoading || !daily.canClaim}
                className="px-4 py-2 rounded-full border border-zinc-700 text-sm text-zinc-200 hover:bg-zinc-900 disabled:opacity-50"
              >
                {claimLoading
                  ? "Claiming..."
                  : daily.canClaim
                  ? `Claim +${daily.amount} Shards`
                  : "Already claimed"}
              </button>

              {claimError && (
                <div className="mt-2 text-xs text-red-400">{claimError}</div>
              )}
              {claimSuccess && (
                <div className="mt-2 text-xs text-green-400">
                  {claimSuccess}
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-zinc-400">
              Daily info not available.
            </div>
          )}
        </div>

        <div className="p-4 border border-zinc-700 rounded-xl">
          <div className="text-xs text-zinc-500 mb-1">LAST CHEST SPIN</div>
          <div className="text-sm text-zinc-300">{lastSpinText}</div>
        </div>
      </div>

      {/* Навигация */}
      <div className="mt-4 flex gap-4">
        <a
          href="/"
          className="px-4 py-2 rounded-full border border-zinc-700 text-sm text-zinc-200 hover:bg-zinc-900"
        >
          Home
        </a>
        <a
          href="/chest"
          className="px-4 py-2 rounded-full border border-zinc-700 text-sm text-zinc-200 hover:bg-zinc-900"
        >
          Chest
        </a>
        <a
          href="/inventory"
          className="px-4 py-2 rounded-full border border-zinc-700 text-sm text-zinc-200 hover:bg-zinc-900"
        >
          Inventory
        </a>
      </div>
    </main>
  );
}
