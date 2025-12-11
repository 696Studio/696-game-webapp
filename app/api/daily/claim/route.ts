import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

const NO_ROWS_CODE = "PGRST116";

const DAILY_REWARD_AMOUNT = 50;
const DAILY_COOLDOWN_HOURS = 24;

type DailyClaimBody = {
  telegramId?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as DailyClaimBody;
    const telegramId = body.telegramId;

    if (!telegramId) {
      return NextResponse.json(
        { error: "telegramId is required" },
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
        .insert({ user_id: user.id, soft_balance: 0, hard_balance: 0 })
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

    // 3) Проверяем/обновляем daily_rewards
    const { data: daily, error: dailyError } = await supabase
      .from("daily_rewards")
      .select("*")
      .eq("user_id", user.id)
      .single();

    const now = new Date();

    let canClaim = false;
    let newStreak = 1;

    if (dailyError && dailyError.code === NO_ROWS_CODE) {
      // первый раз — ок
      canClaim = true;
      newStreak = 1;
    } else if (dailyError) {
      return NextResponse.json(
        { error: "Failed to fetch daily_rewards", details: dailyError },
        { status: 500 }
      );
    } else if (daily) {
      const lastClaimAt = new Date(daily.last_claim_at);
      const diffMs = now.getTime() - lastClaimAt.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);

      if (diffHours >= DAILY_COOLDOWN_HOURS) {
        canClaim = true;

        // простая логика streak: если разрыв <= 48h — продолжаем, иначе сбрасываем
        if (diffHours <= DAILY_COOLDOWN_HOURS * 2) {
          newStreak = (daily.streak ?? 1) + 1;
        } else {
          newStreak = 1;
        }
      } else {
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
    }

    if (!canClaim) {
      return NextResponse.json(
        { error: "Cannot claim daily reward", code: "DAILY_BLOCKED" },
        { status: 400 }
      );
    }

    // 4) Обновляем баланс (начисляем Shards)
    const newSoftBalance =
      (balance.soft_balance ?? 0) + DAILY_REWARD_AMOUNT;

    const { data: updatedBalance, error: updateBalanceError } = await supabase
      .from("balances")
      .update({
        soft_balance: newSoftBalance,
        updated_at: now.toISOString(),
      })
      .eq("user_id", user.id)
      .select("*")
      .single();

    if (updateBalanceError || !updatedBalance) {
      return NextResponse.json(
        { error: "Failed to update balance", details: updateBalanceError },
        { status: 500 }
      );
    }

    // 5) Логируем currency_event
    const { error: currencyEventError } = await supabase
      .from("currency_events")
      .insert({
        user_id: user.id,
        type: "earn",
        currency: "soft",
        amount: DAILY_REWARD_AMOUNT,
        balance_after: newSoftBalance,
        source: "daily_reward",
        metadata: {
          streak: newStreak,
        },
      });

    if (currencyEventError) {
      return NextResponse.json(
        { error: "Failed to log currency event", details: currencyEventError },
        { status: 500 }
      );
    }

    // 6) Обновляем/создаём daily_rewards
    if (dailyError && dailyError.code === NO_ROWS_CODE) {
      await supabase.from("daily_rewards").insert({
        user_id: user.id,
        last_claim_at: now.toISOString(),
        streak: newStreak,
      });
    } else {
      await supabase
        .from("daily_rewards")
        .update({
          last_claim_at: now.toISOString(),
          streak: newStreak,
        })
        .eq("user_id", user.id);
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
