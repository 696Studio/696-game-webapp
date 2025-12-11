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

  try {
    // 1) Находим пользователя по telegram_id
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("telegram_id", telegramId)
      .single();

    if (userError || !user) {
      return NextResponse.json(
        { error: "User not found", details: userError },
        { status: 404 }
      );
    }

    // 2) Тянем все user_items с джойном на items
    const { data: rows, error: invError } = await supabase
      .from("user_items")
      .select(
        `
        id,
        created_at,
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
        userItemId: row.id,
        obtainedAt: row.created_at,
        id: row.item?.id,
        name: row.item?.name,
        type: row.item?.type,
        rarity: row.item?.rarity,
        power_value: row.item?.power_value,
        image_url: row.item?.image_url,
      })) ?? [];

    // 3) Считаем суммарную силу и статистику по редкости
    const totalPower = items.reduce(
      (sum, item) => sum + (item.power_value || 0),
      0
    );

    const rarityStats = items.reduce(
      (acc: Record<string, number>, item) => {
        const r = item.rarity || "unknown";
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
