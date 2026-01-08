"use client";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useGameSessionContext } from "../../context/GameSessionContext";
import CardArt from "../../components/CardArt";

/* =========================
   TYPES
========================= */

type MatchRow = {
  id: string;
  p1_user_id: string;
  p2_user_id: string;
  winner_user_id: string | null;
  log: any;
};

type CardMeta = {
  id: string;
  rarity: string;
  base_power: number;
  name?: string;
  image_url?: string | null;
};

type UnitView = {
  instanceId: string;
  side: "p1" | "p2";
  slot: number;
  card_id: string;
  hp: number;
  maxHp: number;
  shield: number;
  alive: boolean;
};

/* =========================
   HELPERS
========================= */

function parseJson(v: any) {
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

/* =========================
   MAIN
========================= */

function BattleInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const matchId = sp.get("matchId");

  const session = useGameSessionContext() as any;
  const { isTelegramEnv, loading, timedOut, error, refreshSession } = session;

  const [match, setMatch] = useState<MatchRow | null>(null);
  const [errText, setErrText] = useState<string | null>(null);

  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [rate, setRate] = useState<0.5 | 1 | 2>(1);

  const rafRef = useRef<number | null>(null);
  const startAtRef = useRef<number | null>(null);

  /* =========================
     LOAD MATCH
  ========================= */

  useEffect(() => {
    if (!matchId) {
      setErrText("matchId required");
      return;
    }

    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/pvp/match?matchId=${matchId}`);
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(data?.error || "Load failed");
        setMatch(data.match);
      } catch (e: any) {
        if (alive) setErrText(e.message);
      }
    })();

    return () => {
      alive = false;
    };
  }, [matchId]);

  /* =========================
     TIMELINE
  ========================= */

  const logObj = useMemo(() => parseJson(match?.log ?? {}), [match]);
  const timeline = useMemo(() => {
    const tl = parseJson(logObj?.timeline);
    if (!Array.isArray(tl)) return [];
    return tl
      .map((e: any) => ({ ...e, t: Number(e.t ?? 0) }))
      .filter((e: any) => Number.isFinite(e.t))
      .sort((a: any, b: any) => a.t - b.t);
  }, [logObj]);

  const durationSec = useMemo(() => {
    const d = Number(logObj?.duration_sec ?? 30);
    return clamp(d, 10, 240);
  }, [logObj]);

  /* =========================
     PLAYBACK
  ========================= */

  useEffect(() => {
    if (!playing) return;

    const step = (now: number) => {
      if (startAtRef.current == null) {
        startAtRef.current = now - (t / rate) * 1000;
      }

      const elapsed = ((now - startAtRef.current) / 1000) * rate;
      const nextT = Math.min(durationSec, elapsed);
      setT(nextT);

      if (nextT < durationSec) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        setPlaying(false);
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, rate, durationSec]);

  useEffect(() => {
    startAtRef.current = null;
  }, [rate, playing]);

  /* =========================
     BUILD BOARD STATE
  ========================= */

  const { p1Slots, p2Slots } = useMemo(() => {
    const units = new Map<string, UnitView>();
    const p1: Record<number, UnitView | null> = {};
    const p2: Record<number, UnitView | null> = {};

    for (let i = 0; i < 5; i++) {
      p1[i] = null;
      p2[i] = null;
    }

    for (const e of timeline) {
      if (e.t > t) break;

      if (e.type === "spawn") {
        const u: UnitView = {
          instanceId: e.instanceId,
          side: e.side,
          slot: e.slot,
          card_id: e.card_id,
          hp: e.hp,
          maxHp: e.maxHp,
          shield: e.shield ?? 0,
          alive: true,
        };
        units.set(u.instanceId, u);
        (u.side === "p1" ? p1 : p2)[u.slot] = u;
      }

      if (e.type === "damage") {
        const u = units.get(e.target?.instanceId);
        if (u) {
          u.hp = clamp(e.hp ?? u.hp - e.amount, 0, u.maxHp);
          if (u.hp <= 0) u.alive = false;
        }
      }
    }

    return {
      p1Slots: Object.values(p1),
      p2Slots: Object.values(p2),
    };
  }, [timeline, t]);

  /* =========================
     RENDERS
  ========================= */

  if (!isTelegramEnv) {
    return <div>Open in Telegram</div>;
  }

  if (loading) return <div>Loading…</div>;
  if (timedOut || error)
    return <button onClick={() => refreshSession?.()}>Re-sync</button>;
  if (errText) return <div>{errText}</div>;
  if (!match) return <div>Loading match…</div>;

  return (
    <main style={{ padding: 16 }}>
      <h2>BATTLE</h2>

      <div>
        <button onClick={() => setPlaying((p) => !p)}>
          {playing ? "Pause" : "Play"}
        </button>
        <button onClick={() => setT(0)}>Restart</button>
        <button onClick={() => router.push("/pvp")}>Back</button>
      </div>

      <div>
        Time: {t.toFixed(2)} / {durationSec}
      </div>

      <hr />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
        {p2Slots.map((u, i) =>
          u ? (
            <CardArt key={i} src={u.card_id} atk={0} hp={u.hp} />
          ) : (
            <div key={i}>—</div>
          ),
        )}
      </div>

      <hr />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
        {p1Slots.map((u, i) =>
          u ? (
            <CardArt key={i} src={u.card_id} atk={0} hp={u.hp} />
          ) : (
            <div key={i}>—</div>
          ),
        )}
      </div>
    </main>
  );
}

export default function BattlePage() {
  return (
    <Suspense fallback={<div>Loading…</div>}>
      <BattleInner />
    </Suspense>
  );
}
