"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useGameSessionContext } from "../context/GameSessionContext";

type InventoryItem = {
  id: string;
  created_at?: string;
  obtained_from?: string | null;
  item: {
    id: string;
    name: string;
    rarity: string;
    type: string;
    power_value: number;
    image_url?: string | null;
  };
};

type InventoryResponse = {
  items?: InventoryItem[];
  totalPower?: number;
  error?: string;
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

type RarityFilter = "all" | "common" | "rare" | "epic" | "legendary";
type SortMode = "power_desc" | "power_asc" | "newest";
type TypeFilter = "all" | "emblem" | "item" | "character" | "pet";

function normalizeRarity(rarity: string | null | undefined): Exclude<RarityFilter, "all"> {
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

function rarityColorVar(r: string | null | undefined) {
  const rr = normalizeRarity(r);
  if (rr === "legendary") return "var(--rarity-legendary)";
  if (rr === "epic") return "var(--rarity-epic)";
  if (rr === "rare") return "var(--rarity-rare)";
  return "var(--rarity-common)";
}

function normalizeType(t: string | null | undefined): TypeFilter {
  const x = String(t || "").trim().toLowerCase();
  if (!x) return "item";
  if (x === "emblem" || x === "emblems") return "emblem";
  if (x === "item" || x === "items") return "item";
  if (x === "character" || x === "characters" || x === "hero" || x === "heroes") return "character";
  if (x === "pet" || x === "pets") return "pet";
  return "item";
}

const CARD_FRAME_SRC = "/cards/frame/frame_common.png";

function resolveAssetUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // keep absolute urls as-is
  if (/^https?:\/\//i.test(s) || s.startsWith("data:")) return s;

  // normalize leading slash
  const x = s.startsWith("/") ? s : `/${s}`;

  // migrate old items paths -> new cards/art paths
  // examples:
  // /items/characters/char_1.png -> /cards/art/characters/char_1.png
  // /items/pets/pet_1.png -> /cards/art/pets/pet_1.png
  if (x.startsWith("/items/characters/")) return x.replace("/items/characters/", "/cards/art/characters/");
  if (x.startsWith("/items/pets/")) return x.replace("/items/pets/", "/cards/art/pets/");

  if (x.startsWith("/items/")) return x.replace("/items/", "/cards/art/");

  return x;
}

function formatCompact(n: number) {
  const x = Number.isFinite(n) ? n : 0;
  if (x >= 1_000_000_000) return `${(x / 1_000_000_000).toFixed(1)}B`;
  if (x >= 1_000_000) return `${(x / 1_000_000).toFixed(1)}M`;
  if (x >= 10_000) return `${Math.round(x / 1000)}K`;
  return `${x}`;
}

function formatDate(iso?: string) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

const LS_LAST_DROP_ID = "696_last_drop_id";
const LS_SEEN_IDS = "696_seen_item_ids";

function safeReadJSON<T>(s: string | null, fallback: T): T {
  try {
    if (!s) return fallback;
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export default function InventoryPage() {
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

  const [inventory, setInventory] = useState<InventoryResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const [rarityFilter, setRarityFilter] = useState<RarityFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("power_desc");

  const [selected, setSelected] = useState<InventoryItem | null>(null);

  const [showGate, setShowGate] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShowGate(true), 900);
    return () => clearTimeout(t);
  }, []);

  // NEW system (local)
  const [lastDropId, setLastDropId] = useState<string | null>(null);
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const ld = typeof window !== "undefined" ? window.localStorage.getItem(LS_LAST_DROP_ID) : null;
    const seen = typeof window !== "undefined" ? window.localStorage.getItem(LS_SEEN_IDS) : null;

    setLastDropId(ld);
    const arr = safeReadJSON<string[]>(seen, []);
    setSeenIds(new Set(arr.filter(Boolean)));
  }, []);

  const persistSeen = (next: Set<string>) => {
    setSeenIds(new Set(next));
    try {
      window.localStorage.setItem(LS_SEEN_IDS, JSON.stringify(Array.from(next)));
    } catch {}
  };

  const markSeen = (invId: string) => {
    if (!invId) return;
    const next = new Set(seenIds);
    next.add(invId);
    persistSeen(next);

    if (lastDropId && invId === lastDropId) {
      setLastDropId(null);
      try {
        window.localStorage.removeItem(LS_LAST_DROP_ID);
      } catch {}
    }
  };

  const handleResync = () => {
    setInventory(null);
    setSelected(null);
    refreshSession?.();
  };

  useEffect(() => {
    if (!telegramId) return;

    let cancelled = false;

    async function loadInventory() {
      try {
        setLoading(true);
        const res = await fetch(`/api/inventory?telegram_id=${encodeURIComponent(telegramId)}`);
        const data: InventoryResponse = await res.json();
        if (cancelled) return;
        setInventory(data);
      } catch (err) {
        console.error("Inventory load error:", err);
        if (!cancelled) setInventory({ error: "Request failed" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadInventory();

    return () => {
      cancelled = true;
    };
  }, [telegramId]);

  // lock scroll when modal open
  useEffect(() => {
    if (!selected) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selected]);

  // when selecting an item -> mark seen
  useEffect(() => {
    if (!selected?.id) return;
    markSeen(selected.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const items: InventoryItem[] = inventory?.items ?? [];
  const totalPower =
    typeof inventory?.totalPower === "number" ? inventory.totalPower : core?.totalPower ?? 0;

  const isNewItem = (ui: InventoryItem) => {
    if (!ui?.id) return false;
    if (!lastDropId) return false;
    if (seenIds.has(ui.id)) return false;
    return ui.id === lastDropId;
  };

  const filteredSortedItems = useMemo(() => {
    const baseByType =
      typeFilter === "all" ? items : items.filter((ui) => normalizeType(ui.item?.type) === typeFilter);

    const baseByRarity =
      rarityFilter === "all"
        ? baseByType
        : baseByType.filter((ui) => normalizeRarity(ui.item?.rarity) === rarityFilter);

    const copy = [...baseByRarity];

    copy.sort((a, b) => {
      const ap = Number(a?.item?.power_value ?? 0);
      const bp = Number(b?.item?.power_value ?? 0);

      if (sortMode === "power_asc") return ap - bp;
      if (sortMode === "power_desc") return bp - ap;

      const at = a.created_at ? Date.parse(a.created_at) : 0;
      const bt = b.created_at ? Date.parse(b.created_at) : 0;
      return bt - at;
    });

    // NEW всегда сверху
    copy.sort((a, b) => Number(isNewItem(b)) - Number(isNewItem(a)));

    return copy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, rarityFilter, sortMode, typeFilter, lastDropId, seenIds]);

  const shownCount = filteredSortedItems.length;

  const rarityOptions: { key: RarityFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "common", label: "Common" },
    { key: "rare", label: "Rare" },
    { key: "epic", label: "Epic" },
    { key: "legendary", label: "Legendary" },
  ];

  const typeOptions: { key: TypeFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "emblem", label: "Emblems" },
    { key: "item", label: "Items" },
    { key: "character", label: "Characters" },
    { key: "pet", label: "Pets" },
  ];

  const pillBase =
    "ui-pill transition-all duration-150 ease-out font-extrabold uppercase tracking-[0.18em] text-[11px] px-4 py-2 hover:-translate-y-[1px] active:translate-y-[1px]";
  const pillActive =
    "border-[rgba(88,240,255,0.45)] text-[color:var(--text)] bg-[rgba(88,240,255,0.08)] shadow-[0_12px_40px_rgba(88,240,255,0.10)]";
  const pillIdle = "border-[color:var(--border)] hover:bg-[rgba(255,255,255,0.06)] opacity-90";

  // ---------- UI ----------
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
    if (!showGate || sessionLoading) {
      return (
        <main className="min-h-screen flex items-center justify-center px-4 pb-24">
          <div className="w-full max-w-md ui-card p-5 text-center">
            <div className="text-sm font-semibold">Loading inventory...</div>
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

  if (!telegramId) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 pb-24">
        <div className="w-full max-w-md ui-card p-5 text-center">
          <div className="text-sm font-semibold">Loading inventory...</div>
          <div className="mt-2 text-sm ui-subtle">Getting Telegram ID.</div>
          <div className="mt-4 ui-progress">
            <div className="w-1/3 opacity-70 animate-pulse" />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 pt-6 pb-28 flex justify-center">
      {/* твой локальный CSS (как был) */}
      <style jsx global>{`
        @keyframes invModalIn {
          from {
            transform: translateY(40px) scale(0.97);
            opacity: 0;
          }
          to {
            transform: translateY(0) scale(1);
            opacity: 1;
          }
        }
        @keyframes invShine {
          0% {
            transform: translateX(-120%) rotate(14deg);
            opacity: 0;
          }
          17% {
            opacity: 0.11;
          }
          60% {
            opacity: 0;
          }
          100% {
            transform: translateX(120%) rotate(14deg);
            opacity: 0;
          }
        }

        .inv-tile {
          position: relative;
          will-change: transform, box-shadow;
          box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--tile-glow, #fff8) 38%, transparent),
            0 0 10px color-mix(in srgb, var(--tile-glow, #fff8) 7%, transparent);
          background: linear-gradient(
              105deg,
              color-mix(in srgb, var(--tile-glow, #fff8) 4%, transparent 92%) 80%,
              transparent 100%
            ),
            var(--panel);
          transition: transform 0.16s cubic-bezier(0.18, 0.91, 0.47, 1.06),
            box-shadow 0.16s cubic-bezier(0.18, 0.91, 0.47, 1.06),
            filter 0.11s cubic-bezier(0.24, 1.02, 0.45, 1.05);
        }
        .inv-tile:hover,
        .inv-tile:focus-visible {
          transform: translateY(-7px) scale(1.033);
          z-index: 3;
          filter: brightness(1.05) saturate(1.1);
          box-shadow: 0 9px 38px 0 color-mix(in srgb, var(--tile-glow, #fff8) 32%, transparent),
            0 0 0 1.9px var(--tile-outline, transparent),
            0 1.6px 26px 0 color-mix(in srgb, var(--tile-glow, #fff8) 13%, transparent);
        }
        .inv-tile:active {
          transform: translateY(1.7px) scale(0.985);
          filter: brightness(0.96);
          z-index: 2;
          box-shadow: 0 1px 11px 0 color-mix(in srgb, var(--tile-glow, #fff8) 14%, transparent),
            0 0 0 1px var(--tile-outline, transparent);
        }

        .inv-modal {
          animation: invModalIn 185ms cubic-bezier(0.18, 0.74, 0.28, 1.03);
          will-change: transform, opacity;
        }

        .inv-tile-power {
          background: linear-gradient(
              92deg,
              color-mix(in srgb, var(--tile-glow, #fffc) 92%, transparent 76%),
              color-mix(in srgb, #050a2e 18%, transparent 64%)
            ),
            rgba(0, 0, 0, 0.74);
          border: 1.2px solid rgba(255, 255, 255, 0.18);
          backdrop-filter: blur(6px) saturate(1.03);
          box-shadow: 0 2.5px 10px 0 color-mix(in srgb, var(--tile-glow, #fff8) 16%, transparent);
        }

        .inv-tile-image {
          transition: box-shadow 0.15s cubic-bezier(0.31, 1.15, 0.35, 1.08),
            transform 0.14s cubic-bezier(0.31, 1.15, 0.35, 1.08);
          box-shadow: 0 2px 10px 0 color-mix(in srgb, var(--tile-glow, #fff8) 6%, transparent);
        }

        .inv-tile-title {
          font-size: 1.07rem;
          letter-spacing: 0.001em;
          font-weight: 800;
          line-height: 1.13;
        }

        .inv-tile-title,
        .inv-tile-type-label {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .inv-modal-img {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(0, 0, 0, 0.26));
          box-shadow: 0 7px 34px 0 color-mix(in srgb, var(--tile-glow, #fff8) 16%, transparent);
        }
        .inv-modal-img img {
          box-shadow: 0 6px 22px 0 color-mix(in srgb, var(--tile-glow, #fff8) 11%, transparent);
        }

        .inv-modal-overlay {
          background: radial-gradient(ellipse at 70% 10%, #181a2328 0%, #010101ef 100%);
          backdrop-filter: blur(2.5px) saturate(1.035);
          pointer-events: all;
        }

        @keyframes newPulse {
          0%,
          100% {
            transform: scale(1);
            opacity: 1;
          }
          55% {
            transform: scale(1.06);
            opacity: 0.92;
          }
        }
        .inv-new-badge {
          position: absolute;
          top: 10px;
          left: 10px;
          z-index: 20;
          padding: 6px 10px;
          border-radius: 999px;
          font-weight: 900;
          font-size: 11px;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          background: linear-gradient(90deg, rgba(0, 0, 0, 0.72), rgba(24, 35, 60, 0.62));
          border: 1px solid rgba(255, 255, 255, 0.18);
          box-shadow: 0 8px 26px rgba(0, 0, 0, 0.38);
          animation: newPulse 1.35s ease-in-out infinite;
        }
      `}</style>

      <div className="w-full max-w-5xl">
        {/* HUD header */}
        <header className="ui-card px-4 py-3 rounded-[var(--r-xl)] mb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="ui-subtitle">Inventory</div>
              <div className="mt-1 font-extrabold uppercase tracking-[0.22em] text-base truncate">
                Your drops & power
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="ui-pill">
                POWER{" "}
                <span className="ml-2 font-extrabold tabular-nums">
                  {formatCompact(totalPower)}
                </span>
              </span>
              <span className="ui-pill">
                ITEMS{" "}
                <span className="ml-2 font-extrabold tabular-nums">
                  {shownCount}/{items.length}
                </span>
              </span>
              <button onClick={handleResync} className="ui-btn ui-btn-ghost">
                Re-sync
              </button>
            </div>
          </div>
        </header>

        {loading && <div className="mb-4 ui-subtle text-sm text-center">Loading items...</div>}

        {inventory?.error && (
          <div className="mb-4 ui-card p-4 border border-[rgba(255,80,80,0.35)]">
            <div className="text-sm font-semibold text-red-300">Error</div>
            <div className="mt-1 text-sm text-red-200/80 break-words">{inventory.error}</div>
          </div>
        )}

        {/* Filters */}
        <div className="ui-card p-4 mb-5">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2 justify-center">
              {typeOptions.map((opt) => {
                const active = typeFilter === opt.key;
                return (
                  <button
                    key={opt.key}
                    onClick={() => setTypeFilter(opt.key)}
                    className={[pillBase, active ? pillActive : pillIdle].join(" ")}
                    aria-pressed={active}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-2 justify-center">
              {rarityOptions.map((opt) => {
                const active = rarityFilter === opt.key;
                return (
                  <button
                    key={opt.key}
                    onClick={() => setRarityFilter(opt.key)}
                    className={[pillBase, active ? pillActive : pillIdle].join(" ")}
                    aria-pressed={active}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-center gap-2 flex-wrap">
              <div className="ui-subtitle">Sort</div>

              <button
                onClick={() => setSortMode("power_desc")}
                className={[pillBase, sortMode === "power_desc" ? pillActive : pillIdle].join(" ")}
                aria-pressed={sortMode === "power_desc"}
              >
                Power ↓
              </button>

              <button
                onClick={() => setSortMode("power_asc")}
                className={[pillBase, sortMode === "power_asc" ? pillActive : pillIdle].join(" ")}
                aria-pressed={sortMode === "power_asc"}
              >
                Power ↑
              </button>

              <button
                onClick={() => setSortMode("newest")}
                className={[pillBase, sortMode === "newest" ? pillActive : pillIdle].join(" ")}
                aria-pressed={sortMode === "newest"}
              >
                Newest
              </button>
            </div>
          </div>
        </div>

        {!loading && !inventory?.error && filteredSortedItems.length === 0 && (
          <div className="ui-card p-6 text-center">
            <div className="text-lg font-semibold">No items yet</div>
            <div className="mt-2 text-sm ui-subtle">
              Open chests to collect emblems, items, characters and pets.
            </div>
            <a href="/chest" className="ui-btn ui-btn-primary mt-4">
              Go to Chest
            </a>
          </div>
        )}

        {/* Tiles */}
        {filteredSortedItems.length > 0 && (
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {filteredSortedItems.map((ui) => {
              const rClass = rarityFxClass(ui.item?.rarity);
              const rColor = rarityColorVar(ui.item?.rarity);
              const showNew = isNewItem(ui);
              const typeNorm = normalizeType(ui.item?.type);
              const imgFit =
                typeNorm === "character" || typeNorm === "pet" ? "object-contain" : "object-cover";

              const imgSrc = resolveAssetUrl(ui.item.image_url);

              return (
                <button
                  key={ui.id}
                  type="button"
                  onClick={() => setSelected(ui)}
                  className={[
                    "inv-tile group ui-card p-0 text-left w-full relative overflow-hidden",
                    "rounded-[var(--r-xl)]",
                    rClass,
                  ].join(" ")}
                  style={
                    {
                      "--tile-glow": rColor,
                      "--tile-outline": rColor,
                    } as CSSProperties
                  }
                  aria-label={`Preview ${ui.item?.name || "item"}`}
                >
                  {showNew && <div className="inv-new-badge">NEW</div>}

                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background: `radial-gradient(250px 130px at 50% 0%, color-mix(in srgb, ${rColor} 13%, transparent), transparent 80%)`,
                      opacity: 0.69,
                    }}
                  />

                  <div className="pointer-events-none absolute inset-0 flex overflow-hidden">
                    <div
                      className="absolute -inset-y-10 -left-1/2 w-1/2 rotate-[14deg] opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                      style={{
                        background:
                          "linear-gradient(90deg, transparent, rgba(255,255,255,0.11), transparent)",
                        animation:
                          "invShine 4s cubic-bezier(0.6,0,.69,1.02) infinite",
                      }}
                    />
                  </div>

                  <div className="relative z-10 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="inv-tile-title truncate">{ui.item.name}</div>
                        <div className="inv-tile-type-label mt-0.5 text-[11px] ui-subtle font-semibold uppercase tracking-wide truncate">
                          {String(ui.item.type || "")}
                        </div>
                      </div>

                      <span
                        className="ui-pill whitespace-nowrap"
                        style={{ borderColor: rColor, color: "var(--text)" }}
                      >
                        {rarityLabel(ui.item.rarity)}
                      </span>
                    </div>

                    <div
                      className="mt-3 inv-tile-image rounded-[var(--r-lg)] overflow-hidden aspect-square relative flex items-end"
                      style={{
                        boxShadow: `inset 0 0 0 1.1px color-mix(in srgb, ${rColor} 22%, rgba(255,255,255,0.13))`,
                        background:
                          "linear-gradient(180deg, rgba(255,255,255,0.10), rgba(0,0,0,0.19))",
                      }}
                    >
                      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120px_90px_at_50%_74%,rgba(0,0,0,0.00),rgba(0,0,0,0.38))]" />

                      {imgSrc ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={imgSrc}
                            alt={ui.item.name}
                            className="absolute w-full h-full object-contain transition-transform duration-150 group-hover:scale-[1.03] group-active:scale-[0.98]"
                            style={{ inset: "22%", objectPosition: "center" }}
                            loading="lazy"
                            draggable={false}
                          />

                          {/* Frame overlay */}
                          <img
                            src={CARD_FRAME_SRC}
                            alt=""
                            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                            draggable={false}
                          />
                        </>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-black/10">
                          <div className="ui-subtitle">No image</div>
                        </div>
                      )}

                      <div className="absolute left-2 right-2 bottom-2">
                        <div className="inv-tile-power rounded-[var(--r-md)] px-2 py-[6px] flex items-center justify-between gap-2">
                          <span className="text-[10px] ui-subtle font-semibold opacity-90 select-none">
                            POWER
                          </span>
                          <span
                            className="text-sm font-bold tabular-nums tracking-tight text-white drop-shadow-sm"
                            style={{
                              textShadow:
                                "0 1px 4px #16192555,0 1px 2px #0006",
                            }}
                          >
                            {formatCompact(Number(ui.item.power_value ?? 0))}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 text-[11px] ui-subtle text-center opacity-80 group-hover:opacity-100 transition-opacity select-none pointer-events-none">
                      Tap to preview
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      {selected && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center px-4 pb-6 sm:pb-0"
          role="dialog"
          aria-modal="true"
          aria-label="Item preview"
        >
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="absolute inset-0 inv-modal-overlay cursor-pointer"
            aria-label="Close preview"
            tabIndex={-1}
          />

          <div
            className={[
              "inv-modal relative w-full max-w-md ui-card-strong p-4 rounded-[var(--r-xl)]",
              rarityFxClass(selected.item?.rarity),
              "overflow-hidden select-none outline-none",
            ].join(" ")}
            style={{
              boxShadow: `0 0 0 1.8px color-mix(in srgb, ${rarityColorVar(
                selected.item?.rarity
              )} 36%, rgba(255,255,255,0.18)),
                          0 22px 60px rgba(0,0,0,0.62)`,
            }}
            tabIndex={0}
          >
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background: `radial-gradient(660px 360px at 50% 0%, color-mix(in srgb, ${rarityColorVar(
                  selected.item?.rarity
                )} 16%, transparent), transparent 63%)`,
                opacity: 0.93,
              }}
            />

            <div className="relative z-10 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-lg font-semibold truncate">{selected.item.name}</div>
                <div className="mt-1 flex items-center gap-2 flex-wrap">
                  <span
                    className="ui-pill"
                    style={{
                      borderColor: rarityColorVar(selected.item?.rarity),
                      color: "var(--text)",
                      background: "rgba(255,255,255,0.10)",
                    }}
                  >
                    {rarityLabel(selected.item.rarity)}
                  </span>
                  <span className="ui-pill font-semibold">
                    {String(selected.item.type || "").toUpperCase()}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelected(null)}
                className="ui-btn ui-btn-ghost"
                aria-label="Close"
              >
                Close
              </button>
            </div>

            <div
              className="relative z-10 mt-4 inv-modal-img rounded-[var(--r-lg)] overflow-hidden aspect-square"
              style={{
                boxShadow: `inset 0 0 0 1.1px color-mix(in srgb, ${rarityColorVar(
                  selected.item?.rarity
                )} 23%, rgba(255,255,255,0.21))`,
                background: "linear-gradient(180deg, rgba(255,255,255,0.07), rgba(0,0,0,0.21))",
              }}
            >
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(140px_110px_at_50%_70%,rgba(0,0,0,0.00),rgba(0,0,0,0.44))]" />
              {resolveAssetUrl(selected.item.image_url) ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={resolveAssetUrl(selected.item.image_url)!}
                    alt={selected.item.name}
                    className="absolute w-full h-full object-contain"
                    style={{ inset: "22%", objectPosition: "center" }}
                    draggable={false}
                  />

                  {/* Frame overlay */}
                  <img
                    src={CARD_FRAME_SRC}
                    alt=""
                    className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                    draggable={false}
                  />
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-black/10">
                  <div className="ui-subtitle">No image</div>
                </div>
              )}
            </div>

            <div className="relative z-10 mt-4 ui-card p-4">
              <div className="flex items-center justify-between">
                <div className="ui-subtitle">Power</div>
                <div className="text-2xl font-semibold tabular-nums">
                  {formatCompact(Number(selected.item.power_value ?? 0))}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <div className="ui-subtitle">Obtained</div>
                  <div className="text-sm ui-muted mt-1">
                    {formatDate(selected.created_at) || "Unknown"}
                  </div>
                </div>

                <div>
                  <div className="ui-subtitle">Source</div>
                  <div className="text-sm ui-muted mt-1 break-words">
                    {selected.obtained_from ? String(selected.obtained_from) : "Unknown"}
                  </div>
                </div>
              </div>
            </div>

            <div className="relative z-10 mt-4 flex gap-2">
              <a href="/chest" className="ui-btn ui-btn-primary flex-1">
                Open more
              </a>
              <button type="button" onClick={() => setSelected(null)} className="ui-btn ui-btn-ghost flex-1">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}