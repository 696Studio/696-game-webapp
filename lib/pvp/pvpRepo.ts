import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function getUserByTelegramId(telegramId: string) {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, telegram_id")
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return data as { id: string; telegram_id: string };
}

export async function getActiveDeck(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("decks")
    .select("id, user_id, name, is_active")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as any | null;
}

export async function getDeckCards(deckId: string) {
  // deck_cards: deck_id, card_id, copies
  const { data, error } = await supabaseAdmin
    .from("deck_cards")
    .select("card_id, copies")
    .eq("deck_id", deckId);

  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ card_id: string; copies: number }>;
}

export async function getCardsByIds(cardIds: string[]) {
  if (cardIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("cards")
    .select("id, rarity, base_power")
    .in("id", cardIds);

  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; rarity: any; base_power: number }>;
}

export function expandCopies<T extends { copies: number }>(rows: T[]) {
  const out: T[] = [];
  for (const r of rows) {
    const n = Math.max(1, Math.floor(r.copies || 1));
    for (let i = 0; i < n; i++) out.push(r);
  }
  return out;
}

export function calcDeckPower(cards: Array<{ base_power: number }>) {
  let sum = 0;
  for (const c of cards) sum += Number(c.base_power || 0);
  return sum;
}
