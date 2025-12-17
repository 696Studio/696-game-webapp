"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useGameSessionContext } from "../context/GameSessionContext";

type Card = {
  id: string;
  name: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  base_power: number;
  image_url: string | null;
  owned_copies?: number;
};

type DeckCardRow = { card_id: string; copies: number };

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function rarityRu(r: string) {
  const rr = String(r).toLowerCase();
  if (rr === "legendary") return "ЛЕГЕНДАРНАЯ";
  if (rr === "epic") return "ЭПИЧЕСКАЯ";
  if (rr === "rare") return "РЕДКАЯ";
  return "ОБЫЧНАЯ";
}

function rarityFxClass(r: string) {
  const rr = String(r).toLowerCase();
  if (rr === "legendary") return "ui-rarity-legendary";
  if (rr === "epic") return "ui-rarity-epic";
  if (rr === "rare") return "ui-rarity-rare";
  return "ui-rarity-common";
}

function countTotalCopies(map: Record<string, number>) {
  return Object.values(map).reduce((a, b) => a + (Number(b) || 0), 0);
}

/** ---------- Persistent Debug HUD (survives reloads) ---------- **/
const DBG_KEY = "__pvp_dbg_log_v1__";

function dbgPush(msg: string) {
  try {
    const ts = new Date().toISOString().slice(11, 19);
    const line = `[${ts}] ${msg}`;
    const raw = localStorage.getItem(DBG_KEY);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    arr.push(line);
    const trimmed = arr.slice(-120);
    localStorage.setItem(DBG_KEY, JSON.stringify(trimmed));
  } catch {
    // ignore
  }
}

function dbgRead(): string[] {
  try {
    const raw = localStorage.getItem(DBG_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function safeErr(e: any) {
  try {
    if (!e) return "unknown";
    if (typeof e === "string") return e;
    if (e?.message) return String(e.message);
    return JSON.stringify(e);
  } catch {
    return "unknown";
  }
}

export default function PvpPage() {
  const router = useRouter();
  const { telegramId, isTelegramEnv, loading, timedOut, error, refreshSession } =
    useGameSessionContext() as any;

  const MODE = "unranked";
  const POLL_MS = 1200;

  const [cards, setCards] = useState<Card[]>([]);
  const [loadingCards, setLoadingCards] = useState(false);

  const [deckName, setDeckName] = useState("Моя колода");
  const [deckMap, setDeckMap] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);

  const [queueing, setQueueing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [matchId, setMatchId] = useState<string | null>(null);

  const pushedRef = useRef<string | null>(null);
  const editedRef = useRef(false);
  const loadedDeckForTelegramIdRef = useRef<string | null>(null);

  // Debug HUD state
  const [dbg, setDbg] = useState<string[]>([]);
  const [dbgOpen, setDbgOpen] = useState(true);

  const totalCopies = useMemo(() => countTotalCopies(deckMap), [deckMap]);

  const deckRows: DeckCardRow[] = useMemo(() => {
    return Object.entries(deckMap)
      .filter(([, c]) => (c || 0) > 0)
      .map(([card_id, copies]) => ({ card_id, copies }));
  }, [deckMap]);

  // ---- Install global listeners (client) ----
  useEffect(() => {
    dbgPush("PVP_MOUNT");
    dbgPush(
      `ENV isTelegramEnv=${String(isTelegramEnv)} telegramId=${telegramId ? "yes" : "no"}`
    );

    // close Debug by default on narrow screens (so it won't cover taps)
    try {
      if (window.innerWidth < 430) setDbgOpen(false);
    } catch {}

    // detect reload count
    try {
      const k = "__pvp_reload_count__";
      const n = Number(sessionStorage.getItem(k) || "0") + 1;
      sessionStorage.setItem(k, String(n));
      dbgPush(`RELOAD_COUNT=${n}`);
    } catch {}

    const onErr = (ev: ErrorEvent) => {
      dbgPush(
        `WINDOW_ERROR: ${ev.message || "unknown"} @${ev.filename}:${ev.lineno}:${ev.colno}`
      );
      setDbg(dbgRead());
    };

    const onRej = (ev: PromiseRejectionEvent) => {
      dbgPush(`UNHANDLED_REJECTION: ${safeErr(ev.reason)}`);
      setDbg(dbgRead());
    };

    const onVis = () => {
      dbgPush(`VISIBILITY: ${document.visibilityState}`);
      setDbg(dbgRead());
    };

    const onPageHide = () => {
      dbgPush("PAGEHIDE");
      setDbg(dbgRead());
    };

    const onBeforeUnload = () => {
      dbgPush("BEFOREUNLOAD");
    };

    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);

    setDbg(dbgRead());

    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      dbgPush("PVP_UNMOUNT");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // track session flags changes
  useEffect(() => {
    dbgPush(
      `CTX loading=${String(loading)} timedOut=${String(timedOut)} error=${error ? "yes" : "no"}`
    );
    setDbg(dbgRead());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, timedOut, error]);

  async function loadCards() {
    if (!telegramId) return;

    setLoadingCards(true);
    try {
      dbgPush("LOAD_CARDS start");
      const res = await fetch(
        `/api/pvp/cards/list?telegramId=${encodeURIComponent(telegramId)}`
      );
      const data = await res.json();
      dbgPush(`LOAD_CARDS ok status=${res.status} count=${(data?.cards ?? []).length}`);
      setCards((data?.cards ?? []) as Card[]);
    } catch (e) {
      dbgPush(`LOAD_CARDS fail ${safeErr(e)}`);
      console.error(e);
      setCards([]);
    } finally {
      setLoadingCards(false);
      setDbg(dbgRead());
    }
  }

  async function loadDeck() {
    if (!telegramId) return;

    if (editedRef.current) {
      dbgPush("LOAD_DECK skipped (edited)");
      setDbg(dbgRead());
      return;
    }
    if (loadedDeckForTelegramIdRef.current === telegramId) {
      dbgPush("LOAD_DECK skipped (already loaded)");
      setDbg(dbgRead());
      return;
    }
    loadedDeckForTelegramIdRef.current = telegramId;

    try {
      dbgPush("LOAD_DECK start");
      const res = await fetch(
        `/api/pvp/deck/get?telegramId=${encodeURIComponent(telegramId)}`
      );
      const data = await res.json();
      dbgPush(`LOAD_DECK ok status=${res.status}`);
      const deck = data?.deck;

      if (deck?.cards) {
        const next: Record<string, number> = {};
        for (const row of deck.cards as DeckCardRow[]) {
          next[String(row.card_id)] = Number(row.copies || 0);
        }
        setDeckMap(next);
        if (deck?.name) setDeckName(deck.name);
      }
    } catch (e) {
      dbgPush(`LOAD_DECK fail ${safeErr(e)}`);
      console.error(e);
    } finally {
      setDbg(dbgRead());
    }
  }

  useEffect(() => {
    if (!isTelegramEnv) return;
    if (!telegramId) return;
    loadCards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTelegramEnv, telegramId]);

  useEffect(() => {
    if (!telegramId) return;
    loadDeck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telegramId]);

  async function saveDeck() {
    if (!telegramId) return;
    if (totalCopies !== 20) {
      setStatusText("Колода должна быть ровно на 20 копий (v1).");
      return;
    }

    setSaving(true);
    setStatusText(null);
    dbgPush("SAVE_DECK start");

    try {
      const res = await fetch("/api/pvp/deck/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramId, deckName, cards: deckRows }),
      });
      const data = await res.json();
      dbgPush(`SAVE_DECK resp status=${res.status} ok=${String(res.ok)}`);
      if (!res.ok) throw new Error(data?.error || "Save failed");
      setStatusText("Колода сохранена ✅");
    } catch (e: any) {
      dbgPush(`SAVE_DECK fail ${safeErr(e)}`);
      setStatusText(`Ошибка: ${e?.message || "Save failed"}`);
    } finally {
      setSaving(false);
      setDbg(dbgRead());
    }
  }

  async function findMatch() {
    if (!telegramId) return;

    if (totalCopies !== 20) {
      setStatusText("Сначала собери колоду на 20 копий и сохрани.");
      return;
    }

    setQueueing(true);
    setStatusText(null);
    setMatchId(null);
    setSearching(false);
    pushedRef.current = null;

    dbgPush("ENQUEUE start");

    try {
      const res = await fetch("/api/pvp/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramId, mode: MODE }),
      });
      const data = await res.json();
      dbgPush(
        `ENQUEUE resp status=${res.status} ok=${String(res.ok)} payload=${data?.status || "?"}`
      );
      if (!res.ok) throw new Error(data?.error || "Enqueue failed");

      if (data.status === "matched" && data.matchId) {
        setStatusText("Матч найден ✅");
        setSearching(false);
        setMatchId(data.matchId);
        return;
      }

      setStatusText("В очереди… ищем соперника.");
      setSearching(true);
    } catch (e: any) {
      dbgPush(`ENQUEUE fail ${safeErr(e)}`);
      setStatusText(`Ошибка: ${e?.message || "Enqueue failed"}`);
      setSearching(false);
    } finally {
      setQueueing(false);
      setDbg(dbgRead());
    }
  }

  async function cancelSearch() {
    if (!telegramId) return;
    setQueueing(true);
    dbgPush("CANCEL start");

    try {
      const res = await fetch("/api/pvp/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramId, mode: MODE }),
      });
      const data = await res.json();
      dbgPush(`CANCEL resp status=${res.status} ok=${String(res.ok)}`);
      if (!res.ok) throw new Error(data?.error || "Cancel failed");

      setSearching(false);
      setMatchId(null);
      pushedRef.current = null;
      setStatusText("Поиск отменён.");
    } catch (e: any) {
      dbgPush(`CANCEL fail ${safeErr(e)}`);
      setStatusText(`Ошибка: ${e?.message || "Cancel failed"}`);
    } finally {
      setQueueing(false);
      setDbg(dbgRead());
    }
  }

  useEffect(() => {
    if (!telegramId) return;
    if (!searching) return;
    if (matchId) return;

    let alive = true;

    const tick = async () => {
      try {
        const res = await fetch(
          `/api/pvp/queue/status?telegramId=${encodeURIComponent(telegramId)}&mode=${encodeURIComponent(
            MODE
          )}`
        );
        const data = await res.json();
        if (!alive) return;

        if (data?.status === "matched" && data?.matchId) {
          dbgPush("QUEUE matched");
          setStatusText("Матч найден ✅");
          setSearching(false);
          setMatchId(data.matchId);
          setDbg(dbgRead());
          return;
        }

        setStatusText("В очереди… ищем соперника.");
      } catch {
        // ignore
      }
    };

    tick();
    const id = window.setInterval(tick, POLL_MS);

    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [telegramId, searching, matchId]);

  useEffect(() => {
    if (!matchId) return;
    if (pushedRef.current === matchId) return;
    pushedRef.current = matchId;
    dbgPush(`ROUTE push battle matchId=${matchId}`);
    setDbg(dbgRead());
    router.push(`/pvp/battle?matchId=${encodeURIComponent(matchId)}`);
  }, [matchId, router]);

  function addCopy(cardId: string) {
    dbgPush(`ADD_CLICK card=${cardId}`);
    setDbg(dbgRead());

    editedRef.current = true;

    setDeckMap((prev) => {
      const prevTotal = countTotalCopies(prev);
      const curr = Number(prev[cardId] || 0);
      if (prevTotal >= 20) return prev;
      const next = clamp(curr + 1, 0, 9);
      return { ...prev, [cardId]: next };
    });
  }

  function removeCopy(cardId: string) {
    dbgPush(`REMOVE_CLICK card=${cardId}`);
    setDbg(dbgRead());

    editedRef.current = true;

    setDeckMap((prev) => {
      const curr = Number(prev[cardId] || 0);
      const next = clamp(curr - 1, 0, 9);
      const out = { ...prev, [cardId]: next };
      if (next === 0) delete out[cardId];
      return out;
    });
  }

  // single helper: stop iOS weird gesture/defaults for our tiny +/- buttons
  function hardStop(e: any) {
    try {
      e.preventDefault?.();
      e.stopPropagation?.();
    } catch {}
  }

  if (!isTelegramEnv) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 pb-24">
        <div className="w-full max-w-md ui-card p-5 text-center">
          <div className="text-lg font-semibold mb-2">Открой в Telegram</div>
          <div className="text-sm ui-subtle">Эта страница работает только внутри Telegram WebApp.</div>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 pb-24">
        <div className="w-full max-w-md ui-card p-5 text-center">
          <div className="text-sm font-semibold">Загрузка…</div>
          <div className="mt-2 text-sm ui-subtle">Синхронизация сессии.</div>
          <div className="mt-4 ui-progress">
            <div className="w-1/3 opacity-70 animate-pulse" />
          </div>

          <div className="mt-4 text-[10px] ui-subtle whitespace-pre-wrap break-words">
            {dbg.slice(-6).join("\n")}
          </div>
        </div>
      </main>
    );
  }

  if (timedOut || error) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 pb-24">
        <div className="w-full max-w-md ui-card p-5">
          <div className="text-lg font-semibold">{timedOut ? "Таймаут" : "Ошибка сессии"}</div>
          <div className="mt-2 text-sm ui-subtle">Нажми Re-sync и попробуй снова.</div>
          <button
            type="button"
            onClick={() => {
              dbgPush("RESYNC_CLICK");
              setDbg(dbgRead());
              refreshSession?.();
            }}
            className="mt-5 ui-btn ui-btn-primary w-full"
          >
            Re-sync
          </button>

          <div className="mt-4 text-[10px] ui-subtle whitespace-pre-wrap break-words">
            {dbg.slice(-10).join("\n")}
          </div>
        </div>
      </main>
    );
  }

  const canFight = totalCopies === 20;

  return (
    <main className="min-h-screen px-4 pt-6 pb-24 flex justify-center">
      <style jsx global>{`
        @keyframes scanSweep {
          0% {
            transform: translateX(-120%) rotate(10deg);
            opacity: 0;
          }
          18% {
            opacity: 0.22;
          }
          60% {
            opacity: 0.12;
          }
          100% {
            transform: translateX(120%) rotate(10deg);
            opacity: 0;
          }
        }

        .pvp-altar {
          position: relative;
          overflow: hidden;
          border-radius: var(--r-xl);
        }

        .pvp-altar::before {
          content: "";
          position: absolute;
          inset: -22px;
          pointer-events: none;
          background: radial-gradient(900px 420px at 50% -8%, rgba(88, 240, 255, 0.18) 0%, transparent 62%),
            radial-gradient(720px 520px at 70% 34%, rgba(184, 92, 255, 0.14) 0%, transparent 65%),
            radial-gradient(720px 520px at 30% 44%, rgba(255, 204, 87, 0.08) 0%, transparent 70%),
            linear-gradient(to bottom, rgba(255, 255, 255, 0.04), transparent 40%, rgba(0, 0, 0, 0.22));
          opacity: 0.95;
        }

        .pvp-altar::after {
          content: "";
          position: absolute;
          inset: -35%;
          pointer-events: none;
          opacity: 0;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.22), transparent);
          transform: translateX(-120%) rotate(10deg);
          animation: scanSweep 1.9s var(--ease-out) infinite;
          mix-blend-mode: screen;
        }

        .pvp-altar.is-searching::after {
          opacity: 1;
        }

        /* Debug HUD
           IMPORTANT: do NOT steal taps from content (iPhone) */
        .dbg-hud {
          position: fixed;
          left: 10px;
          right: 10px;
          bottom: 10px;
          z-index: 9999;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.18);
          background: rgba(0, 0, 0, 0.65);
          backdrop-filter: blur(8px);
          padding: 10px;
          max-height: 34vh;
          overflow: auto;

          pointer-events: none; /* 👈 KEY FIX */
          user-select: none;
          -webkit-user-select: none;
        }
        .dbg-hud .dbg-row,
        .dbg-hud pre {
          pointer-events: none;
        }
        .dbg-hud .dbg-btn {
          pointer-events: auto; /* 👈 allow buttons only */
        }

        .dbg-hud pre {
          margin: 8px 0 0;
          font-size: 10px;
          white-space: pre-wrap;
          word-break: break-word;
          opacity: 0.92;
        }
        .dbg-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .dbg-btn {
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.18);
          background: rgba(255, 255, 255, 0.06);
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
      `}</style>

      <div className="w-full max-w-5xl">
        <header className="ui-card px-4 py-3 rounded-[var(--r-xl)] mb-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="ui-subtitle">PVP</div>
              <div className="mt-1 font-extrabold uppercase tracking-[0.22em] text-base">Авто-бой колод</div>
              <div className="text-[11px] ui-subtle mt-1">Собери 20 копий → сохрани → нажми “В бой”</div>
            </div>
            <button
              type="button"
              onClick={() => {
                dbgPush("RESYNC_CLICK (header)");
                setDbg(dbgRead());
                refreshSession?.();
              }}
              className="ui-btn ui-btn-ghost"
            >
              Re-sync
            </button>
          </div>
        </header>

        <section
          className={[
            "ui-card-strong p-5 rounded-[var(--r-xl)] pvp-altar",
            searching ? "is-searching" : "",
          ].join(" ")}
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="ui-subtitle">Колода</div>
              <div className="mt-2 flex gap-2 items-center flex-wrap">
                <input
                  value={deckName}
                  onChange={(e) => {
                    editedRef.current = true;
                    setDeckName(e.target.value);
                    dbgPush("DECKNAME_CHANGE");
                    setDbg(dbgRead());
                  }}
                  className="px-4 py-2 rounded-full border border-[color:var(--border)] bg-[rgba(255,255,255,0.04)] text-sm outline-none"
                  style={{ minWidth: 220 }}
                />
                <span className="ui-pill">
                  Копии: <span className="ml-2 font-extrabold tabular-nums">{totalCopies}/20</span>
                </span>
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={saveDeck}
                disabled={saving || !canFight || searching}
                className={["ui-btn", canFight && !searching ? "ui-btn-primary" : "ui-btn-ghost"].join(" ")}
              >
                {saving ? "Сохранение…" : "Сохранить колоду"}
              </button>

              {!searching ? (
                <button
                  type="button"
                  onClick={findMatch}
                  disabled={queueing || !canFight}
                  className={["ui-btn", canFight ? "ui-btn-primary" : "ui-btn-ghost"].join(" ")}
                >
                  {queueing ? "Старт…" : "В бой"}
                </button>
              ) : (
                <button type="button" onClick={cancelSearch} disabled={queueing} className="ui-btn ui-btn-ghost">
                  {queueing ? "…" : "Отмена"}
                </button>
              )}
            </div>
          </div>

          {statusText && <div className="mt-4 ui-pill w-fit">{statusText}</div>}

          <div className="mt-6">
            <div className="ui-subtitle mb-3">Карты</div>

            {loadingCards ? (
              <div className="ui-card p-4">
                <div className="text-sm ui-subtle">Загружаю карты…</div>
              </div>
            ) : cards.length === 0 ? (
              <div className="ui-card p-4">
                <div className="text-sm ui-subtle">
                  Карты не найдены. Проверь /api/pvp/cards/list и таблицу cards.
                </div>
              </div>
            ) : (
              <div className="ui-grid sm:grid-cols-2 lg:grid-cols-3">
                {cards.map((c) => {
                  const copies = deckMap[c.id] || 0;

                  return (
                    <div key={c.id} className={["ui-card p-4", rarityFxClass(c.rarity)].join(" ")}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-extrabold truncate">{c.name}</div>
                          <div className="text-[11px] ui-subtle mt-1">
                            {rarityRu(c.rarity)} • Сила {c.base_power}
                          </div>
                          {typeof c.owned_copies === "number" && (
                            <div className="text-[11px] ui-subtle mt-1">
                              У тебя: <span className="font-semibold tabular-nums">{c.owned_copies}</span>
                            </div>
                          )}
                        </div>

                        <span className="ui-pill">
                          x <span className="ml-2 font-extrabold tabular-nums">{copies}</span>
                        </span>
                      </div>

                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onPointerDown={hardStop}
                          onTouchStart={hardStop}
                          onClick={(e) => {
                            hardStop(e);
                            removeCopy(c.id);
                          }}
                          disabled={copies <= 0 || searching}
                          className="ui-btn ui-btn-ghost"
                        >
                          −
                        </button>

                        <button
                          type="button"
                          onPointerDown={hardStop}
                          onTouchStart={hardStop}
                          onClick={(e) => {
                            hardStop(e);
                            addCopy(c.id);
                          }}
                          disabled={searching || totalCopies >= 20 || copies >= 9}
                          className="ui-btn ui-btn-primary"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      {dbgOpen && (
        <div className="dbg-hud">
          <div className="dbg-row">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.18em]">DEBUG</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="dbg-btn"
                onClick={() => {
                  try {
                    localStorage.removeItem(DBG_KEY);
                    dbgPush("DBG_CLEARED");
                    setDbg(dbgRead());
                  } catch {}
                }}
              >
                Clear
              </button>
              <button className="dbg-btn" onClick={() => setDbgOpen(false)}>
                Hide
              </button>
            </div>
          </div>
          <pre>{dbg.slice(-40).join("\n")}</pre>
        </div>
      )}

      {!dbgOpen && (
        <div style={{ position: "fixed", bottom: 10, right: 10, zIndex: 9999 }}>
          <button className="dbg-btn" onClick={() => setDbgOpen(true)}>
            Debug
          </button>
        </div>
      )}
    </main>
  );
}
