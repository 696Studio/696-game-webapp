import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

const NO_ROWS_CODE = "PGRST116";

const DAILY_REWARD_AMOUNT = 50;
const DAILY_COOLDOWN_HOURS = 24;

// формула уровней
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

async function handleBootstrap(request: Request) {
  try {
    // 1) Достаём telegramId из body (POST) или query (GET)
    let telegramId: string | null = null;

    if (request.method === "POST") {
      try {
        const body = await request.json();
        if (body && typeof body.telegramId === "string") {
          telegramId = body.telegramId;
        }
      } catch {
        // тело могло быть пустым — ок
      }
    }

    if (!telegramId) {
      const { searchParams } = new URL(request.url);
      const fromQuery = searchParams.get("telegram_id");
      if (fromQuery) telegramId = fromQuery;
    }

    // fallback, чтобы сайт открывался в браузере
    if (!telegramId) {
      telegramId = "123456789";
    }

    // 2) Находим пользователя
    let { data: user, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("telegram_id", telegramId)
      .single();

    // 2.1 Если пользователя нет ИЛИ произошла ошибка — пробуем создать
    if (!user) {
      const { data: newUser, error: createError } = await supabase
        .from("users")
        .insert({
          telegram_id: telegramId,
          username: `user_${telegramId.slice(-4)}`,
        })
        .select("*")
        .single();

      if (createError || !newUser) {
        // тут уже реально фатал — отдадим обе ошибки наружу
        return NextResponse.json(
          {
            error: "Failed to fetch/create user",
            userError,
            createError,
          },
          { status: 500 }
        );
      }

      user = newUser;
    }

    // 3) Находим или создаём баланс
    let { data: balance, error: balanceError } = await supabase
      .from("balances")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (!balance) {
      const { data: newBalance, error: createBalError } = await supabase
        .from("balances")
        .insert({ user_id: user.id, soft_balance: 0, hard_balance: 0 })
        .select("*")
        .single();

      if (createBalError || !newBalance) {
        return NextResponse.json(
          { error: "Failed to fetch/create balance", balanceError, createBalError },
          { status: 500 }
        );
      }

      balance = newBalance;
    }

    // 4) Предметы → totalPower + itemsCount
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

    // 5) Спины
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

    // 6) Валюта: Shards потрачено
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

    // 7) Daily status
    const { data: daily, error: dailyError } = await supabase
      .from("daily_rewards")
      .select("*")
      .eq("user_id", user.id)
      .single();

    let dailyCanClaim = true;
    let dailyRemainingSeconds = 0;
    let dailyStreak = 0;

    if (dailyError && dailyError.code !== NO_ROWS_CODE) {
      return NextResponse.json(
        { error: "Failed to fetch daily_rewards", details: dailyError },
        { status: 500 }
      );
    }

    if (daily) {
      const lastClaimAt = new Date(daily.last_claim_at);
      const now = new Date();
      const diffMs = now.getTime() - lastClaimAt.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);

      if (diffHours >= DAILY_COOLDOWN_HOURS) {
        dailyCanClaim = true;
        dailyRemainingSeconds = 0;
        dailyStreak = daily.streak ?? 1;
      } else {
        dailyCanClaim = false;
        const remainingMs = DAILY_COOLDOWN_HOURS * 3600 * 1000 - diffMs;
        dailyRemainingSeconds = Math.ceil(remainingMs / 1000);
        dailyStreak = daily.streak ?? 1;
      }
    }

    // 8) Финальный ответ
    return NextResponse.json({
      bootstrap: {
        user,
        balance,
        totalPower,
        itemsCount,
        level: levelData.level,
        currentLevelPower: levelData.currentLevelPower,
        nextLevelPower: levelData.nextLevelPower,
        progress: levelData.progress,
        spinsCount,
        lastSpinAt,
        totalShardsSpent,
        daily: {
          canClaim: dailyCanClaim,
          remainingSeconds: dailyRemainingSeconds,
          streak: dailyStreak,
          amount: DAILY_REWARD_AMOUNT,
        },
      },
    });
  } catch (err: any) {
    console.error("GET/POST /api/bootstrap error:", err);
    return NextResponse.json(
      { error: "Unexpected error", details: String(err) },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  return handleBootstrap(request);
}

export async function POST(request: Request) {
  return handleBootstrap(request);
}
