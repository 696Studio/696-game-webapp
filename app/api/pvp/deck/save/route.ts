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

  // склеиваем дубликаты card_id, режем copies 1..9, выкидываем мусор
  const map = new Map<string, number>();
  for (const r of raw) {
    const id = String(r?.card_id || "").trim();
    if (!id) continue;
    const c = clamp(Number(r?.copies || 0), 0, 9);
    if (c <= 0) continue;
    map.set(id, clamp((map.get(id) || 0) + c, 1, 9)); // v1: максимум 9 копий на карту
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

  // 3) проверим что card_id реально существуют
  // ВАЖНО: тут таблица "cards" (как у тебя в /api/pvp/cards/list)
  const ids = cards.map((c) => c.card_id);
  const { data: existing, error: cardsErr } = await supabaseAdmin
    .from("cards")
    .select("id")
    .in("id", ids);

  if (cardsErr) {
    return NextResponse.json({ error: cardsErr.message }, { status: 500 });
  }

  const existingSet = new Set((existing ?? []).map((x: any) => x.id));
  const missing = ids.filter((id) => !existingSet.has(id));
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Unknown card_id: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "..." : ""}` },
      { status: 400 }
    );
  }

  // 4) upsert deck (требует UNIQUE(user_id) в pvp_decks)
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

  // 5) replace cards (v1) — сначала delete, потом insert
  const { error: delErr } = await supabaseAdmin
    .from("pvp_deck_cards")
    .delete()
    .eq("deck_id", deck.id);

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  const rows = cards.map((r) => ({
    deck_id: deck.id,
    card_id: r.card_id,
    copies: clamp(Number(r.copies || 1), 1, 9),
  }));

  const { error: insErr } = await supabaseAdmin
    .from("pvp_deck_cards")
    .insert(rows);

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deckId: deck.id });
}
