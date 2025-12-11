import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

const NO_ROWS_CODE = "PGRST116";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const telegramId =
      url.searchParams.get("telegramId") || "123456789"; // пока тест
    const limitParam = url.searchParams.get("limit");
    const limit = Math.min(
      Math.max(parseInt(limitParam || "50", 10) || 50, 1),
      200
    );

    if (!telegramId) {
      return NextResponse.json(
        { error: "telegramId is required" },
        { status: 400 }
      );
    }

    // 1) Находим пользователя по telegram_id
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, telegram_id, username, avatar_url")
      .eq("telegram_id", telegramId)
      .single();

    if (userError && userError.code === NO_ROWS_CODE) {
      // у юзера ещё нет записи → просто пустая история
      return NextResponse.json({ spins: [] });
    } else if (userError) {
      return NextResponse.json(
        { error: "Failed to fetch user", details: userError },
        { status: 500 }
      );
    }

    // 2) Тянем крутки этого пользователя
    const { data: spins, error: spinsError } = await supabase
      .from("chest_spins")
      .select(
        `
        id,
        created_at,
        cost_soft,
        cost_hard,
        user_item_id,
        chest:chests (
          id,
          code,
          name,
          description
        ),
        user_item:user_items (
          id,
          item:items (
            id,
            name,
            rarity,
            power_value,
            image_url
          )
        )
      `
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (spinsError) {
      console.error("spinsError:", spinsError);
      return NextResponse.json(
        { error: "Failed to fetch chest spins", details: spinsError },
        { status: 500 }
      );
    }

    if (!spins || spins.length === 0) {
      return NextResponse.json({ spins: [] });
    }

    // 3) Приводим в удобный формат
    const result = (spins as any[]).map((spin) => {
      const chest = spin.chest || {};
      const userItem = spin.user_item || {};
      const item = userItem.item || {};

      return {
        id: spin.id,
        created_at: spin.created_at,
        cost_soft: spin.cost_soft,
        cost_hard: spin.cost_hard,
        chest: {
          id: chest.id,
          code: chest.code,
          name: chest.name,
          description: chest.description,
        },
        item: {
          user_item_id: userItem.id,
          id: item.id,
          name: item.name,
          rarity: item.rarity,
          power_value: item.power_value,
          image_url: item.image_url,
        },
      };
    });

    return NextResponse.json({ spins: result });
  } catch (err: any) {
    console.error("GET /api/spins error:", err);
    return NextResponse.json(
      { error: "Unexpected error", details: String(err) },
      { status: 500 }
    );
  }
}
