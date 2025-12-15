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
      <main className="min-h-screen flex items-center justify-center px-4 pb-24">
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
        <main className="min-h-screen flex items-center justify-center px-4 pb-24">
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
        <main className="min-h-screen flex items-center justify-center px-4 pb-24">
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
                <button
                  onClick={handleResync}
                  className="ui-btn ui-btn-primary w-full"
                >
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
      <main className="min-h-screen flex items-center justify-center px-4 pb-24">
        <div className="w-full max-w-md ui-card p-5 text-center">
          <div className="text-sm font-semibold">Loading...</div>
          <div className="mt-2 text-sm ui-subtle">Still syncing.</div>
        </div>
      </main>
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
  const displayName = user.username || user.first_name || "Unknown";

  return (
    <main className="min-h-screen px-4 pt-6 pb-24 flex justify-center">
      <div className="w-full max-w-5xl">
        {/* Top HUD */}
        <header className="ui-card px-4 py-3 rounded-[var(--r-xl)] mb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="ui-subtitle">696 Game</div>
              <div className="mt-1 flex items-center gap-2 min-w-0">
                <div className="font-extrabold uppercase tracking-[0.22em] text-base truncate">
                  {displayName}
                </div>
                <span className="ui-pill">LVL {level}</span>
              </div>
              <div className="text-[11px] ui-subtle mt-1">
                ID:{" "}
                <span className="text-[color:var(--text)]">
                  {user.telegram_id || telegramId}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="ui-pill">
                Shards{" "}
                <span className="ml-2 font-extrabold tabular-nums">
                  {formatCompact(balance.soft_balance)}
                </span>
              </div>
              <div className="ui-pill">
                Crystals{" "}
                <span className="ml-2 font-extrabold tabular-nums">
                  {formatCompact(balance.hard_balance)}
                </span>
              </div>

              <button onClick={handleResync} className="ui-btn ui-btn-ghost">
                Re-sync
              </button>
            </div>
          </div>

          {/* XP / Power bar */}
          <div className="mt-3">
            <div className="flex items-end justify-between">
              <div className="ui-subtitle">POWER PROGRESS</div>
              <div className="text-xs font-semibold tabular-nums">
                {progressPercent}%
              </div>
            </div>
            <div className="mt-2 ui-progress">
              <div
                className="transition-[width] duration-700 ease-out"
                style={{
                  width: `${Math.min(100, Math.max(0, progressPercent))}%`,
                }}
              />
            </div>
          </div>
        </header>

        {/* Lobby grid */}
        <section className="grid gap-4 lg:grid-cols-[340px_1fr_340px] items-start">
          {/* Left: Missions / Medals */}
          <aside className="ui-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="ui-subtitle">Missions</div>
                <div className="text-sm ui-muted mt-1">
                  Grind → Level → Better drops
                </div>
              </div>
              <span className="ui-pill">{formatCompact(spinsCount)} spins</span>
            </div>

            <div className="mt-4 grid gap-3">
              <div className="ui-card p-3">
                <div className="flex items-center justify-between">
                  <div className="ui-subtitle">Total Power</div>
                  <span className="ui-pill">{progressPercent}%</span>
                </div>
                <div className="text-2xl font-semibold mt-2 tabular-nums">
                  {formatCompact(totalPower)}
                </div>
                <div className="text-xs ui-subtle mt-2">
                  Open chests & collect items to grow.
                </div>
              </div>

              <div className="ui-card p-3">
                <div className="ui-subtitle">Economy</div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="ui-subtle">Spent Shards</span>
                  <span className="font-semibold tabular-nums">
                    {formatCompact(totalShardsSpent)}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="ui-subtle">Status</span>
                  <span className="ui-pill">Connected</span>
                </div>
              </div>

              {/* Daily as a “quest” */}
              <div className="ui-card p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="ui-subtitle">Daily Shards</div>
                    <div className="text-xs ui-subtle mt-1">
                      Reward{" "}
                      <span className="text-[color:var(--text)] font-semibold tabular-nums">
                        {formatCompact(daily.amount)}
                      </span>{" "}
                      Shards • Streak{" "}
                      <span className="text-[color:var(--text)] font-semibold tabular-nums">
                        {daily.streak}
                      </span>
                    </div>
                  </div>

                  <span className="ui-pill">
                    {daily.canClaim
                      ? "READY"
                      : `NEXT ~${formatHours(daily.remainingSeconds)}`}
                  </span>
                </div>

                {daily.canClaim && (
                  <button
                    onClick={handleClaimDaily}
                    disabled={claimLoading || !telegramId}
                    className="ui-btn ui-btn-primary w-full mt-3"
                  >
                    {claimLoading ? "Claiming..." : "Claim Daily"}
                  </button>
                )}

                {claimError && (
                  <div className="mt-2 text-xs text-red-400 break-words">
                    {claimError}
                  </div>
                )}
              </div>
            </div>
          </aside>

          {/* Center: Character “stage” */}
          <div className="ui-card-strong p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="ui-subtitle">Lobby</div>
                <div className="text-sm ui-muted mt-1">
                  Your avatar (placeholder) • cosmetics later
                </div>
              </div>
              <span className="ui-pill">EU</span>
            </div>

            {/* Stage */}
            <div className="mt-4 relative overflow-hidden rounded-[var(--r-xl)] border border-[color:var(--border)] bg-[rgba(255,255,255,0.04)]">
              {/* Background grid-ish glow */}
              <div
                className="absolute inset-0 opacity-90"
                style={{
                  background:
                    "radial-gradient(700px 420px at 50% 20%, rgba(88,240,255,0.18), transparent 60%), radial-gradient(740px 520px at 70% 40%, rgba(184,92,255,0.14), transparent 62%), linear-gradient(to bottom, rgba(255,255,255,0.03), transparent 42%, rgba(0,0,0,0.18))",
                }}
              />

              {/* “Avatar” silhouette block */}
              <div className="relative px-6 py-8 flex flex-col items-center">
                <div className="ui-pill mb-3">OUTFIT: DEFAULT</div>

                <div className="relative w-[220px] h-[320px]">
                  {/* platform */}
                  <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-[240px] h-[72px] rounded-full blur-[0.2px] border border-[rgba(88,240,255,0.25)] bg-[radial-gradient(circle_at_50%_40%,rgba(88,240,255,0.20),rgba(0,0,0,0)_65%)]" />
                  <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 w-[260px] h-[90px] rounded-full blur-[18px] bg-[rgba(88,240,255,0.12)]" />

                  {/* silhouette */}
                  <div className="absolute inset-0 rounded-[26px] border border-[rgba(255,255,255,0.14)] bg-[linear-gradient(180deg,rgba(255,255,255,0.10),rgba(255,255,255,0.04))] shadow-[0_24px_80px_rgba(0,0,0,0.28)]" />
                  <div className="absolute inset-0 rounded-[26px] pointer-events-none opacity-70 mix-blend-screen bg-[linear-gradient(145deg,rgba(255,255,255,0.18),rgba(255,255,255,0.06),transparent_52%)]" />

                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center px-4">
                      <div className="ui-subtitle">PLAYER</div>
                      <div className="mt-2 text-xl font-extrabold uppercase tracking-[0.18em]">
                        {displayName}
                      </div>
                      <div className="mt-2 text-xs ui-subtle">
                        Character rendering comes later (items/pets first).
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-2 justify-center">
                  <span className="ui-pill">POWER {formatCompact(totalPower)}</span>
                  <span className="ui-pill">LEVEL {level}</span>
                  <span className="ui-pill">SPINS {formatCompact(spinsCount)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Big CTA (Play) */}
          <aside className="ui-card p-4">
            <div className="ui-subtitle">Quick Actions</div>
            <div className="text-sm ui-muted mt-1">
              Jump straight into the loop.
            </div>

            <div className="mt-4 grid gap-3">
              <a href="/chest" className="ui-btn ui-btn-primary w-full">
                PLAY
              </a>

              <a href="/inventory" className="ui-btn w-full">
                INSPECT LOOT
              </a>

              <div className="ui-card p-3">
                <div className="ui-subtitle">Tip</div>
                <div className="text-xs ui-subtle mt-2">
                  Next polish: Chest opening “altar”, fog, rays, reveal FX.
                </div>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
