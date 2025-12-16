import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { simulateMatch, type Card as SimCard } from "@/lib/pvp/sim";

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

function isEmptyLog(log: any) {
  const obj = parseMaybeJson(log);
  if (obj == null) return true;
  if (typeof obj !== "object") return true;
  if (Array.isArray(obj)) return obj.length === 0;
  return Object.keys(obj).length === 0;
}

async function loadDeckForUser(userId: string): Promise<SimCard[]> {
  const { data: deck, error: deckErr } = await supabaseAdmin
    .from("pvp_decks")
    .select("id, pvp_deck_cards(card_id,copies)")
    .eq("user_id", userId)
    .maybeSingle();

  if (deckErr) throw new Error(deckErr.message);

  const rows: Array<{ card_id: string; copies: number }> =
    (deck as any)?.pvp_deck_cards ?? [];

  if (!deck || rows.length === 0) return [];

  const ids = rows.map((r) => String(r.card_id));

  const { data: cards, error: cardsErr } = await supabaseAdmin
    .from("cards")
    .select("id, rarity, base_power")
    .in("id", ids);

  if (cardsErr) throw new Error(cardsErr.message);

  const byId = new Map((cards ?? []).map((c: any) => [String(c.id), c]));

  const out: SimCard[] = [];
  for (const r of rows) {
    const c: any = byId.get(String(r.card_id));
    if (!c) continue;

    const copies = Math.max(1, Math.floor(Number(r.copies || 1)));
    for (let i = 0; i < copies; i++) {
      out.push({
        id: String(c.id),
        rarity: (String(c.rarity || "common").toLowerCase() as any) ?? "common",
        base_power: Number(c.base_power || 0),
      });
    }
  }

  return out;
}

async function loadCardsMeta(cardIds: string[]): Promise<Map<string, CardMeta>> {
  const uniq = Array.from(new Set(cardIds.filter(Boolean).map(String)));
  const map = new Map<string, CardMeta>();
  if (uniq.length === 0) return map;

  const { data, error } = await supabaseAdmin
    .from("cards")
    .select("id, rarity, base_power, name_ru, name_en, image_url")
    .in("id", uniq);

  if (error) throw new Error(error.message);

  for (const c of data ?? []) {
    const id = String((c as any).id);
    const rarity = (String((c as any).rarity || "common").toLowerCase() as any) ?? "common";
    const base_power = Number((c as any).base_power || 0);
    const name =
      (c as any).name_ru ??
      (c as any).name_en ??
      undefined;

    map.set(id, {
      id,
      rarity,
      base_power,
      name,
      image_url: (c as any).image_url ?? null,
    });
  }

  return map;
}

function buildCardsFull(ids: any, meta: Map<string, CardMeta>): CardMeta[] {
  const arr = Array.isArray(ids) ? ids : [];
  return arr.map((x) => {
    const id = String(x ?? "");
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

function buildTimelineFromSim(sim: any, durationSec: number, meta: Map<string, CardMeta>) {
  const rounds = Array.isArray(sim?.rounds) ? sim.rounds : [];
  const n = Math.max(1, rounds.length);

  const padStart = 3;
  const padEnd = 4;
  const usable = Math.max(10, durationSec - padStart - padEnd);
  const perRound = usable / n;

  const timeline: any[] = [];

  for (let i = 0; i < n; i++) {
    const r = rounds[i];
    const round = i + 1;

    const t0 = Math.floor(padStart + perRound * i);
    const tReveal = Math.floor(t0 + perRound * 0.25);
    const tScore = Math.floor(t0 + perRound * 0.55);
    const tEnd = Math.floor(t0 + perRound * 0.85);

    const p1Ids = r?.p1?.cards ?? [];
    const p2Ids = r?.p2?.cards ?? [];

    timeline.push({ t: t0, type: "round_start", round });

    timeline.push({
      t: tReveal,
      type: "reveal",
      round,
      p1_cards: p1Ids,
      p2_cards: p2Ids,

      // ✅ вот это нужно твоему UI
      p1_cards_full: buildCardsFull(p1Ids, meta),
      p2_cards_full: buildCardsFull(p2Ids, meta),
    });

    timeline.push({
      t: tScore,
      type: "score",
      round,
      p1: r?.p1?.total ?? 0,
      p2: r?.p2?.total ?? 0,
    });

    timeline.push({
      t: tEnd,
      type: "round_end",
      round,
      winner: r?.winner ?? "draw",
    });
  }

  timeline.push({
    t: Math.max(0, durationSec - 2),
    type: "match_end",
    winner: sim?.winner ?? "draw",
  });

  return timeline.sort((a, b) => Number(a.t) - Number(b.t));
}

function pickWinnerUserId(sim: any, match: MatchRow) {
  const w = sim?.winner;
  if (w === "p1") return match.p1_user_id;
  if (w === "p2") return match.p2_user_id;
  return null;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    // 1) load match
    const { data: match, error } = await supabaseAdmin
      .from("pvp_matches")
      .select(
        "id,mode,p1_user_id,p2_user_id,winner_user_id,log,status,created_at,rewards_applied"
      )
      .eq("id", id)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!match) return NextResponse.json({ match: null });

    // 2) if log exists -> return
    const logObj = parseMaybeJson((match as any)?.log);
    const hasTimeline = Array.isArray(logObj?.timeline);
    if (!isEmptyLog(logObj) && hasTimeline) {
      return NextResponse.json({ match: { ...(match as any), log: logObj } });
    }

    // 3) generate deterministic sim by matchId
    const durationSec = 90;

    const [p1Deck, p2Deck] = await Promise.all([
      loadDeckForUser((match as any).p1_user_id),
      loadDeckForUser((match as any).p2_user_id),
    ]);

    const sim = simulateMatch(String(id), p1Deck, p2Deck);

    // ✅ собираем все id карт из sim, чтобы одним запросом достать мету
    const allIds: string[] = [];
    for (const r of sim?.rounds ?? []) {
      for (const cid of r?.p1?.cards ?? []) allIds.push(String(cid));
      for (const cid of r?.p2?.cards ?? []) allIds.push(String(cid));
    }
    const meta = await loadCardsMeta(allIds);

    const timeline = buildTimelineFromSim(sim, durationSec, meta);

    const log = {
      version: 2,
      duration_sec: durationSec,
      seed: String(id),
      rounds: sim.rounds,
      winner: sim.winner,
      timeline,
    };

    const winnerUserId = pickWinnerUserId(sim, match as any);

    // 4) persist
    const { data: updated, error: upErr } = await supabaseAdmin
      .from("pvp_matches")
      .update({
        log,
        winner_user_id: winnerUserId,
        status: "resolved",
      })
      .eq("id", id)
      .select(
        "id,mode,p1_user_id,p2_user_id,winner_user_id,log,status,created_at,rewards_applied"
      )
      .maybeSingle();

    if (upErr) {
      return NextResponse.json({
        match: { ...(match as any), log, winner_user_id: winnerUserId, status: "resolved" },
        warning: upErr.message,
      });
    }

    return NextResponse.json({ match: updated ?? match });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
