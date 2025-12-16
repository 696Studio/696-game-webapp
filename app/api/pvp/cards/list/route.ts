import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const telegramId = url.searchParams.get("telegramId");

    if (!telegramId) {
      return NextResponse.json({ error: "telegramId required" }, { status: 400 });
    }

    // 1) Resolve user
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

    // 2) Load ALL cards (so UI can show "100 cards" even if user owns 0)
    const { data: cardsData, error: cardsErr } = await supabaseAdmin
      .from("cards")
      .select("id, name_ru, name_en, rarity, base_power, image_url, item_id")
      .order("created_at", { ascending: true });

    if (cardsErr) {
      return NextResponse.json({ error: cardsErr.message }, { status: 500 });
    }

    // 3) Load ownership from user_cards (fast + correct, has copies)
    const { data: ownedRows, error: ownedErr } = await supabaseAdmin
      .from("user_cards")
      .select("item_id, copies")
      .eq("user_id", userRow.id);

    if (ownedErr) {
      return NextResponse.json({ error: ownedErr.message }, { status: 500 });
    }

    const ownedByItemId = new Map<string, number>();
    for (const r of ownedRows ?? []) {
      const k = String((r as any).item_id);
      const c = Number((r as any).copies || 0);
      ownedByItemId.set(k, c);
    }

    // 4) Merge: card meta + owned_copies
    const cards = (cardsData ?? []).map((c: any) => {
      const itemId = String(c.item_id);
      const owned = ownedByItemId.get(itemId) || 0;

      return {
        id: c.id, // TEXT card id (your pvp_deck_cards.card_id)
        name: c.name_ru ?? c.name_en ?? "Card",
        rarity: c.rarity,
        base_power: Number(c.base_power || 0),
        image_url: c.image_url ?? null,
        owned_copies: owned, // 0 if not owned (this is what we need)
        item_id: c.item_id, // keep for debug
      };
    });

    return NextResponse.json({ ok: true, cards });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
