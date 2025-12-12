import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

const DAILY_REWARD_AMOUNT = 50;
const DAILY_COOLDOWN_HOURS = 24;

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

  const span = nextLevelPower - currentLevelPower;
  const progress =
    span > 0 ? Math.min(1, Math.max(0, (totalPower - currentLevelPower) / span)) : 0;

  return { level, currentLevelPower, nextLevelPower, progress };
}

async function extractTelegramId(request: Request): Promise<string | null> {
  let telegramId: string | null = null;

  // POST body
  if (request.method === "POST") {
    try {
      const body = await request.json();
      const fromBody =
        (typeof body?.telegramId === "string" && body.telegramId.trim()) ||
        (typeof body?.telegram_id === "string" && body.telegram_id.trim()) ||
        null;

      if (fromBody) telegramId = String(fromBody).trim();
    } catch {
      // ignore
    }
  }

  // query
  if (!telegramId) {
    const { searchParams } = new URL(request.url);
    const fromQuery =
      searchParams.get("telegramId") ||
      searchParams.get("telegram_id") ||
      searchParams.get("tg");

    if (fromQuery) telegramId = fromQuery.trim();
  }

  if (!telegramId) return null;

  // Telegram id обычно число
  if (!/^\d+$/.test(telegramId)) return null;

  return telegramId;
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

    // 1) user (maybeSingle => 0 rows НЕ ошибка)
    const { data: userRow, error: userSelectError } = await supabase
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

    // create user if missing
    if (!user) {
      const { data: newUser, error: userCreateError } = await supabase
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

    // 2) balance
    const { data: balanceRow, error: balanceSelectError } = await supabase
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
      const { data: newBalance, error: balanceCreateError } = await supabase
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

    // 3) items power + count
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

    const totalPower =
      (userItems || []).reduce(
        (sum: number, ui: any) => sum + (ui.item?.power_value || 0),
        0
      ) ?? 0;

    const itemsCount = userItems?.length ?? 0;
    const levelData = calcLevel(totalPower);

    // 4) spins
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
    const lastSpinAt = spinsRows?.[0]?.created_at ?? null;

    // 5) currency events (spent shards)
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

    // 6) daily
    const { data: daily, error: dailyError } = await supabase
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
