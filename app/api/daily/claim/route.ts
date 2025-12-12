import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

const DAILY_REWARD_AMOUNT = 50;
const DAILY_COOLDOWN_HOURS = 24;

type DailyClaimBody = {
  telegramId?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as DailyClaimBody;
    const telegramId =
      typeof body.telegramId === "string" ? body.telegramId.trim() : "";

    if (!telegramId) {
      return NextResponse.json(
        { error: "telegramId is required" },
        { status: 400 }
      );
    }

    if (!/^\d+$/.test(telegramId)) {
      return NextResponse.json({ error: "Invalid telegramId" }, { status: 400 });
    }

    // ✅ SECURITY: user должен уже существовать (создаётся через /api/auth/telegram)
    const { data: user, error: userSelectError } = await supabase
      .from("users")
      .select("*")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (userSelectError) {
      return NextResponse.json(
        { error: "Failed to fetch user", details: userSelectError },
        { status: 500 }
      );
    }

    if (!user) {
      return NextResponse.json(
        { error: "User not found (auth required)" },
        { status: 401 }
      );
    }

    // 2) Баланс: можно создать
    const { data: balanceRow, error: balanceSelectError } = await supabase
      .from("balances")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (balanceSelectError) {
      return NextResponse.json(
        { error: "Failed to fetch balance", details: balanceSelectError },
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
        return NextResponse.json(
          { error: "Failed to create balance", details: createBalError },
          { status: 500 }
        );
      }

      balance = newBalance;
    }

    // 3) Daily
    const { data: daily, error: dailySelectError } = await supabase
      .from("daily_rewards")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (dailySelectError) {
      return NextResponse.json(
        { error: "Failed to fetch daily_rewards", details: dailySelectError },
        { status: 500 }
      );
    }

    const now = new Date();

    let newStreak = 1;

    if (!daily) {
      newStreak = 1;
    } else {
      const lastClaimAt = new Date(daily.last_claim_at);
      const diffMs = now.getTime() - lastClaimAt.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);

      if (diffHours < DAILY_COOLDOWN_HOURS) {
        const remainingMs = DAILY_COOLDOWN_HOURS * 3600 * 1000 - diffMs;
        const remainingSeconds = Math.ceil(remainingMs / 1000);

        return NextResponse.json(
          {
            error: "Daily reward already claimed",
            code: "DAILY_ALREADY_CLAIMED",
            remainingSeconds,
          },
          { status: 400 }
        );
      }

      // streak: разрыв <= 48h — продолжаем, иначе сбрасываем
      if (diffHours <= DAILY_COOLDOWN_HOURS * 2) {
        newStreak = (daily.streak ?? 1) + 1;
      } else {
        newStreak = 1;
      }
    }

    // 4) Обновляем баланс
    const prevSoft =
      typeof balance.soft_balance === "number" ? balance.soft_balance : 0;
    const newSoftBalance = prevSoft + DAILY_REWARD_AMOUNT;

    const { data: updatedBalance, error: updateBalanceError } = await supabase
      .from("balances")
      .update({
        soft_balance: newSoftBalance,
        updated_at: now.toISOString(),
      })
      .eq("user_id", user.id)
      .select("*")
      .maybeSingle();

    if (updateBalanceError || !updatedBalance) {
      return NextResponse.json(
        { error: "Failed to update balance", details: updateBalanceError },
        { status: 500 }
      );
    }

    // 5) currency_event
    const { error: currencyEventError } = await supabase
      .from("currency_events")
      .insert({
        user_id: user.id,
        type: "earn",
        currency: "soft",
        amount: DAILY_REWARD_AMOUNT,
        balance_after: newSoftBalance,
        source: "daily_reward",
        metadata: { streak: newStreak },
      });

    if (currencyEventError) {
      return NextResponse.json(
        { error: "Failed to log currency event", details: currencyEventError },
        { status: 500 }
      );
    }

    // 6) upsert daily_rewards
    if (!daily) {
      const { error: insertDailyError } = await supabase
        .from("daily_rewards")
        .insert({
          user_id: user.id,
          last_claim_at: now.toISOString(),
          streak: newStreak,
        });

      if (insertDailyError) {
        return NextResponse.json(
          { error: "Failed to create daily_rewards", details: insertDailyError },
          { status: 500 }
        );
      }
    } else {
      const { error: updateDailyError } = await supabase
        .from("daily_rewards")
        .update({
          last_claim_at: now.toISOString(),
          streak: newStreak,
        })
        .eq("user_id", user.id);

      if (updateDailyError) {
        return NextResponse.json(
          { error: "Failed to update daily_rewards", details: updateDailyError },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      ok: true,
      amount: DAILY_REWARD_AMOUNT,
      newBalance: {
        soft_balance: updatedBalance.soft_balance,
        hard_balance: updatedBalance.hard_balance,
      },
      streak: newStreak,
    });
  } catch (err: any) {
    console.error("POST /api/daily/claim error:", err);
    return NextResponse.json(
      { error: "Unexpected error", details: String(err) },
      { status: 500 }
    );
  }
}
