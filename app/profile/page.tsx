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

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function formatRemaining(sec: number) {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${ss}s`;
  return `${ss}s`;
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

  // ✅ grace delay
  const [showGate, setShowGate] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setShowGate(true), 1200);
    return () => window.clearTimeout(t);
  }, []);

  const core = useMemo(() => unwrapCore(bootstrap), [bootstrap]);
  const hasCore = !!core;

  const [dailyState, setDailyState] = useState<DailyState | null>(null);
  const [balanceState, setBalanceState] = useState<BalanceState | null>(null);

  const [claimLoading, setClaimLoading] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimSuccess, setClaimSuccess] = useState<string | null>(null);

  // local countdown (nice UX)
  useEffect(() => {
    if (!dailyState || dailyState.canClaim) return;

    const id = window.setInterval(() => {
      setDailyState((prev) => {
        if (!prev) return prev;
        const next = Math.max(0, (prev.remainingSeconds ?? 0) - 1);
        return { ...prev, remainingSeconds: next, canClaim: next === 0 };
      });
    }, 1000);

    return () => window.clearInterval(id);
  }, [dailyState?.canClaim]);

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

  // Telegram gate
  if (!isTelegramEnv) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 pb-24">
        <div className="w-full max-w-md ui-card p-5 text-center">
          <div className="text-lg font-semibold mb-2">Open in Telegram</div>
          <div className="text-sm ui-subtle">This page works only inside Telegram WebApp.</div>
        </div>
      </main>
    );
  }

  // Loading / errors (new style)
  if (!hasCore) {
    if (!showGate || sessionLoading) {
      return (
        <main className="min-h-screen flex items-center justify-center px-4 pb-24">
          <div className="w-full max-w-md ui-card p-5 text-center">
            <div className="text-sm font-semibold">Loading...</div>
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
        <main className="min-h-screen flex items-center justify-center px-4 pb-24">
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
      <main className="min-h-screen flex items-center justify-center px-4 pb-24">
        <div className="w-full max-w-md ui-card p-5 text-center">
          <div className="text-sm font-semibold">Loading...</div>
          <div className="mt-2 text-sm ui-subtle">Still syncing.</div>
        </div>
      </main>
    );
  }

  if (sessionLoading || !telegramId || !core) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 pb-24">
        <div className="w-full max-w-md ui-card p-5 text-center">
          <div className="text-sm font-semibold">Loading...</div>
          <div className="mt-2 text-sm ui-subtle">Syncing session.</div>
          <div className="mt-4 ui-progress">
            <div className="w-1/3 opacity-70 animate-pulse" />
          </div>
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

  const levelProgressPercent = clamp(Math.round((progress ?? 0) * 100), 0, 100);
  const lastSpinText = lastSpinAt ? new Date(lastSpinAt).toLocaleString() : "No spins yet";

  const daily = dailyState;
  const avatarUrl = user?.avatar_url || null;

  return (
    <main className="min-h-screen px-4 pt-6 pb-24 flex justify-center">
      <div className="w-full max-w-3xl">
        {/* Header / HUD */}
        <header className="ui-card px-4 py-3 rounded-[var(--r-xl)] mb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="ui-subtitle">Profile</div>
              <div className="mt-1 font-extrabold uppercase tracking-[0.22em] text-base truncate">
                {username}
              </div>
              <div className="text-[11px] ui-subtle mt-1 truncate">Telegram ID: {tid}</div>
            </div>

            <div className="flex items-center gap-2">
              <span className="ui-pill">
                Shards <span className="ml-2 font-extrabold tabular-nums">{shards}</span>
              </span>
              <span className="ui-pill">
                Crystals <span className="ml-2 font-extrabold tabular-nums">{crystals}</span>
              </span>
              <button onClick={handleResync} className="ui-btn ui-btn-ghost">
                Re-sync
              </button>
            </div>
          </div>
        </header>

        {/* Player card */}
        <section className="ui-card-strong p-5 rounded-[var(--r-xl)]">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-[var(--r-lg)] border border-[color:var(--border)] bg-[rgba(255,255,255,0.06)] overflow-hidden flex items-center justify-center">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt={username} className="w-full h-full object-cover" />
              ) : (
                <div className="text-[10px] ui-subtle px-2 text-center">No avatar</div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="ui-subtitle">Player</div>
              <div className="mt-1 text-lg font-extrabold truncate">{username}</div>
              <div className="text-[11px] ui-subtle truncate">Telegram ID: {tid}</div>
            </div>

            <div className="text-right">
              <div className="ui-subtitle">Level</div>
              <div className="mt-1 text-xl font-extrabold tabular-nums">{level ?? 1}</div>
            </div>
          </div>

          {/* Level progress */}
          <div className="mt-5">
            <div className="flex items-center justify-between gap-3">
              <div className="ui-subtitle">Progress</div>
              <div className="text-[11px] ui-subtle text-right tabular-nums">
                {currentLevelPower ?? 0} → {nextLevelPower ?? 100} power
              </div>
            </div>

            <div className="mt-2 ui-progress">
              <div style={{ width: `${levelProgressPercent}%` }} />
            </div>

            <div className="mt-1 text-[10px] ui-subtle text-right">
              {levelProgressPercent}% to next level
            </div>
          </div>
        </section>

        {/* Stats grid */}
        <section className="mt-4 ui-grid sm:grid-cols-3">
          <div className="ui-card p-4">
            <div className="ui-subtitle mb-2">Total Power</div>
            <div className="text-3xl font-extrabold tabular-nums">{totalPower ?? 0}</div>
            <div className="mt-2 text-[11px] ui-subtle">
              Items:{" "}
              <span className="font-semibold tabular-nums">
                {typeof itemsCount === "number" ? itemsCount : "—"}
              </span>
            </div>
          </div>

          <div className="ui-card p-4">
            <div className="ui-subtitle mb-2">Spins</div>
            <div className="text-3xl font-extrabold tabular-nums">{typeof spinsCount === "number" ? spinsCount : 0}</div>
            <div className="mt-2 text-[11px] ui-subtle truncate">Last: {lastSpinText}</div>
          </div>

          <div className="ui-card p-4">
            <div className="ui-subtitle mb-2">Shards Spent</div>
            <div className="text-3xl font-extrabold tabular-nums">
              {typeof totalShardsSpent === "number" ? totalShardsSpent : 0}
            </div>
            <div className="mt-2 text-[11px] ui-subtle">Economy telemetry</div>
          </div>
        </section>

        {/* Daily reward + stats */}
        <section className="mt-4 ui-grid sm:grid-cols-2">
          <div className="ui-card p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="ui-subtitle">Daily Reward</div>
                <div className="mt-1 text-sm ui-muted">Claim your shards every day</div>
              </div>

              {daily ? (
                <span
                  className={[
                    "ui-pill px-5 h-8 font-extrabold uppercase tracking-[0.22em]",
                    daily.canClaim
                      ? "border-[rgba(88,240,255,0.45)] bg-[rgba(88,240,255,0.08)]"
                      : "border-[rgba(255,255,255,0.22)] bg-[rgba(255,255,255,0.06)]",
                  ].join(" ")}
                >
                  {daily.canClaim ? "READY" : "LOCKED"}
                </span>
              ) : (
                <span className="ui-pill px-5 h-8 font-extrabold uppercase tracking-[0.22em]">
                  N/A
                </span>
              )}
            </div>

            {daily ? (
              <>
                <div className="mt-4 text-sm ui-subtle">
                  {daily.canClaim ? (
                    <>
                      Можно забрать{" "}
                      <span className="font-extrabold text-[color:var(--text)] tabular-nums">
                        +{daily.amount}
                      </span>{" "}
                      Shards сегодня.
                    </>
                  ) : (
                    <>
                      Уже забрал. До следующей:{" "}
                      <span className="font-extrabold text-[color:var(--text)] tabular-nums">
                        {formatRemaining(daily.remainingSeconds)}
                      </span>
                    </>
                  )}
                </div>

                <div className="mt-2 text-[11px] ui-subtle">
                  Streak: <span className="font-semibold tabular-nums">{daily.streak ?? 0}</span>
                </div>

                <div className="mt-4 flex items-center gap-3 flex-wrap">
                  <button
                    onClick={handleClaimDaily}
                    disabled={claimLoading || !daily.canClaim}
                    className={[
                      "ui-btn",
                      daily.canClaim ? "ui-btn-primary" : "ui-btn-ghost",
                    ].join(" ")}
                  >
                    {claimLoading
                      ? "Claiming..."
                      : daily.canClaim
                      ? `Claim +${daily.amount} Shards`
                      : "Already claimed"}
                  </button>

                  {(claimError || claimSuccess) && (
                    <span
                      className={[
                        "ui-pill",
                        claimError
                          ? "border-[rgba(255,90,90,0.35)] bg-[rgba(255,90,90,0.08)] text-red-200"
                          : "border-[rgba(88,240,255,0.35)] bg-[rgba(88,240,255,0.08)] text-white",
                      ].join(" ")}
                    >
                      {claimError ? claimError : claimSuccess}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div className="mt-4 text-sm ui-subtle">Daily info not available.</div>
            )}
          </div>

          <div className="ui-card p-5">
            <div className="ui-subtitle">Session</div>
            <div className="mt-2 text-sm ui-subtle">
              Telegram env:{" "}
              <span className="font-semibold text-[color:var(--text)]">OK</span>
            </div>
            <div className="mt-2 text-sm ui-subtle">
              Telegram ID:{" "}
              <span className="font-semibold text-[color:var(--text)] tabular-nums">{telegramId}</span>
            </div>

            <div className="mt-5">
              <button onClick={handleResync} className="ui-btn ui-btn-ghost w-full">
                Re-sync session
              </button>
              <div className="mt-3 text-[11px] ui-subtle text-center">
                If it glitches, reopen the Mini App from the bot.
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
