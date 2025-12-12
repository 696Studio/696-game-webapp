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
  const core = (bootstrap && bootstrap.bootstrap) || bootstrap || null;
  if (!core || !core.user || !core.balance) return null;
  return core as CoreBootstrap;
}

function BottomNav({
  active,
}: {
  active: "home" | "chest" | "inventory" | "profile";
}) {
  const base =
    "px-4 py-2 rounded-full border border-zinc-700 text-sm text-zinc-200 hover:bg-zinc-900";
  const activeCls = "bg-zinc-900 border-zinc-500";

  return (
    <nav className="fixed left-0 right-0 bottom-0 z-50 px-4 pb-4">
      <div className="max-w-md mx-auto flex gap-2 justify-center bg-black/30 backdrop-blur border border-zinc-800 rounded-full p-2">
        <a href="/" className={`${base} ${active === "home" ? activeCls : ""}`}>
          Home
        </a>
        <a
          href="/chest"
          className={`${base} ${active === "chest" ? activeCls : ""}`}
        >
          Chest
        </a>
        <a
          href="/inventory"
          className={`${base} ${active === "inventory" ? activeCls : ""}`}
        >
          Inventory
        </a>
        <a
          href="/profile"
          className={`${base} ${active === "profile" ? activeCls : ""}`}
        >
          Profile
        </a>
      </div>
    </nav>
  );
}

export default function HomePage() {
  const {
    loading,
    error,
    telegramId,
    bootstrap,
    isTelegramEnv,
    timedOut,
    refreshSession,
  } = useGameSessionContext() as any;

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
      body: JSON.stringify({ telegramId: effectiveTelegramId }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Bootstrap refresh failed");
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
      if (!res.ok) throw new Error(data?.error || "Daily claim failed");

      await refreshBootstrap(telegramId);
    } catch (e: any) {
      console.error("Claim daily error:", e);
      setClaimError(e?.message ? String(e.message) : String(e));
    } finally {
      setClaimLoading(false);
    }
  }

  const handleResync = () => {
    setOverrideBootstrap(null);
    refreshSession?.();
  };

  if (!isTelegramEnv) {
    return (
      <>
        <main className="min-h-screen flex items-center justify-center bg-black text-white px-4 pb-24">
          <div className="max-w-md text-center">
            <div className="text-lg font-semibold mb-2">Open in Telegram</div>
            <div className="text-sm text-zinc-400">
              This game works only inside Telegram WebApp.
            </div>
          </div>
        </main>
        <BottomNav active="home" />
      </>
    );
  }

  if (loading && !hasCore) {
    return (
      <>
        <main className="min-h-screen flex items-center justify-center bg-black text-white px-4 pb-24">
          <div className="max-w-md w-full text-center">
            <div className="text-lg font-semibold">Loading 696 Game...</div>
            <div className="mt-2 text-sm text-zinc-400">
              Syncing your session and profile.
            </div>

            {(timedOut || !!error) && (
              <div className="mt-6">
                <div className="text-xs text-zinc-500 mb-2">
                  {timedOut
                    ? "Sync timed out."
                    : "We couldn't finish loading your profile."}
                </div>
                <button
                  onClick={handleResync}
                  className="w-full px-4 py-2 rounded-lg border border-zinc-700 text-sm hover:bg-zinc-900"
                >
                  Re-sync
                </button>
              </div>
            )}
          </div>
        </main>
        <BottomNav active="home" />
      </>
    );
  }

  if (!hasCore) {
    return (
      <>
        <main className="min-h-screen flex items-center justify-center bg-black text-white px-4 pb-24">
          <div className="max-w-md w-full">
            <div className="text-lg font-semibold">
              {timedOut ? "Connection timeout" : "Couldn’t load your profile"}
            </div>

            <div className="mt-2 text-sm text-zinc-400">
              {timedOut
                ? "Telegram or network didn’t respond in time. Tap Re-sync to try again."
                : "Something went wrong while syncing your session."}
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
        <BottomNav active="home" />
      </>
    );
  }

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
    <>
      <main className="min-h-screen bg-black text-white flex flex-col items-center pt-12 px-4 pb-28">
        <h1 className="text-3xl font-bold tracking-[0.35em] uppercase mb-6">
          696 Game
        </h1>

        <div className="mb-6 text-center">
          <div className="text-xs text-zinc-500 mb-1">PLAYER</div>
          <div className="text-lg font-semibold">
            {user.username || "Unknown"}{" "}
            <span className="text-zinc-500 text-xs">
              ({user.telegram_id || telegramId})
            </span>
          </div>

          <button
            onClick={handleResync}
            className="mt-3 px-3 py-1 rounded-full border border-zinc-800 text-[11px] text-zinc-300 hover:bg-zinc-900"
          >
            Re-sync session
          </button>
        </div>

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
      </main>

      <BottomNav active="home" />
    </>
  );
}
