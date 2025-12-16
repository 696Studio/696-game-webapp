import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const telegramId = url.searchParams.get("telegramId");
  if (!telegramId) {
    return NextResponse.json({ error: "telegramId required" }, { status: 400 });
  }

  const { data: userRow, error: userErr } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (userErr || !userRow) {
    return NextResponse.json(
      { error: userErr?.message || "User not found" },
      { status: 404 }
    );
  }

  const { data: deck, error: deckErr } = await supabaseAdmin
    .from("pvp_decks")
    .select("id,name, pvp_deck_cards(card_id,copies)")
    .eq("user_id", userRow.id)
    .maybeSingle();

  if (deckErr) {
    return NextResponse.json({ error: deckErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    deck: deck
      ? { id: deck.id, name: deck.name, cards: (deck as any).pvp_deck_cards ?? [] }
      : null,
  });
}
