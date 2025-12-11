import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

const NO_ROWS_CODE = "PGRST116"; // код "no rows" в Supabase

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
  const { searchParams } = new URL(request.url);
  const telegramId = searchParams.get("telegram_id");

  if (!telegramId) {
    return NextResponse.json(
      { error: "telegram_id is required (temp stub)" },
      { status: 400 }
    );
  }

  // 1) Находим или создаём пользователя
  let { data: user, error: userError } = await supabase
    .from("users")
    .select("*")
    .eq("telegram_id", telegramId)
    .single();

  if (userError && userError.code === NO_ROWS_CODE) {
    const { data: newUser, error: createError } = await supabase
      .from("users")
      .insert({
        telegram_id: telegramId,
        username: `user_${telegramId.slice(-4)}`,
      })
      .select("*")
      .single();

    if (createError || !newUser) {
      return NextResponse.json(
        { error: "Failed to create user", details: createError },
        { status: 500 }
      );
    }

    user = newUser;
  } else if (userError) {
    return NextResponse.json(
      { error: "Failed to fetch user", details: userError },
      { status: 500 }
    );
  }

  // 2) Находим или создаём баланс
  let { data: balance, error: balanceError } = await supabase
    .from("balances")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (balanceError && balanceError.code === NO_ROWS_CODE) {
    const { data: newBalance, error: createBalError } = await supabase
      .from("balances")
      .insert({ user_id: user.id })
      .select("*")
      .single();

    if (createBalError || !newBalance) {
      return NextResponse.json(
        { error: "Failed to create balance", details: createBalError },
        { status: 500 }
      );
    }

    balance = newBalance;
  } else if (balanceError) {
    return NextResponse.json(
      { error: "Failed to fetch balance", details: balanceError },
      { status: 500 }
    );
  }

  // 3) Считаем totalPower + itemsCount
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

  // 4) Считаем уровень
  const levelData = calcLevel(totalPower);

  // 5) Агрегации по круткам (chest_spins)
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

  // 6) Агрегации по валюте (currency_events)
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
      // у нас amount для spend, судя по /api/chest/open, отрицательный → берём модуль
      totalShardsSpent += Math.abs(amount);
    }
  });

  // 7) Возвращаем расширенный профиль
  return NextResponse.json({
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
}
