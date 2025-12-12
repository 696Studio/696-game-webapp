import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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

async function extractTelegramId(request: Request): Promise<string | null> {
  let telegramId: string | null = null;

  // 1) POST body
  if (request.method === "POST") {
    try {
      const body = await request.json();
      const fromBody =
        (typeof body?.telegramId === "string" && body.telegramId.trim()) ||
        (typeof body?.telegram_id === "string" && body.telegram_id.trim()) ||
        null;

      if (fromBody) telegramId = String(fromBody).trim();
    } catch {
      // пустое тело — ок
    }
  }

  // 2) query params
  if (!telegramId) {
    const { searchParams } = new URL(request.url);
    const fromQuery =
      searchParams.get("telegramId") ||
      searchParams.get("telegram_id") ||
      searchParams.get("tg");

    if (fromQuery) telegramId = fromQuery.trim();
  }

  if (!telegramId) return null;

  // простая валидация (Telegram id обычно число)
  if (!/^\d+$/.test(telegramId)) return null;

  return telegramId;
}

async function handleBootstrap(request: Request) {
  try {
    // 1) Достаём telegramId (БЕЗ fallback)
    const telegramId = await extractTelegramId(request);

    if (!telegramId) {
      return NextResponse.json(
        { error: "telegramId is required" },
        { status: 400 }
      );
    }

    // 2) Находим пользователя (0 строк — НЕ ошибка)
    const { data: userRow, error: userSelectError } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (userSelectError) {
      console.error("bootstrap: user select error", userSelectError);
      return NextResponse.json(
        { error: "Failed to fetch user", details: userSelectError },
        { status: 500 }
      );
    }

    let user = userRow;

    // 2.1. Если юзера нет — создаём
    if (!user) {
      const { data: newUser, error: userCreateError } = await supabaseAdmin
        .from("users")
        .insert({
          telegram_id: telegramId,
          username: `user_${telegramId.slice(-4)}`,
        })
        .select("*")
        .maybeSingle();

      if (userCreateError || !newUser) {
        console.error("bootstrap: user create error", userCreateError);
        return NextResponse.json(
          { error: "Failed to create user", details: userCreateError },
          { status: 500 }
        );
      }

      user = newUser;
    }

    // 3) Баланс
    const { data: balanceRow, error: balanceSelectError } = await supabaseAdmin
      .from("balances")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (balanceSelectError) {
      console.error("bootstrap: balance select error", balanceSelectError);
      return NextResponse.json(
        { error: "Failed to fetch balance", details: balanceSelectError },
        { status: 500 }
      );
    }

    let balance = balanceRow;

    if (!balance) {
      const { data: newBalance, error: balanceCreateError } = await supabaseAdmin
        .from("balances")
        .insert({ user_id: user.id, soft_balance: 0, hard_balance: 0 })
        .select("*")
        .maybeSingle();

      if (balanceCreateError || !newBalance) {
        console.error("bootstrap: balance create error", balanceCreateError);
        return NextResponse.json(
          { error: "Failed to create balance", details: balanceCreateError },
          { status: 500 }
        );
      }

      balance = newBalance;
    }

    // 4) Предметы → power + count
    const { data: userItems, error: itemsError } = await supabaseAdmin
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

    const totalPower =
      (userItems || []).reduce(
        (sum: number, ui: any) => sum + (ui.item?.power_value || 0),
        0
      ) ?? 0;

    const itemsCount = userItems?.length ?? 0;
    const levelData = calcLevel(totalPower);

    // 5) Спины
    const { data: spinsRows, error: spinsError } = await supabaseAdmin
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
    const lastSpinAt = spinsRows?.[0]?.created_at ?? null;

    // 6) Валюта (сколько потратил)
    const { data: currencyEvents, error: currencyError } = await supabaseAdmin
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
    const { data: daily, error: dailyError } = await supabaseAdmin
      .from("daily_rewards")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (dailyError) {
      console.error("bootstrap: daily error", dailyError);
      return NextResponse.json(
        { error: "Failed to fetch daily_rewards", details: dailyError },
        { status: 500 }
      );
    }

    let dailyCanClaim = true;
    let dailyRemainingSeconds = 0;
    let dailyStreak = 1;

    if (daily?.last_claim_at) {
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
    } else if (daily?.streak != null) {
      dailyStreak = daily.streak ?? 1;
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
