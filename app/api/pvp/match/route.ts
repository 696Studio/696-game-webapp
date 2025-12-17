export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type MatchRow = {
  id: string;
  mode: string | null;
  p1_user_id: string;
  p2_user_id: string;
  winner_user_id: string | null;
  created_at: string;
  status: string;
  log: any;
  rewards_applied: boolean;
};

type CardMeta = {
  id: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  base_power: number;
  // optional extras (can come from log.p1_cards_full)
  hp?: number;
  initiative?: number;
  ability_id?: string | null;
  ability_params?: any;
  tags?: string[];
  name?: string;
  image_url?: string | null;
};

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
  if (raw && typeof raw === "object") return Object.values(raw).map((x) => String(x));
  return [];
}

async function loadCardsMeta(cardIds: string[]): Promise<Map<string, CardMeta>> {
  const uniq = Array.from(new Set(cardIds.filter(Boolean).map(String)));
  const map = new Map<string, CardMeta>();
  if (uniq.length === 0) return map;

  // IMPORTANT: don't select columns that may not exist yet (hp/initiative/ability/tags)
  const { data, error } = await supabaseAdmin
    .from("cards")
    .select("id, rarity, base_power, name_ru, name_en, image_url")
    .in("id", uniq);

  if (error) throw new Error(error.message);

  for (const c of data ?? []) {
    const id = String((c as any).id);
    map.set(id, {
      id,
      rarity: (String((c as any).rarity || "common").toLowerCase() as any) ?? "common",
      base_power: Number((c as any).base_power || 0),
      name:
        ((c as any).name_ru && String((c as any).name_ru).trim()) ||
        ((c as any).name_en && String((c as any).name_en).trim()) ||
        undefined,
      image_url: (c as any).image_url ?? null,
    });
  }

  return map;
}

function buildCardsFull(idsAny: any, meta: Map<string, CardMeta>): CardMeta[] {
  const ids = toStringArray(idsAny);
  return ids.map((id) => {
    const m = meta.get(id);
    return (
      m ?? {
        id,
        rarity: "common",
        base_power: 0,
        name: id ? id : "Card",
        image_url: null,
      }
    );
  });
}

/** deterministic hash -> uint32 */
function hash32(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 rng */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickNDeterministic(ids: string[], n: number, rand: () => number): string[] {
  const pool = ids.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, Math.max(0, Math.min(n, pool.length)));
}

function sumPower(cards: CardMeta[]): number {
  let s = 0;
  for (const c of cards) s += Number(c?.base_power ?? 0);
  return Math.max(0, Math.round(s));
}

/**
 * Debug simulation: produces a timeline compatible with Battle UI:
 * round_start -> reveal -> score -> round_end (x3)
 *
 * Needs decks in log:
 * - log.p1_cards / log.p2_cards (preferred, from enqueue)
 * - fallback: log.p1_deck / log.p2_deck
 */
async function simulateTimelineV0(params: { matchId: string; logObj: any }) {
  const { matchId, logObj } = params;

  const p1All = toStringArray(logObj?.p1_cards ?? logObj?.p1_deck ?? logObj?.p1 ?? []);
  const p2All = toStringArray(logObj?.p2_cards ?? logObj?.p2_deck ?? logObj?.p2 ?? []);

  if (!p1All.length || !p2All.length) {
    return {
      timeline: null as any,
      rounds: null as any,
      duration_sec: 30,
      warning:
        "simulate=1 requested, but log.p1_cards/log.p2_cards not found. Ensure /api/pvp/enqueue writes p1_cards/p2_cards (expanded 20 ids).",
    };
  }

  const seed = hash32(String(matchId));
  const rand = mulberry32(seed);

  const needIds = [...p1All, ...p2All];
  const meta = await loadCardsMeta(needIds);

  const timeline: any[] = [];
  const rounds: any[] = [];

  const roundCount = 3;
  const secPerRound = 10;

  let p1Wins = 0;
  let p2Wins = 0;

  for (let r = 1; r <= roundCount; r++) {
    const t0 = (r - 1) * secPerRound;

    timeline.push({ t: t0 + 0.0, type: "round_start", round: r });

    const p1Pick = pickNDeterministic(p1All, 5, rand);
    const p2Pick = pickNDeterministic(p2All, 5, rand);

    const p1Full = buildCardsFull(p1Pick, meta);
    const p2Full = buildCardsFull(p2Pick, meta);

    timeline.push({
      t: t0 + 2.0,
      type: "reveal",
      round: r,
      p1_cards: p1Pick,
      p2_cards: p2Pick,
      p1_cards_full: p1Full,
      p2_cards_full: p2Full,
    });

    const p1Score = sumPower(p1Full);
    const p2Score = sumPower(p2Full);

    timeline.push({ t: t0 + 5.5, type: "score", round: r, p1: p1Score, p2: p2Score });

    let winner: "p1" | "p2" | "draw" = "draw";
    if (p1Score > p2Score) {
      winner = "p1";
      p1Wins++;
    } else if (p2Score > p1Score) {
      winner = "p2";
      p2Wins++;
    }

    timeline.push({ t: t0 + 8.5, type: "round_end", round: r, winner });

    rounds.push({
      p1: { total: p1Score },
      p2: { total: p2Score },
      winner,
    });
  }

  let matchWinner: "p1" | "p2" | "draw" = "draw";
  if (p1Wins > p2Wins) matchWinner = "p1";
  else if (p2Wins > p1Wins) matchWinner = "p2";

  return {
    timeline,
    rounds,
    duration_sec: roundCount * secPerRound,
    match_winner: matchWinner,
    warning: null as any,
  };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const simulateFlag = url.searchParams.get("simulate");
    const simulate = simulateFlag === "1" || simulateFlag === "true";

    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const { data: match, error } = await supabaseAdmin
      .from("pvp_matches")
      .select("id,mode,p1_user_id,p2_user_id,winner_user_id,log,status,created_at,rewards_applied")
      .eq("id", id)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!match) return NextResponse.json({ match: null });

    const logObj = (parseMaybeJson((match as any).log) ?? {}) as any;

    // timeline may be jsonb array OR stringified json
    const timelineParsed = parseMaybeJson(logObj?.timeline);
    const timelineExisting = Array.isArray(timelineParsed) ? timelineParsed : null;

    // If no timeline — keep read-only by default, BUT allow debug simulation.
    if (!timelineExisting) {
      if (!simulate) {
        return NextResponse.json({
          match: { ...(match as any), log: logObj },
          warning:
            "match.log.timeline is missing. Add ?simulate=1 for debug timeline OR ensure /api/pvp/enqueue writes expanded timeline.",
        });
      }

      const sim = await simulateTimelineV0({
        matchId: String((match as any).id),
        logObj,
      });

      if (!sim.timeline) {
        return NextResponse.json({
          match: { ...(match as any), log: logObj },
          warning: sim.warning || "simulate=1 failed",
        });
      }

      const newLog = {
        ...logObj,
        duration_sec: sim.duration_sec,
        timeline: sim.timeline,
        rounds: sim.rounds,
        match_winner: sim.match_winner,
        simulated: true,
      };

      return NextResponse.json({
        match: { ...(match as any), log: newLog },
        warning: "DEBUG: simulated timeline (not persisted). Your enqueue should persist real timeline.",
      });
    }

    // Ensure reveal contains cards_full for UI
    const timeline = timelineExisting as any[];

    const needMetaIds: string[] = [];
    for (const e of timeline) {
      if (!e || e.type !== "reveal") continue;

      const hasP1Full = Array.isArray(e.p1_cards_full) && e.p1_cards_full.length > 0;
      const hasP2Full = Array.isArray(e.p2_cards_full) && e.p2_cards_full.length > 0;

      if (!hasP1Full) for (const cid of toStringArray(e.p1_cards)) needMetaIds.push(cid);
      if (!hasP2Full) for (const cid of toStringArray(e.p2_cards)) needMetaIds.push(cid);
    }

    if (needMetaIds.length) {
      const meta = await loadCardsMeta(needMetaIds);
      for (const e of timeline) {
        if (!e || e.type !== "reveal") continue;

        const hasP1Full = Array.isArray(e.p1_cards_full) && e.p1_cards_full.length > 0;
        const hasP2Full = Array.isArray(e.p2_cards_full) && e.p2_cards_full.length > 0;

        if (!hasP1Full) e.p1_cards_full = buildCardsFull(e.p1_cards, meta);
        if (!hasP2Full) e.p2_cards_full = buildCardsFull(e.p2_cards, meta);
      }
    }

    return NextResponse.json({
      match: { ...(match as any), log: { ...logObj, timeline } },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
