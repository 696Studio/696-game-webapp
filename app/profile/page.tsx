"use client";

import { useEffect, useMemo, useState } from "react";
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
  itemsCount?: number;
  level: number;
  currentLevelPower?: number;
  nextLevelPower?: number;
  progress: number;
  spinsCount?: number;
  lastSpinAt?: string | null;
  totalShardsSpent?: number;
  daily?: DailyState;
};

function unwrapCore(bootstrap: any): CoreBootstrap | null {
  const core = (bootstrap && bootstrap.bootstrap) || bootstrap || null;
  if (!core || !core.user || !core.balance) return null;
  return core as CoreBootstrap;
}

export default function ProfilePage() {
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

  const [dailyState, setDailyState] = useState<DailyState | null>(null);
  const [balanceState, setBalanceState] = useState<BalanceState | null>(null);

  const [claimLoading, setClaimLoading] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimSuccess, setClaimSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!core) return;

    const d = (core as any).daily;
    if (d) {
      setDailyState({
        canClaim: !!d.canClaim,
        remainingSeconds: Number(d.remainingSeconds ?? 0),
        streak: Number(d.streak ?? 0),
        amount: Number(d.amount ?? 0),
      });
    } else {
      setDailyState(null);
    }

    if ((core as any).balance) {
      setBalanceState({
        soft_balance: Number((core as any).balance.soft_balance ?? 0),
        hard_balance: Number((core as any).balance.hard_balance ?? 0),
      });
    } else {
      setBalanceState(null);
    }
  }, [core]);

  const handleResync = () => {
    setClaimError(null);
    setClaimSuccess(null);
    refreshSession?.();
  };

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
        if (data.code === "DAILY_ALREADY_CLAIMED") {
          setDailyState((prev) =>
            prev
              ? {
                  ...prev,
                  canClaim: false,
                  remainingSeconds: data.remainingSeconds ?? prev.remainingSeconds ?? 0,
                }
              : prev
          );
        }

        setClaimError(data.error || "Failed to claim daily reward");
      } else {
        if (data.newBalance) {
          setBalanceState({
            soft_balance: Number(data.newBalance.soft_balance ?? 0),
            hard_balance: Number(data.newBalance.hard_balance ?? 0),
          });
        }

        setDailyState((prev) =>
          prev
            ? {
                ...prev,
                canClaim: false,
                remainingSeconds: 24 * 3600,
                streak: Number(data.streak ?? prev.streak ?? 0),
                amount: Number(data.amount ?? prev.amount ?? 0),
              }
            : prev
        );

        setClaimSuccess(`+${data.amount ?? dailyState.amount} Shards claimed!`);
        refreshSession?.();
      }
    } catch (e: any) {
      console.error(e);
      setClaimError("Unexpected error while claiming daily reward");
    } finally {
      setClaimLoading(false);
    }
  };

  if (!isTelegramEnv) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center px-4 pb-24">
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
      <main className="min-h-screen bg-black text-white flex items-center justify-center px-4 pb-24">
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

  if (sessionLoading || !telegramId || !core) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-black text-white px-4 pb-24">
        <div className="text-center">
          <div className="text-lg font-semibold">Loading profile...</div>
          <div className="mt-2 text-sm text-zinc-400">Syncing session.</div>
        </div>
      </main>
    );
  }

  const {
    user,
    totalPower,
    itemsCount,
    level,
    currentLevelPower,
    nextLevelPower,
    progress,
    spinsCount,
    lastSpinAt,
    totalShardsSpent,
  } = core;

  const username = user?.username || user?.first_name || "Unknown";
  const tid = user?.telegram_id || telegramId || "N/A";

  const shards = balanceState?.soft_balance ?? core.balance.soft_balance ?? 0;
  const crystals = balanceState?.hard_balance ?? core.balance.hard_balance ?? 0;

  const levelProgressPercent = Math.round((progress ?? 0) * 100);
  const lastSpinText = lastSpinAt ? new Date(lastSpinAt).toLocaleString() : "No spins yet";
  const daily = dailyState;
  const avatarUrl = user?.avatar_url || null;

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center pt-16 px-4 pb-28">
      <h1 className="text-3xl font-bold tracking-[0.3em] uppercase mb-6">
        Profile
      </h1>

      <button
        onClick={handleResync}
        className="mb-6 px-4 py-1 rounded-full border border-zinc-800 text-[11px] text-zinc-300 hover:bg-zinc-900"
      >
        Re-sync session
      </button>

      <div className="w-full max-w-3xl mb-6 border border-zinc-800 bg-zinc-950 rounded-2xl p-5 flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl border border-zinc-800 bg-zinc-900 flex items-center justify-center overflow-hidden">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt={username} className="w-full h-full object-cover" />
          ) : (
            <div className="text-[10px] text-zinc-500 px-2 text-center">No avatar</div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-xs text-zinc-500 mb-1 uppercase">Player</div>
          <div className="text-lg font-semibold truncate">{username}</div>
          <div className="text-xs text-zinc-500 truncate">Telegram ID: {tid}</div>
        </div>

        <div className="text-right">
          <div className="text-xs text-zinc-500 uppercase">Level</div>
          <div className="text-xl font-semibold">{level ?? 1}</div>
        </div>
      </div>

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
          <div className="text-xs text-zinc-500 mb-1">ITEMS / SPINS</div>
          <div className="text-sm">
            Items:{" "}
            <span className="font-semibold">
              {typeof itemsCount === "number" ? itemsCount : "—"}
            </span>
          </div>
          <div className="text-sm">
            Spins:{" "}
            <span className="font-semibold">{typeof spinsCount === "number" ? spinsCount : 0}</span>
          </div>
        </div>
      </div>

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
          <div className="h-full bg-zinc-200" style={{ width: `${levelProgressPercent}%` }} />
        </div>
        <div className="mt-1 text-[10px] text-zinc-500 text-right">
          {levelProgressPercent}% to next level
        </div>
      </div>

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
                  <span className="font-semibold">{daily.remainingSeconds ?? 0} сек</span>.
                </div>
              )}

              <div className="text-[10px] text-zinc-500 mb-3">Streak: {daily.streak ?? 0}</div>

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

              {claimError && <div className="mt-2 text-xs text-red-400">{claimError}</div>}
              {claimSuccess && <div className="mt-2 text-xs text-green-400">{claimSuccess}</div>}
            </>
          ) : (
            <div className="text-sm text-zinc-400">Daily info not available.</div>
          )}
        </div>

        <div className="p-4 border border-zinc-700 rounded-xl">
          <div className="text-xs text-zinc-500 mb-2">STATS</div>

          <div className="text-sm text-zinc-300">
            Last spin: <span className="text-zinc-100">{lastSpinText}</span>
          </div>

          <div className="mt-2 text-sm text-zinc-300">
            Shards spent:{" "}
            <span className="text-zinc-100 font-semibold">
              {typeof totalShardsSpent === "number" ? totalShardsSpent : 0}
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}
