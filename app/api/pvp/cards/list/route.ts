import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const telegramId = url.searchParams.get("telegramId");

    // 1) Load ALL cards (meta)
    // ✅ include combat fields too (they already exist in your cards table)
    const { data: cardsData, error: cardsErr } = await supabaseAdmin
      .from("cards")
      .select(
        "id, name_ru, name_en, rarity, base_power, image_url, item_id, hp, initiative, ability_id, ability_params, tags"
      )
      .order("created_at", { ascending: true });

    if (cardsErr) {
      return NextResponse.json({ error: cardsErr.message }, { status: 500 });
    }

    const cardsList = (cardsData ?? []).map((c: any) => ({
      id: String(c.id), // TEXT card id (pvp_deck_cards.card_id)
      name: c.name_ru ?? c.name_en ?? "Card",
      name_ru: c.name_ru ?? null,
      name_en: c.name_en ?? null,
      rarity: c.rarity ?? "common",
      base_power: Number(c.base_power || 0),
      image_url: c.image_url ?? null,

      // combat stats (optional but present in your schema)
      hp: c.hp != null ? Number(c.hp) : null,
      initiative: c.initiative != null ? Number(c.initiative) : null,
      ability_id: c.ability_id != null ? String(c.ability_id) : null,
      ability_params: c.ability_params ?? null,
      tags: c.tags ?? null,

      // keep for debug / ownership merge
      item_id: c.item_id ?? null,

      // default
      owned_copies: 0,
    }));

    // ✅ If no telegramId — return meta anyway (don’t error)
    if (!telegramId) {
      return NextResponse.json({ ok: true, cards: cardsList, note: "telegramId not provided, ownership skipped" });
    }

    // 2) Resolve user by telegramId
    const { data: userRow, error: userErr } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (userErr) {
      return NextResponse.json({ error: userErr.message }, { status: 500 });
    }
    if (!userRow) {
      // still return meta (so UI doesn’t die), but tell the truth
      return NextResponse.json({ ok: true, cards: cardsList, note: "User not found, ownership set to 0" });
    }

    // 3) Load ownership from user_cards (has item_id + copies)
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

    // 4) Merge owned_copies
    const merged = cardsList.map((c: any) => {
      const itemId = c.item_id ? String(c.item_id) : "";
      const owned = itemId ? ownedByItemId.get(itemId) || 0 : 0;
      return { ...c, owned_copies: owned };
    });

    return NextResponse.json({ ok: true, cards: merged });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
