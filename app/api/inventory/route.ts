import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const telegramId = searchParams.get("telegram_id");

  if (!telegramId) {
    return NextResponse.json(
      { error: "telegram_id is required" },
      { status: 400 }
    );
  }

  // простая валидация
  if (!/^\d+$/.test(telegramId)) {
    return NextResponse.json(
      { error: "Invalid telegram_id" },
      { status: 400 }
    );
  }

  try {
    // 1) Находим пользователя по telegram_id
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (userError) {
      return NextResponse.json(
        { error: "Failed to fetch user", details: userError },
        { status: 500 }
      );
    }

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // 2) Тянем user_items + items
    const { data: rows, error: invError } = await supabase
      .from("user_items")
      .select(
        `
        id,
        created_at,
        obtained_from,
        item:items (
          id,
          name,
          type,
          rarity,
          power_value,
          image_url
        )
      `
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (invError) {
      return NextResponse.json(
        { error: "Failed to fetch inventory", details: invError },
        { status: 500 }
      );
    }

    const items =
      rows?.map((row: any) => ({
        id: row.id, // ❗ user_items.id — то, что ждёт фронт
        created_at: row.created_at,
        obtained_from: row.obtained_from ?? null,
        item: {
          id: row.item?.id,
          name: row.item?.name,
          type: row.item?.type,
          rarity: row.item?.rarity,
          power_value: row.item?.power_value ?? 0,
          image_url: row.item?.image_url ?? null,
        },
      })) ?? [];

    // 3) totalPower
    const totalPower = items.reduce(
      (sum, ui) => sum + (ui.item?.power_value || 0),
      0
    );

    // 4) rarityStats
    const rarityStats = items.reduce(
      (acc: Record<string, number>, ui) => {
        const r = ui.item?.rarity || "unknown";
        acc[r] = (acc[r] || 0) + 1;
        return acc;
      },
      {}
    );

    return NextResponse.json({
      items,
      totalPower,
      rarityStats,
    });
  } catch (e: any) {
    console.error("Inventory error:", e);
    return NextResponse.json(
      { error: "Unexpected error", details: String(e) },
      { status: 500 }
    );
  }
}
