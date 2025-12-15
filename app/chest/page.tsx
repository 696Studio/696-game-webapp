"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

type Phase = "idle" | "opening" | "reveal";

function normalizeRarity(rarity: string | null | undefined) {
  const r = String(rarity || "").trim().toLowerCase();
  if (r === "common" || r === "rare" || r === "epic" || r === "legendary") return r;
  return "common";
}

function rarityLabel(r: string | null | undefined) {
  return String(r || "").trim().toUpperCase() || "COMMON";
}

function rarityFxClass(r: string | null | undefined) {
  const rr = normalizeRarity(r);
  if (rr === "legendary") return "ui-rarity-legendary";
  if (rr === "epic") return "ui-rarity-epic";
  if (rr === "rare") return "ui-rarity-rare";
  return "ui-rarity-common";
}

type RarityFx = "none" | "rare" | "epic" | "legendary";
function rarityFx(r: string | null | undefined): RarityFx {
  const rr = normalizeRarity(r);
  if (rr === "legendary") return "legendary";
  if (rr === "epic") return "epic";
  if (rr === "rare") return "rare";
  return "none";
}

function rarityBannerText(fx: RarityFx) {
  if (fx === "legendary") return "LEGENDARY DROP";
  if (fx === "epic") return "EPIC DROP";
  if (fx === "rare") return "RARE DROP";
  return "";
}

function fxColor(fx: RarityFx) {
  if (fx === "legendary") return "var(--rarity-legendary)";
  if (fx === "epic") return "var(--rarity-epic)";
  if (fx === "rare") return "var(--rarity-rare)";
  return "var(--rarity-common)";
}

export default function ChestPage() {
  const { telegramId, bootstrap, isTelegramEnv, loading, error, timedOut, refreshSession } =
    useGameSessionContext() as any;

  const [showGate, setShowGate] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShowGate(true), 1200);
    return () => clearTimeout(t);
  }, []);

  const [overrideBootstrap, setOverrideBootstrap] = useState<any | null>(null);

  const [result, setResult] = useState<ChestResponse | null>(null);
  const [opening, setOpening] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [fxSeed, setFxSeed] = useState(0);
  const revealTimerRef = useRef<number | null>(null);

  const core = useMemo(() => unwrapCore(overrideBootstrap || bootstrap), [overrideBootstrap, bootstrap]);
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
    setPhase("idle");
    refreshSession?.();
  };

  async function openChestWithReveal() {
    if (!telegramId) return;

    if (!canAfford) {
      setResult({ error: "Insufficient funds", code: "INSUFFICIENT_FUNDS" });
      setPhase("reveal");
      setFxSeed((s) => s + 1);
      return;
    }

    if (revealTimerRef.current) {
      window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }

    setOpening(true);
    setResult(null);
    setPhase("opening");

    const minRevealMs = 1200;

    const animDone = new Promise<void>((resolve) => {
      revealTimerRef.current = window.setTimeout(() => {
        revealTimerRef.current = null;
        resolve();
      }, minRevealMs);
    });

    const fetchDone = (async () => {
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
        await refreshBootstrap(telegramId);
      } catch (e) {
        console.error(e);
        setResult({ error: "Request failed" });
      }
    })();

    await Promise.all([animDone, fetchDone]);

    setOpening(false);
    setPhase("reveal");
    setFxSeed((s) => s + 1);
  }

  const handleOpenChest = async () => {
    await openChestWithReveal();
  };

  const handleOpenAgain = async () => {
    setResult(null);
    await openChestWithReveal();
  };

  useEffect(() => {
    return () => {
      if (revealTimerRef.current) {
        window.clearTimeout(revealTimerRef.current);
        revealTimerRef.current = null;
      }
    };
  }, []);

  if (!isTelegramEnv) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-md ui-card p-5 text-center">
          <div className="text-lg font-semibold mb-2">Open in Telegram</div>
          <div className="text-sm ui-subtle">This page works only inside Telegram WebApp.</div>
        </div>
      </main>
    );
  }

  if (!hasCore) {
    if (!showGate || loading) {
      return (
        <main className="min-h-screen flex items-center justify-center px-4">
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

    if (timedOut || !!error) {
      return (
        <main className="min-h-screen flex items-center justify-center px-4">
          <div className="w-full max-w-md ui-card p-5">
            <div className="text-lg font-semibold">
              {timedOut ? "Connection timeout" : "Couldn’t load your session"}
            </div>

            <div className="mt-2 text-sm ui-subtle">
              {timedOut
                ? "Telegram or network didn’t respond in time. Tap Re-sync to try again."
                : "Something went wrong while syncing your profile."}
            </div>

            {error && (
              <div className="mt-4 p-3 rounded-[var(--r-md)] border border-[color:var(--border)] bg-[rgba(255,255,255,0.03)]">
                <div className="ui-subtitle mb-1">Details</div>
                <div className="text-xs break-words">{String(error)}</div>
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
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-md ui-card p-5 text-center">
          <div className="text-sm font-semibold">Loading...</div>
          <div className="mt-2 text-sm ui-subtle">Still syncing.</div>
        </div>
      </main>
    );
  }

  if (loading || !telegramId) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
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

  const drop = result?.drop;
  const isError = !!result?.error;
  const showReveal = phase === "reveal" && !!result;
  const fx = drop ? rarityFx(drop.rarity) : "none";

  const auraOpacity = fx === "legendary" ? 0.30 : fx === "epic" ? 0.22 : fx === "rare" ? 0.14 : 0;
  const confettiCount = fx === "legendary" ? 22 : fx === "epic" ? 14 : fx === "rare" ? 8 : 0;
  const bannerText = rarityBannerText(fx);

  const spinSpeed = fx === "legendary" ? 70 : fx === "epic" ? 95 : fx === "rare" ? 120 : 140;
  const shakeIntensity = fx === "legendary" ? 1.0 : fx === "epic" ? 0.85 : fx === "rare" ? 0.65 : 0.55;

  return (
    <main className="min-h-screen flex flex-col items-center pt-10 px-4 pb-24">
      {/* Chest UX v2 — local FX (UI only) */}
      <style jsx global>{`
        @keyframes chestFloat {
          0% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
          100% { transform: translateY(0); }
        }
        @keyframes chestShake {
          0% { transform: translateX(0) rotate(0deg); }
          20% { transform: translateX(-2px) rotate(-1deg); }
          40% { transform: translateX(2px) rotate(1deg); }
          60% { transform: translateX(-3px) rotate(-1.2deg); }
          80% { transform: translateX(3px) rotate(1.2deg); }
          100% { transform: translateX(0) rotate(0deg); }
        }
        @keyframes chestSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes chestCrack {
          0% { transform: scale(1); filter: brightness(1); }
          55% { transform: scale(1.02); filter: brightness(1.2); }
          100% { transform: scale(0.985); filter: brightness(0.95); }
        }
        @keyframes burstRing {
          0% { transform: scale(0.65); opacity: 0; }
          20% { opacity: 0.7; }
          100% { transform: scale(1.25); opacity: 0; }
        }
        @keyframes flare {
          0% { transform: translateY(12px) scale(0.75); opacity: 0; }
          18% { opacity: 0.9; }
          100% { transform: translateY(-42px) scale(1.12); opacity: 0; }
        }
        @keyframes shineSweep {
          0% { transform: translateX(-60%) skewY(-12deg); opacity: 0; }
          25% { opacity: 0.28; }
          100% { transform: translateX(60%) skewY(-12deg); opacity: 0; }
        }
        @keyframes popIn {
          from { transform: translateY(10px) scale(0.98); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes bannerPop {
          0% { transform: translate(-50%, -10px) scale(0.92); opacity: 0; }
          30% { opacity: 1; }
          100% { transform: translate(-50%, 0) scale(1); opacity: 1; }
        }
        @keyframes confettiFloat {
          0% { transform: translateY(0); opacity: 0; }
          15% { opacity: 0.8; }
          100% { transform: translateY(110px); opacity: 0; }
        }

        .chest-stage {
          position: relative;
          border-radius: var(--r-xl);
          overflow: hidden;
        }

        .chest-core {
          position: relative;
          width: 132px;
          height: 132px;
          border-radius: var(--r-xl);
          border: 1px solid rgba(255,255,255,0.18);
          background: rgba(0,0,0,0.30);
          box-shadow: 0 18px 70px rgba(0,0,0,0.35);
          display: flex;
          align-items: center;
          justify-content: center;
          will-change: transform, filter;
        }

        .chest-float-idle {
          animation: chestFloat 2.8s ease-in-out infinite;
        }

        .chest-opening {
          animation: chestShake 180ms ease-in-out infinite;
        }

        .chest-crack {
          animation: chestCrack 240ms ease-out 1;
        }

        .chest-spin-ring {
          position: absolute;
          inset: -14px;
          border-radius: 999px;
          border: 1.5px solid color-mix(in srgb, var(--spin-color, #fff8) 32%, transparent);
          box-shadow: 0 0 0 1px color-mix(in srgb, var(--spin-color, #fff8) 18%, transparent),
            0 0 22px color-mix(in srgb, var(--spin-color, #fff8) 14%, transparent);
          opacity: 0;
          transform: scale(0.95);
          transition: opacity 180ms ease, transform 180ms ease;
          pointer-events: none;
        }

        .chest-spin-on .chest-spin-ring {
          opacity: 1;
          transform: scale(1);
        }

        .chest-spin-ring::before {
          content: "";
          position: absolute;
          inset: -2px;
          border-radius: 999px;
          background: conic-gradient(
            from 0deg,
            transparent,
            color-mix(in srgb, var(--spin-color, #fff8) 38%, transparent),
            transparent,
            color-mix(in srgb, var(--spin-color, #fff8) 22%, transparent),
            transparent
          );
          filter: blur(0.4px);
          animation: chestSpin var(--spin-speed, 120ms) linear infinite;
          opacity: 0.9;
        }

        .chest-burst-ring {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 210px;
          height: 210px;
          border-radius: 999px;
          transform: translate(-50%, -50%);
          border: 2px solid color-mix(in srgb, var(--spin-color, #fff8) 42%, transparent);
          box-shadow: 0 0 26px color-mix(in srgb, var(--spin-color, #fff8) 20%, transparent);
          opacity: 0;
          pointer-events: none;
        }

        .chest-burst-on {
          animation: burstRing 420ms ease-out 1;
        }

        .chest-flare {
          position: absolute;
          left: 50%;
          bottom: 18px;
          width: 180px;
          height: 120px;
          transform: translateX(-50%);
          background: radial-gradient(
            80px 60px at 50% 70%,
            color-mix(in srgb, var(--spin-color, #fff8) 32%, transparent),
            transparent 70%
          );
          filter: blur(0.2px);
          opacity: 0;
          pointer-events: none;
        }

        .chest-flare-on {
          animation: flare 520ms ease-out 1;
        }

        .reveal-sweep {
          position: absolute;
          inset: -40px -40px auto -40px;
          height: 170px;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.65), transparent);
          opacity: 0.22;
          transform: skewY(-10deg);
          pointer-events: none;
        }

        .reveal-sweep-on {
          animation: shineSweep 900ms ease-out 1;
        }
      `}</style>

      <div className="w-full max-w-3xl">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 className="ui-title text-696">696 Chest</h1>
            <div className="ui-subtitle mt-2">Open. Reveal. Collect.</div>
          </div>

          <button onClick={handleResync} className="ui-btn ui-btn-ghost">
            Re-sync
          </button>
        </div>

        <div className="ui-grid grid-cols-2 mb-5">
          <div className="ui-card p-4">
            <div className="ui-subtitle">Balance</div>
            <div className="mt-3 text-sm flex items-center justify-between">
              <span className="ui-subtle">Shards</span>
              <span className="font-semibold tabular-nums">{soft}</span>
            </div>
            <div className="mt-2 text-sm flex items-center justify-between">
              <span className="ui-subtle">Crystals</span>
              <span className="font-semibold tabular-nums">{hard}</span>
            </div>
            {refreshing && <div className="mt-3 text-[11px] ui-subtle">Syncing...</div>}
          </div>

          <div className="ui-card p-4">
            <div className="ui-subtitle">Total Power</div>
            <div className="text-3xl font-semibold mt-3 tabular-nums">{totalPower}</div>
            <div className="text-xs ui-subtle mt-2">Updated after each drop.</div>
          </div>
        </div>

        <div className="ui-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="ui-subtitle">Basic Chest</div>
              <div className="text-sm ui-muted mt-1">
                Cost: <span className="font-semibold tabular-nums">{CHEST_COST_SHARDS}</span>{" "}
                <span className="ui-subtle">Shards</span>
              </div>
            </div>

            <span className="ui-pill">{canAfford ? "READY" : `NEED ${CHEST_COST_SHARDS - soft}`}</span>
          </div>

          {/* Stage */}
          <div className="mt-5 flex justify-center">
            <div className="w-full max-w-sm h-48 chest-stage border border-[color:var(--border)] bg-[rgba(255,255,255,0.04)] flex items-center justify-center relative">
              {/* background gradients */}
              <div
                className="pointer-events-none absolute inset-0 opacity-90"
                style={{
                  background:
                    "radial-gradient(680px 280px at 50% -15%, rgba(88,240,255,0.16), transparent 60%), radial-gradient(680px 280px at 50% 115%, rgba(184,92,255,0.12), transparent 60%)",
                }}
              />

              {/* opening ring (fx-colored only on reveal, but animated during opening) */}
              <div
                className={[
                  "pointer-events-none absolute inset-0",
                  phase === "opening" ? "opacity-100" : "opacity-0",
                  "transition-opacity duration-200",
                ].join(" ")}
                style={{
                  background: `radial-gradient(520px 240px at 50% 40%, color-mix(in srgb, ${fxColor(
                    fx
                  )} 18%, transparent), transparent 60%)`,
                  opacity: phase === "opening" ? 0.55 : 0,
                }}
              />

              <div className="relative z-10 text-center">
                {/* Chest core */}
                <div
                  className={[
                    "mx-auto chest-core",
                    phase === "idle" ? "chest-float-idle" : "",
                    phase === "opening" ? "chest-opening chest-spin-on" : "",
                    phase === "reveal" && !isError && drop ? "chest-crack" : "",
                  ].join(" ")}
                  style={
                    {
                      // spin color and speed are CSS variables (UI only)
                      ["--spin-color" as any]: fxColor(fx),
                      ["--spin-speed" as any]: `${spinSpeed}ms`,
                      // keep shake intensity as subtle multiplier if needed later
                      ["--shake-k" as any]: String(shakeIntensity),
                    } as any
                  }
                >
                  {/* spinning ring */}
                  <div className="chest-spin-ring" />
                  {/* burst ring on reveal */}
                  <div
                    className={[
                      "chest-burst-ring",
                      phase === "reveal" && !isError && drop ? "chest-burst-on" : "",
                    ].join(" ")}
                  />
                  {/* flare on reveal */}
                  <div
                    className={[
                      "chest-flare",
                      phase === "reveal" && !isError && drop ? "chest-flare-on" : "",
                    ].join(" ")}
                    style={{
                      ["--spin-color" as any]: fxColor(fx),
                    }}
                  />

                  {/* icon/content */}
                  <div className="relative z-10 text-center px-3">
                    <div className="text-[11px] ui-subtle font-semibold tracking-[0.22em]">
                      {phase === "opening" ? "ROLLING..." : "CHEST"}
                    </div>
                    <div className="mt-2 text-[10px] ui-subtle opacity-80">
                      {phase === "opening" ? "Decrypting drop" : "Tap Open to roll a drop"}
                    </div>
                  </div>

                  {/* subtle shine sweep during opening */}
                  {phase === "opening" && <div className="reveal-sweep reveal-sweep-on" />}
                </div>

                {/* progress */}
                {phase === "opening" && (
                  <div className="mt-4">
                    <div className="ui-progress">
                      <div className="w-2/3 opacity-90 animate-pulse" />
                    </div>
                    <div className="mt-2 text-[11px] ui-subtle">Spinning the matrix...</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {!canAfford && (
            <div className="mt-5 ui-card-strong p-4 text-center">
              <div className="text-sm font-semibold">Not enough Shards</div>
              <div className="text-xs ui-subtle mt-1">
                You need{" "}
                <span className="font-semibold tabular-nums">{CHEST_COST_SHARDS - soft}</span> more
                Shards to open this chest.
              </div>
              <a href="/" className="ui-btn ui-btn-ghost mt-3">
                Go to Home
              </a>
            </div>
          )}

          <div className="mt-5 flex flex-col items-center gap-3">
            <button
              onClick={handleOpenChest}
              disabled={opening || !canAfford}
              className="ui-btn ui-btn-primary w-full max-w-sm"
            >
              {opening ? "Opening..." : "Open Chest"}
            </button>

            <a href={INVENTORY_PATH} className="ui-btn ui-btn-ghost w-full max-w-sm">
              Go to Inventory
            </a>

            <div className="text-[11px] ui-subtle text-center">
              Drops include emblems, items, characters and pets.
            </div>
          </div>
        </div>

        {/* Reveal */}
        {showReveal && (
          <div className="mt-5 ui-card p-5 relative overflow-hidden">
            {fx !== "none" && !isError && drop && (
              <div
                key={`banner-${fxSeed}`}
                className={[
                  "pointer-events-none absolute left-1/2 -translate-x-1/2 top-4",
                  "px-4 py-2 rounded-full border",
                  "bg-[rgba(0,0,0,0.35)] backdrop-blur",
                  "text-[11px] tracking-[0.28em] uppercase",
                  "motion-safe:animate-[bannerPop_780ms_ease-out_1]",
                ].join(" ")}
                style={{
                  borderColor: fxColor(fx),
                  boxShadow: `0 18px 80px color-mix(in srgb, ${fxColor(fx)} 22%, transparent)`,
                }}
              >
                {bannerText}
              </div>
            )}

            {fx !== "none" && !isError && drop && (
              <>
                <div
                  key={`aura-${fxSeed}`}
                  className="pointer-events-none absolute inset-0"
                  style={{
                    opacity: auraOpacity,
                    background: `radial-gradient(540px 260px at 50% 20%, color-mix(in srgb, ${fxColor(
                      fx
                    )} 65%, white 10%), transparent 60%),
                                radial-gradient(820px 420px at 50% 115%, color-mix(in srgb, ${fxColor(
                                  fx
                                )} 45%, transparent), transparent 60%)`,
                  }}
                />

                <div
                  key={`shine-${fxSeed}`}
                  className="pointer-events-none absolute -inset-x-10 top-[-60px] h-48 opacity-[0.22] motion-safe:animate-[shineSweep_900ms_ease-out_1]"
                  style={{
                    background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.70), transparent)",
                    transform: "skewY(-10deg)",
                  }}
                />

                <div key={`confetti-${fxSeed}`} className="pointer-events-none absolute inset-0 overflow-hidden">
                  {Array.from({ length: confettiCount }).map((_, i) => {
                    const left = (i * (100 / Math.max(1, confettiCount))) % 100;
                    const delay = (i % 6) * 70;
                    const size = i % 3 === 0 ? 7 : i % 3 === 1 ? 5 : 3;

                    return (
                      <span
                        key={i}
                        className="absolute rounded-full"
                        style={{
                          left: `${left}%`,
                          top: `${10 + (i % 5) * 10}%`,
                          width: `${size}px`,
                          height: `${size}px`,
                          opacity: 0.6,
                          backgroundColor: fxColor(fx),
                          filter: "blur(0.2px)",
                          animation: `confettiFloat 900ms ease-out ${delay}ms 1`,
                        }}
                      />
                    );
                  })}
                </div>
              </>
            )}

            {isError ? (
              <div className="text-center">
                <div className="text-sm font-semibold text-red-300">Error</div>
                <div className="mt-1 text-sm text-red-200/80">
                  {result?.code === "INSUFFICIENT_FUNDS"
                    ? "Недостаточно Shards для открытия сундука."
                    : `Ошибка: ${result?.error}`}
                </div>
              </div>
            ) : drop ? (
              <div key={`reveal-${fxSeed}`} className="text-center motion-safe:animate-[popIn_260ms_ease-out_1]">
                <div className="ui-subtitle mb-2">Drop</div>

                <div
                  className={[
                    "mx-auto w-32 h-32 rounded-[var(--r-xl)] border bg-[rgba(255,255,255,0.04)] overflow-hidden",
                    "shadow-[0_18px_70px_rgba(0,0,0,0.35)]",
                    rarityFxClass(drop.rarity),
                  ].join(" ")}
                  style={{
                    borderColor: `color-mix(in srgb, ${fxColor(fx)} 45%, rgba(255,255,255,0.22))`,
                    boxShadow: `0 0 0 1.8px color-mix(in srgb, ${fxColor(
                      fx
                    )} 28%, transparent), 0 20px 90px color-mix(in srgb, ${fxColor(fx)} 14%, transparent)`,
                  }}
                >
                  {drop.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={drop.image_url} alt={drop.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <div className="text-[11px] ui-subtle">NO IMAGE</div>
                    </div>
                  )}
                </div>

                <div className="mt-4 text-lg font-semibold">{drop.name}</div>

                <div className="mt-1 flex items-center justify-center gap-2 flex-wrap">
                  <span className="ui-pill" style={{ borderColor: fxColor(fx), color: "var(--text)" }}>
                    {rarityLabel(drop.rarity)}
                  </span>
                  <span className="ui-pill">
                    POWER <span className="ml-1 font-semibold tabular-nums">{drop.power_value}</span>
                  </span>
                </div>

                <div className="mt-3 text-xs ui-subtle">
                  Total Power after drop:{" "}
                  <span className="text-[color:var(--text)] font-semibold tabular-nums">
                    {typeof result?.totalPowerAfter === "number" ? result.totalPowerAfter : totalPower}
                  </span>
                </div>

                <div className="mt-5 flex gap-3 justify-center flex-wrap">
                  <button onClick={handleOpenAgain} disabled={opening || !canAfford} className="ui-btn ui-btn-primary">
                    {opening ? "Opening..." : "Open again"}
                  </button>

                  <a href={INVENTORY_PATH} className="ui-btn ui-btn-ghost">
                    Inventory
                  </a>
                </div>

                {!canAfford && (
                  <div className="mt-3 text-[11px] ui-subtle">
                    Need <span className="font-semibold tabular-nums">{CHEST_COST_SHARDS - soft}</span> more Shards.
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}
