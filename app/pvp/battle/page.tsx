"use client";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useGameSessionContext } from "../../context/GameSessionContext";

type MatchRow = {
  id: string;
  mode: string | null;
  p1_user_id: string;
  p2_user_id: string;
  winner_user_id: string | null;
  created_at: string;
  status: string;
  log: any;
};

type TimelineEvent =
  | { t: number; type: "round_start"; round: number }
  | { t: number; type: "reveal"; round: number; p1_cards: string[]; p2_cards: string[] }
  | { t: number; type: "score"; round: number; p1: number; p2: number }
  | { t: number; type: "round_end"; round: number; winner: "p1" | "p2" | "draw" }
  | { t: number; type: string; [k: string]: any };

function fmtTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function BattleInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const matchId = sp.get("matchId") || "";

  const { isTelegramEnv, loading, timedOut, error, refreshSession } =
    useGameSessionContext() as any;

  const [match, setMatch] = useState<MatchRow | null>(null);
  const [errText, setErrText] = useState<string | null>(null);

  const durationSec = useMemo(() => {
    const d = Number((match?.log as any)?.duration_sec ?? 90);
    if (!Number.isFinite(d) || d <= 0) return 90;
    return Math.min(120, Math.max(45, Math.floor(d)));
  }, [match]);

  const timeline: TimelineEvent[] = useMemo(() => {
    const tl = (match?.log as any)?.timeline;
    if (!Array.isArray(tl)) return [];
    return tl
      .map((e: any) => ({ ...e, t: Number(e?.t ?? 0) }))
      .filter((e: any) => Number.isFinite(e.t))
      .sort((a: any, b: any) => a.t - b.t);
  }, [match]);

  const rounds = useMemo(() => {
    const r = (match?.log as any)?.rounds;
    if (!Array.isArray(r)) return [];
    return r;
  }, [match]);

  // playback state
  const [playing, setPlaying] = useState(true);
  const [t, setT] = useState(0);
  const startAtRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  // current view
  const [roundN, setRoundN] = useState(1);
  const [p1Cards, setP1Cards] = useState<string[]>([]);
  const [p2Cards, setP2Cards] = useState<string[]>([]);
  const [p1Score, setP1Score] = useState<number | null>(null);
  const [p2Score, setP2Score] = useState<number | null>(null);
  const [roundWinner, setRoundWinner] = useState<string | null>(null);

  // load match
  useEffect(() => {
    if (!matchId) {
      setErrText("matchId required");
      return;
    }

    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/pvp/match?id=${encodeURIComponent(matchId)}`);
        const data = await res.json();
        if (!alive) return;

        if (!res.ok) throw new Error(data?.error || "Match load failed");
        setMatch(data?.match ?? null);
      } catch (e: any) {
        if (!alive) return;
        setErrText(e?.message || "Match load failed");
      }
    })();

    return () => {
      alive = false;
    };
  }, [matchId]);

  // timeline apply at time t
  useEffect(() => {
    if (!timeline.length) return;

    let rr = 1;
    let c1: string[] = [];
    let c2: string[] = [];
    let s1: number | null = null;
    let s2: number | null = null;
    let rw: string | null = null;

    for (const e of timeline) {
      if (e.t > t) break;

      if (e.type === "round_start") {
        rr = (e as any).round ?? rr;
        c1 = [];
        c2 = [];
        s1 = null;
        s2 = null;
        rw = null;
      } else if (e.type === "reveal") {
        rr = (e as any).round ?? rr;
        c1 = (e as any).p1_cards ?? c1;
        c2 = (e as any).p2_cards ?? c2;
      } else if (e.type === "score") {
        rr = (e as any).round ?? rr;
        s1 = Number((e as any).p1 ?? 0);
        s2 = Number((e as any).p2 ?? 0);
      } else if (e.type === "round_end") {
        rr = (e as any).round ?? rr;
        rw = (e as any).winner ?? null;
      }
    }

    setRoundN(rr);
    setP1Cards(c1);
    setP2Cards(c2);
    setP1Score(s1);
    setP2Score(s2);
    setRoundWinner(rw);
  }, [t, timeline]);

  // playback loop
  useEffect(() => {
    if (!match) return;

    const step = (now: number) => {
      if (!playing) return;

      if (startAtRef.current == null) startAtRef.current = now - t * 1000;
      const elapsed = (now - startAtRef.current) / 1000;

      const nextT = Math.min(durationSec, Math.max(0, elapsed));
      setT(nextT);

      if (nextT >= durationSec) {
        setPlaying(false);
        return;
      }

      rafRef.current = window.requestAnimationFrame(step);
    };

    if (playing) {
      rafRef.current = window.requestAnimationFrame(step);
    }

    return () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match, playing, durationSec]);

  useEffect(() => {
    startAtRef.current = null;
  }, [playing]);

  function togglePlay() {
    setPlaying((p) => !p);
  }

  function backToPvp() {
    router.push("/pvp");
  }

  const finalWinnerLabel = useMemo(() => {
    if (!match) return "…";
    if (!match.winner_user_id) return "Ничья";
    return "Есть победитель";
  }, [match]);

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

  if (errText) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 pb-24">
        <div className="w-full max-w-md ui-card p-5">
          <div className="text-lg font-semibold">Ошибка</div>
          <div className="mt-2 text-sm ui-subtle">{errText}</div>
          <button onClick={backToPvp} className="mt-5 ui-btn ui-btn-ghost w-full">
            Назад
          </button>
        </div>
      </main>
    );
  }

  if (!match) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 pb-24">
        <div className="w-full max-w-md ui-card p-5 text-center">
          <div className="text-sm font-semibold">Загружаю матч…</div>
          <div className="mt-2 text-sm ui-subtle">
            MatchId: <span className="font-semibold">{matchId.slice(0, 8)}…</span>
          </div>
          <div className="mt-4 ui-progress">
            <div className="w-1/3 opacity-70 animate-pulse" />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 pt-6 pb-24 flex justify-center">
      <div className="w-full max-w-5xl">
        <header className="ui-card px-4 py-3 rounded-[var(--r-xl)] mb-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="ui-subtitle">BATTLE</div>
              <div className="mt-1 font-extrabold uppercase tracking-[0.22em] text-base">
                Поле боя • {fmtTime(t)} / {fmtTime(durationSec)}
              </div>
              <div className="text-[11px] ui-subtle mt-1">
                Раунд {roundN} / {Math.max(10, rounds.length || 10)}
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={togglePlay} className="ui-btn ui-btn-ghost">
                {playing ? "Пауза" : "▶"}
              </button>
              <button onClick={backToPvp} className="ui-btn ui-btn-ghost">
                Назад
              </button>
            </div>
          </div>
        </header>

        <section className="ui-card-strong p-5 rounded-[var(--r-xl)]">
          <div className="ui-subtitle">Раунд {roundN}</div>

          <div className="mt-3 ui-grid sm:grid-cols-2 gap-4">
            <div className="ui-card p-4">
              <div className="ui-subtitle">P1</div>
              <div className="mt-2 text-[12px] ui-subtle">Карты (5)</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(p1Cards.length ? p1Cards : Array.from({ length: 5 })).map(
                  (x: any, i: number) => (
                    <span key={`${x ?? "x"}-${i}`} className="ui-pill">
                      {x ? String(x).slice(0, 8) : "—"}
                    </span>
                  )
                )}
              </div>
              <div className="mt-3 text-sm ui-subtle">
                Счёт:{" "}
                <span className="font-extrabold tabular-nums">
                  {p1Score == null ? "…" : p1Score}
                </span>
              </div>
            </div>

            <div className="ui-card p-4">
              <div className="ui-subtitle">P2</div>
              <div className="mt-2 text-[12px] ui-subtle">Карты (5)</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(p2Cards.length ? p2Cards : Array.from({ length: 5 })).map(
                  (x: any, i: number) => (
                    <span key={`${x ?? "x"}-${i}`} className="ui-pill">
                      {x ? String(x).slice(0, 8) : "—"}
                    </span>
                  )
                )}
              </div>
              <div className="mt-3 text-sm ui-subtle">
                Счёт:{" "}
                <span className="font-extrabold tabular-nums">
                  {p2Score == null ? "…" : p2Score}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 ui-card p-4">
            <div className="ui-subtitle">Итог раунда</div>
            <div className="mt-2 text-sm ui-subtle">
              Победитель:{" "}
              <span className="font-extrabold">
                {roundWinner ? String(roundWinner).toUpperCase() : "…"}
              </span>
            </div>
          </div>
        </section>

        {!playing && t >= durationSec && (
          <section className="mt-4 ui-card p-5 rounded-[var(--r-xl)]">
            <div className="ui-subtitle">Результат матча</div>
            <div className="mt-2 text-sm ui-subtle">{finalWinnerLabel}</div>

            <div className="mt-4 ui-grid sm:grid-cols-3">
              {(rounds ?? []).slice(0, 10).map((r: any, idx: number) => (
                <div key={idx} className="ui-card p-4">
                  <div className="ui-subtitle">Раунд {idx + 1}</div>
                  <div className="mt-2 text-[12px] ui-subtle">
                    P1: {r?.p1?.total ?? "—"} • P2: {r?.p2?.total ?? "—"}
                  </div>
                  <div className="mt-2 text-[11px] ui-subtle">
                    Победитель:{" "}
                    <span className="font-semibold">{r?.winner ?? "—"}</span>
                  </div>
                </div>
              ))}
            </div>

            <button onClick={backToPvp} className="mt-5 ui-btn ui-btn-primary w-full">
              Ок
            </button>
          </section>
        )}
      </div>
    </main>
  );
}

export default function BattlePage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center px-4 pb-24">
          <div className="w-full max-w-md ui-card p-5 text-center">
            <div className="text-sm font-semibold">Загрузка…</div>
            <div className="mt-2 text-sm ui-subtle">Открываю поле боя.</div>
            <div className="mt-4 ui-progress">
              <div className="w-1/3 opacity-70 animate-pulse" />
            </div>
          </div>
        </main>
      }
    >
      <BattleInner />
    </Suspense>
  );
}
