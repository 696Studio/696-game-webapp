"use client";

import { useEffect, useMemo, useState } from "react";
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

function formatCompact(n: number) {
  const x = Number.isFinite(n) ? n : 0;
  if (x >= 1_000_000_000) return `${(x / 1_000_000_000).toFixed(1)}B`;
  if (x >= 1_000_000) return `${(x / 1_000_000).toFixed(1)}M`;
  if (x >= 10_000) return `${Math.round(x / 1000)}K`;
  return `${x}`;
}

function formatHours(seconds: number) {
  const s = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const h = Math.ceil(s / 3600);
  return `${h}h`;
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

  // ✅ grace delay: не показываем “Couldn’t load…” сразу
  const [showGate, setShowGate] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShowGate(true), 1200);
    return () => clearTimeout(t);
  }, []);

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

      // ✅ обновляем баланс + daily через bootstrap
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

  // 0) Если не в Telegram — честно говорим
  if (!isTelegramEnv) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-md ui-card p-5 text-center">
          <div className="text-lg font-semibold">Open in Telegram</div>
          <div className="mt-2 text-sm ui-subtle">
            This game works only inside Telegram WebApp.
          </div>
        </div>
      </main>
    );
  }

  // ✅ пока core нет — сначала только Loading (1200ms), потом уже можно показывать ошибку/timeout
  if (!hasCore) {
    if (!showGate || loading) {
      return (
        <main className="min-h-screen flex items-center justify-center px-4">
          <div className="w-full max-w-md">
            <div className="text-center mb-4">
              <div className="ui-title text-696">696 Game</div>
              <div className="ui-subtitle mt-2">Session Sync</div>
            </div>

            <div className="ui-card p-5">
              <div className="text-sm font-semibold">Loading 696 Game...</div>
              <div className="mt-2 text-sm ui-subtle">
                Syncing your session and profile.
              </div>

              <div className="mt-4 ui-progress">
                <div className="w-1/3 opacity-70 animate-pulse" />
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3">
                <div className="h-16 rounded-[var(--r-lg)] border border-[color:var(--border)] bg-[color:var(--panel)] animate-pulse" />
                <div className="h-16 rounded-[var(--r-lg)] border border-[color:var(--border)] bg-[color:var(--panel)] animate-pulse" />
                <div className="h-16 rounded-[var(--r-lg)] border border-[color:var(--border)] bg-[color:var(--panel)] animate-pulse" />
              </div>
            </div>
          </div>
        </main>
      );
    }

    if (timedOut || !!error) {
      return (
        <main className="min-h-screen flex items-center justify-center px-4">
          <div className="w-full max-w-md">
            <div className="text-center mb-4">
              <div className="ui-title text-696">696 Game</div>
              <div className="ui-subtitle mt-2">Session Gate</div>
            </div>

            <div className="ui-card p-5">
              <div className="text-lg font-semibold">
                {timedOut ? "Connection timeout" : "Couldn’t load your profile"}
              </div>

              <div className="mt-2 text-sm ui-subtle">
                {timedOut
                  ? "Telegram or network didn’t respond in time. Tap Re-sync to try again."
                  : "Something went wrong while syncing your session."}
              </div>

              {error && (
                <div className="mt-4 p-3 rounded-[var(--r-md)] border border-[color:var(--border)] bg-[rgba(255,255,255,0.03)]">
                  <div className="ui-subtitle mb-1">Details</div>
                  <div className="text-xs break-words">{String(error)}</div>
                </div>
              )}

              <div className="mt-5 flex flex-col gap-3">
                <button onClick={handleResync} className="ui-btn ui-btn-primary w-full">
                  Re-sync
                </button>

                <div className="text-[11px] ui-subtle text-center">
                  If it keeps failing, reopen the Mini App from the bot menu.
                </div>
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

  const { user, balance, totalPower, level, progress, spinsCount, totalShardsSpent, daily } =
    core;

  const progressPercent = Math.round((progress || 0) * 100);

  return (
    <main className="min-h-screen flex flex-col items-center pt-10 px-4 pb-24">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 className="ui-title text-696">696 Game</h1>
            <div className="ui-subtitle mt-2">Core Dashboard</div>
          </div>

          <button onClick={handleResync} className="ui-btn ui-btn-ghost">
            Re-sync
          </button>
        </div>

        {/* Player strip */}
        <div className="ui-card p-4 flex items-center justify-between mb-5">
          <div>
            <div className="ui-subtitle">Player</div>
            <div className="text-base font-semibold mt-1 leading-tight">
              {user.username || user.first_name || "Unknown"}
            </div>
            <div className="text-[11px] ui-subtle mt-1">
              ID: <span className="text-[color:var(--text)]">{user.telegram_id || telegramId}</span>
            </div>
          </div>

          <div className="text-right">
            <div className="ui-subtitle">Level</div>
            <div className="text-2xl font-semibold mt-1 tabular-nums">{level}</div>
          </div>
        </div>

        {/* KPI grid */}
        <div className="ui-grid grid-cols-2 mb-5">
          <div className="ui-card p-4">
            <div className="flex items-center justify-between">
              <div className="ui-subtitle">Total Power</div>
              <span className="ui-pill">{progressPercent}%</span>
            </div>
            <div className="text-3xl font-semibold mt-3 tabular-nums">
              {formatCompact(totalPower)}
            </div>
            <div className="text-xs ui-subtle mt-2">
              Grow power by opening cases & collecting items.
            </div>
          </div>

          <div className="ui-card p-4">
            <div className="ui-subtitle">Balance</div>

            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="ui-subtle">Shards</span>
              <span className="font-semibold tabular-nums">
                {formatCompact(balance.soft_balance)}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="ui-subtle">Crystals</span>
              <span className="font-semibold tabular-nums">
                {formatCompact(balance.hard_balance)}
              </span>
            </div>
          </div>

          <div className="ui-card p-4">
            <div className="ui-subtitle">Spins</div>

            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="ui-subtle">Total</span>
              <span className="font-semibold tabular-nums">{formatCompact(spinsCount)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="ui-subtle">Spent</span>
              <span className="font-semibold tabular-nums">
                {formatCompact(totalShardsSpent)}
              </span>
            </div>

            <div className="text-xs ui-subtle mt-2">
              Chest UX polish is next step.
            </div>
          </div>

          <div className="ui-card p-4">
            <div className="flex items-center justify-between">
              <div className="ui-subtitle">Status</div>
              <span className="ui-pill">Connected</span>
            </div>
            <div className="text-xs ui-subtle mt-3">
              If anything feels off — hit Re-sync.
            </div>
          </div>
        </div>

        {/* Progress */}
        <div className="ui-card p-4 mb-5">
          <div className="flex items-end justify-between">
            <div>
              <div className="ui-subtitle">Progress</div>
              <div className="text-sm ui-muted mt-1">LEVEL {level}</div>
            </div>
            <div className="text-sm font-semibold tabular-nums">{progressPercent}%</div>
          </div>

          <div className="mt-3 ui-progress">
            <div
              className="transition-[width] duration-700 ease-out"
              style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
            />
          </div>

          <div className="text-xs ui-subtle mt-2">
            Keep grinding. Power → Level → Better drops.
          </div>
        </div>

        {/* Daily */}
        <div className="ui-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="ui-subtitle">Daily Shards</div>
              <div className="text-sm ui-muted mt-1">
                Reward{" "}
                <span className="font-semibold tabular-nums">
                  {formatCompact(daily.amount)}
                </span>{" "}
                <span className="ui-subtle">Shards</span>
              </div>
            </div>

            <div className="text-right">
              <div className="ui-subtitle">Streak</div>
              <div className="text-xl font-semibold tabular-nums mt-1">
                {daily.streak}
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <span className="ui-pill">
              {daily.canClaim ? "READY" : `NEXT ~${formatHours(daily.remainingSeconds)}`}
            </span>

            {daily.canClaim ? (
              <span className="text-xs ui-subtle">Claim your daily reward now.</span>
            ) : (
              <span className="text-xs ui-subtle">Come back later to claim.</span>
            )}
          </div>

          {daily.canClaim && (
            <button
              onClick={handleClaimDaily}
              disabled={claimLoading || !telegramId}
              className="ui-btn ui-btn-primary w-full mt-4"
            >
              {claimLoading ? "Claiming..." : "Claim Daily"}
            </button>
          )}

          {claimError && (
            <div className="mt-3 text-xs text-red-400 break-words">{claimError}</div>
          )}
        </div>
      </div>
    </main>
  );
}
