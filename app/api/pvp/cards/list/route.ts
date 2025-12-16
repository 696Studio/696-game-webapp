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

  // 2) берём ВСЕ item_id из user_items (это у тебя точно работает)
  // если будет очень много — потом оптимизируем, сейчас задача: чтобы завелось
  const { data: userItems, error: itemsErr } = await supabaseAdmin
    .from("user_items")
    .select("item_id")
    .eq("user_id", userRow.id);

  if (itemsErr) {
    return NextResponse.json({ error: itemsErr.message }, { status: 500 });
  }

  const ids = (userItems ?? [])
    .map((r: any) => r?.item_id)
    .filter(Boolean);

  if (ids.length === 0) {
    return NextResponse.json({ ok: true, cards: [] });
  }

  // 3) считаем copies по item_id на стороне сервера (JS)
  const copiesByItemId = new Map<string, number>();
  for (const itemId of ids) {
    const key = String(itemId);
    copiesByItemId.set(key, (copiesByItemId.get(key) || 0) + 1);
  }

  const uniqueItemIds = Array.from(copiesByItemId.keys());

  // 4) забираем карточные метаданные из cards по item_id
  const { data: cardsData, error: cardsErr } = await supabaseAdmin
    .from("cards")
    .select("id, name_ru, name_en, rarity, base_power, image_url, item_id")
    .in("item_id", uniqueItemIds);

  if (cardsErr) {
    return NextResponse.json({ error: cardsErr.message }, { status: 500 });
  }

  // 5) мержим: card meta + owned_copies
  const cards = (cardsData ?? [])
    .map((c: any) => {
      const itemId = String(c.item_id);
      const owned = copiesByItemId.get(itemId) || 0;
      if (owned <= 0) return null;

      return {
        id: c.id, // text — это твоё card_id для колоды (pvp_deck_cards.card_id)
        name: c.name_ru ?? c.name_en ?? "Card",
        rarity: c.rarity,
        base_power: Number(c.base_power || 0),
        image_url: c.image_url ?? null,
        owned_copies: owned,
        item_id: c.item_id, // для дебага
      };
    })
    .filter(Boolean);

  return NextResponse.json({ ok: true, cards });
}
