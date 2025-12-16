import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Body = {
  telegramId: string;
  deckName: string;
  cards: { card_id: string; copies: number }[];
};

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

export async function POST(req: Request) {
  const body = (await req.json()) as Body;

  if (!body?.telegramId) {
    return NextResponse.json({ error: "telegramId required" }, { status: 400 });
  }

  // 1) нормализуем вход
  const raw = Array.isArray(body.cards) ? body.cards : [];
  const map = new Map<string, number>();

  for (const r of raw) {
    const id = String(r?.card_id || "").trim(); // это cards.id (TEXT)
    if (!id) continue;

    const c = clamp(Number(r?.copies || 0), 0, 9);
    if (c <= 0) continue;

    map.set(id, clamp((map.get(id) || 0) + c, 1, 9));
  }

  const cards = Array.from(map.entries()).map(([card_id, copies]) => ({
    card_id,
    copies,
  }));

  if (cards.length === 0) {
    return NextResponse.json({ error: "Deck cards empty" }, { status: 400 });
  }

  const total = cards.reduce((a, r) => a + Number(r.copies || 0), 0);
  if (total !== 20) {
    return NextResponse.json(
      { error: "Deck must be exactly 20 copies" },
      { status: 400 }
    );
  }

  // 2) resolve user
  const { data: userRow, error: userErr } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("telegram_id", body.telegramId)
    .maybeSingle();

  if (userErr || !userRow) {
    return NextResponse.json(
      { error: userErr?.message || "User not found" },
      { status: 404 }
    );
  }

  // 3) load cards metadata by cards.id (TEXT) -> get item_id(uuid)
  const ids = cards.map((c) => c.card_id);
  const { data: cardMeta, error: metaErr } = await supabaseAdmin
    .from("cards")
    .select("id,item_id")
    .in("id", ids);

  if (metaErr) {
    return NextResponse.json({ error: metaErr.message }, { status: 500 });
  }

  const byCardId = new Map((cardMeta ?? []).map((c: any) => [String(c.id), c]));
  const missing = ids.filter((id) => !byCardId.has(id));
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Unknown card_id: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "..." : ""}` },
      { status: 400 }
    );
  }

  // 4) ✅ verify ownership using user_cards.item_id(uuid)
  const itemIds = (cardMeta ?? [])
    .map((c: any) => c.item_id)
    .filter(Boolean);

  const { data: ownedRows, error: ownedErr } = await supabaseAdmin
    .from("user_cards")
    .select("item_id,copies")
    .eq("user_id", userRow.id)
    .in("item_id", itemIds);

  if (ownedErr) {
    return NextResponse.json({ error: ownedErr.message }, { status: 500 });
  }

  const ownedByItemId = new Map(
    (ownedRows ?? []).map((r: any) => [r.item_id, Number(r.copies || 0)])
  );

  for (const r of cards) {
    const meta: any = byCardId.get(r.card_id);
    const itemId = meta?.item_id;
    const owned = Number(ownedByItemId.get(itemId) || 0);

    if (owned < Number(r.copies || 0)) {
      return NextResponse.json(
        { error: `Not enough copies for card_id=${r.card_id}. Owned=${owned}, requested=${r.copies}` },
        { status: 400 }
      );
    }
  }

  // 5) upsert deck (требует UNIQUE(user_id) в pvp_decks)
  const { data: deck, error: deckErr } = await supabaseAdmin
    .from("pvp_decks")
    .upsert(
      { user_id: userRow.id, name: body.deckName || "Моя колода" },
      { onConflict: "user_id" }
    )
    .select("id")
    .single();

  if (deckErr || !deck) {
    return NextResponse.json(
      { error: deckErr?.message || "Deck upsert failed" },
      { status: 500 }
    );
  }

  // 6) replace cards (v1)
  const { error: delErr } = await supabaseAdmin
    .from("pvp_deck_cards")
    .delete()
    .eq("deck_id", (deck as any).id);

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  const rows = cards.map((r) => ({
    deck_id: (deck as any).id,
    card_id: r.card_id, // TEXT, как в cards.id
    copies: clamp(Number(r.copies || 1), 1, 9),
  }));

  const { error: insErr } = await supabaseAdmin
    .from("pvp_deck_cards")
    .insert(rows);

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deckId: (deck as any).id });
}
