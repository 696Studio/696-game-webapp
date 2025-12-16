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

  // 2) owned cards (через user_cards -> cards)
  const { data, error } = await supabaseAdmin
    .from("user_cards")
    .select(
      `
      card_id,
      copies,
      cards:card_id ( id, name, rarity, base_power, image_url )
    `
    )
    .eq("user_id", userRow.id)
    .order("card_id", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const cards = (data ?? [])
    .map((row: any) => ({
      ...(row.cards || {}),
      owned_copies: Number(row.copies || 0),
    }))
    .filter((c: any) => c.id && c.owned_copies > 0);

  return NextResponse.json({ ok: true, cards });
}
