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

type CardMeta = {
  id: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  base_power: number;
  name?: string;
  image_url?: string | null;
};

type TimelineEvent =
  | { t: number; type: "round_start"; round: number }
  | {
      t: number;
      type: "reveal";
      round: number;
      p1_cards: string[];
      p2_cards: string[];
      // ✅ новое (из sim.ts)
      p1_cards_full?: CardMeta[];
      p2_cards_full?: CardMeta[];
    }
  | { t: number; type: "score"; round: number; p1: number; p2: number }
  | {
      t: number;
      type: "round_end";
      round: number;
      winner: "p1" | "p2" | "draw";
    }
  | { t: number; type: string; [k: string]: any };

function fmtTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function safeSliceId(id: string) {
  const s = String(id || "");
  return s.length > 10 ? `${s.slice(0, 8)}…` : s || "—";
}

function rarityRu(r: string) {
  const rr = String(r || "").toLowerCase();
  if (rr === "legendary") return "ЛЕГЕНДАРНАЯ";
  if (rr === "epic") return "ЭПИЧЕСКАЯ";
  if (rr === "rare") return "РЕДКАЯ";
  return "ОБЫЧНАЯ";
}

function rarityFxClass(r: string) {
  const rr = String(r || "").toLowerCase();
  if (rr === "legendary") return "rar-legendary";
  if (rr === "epic") return "rar-epic";
  if (rr === "rare") return "rar-rare";
  return "rar-common";
}

/** ✅ если supabase/route отдаст jsonb как string — парсим */
function parseMaybeJson(v: any) {
  if (v == null) return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return v;
    if (s.startsWith("{") || s.startsWith("[")) {
      try {
        return JSON.parse(s);
      } catch {
        return v;
      }
    }
  }
  return v;
}

function toStringArray(v: any): string[] {
  const raw = parseMaybeJson(v);
  if (Array.isArray(raw)) return raw.map((x) => String(x));
  if (raw && typeof raw === "object") {
    const vals = Object.values(raw);
    if (vals.length) return vals.map((x) => String(x));
  }
  return [];
}

function toCardMetaArray(v: any): CardMeta[] {
  const raw = parseMaybeJson(v);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x: any) => {
      if (!x) return null;
      return {
        id: String(x.id ?? ""),
        rarity: (String(x.rarity ?? "common").toLowerCase() as any) || "common",
        base_power: Number(x.base_power ?? 0),
        name: x.name != null ? String(x.name) : undefined,
        image_url: x.image_url ?? null,
      } as CardMeta;
    })
    .filter(Boolean) as CardMeta[];
}

function BattleInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const matchId = sp.get("matchId") || "";

  const { isTelegramEnv, loading, timedOut, error, refreshSession } =
    useGameSessionContext() as any;

  const [match, setMatch] = useState<MatchRow | null>(null);
  const [errText, setErrText] = useState<string | null>(null);

  // ✅ нормализуем log (object | string)
  const logObj = useMemo(() => {
    const l = match?.log;
    return (parseMaybeJson(l) ?? {}) as any;
  }, [match?.log]);

  const durationSec = useMemo(() => {
    const d = Number(logObj?.duration_sec ?? 30);
    if (!Number.isFinite(d) || d <= 0) return 30;
    // важный фикс: не делаем min 45, иначе кажется что "ничего не происходит"
    return Math.min(120, Math.max(10, Math.floor(d)));
  }, [logObj]);

  const timeline: TimelineEvent[] = useMemo(() => {
    const tlRaw = logObj?.timeline;
    const tl = parseMaybeJson(tlRaw);
    if (!Array.isArray(tl)) return [];
    return tl
      .map((e: any) => ({ ...e, t: Number(e?.t ?? 0) }))
      .filter((e: any) => Number.isFinite(e.t))
      .sort((a: any, b: any) => a.t - b.t);
  }, [logObj]);

  const rounds = useMemo(() => {
    const rRaw = logObj?.rounds;
    const r = parseMaybeJson(rRaw);
    if (!Array.isArray(r)) return [];
    return r;
  }, [logObj]);

  const roundCount = useMemo(() => {
    let maxRound = 0;
    for (const e of timeline) {
      const rn = Number((e as any)?.round ?? 0);
      if (Number.isFinite(rn)) maxRound = Math.max(maxRound, rn);
    }
    if (maxRound > 0) return maxRound;
    if (rounds.length) return rounds.length;
    return 3;
  }, [timeline, rounds.length]);

  // playback state
  const [playing, setPlaying] = useState(true);
  const [t, setT] = useState(0);
  const startAtRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  // current view
  const [roundN, setRoundN] = useState(1);

  // ids fallback
  const [p1Cards, setP1Cards] = useState<string[]>([]);
  const [p2Cards, setP2Cards] = useState<string[]>([]);

  // ✅ meta cards for rendering
  const [p1CardsFull, setP1CardsFull] = useState<CardMeta[]>([]);
  const [p2CardsFull, setP2CardsFull] = useState<CardMeta[]>([]);

  const [p1Score, setP1Score] = useState<number | null>(null);
  const [p2Score, setP2Score] = useState<number | null>(null);
  const [roundWinner, setRoundWinner] = useState<string | null>(null);

  // micro-animations
  const [revealTick, setRevealTick] = useState(0);
  const [p1Hit, setP1Hit] = useState(false);
  const [p2Hit, setP2Hit] = useState(false);

  const prevRevealSigRef = useRef<string>("");
  const prevScoreRef = useRef<{ p1: number | null; p2: number | null }>({
    p1: null,
    p2: null,
  });

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
    let cf1: CardMeta[] = [];
    let cf2: CardMeta[] = [];

    let s1: number | null = null;
    let s2: number | null = null;
    let rw: string | null = null;

    for (const e of timeline) {
      if (e.t > t) break;

      if (e.type === "round_start") {
        rr = (e as any).round ?? rr;

        c1 = [];
        c2 = [];
        cf1 = [];
        cf2 = [];

        s1 = null;
        s2 = null;
        rw = null;
      } else if (e.type === "reveal") {
        rr = (e as any).round ?? rr;

        // ✅ normalize ids arrays (can be jsonb/string)
        c1 = toStringArray((e as any).p1_cards ?? c1);
        c2 = toStringArray((e as any).p2_cards ?? c2);

        // ✅ normalize meta arrays (can be json/string)
        const a1 = toCardMetaArray((e as any).p1_cards_full);
        const a2 = toCardMetaArray((e as any).p2_cards_full);
        if (a1.length) cf1 = a1;
        if (a2.length) cf2 = a2;
      } else if (e.type === "score") {
        rr = (e as any).round ?? rr;
        s1 = Number((e as any).p1 ?? 0);
        s2 = Number((e as any).p2 ?? 0);
      } else if (e.type === "round_end") {
        rr = (e as any).round ?? rr;
        rw = (e as any).winner ?? null;
      }
    }

    // reveal animation trigger (by signature)
    const sigLeft = (cf1?.map((x) => x?.id).join("|") || c1.join("|")) ?? "";
    const sigRight = (cf2?.map((x) => x?.id).join("|") || c2.join("|")) ?? "";
    const revealSig = [rr, `${sigLeft}::${sigRight}`].join("::");

    if (revealSig !== prevRevealSigRef.current) {
      const hasSomething =
        (cf1?.length || 0) > 0 ||
        (cf2?.length || 0) > 0 ||
        (c1?.length || 0) > 0 ||
        (c2?.length || 0) > 0;
      if (hasSomething) setRevealTick((x) => x + 1);
      prevRevealSigRef.current = revealSig;
    }

    // score hit
    const prevS1 = prevScoreRef.current.p1;
    const prevS2 = prevScoreRef.current.p2;
    if (s1 != null && prevS1 != null && s1 !== prevS1) {
      setP1Hit(true);
      window.setTimeout(() => setP1Hit(false), 220);
    }
    if (s2 != null && prevS2 != null && s2 !== prevS2) {
      setP2Hit(true);
      window.setTimeout(() => setP2Hit(false), 220);
    }
    prevScoreRef.current = { p1: s1, p2: s2 };

    setRoundN(rr);

    setP1Cards(c1);
    setP2Cards(c2);

    setP1CardsFull(cf1);
    setP2CardsFull(cf2);

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

  const progressPct = useMemo(() => {
    if (!durationSec) return 0;
    return Math.max(0, Math.min(100, (t / durationSec) * 100));
  }, [t, durationSec]);

  const phase = useMemo(() => {
    let hasReveal = false;
    let hasScore = false;
    let hasEnd = false;

    for (const e of timeline) {
      if ((e as any).round !== roundN) continue;
      if (e.t > t) break;
      if (e.type === "reveal") hasReveal = true;
      if (e.type === "score") hasScore = true;
      if (e.type === "round_end") hasEnd = true;
    }

    if (hasEnd) return "end";
    if (hasScore) return "score";
    if (hasReveal) return "reveal";
    return "start";
  }, [timeline, roundN, t]);

  const finalWinnerLabel = useMemo(() => {
    if (!match) return "…";
    if (!match.winner_user_id) return "Ничья";
    return "Есть победитель";
  }, [match]);

  function CardSlot({
    card,
    fallbackId,
    revealed,
    delayMs,
  }: {
    card?: CardMeta | null;
    fallbackId?: string | null;
    revealed: boolean;
    delayMs: number;
  }) {
    const id = card?.id || fallbackId || "";
    const title = (card?.name && String(card.name).trim()) || safeSliceId(id);

    const r = (card?.rarity || "common") as string;
    const power = typeof card?.base_power === "number" ? card.base_power : null;
    const img = card?.image_url || null;

    return (
      <div
        className={["battle-card", revealed ? "is-revealed" : "", `rt-${revealTick}`].join(" ")}
        style={{ animationDelay: `${delayMs}ms` }}
      >
        <div className="battle-card-inner">
          {/* BACK */}
          <div className="battle-card-face battle-card-back">
            <div className="battle-card-mark">696</div>
          </div>

          {/* FRONT */}
          <div className={["battle-card-face", "battle-card-front", rarityFxClass(r)].join(" ")}>
            {img ? (
              <div className="battle-card-art" style={{ backgroundImage: `url(${img})` }} />
            ) : (
              <div className="battle-card-art placeholder">
                <div className="battle-card-mark-sm">CARD</div>
              </div>
            )}

            <div className="battle-card-overlay">
              <div className="battle-card-title">{title}</div>
              <div className="battle-card-subrow">
                <span className="battle-chip">{rarityRu(r)}</span>
                {power != null && (
                  <span className="battle-chip">
                    POW <b className="tabular-nums">{power}</b>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
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
          <button onClick={() => refreshSession?.()} className="mt-5 ui-btn ui-btn-primary w-full">
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

  const revealed = phase === "reveal" || phase === "score" || phase === "end";
  const scored = phase === "score" || phase === "end";

  const p1Render = p1CardsFull?.length ? p1CardsFull : [];
  const p2Render = p2CardsFull?.length ? p2CardsFull : [];

  return (
    <main className="min-h-screen px-4 pt-6 pb-24 flex justify-center">
      <style jsx global>{`
        @keyframes flipIn {
          0% { transform: rotateY(0deg) scale(0.98); }
          55% { transform: rotateY(90deg) scale(1.02); }
          100% { transform: rotateY(180deg) scale(1); }
        }
        @keyframes popHit {
          0% { transform: scale(1); }
          50% { transform: scale(1.08); }
          100% { transform: scale(1); }
        }
        @keyframes glowPulse {
          0% { opacity: 0.18; }
          50% { opacity: 0.32; }
          100% { opacity: 0.18; }
        }

        .battle-progress {
          height: 10px;
          border-radius: 999px;
          overflow: hidden;
          border: 1px solid var(--border);
          background: rgba(255, 255, 255, 0.04);
        }
        .battle-progress > div {
          height: 100%;
          background: rgba(255, 255, 255, 0.18);
          box-shadow: 0 0 16px rgba(255, 255, 255, 0.18);
        }

        .battle-arena { position: relative; overflow: hidden; }
        .battle-arena::before {
          content: "";
          position: absolute;
          inset: -30px;
          pointer-events: none;
          background: radial-gradient(900px 420px at 50% -10%, rgba(88, 240, 255, 0.18) 0%, transparent 60%),
                      radial-gradient(720px 520px at 70% 40%, rgba(184, 92, 255, 0.14) 0%, transparent 65%),
                      radial-gradient(720px 520px at 30% 55%, rgba(255, 204, 87, 0.08) 0%, transparent 70%);
          opacity: 0.9;
        }
        .battle-arena::after {
          content: "";
          position: absolute;
          inset: -20%;
          pointer-events: none;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.14), transparent);
          opacity: 0.18;
          animation: glowPulse 2.2s ease-in-out infinite;
          mix-blend-mode: screen;
        }

        .battle-card {
          width: 100%;
          max-width: 150px;
          aspect-ratio: 3 / 4;
          perspective: 900px;
          border-radius: 18px;
        }
        .battle-card-inner {
          width: 100%;
          height: 100%;
          border-radius: 18px;
          transform-style: preserve-3d;
          transition: transform 420ms var(--ease-out);
          transform: rotateY(0deg);
        }
        .battle-card.is-revealed .battle-card-inner { transform: rotateY(180deg); }
        .battle-card.is-revealed { animation: flipIn 520ms var(--ease-out) both; }

        .battle-card-face {
          position: absolute;
          inset: 0;
          border-radius: 18px;
          backface-visibility: hidden;
          border: 1px solid rgba(255, 255, 255, 0.22);
          background: rgba(255, 255, 255, 0.06);
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .battle-card-back {
          background: radial-gradient(380px 260px at 50% 10%, rgba(255, 255, 255, 0.12) 0%, transparent 58%),
                      linear-gradient(to bottom, rgba(0, 0, 0, 0.18), rgba(0, 0, 0, 0.34));
        }
        .battle-card-front {
          transform: rotateY(180deg);
          background: radial-gradient(380px 260px at 50% 10%, rgba(255, 255, 255, 0.16) 0%, transparent 58%),
                      linear-gradient(to bottom, rgba(255, 255, 255, 0.06), rgba(0, 0, 0, 0.26));
        }

        .battle-card-mark {
          font-weight: 900;
          letter-spacing: 0.24em;
          font-size: 14px;
          opacity: 0.75;
          text-transform: uppercase;
        }
        .battle-card-mark-sm {
          font-weight: 900;
          letter-spacing: 0.18em;
          font-size: 11px;
          opacity: 0.7;
          text-transform: uppercase;
        }

        .battle-card-art {
          position: absolute;
          inset: 0;
          background-size: cover;
          background-position: center;
          filter: saturate(1.05) contrast(1.05);
          transform: scale(1.02);
        }
        .battle-card-art.placeholder {
          background: radial-gradient(420px 260px at 50% 10%, rgba(255, 255, 255, 0.12) 0%, transparent 58%),
                      linear-gradient(to bottom, rgba(0, 0, 0, 0.22), rgba(0, 0, 0, 0.36));
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .battle-card-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          padding: 12px;
          background: linear-gradient(to top, rgba(0, 0, 0, 0.62), rgba(0, 0, 0, 0.12), transparent);
        }

        .battle-card-title {
          font-weight: 900;
          letter-spacing: 0.06em;
          font-size: 12px;
          text-transform: uppercase;
          line-height: 1.15;
        }

        .battle-card-subrow {
          margin-top: 8px;
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .battle-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.22);
          background: rgba(255, 255, 255, 0.08);
          font-size: 10px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }

        .rar-common { box-shadow: inset 0 0 0 9999px rgba(255, 255, 255, 0.02); }
        .rar-rare { box-shadow: inset 0 0 0 9999px rgba(88, 240, 255, 0.06); }
        .rar-epic { box-shadow: inset 0 0 0 9999px rgba(184, 92, 255, 0.07); }
        .rar-legendary { box-shadow: inset 0 0 0 9999px rgba(255, 204, 87, 0.07); }

        .battle-score {
          font-weight: 900;
          letter-spacing: 0.06em;
          font-variant-numeric: tabular-nums;
        }
        .battle-score.is-hit { animation: popHit 220ms var(--ease-out) both; }

        .battle-phase {
          font-size: 11px;
          opacity: 0.75;
          letter-spacing: 0.18em;
          text-transform: uppercase;
        }
        .battle-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          border-radius: 999px;
          border: 1px solid var(--border);
          background: rgba(255, 255, 255, 0.06);
        }
        .battle-winner {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 12px 16px;
          border-radius: 16px;
          border: 1px solid rgba(255, 255, 255, 0.22);
          background: rgba(0, 0, 0, 0.22);
        }
      `}</style>

      <div className="w-full max-w-5xl">
        <header className="ui-card px-4 py-3 rounded-[var(--r-xl)] mb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="ui-subtitle">BATTLE</div>
              <div className="mt-1 font-extrabold uppercase tracking-[0.22em] text-base">
                Поле боя • {fmtTime(t)} / {fmtTime(durationSec)}
              </div>

              <div className="mt-2 battle-progress">
                <div style={{ width: `${progressPct}%` }} />
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="battle-badge">
                  <span className="battle-phase">
                    {phase === "start"
                      ? "ROUND START"
                      : phase === "reveal"
                      ? "REVEAL"
                      : phase === "score"
                      ? "SCORE"
                      : "ROUND END"}
                  </span>
                </span>

                <span className="ui-pill">
                  Раунд{" "}
                  <span className="ml-2 font-extrabold tabular-nums">
                    {roundN}/{roundCount}
                  </span>
                </span>

                <span className="ui-pill">
                  Match{" "}
                  <span className="ml-2 font-extrabold tabular-nums">
                    {String(match.id).slice(0, 8)}…
                  </span>
                </span>

                {/* ✅ debug: чтобы сразу видеть что timeline реально не пустой */}
                <span className="ui-pill">
                  tl{" "}
                  <span className="ml-2 font-extrabold tabular-nums">
                    {timeline.length}
                  </span>
                </span>
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

        <section className="ui-card-strong p-5 rounded-[var(--r-xl)] battle-arena">
          <div className="ui-subtitle">Раунд {roundN}</div>

          <div className="mt-4 ui-grid sm:grid-cols-2 gap-4 relative">
            {/* P1 */}
            <div className="ui-card p-4">
              <div className="flex items-center justify-between">
                <div className="ui-subtitle">P1</div>
                <div className="text-[12px] ui-subtle">Карты: 5</div>
              </div>

              <div className="mt-3 flex flex-wrap gap-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <CardSlot
                    key={`p1-${revealTick}-${i}`}
                    card={p1Render?.[i] ?? null}
                    fallbackId={p1Cards?.[i] ?? null}
                    revealed={
                      revealed &&
                      ((p1Render?.length || 0) > 0 || (p1Cards?.length || 0) > 0)
                    }
                    delayMs={i * 60}
                  />
                ))}
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div className="text-sm ui-subtle">Счёт</div>
                <div className={["battle-score text-lg", p1Hit ? "is-hit" : ""].join(" ")}>
                  {scored ? (p1Score == null ? "…" : p1Score) : "…"}
                </div>
              </div>
            </div>

            {/* P2 */}
            <div className="ui-card p-4">
              <div className="flex items-center justify-between">
                <div className="ui-subtitle">P2</div>
                <div className="text-[12px] ui-subtle">Карты: 5</div>
              </div>

              <div className="mt-3 flex flex-wrap gap-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <CardSlot
                    key={`p2-${revealTick}-${i}`}
                    card={p2Render?.[i] ?? null}
                    fallbackId={p2Cards?.[i] ?? null}
                    revealed={
                      revealed &&
                      ((p2Render?.length || 0) > 0 || (p2Cards?.length || 0) > 0)
                    }
                    delayMs={i * 60}
                  />
                ))}
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div className="text-sm ui-subtle">Счёт</div>
                <div className={["battle-score text-lg", p2Hit ? "is-hit" : ""].join(" ")}>
                  {scored ? (p2Score == null ? "…" : p2Score) : "…"}
                </div>
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

            {roundWinner && (
              <div className="mt-3 battle-winner">
                <div className="ui-subtitle">RESULT</div>
                <div className="text-sm ui-subtle">
                  {roundWinner === "draw"
                    ? "Ничья"
                    : roundWinner === "p1"
                    ? "P1 забрал раунд"
                    : "P2 забрал раунд"}
                </div>
              </div>
            )}
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
                    Победитель: <span className="font-semibold">{r?.winner ?? "—"}</span>
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
