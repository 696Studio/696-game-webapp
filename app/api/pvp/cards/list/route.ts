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

  // user_cards: user_id, item_id(uuid), copies
  const { data: owned, error: ownedErr } = await supabaseAdmin
    .from("user_cards")
    .select("item_id, copies")
    .eq("user_id", userRow.id);

  if (ownedErr) {
    return NextResponse.json({ error: ownedErr.message }, { status: 500 });
  }

  const rows = (owned ?? []).filter(
    (r: any) => r?.item_id && Number(r?.copies || 0) > 0
  );

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, cards: [] });
  }

  const itemIds = rows.map((r: any) => r.item_id);

  // cards: id(text), ... , item_id(uuid)
  const { data: cardsData, error: cardsErr } = await supabaseAdmin
    .from("cards")
    .select("id, name_ru, name_en, rarity, base_power, image_url, item_id")
    .in("item_id", itemIds);

  if (cardsErr) {
    return NextResponse.json({ error: cardsErr.message }, { status: 500 });
  }

  const cardByItemId = new Map<string, any>();
  for (const c of cardsData ?? []) {
    if (c?.item_id) cardByItemId.set(String(c.item_id), c);
  }

  const cards = rows
    .map((r: any) => {
      const c: any = cardByItemId.get(String(r.item_id));
      if (!c) return null;

      return {
        id: c.id, // text — это то, что PVP использует как card_id
        name: c.name_ru ?? c.name_en ?? "Card",
        rarity: c.rarity,
        base_power: Number(c.base_power || 0),
        image_url: c.image_url ?? null,
        owned_copies: Number(r.copies || 0),
        item_id: c.item_id, // debug
      };
    })
    .filter(Boolean);

  return NextResponse.json({ ok: true, cards });
}
