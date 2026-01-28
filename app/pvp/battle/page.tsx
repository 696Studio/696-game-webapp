"use client";
// @ts-nocheck

import React, {Suspense, useEffect, useMemo, useRef, useState, useCallback} from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useGameSessionContext } from "../../context/GameSessionContext";
import CardArt from "../../components/CardArt";

import BattleFxLayer from './BattleFxLayer';


// ===== BB_ATTACK_DEBUG_OVERLAY =====
function bbDbgEnabled() {
  try {
    if (typeof window === "undefined") return false;
    // Toggle options (no URL needed):
    // 1) window.__bbdbg = 1
    // 2) localStorage.setItem("bbdbg","1")
    // 3) sessionStorage.setItem("bbdbg","1")
    const w = window as any;
    const ls = (() => { try { return window.localStorage?.getItem("bbdbg"); } catch { return null; } })();
    const ss = (() => { try { return window.sessionStorage?.getItem("bbdbg"); } catch { return null; } })();
    if (w.__bbdbg === 1 || w.__bbdbg === "1") return true;
    if (ls === "1" || ss === "1") return true;

    // Default OFF: debug overlay hidden unless explicitly enabled
    return false;
  } catch {
    return false;
  }
}
function bbDbgSet(msg: string) {
  if (!bbDbgEnabled()) return;
  const id = "bb-attack-debug";
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    el.style.position = "fixed";
    el.style.left = "12px";
    el.style.top = "12px";
    el.style.zIndex = "999999";
    el.style.padding = "10px 12px";
    el.style.font = "12px/1.25 system-ui, -apple-system, Segoe UI, Roboto, Arial";
    el.style.background = "rgba(0,0,0,0.72)";
    el.style.color = "white";
    el.style.borderRadius = "12px";
    el.style.pointerEvents = "none";
    el.style.maxWidth = "92vw";
    el.style.whiteSpace = "pre-wrap";
    document.body.appendChild(el);
  }
  el.textContent = msg;
}

const HIDE_VISUAL_DEBUG = true; // hide all DBG/grid/fx overlays (forced OFF)

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

const DEBUG_ARENA = false; // debug overlay for arena sizing
const DEBUG_GRID = false; // mirrored A/B measurement grid
// Tweaks for your specific PNG (ring centers)
const TOP_RING_NX = 0.5;
const TOP_RING_NY = 0.1233;
const TOP_NAME_NX = 0.5;
const TOP_NAME_NY = 0.2110;
const BOT_RING_NX = 0.5;
const BOT_RING_NY = 0.8784; // was 0.89

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

function coverUnmapPoint(x: number, y: number, containerW: number, containerH: number, imgW: number, imgH: number) {
  const scale = Math.max(containerW / imgW, containerH / imgH); // cover
  const drawnW = imgW * scale;
  const drawnH = imgH * scale;
  const offsetX = (containerW - drawnW) / 2;
  const offsetY = (containerH - drawnH) / 2;

  const nx = (x - offsetX) / drawnW;
  const ny = (y - offsetY) / drawnH;

  return { nx, ny, scale, drawnW, drawnH, offsetX, offsetY };
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
  const isIOS = useMemo(() => {
    try {
      const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
      return (
        /iP(hone|ad|od)/.test(ua) ||
        (((navigator as any).platform === "MacIntel") && (navigator as any).maxTouchPoints > 1)
      );
    } catch {
      return false;
    }
  }, []);

  // iOS class flag (used for CSS overrides to prevent TG iOS WebView spinning/flip glitches)
  useEffect(() => {
    if (!isIOS) return;
    try {
      if (typeof document !== "undefined") document.documentElement.classList.add("bb-ios");
      return () => {
        if (typeof document !== "undefined") document.documentElement.classList.remove("bb-ios");
      };
    } catch {
      return;
    }
  }, [isIOS]);

  const router = useRouter();
  const sp = useSearchParams();
  // Debug flags (safe in Telegram: just read query params).
  const fxdebug = sp.get("fxdebug") === "1";
  const layoutdebug = sp.get("layoutdebug") === "1" || fxdebug;

  // Local toggle (does not affect layout): lets you enable debug overlay without URL params.
  const [uiDebug, setUiDebug] = useState<boolean>(layoutdebug);

  // Debug UI is rendered directly in JSX (no portals/DOM mutations).
const uiDebugOn = HIDE_VISUAL_DEBUG ? false : uiDebug;
  const isArenaDebug = DEBUG_ARENA || uiDebugOn;
  const isGridDebug = DEBUG_GRID || uiDebugOn;

  const [dbgClick, setDbgClick] = useState<null | { nx: number; ny: number; x: number; y: number }>(null);

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
  const prevPhaseRef = useRef<null | string>(null);
  const roundBannerTimeoutRef = useRef<number | null>(null);

  const [activeInstance, setActiveInstance] = useState<string | null>(null);
  const [p1UnitsBySlot, setP1UnitsBySlot] = useState<Record<number, UnitView | null>>({});
  const [p2UnitsBySlot, setP2UnitsBySlot] = useState<Record<number, UnitView | null>>({});

  const arenaRef = useRef<HTMLDivElement | null>(null);

  const onArenaPointerDownCapture = (ev: React.PointerEvent) => {
    if (!isArenaDebug) return;
    if (!debugCover) return;
    // left button / primary touch only
    if ((ev as any).button != null && (ev as any).button !== 0) return;

    const arenaEl = arenaRef.current;
    if (!arenaEl) return;

    const rect = arenaEl.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;

    const inv = coverUnmapPoint(x, y, debugCover.arenaW, debugCover.arenaH, BOARD_IMG_W, BOARD_IMG_H);
    const nx = clamp(inv.nx, 0, 1);
    const ny = clamp(inv.ny, 0, 1);

    setDbgClick({ nx, ny, x, y });
    // Also log for copy/paste.
    // eslint-disable-next-line no-console
    console.log("[layoutdebug] click:", { nx, ny, x, y });
  };

  const unitElByIdRef = useRef<Record<string, HTMLDivElement | null>>({});

  // =========================================================
  // REAL ATTACK LUNGE (during battle timeline)
  // TG iOS WebView can be flaky with transform, so we animate
  // the CardRoot (data-bb-slot element) via top/left.
  // =========================================================
  const lastAttackSigRef = useRef<string>("");
  
  // Hearthstone-style turquoise energy shot/beam overlay inside arena (2D only), iOS-safe.
  // Do not depend on ref.current in hooks dependencies.
  // Only update via explicit cue (attackCue) when a new attack is processed.
  const attackCueTickRef = useRef<number>(0);
  const [attackCue, setAttackCue] = useState<{ fromId: string; toId: string; tick: number } | null>(null);

  const [attackArrow, setAttackArrow] = useState<{
    show: boolean;
    ax: number;
    ay: number;
    bx: number;
    by: number;
  }>({ show: false, ax: 0, ay: 0, bx: 0, by: 0 });

  const attackArrowTimeoutRef = useRef<number | null>(null);
  // Attack lock: ensure only one lunge animation runs at a time (prevents overlapping lunges and "chaos" on fast timelines).
  const attackLockRef = useRef(false);
  const queuedAttackRef = useRef<{ fromId: string; toId: string } | null>(null);

  const [arrowAnimTick, setArrowAnimTick] = useState(0);

  // Animation loop for dash flow and pulse.
  useEffect(() => {
    if (!attackArrow.show) return;
    let frame: number;
    let last = performance.now();
    function animate(now: number) {
      if (!attackArrow.show) return;
      // Throttled updates for mobile perf (TG iOS WebView etc)
      if (now - last >= 50) { // ~20 FPS, good for eye/pulse/dash
        last = now;
        setArrowAnimTick((t) => t + 1);
      }
      frame = requestAnimationFrame(animate);
    }
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [attackArrow.show]);

  // On new attackCue, get arena/unit DOM coords, show arrow, hide after a moment.
  useEffect(() => {
    if (!attackCue) return;
    if (attackArrowTimeoutRef.current !== null) {
      clearTimeout(attackArrowTimeoutRef.current);
      attackArrowTimeoutRef.current = null;
    }
    // Next tick for DOM layout
    const timer = window.setTimeout(() => {
      const arenaEl = arenaRef.current;
      const fromEl = unitElByIdRef.current[attackCue.fromId];
      const toEl = unitElByIdRef.current[attackCue.toId];
      if (!arenaEl || !fromEl || !toEl) return;
      const arenaRect = arenaEl.getBoundingClientRect();
      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();
      const ax = fromRect.left + fromRect.width / 2 - arenaRect.left;
      const ay = fromRect.top + fromRect.height / 2 - arenaRect.top;
      const bx = toRect.left + toRect.width / 2 - arenaRect.left;
      const by = toRect.top + toRect.height / 2 - arenaRect.top;
      setAttackArrow({ show: true, ax, ay, bx, by });
      // Hide after a brief moment (Hearthstone readability)
      attackArrowTimeoutRef.current = window.setTimeout(() => {
        setAttackArrow(a => ({ ...a, show: false }));
        attackArrowTimeoutRef.current = null;
      }, 360);
    }, 0);
    return () => clearTimeout(timer);
  }, [attackCue?.tick]);

  function AttackArrowOverlay() {
    if (!attackArrow.show) return null;

    const { ax, ay, bx, by } = attackArrow;

    // arenaRect for sizing SVG viewport to fit entire attack arrow cleanly
    const arenaRect = arenaRef.current?.getBoundingClientRect();
    const vw = arenaRect?.width ?? Math.max(ax, bx) + 64;
    const vh = arenaRect?.height ?? Math.max(ay, by) + 64;

    // BASE COLORS (turquoise/energy blue)
    const beamColor = "#2fffe1";
    const beamColor2 = "#00f5ff";
    const auraColor = "#b5fff5";
    const auraEdge = "#79fff0";

    // Arrow specs
    const outerGlowWidth = 42; // thick, soft glow
    const midGlowWidth = 18;   // mid, medium glow
    const coreWidth = 7;       // sharp core
    const arrowHeadLength = 28;
    const arrowHeadWidth = 16;
    const tipOrbR = 10;

    // Animated dash/pulse for the energy effect
    const dashOffset = -(arrowAnimTick * 9) % 160;
    const pulseMag = Math.sin((arrowAnimTick % 40) / 40 * 2 * Math.PI);
    const pulseScale = 1 + 0.10 * pulseMag;
    // Subtle pulse for opacity, gives inner flicker/shimmer
    const shimmer = 0.03 * Math.sin((arrowAnimTick % 18) / 18 * 2 * Math.PI);

    // Calculate direction/length, skip degenerate cases
    const dx = bx - ax, dy = by - ay;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (!(length > 2)) return null;

    const nx = dx / length, ny = dy / length;

    // Arrowhead base (just before tip)
    const baseX = bx - nx * arrowHeadLength;
    const baseY = by - ny * arrowHeadLength;
    // Arrowhead triangle corners
    const perpX = -ny, perpY = nx;
    const hx1 = baseX + perpX * (arrowHeadWidth / 2);
    const hy1 = baseY + perpY * (arrowHeadWidth / 2);
    const hx2 = baseX - perpX * (arrowHeadWidth / 2);
    const hy2 = baseY - perpY * (arrowHeadWidth / 2);

    // Path string for the arrow/beam
    const arrowPath = `M ${ax},${ay} L ${bx},${by}`;

    // Gradient for the stroke (for all platforms)
    // No SVG filter, no mix-blend, just color/opacity/layering
    return (
      <svg
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          zIndex: 80,
          // iOS: no transforms on parent/arena, so only translateZ(0)
          transform: "translateZ(0)",
          WebkitTransform: "translateZ(0)",
        }}
        width="100%"
        height="100%"
        viewBox={`0 0 ${vw} ${vh}`}
      >
        <defs>
          {/* Turquoise core gradient for energetic beam */}
          <linearGradient id="bb-energy-gradient" x1={ax} y1={ay} x2={bx} y2={by} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={beamColor2} />
            <stop offset="30%" stopColor={beamColor} />
            <stop offset="80%" stopColor={beamColor2} />
          </linearGradient>
        </defs>

        {/* Outer Glow Stroke - soft, bright aura */}
        <path
          d={arrowPath}
          stroke={auraColor}
          strokeWidth={outerGlowWidth * pulseScale}
          strokeLinecap="round"
          opacity={0.19 + shimmer}
          style={{
            // Fallback drop-shadow for further soft visual boost, but harmless on iOS
            filter: "drop-shadow(0 0 15px #8ffffe)",
            transition: "stroke-width 0.13s"
          }}
        />

        {/* Mid Glow Stroke - more visible */}
        <path
          d={arrowPath}
          stroke={auraEdge}
          strokeWidth={midGlowWidth * pulseScale}
          strokeLinecap="round"
          opacity={0.44 + shimmer}
          style={{
            filter: "drop-shadow(0 0 9px #4afffc)",
            transition: "stroke-width 0.10s"
          }}
        />

        {/* Core Beam Stroke - animated dash */}
        <path
          d={arrowPath}
          stroke="url(#bb-energy-gradient)"
          strokeWidth={coreWidth * pulseScale}
          strokeLinecap="round"
          strokeDasharray="13 21"
          strokeDashoffset={dashOffset}
          opacity={0.93 + shimmer}
          style={{
            // No filter/mix-blend; crisp core energy color
            transition: "stroke-width 0.08s"
          }}
        />

        {/* Energetic Tip Orb (glowing turquoise ring at tip) */}
        <circle
          cx={bx}
          cy={by}
          r={tipOrbR * pulseScale * 1.10}
          fill="url(#bb-energy-gradient)"
          opacity={0.83}
          style={{
            filter: "drop-shadow(0 0 7px #e6ffff)",
            transition: "r 0.1s"
          }}
        />

        {/* Arrowhead Polygon - simple bright tip with inner cone */}
        <polygon
          points={`${bx},${by} ${hx1},${hy1} ${hx2},${hy2}`}
          fill="url(#bb-energy-gradient)"
          opacity={0.93}
          style={{
            filter: "drop-shadow(0 0 6px #00fff9)",
            transition: "filter 0.07s"
          }}
        />

        {/* Subtle outer orb for tip highlight, add visible punch */}
        <circle
          cx={bx}
          cy={by}
          r={tipOrbR * pulseScale * (1.23 + 0.09 * Math.sin(arrowAnimTick / 7))}
          fill={auraColor}
          opacity={0.22}
          style={{
            filter: "drop-shadow(0 0 12px #97fdfc)"
          }}
        />
      </svg>
    );
  }


  const lungeByInstanceIds = useCallback((fromId: string, toId: string) => {
    // FINAL: Detach → Fixed Overlay → Return (original DOM, no clones)
    // LOCK: if an attack animation is already running, queue the latest request and run it after return.
    if (attackLockRef.current) {
      queuedAttackRef.current = { fromId, toId };
      return;
    }
    attackLockRef.current = true;

    try {
    try { (window as any).__bbAtkTick = ((window as any).__bbAtkTick || 0) + 1; } catch {}

    const fromCard = unitElByIdRef.current[fromId];
    const toCard = unitElByIdRef.current[toId];
    const attackerRoot = (fromCard ? (fromCard.closest('[data-bb-slot]') as HTMLElement | null) : null);
    const targetRoot = (toCard ? (toCard.closest('[data-bb-slot]') as HTMLElement | null) : null);
    if (!attackerRoot || !targetRoot) {
      bbDbgSet(`#${(window as any).__bbAtkTick || 0} ATTACK ${fromId} -> ${toId}
foundAttacker=${!!attackerRoot} foundTarget=${!!targetRoot}`);
      attackLockRef.current = false;
      return;
    }
    if (attackerRoot === targetRoot) { attackLockRef.current = false; return; }

    // Cancel WAAPI animations if any, so transform/transition is deterministic.
    attackerRoot.getAnimations?.().forEach((anim) => anim.cancel());

    // Create (or reuse) a top-level fixed overlay layer to avoid Telegram WebView layout/stacking issues.
    const getOverlay = (): HTMLDivElement => {
      const id = 'bb-anim-layer';
      let el = document.getElementById(id) as HTMLDivElement | null;
      if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.style.position = 'fixed';
        el.style.left = '0px';
        el.style.top = '0px';
        el.style.right = '0px';
        el.style.bottom = '0px';
        el.style.pointerEvents = 'none';
        el.style.zIndex = '2147483647';
        // Prevent iOS Safari from creating a new stacking context that can swallow fixed children
        el.style.transform = 'translateZ(0)';
        document.body.appendChild(el);
      }
      return el;
    };

    const ar = attackerRoot.getBoundingClientRect();
    const br = targetRoot.getBoundingClientRect();
    const ax = ar.left + ar.width / 2;
    const ay = ar.top + ar.height / 2;
    const bx = br.left + br.width / 2;
    const by = br.top + br.height / 2;

    const dx = (bx - ax) * 0.78;
    const dy = (by - ay) * 0.78;

    const ease = 'cubic-bezier(.18,.9,.22,1)';
    const outMs = 220;
    const backMs = 200;

    // Save inline styles for full restore.
    const prev = {
      position: attackerRoot.style.position,
      left: attackerRoot.style.left,
      top: attackerRoot.style.top,
      right: attackerRoot.style.right,
      bottom: attackerRoot.style.bottom,
      width: attackerRoot.style.width,
      height: attackerRoot.style.height,
      transform: attackerRoot.style.transform,
      transition: attackerRoot.style.transition,
      zIndex: attackerRoot.style.zIndex,
      willChange: attackerRoot.style.willChange,
      pointerEvents: attackerRoot.style.pointerEvents,
    };

    const restoreStyles = () => {
      attackerRoot.style.position = prev.position;
      attackerRoot.style.left = prev.left;
      attackerRoot.style.top = prev.top;
      attackerRoot.style.right = prev.right;
      attackerRoot.style.bottom = prev.bottom;
      attackerRoot.style.width = prev.width;
      attackerRoot.style.height = prev.height;
      attackerRoot.style.transform = prev.transform;
      attackerRoot.style.transition = prev.transition;
      attackerRoot.style.zIndex = prev.zIndex;
      attackerRoot.style.willChange = prev.willChange;
      attackerRoot.style.pointerEvents = prev.pointerEvents;
    };

    // Re-parent (detach) the *same DOM node* into overlay, with a placeholder so we can return it.
    const parent = attackerRoot.parentNode;
    const nextSibling = attackerRoot.nextSibling;
    const placeholder = document.createComment('bb-lunge-placeholder');
    try {
      parent?.insertBefore(placeholder, attackerRoot);
      getOverlay().appendChild(attackerRoot);
    } catch {
      // If reparent fails, do nothing.
    }

    // DETACH: fixed at the exact current screen rect.
    attackerRoot.style.position = 'fixed';
    attackerRoot.style.left = `${ar.left}px`;
    attackerRoot.style.top = `${ar.top}px`;
    attackerRoot.style.right = 'auto';
    attackerRoot.style.bottom = 'auto';
    attackerRoot.style.width = `${ar.width}px`;
    attackerRoot.style.height = `${ar.height}px`;
    attackerRoot.style.zIndex = '2147483647';
    attackerRoot.style.pointerEvents = 'none';
    attackerRoot.style.willChange = 'transform';
    attackerRoot.style.transition = 'none';
    attackerRoot.style.transform = 'translate3d(0px, 0px, 0px)';

    try { targetRoot.classList.add('is-attack-to'); } catch {}

    // LUNGE: animate only transform.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        attackerRoot.style.transition = `transform ${outMs}ms ${ease}`;
        attackerRoot.style.transform = `translate3d(${dx}px, ${dy}px, 0px)`;
        // iOS TG WebView can delay paint of transitions until the next user gesture/scroll.
        // Force a paint/layout flush right before starting the transition.
        try {
          // Force style+layout flush
          void attackerRoot.offsetHeight;
          if (typeof document !== 'undefined') void (document.body && (document.body as any).offsetHeight);
        } catch {}
        (attackerRoot.style as any).webkitTransition = `transform ${outMs}ms ${ease}`;
        (attackerRoot.style as any).webkitTransform = `translate3d(${dx}px, ${dy}px, 0px)`;
        try { (window as any).__bbLastLungeAt = Date.now(); } catch {}
        bbDbgSet(`#${(window as any).__bbAtkTick || 0} LUNGE_APPLIED ${fromId} -> ${toId}`);

        const isIOS =
          typeof document !== "undefined" && document.documentElement.classList.contains("bb-ios");

        const doReturn = () => {
          try { targetRoot.classList.remove('is-attack-to'); } catch {}

          // RETURN: put the node back where it was, then restore styles.
          try {
            if (placeholder.parentNode) {
              placeholder.parentNode.insertBefore(attackerRoot, placeholder);
              placeholder.parentNode.removeChild(placeholder);
            } else if (parent) {
              // fallback
              if (nextSibling) parent.insertBefore(attackerRoot, nextSibling);
              else parent.appendChild(attackerRoot);
            }
          } catch {}

          restoreStyles();

          // Unlock and run the latest queued attack (if any).
          attackLockRef.current = false;
          const q = queuedAttackRef.current;
          if (q && q.fromId && q.toId) {
            queuedAttackRef.current = null;
            // Schedule next tick to avoid nested layout reads during return.
            window.setTimeout(() => {
              lungeByInstanceIds(q.fromId, q.toId);
            }, 0);
          }
        };

        if (isIOS && typeof (attackerRoot as any).animate === "function") {
          // iOS TG WebView: CSS transitions can stall until a user gesture. Use Web Animations API.
          try {
            attackerRoot.style.transition = "none";
            (attackerRoot.style as any).webkitTransition = "none";
            attackerRoot.style.transform = "translate3d(0px, 0px, 0px)";
            (attackerRoot.style as any).webkitTransform = "translate3d(0px, 0px, 0px)";

            const a1 = (attackerRoot as any).animate(
              [
                { transform: "translate3d(0px, 0px, 0px)" },
                { transform: `translate3d(${dx}px, ${dy}px, 0px)` },
              ],
              { duration: outMs, easing: ease, fill: "forwards" }
            );

            a1.onfinish = () => {
              const a2 = (attackerRoot as any).animate(
                [
                  { transform: `translate3d(${dx}px, ${dy}px, 0px)` },
                  { transform: "translate3d(0px, 0px, 0px)" },
                ],
                { duration: backMs, easing: ease, fill: "forwards" }
              );
              a2.onfinish = () => {
                doReturn();
              };
            };

            bbDbgSet(`#${(window as any).__bbAtkTick || 0} LUNGE_WAAPI ${fromId} -> ${toId}`);
            return;
          } catch {
            // fall through to CSS path
          }
        }


        window.setTimeout(() => {
          attackerRoot.style.transition = `transform ${backMs}ms ${ease}`;
          attackerRoot.style.transform = 'translate3d(0px, 0px, 0px)';
          (attackerRoot.style as any).webkitTransition = `transform ${backMs}ms ${ease}`;
          (attackerRoot.style as any).webkitTransform = 'translate3d(0px, 0px, 0px)';

          window.setTimeout(() => {
            doReturn();
          }, backMs + 80);
        }, outMs + 80);

      });
    });

    } catch (err) {
      // Safety: never leave the lock stuck on unexpected runtime errors.
      attackLockRef.current = false;
      queuedAttackRef.current = null;
      try { console.error("lungeByInstanceIds failed", err); } catch {}
    }
  }, []);

  const lastInstBySlotRef = useRef<Record<string, string>>({});

  // =========================================================
  // FX MANAGER (GUARANTEED): death bursts are rendered in an
  // arena-level overlay, independent of card DOM/lifecycle.
  // =========================================================
  type FxBurst = {
    id: string;
    x: number; // px relative to arena
    y: number; // px relative to arena
    size: number; // px
    createdAt: number; // ms
    kind: "death";
  };

  const [fxBursts, setFxBursts] = useState<FxBurst[]>([]);
  const prevHpByInstanceRef = useRef<Record<string, number>>({});
  const prevPresentRef = useRef<Set<string>>(new Set());

    const deathFxPlayedRef = useRef<Set<string>>(new Set());
const spawnDeathBurst = (instanceId: string, fallbackSize = 140) => {
    const arenaEl = arenaRef.current;
    if (!arenaEl) return;

    const arenaRect = arenaEl.getBoundingClientRect();
    const targetEl = unitElByIdRef.current[instanceId];
    const r = targetEl?.getBoundingClientRect();
    if (!r) return;

    const size = Math.max(84, Math.min(170, Math.max(r.width, r.height) * 1.05));
const x = (r.left - arenaRect.left) + r.width / 2;
    const y = (r.top - arenaRect.top) + r.height / 2;

    const id = `${instanceId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const burst: FxBurst = {
      id,
      x,
      y,
      size: Number.isFinite(size) ? size : fallbackSize,
      createdAt: Date.now(),
      kind: "death",
    };

    setFxBursts((prev) => [...prev, burst]);

    // Auto-remove after animation window
    window.setTimeout(() => {
      setFxBursts((prev) => prev.filter((b) => b.id !== id));
    }, 900);
  };

  // Detect deaths robustly:
  // - hp drops from >0 to <=0
  // - or instance disappears from slots (removal)
  useEffect(() => {
    if (!(window as any).__bbDbgReadySet) { (window as any).__bbDbgReadySet = true; bbDbgSet('DBG READY — waiting for ATTACK events...'); }
    const current: Record<string, number> = {};
    const present = new Set<string>();

    const allUnits: (UnitView | null | undefined)[] = [
      ...Object.values(p1UnitsBySlot || {}),
      ...Object.values(p2UnitsBySlot || {}),
    ];

    for (const u of allUnits) {
      if (!u?.instanceId) continue;
      present.add(u.instanceId);
      current[u.instanceId] = (u.hp ?? 0);
    }

    const prevHp = prevHpByInstanceRef.current;
    for (const [id, hp] of Object.entries(current)) {
      const before = prevHp[id];
      if (typeof before === "number" && before > 0 && hp <= 0) {
        if (!deathFxPlayedRef.current.has(id)) {
          deathFxPlayedRef.current.add(id);
          spawnDeathBurst(id);
        }
      }
    }

    // Disappearances (unit removed from slots)
    const prevPresent = prevPresentRef.current;
    for (const id of prevPresent) {
      if (!present.has(id)) {
        if (!deathFxPlayedRef.current.has(id)) {
          deathFxPlayedRef.current.add(id);
          spawnDeathBurst(id);
        }
      }
    }

    prevHpByInstanceRef.current = current;
    prevPresentRef.current = present;
  }, [p1UnitsBySlot, p2UnitsBySlot]);
  const [layoutTick, setLayoutTick] = useState(0);

  const [arenaBox, setArenaBox] = useState<{ w: number; h: number; left: number; top: number } | null>(null);

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
      arenaLeft: arenaBox.left,
      arenaTop: arenaBox.top,
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
      setArenaBox({ w, h, left: r.left, top: r.top });
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
        // Prefer explicit instanceId; fallback to side+slot -> current slot map.
        // Some logs can store unit ref under different keys (target/unit/to), so we normalize it here
        // to avoid "wrong target" visuals and premature round_end while cards look alive.
        const ref =
          readUnitRefFromEvent(e, "target") ||
          readUnitRefFromEvent(e, "unit") ||
          readUnitRefFromEvent(e, "to");

        const side = (ref?.side ?? (e as any)?.target?.side ?? (e as any)?.side) as "p1" | "p2" | undefined;
        const slot = Number(ref?.slot ?? (e as any)?.target?.slot ?? (e as any)?.slot ?? NaN);
        let tid = String(ref?.instanceId ?? (e as any)?.target?.instanceId ?? "");
        const amount = Number((e as any)?.amount ?? 0);
        const hp = (e as any)?.hp;
        const shield = (e as any)?.shield;

        if (!tid && (side === "p1" || side === "p2") && Number.isFinite(slot)) {
          const bySlot = side === "p1" ? slotMapP1[slot] : slotMapP2[slot];
          if (bySlot?.instanceId) tid = String(bySlot.instanceId);

          // If the slot has just transitioned (death/spawn), the current slot map can be stale.
          // Use last known instanceId for that side+slot to keep damage targeting stable.
          if (!tid) {
            const k = `${side}:${slot}`;
            const last = lastInstBySlotRef.current?.[k];
            if (last) tid = String(last);
          }
        }

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
        const ref =
          readUnitRefFromEvent(e, "target") ||
          readUnitRefFromEvent(e, "unit") ||
          readUnitRefFromEvent(e, "to");

        const side = (ref?.side ?? (e as any)?.target?.side ?? (e as any)?.side) as "p1" | "p2" | undefined;
        const slot = Number(ref?.slot ?? (e as any)?.target?.slot ?? (e as any)?.slot ?? NaN);
        let tid = String(ref?.instanceId ?? (e as any)?.target?.instanceId ?? "");
        const amount = Number((e as any)?.amount ?? 0);
        const hp = (e as any)?.hp;

        if (!tid && (side === "p1" || side === "p2") && Number.isFinite(slot)) {
          const bySlot = side === "p1" ? slotMapP1[slot] : slotMapP2[slot];
          if (bySlot?.instanceId) tid = String(bySlot.instanceId);
        }

        if (tid) {
          const u = units.get(tid);
          if (u) {
            if (Number.isFinite(hp)) u.hp = Math.max(0, Number(hp));
            else u.hp = Math.max(0, u.hp + Math.max(0, Math.floor(amount)));
            if (u.hp > 0) u.alive = true;
          }
        }
      } else if (e.type === "shield" || e.type === "shield_hit") {
        const ref =
          readUnitRefFromEvent(e, "target") ||
          readUnitRefFromEvent(e, "unit") ||
          readUnitRefFromEvent(e, "to");

        let tid = String(ref?.instanceId ?? (e as any)?.target?.instanceId ?? "");
        const shield = (e as any)?.shield;
        const amount = Number((e as any)?.amount ?? 0);

        if (!tid) {
          const side = (ref?.side ?? (e as any)?.target?.side ?? (e as any)?.side) as "p1" | "p2" | undefined;
          const slot = Number(ref?.slot ?? (e as any)?.target?.slot ?? (e as any)?.slot ?? NaN);
          if ((side === "p1" || side === "p2") && Number.isFinite(slot)) {
            const bySlot = side === "p1" ? slotMapP1[slot] : slotMapP2[slot];
            if (bySlot?.instanceId) tid = String(bySlot.instanceId);
          }
        }

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
  }, [timeline, roundN, t]);useEffect(() => {
    // Banner must be driven strictly by the timeline round_end event (not derived phase/roundWinner),
    // otherwise it can "skip" or appear at the wrong moment due to state ordering.
    //
    // Anti-flash: do not show until REVEAL for THIS round has been reached.
    let hasReveal = false;
    let lastEnd: any = null;

    for (const ev of timeline as any[]) {
      const e: any = ev;
      if ((e as any).round !== roundN) continue;
      if (typeof e.t === "number" && e.t > t) break;
      if (e.type === "reveal") hasReveal = true;
      if (e.type === "round_end") lastEnd = e;
    }

    if (!hasReveal) return;
    if (!lastEnd) return;

    // "Honest" round end: only show after the last combat event in this round has actually happened.
    // This prevents cases where round_end exists in timeline but visuals still show living units mid-combat.
    let lastCombatT = -1;
    for (const ev of timeline as any[]) {
      const e: any = ev;
      if ((e as any).round !== roundN) continue;
      const et = Number(e.t ?? 0);
      if (!(et <= t)) break;
      if (e.type === "attack" || e.type === "damage" || e.type === "death" || e.type === "heal" || e.type === "turn_start") {
        if (et > lastCombatT) lastCombatT = et;
      }
    }
    const endT = Number((lastEnd as any)?.t ?? 0);
    if (lastCombatT >= 0 && t < Math.max(endT, lastCombatT)) return;


    const r = (lastEnd.round ?? roundN) as any;

    // Winner field can be "p1" | "p2" | "draw", but some logs may store user_id.
    let w: any =
      (lastEnd.winner ?? (lastEnd as any).win ?? (lastEnd as any).w ?? null) ??
      null;

    // Fallback to roundWinner state (still only triggers on round_end).
    if (!w && roundWinner) w = roundWinner;

    // Fallback: derive from the latest score event in THIS round up to this time (still only triggers on round_end).
    if (!w) {
      let lastScore: any = null;
      for (let i = timeline.length - 1; i >= 0; i--) {
        const e: any = (timeline as any[])[i];
        if ((e as any).round !== roundN) continue;
        if (e?.type === "score" && typeof e.t === "number" && e.t <= (lastEnd.t ?? t)) {
          lastScore = e;
          break;
        }
      }
      if (lastScore) {
        const s1 = Number((lastScore as any).p1 ?? 0);
        const s2 = Number((lastScore as any).p2 ?? 0);
        if (Number.isFinite(s1) && Number.isFinite(s2)) {
          if (s1 === s2) w = "draw";
          else w = s1 > s2 ? "p1" : "p2";
        }
      }
    }

    // Map winner=user_id → side.
    if (w && match) {
      if (w === match.p1_user_id) w = "p1";
      if (w === match.p2_user_id) w = "p2";
    }

    if (!w) return;

    const sig = `${r}:${w}:${lastEnd.t}`;
    if (sig === prevEndSigRef.current) return;
    prevEndSigRef.current = sig;

    let tone: "p1" | "p2" | "draw" = "draw";
    let text = "DRAW";

    if (w === "draw") {
      tone = "draw";
      text = "DRAW";
    } else if (w === youSide) {
      tone = "p1";
      text = "YOU WIN ROUND";
    } else {
      tone = "p2";
      text = "ENEMY WIN ROUND";
    }

    setRoundBanner((b) => ({ visible: true, tick: b.tick + 1, text, tone }));

    // Reset any previous timeout and always schedule hide (do NOT tie this to every tick elsewhere)
    if (roundBannerTimeoutRef.current != null) window.clearTimeout(roundBannerTimeoutRef.current);
    roundBannerTimeoutRef.current = window.setTimeout(() => {
      setRoundBanner((b) => ({ ...b, visible: false }));
      roundBannerTimeoutRef.current = null;
    }, 900);
  }, [t, timeline, youSide, roundN, roundWinner, match]);

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
    // Map stable slotKey -> last seen instanceId (survives engine clearing unit)
    for (let i = 0; i < 5; i++) {
      const top = topSlots?.[i];
      const bot = bottomSlots?.[i];

      const topKey = `${enemySide}:${i}`;
      const botKey = `${youSide}:${i}`;

      const topInst = top?.unit?.instanceId;
      const botInst = bot?.unit?.instanceId;

      if (topInst) map[topKey] = topInst;
      if (botInst) map[botKey] = botInst;
    }
  }, [topSlots, bottomSlots, enemySide, youSide]);

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
      if (e.type !== "attack") continue;

      // Be resilient: event schemas differ between engines/log versions.
      const fromRef = readUnitRefFromEvent(e as any, "from") || readUnitRefFromEvent(e as any, "unit");
      const toRef = readUnitRefFromEvent(e as any, "to") || readUnitRefFromEvent(e as any, "target");

      const fromId = String(
        (fromRef as any)?.instanceId ??
          (e as any)?.from?.instanceId ??
          (e as any)?.fromId ??
          (e as any)?.attackerId ??
          "",
      );
      const toId = String(
        (toRef as any)?.instanceId ??
          (e as any)?.to?.instanceId ??
          (e as any)?.toId ??
          (e as any)?.targetId ??
          "",
      );
      if (!fromId || !toId) continue;

      (map[fromId] ||= []).push({ t: (e as any).t, fromId, toId });
      (map[toId] ||= []).push({ t: (e as any).t, fromId, toId });
    }
    return map;
  }, [timeline, t]);

  const recentAttacks = useMemo(() => {
    // Find the last (up to 2) attack events that already happened (e.t <= t).
    // IMPORTANT: Do NOT rely on a tiny time window here — in Telegram WebView the playback tick
    // can jump and we'd miss the attack entirely ("no animation anywhere").
    const arr: AttackFx[] = [];
    const tl: any[] = (timeline as any[]) || [];
    for (let i = tl.length - 1; i >= 0 && arr.length < 2; i--) {
      const e: any = tl[i];
      if (!e || e.type !== 'attack') continue;
      const et = Number(e.t ?? 0);
      if (!(et <= t)) continue;

      const fromRef = readUnitRefFromEvent(e as any, 'from') || readUnitRefFromEvent(e as any, 'unit');
      const toRef = readUnitRefFromEvent(e as any, 'to') || readUnitRefFromEvent(e as any, 'target');
      const fromId = String(
        (fromRef as any)?.instanceId ??
          (e as any)?.from?.instanceId ??
          (e as any)?.fromId ??
          (e as any)?.attackerId ??
          '',
      );
      const toId = String(
        (toRef as any)?.instanceId ??
          (e as any)?.to?.instanceId ??
          (e as any)?.toId ??
          (e as any)?.targetId ??
          '',
      );
      if (!fromId || !toId) continue;

      arr.push({ t: et, fromId, toId });
    }
    // Keep chronological order (oldest -> newest) since we scanned backwards.
    return arr.reverse();
  }, [timeline, t]);


const arrowAttacks = useMemo(() => {
  // Visual-only: show attack arrow briefly so it doesn't "stick" between rounds.
  const windowSec = 0.35;
  const fromT = Math.max(0, t - windowSec);
  return (recentAttacks || []).filter((a) => a.t >= fromT && a.t <= t).slice(-1);
}, [recentAttacks, t]);


  // Step 2 (Readability): short-lived 2D focus for the last attack (attacker -> target)
  const attackFocus = useMemo(() => {
    const last = recentAttacks && recentAttacks.length ? recentAttacks[recentAttacks.length - 1] : null;
    if (!last) return null;
    const dt = Number(t) - Number((last as any).t ?? 0);
    // Keep the highlight very short so it doesn't linger if playback ticks jump.
    if (!(dt >= 0 && dt <= 0.70)) return null;
    return last;
  }, [recentAttacks, t]);

  // Trigger one lunge per new attack event (no TEST button).
  useEffect(() => {
    if (!recentAttacks || recentAttacks.length === 0) return;
    const last = recentAttacks[recentAttacks.length - 1];
    if (!last?.fromId || !last?.toId) return;
    const sig = `${last.t}:${last.fromId}:${last.toId}`;
    if (sig === lastAttackSigRef.current) return;
    lastAttackSigRef.current = sig;
    // Update cue for 2D arrow overlay (separate from lunge animation).
    attackCueTickRef.current += 1;
    setAttackCue({ fromId: last.fromId, toId: last.toId, tick: attackCueTickRef.current });
    lungeByInstanceIds(last.fromId, last.toId);
  }, [recentAttacks, lungeByInstanceIds]);

  // FX events derived from recent attacks (used by BattleFxLayer).
  const fxEvents = useMemo(() => {
    // Auto-FX: build attack events from the full timeline so BattleFxLayer can animate each attack once.
    const out: { type: "attack"; id: string; attackerId: string; targetId: string }[] = [];
    const tl: any[] = (timeline as any[]) || [];
    for (let i = 0; i < tl.length; i++) {
      const e: any = tl[i];
      if (!e || e.type !== "attack") continue;

      const fromRef = readUnitRefFromEvent(e, "from") || readUnitRefFromEvent(e, "unit");
      const toRef = readUnitRefFromEvent(e, "to") || readUnitRefFromEvent(e, "target");

      const attackerId = String(fromRef?.instanceId ?? (e?.from && e.from.instanceId) ?? e?.fromId ?? e?.attackerId ?? "");
      const targetId = String(toRef?.instanceId ?? (e?.to && e.to.instanceId) ?? e?.toId ?? e?.targetId ?? "");
      if (!attackerId || !targetId) continue;

      const baseId = String(e.id ?? e.uid ?? `${e.t ?? ""}:${attackerId}:${targetId}`);
      out.push({ type: "attack", id: `atk:${baseId}:${i}`, attackerId, targetId });
    }
    return out;
  }, [timeline]);


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
    const windowSec = 1.6;
    const fromT = Math.max(0, t - windowSec);
    const map: Record<string, DamageFx[]> = {};

    for (const e of timeline) {
      if (e.t < fromT) continue;
      if (e.t > t) break;
      if (e.type === "damage") {
        const ref =
          readUnitRefFromEvent(e, "target") ||
          readUnitRefFromEvent(e, "unit") ||
          readUnitRefFromEvent(e, "to");

        const side = (ref?.side ?? (e as any)?.target?.side ?? (e as any)?.side) as "p1" | "p2" | undefined;
        const slot = Number(ref?.slot ?? (e as any)?.target?.slot ?? (e as any)?.slot ?? NaN);
        let tid = String(ref?.instanceId ?? (e as any)?.target?.instanceId ?? "");
        const amount = Number((e as any)?.amount ?? 0);
        const blocked = Boolean((e as any)?.blocked ?? false);

        if (!tid && (side === "p1" || side === "p2") && Number.isFinite(slot)) {
          const bySlot = side === "p1" ? p1UnitsBySlot[slot] : p2UnitsBySlot[slot];
          if (bySlot?.instanceId) tid = String(bySlot.instanceId);

          // Fallback to last known instance id for the slot (important when state updates remove the unit early).
          if (!tid) {
            const k = `${side}:${slot}`;
            const last = lastInstBySlotRef.current?.[k];
            if (last) tid = String(last);
          }
        }

        if (!tid) continue;
        (map[tid] ||= []).push({ t: e.t, amount, blocked });
      }
    }
    return map;
  }, [timeline, t, p1UnitsBySlot, p2UnitsBySlot]);

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

    for (const atk of arrowAttacks) {
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
  }, [arrowAttacks, layoutTick]);

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
  isHit?: boolean;
}) {
  const isBottom = where === "bottom";

  // ✅ Bottom HUD targets (arena pixel coords in BOARD image space)
  // Bottom is already perfect — do not touch these.
  const BOTTOM_AVATAR_Y = 765; // avatar ring center
  const BOTTOM_HP_Y = 644;     // TeamHP row
  const BOTTOM_NAME_Y = 678;   // nickname baseline

  const pos = useMemo(() => {
    if (!arenaBox) return null;

    // X anchor: both rings are centered, so we reuse the same nx (0.5)
    const p = coverMapPoint(BOT_RING_NX, BOT_RING_NY, arenaBox.w, arenaBox.h, BOARD_IMG_W, BOARD_IMG_H);

    // responsive portrait size based on arena size
    const base = Math.min(arenaBox.w, arenaBox.h);
    const ring = clamp(Math.round(base * 0.083), 84, 148);
    const img = Math.round(ring * 0.86);

    return { left: p.x, ring, img };
  }, [arenaBox]);

  if (!pos || !arenaBox) return null;

  const vars = {
    ["--ringSize" as any]: `${pos.ring}px`,
    ["--imgSize" as any]: `${pos.img}px`,
  } as React.CSSProperties;

  const hpPct = clamp((hp / Math.max(1, hpMax)) * 100, 0, 100);

  // ✅ TOP: mirror bottom anchors around the arena height.
  // This makes top match bottom perfectly, and bottom stays untouched.
  const TOP_AVATAR_Y = arenaBox.h - BOTTOM_AVATAR_Y - 6;
  const TOP_HP_Y = arenaBox.h - BOTTOM_HP_Y;
  const TOP_NAME_Y = arenaBox.h - BOTTOM_NAME_Y;

  const avatarY = isBottom ? BOTTOM_AVATAR_Y : TOP_AVATAR_Y;
  const hpY = isBottom ? BOTTOM_HP_Y : TOP_HP_Y;
  const nameY = isBottom ? BOTTOM_NAME_Y : TOP_NAME_Y;

  return (
    <>
      {/* Avatar */}
      <div
        className={[
          "map-portrait",
          tone === "enemy" ? "tone-enemy" : "tone-you",
          isBottom ? "is-bottom" : "is-top",
        ].join(" ")}
        style={{ left: pos.left, top: avatarY, transform: "translate(-50%,-50%)", ...vars }}
      >
        <div className="map-portrait-ring">
          <div className="map-portrait-img">
            <img src={avatar} alt={tone} />
          </div>
        </div>
      </div>

      {/* Nickname */}
      <div
        className="map-portrait-name"
        style={{
          position: "absolute",
          left: pos.left,
          top: nameY,
          transform: "translate(-50%,-50%)",
          zIndex: 6,
          pointerEvents: "none",
        }}
      >
        {name}
      </div>

      {/* TeamHP + Score Row */}
      <div
        className="map-pillrow"
        style={{
          position: "absolute",
          left: pos.left,
          top: hpY,
          transform: "translate(-50%,-50%)",
          zIndex: 6,
          pointerEvents: "none",
        }}
      >
        <div className="map-xp" style={{ ["--xp" as any]: `${hpPct}%`, ["--xpHue" as any]: `${Math.round((hpPct / 100) * 120)}` } as React.CSSProperties}>
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


  function CardSlot({
  card,
  unit,
  fallbackId,
  unitInstanceId,
  slotKey,
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
  slotKey?: string;
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

    const isAttacker = !!renderUnit && !!attackFocus ? renderUnit.instanceId === (attackFocus as any).fromId : false;
    const isTarget = !!renderUnit && !!attackFocus ? renderUnit.instanceId === (attackFocus as any).toId : false;
    const isDyingUi = !!renderUnit && (deathStarted || isDying || isDead);
    if (isHidden) return null;
    return (
      <div className={["bb-slot", isDyingUi ? "is-dying" : "", isVanish ? "is-vanish" : ""].join(" ")} data-unit-id={renderUnit?.instanceId}>
        <div
          data-bb-slot={slotKey}
          className="bb-motion-layer bb-card-root"
          data-fx-motion="1"
          style={{ willChange: "transform" }}
        >
      <div className="bb-fx-anchor">
        
        {isDyingUi ? <div className="bb-death" /> : null}
      </div>
      {renderUnit && dmg && (
        <div className="bb-dmg-hud" aria-hidden="true">
          <div key={`dmgflash-${dmg.t}-${renderUnit.instanceId}`} className="bb-dmgflash" />
          <div key={`dmgfloat-${dmg.t}-${renderUnit.instanceId}`} className="bb-dmgfloat bb-dmgfloat--above">
            {dmg.blocked ? "BLOCK" : `-${Math.max(0, Math.floor(dmg.amount))}`}
          </div>
        </div>
      )}
      <div
        ref={(el) => {
          if (el && renderUnit?.instanceId) unitElByIdRef.current[renderUnit.instanceId] = el;
        }}
        data-unit-id={renderUnit?.instanceId}
        className={[
          "bb-card",
          revealed ? "is-revealed" : "",
          `rt-${revealTick}`,
          renderUnit ? "has-unit" : "",
          isDead ? "is-dead" : "",
          isActive ? "is-active" : "",
          isAttacker ? "is-attacker" : "",
          isTarget ? "is-target" : "",
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

      </div>

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

        .bb-dmg-hud {
          position: absolute;
          left: 0;
          right: 0;
          top: -10px;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          pointer-events: none;
          z-index: 60;
        }

        /* Allow the same dmg float to be used above the card */
        .bb-dmgfloat--above {
          white-space: nowrap;
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


        /* Step 2: readability highlights (2D only; safe for TG iOS WebView) */
        .bb-card.is-attacker:not(.is-dead) {
          box-shadow:
            0 0 0 2px rgba(51, 241, 255, 0.32),
            0 0 14px rgba(48, 230, 255, 0.22);
        }
        .bb-card.is-target:not(.is-dead) {
          outline: 2px solid rgba(255, 80, 140, 0.38);
          outline-offset: 2px;
          box-shadow:
            0 0 0 2px rgba(255, 80, 140, 0.22),
            0 0 18px rgba(255, 80, 140, 0.18);
          animation: bbTargetPulse 0.55s ease-in-out 1;
        }
        @keyframes bbTargetPulse {
          0% { filter: brightness(1); }
          50% { filter: brightness(1.12); }
          100% { filter: brightness(1); }
        }

        }
      `}</style>
        </div>
      </div>

    );
  }

  if (!isTelegramEnv) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 pb-24">
{!HIDE_VISUAL_DEBUG && (
      <div
        style={{
          position: "fixed",
          top: 10,
          left: 10,
          zIndex: 2147483647,
          pointerEvents: "auto",
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <button
          type="button"
          onClick={() => setUiDebug((v) => !v)}
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.22)",
            background: "rgba(0,0,0,0.70)",
            color: "white",
            fontSize: 12,
            fontWeight: 900,
            letterSpacing: 0.3,
          }}
        >
          DBG {uiDebugOn ? "ON" : "OFF"}
        </button>
        <div
          style={{
            padding: "6px 8px",
            borderRadius: 10,
            background: "rgba(255,0,180,0.75)",
            color: "white",
            fontSize: 11,
            fontWeight: 900,
            letterSpacing: 0.2,
          }}
        >
          DBG_V11
        </div>
      </div>
)}

      {!HIDE_VISUAL_DEBUG ? <BattleFxLayer events={fxEvents} /> : null}

      {/* Debug UI rendered via portal to avoid being clipped by transformed/overflow-hidden ancestors. */}
      {/* Debug UI overlay (no portal) */}
      {!HIDE_VISUAL_DEBUG && (
        <div
          style={{
            position: "fixed",
            right: 12,
            bottom: 12,
            zIndex: 2147483647,
            pointerEvents: "auto",
          }}
        >
          <button
            type="button"
            onClick={() => setUiDebug((v) => !v)}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.22)",
              background: "rgba(0,0,0,0.7)",
              color: "white",
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: 0.3,
              pointerEvents: "auto",
              boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
            }}
          >
            DBG {uiDebugOn ? "ON" : "OFF"}
          </button>
        </div>
      )}

      {!HIDE_VISUAL_DEBUG && isArenaDebug ? (
        <div
          style={{
            position: "fixed",
            left: 12,
            bottom: 12,
            zIndex: 2147483647,
            minWidth: 220,
            maxWidth: 320,
            padding: 10,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.18)",
            background: "rgba(0,0,0,0.68)",
            color: "white",
            fontSize: 12,
            lineHeight: "14px",
            pointerEvents: "auto",
            whiteSpace: "pre-wrap",
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 4 }}>Layout Debug</div>
          {debugCover ? (
            <>
              <div>arenaW/arenaH: {debugCover.arenaW}×{debugCover.arenaH}</div>
              <div>
                drawnW/drawnH: {Math.round(debugCover.drawnW)}×{Math.round(debugCover.drawnH)}
              </div>
              <div>
                offsetX/Y: {Math.round(debugCover.offsetX)},{Math.round(debugCover.offsetY)}
              </div>
{!HIDE_VISUAL_DEBUG && (
              <div>scale: {debugCover.scale.toFixed(4)}</div>
)}
              <div style={{ marginTop: 6, opacity: 0.9 }}>
                Tap arena → nx/ny: {dbgClick ? `${dbgClick.nx.toFixed(4)} / ${dbgClick.ny.toFixed(4)}` : "—"}
              </div>
            </>
          ) : (
            <div style={{ opacity: 0.85 }}>debugCover: —</div>
          )}
        </div>
      ) : null}

{uiDebugOn && (
        <div
          className="bb-debug-hud"
          style={{
            position: "fixed",
            left: 12,
            bottom: 12,
            zIndex: 999998,
            maxWidth: 360,
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.16)",
            background: "rgba(0,0,0,0.55)",
            color: "white",
            fontSize: 12,
            lineHeight: "16px",
            pointerEvents: "none",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Layout Debug</div>
          {debugCover ? (
            <>
              <div>
                arenaW/arenaH: {debugCover.arenaW}×{debugCover.arenaH}
              </div>
              <div>
                drawnW/drawnH: {Math.round(debugCover.drawnW)}×{Math.round(debugCover.drawnH)}
              </div>
              <div>scale: {debugCover.scale.toFixed(4)}</div>
              <div>
                offsetX/offsetY: {Math.round(debugCover.offsetX)}/{Math.round(debugCover.offsetY)}
              </div>
            </>
          ) : (
            <div style={{ opacity: 0.8 }}>arena box: not ready</div>
          )}
          <div style={{ marginTop: 6, opacity: 0.9 }}>
            Tap on arena → you&#39;ll get nx/ny.
          </div>
          {dbgClick ? (
            <div style={{ marginTop: 6 }}>
              <div>
                click px: {Math.round(dbgClick.x)}, {Math.round(dbgClick.y)}
              </div>
              <div>
                click n: {dbgClick.nx.toFixed(4)}, {dbgClick.ny.toFixed(4)}
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 6, opacity: 0.75 }}>no click yet</div>
          )}
        </div>
      )}


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
{!HIDE_VISUAL_DEBUG && (
      <div
        style={{
          position: "fixed",
          top: 10,
          left: 10,
          zIndex: 2147483647,
          pointerEvents: "auto",
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <button
          type="button"
          onClick={() => setUiDebug((v) => !v)}
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.22)",
            background: "rgba(0,0,0,0.70)",
            color: "white",
            fontSize: 12,
            fontWeight: 900,
            letterSpacing: 0.3,
          }}
        >
          DBG {uiDebugOn ? "ON" : "OFF"}
        </button>
        <div
          style={{
            padding: "6px 8px",
            borderRadius: 10,
            background: "rgba(255,0,180,0.75)",
            color: "white",
            fontSize: 11,
            fontWeight: 900,
            letterSpacing: 0.2,
          }}
        >
          DBG_V11
        </div>
      </div>
)}

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
{!HIDE_VISUAL_DEBUG && (
      <div
        style={{
          position: "fixed",
          top: 10,
          left: 10,
          zIndex: 2147483647,
          pointerEvents: "auto",
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <button
          type="button"
          onClick={() => setUiDebug((v) => !v)}
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.22)",
            background: "rgba(0,0,0,0.70)",
            color: "white",
            fontSize: 12,
            fontWeight: 900,
            letterSpacing: 0.3,
          }}
        >
          DBG {uiDebugOn ? "ON" : "OFF"}
        </button>
        <div
          style={{
            padding: "6px 8px",
            borderRadius: 10,
            background: "rgba(255,0,180,0.75)",
            color: "white",
            fontSize: 11,
            fontWeight: 900,
            letterSpacing: 0.2,
          }}
        >
          DBG_V11
        </div>
      </div>
)}

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
{!HIDE_VISUAL_DEBUG && (
      <div
        style={{
          position: "fixed",
          top: 10,
          left: 10,
          zIndex: 2147483647,
          pointerEvents: "auto",
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <button
          type="button"
          onClick={() => setUiDebug((v) => !v)}
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.22)",
            background: "rgba(0,0,0,0.70)",
            color: "white",
            fontSize: 12,
            fontWeight: 900,
            letterSpacing: 0.3,
          }}
        >
          DBG {uiDebugOn ? "ON" : "OFF"}
        </button>
        <div
          style={{
            padding: "6px 8px",
            borderRadius: 10,
            background: "rgba(255,0,180,0.75)",
            color: "white",
            fontSize: 11,
            fontWeight: 900,
            letterSpacing: 0.2,
          }}
        >
          DBG_V11
        </div>
      </div>
)}

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
{!HIDE_VISUAL_DEBUG && (
      <div
        style={{
          position: "fixed",
          top: 10,
          left: 10,
          zIndex: 2147483647,
          pointerEvents: "auto",
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <button
          type="button"
          onClick={() => setUiDebug((v) => !v)}
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.22)",
            background: "rgba(0,0,0,0.70)",
            color: "white",
            fontSize: 12,
            fontWeight: 900,
            letterSpacing: 0.3,
          }}
        >
          DBG {uiDebugOn ? "ON" : "OFF"}
        </button>
        <div
          style={{
            padding: "6px 8px",
            borderRadius: 10,
            background: "rgba(255,0,180,0.75)",
            color: "white",
            fontSize: 11,
            fontWeight: 900,
            letterSpacing: 0.2,
          }}
        >
          DBG_V11
        </div>
      </div>
)}

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
      {/* DBG_V11: always-visible toggle (Telegram + browser). Should be visible during battle. */}
{!HIDE_VISUAL_DEBUG && (
      <div
        style={{
          position: "fixed",
          top: 10,
          left: 10,
          zIndex: 2147483647,
          pointerEvents: "auto",
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <button
          type="button"
          onClick={() => setUiDebug((v) => !v)}
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.22)",
            background: "rgba(0,0,0,0.70)",
            color: "white",
            fontSize: 12,
            fontWeight: 900,
            letterSpacing: 0.3,
            boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
          }}
        >
          DBG {uiDebugOn ? "ON" : "OFF"}
        </button>
        <div
          style={{
            padding: "6px 8px",
            borderRadius: 10,
            background: "rgba(255,0,180,0.75)",
            color: "white",
            fontSize: 11,
            fontWeight: 900,
            letterSpacing: 0.2,
          }}
        >
          DBG_V11
        </div>
      </div>
)}

      {!HIDE_VISUAL_DEBUG ? <BattleFxLayer events={fxEvents} /> : null}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes flipIn {
          0% { transform: rotateY(0deg) scale(0.98); }
          55% { transform: rotateY(90deg) scale(1.02); }
          100% { transform: rotateY(180deg) scale(1); }
        }

        /* iOS Telegram WebView: avoid 3D rotateY flip (can "stick" and cause random spinning cards).
           We switch reveal from 3D flip to simple face crossfade only on iOS. */
        
                /* iOS TG WebView anti-spin override (JS adds .bb-ios on <html>) */
        .bb-ios .bb-card {
          perspective: none !important;
          transform-style: flat !important;
          -webkit-transform-style: flat !important;
        }
        .bb-ios .bb-card-inner {
          transform: none !important;
          transition: none !important;
          transform-style: flat !important;
          -webkit-transform-style: flat !important;
        }
        .bb-ios .bb-card.is-revealed,
        .bb-ios .bb-card.is-revealed * {
          animation: none !important;
        }
        .bb-ios .bb-card * {
          backface-visibility: visible !important;
          -webkit-backface-visibility: visible !important;
        }
        /* Kill any effect classes that might use rotate/3D on iOS */
        .bb-ios .bb-card.is-hit .bb-card-inner,
        .bb-ios .bb-card.is-damage .bb-card-inner,
        .bb-ios .bb-card.is-attack-to .bb-card-inner,
        .bb-ios .bb-card.is-attack-from .bb-card-inner {
          transform: none !important;
        }
        /* iOS reveal becomes simple crossfade (no rotateY) */
        .bb-ios .bb-back,
        .bb-ios .bb-front {
          transition: opacity 220ms ease-out;
        }
        .bb-ios .bb-back { opacity: 1; }
        .bb-ios .bb-front { opacity: 0; }
        .bb-ios .bb-card.is-revealed .bb-back { opacity: 0; }
        .bb-ios .bb-card.is-revealed .bb-front { opacity: 1; }

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

        .round-banner-wrap {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 7;
          pointer-events: none;
        }

        .round-banner {
          position: relative;
          padding: 12px 14px;
          border-radius: 18px;
          border: 1px solid rgba(255,255,255,0.20);
          background: rgba(0,0,0,0.42);
          backdrop-filter: blur(10px);
          width: calc(100% - 28px);
          max-width: 520px;
          box-sizing: border-box;
          text-align: center;
          box-shadow: 0 12px 40px rgba(0,0,0,0.35);
          animation: bannerIn 320ms var(--ease-out) both;
          pointer-events: none;
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
          `,
        }}
      />

      {/* DEBUG TOGGLE (hidden in clean mode) */}
      {!HIDE_VISUAL_DEBUG && (
        <button
          type="button"
          onClick={() => setUiDebug((v) => !v)}
          style={{
            position: "fixed",
            top: 10,
            left: 10,
            zIndex: 2147483647,
            pointerEvents: "auto",
            padding: "6px 10px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.25)",
            background: "rgba(0,0,0,0.55)",
            color: "rgba(255,255,255,0.92)",
            fontSize: 12,
            fontWeight: 900,
            letterSpacing: 1,
          }}
        >
          DBG
        </button>
      )}

      {/* TEST button removed: lunge is played from real battle timeline events */}

      {!HIDE_VISUAL_DEBUG && uiDebugOn && (
        <div
          style={{
            position: "fixed",
            left: debugCover ? Math.round(debugCover.arenaLeft + debugCover.offsetX + debugCover.drawnW / 2) : "50%",
            top: debugCover ? Math.round(debugCover.arenaTop + debugCover.offsetY + debugCover.drawnH / 2 + 40) : "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 2147483647,
            pointerEvents: "none",
            padding: "6px 8px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.14)",
            background: "rgba(0,0,0,0.55)",
            color: "rgba(255,255,255,0.92)",
            fontSize: 10,
            lineHeight: 1.2,
            width: "min(260px, calc(100vw - 16px))",
            opacity: 0.85,
          }}
        >
          <div style={{ fontWeight: 900, letterSpacing: 0.8, marginBottom: 4 }}>LAYOUT DEBUG</div>
          <div style={{ opacity: 0.9 }}>Tap on arena to capture nx/ny.</div>
          <div style={{ marginTop: 6, opacity: 0.9 }}>
            {dbgClick
              ? `click nx=${dbgClick.nx.toFixed(4)} ny=${dbgClick.ny.toFixed(4)} (x=${Math.round(dbgClick.x)} y=${Math.round(dbgClick.y)})`
              : "click: —"}
          </div>
          {debugCover && (
            <div style={{ marginTop: 8, opacity: 0.9 }}>
              arena {Math.round(debugCover.arenaW)}×{Math.round(debugCover.arenaH)} scale {debugCover.scale.toFixed(3)}
            </div>
          )}
        </div>
      )}

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

        <section ref={arenaRef as any} onPointerDownCapture={onArenaPointerDownCapture} className={["board", "arena", boardFxClass].join(" ")}>

          {isArenaDebug && (
            <div
              style={{
                position: "fixed",
                left: 12,
                bottom: 12,
                zIndex: 99999,
                padding: "10px 12px",
                borderRadius: 12,
                background: "rgba(0,0,0,0.55)",
                color: "rgba(255,255,255,0.92)",
                fontSize: 12,
                lineHeight: 1.25,
                maxWidth: 360,
                pointerEvents: "none",
                whiteSpace: "pre-wrap",
              }}
            >
              {"layoutdebug: tap arena to read nx/ny\n" +
                (dbgClick
                  ? `click nx=${dbgClick.nx.toFixed(4)} ny=${dbgClick.ny.toFixed(4)} (x=${Math.round(dbgClick.x)} y=${Math.round(dbgClick.y)})`
                  : "click: —")}
            </div>
          )}

          <AttackArrowOverlay />

          {isGridDebug && debugCover && (
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 50,
                pointerEvents: "none",
                mixBlendMode: "normal",
              }}
            >
              <svg
                width="100%"
                height="100%"
                viewBox={`0 0 ${debugCover.arenaW} ${debugCover.arenaH}`}
                preserveAspectRatio="none"
                style={{ display: "block" }}
              >
                {/* Drawn image rect */}
                <rect
                  x={debugCover.offsetX}
                  y={debugCover.offsetY}
                  width={debugCover.drawnW}
                  height={debugCover.drawnH}
                  fill="none"
                  stroke="rgba(0,255,255,0.55)"
                  strokeWidth={1}
                />

                {/* Grid lines in normalized space (0..1) */}
                {Array.from({ length: 11 }).map((_, i) => {
                  const t = i / 10;
                  const x = debugCover.offsetX + t * debugCover.drawnW;
                  const y = debugCover.offsetY + t * debugCover.drawnH;
                  return (
                    <g key={i}>
                      <line x1={x} y1={debugCover.offsetY} x2={x} y2={debugCover.offsetY + debugCover.drawnH} stroke="rgba(255,255,255,0.16)" strokeWidth={1} />
                      <line x1={debugCover.offsetX} y1={y} x2={debugCover.offsetX + debugCover.drawnW} y2={y} stroke="rgba(255,255,255,0.16)" strokeWidth={1} />
                      {i !== 0 && i !== 10 && (
                        <>
                          <text x={x + 3} y={debugCover.offsetY + 12} fontSize={10} fill="rgba(255,255,255,0.65)">{t.toFixed(1)}</text>
                          <text x={debugCover.offsetX + 3} y={y - 3} fontSize={10} fill="rgba(255,255,255,0.65)">{t.toFixed(1)}</text>
                        </>
                      )}
                    </g>
                  );
                })}

                {/* Center cross */}
                {(() => {
                  const cx = debugCover.offsetX + 0.5 * debugCover.drawnW;
                  const cy = debugCover.offsetY + 0.5 * debugCover.drawnH;
                  return (
                    <g>
                      <line x1={cx - 14} y1={cy} x2={cx + 14} y2={cy} stroke="rgba(0,255,255,0.8)" strokeWidth={2} />
                      <line x1={cx} y1={cy - 14} x2={cx} y2={cy + 14} stroke="rgba(0,255,255,0.8)" strokeWidth={2} />
                      <text x={cx + 8} y={cy - 8} fontSize={12} fill="rgba(0,255,255,0.95)">CENTER</text>
                    </g>
                  );
                })()}

                {/* Slot markers */}
                <g>
                  <circle cx={debugCover.topX} cy={debugCover.topY} r={8} fill="none" stroke="rgba(255,0,255,0.95)" strokeWidth={2} />
                  <text x={debugCover.topX + 12} y={debugCover.topY + 4} fontSize={12} fill="rgba(255,0,255,0.95)">TOP RING</text>

                  <circle cx={debugCover.botX} cy={debugCover.botY} r={8} fill="none" stroke="rgba(0,255,0,0.95)" strokeWidth={2} />
                  <text x={debugCover.botX + 12} y={debugCover.botY + 4} fontSize={12} fill="rgba(0,255,0,0.95)">BOT RING</text>
                </g>

                {/* Click marker */}
                {dbgClick && (
                  <g>
                    <circle cx={dbgClick.x} cy={dbgClick.y} r={7} fill="none" stroke="rgba(255,255,0,0.95)" strokeWidth={2} />
                    <text x={dbgClick.x + 10} y={dbgClick.y - 10} fontSize={12} fill="rgba(255,255,0,0.95)">
                      {`nx=${dbgClick.nx.toFixed(4)} ny=${dbgClick.ny.toFixed(4)}`}
                    </text>
                  </g>
                )}
              </svg>

              {/* Debug stats (inside arena, not viewport) */}
              <div
                style={{
                  position: "absolute",
                  left: 10,
                  top: 10,
                  padding: "8px 10px",
                  borderRadius: 10,
                  background: "rgba(0,0,0,0.55)",
                  color: "rgba(255,255,255,0.92)",
                  fontSize: 12,
                  lineHeight: 1.25,
                  whiteSpace: "pre",
                }}
              >
                {`arena ${Math.round(debugCover.arenaW)}×${Math.round(debugCover.arenaH)}\n` +
                  `drawn ${Math.round(debugCover.drawnW)}×${Math.round(debugCover.drawnH)}\n` +
                  `off ${Math.round(debugCover.offsetX)},${Math.round(debugCover.offsetY)}  scale ${debugCover.scale.toFixed(3)}`}
              </div>
            </div>
          )}

          {/* FX overlay (independent from card DOM) */}
          <div className="bb-fx-layer" aria-hidden="true">
            {fxBursts.map((b) => (
              <div
                key={b.id}
                className={`bb-fx-burst bb-fx-burst--${b.kind}`}
                style={{
                  left: b.x,
                  top: b.y,
                  width: b.size,
                  height: b.size,
                }}
              >
                {b.kind === "death" && (
                  <div
                    className="bb-fx-burst__atlas"
                    style={{
                      // death_burst_strip.png is 194x59 (3 frames with padding)
                      ["--bb-strip-scale" as any]: (b.size / 59).toFixed(4),
                    }}
                  />
                )}
              </div>
            ))}
          </div>

          {isArenaDebug && debugCover && (
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
          <svg className="atk-overlay" width="100%" height="100%">
            <defs>
              {/* Turquoise glow filter: Gaussian blur + color matrix + merge core+glow */}
              <filter id="atkGlow" x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur"/>
                <feColorMatrix 
                  in="blur"
                  type="matrix"
                  values="0 0 0 0 0
                          0 1 0 0 0
                          0.82 0 0.89 0 0
                          0 0 0 0.85 0"
                  result="turquoiseGlow"
                />
                <feMerge>
                  <feMergeNode in="turquoiseGlow"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
              <marker
                id="atkArrow"
                markerWidth="10"
                markerHeight="10"
                refX="9"
                refY="5"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(0,255,210,0.97)" />
              </marker>
            </defs>
            {attackCurves.map((c) => (
              <g key={c.key}>
                <path
                  d={c.d}
                  style={{
                    filter: 'url(#atkGlow)'
                  }}
                  stroke="rgba(0,255,210,0.94)"
                  strokeWidth={9}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d={c.d}
                  stroke="rgba(0,255,210,1)"
                  strokeWidth={3.2}
                  fill="none"
                  markerEnd="url(#atkArrow)"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
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
            <div className="round-banner-wrap" aria-hidden="true">
              <div
                key={roundBanner.tick}
                className={["round-banner", roundBanner.tone === "p1" ? "tone-p1" : roundBanner.tone === "p2" ? "tone-p2" : "tone-draw"].join(" ")}
              >
                <div className="title">ROUND END</div>
                <div className="sub">{roundBanner.text}</div>
              </div>
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
                    slotKey={`${enemySide}:${i}`}
                    unitInstanceId={s.unit?.instanceId ?? (lastInstBySlotRef.current[`${enemySide}:${i}`]) ?? null}
                    attackFx={(() => { const inst = s.unit?.instanceId ?? (lastInstBySlotRef.current[`${enemySide}:${i}`]); return inst ? attackFxByInstance[inst] : undefined; })()}
                    spawnFx={(() => { const inst = s.unit?.instanceId ?? (lastInstBySlotRef.current[`${enemySide}:${i}`]); return inst ? spawnFxByInstance[inst] : undefined; })()}
                    damageFx={(() => { const inst = s.unit?.instanceId ?? (lastInstBySlotRef.current[`${enemySide}:${i}`]); return inst ? damageFxByInstance[inst] : undefined; })()}
                    isDying={(() => { const inst = s.unit?.instanceId ?? (lastInstBySlotRef.current[`${enemySide}:${i}`]); return !!(inst && deathFxByInstance.has(inst)); })()}
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
                    slotKey={`${youSide}:${i}`}
                    unitInstanceId={s.unit?.instanceId ?? (lastInstBySlotRef.current[`${youSide}:${i}`]) ?? null}
                    attackFx={(() => { const inst = s.unit?.instanceId ?? (lastInstBySlotRef.current[`${youSide}:${i}`]); return inst ? attackFxByInstance[inst] : undefined; })()}
                    spawnFx={(() => { const inst = s.unit?.instanceId ?? (lastInstBySlotRef.current[`${youSide}:${i}`]); return inst ? spawnFxByInstance[inst] : undefined; })()}
                    damageFx={(() => { const inst = s.unit?.instanceId ?? (lastInstBySlotRef.current[`${youSide}:${i}`]); return inst ? damageFxByInstance[inst] : undefined; })()}
                    isDying={(() => { const inst = s.unit?.instanceId ?? (lastInstBySlotRef.current[`${youSide}:${i}`]); return !!(inst && deathFxByInstance.has(inst)); })()}
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
  // IMPORTANT: Fix React hydration crash (#418) in Telegram WebView.
  // Even though this file is a Client Component, Next.js still pre-renders it on the server.
  // Any client-only differences (viewport/theme, timers, DOM measurements, etc.) can cause
  // hydration mismatch and crash. We make the battle page render only after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 pb-24">
        <div className="w-full max-w-md ui-card p-5 text-center">
          <div className="text-sm font-semibold">Загрузка…</div>
          <div className="mt-2 text-sm ui-subtle">Открываю поле боя.</div>
          <div className="mt-4 ui-progress">
            <div className="w-1/3 opacity-70 animate-pulse" />
          </div>
        </div>
      </main>
    );
  }

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