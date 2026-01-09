export const dynamic = 'force-dynamic';

// @ts-nocheck
"use client";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useGameSessionContext } from "../../context/GameSessionContext";
import CardArt from "../../components/CardArt";

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

type UnitRef = { side: "p1" | "p2"; slot: number; instanceId: string };

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
  | { t: number; type: "round_end"; round: number; winner: "p1" | "p2" | "draw" }
  | {
      t: number;
      type: "spawn";
      round: number;
      unit?: UnitRef;
      side?: "p1" | "p2";
      slot?: number;
      instanceId?: string;
      card_id: string;
      hp: number;
      maxHp: number;
      shield?: number;
    }
  | {
      t: number;
      type: "turn_start";
      round: number;
      unit?: UnitRef;
      side?: "p1" | "p2";
      slot?: number;
      instanceId?: string;
    }
  | {
      t: number;
      type: "attack";
      round: number;
      from: UnitRef;
      to: UnitRef;
      hits?: number;
    }
  | {
      t: number;
      type: "damage";
      round: number;
      target: UnitRef;
      amount: number;
      blocked?: boolean;
      hp?: number;
      shield?: number;
    }
  | { t: number; type: "heal"; round: number; target: UnitRef; amount: number; hp?: number }
  | { t: number; type: "shield"; round: number; target: UnitRef; amount: number; shield?: number }
  | { t: number; type: "shield_hit"; round: number; target: UnitRef; amount: number; shield?: number }
  | {
      t: number;
      type: "debuff_applied";
      round: number;
      debuff: string;
      target: UnitRef;
      ticks?: number;
      duration_turns?: number;
      pct?: number;
      tick_damage?: number;
    }
  | {
      t: number;
      type: "buff_applied";
      round: number;
      buff: string;
      target?: UnitRef;
      side?: "p1" | "p2";
      slot?: number;
      instanceId?: string;
      duration_turns?: number;
      pct?: number;
    }
  | {
      t: number;
      type: "debuff_tick";
      round: number;
      debuff: string;
      target?: UnitRef;
      side?: "p1" | "p2";
      slot?: number;
      instanceId?: string;
      amount?: number;
    }
  | {
      t: number;
      type: "death";
      round: number;
      unit?: UnitRef;
      side?: "p1" | "p2";
      slot?: number;
      instanceId?: string;
      card_id?: string;
    }
  | { t: number; type: string; [k: string]: any };

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
  dyingAt?: number;
};

type AttackFx = { t: number; fromId: string; toId: string };
type SpawnFx = { t: number };
type DamageFx = { t: number; amount: number; blocked?: boolean };

type PlayerProfile = {
  id: string;
  username?: string | null;
  first_name?: string | null;
  avatar_url?: string | null;
};

function fmtTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function safeSliceId(id?: string | null) {
  const s = String(id ?? "");
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

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function readUnitRefFromEvent(e: any, key: "unit" | "target" | "from" | "to" = "unit"): UnitRef | null {
  const obj = e?.[key];
  if (obj && typeof obj === "object") {
    const side = obj.side as "p1" | "p2";
    const slot = Number(obj.slot ?? 0);
    const instanceId = String(obj.instanceId ?? "");
    if ((side === "p1" || side === "p2") && Number.isFinite(slot) && instanceId) {
      return { side, slot, instanceId };
    }
  }

  const side = e?.side as "p1" | "p2";
  const slot = Number(e?.slot ?? 0);
  const instanceId = String(e?.instanceId ?? "");
  if ((side === "p1" || side === "p2") && Number.isFinite(slot) && instanceId) {
    return { side, slot, instanceId };
  }
  return null;
}

function pickDisplayName(p?: PlayerProfile | null, fallbackId?: string | null) {
  const u = (p?.username || "").trim();
  const f = (p?.first_name || "").trim();
  if (u) return u.startsWith("@") ? u : `@${u}`;
  if (f) return f;
  return safeSliceId(fallbackId);
}

function pickAvatarUrl(p?: PlayerProfile | null, seed?: string) {
  const url = (p?.avatar_url || "").trim();
  if (url) return url;
  const s = (seed || p?.username || p?.id || "user").toString();
  return `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${encodeURIComponent(s)}`;
}

const CARD_FRAME_SRC = "/cards/frame/frame_common.png";

/**
 * Normalize card art urls after migration from /items/* to /cards/art/*.
 * - keeps absolute URLs (http/https/data/blob)
 * - rewrites legacy /items/characters/* and /items/pets/* into /cards/art/...
 */
function resolveCardArtUrl(raw?: string | null) {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  const lower = s.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("data:") || lower.startsWith("blob:")) {
    return s;
  }

  // Ensure leading slash for consistent matching
  const withSlash = s.startsWith("/") ? s : `/${s}`;

  if (withSlash.includes("/items/characters/")) return withSlash.replace("/items/characters/", "/cards/art/characters/");
  if (withSlash.includes("/items/pets/")) return withSlash.replace("/items/pets/", "/cards/art/pets/");

  return withSlash;
}

/**
 * ✅ BOARD COORDS FIX (background-size: cover)
 * IMPORTANT: BOARD_IMG_W/H MUST MATCH your real /public/arena/board.png size.
 * If they are wrong, everything will be shifted.
 */
const BOARD_IMG_W = 1290;
const BOARD_IMG_H = 2796;

const DEBUG_ARENA = true; // debug overlay for arena sizing
const DEBUG_GRID = true; // mirrored A/B measurement grid (dev only)
// Tweaks for your specific PNG (ring centers)
const TOP_RING_NX = 0.5;
const TOP_RING_NY = 0.165;
const BOT_RING_NX = 0.5;
const BOT_RING_NY = 0.950; // was 0.89

function coverMapPoint(nx: number, ny: number, containerW: number, containerH: number, imgW: number, imgH: number) {
  const scale = Math.max(containerW / imgW, containerH / imgH); // cover
  const drawnW = imgW * scale;
  const drawnH = imgH * scale;
  const offsetX = (containerW - drawnW) / 2;
  const offsetY = (containerH - drawnH) / 2;

  return {
    x: offsetX + nx * drawnW,
    y: offsetY + ny * drawnH,
    scale,
    offsetX,
    offsetY,
    drawnW,
    drawnH,
  };
}

function coverMapRect(
  nx1: number,
  ny1: number,
  nx2: number,
  ny2: number,
  containerW: number,
  containerH: number,
  imgW: number,
  imgH: number
) {
  const p1 = coverMapPoint(nx1, ny1, containerW, containerH, imgW, imgH);
  const p2 = coverMapPoint(nx2, ny2, containerW, containerH, imgW, imgH);
  const left = Math.min(p1.x, p2.x);
  const top = Math.min(p1.y, p2.y);
  const width = Math.abs(p2.x - p1.x);
  const height = Math.abs(p2.y - p1.y);
  return { left, top, width, height };
}

function BattleInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const matchId = sp.get("matchId") || "";

  const session = useGameSessionContext() as any;
  const { isTelegramEnv, loading, timedOut, error, refreshSession } = session as any;

  const myUserId: string | null =
    (session?.user?.id as string) ||
    (session?.profile?.id as string) ||
    (session?.bootstrap?.user?.id as string) ||
    (session?.bootstrap?.bootstrap?.user?.id as string) ||
    null;

  const [match, setMatch] = useState<MatchRow | null>(null);
  const [errText, setErrText] = useState<string | null>(null);

  const [profiles, setProfiles] = useState<Record<string, PlayerProfile>>({});

  const logObj = useMemo(() => {
    const l = match?.log;
    return (parseMaybeJson(l) ?? {}) as any;
  }, [match?.log]);

  const durationSec = useMemo(() => {
    const d = Number(logObj?.duration_sec ?? 30);
    if (!Number.isFinite(d) || d <= 0) return 30;
    return Math.min(240, Math.max(10, Math.floor(d)));
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

  const [playing, setPlaying] = useState(true);
  const [t, setT] = useState(0);
  const [rate, setRate] = useState<0.5 | 1 | 2>(1);

  const startAtRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const [roundN, setRoundN] = useState(1);

  const [p1Cards, setP1Cards] = useState<string[]>([]);
  const [p2Cards, setP2Cards] = useState<string[]>([]);

  const [p1CardsFull, setP1CardsFull] = useState<CardMeta[]>([]);
  const [p2CardsFull, setP2CardsFull] = useState<CardMeta[]>([]);

  const [p1Score, setP1Score] = useState<number | null>(null);
  const [p2Score, setP2Score] = useState<number | null>(null);
  const [roundWinner, setRoundWinner] = useState<string | null>(null);

  const [revealTick, setRevealTick] = useState(0);
  const [p1Hit, setP1Hit] = useState(false);
  const [p2Hit, setP2Hit] = useState(false);

  const prevRevealSigRef = useRef<string>("");
  const prevScoreRef = useRef<{ p1: number | null; p2: number | null }>({ p1: null, p2: null });

  const [roundBanner, setRoundBanner] = useState<{
    visible: boolean;
    tick: number;
    text: string;
    tone: "p1" | "p2" | "draw";
  }>({ visible: false, tick: 0, text: "", tone: "draw" });

  const prevEndSigRef = useRef<string>("");

  const [activeInstance, setActiveInstance] = useState<string | null>(null);
  const [p1UnitsBySlot, setP1UnitsBySlot] = useState<Record<number, UnitView | null>>({});
  const [p2UnitsBySlot, setP2UnitsBySlot] = useState<Record<number, UnitView | null>>({});

  const arenaRef = useRef<HTMLDivElement | null>(null);
  const unitElByIdRef = useRef<Record<string, HTMLDivElement | null>>({});

  const lastInstBySlotRef = useRef<Record<string, string>>({});

  
  const [arenaBox, setArenaBox] = useState<{ w: number; h: number } | null>(null);

  // layoutTick drives layout-dependent calculations (no FX dependency)
  const [layoutTick, setLayoutTick] = useState(0);


  const debugCover = useMemo(() => {
    if (!arenaBox) return null;

    const scale = Math.max(arenaBox.w / BOARD_IMG_W, arenaBox.h / BOARD_IMG_H);
    const drawnW = BOARD_IMG_W * scale;
    const drawnH = BOARD_IMG_H * scale;
    const offsetX = (arenaBox.w - drawnW) / 2;
    const offsetY = (arenaBox.h - drawnH) / 2;

    const top = coverMapPoint(TOP_RING_NX, TOP_RING_NY, arenaBox.w, arenaBox.h, BOARD_IMG_W, BOARD_IMG_H);
    const bot = coverMapPoint(BOT_RING_NX, BOT_RING_NY, arenaBox.w, arenaBox.h, BOARD_IMG_W, BOARD_IMG_H);

    return {
      arenaW: arenaBox.w,
      arenaH: arenaBox.h,
      scale,
      drawnW,
      drawnH,
      offsetX,
      offsetY,
      topX: top.x,
      topY: top.y,
      botX: bot.x,
      botY: bot.y,
    };
  }, [arenaBox]);

  // DEBUG GRID (A/B MIRROR)
  // Top half = "A" (0% at top edge, 100% at midline)
  // Bottom half = "B" (0% at bottom edge, 100% at midline)
  // Labels are repeated on all borders so we can place bottom HUD as a mirror of the top.
  function DebugGrid() {
    if (!DEBUG_GRID || !debugCover) return null;

    const w = debugCover.arenaW;
    const h = debugCover.arenaH;
    const halfH = h / 2;

    // density: 5% steps across X, 10% steps within each half on Y (keeps readable)
    const stepsX = 20; // 0..100% every 5%
    const stepsYHalf = 10; // 0..100% every 10% within each half
    const majorEveryX = 2; // label every 10%
    const majorEveryY = 1; // label every 10% within half

    const mono =
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";

    const nodes: React.ReactNode[] = [];

    // vertical lines (full height)
    for (let i = 0; i <= stepsX; i++) {
      const t = i / stepsX;
      const x = t * w;
      const isMajor = i % majorEveryX === 0;
      nodes.push(
        <line
          key={`vx-${i}`}
          x1={x}
          y1={0}
          x2={x}
          y2={h}
          stroke="white"
          strokeOpacity={isMajor ? 0.38 : 0.16}
          strokeWidth={isMajor ? 2 : 1}
        />,
      );

      if (isMajor) {
        const label = `${Math.round(t * 100)}%`;
        // top border
        nodes.push(
          <text
            key={`tx-top-${i}`}
            x={x + 4}
            y={12}
            fill="white"
            opacity={0.75}
            fontSize={10}
            fontFamily={mono}
          >
            {label}
          </text>,
        );
        // bottom border
        nodes.push(
          <text
            key={`tx-bot-${i}`}
            x={x + 4}
            y={h - 4}
            fill="white"
            opacity={0.75}
            fontSize={10}
            fontFamily={mono}
          >
            {label}
          </text>,
        );
      }
    }

    // horizontal lines: top half (A)
    for (let i = 0; i <= stepsYHalf; i++) {
      const t = i / stepsYHalf; // 0..1 in HALF
      const y = t * halfH;
      const isMajor = i % majorEveryY === 0;
      const label = `${Math.round(t * 100)}%`;

      nodes.push(
        <line
          key={`hy-a-${i}`}
          x1={0}
          y1={y}
          x2={w}
          y2={y}
          stroke="white"
          strokeOpacity={isMajor ? 0.38 : 0.16}
          strokeWidth={isMajor ? 2 : 1}
        />,
      );

      if (isMajor) {
        const px = Math.round(y);
        // left border
        nodes.push(
          <text
            key={`ty-a-l-${i}`}
            x={4}
            y={Math.max(10, y - 4)}
            fill="white"
            opacity={0.75}
            fontSize={10}
            fontFamily={mono}
          >
            A {label} y:{px}
          </text>,
        );
        // right border
        nodes.push(
          <text
            key={`ty-a-r-${i}`}
            x={w - 118}
            y={Math.max(10, y - 4)}
            fill="white"
            opacity={0.75}
            fontSize={10}
            fontFamily={mono}
          >
            A {label} y:{px}
          </text>,
        );
      }
    }

    // horizontal lines: bottom half (B) - mirrored labels (0% at bottom edge, 100% at midline)
    for (let i = 0; i <= stepsYHalf; i++) {
      const t = i / stepsYHalf; // 0..1 in HALF
      const y = h - t * halfH;
      const isMajor = i % majorEveryY === 0;
      const label = `${Math.round(t * 100)}%`;

      nodes.push(
        <line
          key={`hy-b-${i}`}
          x1={0}
          y1={y}
          x2={w}
          y2={y}
          stroke="white"
          strokeOpacity={isMajor ? 0.38 : 0.16}
          strokeWidth={isMajor ? 2 : 1}
        />,
      );

      if (isMajor) {
        const px = Math.round(y);
        nodes.push(
          <text
            key={`ty-b-l-${i}`}
            x={4}
            y={Math.min(h - 4, y - 4)}
            fill="white"
            opacity={0.75}
            fontSize={10}
            fontFamily={mono}
          >
            B {label} y:{px}
          </text>,
        );
        nodes.push(
          <text
            key={`ty-b-r-${i}`}
            x={w - 118}
            y={Math.min(h - 4, y - 4)}
            fill="white"
            opacity={0.75}
            fontSize={10}
            fontFamily={mono}
          >
            B {label} y:{px}
          </text>,
        );
      }
    }

    // Midline highlight
    nodes.push(
      <line
        key="midline"
        x1={0}
        y1={halfH}
        x2={w}
        y2={halfH}
        stroke="rgba(255,255,255,0.9)"
        strokeWidth={3}
        strokeOpacity={0.35}
      />,
    );

    return (
<svg
        className="dbg-grid"
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
      >
        {nodes}
      </svg>
    );
  }

  useEffect(() => {
    const onResize = () => setLayoutTick((x) => x + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const el = arenaRef.current;
    if (!el) return;
    const id = window.requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      const w = Math.max(1, Math.floor(r.width));
      const h = Math.max(1, Math.floor(r.height));
      setArenaBox({ w, h });
    });
    return () => window.cancelAnimationFrame(id);
  }, [layoutTick]);

  // ✅ FIX: laneRects hook MUST be above any early returns (hooks order)
  const laneRects = useMemo(() => {
    if (!arenaBox) return null;

    const enemy = coverMapRect(
      0.08,
      0.14, // ⬇ верхнюю ЧУТЬ ниже
      0.92,
      0.28,
      arenaBox.w,
      arenaBox.h,
      BOARD_IMG_W,
      BOARD_IMG_H
    );
    
    const you = coverMapRect(
      0.08,
      0.38, // ⬆⬆⬆ нижнюю СИЛЬНО выше
      0.92,
      0.52,
      arenaBox.w,
      arenaBox.h,
      BOARD_IMG_W,
      BOARD_IMG_H
    );    

    return { enemy, you };
  }, [arenaBox]);

  function seek(nextT: number) {
    const clamped = Math.max(0, Math.min(durationSec, Number(nextT) || 0));
    setT(clamped);
    startAtRef.current = null;
  }

  useEffect(() => {
    if (!matchId) {
      setErrText("matchId required");
      return;
    }

    let alive = true;
    (async () => {
      try {
        const qs = new URLSearchParams();
        qs.set("matchId", matchId);
        qs.set("id", matchId);

        const res = await fetch(`/api/pvp/match?${qs.toString()}`);
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

  useEffect(() => {
    if (!match?.p1_user_id || !match?.p2_user_id) return;

    let alive = true;
    (async () => {
      try {
        const ids = [match.p1_user_id, match.p2_user_id].filter(Boolean);
        const qs = new URLSearchParams();
        qs.set("ids", ids.join(","));
        const res = await fetch(`/api/pvp/users?${qs.toString()}`);
        const data = await res.json();
        if (!alive) return;

        if (!res.ok) return;

        const arr: PlayerProfile[] = Array.isArray(data?.users) ? data.users : Array.isArray(data) ? data : [];
        const map: Record<string, PlayerProfile> = {};
        for (const u of arr) {
          if (!u?.id) continue;
          map[String(u.id)] = {
            id: String(u.id),
            username: u.username ?? null,
            first_name: u.first_name ?? null,
            avatar_url: u.avatar_url ?? null,
          };
        }
        setProfiles(map);
      } catch {
        // ignore
      }
    })();

    return () => {
      alive = false;
    };
  }, [match?.p1_user_id, match?.p2_user_id]);

  const youSide: "p1" | "p2" = useMemo(() => {
    if (!match) return "p1";
    if (myUserId && myUserId === match.p2_user_id) return "p2";
    return "p1";
  }, [match, myUserId]);

  const enemySide: "p1" | "p2" = youSide === "p1" ? "p2" : "p1";

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

    const units = new Map<string, UnitView>();
    const slotMapP1: Record<number, UnitView | null> = { 0: null, 1: null, 2: null, 3: null, 4: null };
    const slotMapP2: Record<number, UnitView | null> = { 0: null, 1: null, 2: null, 3: null, 4: null };
    let active: string | null = null;

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

        units.clear();
        slotMapP1[0] = slotMapP1[1] = slotMapP1[2] = slotMapP1[3] = slotMapP1[4] = null;
        slotMapP2[0] = slotMapP2[1] = slotMapP2[2] = slotMapP2[3] = slotMapP2[4] = null;
        active = null;
      } else if (e.type === "reveal") {
        rr = (e as any).round ?? rr;
        c1 = toStringArray((e as any).p1_cards ?? c1);
        c2 = toStringArray((e as any).p2_cards ?? c2);

        const a1 = toCardMetaArray((e as any).p1_cards_full);
        const a2 = toCardMetaArray((e as any).p2_cards_full);
        if (a1.length) cf1 = a1;
        if (a2.length) cf2 = a2;
      } else if (e.type === "spawn") {
        if ((e as any).round != null) rr = (e as any).round ?? rr;

        const ref = readUnitRefFromEvent(e, "unit");
        const card_id = String((e as any).card_id ?? "");
        const hp = Number((e as any).hp ?? 1);
        const maxHp = Number((e as any).maxHp ?? hp);
        const shield = Number((e as any).shield ?? 0);

        if (ref?.instanceId) {
          const u: UnitView = {
            instanceId: ref.instanceId,
            side: ref.side,
            slot: ref.slot,
            card_id,
            hp: Math.max(0, hp),
            maxHp: Math.max(1, maxHp),
            shield: Math.max(0, shield),
            alive: true,
            tags: new Set(),
          };
          units.set(ref.instanceId, u);
          if (ref.side === "p1") slotMapP1[ref.slot] = u;
          else slotMapP2[ref.slot] = u;
        }
      } else if (e.type === "turn_start") {
        const ref = readUnitRefFromEvent(e, "unit");
        if (ref?.instanceId) active = ref.instanceId;
      } else if (e.type === "damage") {
        const tid = String((e as any)?.target?.instanceId ?? "");
        const amount = Number((e as any)?.amount ?? 0);
        const hp = (e as any)?.hp;
        const shield = (e as any)?.shield;
        if (tid) {
          const u = units.get(tid);
          if (u) {
            if (Number.isFinite(hp)) u.hp = Math.max(0, Number(hp));
            else u.hp = Math.max(0, u.hp - Math.max(0, Math.floor(amount)));
            if (Number.isFinite(shield)) u.shield = Math.max(0, Number(shield));
            if (u.hp <= 0) u.alive = false;
          }
        }
      } else if (e.type === "heal") {
        const tid = String((e as any)?.target?.instanceId ?? "");
        const amount = Number((e as any)?.amount ?? 0);
        const hp = (e as any)?.hp;
        if (tid) {
          const u = units.get(tid);
          if (u) {
            if (Number.isFinite(hp)) u.hp = clamp(Number(hp), 0, u.maxHp);
            else u.hp = clamp(u.hp + Math.max(0, Math.floor(amount)), 0, u.maxHp);
          }
        }
      } else if (e.type === "shield" || e.type === "shield_hit") {
        const tid = String((e as any)?.target?.instanceId ?? "");
        const shield = (e as any)?.shield;
        const amount = Number((e as any)?.amount ?? 0);
        if (tid) {
          const u = units.get(tid);
          if (u) {
            if (Number.isFinite(shield)) u.shield = Math.max(0, Number(shield));
            else
              u.shield = Math.max(
                0,
                u.shield + Math.max(0, Math.floor(amount)) * (e.type === "shield_hit" ? -1 : 1)
              );
          }
        }
      } else if (e.type === "debuff_applied") {
        const tid = String((e as any)?.target?.instanceId ?? "");
        const debuff = String((e as any)?.debuff ?? "");
        if (tid && debuff) {
          const u = units.get(tid);
          if (u) u.tags.add(debuff);
        }
      } else if (e.type === "buff_applied") {
        const ref = readUnitRefFromEvent(e, "target") || readUnitRefFromEvent(e, "unit");
        const buff = String((e as any)?.buff ?? "");
        if (ref?.instanceId && buff) {
          const u = units.get(ref.instanceId);
          if (u) u.tags.add(buff);
        }
      } else if (e.type === "debuff_tick") {
        const ref = readUnitRefFromEvent(e, "target") || readUnitRefFromEvent(e, "unit");
        const debuff = String((e as any)?.debuff ?? "");
        if (ref?.instanceId && debuff) {
          const u = units.get(ref.instanceId);
          if (u) u.tags.add(debuff);
        }
      } else if (e.type === "death") {
        const ref = readUnitRefFromEvent(e, "unit");
        if (ref?.instanceId) {
          const u = units.get(ref.instanceId);
          if (!u) break;
          u.alive = false;
          u.hp = 0;
          u.dyingAt = e.t ?? Date.now();
          // ⚠️ removal happens AFTER animation
          continue;
        }
      } else if (e.type === "score") {
        rr = (e as any).round ?? rr;
        s1 = Number((e as any).p1 ?? 0);
        s2 = Number((e as any).p2 ?? 0);
      } else if (e.type === "round_end") {
        rr = (e as any).round ?? rr;
        rw = (e as any).winner ?? null;
      }
    }

    const sigLeft = (cf1?.map((x) => x?.id).join("|") || c1.join("|")) ?? "";
    const sigRight = (cf2?.map((x) => x?.id).join("|") || c2.join("|")) ?? "";
    const revealSig = [rr, `${sigLeft}::${sigRight}`].join("::");

    if (revealSig !== prevRevealSigRef.current) {
      const hasSomething =
        (cf1?.length || 0) > 0 || (cf2?.length || 0) > 0 || (c1?.length || 0) > 0 || (c2?.length || 0) > 0;
      if (hasSomething) setRevealTick((x) => x + 1);
      prevRevealSigRef.current = revealSig;
    }

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

    setActiveInstance(active);
    setP1UnitsBySlot(slotMapP1);
    setP2UnitsBySlot(slotMapP2);

    setLayoutTick((x) => x + 1);
  }, [t, timeline]);

  useEffect(() => {
    if (!match) return;

    const step = (now: number) => {
      if (!playing) return;

      if (startAtRef.current == null) {
        startAtRef.current = now - (t / Math.max(0.0001, rate)) * 1000;
      }

      const elapsedWall = (now - startAtRef.current) / 1000;
      const elapsed = elapsedWall * rate;

      const nextT = Math.min(durationSec, Math.max(0, elapsed));
      setT(nextT);

      if (nextT >= durationSec) {
        setPlaying(false);
        return;
      }

      rafRef.current = window.requestAnimationFrame(step);
    };

    if (playing) rafRef.current = window.requestAnimationFrame(step);

    return () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match, playing, durationSec, rate]);

  useEffect(() => {
    startAtRef.current = null;
  }, [playing, rate]);

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

  useEffect(() => {
    if (phase !== "end") return;
    if (!roundWinner) return;

    const sig = `${roundN}:${roundWinner}:${youSide}`;
    if (sig === prevEndSigRef.current) return;
    prevEndSigRef.current = sig;

    let tone: "p1" | "p2" | "draw" = "draw";
    let text = "DRAW";

    if (roundWinner === "draw") {
      tone = "draw";
      text = "DRAW";
    } else if (roundWinner === youSide) {
      tone = "p1";
      text = "YOU WIN ROUND";
    } else {
      tone = "p2";
      text = "ENEMY WIN ROUND";
    }

    setRoundBanner((b) => ({ visible: true, tick: b.tick + 1, text, tone }));

    const to = window.setTimeout(() => setRoundBanner((b) => ({ ...b, visible: false })), 900);
    return () => window.clearTimeout(to);
  }, [phase, roundWinner, roundN, youSide]);

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
        unit: p1UnitsBySlot?.[i] ?? null,
      })),
    [p1CardsFull, p1Cards, p1UnitsBySlot]
  );

  const p2Slots = useMemo(
    () =>
      Array.from({ length: 5 }).map((_, i) => ({
        card: p2CardsFull?.[i] ?? null,
        fallbackId: p2Cards?.[i] ?? null,
        unit: p2UnitsBySlot?.[i] ?? null,
      })),
    [p2CardsFull, p2Cards, p2UnitsBySlot]
  );

  const topSlots = enemySide === "p1" ? p1Slots : p2Slots; 
  const bottomSlots = youSide === "p1" ? p1Slots : p2Slots;

  const topCardsFull = enemySide === "p1" ? p1CardsFull : p2CardsFull;
  const bottomCardsFull = youSide === "p1" ? p1CardsFull : p2CardsFull;

  const topCards = enemySide === "p1" ? p1Cards : p2Cards;
  const bottomCards = youSide === "p1" ? p1Cards : p2Cards;

  const topScore = enemySide === "p1" ? p1Score : p2Score;
  const bottomScore = youSide === "p1" ? p1Score : p2Score;

  const topHit = enemySide === "p1" ? p1Hit : p2Hit;
  const bottomHit = youSide === "p1" ? p1Hit : p2Hit;

  
  // Keep mapping from revealed card fallbackId -> current instanceId for stable FX when the engine clears the unit.
  useEffect(() => {
    const map = lastInstBySlotRef.current;
    for (const s of [...(topSlots || []), ...(bottomSlots || [])]) {
      const fid = s?.fallbackId;
      const inst = s?.unit?.instanceId;
      if (fid && inst) map[fid] = inst;
    }
  }, [topSlots, bottomSlots]);

  const teamHp = (unitsBySlot: Record<number, UnitView | null>) => {
    let hp = 0;
    let hpMax = 0;
    for (const k in unitsBySlot) {
      const u = unitsBySlot[Number(k)];
      if (!u) continue;
      hp += Math.max(0, Number(u.hp ?? 0));
      hpMax += Math.max(0, Number(u.maxHp ?? 0));
    }
    // avoid division by zero
    if (!Number.isFinite(hpMax) || hpMax <= 0) hpMax = 1;
    if (!Number.isFinite(hp) || hp < 0) hp = 0;
    if (hp > hpMax) hp = hpMax;
    return { hp, hpMax };
  };

  const topTeam = useMemo(
    () => teamHp(enemySide === "p1" ? p1UnitsBySlot : p2UnitsBySlot),
    [enemySide, p1UnitsBySlot, p2UnitsBySlot],
  );
  const bottomTeam = useMemo(
    () => teamHp(youSide === "p1" ? p1UnitsBySlot : p2UnitsBySlot),
    [youSide, p1UnitsBySlot, p2UnitsBySlot],
  );
const enemyUserId = enemySide === "p1" ? match?.p1_user_id : match?.p2_user_id;
  const youUserId = youSide === "p1" ? match?.p1_user_id : match?.p2_user_id;

  const enemyProfile = enemyUserId ? profiles[enemyUserId] : undefined;
  const youProfile = youUserId ? profiles[youUserId] : undefined;

  const enemyName = pickDisplayName(enemyProfile, enemyUserId || null);
  const youName = pickDisplayName(youProfile, youUserId || null);

  const enemyAvatar = pickAvatarUrl(enemyProfile, enemyProfile?.username || enemyUserId || "enemy");
  const youAvatar = pickAvatarUrl(youProfile, youProfile?.username || youUserId || "you");

  const boardFxClass = useMemo(() => {
    if (!scored) return "";
    if (roundWinner === "draw") return "fx-draw";
    if (roundWinner === youSide) return "fx-p1";
    if (roundWinner === enemySide) return "fx-p2";
    return "";
  }, [scored, roundWinner, youSide, enemySide]);

  const attackFxByInstance = useMemo(() => {
    const windowSec = 0.35;
    const fromT = Math.max(0, t - windowSec);
    const map: Record<string, AttackFx[]> = {};

    for (const e of timeline) {
      if (e.t < fromT) continue;
      if (e.t > t) break;
      if (e.type === "attack") {
        const fromId = String((e as any)?.from?.instanceId ?? "");
        const toId = String((e as any)?.to?.instanceId ?? "");
        if (!fromId || !toId) continue;
        (map[fromId] ||= []).push({ t: e.t, fromId, toId });
        (map[toId] ||= []).push({ t: e.t, fromId, toId });
      }
    }
    return map;
  }, [timeline, t]);

  const recentAttacks = useMemo(() => {
    const windowSec = 0.22;
    const fromT = Math.max(0, t - windowSec);
    const arr: AttackFx[] = [];
    for (const e of timeline) {
      if (e.t < fromT) continue;
      if (e.t > t) break;
      if (e.type === "attack") {
        const fromId = String((e as any)?.from?.instanceId ?? "");
        const toId = String((e as any)?.to?.instanceId ?? "");
        if (!fromId || !toId) continue;
        arr.push({ t: e.t, fromId, toId });
      }
    }
    return arr.slice(-2);
  }, [timeline, t]);

  const spawnFxByInstance = useMemo(() => {
    const windowSec = 0.35;
    const fromT = Math.max(0, t - windowSec);
    const map: Record<string, SpawnFx[]> = {};

    for (const e of timeline) {
      if (e.t < fromT) continue;
      if (e.t > t) break;
      if (e.type === "spawn") {
        const ref = readUnitRefFromEvent(e, "unit");
        if (!ref?.instanceId) continue;
        (map[ref.instanceId] ||= []).push({ t: e.t });
      }
    }
    return map;
  }, [timeline, t]);

  const damageFxByInstance = useMemo(() => {
    const windowSec = 0.45;
    const fromT = Math.max(0, t - windowSec);
    const map: Record<string, DamageFx[]> = {};

    for (const e of timeline) {
      if (e.t < fromT) continue;
      if (e.t > t) break;
      if (e.type === "damage") {
        const tid = String((e as any)?.target?.instanceId ?? "");
        const amount = Number((e as any)?.amount ?? 0);
        const blocked = Boolean((e as any)?.blocked ?? false);
        if (!tid) continue;
        (map[tid] ||= []).push({ t: e.t, amount, blocked });
      }
    }
    return map;
  }, [timeline, t]);

  const deathFxByInstance = useMemo(() => {
    const windowSec = 0.65;
    const fromT = Math.max(0, t - windowSec);
    const set = new Set<string>();
    for (const e of timeline) {
      if (e.t < fromT) continue;
      if (e.t > t) break;
      if (e.type === "death") {
        const ref = readUnitRefFromEvent(e, "unit");
        if (ref?.instanceId) set.add(ref.instanceId);
      }
    }
    return set;
  }, [timeline, t]);

  function getCenterInArena(instanceId: string) {
    const arenaEl = arenaRef.current;
    const el = unitElByIdRef.current[instanceId];
    if (!arenaEl || !el) return null;

    const aRect = arenaEl.getBoundingClientRect();
    const r = el.getBoundingClientRect();

    return {
      x: r.left + r.width / 2 - aRect.left,
      y: r.top + r.height / 2 - aRect.top,
    };
  }

  const attackCurves = useMemo(() => {
    const arenaEl = arenaRef.current;
    if (!arenaEl) return [];

    const curves: Array<{ key: string; d: string; fromId: string; toId: string }> = [];

    for (const atk of recentAttacks) {
      const p1 = getCenterInArena(atk.fromId);
      const p2 = getCenterInArena(atk.toId);
      if (!p1 || !p2) continue;

      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.max(1, Math.hypot(dx, dy));
      const nx = -dy / len;
      const ny = dx / len;

      const bend = clamp(len * 0.1, 14, 46);
      const cx = mx + nx * bend;
      const cy = my + ny * bend;

      const d = `M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`;
      curves.push({ key: `${atk.t}:${atk.fromId}:${atk.toId}`, d, fromId: atk.fromId, toId: atk.toId });
    }

    return curves;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentAttacks, layoutTick]);

  function TagPill({ label }: { label: string }) {
    return <span className="bb-tag">{label}</span>;
  }

  function MapPortrait({
    where,
    name,
    avatar,
    tone,
    hp,
    hpMax,
    score,
    isHit,
  }: {
    where: "top" | "bottom";
    name: string;
    avatar: string;
    tone: "enemy" | "you";
    hp: number;
    hpMax: number;
    score: number | null;
    isHit: boolean;
  }) {
    const isBottom = where === "bottom";

    // ✅ Bottom HUD targets from your debug A/B grid (arena pixel coords)
    // Top player must stay untouched.
    const BOTTOM_AVATAR_Y = 765; // avatar ring center (moved up)
    const BOTTOM_HP_Y = 644; // TeamHP bar row
    const BOTTOM_NAME_Y = 678; // nickname

    const pos = useMemo(() => {
      if (!arenaBox) return null;
    
      const p =
        where === "top"
          ? coverMapPoint(TOP_RING_NX, TOP_RING_NY, arenaBox.w, arenaBox.h, BOARD_IMG_W, BOARD_IMG_H)
          : coverMapPoint(BOT_RING_NX, BOT_RING_NY, arenaBox.w, arenaBox.h, BOARD_IMG_W, BOARD_IMG_H);
    
      // ✅ responsive portrait size based on arena width
      const base = Math.min(arenaBox.w, arenaBox.h);
      const ring = clamp(Math.round(base * 0.083), 84, 148);
      const img  = Math.round(ring * 0.86);     
    
      // ✅ extra offset to avoid Telegram top/bottom overlays (responsive)
      const yOffset =
      where === "top"
        ? Math.round(arenaBox.h * 0.008) // ⬇️ TOP tiny down
        : -Math.round(arenaBox.h * 0.036); // ⬆️ НИЖНЮЮ ЧУТЬ-ЧУТЬ           
    
      const top = clamp(p.y + yOffset, ring / 2 + 8, arenaBox.h - ring / 2 - 8);
    
      return { left: p.x, top, ring, img };
    }, [arenaBox, where]);  

    // ✅ IMPORTANT: top HUD stays as-is. Bottom HUD is placed by hard Y targets.
    if (isBottom) {
      if (!pos) return null;

      const vars = {
        ["--ringSize" as any]: `${pos.ring}px`,
        ["--imgSize" as any]: `${pos.img}px`,
      } as React.CSSProperties;

      return (
        <>
          {/* Bottom Avatar Ring (ONLY moved by Y target) */}
          <div
            className={["map-portrait", tone === "enemy" ? "tone-enemy" : "tone-you", "is-bottom"].join(" ")}
            style={{ left: pos.left, top: BOTTOM_AVATAR_Y, transform: "translate(-50%,-50%)", ...vars }}
          >
            <div className="map-portrait-ring">
              <div className="map-portrait-img">
                <img src={avatar} alt={tone} />
              </div>
            </div>
          </div>

          {/* Bottom Name */}
          <div
            className="map-portrait-name"
            style={{ position: "absolute", left: pos.left, top: BOTTOM_NAME_Y, transform: "translate(-50%,-50%)", zIndex: 6, pointerEvents: "none" }}
          >
            {name}
          </div>

          {/* Bottom TeamHP + Score Row */}
          <div
            className="map-pillrow"
            style={{ position: "absolute", left: pos.left, top: BOTTOM_HP_Y, transform: "translate(-50%,-50%)", zIndex: 6, pointerEvents: "none" }}
          >
            <div
              className="map-xp"
              style={{ ["--xp" as any]: `${clamp((hp / Math.max(1, hpMax)) * 100, 0, 100)}%`, ["--xpHue" as any]: `${Math.round(120 * clamp(hp / Math.max(1, hpMax), 0, 1))}` } as React.CSSProperties}
            >
              <div className="map-xp-fill" />
              <div className="map-xp-knob" />
            </div>

            <div className={["map-pill map-pill--score", isHit ? "is-hit" : ""].join(" ")}>
              {score == null ? "—" : score}
            </div>
          </div>
        </>
      );
    }

    return (
      <div
        className={["map-portrait", tone === "enemy" ? "tone-enemy" : "tone-you"].join(" ")}
        style={
          pos
            ? ({
                left: pos.left,
                top: pos.top,
                transform: "translate(-50%,-50%)",
                ["--ringSize" as any]: `${pos.ring}px`,
                ["--imgSize" as any]: `${pos.img}px`,
              } as React.CSSProperties)
            : undefined
        }
      >
        {/* Top player stays exactly as-is. */}
        <>
          <div className="map-portrait-ring" style={{ transform: "translateY(6px)" }}>
            <div className="map-portrait-img">
              <img src={avatar} alt={tone} />
            </div>
          </div>

          <div className="map-portrait-name" style={{ marginTop: 20, transform: "translateY(6px)" }}>{name}</div>

          <div className="map-pillrow" style={{ marginTop: 16 }}>
            <div
              className="map-xp"
              style={{ ["--xp" as any]: `${clamp((hp / 30) * 100, 0, 100)}%`, ["--xpHue" as any]: `${Math.round(120 * clamp(hp / 30, 0, 1))}` } as React.CSSProperties}
            >
              <div className="map-xp-fill" />
              <div className="map-xp-knob" />
            </div>

            <div className={["map-pill map-pill--score", isHit ? "is-hit" : ""].join(" ")}>
              {score == null ? "—" : score}
            </div>
          </div>
        </>
      </div>
    );
  }

  function CardSlot({
  card,
  unit,
  fallbackId,
  unitInstanceId,
  attackFx,
  spawnFx,
  damageFx,
  isDying,
  revealed,
  delayMs,
}: {
  card?: CardMeta | null;
  unit?: UnitView | null;
  fallbackId?: string | null;
  unitInstanceId?: string | null;
  attackFx?: AttackFx[];
  spawnFx?: SpawnFx[];
  damageFx?: DamageFx[];
  isDying?: boolean;
  revealed: boolean;
  delayMs: number;
}) {
    const id = card?.id || fallbackId || "";

    const title = (card?.name && String(card.name).trim()) || safeSliceId(id);
    const r = (card?.rarity || "common") as string;
    const power = typeof card?.base_power === "number" ? card.base_power : null;
    const img = resolveCardArtUrl(card?.image_url || null);

    // Vanish + remove after death (UI-only; FX is handled by FxLayer)
    // IMPORTANT: battle state may remove `unit` immediately on death, so we keep a ghost snapshot
    // long enough to play the vanish animation, then we remove the card from DOM.
    const [ghostUnit, setGhostUnit] = useState<UnitView | null>(null);
    const activeUnit = unit ?? ghostUnit;
    const renderUnit = activeUnit;

    const [isVanish, setIsVanish] = useState(false);
    const [isHidden, setIsHidden] = useState(false);
    const [deathStarted, setDeathStarted] = useState(false);

    const lastUnitRef = useRef<UnitView | null>(null);
    const vanishStartedForRef = useRef<string | null>(null);
    const vanishTimersRef = useRef<number[]>([]);
    const deathStartedRef = useRef(false);
    const prevInstRef = useRef<string | null>(null);

    const isDead = !!activeUnit && (!activeUnit.alive || activeUnit.hp <= 0);
    const instId: string | null = unitInstanceId ?? activeUnit?.instanceId ?? null;

    // Cleanup timers on unmount
    useEffect(() => {
      return () => {
        vanishTimersRef.current.forEach((t) => window.clearTimeout(t));
        vanishTimersRef.current = [];
      };
    }, []);

    // Keep latest live unit snapshot so we can render death/vanish even if engine removes the unit immediately.
    useEffect(() => {
      if (isHidden) return;
      if (!unit) return;
      setGhostUnit(unit);
      lastUnitRef.current = unit;
    }, [unit, isHidden]);

    // Reset local FX state when the slot instance changes (new spawn / empty slot).
    useEffect(() => {
      if (prevInstRef.current === instId) return;
      prevInstRef.current = instId;

      deathStartedRef.current = false;
      setDeathStarted(false);
      setIsVanish(false);
      setIsHidden(false);
      vanishStartedForRef.current = null;

      // clear any pending timers from previous unit
      vanishTimersRef.current.forEach((t) => window.clearTimeout(t));
      vanishTimersRef.current = [];

      if (!instId) {
        setGhostUnit(null);
        lastUnitRef.current = null;
      } else if (unit) {
        setGhostUnit(unit);
        lastUnitRef.current = unit;
      }
    }, [instId, unit]);

    // Start vanish AFTER the death atlas animation, then remove the card from the slot.
    useEffect(() => {
      if (!instId) return;
      if (!(isDying || isDead)) return;
      if (deathStartedRef.current) return;

      deathStartedRef.current = true;
      setDeathStarted(true);

      // 0..520ms: death atlas plays (flip + burst)
      // 520..860ms: vanish animation
      vanishTimersRef.current.push(
        window.setTimeout(() => setIsVanish(true), 520),
      );
      vanishTimersRef.current.push(
        window.setTimeout(() => {
          setIsHidden(true);
          setGhostUnit(null);
        }, 860),
      );
    }, [instId, isDying, isDead]);

const hpPct = useMemo(() => {
      if (!activeUnit) return 100;
      const maxHp = Math.max(1, activeUnit.maxHp);
      return clamp((activeUnit.hp / maxHp) * 100, 0, 100);
    }, [activeUnit?.instanceId, activeUnit?.hp, activeUnit?.maxHp]);

    const shieldPct = useMemo(() => {
      if (!activeUnit) return 0;
      const maxHp = Math.max(1, activeUnit.maxHp);
      return clamp((activeUnit.shield / maxHp) * 100, 0, 100);
    }, [activeUnit?.instanceId, activeUnit?.shield, activeUnit?.maxHp]);

    const atk = useMemo(() => {
      if (!renderUnit || !attackFx || attackFx.length === 0) return null;
      const last = attackFx[attackFx.length - 1];
      const isFrom = last.fromId === renderUnit.instanceId;
      const isTo = last.toId === renderUnit.instanceId;
      if (!isFrom && !isTo) return null;
      return { ...last, isFrom, isTo };
    }, [renderUnit?.instanceId, attackFx]);

    const spawned = useMemo(() => {
      if (!renderUnit || !spawnFx || spawnFx.length === 0) return null;
      return spawnFx[spawnFx.length - 1];
    }, [renderUnit?.instanceId, spawnFx]);

    const dmg = useMemo(() => {
      if (!renderUnit || !damageFx || damageFx.length === 0) return null;
      return damageFx[damageFx.length - 1];
    }, [renderUnit?.instanceId, damageFx]);

    const tags = useMemo(() => {
      if (!activeUnit) return [];
      const arr = Array.from(activeUnit.tags || []);
      return arr.slice(0, 3);
    }, [activeUnit?.instanceId]);

    const isActive = !!activeUnit && activeInstance ? activeUnit.instanceId === activeInstance : false;
    const isDyingUi = !!renderUnit && (deathStarted || isDying || isDead);
    if (isHidden) return null;
    if (!renderUnit) return null;
    return (
      <div className={["bb-slot", isDyingUi ? "is-dying" : "", isVanish ? "is-vanish" : ""].join(" ")}>
      <div className="bb-fx-anchor">
        
        {isDyingUi ? <div className="bb-death" /> : null}
      </div>
      <div
        ref={(el) => {
          if (el && renderUnit?.instanceId) unitElByIdRef.current[renderUnit.instanceId] = el;
        }}
        className={[
          "bb-card",
          revealed ? "is-revealed" : "",
          `rt-${revealTick}`,
          renderUnit ? "has-unit" : "",
          isDead ? "is-dead" : "",
          isActive ? "is-active" : "",
          spawned ? "is-spawn" : "",
          dmg ? "is-damage" : "",
          isDying ? "is-dying" : "",
        ].join(" ")}
        style={{ animationDelay: `${delayMs}ms` }}
      >
        <div className="bb-card-inner">
          <div className="bb-face bb-back">
            <div className="bb-mark">696</div>
          </div>

          <div className={["bb-face bb-front", rarityFxClass(r)].join(" ")}>
            <CardArt
              variant="pvp"
              src={img}
              frameSrc={CARD_FRAME_SRC}
              showStats={false}
              atk={power ?? 0}
              hp={unit?.hp ?? 0}
              shield={unit?.shield ?? 0}
              showCorner={false}
            />
            {renderUnit && (
              <div className="bb-fx">
                {spawned && <div key={`spawn-${spawned.t}-${renderUnit.instanceId}`} className="bb-spawn" />}

                {atk && (
                  <div className="bb-atkfx">
                    {atk.isFrom && <div key={`slash-${atk.t}-${renderUnit.instanceId}`} className="bb-slash" />}
                    {atk.isTo && <div key={`impact-${atk.t}-${renderUnit.instanceId}`} className="bb-impact" />}
                  </div>
                )}

                {renderUnit && dmg && (
                  <>
                    <div key={`dmgflash-${dmg.t}-${renderUnit.instanceId}`} className="bb-dmgflash" />
                    <div key={`dmgfloat-${dmg.t}-${renderUnit.instanceId}`} className="bb-dmgfloat">
                      {dmg.blocked ? "BLOCK" : `-${Math.max(0, Math.floor(dmg.amount))}`}
                    </div>
                  </>
                )}

                {isDying && <div className="bb-death" />}
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

              {renderUnit && (
                <div className="bb-bars">
                  <div className="bb-bar bb-bar--hp">
                    <div style={{ width: `${hpPct}%` }} />
                  </div>
                  {renderUnit.shield > 0 && (
                    <div className="bb-bar bb-bar--shield">
                      <div style={{ width: `${shieldPct}%` }} />
                    </div>
                  )}
                  <div className="bb-hptext">
                    <span className="tabular-nums">{renderUnit.hp}</span> / <span className="tabular-nums">{renderUnit.maxHp}</span>
                    {renderUnit.shield > 0 ? (
                      <span className="bb-shieldnum">
                        {" "}
                        +<span className="tabular-nums">{renderUnit.shield}</span>
                      </span>
                    ) : null}
                  </div>

                  {tags.length > 0 && (
                    <div className="bb-tags">
                      {tags.map((x) => (
                        <TagPill key={x} label={String(x).toUpperCase()} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            </div>
        </div>
      </div>
      {renderUnit && (
        <div className="bb-hud" aria-hidden="true">
          <span className="bb-hud-item">
            <span className="bb-hud-icon" role="img" aria-label="Attack">⚔</span>
            <span className="bb-hud-num">{power ?? 0}</span>
          </span>
          <span className="bb-hud-sep" />
          <span className="bb-hud-item">
            <span className="bb-hud-icon hp" role="img" aria-label="HP">❤</span>
            <span className="bb-hud-num">{unit?.hp ?? 0}</span>
          </span>
        </div>
      )}

      <style jsx>{`
        .bb-hud {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: rgba(11, 18, 26, 0.92);
          border-radius: 8px;
          border: 1.6px solid rgba(51,241,255,0.38);
          box-shadow:
            0 0 1.5px #36ffe4be,
            0 0 7px 0 #30e6ff40,
            0 0 0.8px 0 #00dbff75;
          padding: 1px 5px;
          gap: 3px;
          min-height: 12px;
          max-width: calc(100% - 6px);
          width: max-content;
          box-sizing: border-box;
          overflow: hidden;
          white-space: nowrap;
        }

        .bb-hud-item {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 1px;
          min-width: 0;
        }

        .bb-hud-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 10px;
          height: 10px;
          font-size: 9px;
          line-height: 1;
          flex: 0 0 auto;
        }

        .bb-hud-num {
          font-size: 9px;
          line-height: 1;
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.1px;
          flex: 0 1 auto;
          min-width: 0;
        }

        .bb-hud-sep {
          display: inline-block;
          width: 4px;
          height: 4px;
          background: radial-gradient(circle, #33ffe7cc 73%, transparent 100%);
          border-radius: 50%;
          opacity: 0.5;
          flex: 0 0 auto;
        }

        @media (max-width: 500px) {
          .bb-hud {
            min-height: 11px;
            padding: 1px 4px;
            border-radius: 7px;
            gap: 2px;
          }
          .bb-hud-icon {
            width: 8px;
            height: 8px;
            font-size: 7px;
          }
          .bb-hud-num {
            font-size: 7px;
          }
          .bb-hud-sep {
            width: 2px;
            height: 2px;
          }
        }
      `}</style>
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
          <button onClick={() => refreshSession?.()} className="mt-5 ui-btn ui-btn-primary w-full" type="button">
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
          <button onClick={() => router.back()} className="mt-5 ui-btn ui-btn-ghost w-full" type="button">
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
      <style
        dangerouslySetInnerHTML={{
          __html: `
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
        @keyframes bannerIn {
          0% { transform: translateY(10px) scale(0.98); opacity: 0; }
          60% { transform: translateY(0) scale(1.02); opacity: 1; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes bannerGlow {
          0% { opacity: 0.0; transform: scale(0.96); }
          40% { opacity: 0.65; transform: scale(1.05); }
          100% { opacity: 0.0; transform: scale(1.18); }
        }
        @keyframes activePulse {
          0% { transform: translateZ(0) scale(1); }
          50% { transform: translateZ(0) scale(1.02); }
          100% { transform: translateZ(0) scale(1); }
        }
        @keyframes slashSwipe {
          0%   { opacity: 0; transform: translate3d(-18px, 10px, 0) rotate(-18deg) scaleX(0.6); }
          20%  { opacity: 1; transform: translate3d(0px, 0px, 0) rotate(-18deg) scaleX(1.05); }
          100% { opacity: 0; transform: translate3d(16px, -10px, 0) rotate(-18deg) scaleX(1.15); }
        }
        @keyframes impactRing {
          0%   { opacity: 0; transform: translate3d(0,0,0) scale(0.6); }
          25%  { opacity: 1; transform: translate3d(0,0,0) scale(1.05); }
          100% { opacity: 0; transform: translate3d(0,0,0) scale(1.35); }
        }
        @keyframes spawnPop {
          0%   { opacity: 0; transform: scale(0.92); }
          60%  { opacity: 1; transform: scale(1.04); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes dmgFlash {
          0%   { opacity: 0; }
          20%  { opacity: 0.35; }
          100% { opacity: 0; }
        }
        @keyframes dmgFloat {
          0%   { opacity: 0; transform: translate3d(-50%, -30%, 0) scale(0.96); }
          20%  { opacity: 1; transform: translate3d(-50%, -46%, 0) scale(1.02); }
          100% { opacity: 0; transform: translate3d(-50%, -70%, 0) scale(1.06); }
        }
        @keyframes deathFade {
          0%   { opacity: 0; }
          30%  { opacity: 0.45; }
          100% { opacity: 0; }
        }
        @keyframes atkPath {
          0%   { opacity: 0; stroke-dashoffset: 140; }
          18%  { opacity: 1; }
          100% { opacity: 0; stroke-dashoffset: 0; }
        }

        .battle-progress {
          height: 10px;
          border-radius: 999px;
          overflow: hidden;
          border: 1px solid var(--border);
          background: rgba(255, 255, 255, 0.04);
          cursor: pointer;
        }
        .battle-progress > div {
          height: 100%;
          background: rgba(255, 255, 255, 0.18);
          box-shadow: 0 0 16px rgba(255, 255, 255, 0.18);
        }

        .scrub-row {
          margin-top: 10px;
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
        }
        .scrub-row .rate-pill {
          padding: 7px 10px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.18);
          background: rgba(0,0,0,0.18);
          font-size: 11px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          opacity: 0.9;
          cursor: pointer;
        }
        .scrub-row .rate-pill.is-on {
          background: rgba(255,255,255,0.12);
          border-color: rgba(255,255,255,0.26);
        }
        .scrub-row input[type="range"] {
          flex: 1 1 260px;
          accent-color: rgba(255, 255, 255, 0.7);
        }

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
          gap: 4px;
          flex-wrap: wrap;
          align-items: center;
        }

        .hud-pill {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 8px 10px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.18);
          background: rgba(0,0,0,0.18);
          font-size: 11px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          opacity: 0.9;
        }

        .hud-actions { display: flex; gap: 4px; align-items: center; }

        /* ✅ IMPORTANT: no padding here, because background covers the full box */
        .arena {
          position: relative;
          padding: 0;
          overflow: hidden;
          background: rgba(0,0,0,0.22);
          min-height: 720px;
        }
        .arena::before {
          content: "";
          position: absolute;
          inset: 0;
          background-image: url("/arena/board.png");
          background-size: cover;
          background-position: center;
          background-repeat: no-repeat;
          filter: saturate(1.02) contrast(1.04);
          opacity: 1;
          /* 🚫 no transform scale here, otherwise coverMap won't match */
        }
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

        .arena > .lane,
        .arena > .atk-overlay {
          position: relative;
          z-index: 1;
        }

        .arena.fx-p1,
        .arena.fx-p2,
        .arena.fx-draw { animation: microShake 240ms ease-out 1; }

        .atk-overlay {
          position: absolute;
          inset: 0;
          z-index: 4;
          pointer-events: none;
        }
        .atk-path-glow {
          stroke: rgba(255,255,255,0.28);
          stroke-width: 8;
          stroke-linecap: round;
          fill: none;
          stroke-dasharray: 140;
          filter: drop-shadow(0 12px 24px rgba(0,0,0,0.35)) drop-shadow(0 0 14px rgba(255,255,255,0.18));
          animation: atkPath 220ms ease-out both;
          mix-blend-mode: screen;
        }
        .atk-path-core {
          stroke: rgba(255,255,255,0.85);
          stroke-width: 3.25;
          stroke-linecap: round;
          fill: none;
          stroke-dasharray: 140;
          filter: drop-shadow(0 10px 18px rgba(0,0,0,0.35)) drop-shadow(0 0 10px rgba(255,255,255,0.14));
          animation: atkPath 220ms ease-out both;
          mix-blend-mode: screen;
          marker-end: url(#atkArrow);
        }

        .map-portrait {
          position: absolute;
          pointer-events: none;
          display: grid;
          justify-items: center;
          gap: 4px;
          filter: drop-shadow(0 18px 26px rgba(0,0,0,0.35));
        }
        .arena .map-portrait { z-index: 6; }
.map-portrait-ring {
  width: var(--ringSize);
  height: var(--ringSize);
  border-radius: 999px;
  background: transparent;
  display: grid;
  place-items: center;
}

.map-portrait-img {
  width: var(--imgSize);
  height: var(--imgSize);
  border-radius: 999px;
  overflow: hidden;
  background: rgba(255,255,255,0.06);
}

.map-portrait-img img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center;
  border-radius: 999px;
  display: block;
}

        .map-portrait-name {
          max-width: 260px;
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.18);
          background: rgba(0,0,0,0.30);
          backdrop-filter: blur(8px);
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          font-size: 11px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .map-pillrow {
          display: flex;
          gap: 4px;
          align-items: center;
        }
        .map-pill {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 8px 10px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.18);
          background: rgba(0,0,0,0.26);
          backdrop-filter: blur(10px);
          font-weight: 900;
          letter-spacing: 0.10em;
          text-transform: uppercase;
          font-variant-numeric: tabular-nums;
          font-size: 11px;
          min-width: 60px;
          justify-content: center;
        }
        .map-pill--score { min-width: 70px; }
        .map-pill.is-hit { animation: popHit 220ms var(--ease-out) both; }
/* -----------------------------
   Fortnite-style XP bar
------------------------------ */
/* Fortnite-style XP bar (safe) */
.map-xp {
  --xp: 0%;                 /* set 0%..100% from inline style */
  --xpHue: 120;             /* 120=green → 0=red (set from inline style) */
  --pad: 7px;               /* knob radius (14px / 2) */

  position: relative;
  width: 120px;
  height: 10px;
  border-radius: 999px;
  background: rgba(255,255,255,0.10);
  border: 1px solid rgba(255,255,255,0.22);
  overflow: hidden;
  box-shadow:
    inset 0 0 6px rgba(0,0,0,0.40),
    0 4px 14px rgba(0,0,0,0.35);
}

/* Fill (under highlight) */
.map-xp-fill {
  position: relative;
  z-index: 1;
  height: 100%;
  width: var(--xp);
  border-radius: 999px;

  /* Smooth HP color: green (full) -> yellow -> red (low) */
  background: linear-gradient(
    90deg,
    hsl(var(--xpHue) 90% 40%) 0%,
    hsl(var(--xpHue) 90% 55%) 100%
  );

  box-shadow:
    0 0 12px hsl(var(--xpHue) 90% 55% / 0.75),
    inset 0 0 6px rgba(255,255,255,0.40);

  transition: width 260ms ease-out, background 260ms ease-out, box-shadow 260ms ease-out;
}

/* Inner highlight (above fill) */
.map-xp::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 2;
  border-radius: 999px;
  background: linear-gradient(
    to bottom,
    rgba(255,255,255,0.24),
    rgba(255,255,255,0.06) 35%,
    transparent 75%
  );
  pointer-events: none;
  opacity: 0.85;
}

/* Knob (never goes outside) */
.map-xp-knob {
  position: absolute;
  z-index: 3;
  top: 50%;
  left: clamp(var(--pad), var(--xp), calc(100% - var(--pad)));
  transform: translate(-50%, -50%);
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: #ffffff;
  box-shadow:
    0 0 10px rgba(120,240,255,0.90),
    0 2px 8px rgba(0,0,0,0.45);
}

        /* ✅ Make it SMALL and in the left corner, not overlapping enemy avatar */
        .corner-info {
          position: absolute;
          left: 10px;
          top: calc(env(safe-area-inset-top) + 10px);
          z-index: 8;
          padding: 8px 10px;
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(0,0,0,0.34);
          backdrop-filter: blur(10px);
          width: auto;
          max-width: min(240px, calc(100% - 20px));
          box-shadow: 0 12px 40px rgba(0,0,0,0.22);
          pointer-events: none;
        }
        .corner-info .h1 {
          font-weight: 1000;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          font-size: 11px;
          opacity: 0.92;
        }
        .corner-info .line {
          margin-top: 6px;
          font-size: 11px;
          opacity: 0.86;
        }
        .corner-info .line b { font-weight: 900; }

        .round-banner {
          position: absolute;
          left: 50%;
          top: 52%;
          transform: translate(-50%, -50%);
          padding: 12px 14px;
          border-radius: 18px;
          border: 1px solid rgba(255,255,255,0.20);
          background: rgba(0,0,0,0.42);
          backdrop-filter: blur(10px);
          min-width: min(520px, calc(100% - 28px));
          text-align: center;
          box-shadow: 0 12px 40px rgba(0,0,0,0.35);
          animation: bannerIn 320ms var(--ease-out) both;
          pointer-events: none;
          z-index: 7;
        }
        .arena .round-banner { z-index: 7; }
        .round-banner::before {
          content: "";
          position: absolute;
          inset: -18px;
          border-radius: 22px;
          background: radial-gradient(closest-side, rgba(255,255,255,0.22), transparent 70%);
          opacity: 0;
          animation: bannerGlow 520ms ease-out both;
        }
        .round-banner .title {
          font-weight: 1000;
          letter-spacing: 0.24em;
          text-transform: uppercase;
          font-size: 13px;
          opacity: 0.9;
        }
        .round-banner .sub {
          margin-top: 6px;
          font-weight: 900;
          letter-spacing: 0.10em;
          text-transform: uppercase;
          font-size: 18px;
        }
        .round-banner.tone-p1 { border-color: rgba(88,240,255,0.28); }
        .round-banner.tone-p1 .sub { text-shadow: 0 0 18px rgba(88,240,255,0.18); }
        .round-banner.tone-p2 { border-color: rgba(184,92,255,0.28); }
        .round-banner.tone-p2 .sub { text-shadow: 0 0 18px rgba(184,92,255,0.18); }
        .round-banner.tone-draw { border-color: rgba(255,255,255,0.22); }

        .lane {
          position: relative;
          display: grid;
          gap: 0;
          min-height: 720px;
        }

        /* ✅ Row is now centered inside lane rect (top/left/width/height via inline styles) */
        .row {
          border-radius: 0;
          border: 0;
          background: transparent;
          backdrop-filter: none;
          padding: 0;
          display: flex;
          justify-content: center;
          align-items: center;
          position: absolute;
        }

        .slots {
          width: 100%;
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 10px;
          max-width: 860px;
          padding: 0 10px;
        }

        .bb-card {
          width: 100%;
          aspect-ratio: 3 / 4;
          max-width: 150px;
          perspective: 900px;
          border-radius: 18px;
          margin: 0 auto;
        }

        .bb-slot {
          position: relative;
          width: 100%;
          max-width: 150px;
          margin: 0 auto;
        }

        .bb-hud {
          position: absolute;
          top: 100%;
          left: 50%;
          transform: translateX(-50%);
          margin-top: 6px;
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 7px;
          font-weight: 800;
          line-height: 1;
          letter-spacing: 0.08em;
          color: rgba(255, 255, 255, 0.92);
          white-space: nowrap;
          pointer-events: none;
          z-index: 30;
          text-shadow: 0 1px 2px rgba(0,0,0,0.35);
        }

        .bb-hud-sep {
          opacity: 0.55;
          font-weight: 900;
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

        .bb-mark { font-weight: 900; letter-spacing: 0.24em; font-size: 14px; opacity: 0.75; text-transform: uppercase; }
        .bb-mark-sm { font-weight: 900; letter-spacing: 0.18em; font-size: 11px; opacity: 0.7; text-transform: uppercase; }

        .bb-art {
          position: absolute;
          inset: 18%;
          z-index: 1;
          background-size: contain;
          background-repeat: no-repeat;
          background-position: center;
          filter: saturate(1.05) contrast(1.05);
          transform: none;
        }
        .bb-art--ph {
          background:
            radial-gradient(420px 260px at 50% 10%, rgba(255, 255, 255, 0.12) 0%, transparent 58%),
            linear-gradient(to bottom, rgba(0, 0, 0, 0.22), rgba(0,  0, 0, 0.36));
          display: flex;
          align-items: center;
          justify-content: center;
        }

.bb-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  z-index: 5;
  pointer-events: none;
}

        .bb-fx { position: absolute; inset: 0; pointer-events: none; z-index: 6; }

        .bb-spawn {
          position: absolute;
          inset: 0;
          border-radius: 18px;
          box-shadow: inset 0 0 0 9999px rgba(255,255,255,0.06), 0 0 22px rgba(255,255,255,0.12);
          animation: spawnPop 260ms ease-out both;
        }

        .bb-atkfx { position: absolute; inset: 0; }

        .bb-slash {
          position: absolute;
          left: 50%;
          top: 52%;
          width: 92%;
          height: 4px;
          transform: translate(-50%, -50%) rotate(-18deg);
          border-radius: 999px;
          background: rgba(255,255,255,0.85);
          box-shadow: 0 8px 22px rgba(0,0,0,0.35), 0 0 18px rgba(255,255,255,0.20);
          animation: slashSwipe 160ms ease-out both;
          mix-blend-mode: screen;
        }
        .bb-impact {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 84px;
          height: 84px;
          transform: translate(-50%, -50%);
          border-radius: 999px;
          border: 2px solid rgba(255,255,255,0.55);
          box-shadow: 0 10px 26px rgba(0,0,0,0.35), 0 0 18px rgba(255,255,255,0.16);
          animation: impactRing 190ms ease-out both;
          mix-blend-mode: screen;
        }

        .bb-dmgflash {
          position: absolute;
          inset: 0;
          border-radius: 18px;
          background: rgba(255,255,255,0.22);
          animation: dmgFlash 180ms ease-out both;
          mix-blend-mode: screen;
        }
        .bb-dmgfloat {
          position: absolute;
          left: 50%;
          top: 46%;
          transform: translate(-50%, -50%);
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.22);
          background: rgba(0,0,0,0.42);
          backdrop-filter: blur(8px);
          font-weight: 900;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          font-size: 11px;
          animation: dmgFloat 320ms ease-out both;
        }

        .bb-death {
          position: absolute;
          inset: -10%;
          border-radius: 22px;
          background: radial-gradient(closest-side, rgba(255,255,255,0.10), transparent 70%);
          animation: deathFade 420ms ease-out both;
        }

        .bb-overlay {
          position: absolute;
          inset: 0;
          z-index: 7;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          padding: 12px;
          background: linear-gradient(to top, rgba(0, 0, 0, 0.62), rgba(0, 0, 0, 0.12), transparent);
        }

        .bb-title { font-weight: 900; letter-spacing: 0.06em; font-size: 12px; text-transform: uppercase; line-height: 1.15; }

        .bb-subrow { margin-top: 8px; display: flex; gap: 4px; flex-wrap: wrap; }

        .bb-chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
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

        .bb-bars { margin-top: 10px; display: grid; gap: 4px; }
        .bb-bar {
          height: 7px;
          border-radius: 999px;
          overflow: hidden;
          border: 1px solid rgba(255,255,255,0.18);
          background: rgba(0,0,0,0.22);
        }
        .bb-bar > div { height: 100%; background: rgba(255,255,255,0.18); }
        .bb-bar--hp > div { background: rgba(88, 240, 255, 0.22); }
        .bb-bar--shield > div { background: rgba(255, 204, 87, 0.18); }
        .bb-hptext {
          font-size: 10px;
          letter-spacing: 0.10em;
          text-transform: uppercase;
          opacity: 0.9;
        }
        .bb-shieldnum { opacity: 0.9; }

        .bb-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
        .bb-tag {
          display: inline-flex;
          align-items: center;
          padding: 4px 8px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.18);
          background: rgba(0,0,0,0.18);
          font-size: 7px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          opacity: 0.92;
        }

        .bb-corner {
          position: absolute;
          right: 10px;
          top: 10px;
          width: 12px;
          height: 12px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.20);
          background: rgba(0,0,0,0.18);
          display: grid;
          place-items: center;
        }
        .bb-corner-dot { width: 6px; height: 6px; border-radius: 999px; background: rgba(255,255,255,0.28); }

        .bb-card.has-unit.is-active { animation: activePulse 180ms ease-out 1; }
        .bb-card.has-unit.is-dead { opacity: 1 !important; filter: none !important; }
        .bb-card.has-unit.is-dying { filter: saturate(0.9); }

        @media (max-width: 640px) {
          .slots { gap: 4px; }
          .bb-card { max-width: 110px; border-radius: 16px; }
          .bb-face { border-radius: 16px; }
          .bb-card-inner { border-radius: 16px; }
          .round-banner { top: 54%; }
          .round-banner .sub { font-size: 16px; }
          .bb-bar { height: 6px; }

.map-portrait-ring { width: var(--ringSize); height: var(--ringSize); }
.map-portrait-img { width: var(--imgSize); height: var(--imgSize); }
          .map-portrait-name { max-width: 180px; font-size: 10px; }

          .corner-info { max-width: min(220px, calc(100% - 20px)); }
        }
        /* DEBUG overlay */
        .dbg-panel {
          position: absolute;
          left: 10px;
          top: calc(env(safe-area-inset-top) + 54px);
          z-index: 50;
          padding: 8px 10px;
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.16);
          background: rgba(0,0,0,0.42);
          backdrop-filter: blur(10px);
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          pointer-events: none;
          max-width: min(320px, calc(100% - 20px));
        }
        .dbg-panel b { font-weight: 900; }
        .dbg-cross {
          position: absolute;
          width: 18px;
          height: 18px;
          transform: translate(-50%, -50%);
          z-index: 45;
          pointer-events: none;
        }
        .dbg-cross::before,
        .dbg-cross::after {
          content: "";
          position: absolute;
          left: 50%;
          top: 50%;
          background: rgba(255,255,255,0.95);
          box-shadow: 0 0 10px rgba(255,255,255,0.25);
          transform: translate(-50%, -50%);
        }
        .dbg-cross::before { width: 18px; height: 2px; }
        .dbg-cross::after { width: 2px; height: 18px; }

        .dbg-grid {
          position: absolute;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          z-index: 44;
          pointer-events: none;
        }

          `,
        }}
      />

      <div className="w-full max-w-5xl">
        <header className="board-topbar ui-card rounded-[var(--r-xl)] mb-4">
          <div className="board-hud">
            <div className="hud-left">
              <div className="hud-title">BATTLE</div>
              <div className="mt-1 font-extrabold uppercase tracking-[0.22em] text-base">
                Поле боя • {fmtTime(t)} / {fmtTime(durationSec)}
              </div>

              <div
                className="mt-2 battle-progress"
                role="slider"
                aria-label="Seek"
                onClick={(e) => {
                  const el = e.currentTarget as HTMLDivElement;
                  const rect = el.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const pct = rect.width > 0 ? x / rect.width : 0;
                  seek(pct * durationSec);
                }}
              >
                <div style={{ width: `${progressPct}%` }} />
              </div>

              <div className="scrub-row">
                <input type="range" min={0} max={durationSec} step={0.05} value={t} onChange={(e) => seek(Number(e.target.value))} />

                <button className={["rate-pill", rate === 0.5 ? "is-on" : ""].join(" ")} onClick={() => setRate(0.5)} type="button">
                  0.5x
                </button>
                <button className={["rate-pill", rate === 1 ? "is-on" : ""].join(" ")} onClick={() => setRate(1)} type="button">
                  1x
                </button>
                <button className={["rate-pill", rate === 2 ? "is-on" : ""].join(" ")} onClick={() => setRate(2)} type="button">
                  2x
                </button>
              </div>

              <div className="hud-sub">
                <span className="hud-pill">{phase === "start" ? "ROUND START" : phase === "reveal" ? "REVEAL" : phase === "score" ? "SCORE" : "ROUND END"}</span>
                <span className="hud-pill">
                  Раунд{" "}
                  <b className="tabular-nums">
                    {roundN}/{roundCount}
                  </b>
                </span>
                <span className="hud-pill">
                  Match <b className="tabular-nums">{String(match.id).slice(0, 8)}…</b>
                </span>
                <span className="hud-pill">
                  tl <b className="tabular-nums">{timeline.length}</b>
                </span>
                <span className="hud-pill">
                  side <b className="tabular-nums">{youSide.toUpperCase()}</b>
                </span>
              </div>
            </div>

            <div className="hud-actions">
              <button onClick={() => setPlaying((p) => !p)} className="ui-btn ui-btn-ghost" type="button">
                {playing ? "Пауза" : "▶"}
              </button>
              <button
                onClick={() => {
                  setPlaying(true);
                  seek(0);
                }}
                className="ui-btn ui-btn-ghost"
                type="button"
              >
                ↺
              </button>
              <button onClick={() => router.push("/pvp")} className="ui-btn ui-btn-ghost" type="button">
                Назад
              </button>
            </div>
          </div>
        </header>

        <section ref={arenaRef as any} className={["board", "arena", boardFxClass].join(" ")}>
                    {DEBUG_ARENA && debugCover && (
            <>
              <div className="dbg-panel">
                <div>
                  <b>ARENA</b> W:{debugCover.arenaW}px H:{debugCover.arenaH}px
                </div>
                <div style={{ marginTop: 6 }}>
                  <b>IMG</b> scale:{debugCover.scale.toFixed(4)}
                  <br />
                  offX:{Math.round(debugCover.offsetX)} offY:{Math.round(debugCover.offsetY)}
                  <br />
                  drawn:{Math.round(debugCover.drawnW)}×{Math.round(debugCover.drawnH)}
                </div>
                <div style={{ marginTop: 6 }}>
                  <b>TOP</b> x:{Math.round(debugCover.topX)} y:{Math.round(debugCover.topY)}
                  <br />
                  <b>BOT</b> x:{Math.round(debugCover.botX)} y:{Math.round(debugCover.botY)}
                </div>
              </div>

              <div className="dbg-cross" style={{ left: debugCover.topX, top: debugCover.topY }} />
              <div className="dbg-cross" style={{ left: debugCover.botX, top: debugCover.botY }} />
            </>
          )}

          {DEBUG_GRID && debugCover && <DebugGrid />}

          <svg className="atk-overlay" width="100%" height="100%">
            <defs>
              <marker id="atkArrow" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="strokeWidth">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(255,255,255,0.85)" />
              </marker>
            </defs>

            {attackCurves.map((c) => (
              <g key={c.key}>
                <path className="atk-path-glow" d={c.d} />
                <path className="atk-path-core" d={c.d} />
              </g>
            ))}
          </svg>

          <div className="corner-info">
            <div className="h1">
              РАУНД{" "}
              <b className="tabular-nums">
                {roundN}/{roundCount}
              </b>
            </div>
            <div className="line">
              Победитель: <b>{!roundWinner ? "—" : roundWinner === "draw" ? "DRAW" : roundWinner === youSide ? "YOU" : "ENEMY"}</b>
            </div>
          </div>

          <MapPortrait where="top" tone="enemy" name={enemyName} avatar={enemyAvatar} hp={topTeam.hp} hpMax={topTeam.hpMax} score={scored ? topScore : null} isHit={topHit} />
          <MapPortrait where="bottom" tone="you" name={youName} avatar={youAvatar} hp={bottomTeam.hp} hpMax={bottomTeam.hpMax} score={scored ? bottomScore : null} isHit={bottomHit} />

          {roundBanner.visible && (
            <div
              key={roundBanner.tick}
              className={["round-banner", roundBanner.tone === "p1" ? "tone-p1" : roundBanner.tone === "p2" ? "tone-p2" : "tone-draw"].join(" ")}
            >
              <div className="title">ROUND END</div>
              <div className="sub">{roundBanner.text}</div>
            </div>
          )}

          <div className="lane">
            <div
              className="row"
              style={
                laneRects
                  ? {
                      top: laneRects.enemy.top,
                      left: laneRects.enemy.left,
                      width: laneRects.enemy.width,
                      height: laneRects.enemy.height,
                    }
                  : undefined
              }
            >
              <div className="slots">
                {topSlots.map((s, i) => (
                  <CardSlot
                    key={`top-${i}`}
                    card={s.card}
                    fallbackId={s.fallbackId}
                    unit={s.unit}
                    unitInstanceId={s.unit?.instanceId ?? (s.fallbackId ? lastInstBySlotRef.current[s.fallbackId] : undefined) ?? null}
                    attackFx={(() => { const inst = s.unit?.instanceId ?? (s.fallbackId ? lastInstBySlotRef.current[s.fallbackId] : undefined); return inst ? attackFxByInstance[inst] : undefined; })()}
                    spawnFx={(() => { const inst = s.unit?.instanceId ?? (s.fallbackId ? lastInstBySlotRef.current[s.fallbackId] : undefined); return inst ? spawnFxByInstance[inst] : undefined; })()}
                    damageFx={(() => { const inst = s.unit?.instanceId ?? (s.fallbackId ? lastInstBySlotRef.current[s.fallbackId] : undefined); return inst ? damageFxByInstance[inst] : undefined; })()}
                    isDying={(() => { const inst = s.unit?.instanceId ?? (s.fallbackId ? lastInstBySlotRef.current[s.fallbackId] : undefined); return !!(inst && deathFxByInstance.has(inst)); })()}
                    revealed={revealed && (topCardsFull.length > 0 || topCards.length > 0)}
                    delayMs={i * 70}
                  />
                ))}
              </div>
            </div>

            <div
              className="row"
              style={
                laneRects
                  ? {
                      top: laneRects.you.top,
                      left: laneRects.you.left,
                      width: laneRects.you.width,
                      height: laneRects.you.height,
                    }
                  : undefined
              }
            >
              <div className="slots">
                {bottomSlots.map((s, i) => (
                  <CardSlot
                    key={`bottom-${i}`}
                    card={s.card}
                    fallbackId={s.fallbackId}
                    unit={s.unit}
                    unitInstanceId={s.unit?.instanceId ?? (s.fallbackId ? lastInstBySlotRef.current[s.fallbackId] : undefined) ?? null}
                    attackFx={(() => { const inst = s.unit?.instanceId ?? (s.fallbackId ? lastInstBySlotRef.current[s.fallbackId] : undefined); return inst ? attackFxByInstance[inst] : undefined; })()}
                    spawnFx={(() => { const inst = s.unit?.instanceId ?? (s.fallbackId ? lastInstBySlotRef.current[s.fallbackId] : undefined); return inst ? spawnFxByInstance[inst] : undefined; })()}
                    damageFx={(() => { const inst = s.unit?.instanceId ?? (s.fallbackId ? lastInstBySlotRef.current[s.fallbackId] : undefined); return inst ? damageFxByInstance[inst] : undefined; })()}
                    isDying={(() => { const inst = s.unit?.instanceId ?? (s.fallbackId ? lastInstBySlotRef.current[s.fallbackId] : undefined); return !!(inst && deathFxByInstance.has(inst)); })()}
                    revealed={revealed && (bottomCardsFull.length > 0 || bottomCards.length > 0)}
                    delayMs={i * 70}
                  />
                ))}
              </div>
            </div>

            {!playing && t >= durationSec && (
              <div
                className="ui-card p-5"
                style={{
                  position: "absolute",
                  left: 14,
                  right: 14,
                  bottom: 14,
                  background: "rgba(0,0,0,0.32)",
                  backdropFilter: "blur(10px)",
                  zIndex: 6,
                }}
              >
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

                <button onClick={() => router.push("/pvp")} className="mt-5 ui-btn ui-btn-primary w-full" type="button">
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