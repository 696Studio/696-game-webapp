// @ts-nocheck
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useGameSessionContext } from "../../context/GameSessionContext";
import CardArt from "../../components/CardArt";

type MatchRow = {
  id: string;
  p1_user_id: string;
  p2_user_id: string;
  winner_user_id: string | null;
  log: any;
};

type CardMeta = {
  id: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  base_power: number;
  name?: string;
  image_url?: string | null;
};

type TimelineEvent = { t: number; type: string; [k: string]: any };

type UnitView = {
  instanceId: string;
  side: "p1" | "p2";
  slot: number;
  card_id: string;
  hp: number;
  maxHp: number;
  shield: number;
  alive: boolean;
  tags: Set<string>;
};

function parseMaybeJson(v: any) {
  try {
    if (typeof v === "string") return JSON.parse(v);
  } catch {}
  return v;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function CardSlot({
  card,
  unit,
}: {
  card?: CardMeta | null;
  unit?: UnitView | null;
}) {
  if (!unit) return null;

  const hpPct = clamp((unit.hp / Math.max(1, unit.maxHp)) * 100, 0, 100);
  const shieldPct = clamp((unit.shield / Math.max(1, unit.maxHp)) * 100, 0, 100);

  return (
    <div className="bb-slot">
      <div className="bb-card">
        <CardArt
          variant="pvp"
          src={card?.image_url || null}
          showStats={false}
          atk={card?.base_power ?? 0}
          hp={unit.hp}
          shield={unit.shield}
        />
        <div className="bb-card__ui">
          <div className="bb-card__title">{card?.name || card?.id}</div>
          <div className="bb-card__bars">
            <div className="bb-card__hp">
              <div style={{ width: `${hpPct}%` }} />
            </div>
            {unit.shield > 0 && (
              <div className="bb-card__shield">
                <div style={{ width: `${shieldPct}%` }} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function BattleCore() {
  const router = useRouter();
  const sp = useSearchParams();
  const matchId = sp.get("matchId") || "";

  const session = useGameSessionContext() as any;
  const { loading, error } = session;

  const [match, setMatch] = useState<MatchRow | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);

  const logObj = useMemo(() => parseMaybeJson(match?.log) || {}, [match]);
  const timeline: TimelineEvent[] = useMemo(() => {
    const tl = parseMaybeJson(logObj?.timeline);
    if (!Array.isArray(tl)) return [];
    return tl.map((e: any) => ({ ...e, t: Number(e.t || 0) })).sort((a, b) => a.t - b.t);
  }, [logObj]);

  const durationSec = Number(logObj?.duration_sec ?? 30);

  const [p1Units, setP1Units] = useState<Record<number, UnitView | null>>({});
  const [p2Units, setP2Units] = useState<Record<number, UnitView | null>>({});
  const [p1Cards, setP1Cards] = useState<CardMeta[]>([]);
  const [p2Cards, setP2Cards] = useState<CardMeta[]>([]);

  useEffect(() => {
    if (!matchId) return;
    fetch(`/api/pvp/match?matchId=${matchId}`)
      .then((r) => r.json())
      .then((d) => setMatch(d.match));
  }, [matchId]);

  useEffect(() => {
    if (!playing) return;
    const id = requestAnimationFrame(() => {
      setT((x) => Math.min(durationSec, x + 0.016));
    });
    return () => cancelAnimationFrame(id);
  }, [playing, t, durationSec]);

  useEffect(() => {
    const u1: Record<number, UnitView | null> = {};
    const u2: Record<number, UnitView | null> = {};

    for (const e of timeline) {
      if (e.t > t) break;

      if (e.type === "reveal") {
        setP1Cards(e.p1_cards_full || []);
        setP2Cards(e.p2_cards_full || []);
      }

      if (e.type === "spawn") {
        const ref = e.unit || e;
        const unit: UnitView = {
          instanceId: ref.instanceId,
          side: ref.side,
          slot: ref.slot,
          card_id: e.card_id,
          hp: e.hp,
          maxHp: e.maxHp,
          shield: e.shield || 0,
          alive: true,
          tags: new Set(),
        };
        if (ref.side === "p1") u1[ref.slot] = unit;
        else u2[ref.slot] = unit;
      }

      if (e.type === "damage") {
        const tid = e.target?.instanceId;
        const all = [...Object.values(u1), ...Object.values(u2)];
        const u = all.find((x) => x?.instanceId === tid);
        if (u) u.hp = Math.max(0, e.hp ?? u.hp - e.amount);
      }

      if (e.type === "death") {
        const tid = e.unit?.instanceId;
        const all = [...Object.values(u1), ...Object.values(u2)];
        const u = all.find((x) => x?.instanceId === tid);
        if (u) u.alive = false;
      }
    }

    setP1Units(u1);
    setP2Units(u2);
  }, [timeline, t]);

  if (loading) return <div>Loading…</div>;
  if (error) return <div>Error</div>;
  if (!match) return <div>Loading match…</div>;

  return (
    <main className="battle-core">
      <div className="lane">
        {Array.from({ length: 5 }).map((_, i) => (
          <CardSlot key={`p2-${i}`} card={p2Cards[i]} unit={p2Units[i]} />
        ))}
      </div>
      <div className="lane">
        {Array.from({ length: 5 }).map((_, i) => (
          <CardSlot key={`p1-${i}`} card={p1Cards[i]} unit={p1Units[i]} />
        ))}
      </div>
      <button onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play"}</button>
      <button onClick={() => router.back()}>Back</button>
    </main>
  );
}

export default function Page() {
  return <BattleCore />;
}
