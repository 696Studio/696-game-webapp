"use client";

import { useEffect, useMemo, useState } from "react";
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

export default function PvpPage() {
  const router = useRouter();
  const { telegramId, isTelegramEnv, loading, timedOut, error, refreshSession } =
    useGameSessionContext() as any;

  const MODE = "unranked"; // позже сделаем переключатель
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

  const totalCopies = useMemo(
    () => Object.values(deckMap).reduce((a, b) => a + (b || 0), 0),
    [deckMap]
  );

  const deckRows: DeckCardRow[] = useMemo(() => {
    return Object.entries(deckMap)
      .filter(([, c]) => (c || 0) > 0)
      .map(([card_id, copies]) => ({ card_id, copies }));
  }, [deckMap]);

  async function loadCards() {
    if (!telegramId) return;

    setLoadingCards(true);
    try {
      const res = await fetch(
        `/api/pvp/cards/list?telegramId=${encodeURIComponent(telegramId)}`
      );
      const data = await res.json();
      setCards((data?.cards ?? []) as Card[]);
    } catch (e) {
      console.error(e);
      setCards([]);
    } finally {
      setLoadingCards(false);
    }
  }

  async function loadDeck() {
    if (!telegramId) return;
    const res = await fetch(
      `/api/pvp/deck/get?telegramId=${encodeURIComponent(telegramId)}`
    );
    const data = await res.json();
    const deck = data?.deck;

    if (deck?.cards) {
      const next: Record<string, number> = {};
      for (const row of deck.cards as DeckCardRow[]) {
        next[row.card_id] = Number(row.copies || 0);
      }
      setDeckMap(next);
      if (deck?.name) setDeckName(deck.name);
    }
  }

  useEffect(() => {
    if (!isTelegramEnv) return;
    if (!telegramId) return;
    loadCards();
  }, [isTelegramEnv, telegramId]);

  useEffect(() => {
    if (!telegramId) return;
    loadDeck();
  }, [telegramId]);

  async function saveDeck() {
    if (!telegramId) return;
    if (totalCopies !== 20) {
      setStatusText("Колода должна быть ровно на 20 копий (v1).");
      return;
    }

    setSaving(true);
    setStatusText(null);
    try {
      const res = await fetch("/api/pvp/deck/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramId, deckName, cards: deckRows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Save failed");
      setStatusText("Колода сохранена ✅");
    } catch (e: any) {
      setStatusText(`Ошибка: ${e?.message || "Save failed"}`);
    } finally {
      setSaving(false);
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

    try {
      const res = await fetch("/api/pvp/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramId, mode: MODE }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Enqueue failed");

      if (data.status === "matched" && data.matchId) {
        setMatchId(data.matchId);
        setStatusText("Матч найден ✅");
        setSearching(false);
        return;
      } else {
        setStatusText("В очереди… ищем соперника.");
        setSearching(true);
      }
    } catch (e: any) {
      setStatusText(`Ошибка: ${e?.message || "Enqueue failed"}`);
      setSearching(false);
    } finally {
      setQueueing(false);
    }
  }

  async function cancelSearch() {
    if (!telegramId) return;
    setQueueing(true);
    try {
      const res = await fetch("/api/pvp/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramId, mode: MODE }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Cancel failed");

      setSearching(false);
      setMatchId(null);
      setStatusText("Поиск отменён.");
    } catch (e: any) {
      setStatusText(`Ошибка: ${e?.message || "Cancel failed"}`);
    } finally {
      setQueueing(false);
    }
  }

  // ✅ Poll queue status while "searching"
  useEffect(() => {
    if (!telegramId) return;
    if (!searching) return;
    if (matchId) return;

    let alive = true;

    const tick = async () => {
      try {
        const res = await fetch(
          `/api/pvp/queue/status?telegramId=${encodeURIComponent(
            telegramId
          )}&mode=${encodeURIComponent(MODE)}`
        );
        const data = await res.json();
        if (!alive) return;

        if (data?.status === "matched" && data?.matchId) {
          setMatchId(data.matchId);
          setSearching(false);
          setStatusText("Матч найден ✅");
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

  // ✅ When matchId appears -> go to battle screen
  useEffect(() => {
    if (!matchId) return;
    router.push(`/pvp/battle?matchId=${encodeURIComponent(matchId)}`);
  }, [matchId, router]);

  function addCopy(cardId: string) {
    setDeckMap((prev) => {
      const curr = prev[cardId] || 0;
      if (totalCopies >= 20) return prev;
      const next = clamp(curr + 1, 0, 9);
      return { ...prev, [cardId]: next };
    });
  }

  function removeCopy(cardId: string) {
    setDeckMap((prev) => {
      const curr = prev[cardId] || 0;
      const next = clamp(curr - 1, 0, 9);
      const out = { ...prev, [cardId]: next };
      if (next === 0) delete out[cardId];
      return out;
    });
  }

  if (!isTelegramEnv) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 pb-24">
        <div className="w-full max-w-md ui-card p-5 text-center">
          <div className="text-lg font-semibold mb-2">Открой в Telegram</div>
          <div className="text-sm ui-subtle">
            Эта страница работает только внутри Telegram WebApp.
          </div>
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
        </div>
      </main>
    );
  }

  if (timedOut || error) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 pb-24">
        <div className="w-full max-w-md ui-card p-5">
          <div className="text-lg font-semibold">
            {timedOut ? "Таймаут" : "Ошибка сессии"}
          </div>
          <div className="mt-2 text-sm ui-subtle">
            Нажми Re-sync и попробуй снова.
          </div>
          <button
            onClick={() => refreshSession?.()}
            className="mt-5 ui-btn ui-btn-primary w-full"
          >
            Re-sync
          </button>
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
          background: radial-gradient(
              900px 420px at 50% -8%,
              rgba(88, 240, 255, 0.18) 0%,
              transparent 62%
            ),
            radial-gradient(
              720px 520px at 70% 34%,
              rgba(184, 92, 255, 0.14) 0%,
              transparent 65%
            ),
            radial-gradient(
              720px 520px at 30% 44%,
              rgba(255, 204, 87, 0.08) 0%,
              transparent 70%
            ),
            linear-gradient(
              to bottom,
              rgba(255, 255, 255, 0.04),
              transparent 40%,
              rgba(0, 0, 0, 0.22)
            );
          opacity: 0.95;
        }

        .pvp-altar::after {
          content: "";
          position: absolute;
          inset: -35%;
          pointer-events: none;
          opacity: 0;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.22),
            transparent
          );
          transform: translateX(-120%) rotate(10deg);
          animation: scanSweep 1.9s var(--ease-out) infinite;
          mix-blend-mode: screen;
        }

        .pvp-altar.is-searching::after {
          opacity: 1;
        }
      `}</style>

      <div className="w-full max-w-5xl">
        <header className="ui-card px-4 py-3 rounded-[var(--r-xl)] mb-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="ui-subtitle">PVP</div>
              <div className="mt-1 font-extrabold uppercase tracking-[0.22em] text-base">
                Авто-бой колод
              </div>
              <div className="text-[11px] ui-subtle mt-1">
                Собери 20 копий → сохрани → нажми “В бой”
              </div>
            </div>
            <button
              onClick={() => refreshSession?.()}
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
                  onChange={(e) => setDeckName(e.target.value)}
                  className="px-4 py-2 rounded-full border border-[color:var(--border)] bg-[rgba(255,255,255,0.04)] text-sm outline-none"
                  style={{ minWidth: 220 }}
                />
                <span className="ui-pill">
                  Копии:{" "}
                  <span className="ml-2 font-extrabold tabular-nums">
                    {totalCopies}/20
                  </span>
                </span>
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              <button
                onClick={saveDeck}
                disabled={saving || !canFight || searching}
                className={[
                  "ui-btn",
                  canFight && !searching ? "ui-btn-primary" : "ui-btn-ghost",
                ].join(" ")}
              >
                {saving ? "Сохранение…" : "Сохранить колоду"}
              </button>

              {!searching ? (
                <button
                  onClick={findMatch}
                  disabled={queueing || !canFight}
                  className={[
                    "ui-btn",
                    canFight ? "ui-btn-primary" : "ui-btn-ghost",
                  ].join(" ")}
                >
                  {queueing ? "Старт…" : "В бой"}
                </button>
              ) : (
                <button
                  onClick={cancelSearch}
                  disabled={queueing}
                  className="ui-btn ui-btn-ghost"
                >
                  {queueing ? "…" : "Отмена"}
                </button>
              )}
            </div>
          </div>

          {statusText && <div className="mt-4 ui-pill w-fit">{statusText}</div>}

          {/* Cards list */}
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
                    <div
                      key={c.id}
                      className={["ui-card p-4", rarityFxClass(c.rarity)].join(
                        " "
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-extrabold truncate">{c.name}</div>
                          <div className="text-[11px] ui-subtle mt-1">
                            {rarityRu(c.rarity)} • Сила {c.base_power}
                          </div>
                          {typeof c.owned_copies === "number" && (
                            <div className="text-[11px] ui-subtle mt-1">
                              У тебя:{" "}
                              <span className="font-semibold tabular-nums">
                                {c.owned_copies}
                              </span>
                            </div>
                          )}
                        </div>

                        <span className="ui-pill">
                          x{" "}
                          <span className="ml-2 font-extrabold tabular-nums">
                            {copies}
                          </span>
                        </span>
                      </div>

                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => removeCopy(c.id)}
                          disabled={copies <= 0 || searching}
                          className="ui-btn ui-btn-ghost"
                        >
                          −
                        </button>

                        <button
                          onClick={() => addCopy(c.id)}
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
    </main>
  );
}
