import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

const NO_ROWS_CODE = "PGRST116";

// простая формула уровней на основе totalPower
function calcLevel(totalPower: number) {
  const BASE = 100; // можно потом поменять
  if (totalPower <= 0) {
    return {
      level: 1,
      currentLevelPower: 0,
      nextLevelPower: BASE,
      progress: 0,
    };
  }

  const raw = Math.floor(Math.sqrt(totalPower / BASE)) + 1;
  const level = Math.max(raw, 1);

  const currentLevelPower = BASE * Math.pow(level - 1, 2);
  const nextLevelPower = BASE * Math.pow(level, 2);

  let progress = 0;
  const span = nextLevelPower - currentLevelPower;
  if (span > 0) {
    progress = Math.min(
      1,
      Math.max(0, (totalPower - currentLevelPower) / span)
    );
  }

  return {
    level,
    currentLevelPower,
    nextLevelPower,
    progress,
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const telegramId =
      url.searchParams.get("telegramId") || "123456789"; // пока тест

    if (!telegramId) {
      return NextResponse.json(
        { error: "telegramId is required" },
        { status: 400 }
      );
    }

    // 1) Находим пользователя
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, telegram_id, username, avatar_url")
      .eq("telegram_id", telegramId)
      .single();

    if (userError && userError.code === NO_ROWS_CODE) {
      // юзер ещё не существует → прогресс нулевой
      const base = calcLevel(0);
      return NextResponse.json({
        user: null,
        totalPower: 0,
        itemsCount: 0,
        ...base,
      });
    } else if (userError) {
      return NextResponse.json(
        { error: "Failed to fetch user", details: userError },
        { status: 500 }
      );
    }

    // 2) Тянем все user_items этого юзера с power_value
    const { data: userItems, error: itemsError } = await supabase
      .from("user_items")
      .select(
        `
        id,
        item:items (
          id,
          power_value
        )
      `
      )
      .eq("user_id", user.id);

    if (itemsError) {
      console.error("progress itemsError:", itemsError);
      return NextResponse.json(
        { error: "Failed to fetch user items", details: itemsError },
        { status: 500 }
      );
    }

    const itemsArray = (userItems || []) as any[];

    const totalPower =
      itemsArray.reduce((sum, ui) => {
        const p = ui.item?.power_value ?? 0;
        return sum + p;
      }, 0) ?? 0;

    const itemsCount = itemsArray.length;

    // 3) Считаем уровень
    const levelData = calcLevel(totalPower);

    // 4) Возвращаем прогресс
    return NextResponse.json({
      user: {
        id: user.id,
        telegram_id: user.telegram_id,
        username: user.username,
        avatar_url: user.avatar_url,
      },
      totalPower,
      itemsCount,
      ...levelData,
    });
  } catch (err: any) {
    console.error("GET /api/progress error:", err);
    return NextResponse.json(
      { error: "Unexpected error", details: String(err) },
      { status: 500 }
    );
  }
}
