"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useGameSessionContext } from "../context/GameSessionContext";
import { Chest3D } from "../components/chest/Chest3D";

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
    const t = window.setTimeout(() => setShowGate(true), 1200);
    return () => window.clearTimeout(t);
  }, []);

  const [overrideBootstrap, setOverrideBootstrap] = useState<any | null>(null);

  const [result, setResult] = useState<ChestResponse | null>(null);
  const [opening, setOpening] = useState(false);

  // ✅ anti double-open guard
  const openingRef = useRef(false);

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

    // ✅ hard lock: no double open while request/animation in flight
    if (openingRef.current) return;
    openingRef.current = true;

    try {
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

      // ✅ fast open after reveal
      const minRevealMs = phase === "reveal" ? 450 : 1200;

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
    } finally {
      openingRef.current = false;
    }
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
      openingRef.current = false;
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

  const auraOpacity = fx === "legendary" ? 0.38 : fx === "epic" ? 0.26 : fx === "rare" ? 0.18 : 0;
  const confettiCount = fx === "legendary" ? 22 : fx === "epic" ? 14 : fx === "rare" ? 8 : 0;
  const bannerText = rarityBannerText(fx);

  const spinSpeed = fx === "legendary" ? 70 : fx === "epic" ? 95 : fx === "rare" ? 120 : 140;
  const shakeIntensity = fx === "legendary" ? 1.0 : fx === "epic" ? 0.85 : fx === "rare" ? 0.65 : 0.55;

  return (
    <main className="min-h-screen flex flex-col items-center pt-8 px-0 sm:px-4 pb-24 bg-gradient-to-b from-[#12141d] via-[#191d28] to-[#0d0f17]">
      <style jsx global>{`
        .altar-bg {
          pointer-events: none;
          position: absolute;
          inset: -8px;
          z-index: 0;
          border-radius: 2.5rem;
          overflow: hidden;
          background:
            radial-gradient(950px 380px at 50% -45px, #45e3ff2b 0%, transparent 70%),
            radial-gradient(580px 180px at 50% 420px, #ae41fa18 0%, transparent 70%),
            linear-gradient(135deg, rgba(48,54,74,0.065), rgba(92,80,156,0.02), transparent 100%);
        }
        @media (max-width: 600px) {
          .altar-bg {
            border-radius: 1.5rem;
          }
        }
        .altar-light-spot {
          pointer-events: none;
          position: absolute;
          z-index: 1;
          left: 50%;
          top: 55px;
          width: 370px;
          height: 90px;
          background: radial-gradient(
            ellipse 80% 50% at 50% 65%,
            rgba(255, 255, 255, 0.18),
            transparent 70%
          );
          transform: translateX(-50%);
          filter: blur(0.5px);
        }
        .altar-rings {
          pointer-events: none;
          position: absolute;
          z-index: 1;
          left: 50%;
          bottom: 0px;
          width: 300px;
          height: 80px;
          transform: translateX(-50%);
        }
        .altar-ring {
          position: absolute;
          left: 50%;
          bottom: 0;
          width: 320px;
          height: 32px;
          border-radius: 999px;
          border-width: 2px;
          border-style: solid;
          pointer-events: none;
          transform: translate(-50%, 0) scaleX(1.05);
          opacity: 0.12;
        }
        .altar-ring.epic {
          border-color: var(--rarity-epic);
          opacity: 0.16;
        }
        .altar-ring.legendary {
          border-color: var(--rarity-legendary);
          opacity: 0.19;
        }
        .altar-ring.rare {
          border-color: var(--rarity-rare);
        }
        .altar-ring.common {
          border-color: var(--rarity-common);
        }
        .altar-emissive {
          pointer-events: none;
          position: absolute;
          z-index: 2;
          left: 50%;
          bottom: 27px;
          width: 200px;
          height: 62px;
          transform: translateX(-50%);
          border-radius: 50%;
          background: radial-gradient(
            ellipse 60% 40% at 50% 60%,
            rgba(255, 255, 255, 0.15),
            transparent 74%
          );
        }
        @keyframes altarGlowPulse {
          0%,
          100% {
            opacity: 0.43;
          }
          54% {
            opacity: 0.68;
          }
        }
        .chest-area-premium {
          position: relative;
          min-height: 328px;
          padding-bottom: 0.5rem;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .altar-bg,
        .altar-light-spot,
        .altar-rings,
        .altar-emissive {
          transition: filter 0.18s;
        }
        .altar-emissive {
          animation: altarGlowPulse 3.2s ease-in-out infinite;
        }

        @keyframes chestSpin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes burstRing {
          0% {
            transform: scale(0.22);
            opacity: 0;
          }
          18% {
            opacity: 0.52;
          }
          68% {
            opacity: 0.84;
          }
          100% {
            transform: scale(1.6);
            opacity: 0;
          }
        }
        @keyframes flare {
          0% {
            transform: translateY(18px) scale(0.75);
            opacity: 0;
          }
          14% {
            opacity: 0.55;
          }
          46% {
            opacity: 0.96;
          }
          100% {
            transform: translateY(-46px) scale(1.21);
            opacity: 0;
          }
        }
        @keyframes shineSweep {
          0% {
            transform: translateX(-67%) skewY(-11deg);
            opacity: 0;
          }
          23% {
            opacity: 0.21;
          }
          54% {
            opacity: 0.28;
          }
          100% {
            transform: translateX(64%) skewY(-11deg);
            opacity: 0;
          }
        }
        .chest-spin-ring {
          position: absolute;
          z-index: 7;
          inset: -19px;
          border-radius: 999px;
          border: 2.1px solid color-mix(in srgb, var(--spin-color, #fff8) 44%, transparent);
          box-shadow: 0 0 0 2.5px color-mix(in srgb, var(--spin-color, #fff7) 16%, transparent),
            0 0 34px 2.8px color-mix(in srgb, var(--spin-color, #fff8) 19%, transparent);
          opacity: 0;
          transform: scale(0.91);
          transition: opacity 160ms cubic-bezier(0.5, 0.1, 1, 1),
            transform 160ms cubic-bezier(0.5, 0.1, 1, 1);
          pointer-events: none;
          will-change: opacity, transform;
        }
        .chest-spin-on .chest-spin-ring {
          opacity: 1;
          transform: scale(1.065);
        }
        .chest-spin-ring::before {
          content: "";
          position: absolute;
          z-index: 1;
          inset: -4px;
          border-radius: 999px;
          background: conic-gradient(
            from 0deg,
            transparent 2%,
            color-mix(in srgb, var(--spin-color, #fff8) 42%, transparent) 25%,
            transparent 50%,
            color-mix(in srgb, var(--spin-color, #fff8) 18%, transparent) 80%,
            transparent 100%
          );
          filter: blur(0.8px);
          animation: chestSpin var(--spin-speed, 110ms) linear infinite;
          opacity: 0.92;
        }
        .chest-burst-ring {
          position: absolute;
          left: 50%;
          top: 50%;
          z-index: 11;
          width: 256px;
          height: 256px;
          border-radius: 999px;
          transform: translate(-50%, -50%);
          border: 3px solid color-mix(in srgb, var(--spin-color, #fff8) 55%, transparent);
          box-shadow: 0 0 38px color-mix(in srgb, var(--spin-color, #fff8) 29%, transparent),
            0 0 108px color-mix(in srgb, var(--spin-color, #fff9) 21%, transparent);
          opacity: 0;
          pointer-events: none;
        }
        .chest-burst-on {
          animation: burstRing 530ms cubic-bezier(0.25, 1.41, 0.58, 1.01) 1;
        }
        .chest-flare {
          position: absolute;
          z-index: 12;
          left: 50%;
          bottom: 22px;
          width: 280px;
          height: 190px;
          transform: translateX(-50%);
          background: radial-gradient(
            100px 75px at 50% 76%,
            color-mix(in srgb, var(--spin-color, #fff8) 53%, transparent 51%),
            transparent 80%
          );
          filter: blur(2.6px);
          opacity: 0;
          pointer-events: none;
        }
        .chest-flare-on {
          animation: flare 580ms cubic-bezier(0.24, 1.11, 0.83, 0.98) 1;
        }
        .reveal-sweep {
          position: absolute;
          z-index: 16;
          top: -80px;
          left: -40px;
          right: -40px;
          height: 186px;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.79), transparent);
          opacity: 0.19;
          pointer-events: none;
          transform: skewY(-11deg);
        }
        .reveal-sweep-on {
          animation: shineSweep 840ms cubic-bezier(0.19, 1.16, 0.78, 0.93) 1;
        }

        .chest-3d-wrap {
          position: relative;
          width: 152px;
          height: 152px;
          margin: 0 auto;
          z-index: 5;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 1.2rem;
          overflow: visible;
        }
        .chest-3d-canvas {
          position: absolute;
          inset: -6px;
          z-index: 0;
          border-radius: 1.2rem;
          overflow: hidden;
          pointer-events: none;
          filter: drop-shadow(0 16px 44px rgba(0, 0, 0, 0.45));
        }
        @media (max-width: 768px) {
          .chest-3d-wrap {
            width: 120px;
            height: 120px;
          }
          .chest-burst-ring {
            width: 180px;
            height: 180px;
          }
          .chest-flare {
            width: 160px;
            height: 110px;
          }
        }
      `}</style>

      <div className="w-full max-w-3xl mx-auto">
        <div className="flex items-start justify-between mb-7 px-1">
          <div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-widest leading-snug text-slate-100 drop-shadow-[0_2px_10px_rgba(112,202,247,0.08)]">
              696 Chest
            </h1>
            <div className="text-base font-semibold text-[#99e4ffdd] tracking-wider mt-1 sm:mt-2 mb-1 select-none leading-none">
              Open. Reveal. Collect.
            </div>
          </div>
          <button onClick={handleResync} className="ui-btn ui-btn-ghost mt-1">
            Re-sync
          </button>
        </div>

        <div className="ui-grid grid-cols-2 mb-7 gap-4">
          <div className="ui-card p-6 shadow-[0_2px_16px_0_rgba(63,240,255,0.02)] bg-gradient-to-bl from-[#172331bb] to-[#121826] border border-[#222b3d] min-h-[108px]">
            <div className="ui-subtitle text-[#77e9fc] mb-0.5 tracking-wide uppercase">Balance</div>
            <div className="mt-4 text-base flex items-center justify-between">
              <span className="ui-subtle tracking-wide">Shards</span>
              <span className="font-semibold tabular-nums text-xl text-cyan-200">{soft}</span>
            </div>
            <div className="mt-2 text-base flex items-center justify-between">
              <span className="ui-subtle tracking-wide">Crystals</span>
              <span className="font-semibold tabular-nums text-lg text-blue-300">{hard}</span>
            </div>
            {refreshing && <div className="mt-4 text-[12px] text-[#aaf8ff] opacity-80">Syncing...</div>}
          </div>

          <div className="ui-card p-6 shadow-[0_2px_16px_0_rgba(184,92,255,0.08)] bg-gradient-to-tr from-[#1c1736cc] to-[#131325] border border-[#211944] min-h-[108px]">
            <div className="ui-subtitle text-[#b48fff] mb-1.5 tracking-wide uppercase">Total Power</div>
            <div className="text-3xl font-extrabold mt-1 tabular-nums text-[#e7dfff] drop-shadow-[0_2px_16px_rgba(184,92,255,0.14)]">
              {totalPower}
            </div>
            <div className="text-xs ui-subtle mt-3 text-[#8589a2]">Updated after each drop.</div>
          </div>
        </div>

        <div className="ui-card p-7 py-10 relative bg-gradient-to-br from-[#202230e6] to-[#141423] border border-[#253a5e80] shadow-[0_10px_48px_0_rgba(0,68,230,.10)]">
          <div className="flex items-center justify-between gap-6 mb-2 select-none">
            <div>
              <div className="ui-subtitle text-[#99a5be] uppercase font-semibold tracking-wider text-sm">
                Basic Chest
              </div>
              <div className="text-sm text-[#afc8e4bb] mt-2 tracking-wide">
                Cost:{" "}
                <span className="font-extrabold text-cyan-100 tabular-nums text-lg">{CHEST_COST_SHARDS}</span>{" "}
                <span className="ui-subtle">Shards</span>
              </div>
            </div>

            <span
              className={`ui-pill px-5 h-8 font-bold tracking-widest uppercase ring-1 ring-offset-1 ${
                canAfford
                  ? "border-cyan-300 bg-gradient-to-r from-cyan-700/10 to-violet-800/0 text-cyan-100"
                  : "border-yellow-300 text-yellow-200 bg-yellow-500/5"
              }`}
            >
              {canAfford ? "READY" : `NEED ${CHEST_COST_SHARDS - soft}`}
            </span>
          </div>

          <div className="mt-9 flex justify-center relative z-0">
            <div className="chest-area-premium w-full max-w-sm min-h-[326px] flex items-center justify-center relative rounded-xl">
              <div className="altar-bg" />
              <div className="altar-light-spot" />
              <div className="altar-emissive" />
              <div className="altar-rings pointer-events-none">
                <div className="altar-ring common" />
                <div className="altar-ring rare" />
                <div className="altar-ring epic" />
                <div className="altar-ring legendary" />
              </div>

              <div
                className={[
                  "pointer-events-none absolute inset-0 z-[2]",
                  phase === "opening" ? "opacity-100" : "opacity-0",
                  "transition-opacity duration-200",
                ].join(" ")}
                style={{
                  background: `radial-gradient(540px 260px at 50% 33%, color-mix(in srgb, ${fxColor(
                    fx
                  )} 24%, transparent), transparent 66%)`,
                  opacity: phase === "opening" ? 0.47 : 0,
                  filter: phase === "opening" && fx === "legendary" ? "blur(1.3px) brightness(1.09)" : undefined,
                }}
              />

              <div className="relative z-10 text-center w-full">
                <div
                  className={["chest-3d-wrap mx-auto", phase === "opening" ? "chest-spin-on" : ""].join(" ")}
                  style={
                    {
                      ["--spin-color" as any]: fxColor(fx),
                      ["--spin-speed" as any]: `${spinSpeed}ms`,
                      ["--shake-k" as any]: String(shakeIntensity),
                    } as any
                  }
                >
                  <div className="chest-3d-canvas">
                    <Chest3D phase={phase} />
                  </div>

                  <div className="chest-spin-ring" />

                  <div
                    className={["chest-burst-ring", phase === "reveal" && !isError && drop ? "chest-burst-on" : ""].join(
                      " "
                    )}
                  />

                  <div
                    className={["chest-flare", phase === "reveal" && !isError && drop ? "chest-flare-on" : ""].join(" ")}
                    style={{
                      ["--spin-color" as any]: fxColor(fx),
                      ...(fx === "legendary" ? { filter: "blur(2.5px) brightness(1.15)" } : {}),
                    }}
                  />

                  {phase === "opening" && <div className="reveal-sweep reveal-sweep-on" />}
                </div>

                {phase === "opening" && (
                  <div className="mt-8 w-40 mx-auto">
                    <div className="ui-progress">
                      <div className="w-3/4 h-2 rounded bg-cyan-200/70 opacity-90 animate-pulse" />
                    </div>
                    <div className="mt-3 text-[12px] text-[#60e6ffcd] font-semibold">Spinning the matrix...</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {!canAfford && (
            <div className="mt-7 ui-card-strong p-5 text-center bg-yellow-900/10 border border-yellow-500/25 rounded-xl shadow">
              <div className="text-base font-bold text-yellow-100">Not enough Shards</div>
              <div className="text-xs ui-subtle mt-1 text-yellow-200/80">
                You need <span className="font-semibold tabular-nums">{CHEST_COST_SHARDS - soft}</span> more Shards to
                open this chest.
              </div>
              <a href="/" className="ui-btn ui-btn-ghost mt-3">
                Go to Home
              </a>
            </div>
          )}

          <div className="mt-7 flex flex-col items-center gap-4">
            <button
              onClick={handleOpenChest}
              disabled={opening || !canAfford}
              className={`ui-btn ui-btn-primary w-full max-w-sm py-3 text-lg font-bold tracking-wide rounded-md
                shadow-lg transition-all duration-100
                ${opening ? "bg-gradient-to-r from-cyan-800/40 to-indigo-800/40 saturate-150" : ""}
              `}
            >
              {opening ? "Opening..." : "Open Chest"}
            </button>

            <a
              href={INVENTORY_PATH}
              className="ui-btn ui-btn-ghost w-full max-w-sm !font-semibold rounded-md py-2.5 text-base"
            >
              Go to Inventory
            </a>

            <div className="text-[13px] ui-subtle text-center text-cyan-100/70 mt-1">
              Drops include emblems, items, characters and pets.
            </div>
          </div>
        </div>

        {showReveal && (
          <div className="mt-8 ui-card p-7 relative overflow-hidden bg-gradient-to-b from-[#1e232e] to-[#181726] rounded-2xl border border-[#234b6177] shadow-[0_10px_64px_rgba(63,240,255,0.06)]">
            {fx !== "none" && !isError && drop && (
              <div
                key={`banner-${fxSeed}`}
                className={[
                  "pointer-events-none absolute left-1/2 -translate-x-1/2 top-5",
                  "px-5 py-2 rounded-full ring-2 ring-inset",
                  "bg-gradient-to-r from-black/65 to-[#203456DE] backdrop-blur",
                  "text-xs tracking-[0.28em] font-extrabold uppercase drop-shadow-lg",
                  "motion-safe:animate-[bannerPop_820ms_ease-out_1]",
                ].join(" ")}
                style={{
                  borderColor: fxColor(fx),
                  boxShadow: `0 18px 110px color-mix(in srgb, ${fxColor(fx)} 45%, transparent)`,
                  color: ["legendary", "epic"].includes(fx) ? "#fff" : "var(--text)",
                  background:
                    fx === "legendary"
                      ? "linear-gradient(90deg,#1d191299,#fffbe2c0 36%,#fffac48b 67%,#34280599)"
                      : undefined,
                }}
              >
                {bannerText}
              </div>
            )}

            {isError ? (
              <div className="text-center p-3">
                <div className="text-sm font-bold text-red-300 tracking-wide">Error</div>
                <div className="mt-2 text-base text-red-200/80 font-semibold">
                  {result?.code === "INSUFFICIENT_FUNDS"
                    ? "Недостаточно Shards для открытия сундука."
                    : `Ошибка: ${result?.error}`}
                </div>
              </div>
            ) : drop ? (
              <div
                key={`reveal-${fxSeed}`}
                className="text-center motion-safe:animate-[popIn_340ms_ease-out_1] pt-4 pb-1"
                style={{ minHeight: 305 }}
              >
                <div className="text-lg font-black tracking-wider text-slate-50 drop-shadow mb-2">Drop</div>

                <div
                  className={[
                    "mx-auto w-36 h-36 rounded-[1.2rem] border-2 bg-gradient-to-tr from-[#237cae19] to-[#35246a13] overflow-hidden",
                    "shadow-[0_22px_76px_0_rgba(0,0,0,0.38)]",
                    rarityFxClass(drop.rarity),
                  ].join(" ")}
                  style={{
                    borderColor: `color-mix(in srgb, ${fxColor(fx)} 65%, rgba(255,255,255,0.25))`,
                    boxShadow: `0 0 0 2.3px color-mix(in srgb, ${fxColor(
                      fx
                    )} 41%, transparent), 0 22px 120px color-mix(in srgb, ${fxColor(fx)} 22%, transparent)`,
                  }}
                >
                  {drop.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={drop.image_url} alt={drop.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <div className="text-[13px] ui-subtle">NO IMAGE</div>
                    </div>
                  )}
                </div>

                <div className="mt-6 text-xl font-black text-[#f0f3f6] tracking-widest leading-none min-h-[32px]">
                  {drop.name}
                </div>

                <div className="mt-2 flex items-center justify-center gap-3 flex-wrap mb-1">
                  <span
                    className="ui-pill text-base px-7 py-2 font-extrabold ring-1 ring-inset"
                    style={{
                      borderColor: fxColor(fx),
                      color:
                        fx === "legendary" ? "#ffdf4a" : fx === "epic" ? "#e0cefe" : fx === "rare" ? "#abebff" : "var(--text)",
                      background:
                        fx === "legendary"
                          ? "linear-gradient(93deg,#f7e48fff 16%,#fff7dd88 61%,#fff4a4ff 90%)"
                          : fx === "epic"
                          ? "linear-gradient(90deg,#be80fd40 0%,#85e1ff24 100%)"
                          : fx === "rare"
                          ? "linear-gradient(93deg,#2cf2f680 30%,#fff7 60%,#bcdcff2a 100%)"
                          : undefined,
                    }}
                  >
                    {rarityLabel(drop.rarity)}
                  </span>

                  <span className="ui-pill text-base px-7 py-2 font-bold border border-cyan-200/30 bg-gradient-to-r from-cyan-300/10 to-slate-500/2 text-cyan-100">
                    POWER <span className="ml-2 font-extrabold tabular-nums">{drop.power_value}</span>
                  </span>
                </div>

                <div className="mt-5 text-base font-medium text-cyan-100/85">
                  Total Power after drop:{" "}
                  <span className="text-cyan-50 font-extrabold tabular-nums text-lg">
                    {typeof result?.totalPowerAfter === "number" ? result.totalPowerAfter : totalPower}
                  </span>
                </div>

                <div className="mt-7 flex gap-4 justify-center flex-wrap items-center">
                  <button
                    onClick={handleOpenAgain}
                    disabled={opening || !canAfford}
                    className={`ui-btn ui-btn-primary px-8 py-3 rounded-lg text-base font-bold shadow-md
                      ${opening ? "bg-gradient-to-r from-cyan-800/60 to-indigo-800/30 saturate-150" : ""}
                    `}
                  >
                    {opening ? "Opening..." : "Open again"}
                  </button>
                  <a
                    href={INVENTORY_PATH}
                    className="ui-btn ui-btn-ghost px-8 py-3 font-semibold rounded-lg text-base tracking-wide"
                  >
                    Inventory
                  </a>
                </div>

                {!canAfford && (
                  <div className="mt-5 text-[13px] ui-subtle text-cyan-100/80">
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
