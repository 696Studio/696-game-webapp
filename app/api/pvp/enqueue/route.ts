import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type EnqueueBody = {
  telegramId?: string;
  mode?: string; // "unranked" | "ranked" | etc
};

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

    if (userErr) {
      return NextResponse.json({ error: userErr.message }, { status: 500 });
    }

    if (!userRow) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // 2) Compute deck power on server
    // IMPORTANT: client is not a source of truth.
    const deck = await loadDeckPower(userRow.id);
    const deckPower = Math.max(0, Math.floor(deck.total || 0));

    // 3) Atomic matchmaking via RPC
    // We use `region` as a "bucket" for now to separate modes (ranked/unranked).
    // Later we can extend the RPC to accept p_mode explicitly.
    const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc("pvp_join_and_match", {
      p_user_id: userRow.id,
      p_deck_power: deckPower,
      p_region: mode,
    });

    if (rpcErr) {
      // Most common cause: table schema mismatch (e.g. no deck_power column).
      return NextResponse.json(
        { error: `pvp_join_and_match failed: ${rpcErr.message}` },
        { status: 500 }
      );
    }

    // RPC returns jsonb. Depending on supabase client it may come as object already.
    const payload = (rpcData ?? {}) as any;
    const status = payload?.status;

    if (status === "matched") {
      return NextResponse.json({
        status: "matched",
        matchId: payload.match_id,
        opponentId: payload.opponent_id ?? null,
        seed: payload.seed ?? null,
        deckPower,
      });
    }

    // searching/queued
    return NextResponse.json({
      status: "queued",
      deckPower,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * Server-side deck power calculation.
 * Uses the user's saved PVP deck (pvp_decks + pvp_deck_cards).
 * Cards are resolved from `cards` table (id TEXT, base_power, rarity).
 */
async function loadDeckPower(userId: string) {
  const { data: deck, error: deckErr } = await supabaseAdmin
    .from("pvp_decks")
    .select("id, pvp_deck_cards(card_id,copies)")
    .eq("user_id", userId)
    .maybeSingle();

  if (deckErr) throw new Error(deckErr.message);

  const cardsRows: { card_id: string; copies: number }[] = (deck as any)?.pvp_deck_cards ?? [];
  if (!deck || cardsRows.length === 0) {
    return { total: 0, cards: [] as number[] };
  }

  const ids = cardsRows.map((r) => r.card_id);

  const { data: cards, error: cardsErr } = await supabaseAdmin
    .from("cards")
    .select("id,base_power,rarity")
    .in("id", ids);

  if (cardsErr) throw new Error(cardsErr.message);

  const byId = new Map((cards ?? []).map((c: any) => [c.id, c]));

  const powerList: number[] = [];
  let total = 0;

  for (const r of cardsRows) {
    const c: any = byId.get(r.card_id);
    const p = Number(c?.base_power || 0);
    const copies = Number(r.copies || 0);

    for (let i = 0; i < copies; i++) powerList.push(p);
    total += p * copies;
  }

  return { total, cards: powerList };
}
