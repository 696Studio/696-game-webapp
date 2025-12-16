import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  calcDeckPower,
  expandCopies,
  getActiveDeck,
  getCardsByIds,
  getDeckCards,
  getUserByTelegramId,
} from "@/lib/pvp/pvpRepo";
import { simulateMatch } from "@/lib/pvp/sim";

type Body = {
  telegramId: string;
  mode?: "unranked";
};

function bad(msg: string, code = "BAD_REQUEST", status = 400) {
  return NextResponse.json({ error: msg, code }, { status });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.telegramId) return bad("telegramId required");

  const mode = body.mode || "unranked";

  const user = await getUserByTelegramId(body.telegramId);
  if (!user) return bad("User not found", "USER_NOT_FOUND", 404);

  const deck = await getActiveDeck(user.id);
  if (!deck) return bad("Active deck not found. Create a deck first.", "DECK_NOT_FOUND", 404);

  // Build expanded deck for power rating
  const deckRows = await getDeckCards(deck.id);
  const expandedIds = expandCopies(deckRows.map((r) => ({ ...r, copies: r.copies }))).map((r) => r.card_id);

  const uniqueIds = Array.from(new Set(expandedIds));
  const cards = await getCardsByIds(uniqueIds);

  // Expand to full list with duplicates
  const cardMap = new Map(cards.map((c) => [c.id, c]));
  const expandedCards = expandedIds
    .map((id) => cardMap.get(id))
    .filter(Boolean) as Array<{ id: string; rarity: any; base_power: number }>;

  if (expandedCards.length < 10) {
    return bad("Deck too small or missing cards in DB", "DECK_INVALID", 400);
  }

  const power = calcDeckPower(expandedCards);

  // Put user into queue
  const { data: qRow, error: qErr } = await supabaseAdmin
    .from("matchmaking_queue")
    .insert({
      user_id: user.id,
      deck_id: deck.id,
      mode,
      power_rating: power,
    })
    .select("id, created_at")
    .single();

  if (qErr) return bad(qErr.message, "DB_ERROR", 500);

  // Find opponent (oldest queued, not self), within ±15%
  const minP = Math.floor(power * 0.85);
  const maxP = Math.ceil(power * 1.15);

  const { data: oppList, error: oppErr } = await supabaseAdmin
    .from("matchmaking_queue")
    .select("id, user_id, deck_id, power_rating, created_at")
    .eq("mode", mode)
    .neq("user_id", user.id)
    .gte("power_rating", minP)
    .lte("power_rating", maxP)
    .order("created_at", { ascending: true })
    .limit(1);

  if (oppErr) return bad(oppErr.message, "DB_ERROR", 500);

  const opponent = oppList?.[0];

  // If no opponent yet -> queued
  if (!opponent) {
    return NextResponse.json({ ok: true, status: "queued", queueId: qRow.id });
  }

  // Remove both from queue (best effort)
  await supabaseAdmin.from("matchmaking_queue").delete().in("id", [qRow.id, opponent.id]);

  // Build opponent deck expanded
  const oppRows = await getDeckCards(opponent.deck_id);
  const oppExpandedIds = expandCopies(oppRows.map((r) => ({ ...r, copies: r.copies }))).map((r) => r.card_id);

  const oppUnique = Array.from(new Set(oppExpandedIds));
  const oppCardsRaw = await getCardsByIds(oppUnique);
  const oppMap = new Map(oppCardsRaw.map((c) => [c.id, c]));
  const oppExpandedCards = oppExpandedIds
    .map((id) => oppMap.get(id))
    .filter(Boolean) as Array<{ id: string; rarity: any; base_power: number }>;

  // Create match
  const seed = `${user.id}:${opponent.user_id}:${Date.now()}`;
  const log = simulateMatch(seed, expandedCards as any, oppExpandedCards as any);

  const winner_user_id =
    log.winner === "p1" ? user.id : log.winner === "p2" ? opponent.user_id : null;

  const p1_rounds_won = log.rounds.filter((r) => r.winner === "p1").length;
  const p2_rounds_won = log.rounds.filter((r) => r.winner === "p2").length;

  const { data: match, error: mErr } = await supabaseAdmin
    .from("matches")
    .insert({
      mode,
      p1_user_id: user.id,
      p2_user_id: opponent.user_id,
      p1_deck_id: deck.id,
      p2_deck_id: opponent.deck_id,
      status: "resolved",
      seed,
      winner_user_id,
      p1_rounds_won,
      p2_rounds_won,
      log,
      resolved_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (mErr) return bad(mErr.message, "DB_ERROR", 500);

  return NextResponse.json({
    ok: true,
    status: "matched",
    matchId: match.id,
  });
}
