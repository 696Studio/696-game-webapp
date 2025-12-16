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

  const logObj = useMemo(() => {
    const l = match?.log;
    return (parseMaybeJson(l) ?? {}) as any;
  }, [match?.log]);

  const durationSec = useMemo(() => {
    const d = Number(logObj?.duration_sec ?? 30);
    if (!Number.isFinite(d) || d <= 0) return 30;
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

  // meta cards for rendering
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

  useEffect(() => {
    if (!matchId) {
      setErrText("matchId required");
      return;
    }

    let alive = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/pvp/match?id=${encodeURIComponent(matchId)}`
        );
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

  // timeline → game state at time t
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
        c1 = toStringArray((e as any).p1_cards ?? c1);
        c2 = toStringArray((e as any).p2_cards ?? c2);

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

    // trigger reveal anim
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

  const revealed = phase === "reveal" || phase === "score" || phase === "end";
  const scored = phase === "score" || phase === "end";

  const p1Slots = useMemo(
    () =>
      Array.from({ length: 5 }).map((_, i) => ({
        card: p1CardsFull?.[i] ?? null,
        fallbackId: p1Cards?.[i] ?? null,
      })),
    [p1CardsFull, p1Cards]
  );

  const p2Slots = useMemo(
    () =>
      Array.from({ length: 5 }).map((_, i) => ({
        card: p2CardsFull?.[i] ?? null,
        fallbackId: p2Cards?.[i] ?? null,
      })),
    [p2CardsFull, p2Cards]
  );

  const boardFxClass = useMemo(() => {
    if (!scored) return "";
    if (roundWinner === "p1") return "fx-p1";
    if (roundWinner === "p2") return "fx-p2";
    if (roundWinner === "draw") return "fx-draw";
    return "";
  }, [scored, roundWinner]);

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
        className={["bb-card", revealed ? "is-revealed" : "", `rt-${revealTick}`].join(" ")}
        style={{ animationDelay: `${delayMs}ms` }}
      >
        <div className="bb-card-inner">
          <div className="bb-face bb-back">
            <div className="bb-mark">696</div>
          </div>

          <div className={["bb-face bb-front", rarityFxClass(r)].join(" ")}>
            {img ? (
              <div className="bb-art" style={{ backgroundImage: `url(${img})` }} />
            ) : (
              <div className="bb-art bb-art--ph">
                <div className="bb-mark-sm">CARD</div>
              </div>
            )}

            <div className="bb-overlay">
              <div className="bb-title">{title}</div>
              <div className="bb-subrow">
                <span className="bb-chip">{rarityRu(r)}</span>
                {power != null && (
                  <span className="bb-chip">
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
          0% { opacity: 0.14; }
          50% { opacity: 0.32; }
          100% { opacity: 0.14; }
        }
        @keyframes microShake {
          0% { transform: translate3d(0,0,0); }
          20% { transform: translate3d(-1px,0,0); }
          40% { transform: translate3d(1px,0,0); }
          60% { transform: translate3d(-1px,0,0); }
          80% { transform: translate3d(1px,0,0); }
          100% { transform: translate3d(0,0,0); }
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

        /* ===== BOARD WRAPPER ===== */
        .board {
          border: 1px solid rgba(255,255,255,0.18);
          border-radius: var(--r-xl);
          overflow: hidden;
          background: rgba(255,255,255,0.04);
        }

        .board-topbar {
          padding: 14px 14px 10px;
          border-bottom: 1px solid rgba(255,255,255,0.12);
          background: linear-gradient(to bottom, rgba(255,255,255,0.07), rgba(0,0,0,0.06));
        }

        .board-hud {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .hud-left { min-width: 0; }
        .hud-title {
          font-weight: 900;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          font-size: 13px;
        }

        .hud-sub {
          margin-top: 6px;
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }

        .hud-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.18);
          background: rgba(0,0,0,0.18);
          font-size: 11px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          opacity: 0.9;
        }

        .hud-actions { display: flex; gap: 8px; align-items: center; }

        /* ===== ARENA WITH PNG BACKGROUND ===== */
        .arena {
          position: relative;
          padding: 14px;
          overflow: hidden;
          background: rgba(0,0,0,0.22);
        }

        /* Слой доски (PNG) */
        .arena::before {
          content: "";
          position: absolute;
          inset: 0;
          background-image: url("/arena/board.png");
          background-size: cover;
          background-position: center;
          background-repeat: no-repeat;
          filter: saturate(1.02) contrast(1.04);
          transform: scale(1.02);
          opacity: 1;
        }

        /* Чуть глубины/блюма поверх, чтобы UI читался */
        .arena::after {
          content: "";
          position: absolute;
          inset: -25%;
          pointer-events: none;
          background:
            radial-gradient(980px 420px at 50% 0%, rgba(88,240,255,0.10) 0%, transparent 60%),
            radial-gradient(780px 560px at 70% 55%, rgba(184,92,255,0.08) 0%, transparent 65%),
            radial-gradient(780px 560px at 30% 55%, rgba(255,204,87,0.06) 0%, transparent 70%),
            linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent);
          opacity: 0.18;
          animation: glowPulse 2.2s ease-in-out infinite;
          mix-blend-mode: screen;
        }

        /* ВЕСЬ КОНТЕНТ ПОВЕРХ ФОНА */
        .arena > * { position: relative; z-index: 1; }

        .arena.fx-p1,
        .arena.fx-p2,
        .arena.fx-draw { animation: microShake 240ms ease-out 1; }

        .arena.fx-p1 .row-bottom { box-shadow: 0 0 0 1px rgba(88,240,255,0.18), 0 0 24px rgba(88,240,255,0.12); }
        .arena.fx-p2 .row-top { box-shadow: 0 0 0 1px rgba(184,92,255,0.18), 0 0 24px rgba(184,92,255,0.12); }
        .arena.fx-draw .row-top,
        .arena.fx-draw .row-bottom { box-shadow: 0 0 0 1px rgba(255,255,255,0.14), 0 0 18px rgba(255,255,255,0.10); }

        .lane { display: grid; gap: 14px; }

        .playerbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 12px 12px;
          border: 1px solid rgba(255,255,255,0.14);
          border-radius: 16px;
          background: rgba(0,0,0,0.22);
          backdrop-filter: blur(6px);
        }

        .player-left {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }

        .avatar {
          width: 38px;
          height: 38px;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.18);
          background: rgba(255,255,255,0.06);
          overflow: hidden;
          flex: 0 0 auto;
        }
        .avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }

        .nameblock { min-width: 0; }
        .nameblock .label {
          font-size: 10px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          opacity: 0.75;
        }
        .nameblock .name {
          margin-top: 2px;
          font-weight: 900;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          font-size: 12px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .player-right {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 0 0 auto;
        }

        .hp {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.18);
          background: rgba(255,255,255,0.06);
          font-weight: 900;
          letter-spacing: 0.08em;
          font-variant-numeric: tabular-nums;
          font-size: 11px;
        }

        .score {
          font-weight: 900;
          letter-spacing: 0.06em;
          font-variant-numeric: tabular-nums;
          font-size: 18px;
        }
        .score.is-hit { animation: popHit 220ms var(--ease-out) both; }

        .row {
          border-radius: 18px;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(0,0,0,0.22);
          backdrop-filter: blur(6px);
          padding: 10px;
          display: flex;
          justify-content: center;
        }

        .slots {
          width: 100%;
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 10px;
          max-width: 820px;
        }

        /* ===== CARD ===== */
        .bb-card {
          width: 100%;
          aspect-ratio: 3 / 4;
          max-width: 150px;
          perspective: 900px;
          border-radius: 18px;
          margin: 0 auto;
        }

        .bb-card-inner {
          width: 100%;
          height: 100%;
          border-radius: 18px;
          transform-style: preserve-3d;
          transition: transform 420ms var(--ease-out);
          transform: rotateY(0deg);
        }

        .bb-card.is-revealed .bb-card-inner { transform: rotateY(180deg); }
        .bb-card.is-revealed { animation: flipIn 520ms var(--ease-out) both; }

        .bb-face {
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

        .bb-back {
          background:
            radial-gradient(380px 260px at 50% 10%, rgba(255, 255, 255, 0.12) 0%, transparent 58%),
            linear-gradient(to bottom, rgba(0, 0, 0, 0.18), rgba(0, 0, 0, 0.34));
        }

        .bb-front {
          transform: rotateY(180deg);
          background:
            radial-gradient(380px 260px at 50% 10%, rgba(255, 255, 255, 0.16) 0%, transparent 58%),
            linear-gradient(to bottom, rgba(255, 255, 255, 0.06), rgba(0, 0, 0, 0.26));
        }

        .bb-mark {
          font-weight: 900;
          letter-spacing: 0.24em;
          font-size: 14px;
          opacity: 0.75;
          text-transform: uppercase;
        }
        .bb-mark-sm {
          font-weight: 900;
          letter-spacing: 0.18em;
          font-size: 11px;
          opacity: 0.7;
          text-transform: uppercase;
        }

        .bb-art {
          position: absolute;
          inset: 0;
          background-size: cover;
          background-position: center;
          filter: saturate(1.05) contrast(1.05);
          transform: scale(1.02);
        }
        .bb-art--ph {
          background:
            radial-gradient(420px 260px at 50% 10%, rgba(255, 255, 255, 0.12) 0%, transparent 58%),
            linear-gradient(to bottom, rgba(0, 0, 0, 0.22), rgba(0, 0, 0, 0.36));
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .bb-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          padding: 12px;
          background: linear-gradient(to top, rgba(0, 0, 0, 0.62), rgba(0, 0, 0, 0.12), transparent);
        }

        .bb-title {
          font-weight: 900;
          letter-spacing: 0.06em;
          font-size: 12px;
          text-transform: uppercase;
          line-height: 1.15;
        }

        .bb-subrow {
          margin-top: 8px;
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .bb-chip {
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

        @media (max-width: 640px) {
          .slots { gap: 8px; }
          .bb-card { max-width: 110px; border-radius: 16px; }
          .bb-face { border-radius: 16px; }
          .bb-card-inner { border-radius: 16px; }
        }
      `}</style>

      <div className="w-full max-w-5xl">
        <header className="board-topbar ui-card rounded-[var(--r-xl)] mb-4">
          <div className="board-hud">
            <div className="hud-left">
              <div className="hud-title">BATTLE</div>
              <div className="mt-1 font-extrabold uppercase tracking-[0.22em] text-base">
                Поле боя • {fmtTime(t)} / {fmtTime(durationSec)}
              </div>
              <div className="mt-2 battle-progress">
                <div style={{ width: `${progressPct}%` }} />
              </div>

              <div className="hud-sub">
                <span className="hud-pill">
                  {phase === "start"
                    ? "ROUND START"
                    : phase === "reveal"
                    ? "REVEAL"
                    : phase === "score"
                    ? "SCORE"
                    : "ROUND END"}
                </span>

                <span className="hud-pill">
                  Раунд <b className="tabular-nums">{roundN}/{roundCount}</b>
                </span>

                <span className="hud-pill">
                  Match <b className="tabular-nums">{String(match.id).slice(0, 8)}…</b>
                </span>

                <span className="hud-pill">
                  tl <b className="tabular-nums">{timeline.length}</b>
                </span>
              </div>
            </div>

            <div className="hud-actions">
              <button onClick={togglePlay} className="ui-btn ui-btn-ghost">
                {playing ? "Пауза" : "▶"}
              </button>
              <button onClick={backToPvp} className="ui-btn ui-btn-ghost">
                Назад
              </button>
            </div>
          </div>
        </header>

        <section className={["board", "arena", boardFxClass].join(" ")}>
          <div className="lane">
            {/* ENEMY */}
            <div className="playerbar">
              <div className="player-left">
                <div className="avatar">
                  <img
                    alt="enemy"
                    src={`https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${match.p2_user_id || "enemy"}`}
                  />
                </div>
                <div className="nameblock">
                  <div className="label">ENEMY</div>
                  <div className="name">{safeSliceId(match.p2_user_id)}</div>
                </div>
              </div>

              <div className="player-right">
                <div className="hp">HP <b className="tabular-nums">30</b></div>
                <div className={["score", p2Hit ? "is-hit" : ""].join(" ")}>
                  {scored ? (p2Score == null ? "…" : p2Score) : "…"}
                </div>
              </div>
            </div>

            {/* TOP ROW */}
            <div className="row row-top">
              <div className="slots">
                {p2Slots.map((s, i) => (
                  <CardSlot
                    key={`p2-${revealTick}-${i}`}
                    card={s.card}
                    fallbackId={s.fallbackId}
                    revealed={revealed && (p2CardsFull.length > 0 || p2Cards.length > 0)}
                    delayMs={i * 70}
                  />
                ))}
              </div>
            </div>

            {/* CENTER INFO */}
            <div className="ui-card p-4" style={{ background: "rgba(0,0,0,0.22)", backdropFilter: "blur(6px)" }}>
              <div className="ui-subtitle">Раунд {roundN}</div>
              <div className="mt-2 text-sm ui-subtle">
                Победитель раунда:{" "}
                <span className="font-extrabold">
                  {roundWinner ? String(roundWinner).toUpperCase() : "…"}
                </span>
              </div>
            </div>

            {/* BOTTOM ROW */}
            <div className="row row-bottom">
              <div className="slots">
                {p1Slots.map((s, i) => (
                  <CardSlot
                    key={`p1-${revealTick}-${i}`}
                    card={s.card}
                    fallbackId={s.fallbackId}
                    revealed={revealed && (p1CardsFull.length > 0 || p1Cards.length > 0)}
                    delayMs={i * 70}
                  />
                ))}
              </div>
            </div>

            {/* YOU */}
            <div className="playerbar">
              <div className="player-left">
                <div className="avatar">
                  <img
                    alt="you"
                    src={`https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${match.p1_user_id || "you"}`}
                  />
                </div>
                <div className="nameblock">
                  <div className="label">YOU</div>
                  <div className="name">{safeSliceId(match.p1_user_id)}</div>
                </div>
              </div>

              <div className="player-right">
                <div className="hp">HP <b className="tabular-nums">30</b></div>
                <div className={["score", p1Hit ? "is-hit" : ""].join(" ")}>
                  {scored ? (p1Score == null ? "…" : p1Score) : "…"}
                </div>
              </div>
            </div>

            {!playing && t >= durationSec && (
              <div className="ui-card p-5" style={{ background: "rgba(0,0,0,0.22)", backdropFilter: "blur(6px)" }}>
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
              </div>
            )}
          </div>
        </section>
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
