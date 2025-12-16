import { NextRequest, NextResponse } from "next/server";
import { getUserByTelegramId, getActiveDeck, getDeckCards } from "@/lib/pvp/pvpRepo";

function bad(msg: string, code = "BAD_REQUEST", status = 400) {
  return NextResponse.json({ error: msg, code }, { status });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const telegramId = searchParams.get("telegramId");
  if (!telegramId) return bad("telegramId required");

  const user = await getUserByTelegramId(telegramId);
  if (!user) return bad("User not found", "USER_NOT_FOUND", 404);

  const deck = await getActiveDeck(user.id);
  if (!deck) return NextResponse.json({ ok: true, deck: null });

  const cards = await getDeckCards(deck.id);
  return NextResponse.json({
    ok: true,
    deck: { id: deck.id, name: deck.name, is_active: deck.is_active, cards },
  });
}
