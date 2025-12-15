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
  const {
    telegramId,
    bootstrap,
    isTelegramEnv,
    loading,
    error,
    timedOut,
    refreshSession,
  } = useGameSessionContext() as any;

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

  const auraOpacity = fx === "legendary" ? 0.26 : fx === "epic" ? 0.18 : fx === "rare" ? 0.12 : 0;
  const confettiCount = fx === "legendary" ? 18 : fx === "epic" ? 12 : fx === "rare" ? 7 : 0;
  const bannerText = rarityBannerText(fx);

  return (
    <main className="min-h-screen flex flex-col items-center pt-10 px-4 pb-24">
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
                Cost:{" "}
                <span className="font-semibold tabular-nums">{CHEST_COST_SHARDS}</span>{" "}
                <span className="ui-subtle">Shards</span>
              </div>
            </div>

            <span className="ui-pill">
              {canAfford ? "READY" : `NEED ${CHEST_COST_SHARDS - soft}`}
            </span>
          </div>

          <div className="mt-5 flex justify-center">
            <div className="w-full max-w-sm h-44 rounded-[var(--r-xl)] border border-[color:var(--border)] bg-[rgba(255,255,255,0.04)] flex items-center justify-center relative overflow-hidden">
              <div
                className="pointer-events-none absolute inset-0 opacity-90"
                style={{
                  background:
                    "radial-gradient(680px 280px at 50% -15%, rgba(88,240,255,0.16), transparent 60%), radial-gradient(680px 280px at 50% 115%, rgba(184,92,255,0.12), transparent 60%)",
                }}
              />

              <div className="relative z-10 text-center">
                <div
                  className={[
                    "mx-auto w-28 h-28 rounded-[var(--r-lg)] border border-[rgba(255,255,255,0.18)]",
                    "bg-[rgba(0,0,0,0.28)] flex items-center justify-center",
                    "shadow-[0_12px_55px_rgba(0,0,0,0.35)]",
                    phase === "opening" ? "motion-safe:animate-[wiggle_180ms_ease-in-out_infinite]" : "",
                  ].join(" ")}
                >
                  <div className="text-[11px] ui-subtle px-3">
                    {phase === "opening" ? "OPENING..." : "CHEST"}
                  </div>
                </div>

                <div className="mt-3 text-xs ui-subtle">
                  {phase === "opening" ? "Decrypting drop..." : "Tap Open to roll a drop."}
                </div>

                {phase === "opening" && (
                  <div className="mt-3 ui-progress">
                    <div className="w-2/3 opacity-90 animate-pulse" />
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
                <span className="font-semibold tabular-nums">{CHEST_COST_SHARDS - soft}</span>{" "}
                more Shards to open this chest.
              </div>
              <a href="/" className="ui-btn ui-btn-ghost mt-3">Go to Home</a>
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
                  boxShadow: `0 18px 80px color-mix(in srgb, ${fxColor(fx)} 20%, transparent)`,
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
                    background: `radial-gradient(540px 260px at 50% 20%, color-mix(in srgb, ${fxColor(fx)} 65%, white 10%), transparent 60%),
                                radial-gradient(820px 420px at 50% 115%, color-mix(in srgb, ${fxColor(fx)} 45%, transparent), transparent 60%)`,
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
                    const size = i % 3 === 0 ? 6 : i % 3 === 1 ? 4 : 3;

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
                    "mx-auto w-28 h-28 rounded-[var(--r-xl)] border bg-[rgba(255,255,255,0.04)] overflow-hidden",
                    rarityFxClass(drop.rarity),
                  ].join(" ")}
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
                    POWER{" "}
                    <span className="ml-1 font-semibold tabular-nums">{drop.power_value}</span>
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
