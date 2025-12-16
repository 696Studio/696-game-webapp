import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getUserByTelegramId } from "@/lib/pvp/pvpRepo";

type Body = {
  telegramId: string;
  deckName?: string;
  cards: Array<{ card_id: string; copies?: number }>; // total copies must be 20 in v1
};

function bad(msg: string, code = "BAD_REQUEST", status = 400) {
  return NextResponse.json({ error: msg, code }, { status });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.telegramId) return bad("telegramId required");
  if (!Array.isArray(body.cards)) return bad("cards[] required");

  const user = await getUserByTelegramId(body.telegramId);
  if (!user) return bad("User not found", "USER_NOT_FOUND", 404);

  const deckName = String(body.deckName || "Main Deck").slice(0, 60);

  // Validate total copies = 20 (v1)
  let total = 0;
  const normalized = body.cards
    .map((x) => ({
      card_id: String(x.card_id),
      copies: Math.max(1, Math.floor(Number(x.copies ?? 1))),
    }))
    .filter((x) => x.card_id);

  for (const c of normalized) total += c.copies;
  if (total !== 20) return bad("Deck must contain exactly 20 total copies (v1)", "DECK_SIZE");

  // Ensure deck exists (upsert active)
  const { data: deck, error: deckErr } = await supabaseAdmin
    .from("decks")
    .insert({ user_id: user.id, name: deckName, is_active: true })
    .select("id")
    .single();

  if (deckErr) return bad(deckErr.message, "DB_ERROR", 500);

  // Clear previous deck cards
  const { error: delErr } = await supabaseAdmin.from("deck_cards").delete().eq("deck_id", deck.id);
  if (delErr) return bad(delErr.message, "DB_ERROR", 500);

  // Insert new deck cards
  const rows = normalized.map((c) => ({ deck_id: deck.id, card_id: c.card_id, copies: c.copies }));
  const { error: insErr } = await supabaseAdmin.from("deck_cards").insert(rows);
  if (insErr) return bad(insErr.message, "DB_ERROR", 500);

  return NextResponse.json({ ok: true, deckId: deck.id });
}
