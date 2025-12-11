import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

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
    // 1) Достаём telegramId: POST body -> query -> fallback
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

    if (!telegramId) {
      // fallback, чтобы сайт просто открывался в браузере
      telegramId = "123456789";
    }

    // 2) Находим пользователя (0 строк — НЕ ошибка)
    const {
      data: userRow,
      error: userError,
    } = await supabase
      .from("users")
      .select("*")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (userError) {
      console.error("bootstrap: user select error", userError);
    }

    let user = userRow;

    // 2.1. Если юзера нет — создаём
    if (!user) {
      const {
        data: newUser,
        error: createError,
      } = await supabase
        .from("users")
        .insert({
          telegram_id: telegramId,
          username: `user_${telegramId.slice(-4)}`,
        })
        .select("*")
        .maybeSingle();

      if (createError || !newUser) {
        console.error("bootstrap: user create error", createError);
        return NextResponse.json(
          {
            error: "Failed to fetch/create user",
            telegramId,
            userError,
            createError,
          },
          { status: 500 }
        );
      }

      user = newUser;
    }

    // 3) Баланс
    const {
      data: balanceRow,
      error: balanceError,
    } = await supabase
      .from("balances")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (balanceError) {
      console.error("bootstrap: balance select error", balanceError);
    }

    let balance = balanceRow;

    if (!balance) {
      const {
        data: newBalance,
        error: createBalError,
      } = await supabase
        .from("balances")
        .insert({ user_id: user.id, soft_balance: 0, hard_balance: 0 })
        .select("*")
        .maybeSingle();

      if (createBalError || !newBalance) {
        console.error("bootstrap: balance create error", createBalError);
        return NextResponse.json(
          {
            error: "Failed to fetch/create balance",
            balanceError,
            createBalError,
          },
          { status: 500 }
        );
      }

      balance = newBalance;
    }

    // 4) Предметы → power + count
    const { data: userItems, error: itemsError } = await supabase
      .from("user_items")
      .select("id, item:items(power_value)")
      .eq("user_id", user.id);

    if (itemsError) {
      console.error("bootstrap: items error", itemsError);
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
      console.error("bootstrap: spins error", spinsError);
      return NextResponse.json(
        { error: "Failed to fetch chest spins", details: spinsError },
        { status: 500 }
      );
    }

    const spinsCount = spinsRows?.length ?? 0;
    const lastSpinAt =
      spinsRows && spinsRows.length > 0 ? spinsRows[0].created_at : null;

    // 6) Валюта
    const { data: currencyEvents, error: currencyError } = await supabase
      .from("currency_events")
      .select("type, currency, amount")
      .eq("user_id", user.id);

    if (currencyError) {
      console.error("bootstrap: currency events error", currencyError);
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

    // 7) Daily
    const { data: daily, error: dailyError } = await supabase
      .from("daily_rewards")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (dailyError) {
      console.error("bootstrap: daily error", dailyError);
    }

    let dailyCanClaim = true;
    let dailyRemainingSeconds = 0;
    let dailyStreak = 0;

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

    // 8) Ответ
    return NextResponse.json({
      telegramId,
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
    console.error("GET/POST /api/bootstrap unexpected error:", err);
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
