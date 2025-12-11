import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

const NO_ROWS_CODE = "PGRST116"; // код "no rows" в Supabase
const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN;

// та же формула уровней, что и в /api/profile
function calcLevel(totalPower: number) {
  const BASE = 100;

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
    if (!ADMIN_BOT_TOKEN) {
      return NextResponse.json(
        { error: "ADMIN_BOT_TOKEN is not configured on server" },
        { status: 500 }
      );
    }

    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : null;

    if (!token || token !== ADMIN_BOT_TOKEN) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const telegramId = searchParams.get("telegramId");

    if (!telegramId) {
      return NextResponse.json(
        { error: "telegramId is required" },
        { status: 400 }
      );
    }

    // 1) Находим пользователя (без автосоздания)
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("telegram_id", telegramId)
      .single();

    if (userError && userError.code === NO_ROWS_CODE) {
      // юзер не найден — просто отдадим пустой профиль
      return NextResponse.json({
        exists: false,
        user: null,
      });
    } else if (userError) {
      return NextResponse.json(
        { error: "Failed to fetch user", details: userError },
        { status: 500 }
      );
    }

    // 2) Баланс (если нет — считаем нулевым)
    let { data: balance, error: balanceError } = await supabase
      .from("balances")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (balanceError && balanceError.code === NO_ROWS_CODE) {
      balance = {
        user_id: user.id,
        soft_balance: 0,
        hard_balance: 0,
        updated_at: null,
      };
    } else if (balanceError) {
      return NextResponse.json(
        { error: "Failed to fetch balance", details: balanceError },
        { status: 500 }
      );
    }

    // 3) Предметы → totalPower + itemsCount
    const { data: userItems, error: itemsError } = await supabase
      .from("user_items")
      .select("id, item:items(power_value)")
      .eq("user_id", user.id);

    if (itemsError) {
      return NextResponse.json(
        { error: "Failed to fetch user items", details: itemsError },
        { status: 500 }
      );
    }

    const itemsArray = (userItems || []) as any[];

    const totalPower =
      itemsArray?.reduce(
        (sum: number, ui: any) => sum + (ui.item?.power_value || 0),
        0
      ) ?? 0;

    const itemsCount = itemsArray.length;

    const levelData = calcLevel(totalPower);

    // 4) Спины
    const { data: spinsRows, error: spinsError } = await supabase
      .from("chest_spins")
      .select("id, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (spinsError) {
      return NextResponse.json(
        { error: "Failed to fetch chest spins", details: spinsError },
        { status: 500 }
      );
    }

    const spinsCount = spinsRows?.length ?? 0;
    const lastSpinAt =
      spinsRows && spinsRows.length > 0 ? spinsRows[0].created_at : null;

    // 5) Валюта: сколько Shards потрачено
    const { data: currencyEvents, error: currencyError } = await supabase
      .from("currency_events")
      .select("type, currency, amount")
      .eq("user_id", user.id);

    if (currencyError) {
      return NextResponse.json(
        { error: "Failed to fetch currency events", details: currencyError },
        { status: 500 }
      );
    }

    let totalShardsSpent = 0;

    (currencyEvents || []).forEach((ev: any) => {
      if (ev.currency === "soft" && ev.type === "spend") {
        const amount = typeof ev.amount === "number" ? ev.amount : 0;
        totalShardsSpent += Math.abs(amount);
      }
    });

    // 6) Финальный ответ
    return NextResponse.json({
      exists: true,
      user,
      balance,
      totalPower,
      itemsCount,
      spinsCount,
      lastSpinAt,
      totalShardsSpent,
      level: levelData.level,
      currentLevelPower: levelData.currentLevelPower,
      nextLevelPower: levelData.nextLevelPower,
      progress: levelData.progress,
    });
  } catch (err: any) {
    console.error("GET /api/admin/get-profile error:", err);
    return NextResponse.json(
      { error: "Unexpected error", details: String(err) },
      { status: 500 }
    );
  }
}
