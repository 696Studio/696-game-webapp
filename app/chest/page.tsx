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

function fxClassFor(fx: RarityFx) {
  if (fx === "legendary") return "ui-fx ui-fx-legendary";
  if (fx === "epic") return "ui-fx ui-fx-epic";
  if (fx === "rare") return "ui-fx ui-fx-rare";
  return "ui-fx ui-fx-common";
}


function normalizeDropImageUrl(url: string | null | undefined) {
  if (!url) return null;

  // Keep absolute URLs / Supabase public URLs intact
  if (/^https?:\/\//i.test(url)) return url;

  // Normalize leading slash
  const u = url.startsWith("/") ? url : `/${url}`;

  // Migration: items -> cards/art
  if (u.startsWith("/items/characters/")) return u.replace("/items/characters/", "/cards/art/characters/");
  if (u.startsWith("/items/pets/")) return u.replace("/items/pets/", "/cards/art/pets/");

  return u;
}

const CARD_FRAME_URL = "/cards/frame/frame_common.png";

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

  // Reveal overlay short life timer (so it feels like impact)
  const [revealOverlayOn, setRevealOverlayOn] = useState(false);
  const revealOverlayTimerRef = useRef<number | null>(null);

  const core = useMemo(
    () => unwrapCore(overrideBootstrap || bootstrap),
    [overrideBootstrap, bootstrap]
  );
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
    setRevealOverlayOn(false);
    if (revealOverlayTimerRef.current) {
      window.clearTimeout(revealOverlayTimerRef.current);
      revealOverlayTimerRef.current = null;
    }
    refreshSession?.();
  };

  const triggerRevealOverlay = () => {
    setRevealOverlayOn(true);
    if (revealOverlayTimerRef.current) window.clearTimeout(revealOverlayTimerRef.current);
    revealOverlayTimerRef.current = window.setTimeout(() => {
      setRevealOverlayOn(false);
      revealOverlayTimerRef.current = null;
    }, 720);
  };

  async function openChestWithReveal() {
    if (!telegramId) return;

    if (openingRef.current) return;
    openingRef.current = true;

    try {
      if (!canAfford) {
        setResult({ error: "Insufficient funds", code: "INSUFFICIENT_FUNDS" });
        setPhase("reveal");
        setFxSeed((s) => s + 1);
        triggerRevealOverlay();
        return;
      }

      if (revealTimerRef.current) {
        window.clearTimeout(revealTimerRef.current);
        revealTimerRef.current = null;
      }

      setOpening(true);
      setResult(null);
      setPhase("opening");

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
      triggerRevealOverlay();
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
      if (revealOverlayTimerRef.current) {
        window.clearTimeout(revealOverlayTimerRef.current);
        revealOverlayTimerRef.current = null;
      }
      openingRef.current = false;
    };
  }, []);

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

  if (!hasCore) {
    if (!showGate || loading) {
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

    if (timedOut || !!error) {
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
      <main className="min-h-screen flex items-center justify-center px-4 pb-24">
        <div className="w-full max-w-md ui-card p-5 text-center">
          <div className="text-sm font-semibold">Loading...</div>
          <div className="mt-2 text-sm ui-subtle">Still syncing.</div>
        </div>
      </main>
    );
  }

  if (loading || !telegramId) {
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

  const drop = result?.drop;
  const isError = !!result?.error;
  const showReveal = phase === "reveal" && !!result;
  const fx = drop ? rarityFx(drop.rarity) : "none";
  const bannerText = rarityBannerText(fx);
  const glow = fxColor(fx);

  // overlay should feel like an impact only on successful drop reveal
  const showImpactOverlay = revealOverlayOn && showReveal && !isError && !!drop && fx !== "none";
  const overlayGlow = fx !== "none" ? glow : "var(--accent)";

  return (
    <main className="min-h-screen px-4 pt-6 pb-24 flex justify-center">
      <style jsx global>{`
        @keyframes bannerPop {
          0% {
            transform: translateX(-50%) translateY(-10px) scale(0.92);
            opacity: 0;
          }
          65% {
            transform: translateX(-50%) translateY(0) scale(1.03);
            opacity: 1;
          }
          100% {
            transform: translateX(-50%) translateY(0) scale(1);
            opacity: 1;
          }
        }
        @keyframes popIn {
          from {
            transform: translateY(16px) scale(0.985);
            opacity: 0;
          }
          to {
            transform: translateY(0) scale(1);
            opacity: 1;
          }
        }
        @keyframes altarFog {
          0% {
            transform: translateX(-6%) translateY(0);
            opacity: 0.25;
          }
          50% {
            transform: translateX(6%) translateY(-2%);
            opacity: 0.4;
          }
          100% {
            transform: translateX(-6%) translateY(0);
            opacity: 0.25;
          }
        }
        @keyframes altarRays {
          0% {
            opacity: 0.18;
            transform: translateY(0);
          }
          50% {
            opacity: 0.32;
            transform: translateY(-1%);
          }
          100% {
            opacity: 0.18;
            transform: translateY(0);
          }
        }

        /* =========================
           REVEAL IMPACT OVERLAY (full screen)
        ========================== */
        @keyframes revealFlash {
          0% {
            opacity: 0;
            transform: scale(0.98);
            filter: blur(0px);
          }
          14% {
            opacity: 1;
            transform: scale(1);
            filter: blur(0.5px);
          }
          100% {
            opacity: 0;
            transform: scale(1.02);
            filter: blur(1.6px);
          }
        }
        @keyframes particleDriftA {
          0% {
            transform: translate3d(-6%, 8%, 0) scale(1);
            opacity: 0.0;
          }
          12% {
            opacity: 0.55;
          }
          100% {
            transform: translate3d(8%, -10%, 0) scale(1.03);
            opacity: 0;
          }
        }
        @keyframes particleDriftB {
          0% {
            transform: translate3d(10%, 10%, 0) scale(1);
            opacity: 0.0;
          }
          10% {
            opacity: 0.42;
          }
          100% {
            transform: translate3d(-8%, -12%, 0) scale(1.05);
            opacity: 0;
          }
        }

        .reveal-overlay {
          position: fixed;
          inset: 0;
          z-index: 80;
          pointer-events: none;
          animation: revealFlash 720ms cubic-bezier(0.18, 0.8, 0.2, 1) 1;
          mix-blend-mode: screen;
        }

        .reveal-overlay::before {
          content: "";
          position: absolute;
          inset: -20px;
          background:
            radial-gradient(1100px 540px at 50% 18%,
              color-mix(in srgb, var(--revealGlow) 30%, transparent) 0%,
              transparent 62%
            ),
            radial-gradient(900px 520px at 65% 28%,
              color-mix(in srgb, var(--revealGlow) 18%, transparent) 0%,
              transparent 66%
            ),
            linear-gradient(to bottom,
              rgba(255,255,255,0.05),
              transparent 45%,
              rgba(0,0,0,0.18)
            );
          opacity: 0.95;
          filter: blur(0.2px);
        }

        .reveal-overlay::after {
          content: "";
          position: absolute;
          inset: -40px;
          background:
            radial-gradient(2px 2px at 12% 34%, rgba(255,255,255,0.55), transparent 60%),
            radial-gradient(2px 2px at 18% 54%, rgba(255,255,255,0.42), transparent 60%),
            radial-gradient(2px 2px at 26% 28%, rgba(255,255,255,0.32), transparent 60%),
            radial-gradient(2px 2px at 33% 62%, rgba(255,255,255,0.44), transparent 60%),
            radial-gradient(2px 2px at 41% 38%, rgba(255,255,255,0.30), transparent 60%),
            radial-gradient(2px 2px at 52% 24%, rgba(255,255,255,0.45), transparent 60%),
            radial-gradient(2px 2px at 58% 58%, rgba(255,255,255,0.36), transparent 60%),
            radial-gradient(2px 2px at 66% 36%, rgba(255,255,255,0.40), transparent 60%),
            radial-gradient(2px 2px at 74% 52%, rgba(255,255,255,0.34), transparent 60%),
            radial-gradient(2px 2px at 82% 30%, rgba(255,255,255,0.42), transparent 60%),
            radial-gradient(2px 2px at 88% 62%, rgba(255,255,255,0.30), transparent 60%),
            radial-gradient(2px 2px at 92% 42%, rgba(255,255,255,0.38), transparent 60%);
          opacity: 0;
          animation: particleDriftA 720ms cubic-bezier(0.18, 0.8, 0.2, 1) 1;
        }

        .reveal-overlay .particles {
          position: absolute;
          inset: -40px;
          background:
            radial-gradient(2px 2px at 14% 24%, rgba(255,255,255,0.40), transparent 60%),
            radial-gradient(2px 2px at 22% 72%, rgba(255,255,255,0.34), transparent 60%),
            radial-gradient(2px 2px at 36% 42%, rgba(255,255,255,0.30), transparent 60%),
            radial-gradient(2px 2px at 44% 68%, rgba(255,255,255,0.38), transparent 60%),
            radial-gradient(2px 2px at 56% 36%, rgba(255,255,255,0.34), transparent 60%),
            radial-gradient(2px 2px at 64% 78%, rgba(255,255,255,0.30), transparent 60%),
            radial-gradient(2px 2px at 76% 46%, rgba(255,255,255,0.40), transparent 60%),
            radial-gradient(2px 2px at 84% 70%, rgba(255,255,255,0.34), transparent 60%),
            radial-gradient(2px 2px at 90% 30%, rgba(255,255,255,0.32), transparent 60%);
          opacity: 0;
          animation: particleDriftB 720ms cubic-bezier(0.18, 0.8, 0.2, 1) 1;
          mix-blend-mode: screen;
        }

        /* =========================
           RARITY WAVE (under banner)
        ========================== */
        @keyframes rarityWave {
          0% {
            transform: translateX(-50%) scaleX(0.55);
            opacity: 0;
            filter: blur(10px);
          }
          18% {
            opacity: 0.88;
          }
          100% {
            transform: translateX(-50%) scaleX(1.18);
            opacity: 0;
            filter: blur(18px);
          }
        }

        .rarity-wave {
          pointer-events: none;
          position: absolute;
          left: 50%;
          top: 40px;
          width: min(680px, 92%);
          height: 96px;
          transform: translateX(-50%);
          background:
            radial-gradient(closest-side at 50% 50%,
              color-mix(in srgb, var(--waveGlow) 28%, transparent) 0%,
              transparent 70%
            ),
            radial-gradient(closest-side at 50% 60%,
              color-mix(in srgb, var(--waveGlow) 16%, transparent) 0%,
              transparent 74%
            );
          animation: rarityWave 860ms cubic-bezier(0.18, 0.8, 0.2, 1) 1;
          mix-blend-mode: screen;
        }

        /* =========================
           ALTAR / STAGE
        ========================== */
        .altar {
          position: relative;
          overflow: hidden;
          border-radius: var(--r-xl);
        }

        .altar::before {
          content: "";
          position: absolute;
          inset: -20px;
          pointer-events: none;
          background:
            radial-gradient(900px 420px at 50% -8%, rgba(88, 240, 255, 0.22) 0%, transparent 62%),
            radial-gradient(720px 520px at 70% 34%, rgba(184, 92, 255, 0.16) 0%, transparent 65%),
            radial-gradient(720px 520px at 30% 44%, rgba(255, 204, 87, 0.10) 0%, transparent 70%),
            linear-gradient(to bottom, rgba(255,255,255,0.05), transparent 40%, rgba(0,0,0,0.22));
          opacity: 0.95;
        }

        .altar .rays {
          position: absolute;
          inset: -20px;
          pointer-events: none;
          opacity: 0.22;
          animation: altarRays 4.8s ease-in-out infinite;
          background:
            conic-gradient(from 200deg at 50% 34%,
              rgba(88,240,255,0.0),
              rgba(88,240,255,0.10),
              rgba(184,92,255,0.08),
              rgba(255,204,87,0.06),
              rgba(88,240,255,0.0)
            );
          mix-blend-mode: screen;
          filter: blur(0.4px);
        }

        .altar .fog {
          position: absolute;
          inset: -20px;
          pointer-events: none;
          opacity: 0.35;
          animation: altarFog 5.6s ease-in-out infinite;
          background:
            radial-gradient(680px 240px at 50% 66%, rgba(255,255,255,0.10), transparent 70%),
            radial-gradient(560px 200px at 44% 72%, rgba(88,240,255,0.08), transparent 72%),
            radial-gradient(520px 180px at 60% 76%, rgba(184,92,255,0.06), transparent 72%);
          filter: blur(8px);
        }

        .altar .platform {
          position: absolute;
          left: 50%;
          bottom: 28px;
          transform: translateX(-50%);
          width: 240px;
          height: 82px;
          border-radius: 999px;
          border: 1px solid rgba(88,240,255,0.24);
          background: radial-gradient(circle at 50% 40%, rgba(88,240,255,0.18), transparent 70%);
          box-shadow:
            0 18px 70px rgba(0,0,0,0.35),
            0 18px 70px rgba(88,240,255,0.12);
          pointer-events: none;
        }

        .chest-wrap {
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

        .chest-canvas {
          position: absolute;
          inset: -22px;
          pointer-events: none;
          filter: drop-shadow(0 16px 44px rgba(0, 0, 0, 0.45));
        }

        @media (max-width: 768px) {
          .chest-wrap {
            width: 120px;
            height: 120px;
          }
          .chest-canvas {
            inset: -24px;
          }
          .altar .platform {
            width: 210px;
            height: 72px;
          }
        }

        /* =========================
           UI FX PRIMITIVES (auto classes)
        ========================== */
        @keyframes uiFxShimmer {
          0% {
            transform: translateX(-140%) rotate(10deg);
            opacity: 0;
          }
          16% {
            opacity: 0.22;
          }
          55% {
            opacity: 0.14;
          }
          100% {
            transform: translateX(140%) rotate(10deg);
            opacity: 0;
          }
        }

        .ui-fx {
          position: relative;
          overflow: hidden;
          will-change: transform;
        }

        .ui-fx::after {
          content: "";
          position: absolute;
          inset: -22px;
          pointer-events: none;
          background:
            linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent);
          transform: translateX(-140%) rotate(10deg);
          opacity: 0;
          animation: uiFxShimmer 3.9s cubic-bezier(0.6,0,.69,1.02) infinite;
        }

        .ui-fx-common { --fxGlow: rgba(255,255,255,0.18); }
        .ui-fx-rare { --fxGlow: color-mix(in srgb, var(--rarity-rare) 40%, transparent); }
        .ui-fx-epic { --fxGlow: color-mix(in srgb, var(--rarity-epic) 40%, transparent); }
        .ui-fx-legendary { --fxGlow: color-mix(in srgb, var(--rarity-legendary) 42%, transparent); }

        .ui-fx.ui-btn,
        .ui-fx.ui-pill {
          box-shadow:
            0 0 0 1px color-mix(in srgb, var(--fxGlow) 44%, transparent),
            0 14px 60px var(--fxGlow);
        }

        .ui-fx.ui-btn:hover {
          filter: brightness(1.03) saturate(1.08);
          box-shadow:
            0 0 0 1px color-mix(in srgb, var(--fxGlow) 62%, transparent),
            0 18px 78px var(--fxGlow);
        }
      `}</style>

      {/* FULLSCREEN reveal punch */}
      {showImpactOverlay && (
        <div
          key={`reveal-overlay-${fxSeed}`}
          className="reveal-overlay"
          style={
            {
              // @ts-ignore
              "--revealGlow": overlayGlow,
            } as any
          }
          aria-hidden="true"
        >
          <div className="particles" />
        </div>
      )}

      <div className="w-full max-w-3xl">
        {/* HUD header */}
        <header className="ui-card px-4 py-3 rounded-[var(--r-xl)] mb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="ui-subtitle">696 Chest</div>
              <div className="mt-1 font-extrabold uppercase tracking-[0.22em] text-base truncate">
                Open. Reveal. Collect.
              </div>
              <div className="text-[11px] ui-subtle mt-1">
                Cost:{" "}
                <span className="text-[color:var(--text)] font-semibold tabular-nums">
                  {CHEST_COST_SHARDS}
                </span>{" "}
                Shards
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className={["ui-pill", fxClassFor(fx)].join(" ")}>
                Shards{" "}
                <span className="ml-2 font-extrabold tabular-nums">{soft}</span>
              </span>
              <span className={["ui-pill", fxClassFor(fx)].join(" ")}>
                Crystals{" "}
                <span className="ml-2 font-extrabold tabular-nums">{hard}</span>
              </span>
              <button onClick={handleResync} className="ui-btn ui-btn-ghost">
                Re-sync
              </button>
            </div>
          </div>

          {refreshing && <div className="mt-3 text-[12px] ui-subtle">Syncing...</div>}
        </header>

        {/* Main altar */}
        <section className="ui-card-strong p-5 rounded-[var(--r-xl)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="ui-subtitle">Basic Chest</div>
              <div className="text-sm ui-muted mt-1">Ready → Open → Reveal</div>
            </div>

            <span
              className={[
                "ui-pill px-5 h-8 font-extrabold uppercase tracking-[0.22em]",
                canAfford
                  ? "border-[rgba(88,240,255,0.45)] bg-[rgba(88,240,255,0.08)]"
                  : "border-[rgba(255,204,87,0.45)] bg-[rgba(255,204,87,0.06)]",
              ].join(" ")}
            >
              {canAfford ? "READY" : `NEED ${CHEST_COST_SHARDS - soft}`}
            </span>
          </div>

          <div className="mt-4 altar border border-[color:var(--border)] bg-[rgba(255,255,255,0.04)]">
            <div className="rays" />
            <div className="fog" />
            <div className="platform" />

            <div className="relative z-10 px-6 py-10 flex flex-col items-center">
              <div className="chest-wrap">
                <div className="chest-canvas">
                  <Chest3D phase={phase} />
                </div>
              </div>

              {phase === "opening" && (
                <div className="mt-8 w-44">
                  <div className="ui-progress">
                    <div className="w-3/4 opacity-70 animate-pulse" />
                  </div>
                  <div className="mt-3 text-[12px] ui-subtitle text-center">OPENING...</div>
                </div>
              )}

              {!canAfford && (
                <div className="mt-8 ui-card p-4 text-center w-full max-w-md border border-[rgba(255,204,87,0.32)]">
                  <div className="text-base font-bold text-[color:var(--text)]">Not enough Shards</div>
                  <div className="text-xs ui-subtle mt-1">
                    You need{" "}
                    <span className="font-semibold tabular-nums">{CHEST_COST_SHARDS - soft}</span>{" "}
                    more.
                  </div>
                  <a href="/" className="ui-btn ui-btn-ghost mt-3">
                    Go to Home
                  </a>
                </div>
              )}

              <div className="mt-8 flex flex-col items-center gap-3 w-full">
                <button
                  onClick={handleOpenChest}
                  disabled={opening || !canAfford}
                  className={["ui-btn ui-btn-primary w-full max-w-sm text-base", fxClassFor(fx)].join(" ")}
                >
                  {opening ? "Opening..." : "Open Chest"}
                </button>

                <a
                  href={INVENTORY_PATH}
                  className={["ui-btn ui-btn-ghost w-full max-w-sm !font-semibold", fxClassFor(fx)].join(" ")}
                >
                  Go to Inventory
                </a>

                <div className="text-[12px] ui-subtle text-center">
                  Drops include emblems, items, characters and pets.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Reveal */}
        {showReveal && (
          <section className="mt-5 ui-card p-6 rounded-[var(--r-xl)] overflow-hidden relative">
            {/* rarity wave shock under banner */}
            {!isError && drop && fx !== "none" && (
              <div
                key={`wave-${fxSeed}`}
                className="rarity-wave"
                style={
                  {
                    // @ts-ignore
                    "--waveGlow": glow,
                  } as any
                }
                aria-hidden="true"
              />
            )}

            {fx !== "none" && !isError && drop && (
              <div
                key={`banner-${fxSeed}`}
                className={[
                  "pointer-events-none absolute left-1/2 top-5",
                  "px-5 py-2 rounded-full ring-2 ring-inset",
                  "bg-[rgba(0,0,0,0.55)] backdrop-blur",
                  "text-xs tracking-[0.28em] font-extrabold uppercase",
                ].join(" ")}
                style={{
                  transform: "translateX(-50%)",
                  animation: "bannerPop 820ms ease-out 1",
                  borderColor: glow,
                  boxShadow: `0 18px 110px color-mix(in srgb, ${glow} 45%, transparent)`,
                  color: "#fff",
                }}
              >
                {bannerText}
              </div>
            )}

            {isError ? (
              <div className="text-center py-6">
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
                className="text-center pt-12 pb-2"
                style={{ animation: "popIn 340ms ease-out 1" }}
              >
                <div className="text-lg font-black tracking-wider drop-shadow mb-2">Drop</div>

                <div
                  className={[
                    "mx-auto w-36 h-36 rounded-[1.2rem] border-2 overflow-hidden",
                    "bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(0,0,0,0.18))]",
                    "shadow-[0_22px_76px_rgba(0,0,0,0.38)]",
                    rarityFxClass(drop.rarity),
                  ].join(" ")}
                  style={{
                    borderColor: `color-mix(in srgb, ${glow} 65%, rgba(255,255,255,0.25))`,
                    boxShadow: `0 0 0 2.3px color-mix(in srgb, ${glow} 41%, transparent), 0 22px 120px color-mix(in srgb, ${glow} 22%, transparent)`,
                  }}
                >
                  {normalizeDropImageUrl(drop.image_url) ? (
                    <div className="relative w-full h-full">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={normalizeDropImageUrl(drop.image_url) as string}
                        alt={drop.name}
                        className="absolute inset-0 w-full h-full object-contain p-2"
                        draggable={false}
                      />
                      {/* frame always on top */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={CARD_FRAME_URL}
                        alt=""
                        aria-hidden="true"
                        className="absolute inset-0 w-full h-full object-contain"
                        draggable={false}
                      />
                    </div>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <div className="text-[13px] ui-subtle">NO IMAGE</div>
                    </div>
                  )}
                </div>

                <div className="mt-5 text-xl font-black tracking-widest leading-none">{drop.name}</div>

                <div className="mt-2 flex items-center justify-center gap-3 flex-wrap">
                  <span
                    className={["ui-pill text-base px-7 py-2 font-extrabold ring-1 ring-inset", fxClassFor(fx)].join(
                      " "
                    )}
                    style={{
                      borderColor: glow,
                      color: "#fff",
                      background:
                        fx === "legendary"
                          ? "linear-gradient(93deg,#f7e48fff 16%,#fff7dd88 61%,#fff4a4ff 90%)"
                          : fx === "epic"
                          ? "linear-gradient(90deg,#be80fd40 0%,#85e1ff24 100%)"
                          : fx === "rare"
                          ? "linear-gradient(93deg,#2cf2f640 30%,#bcdcff22 100%)"
                          : "rgba(255,255,255,0.08)",
                    }}
                  >
                    {rarityLabel(drop.rarity)}
                  </span>

                  <span
                    className={["ui-pill text-base px-7 py-2 font-bold border border-[rgba(88,240,255,0.28)] bg-[rgba(88,240,255,0.06)]", fxClassFor(fx)].join(
                      " "
                    )}
                  >
                    POWER{" "}
                    <span className="ml-2 font-extrabold tabular-nums">{drop.power_value}</span>
                  </span>
                </div>

                <div className="mt-4 text-sm ui-subtle">
                  Total Power after drop:{" "}
                  <span className="text-[color:var(--text)] font-extrabold tabular-nums">
                    {typeof result?.totalPowerAfter === "number" ? result.totalPowerAfter : totalPower}
                  </span>
                </div>

                <div className="mt-6 flex gap-3 justify-center flex-wrap">
                  <button
                    onClick={handleOpenAgain}
                    disabled={opening || !canAfford}
                    className={["ui-btn ui-btn-primary px-8", fxClassFor(fx)].join(" ")}
                  >
                    {opening ? "Opening..." : "Open again"}
                  </button>
                  <a href={INVENTORY_PATH} className={["ui-btn ui-btn-ghost px-8", fxClassFor(fx)].join(" ")}>
                    Inventory
                  </a>
                </div>

                {!canAfford && (
                  <div className="mt-4 text-[12px] ui-subtle">
                    Need{" "}
                    <span className="font-semibold tabular-nums">{CHEST_COST_SHARDS - soft}</span>{" "}
                    more Shards.
                  </div>
                )}
              </div>
            ) : null}
          </section>
        )}
      </div>
    </main>
  );
}
