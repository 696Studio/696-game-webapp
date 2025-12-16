import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { simulateMatch, type Card as SimCard } from "@/lib/pvp/sim";

type EnqueueBody = {
  telegramId?: string;
  mode?: string;
};

type RpcPayload =
  | { status: "queued" }
  | { status: "matched"; match_id: string; opponent_id?: string | null; seed?: string | null };

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as EnqueueBody;
    const telegramId = body?.telegramId;
    const mode = body?.mode || "unranked";

    if (!telegramId) {
      return NextResponse.json({ error: "telegramId required" }, { status: 400 });
    }

    // 1) Resolve user by telegramId
    const { data: userRow, error: userErr } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (userErr) return NextResponse.json({ error: userErr.message }, { status: 500 });
    if (!userRow) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // 2) Deck power (server truth)
    const p1Deck = await loadDeckForSim(userRow.id);
    const p1Power = calcDeckPower(p1Deck);

    // 3) Atomic matchmaking via RPC
    const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc("pvp_join_and_match", {
      p_user_id: userRow.id,
      p_deck_power: p1Power,
      p_region: mode,
    });

    if (rpcErr) {
      return NextResponse.json(
        { error: `pvp_join_and_match failed: ${rpcErr.message}` },
        { status: 500 }
      );
    }

    const payload = (rpcData ?? {}) as RpcPayload;

    if (payload.status !== "matched") {
      return NextResponse.json({ status: "queued", deckPower: p1Power });
    }

    const matchId = payload.match_id;
    const seed = payload.seed || `${matchId}:${Date.now()}`;
    const opponentId = payload.opponent_id || null;

    // 4) Enrich match: simulate + timeline + winner (status остаётся resolved из-за constraint)
    //    ⚠️ Если opponentId вдруг null — просто вернём matched без enrich
    if (opponentId) {
      const p2Deck = await loadDeckForSim(opponentId);
      const p2Power = calcDeckPower(p2Deck);

      const sim = simulateMatch(seed, p1Deck, p2Deck);

      const duration_sec = 90; // 60..90 можно потом сделать динамикой
      const timeline = buildTimeline(sim, duration_sec);

      const winner_user_id =
        sim.winner === "draw" ? null : sim.winner === "p1" ? userRow.id : opponentId;

      const log = {
        seed,
        duration_sec,
        p1: { deckPower: p1Power },
        p2: { deckPower: p2Power },
        rounds: sim.rounds,
        timeline,
        winner: sim.winner,
      };

      // update match row
      await supabaseAdmin
        .from("pvp_matches")
        .update({
          log,
          winner_user_id,
          status: "resolved", // constraint требует resolved
        })
        .eq("id", matchId);

      // если у тебя уже есть награды и RPC их не выдаёт — можно включить обратно
      // await applyRewardsOnce(matchId, winner_user_id, userRow.id, opponentId);
    }

    return NextResponse.json({
      status: "matched",
      matchId,
      opponentId,
      seed,
      deckPower: p1Power,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}

// ---------- helpers ----------

async function loadDeckForSim(userId: string): Promise<SimCard[]> {
  const { data: deck, error: deckErr } = await supabaseAdmin
    .from("pvp_decks")
    .select("id, pvp_deck_cards(card_id,copies)")
    .eq("user_id", userId)
    .maybeSingle();

  if (deckErr) throw new Error(deckErr.message);

  const rows: { card_id: string; copies: number }[] = (deck as any)?.pvp_deck_cards ?? [];
  if (!deck || rows.length === 0) return [];

  const ids = rows.map((r) => r.card_id);

  const { data: cards, error: cardsErr } = await supabaseAdmin
    .from("cards")
    .select("id, rarity, base_power")
    .in("id", ids);

  if (cardsErr) throw new Error(cardsErr.message);

  const byId = new Map((cards ?? []).map((c: any) => [c.id, c]));

  const out: SimCard[] = [];
  for (const r of rows) {
    const c: any = byId.get(r.card_id);
    const copies = Math.max(1, Math.floor(Number(r.copies || 1)));
    for (let i = 0; i < copies; i++) {
      out.push({
        id: String(r.card_id),
        rarity: (String(c?.rarity || "common").toLowerCase() as any),
        base_power: Number(c?.base_power || 0),
      });
    }
  }
  return out;
}

function calcDeckPower(deck: SimCard[]) {
  let sum = 0;
  for (const c of deck) sum += Number(c.base_power || 0);
  return Math.max(0, Math.floor(sum));
}

function buildTimeline(sim: any, durationSec: number) {
  // 3 раунда, каждый ~30 сек. Внутри: start -> reveal -> score -> end
  const events: any[] = [];
  const roundSpan = Math.floor(durationSec / 3); // 30

  sim.rounds.forEach((r: any, idx: number) => {
    const round = idx + 1;
    const baseT = idx * roundSpan;

    events.push({ t: baseT + 0, type: "round_start", round });
    events.push({
      t: baseT + 2,
      type: "reveal",
      round,
      p1_cards: r?.p1?.cards ?? [],
      p2_cards: r?.p2?.cards ?? [],
    });
    events.push({
      t: baseT + 18,
      type: "score",
      round,
      p1: r?.p1?.total ?? 0,
      p2: r?.p2?.total ?? 0,
    });
    events.push({ t: baseT + 22, type: "round_end", round, winner: r?.winner ?? "draw" });
  });

  // на всякий случай сорт
  return events.sort((a, b) => a.t - b.t);
}
