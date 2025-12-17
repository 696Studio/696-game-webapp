import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type CardRowBase = {
  id: string;
  name_ru: string | null;
  name_en: string | null;
  rarity: string | null;
  base_power: number | null;
  image_url: string | null;
  item_id: string | null;
  created_at?: string | null;
};

type CardRowExtended = CardRowBase & {
  hp?: number | null;
  initiative?: number | null;
  ability_id?: string | null;
  ability_params?: any;
  tags?: any;
};

function isMissingColumnError(msg: string) {
  const s = (msg || "").toLowerCase();
  return s.includes("column") && s.includes("does not exist");
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const telegramId = url.searchParams.get("telegramId");

    // 1) Load cards meta (try extended -> fallback to base)
    let cardsData: any[] | null = null;

    // try extended (if columns exist)
    {
      const { data, error } = await supabaseAdmin
        .from("cards")
        .select(
          "id, name_ru, name_en, rarity, base_power, image_url, item_id, created_at, hp, initiative, ability_id, ability_params, tags"
        )
        .order("created_at", { ascending: true });

      if (error) {
        // fallback to base if columns missing
        if (!isMissingColumnError(error.message)) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }

        const base = await supabaseAdmin
          .from("cards")
          .select("id, name_ru, name_en, rarity, base_power, image_url, item_id, created_at")
          .order("created_at", { ascending: true });

        if (base.error) {
          return NextResponse.json({ error: base.error.message }, { status: 500 });
        }

        cardsData = base.data ?? [];
      } else {
        cardsData = data ?? [];
      }
    }

    const cardsList = (cardsData ?? []).map((c: CardRowExtended) => ({
      id: String(c.id), // TEXT card id
      name: c.name_ru ?? c.name_en ?? "Card",
      name_ru: c.name_ru ?? null,
      name_en: c.name_en ?? null,
      rarity: c.rarity ?? "common",
      base_power: Number(c.base_power || 0),
      image_url: c.image_url ?? null,

      // combat fields (may be absent in DB -> return nulls)
      hp: c.hp != null ? Number(c.hp) : null,
      initiative: c.initiative != null ? Number(c.initiative) : null,
      ability_id: c.ability_id != null ? String(c.ability_id) : null,
      ability_params: c.ability_params ?? null,
      tags: c.tags ?? null,

      item_id: c.item_id ?? null,
      owned_copies: 0,
    }));

    // If no telegramId — return meta only
    if (!telegramId) {
      return NextResponse.json({
        ok: true,
        cards: cardsList,
        count: cardsList.length,
        note: "telegramId not provided, ownership skipped",
      });
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
      return NextResponse.json({
        ok: true,
        cards: cardsList,
        count: cardsList.length,
        note: "User not found, ownership set to 0",
      });
    }

    // 3) Load ownership from user_cards (item_id + copies)
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

    return NextResponse.json({ ok: true, cards: merged, count: merged.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
