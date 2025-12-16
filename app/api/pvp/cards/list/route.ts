import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const telegramId = url.searchParams.get("telegramId");

  if (!telegramId) {
    return NextResponse.json({ error: "telegramId required" }, { status: 400 });
  }

  // 1) user id
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

  // 2) owned cards:
  // user_cards: user_id, item_id(uuid), copies
  // cards: item_id(uuid), ... (cards.id = text, его НЕ используем для join с user_cards)
  const { data: owned, error: ownedErr } = await supabaseAdmin
    .from("user_cards")
    .select("item_id, copies")
    .eq("user_id", userRow.id)
    .order("item_id", { ascending: true });

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

  // 3) fetch cards by item_id
  const { data: cardsData, error: cardsErr } = await supabaseAdmin
    .from("cards")
    .select("id, name_ru, name_en, rarity, base_power, image_url, item_id")
    .in("item_id", itemIds);

  if (cardsErr) {
    return NextResponse.json({ error: cardsErr.message }, { status: 500 });
  }

  const cardByItemId = new Map(
    (cardsData ?? []).map((c: any) => [c.item_id, c])
  );

  // 4) merge owned copies + card meta
  const cards = rows
    .map((r: any) => {
      const c: any = cardByItemId.get(r.item_id);
      if (!c) return null;

      return {
        id: c.id, // text — используем как ID карты в UI / колоде
        name: c.name_ru ?? c.name_en ?? "Card",
        rarity: c.rarity,
        base_power: Number(c.base_power || 0),
        image_url: c.image_url ?? null,
        owned_copies: Number(r.copies || 0),

        // полезно для дебага
        item_id: c.item_id,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ ok: true, cards });
}
