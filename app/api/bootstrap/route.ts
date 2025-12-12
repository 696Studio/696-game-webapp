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

async function extractTelegramId(request: Request): Promise<string | null> {
  let telegramId: string | null = null;

  // 1) POST body
  if (request.method === "POST") {
    try {
      const body = await request.json();
      if (body && typeof body.telegramId === "string" && body.telegramId.trim()) {
        telegramId = body.telegramId.trim();
      }
      if (
        !telegramId &&
        body &&
        typeof body.telegram_id === "string" &&
        body.telegram_id.trim()
      ) {
        telegramId = body.telegram_id.trim();
      }
    } catch {
      // ok
    }
  }

  // 2) query params
  if (!telegramId) {
    const { searchParams } = new URL(request.url);
    telegramId =
      searchParams.get("telegramId") ||
      searchParams.get("telegram_id") ||
      searchParams.get("tg") ||
      null;

    if (telegramId) telegramId = telegramId.trim();
  }

  // валидация
  if (telegramId && !/^\d+$/.test(telegramId)) {
    return null;
  }

  return telegramId || null;
}

async function handleBootstrap(request: Request) {
  try {
    const telegramId = await extractTelegramId(request);

    if (!telegramId) {
      return NextResponse.json(
        { error: "telegramId is required" },
        { status: 400 }
      );
    }

    // ✅ SECURITY: bootstrap больше НЕ создаёт пользователя.
    // Пользователь создаётся только через /api/auth/telegram после проверки initData.
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (userError) {
      console.error("bootstrap: user select error", userError);
      return NextResponse.json(
        { error: "Failed to fetch user", details: userError },
        { status: 500 }
      );
    }

    if (!user) {
      return NextResponse.json(
        { error: "User not found (auth required)" },
        { status: 401 }
      );
    }

    // Баланс: можно создать, если его нет
    const { data: balanceRow, error: balanceError } = await supabase
      .from("balances")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (balanceError) {
      console.error("bootstrap: balance select error", balanceError);
      return NextResponse.json(
        { error: "Failed to fetch balance", details: balanceError },
        { status: 500 }
      );
    }

    let balance = balanceRow;

    if (!balance) {
      const { data: newBalance, error: createBalError } = await supabase
        .from("balances")
        .insert({ user_id: user.id, soft_balance: 0, hard_balance: 0 })
        .select("*")
        .maybeSingle();

      if (createBalError || !newBalance) {
        console.error("bootstrap: balance create error", createBalError);
        return NextResponse.json(
          { error: "Failed to create balance", details: createBalError },
          { status: 500 }
        );
      }

      balance = newBalance;
    }

    // Items → power + count
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

    // Spins
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

    // Currency stats
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

    // Daily
    const { data: daily, error: dailyError } = await supabase
      .from("daily_rewards")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (dailyError) {
      console.error("bootstrap: daily error", dailyError);
      // daily не критично — продолжаем
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
