import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

const NO_ROWS_CODE = "PGRST116";

const DAILY_REWARD_AMOUNT = 50; // Shards за день
const DAILY_COOLDOWN_HOURS = 24;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const telegramId = searchParams.get("telegram_id");

    if (!telegramId) {
      return NextResponse.json(
        { error: "telegram_id is required" },
        { status: 400 }
      );
    }

    // 1) Находим пользователя (если нет — daily ещё не доступен, но можно создать при claim)
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, telegram_id, username")
      .eq("telegram_id", telegramId)
      .single();

    if (userError && userError.code === NO_ROWS_CODE) {
      // юзер вообще не заводился
      return NextResponse.json({
        exists: false,
        canClaim: true, // можем считать, что сможет сразу при первом claim
        remainingSeconds: 0,
        streak: 0,
        amount: DAILY_REWARD_AMOUNT,
      });
    } else if (userError) {
      return NextResponse.json(
        { error: "Failed to fetch user", details: userError },
        { status: 500 }
      );
    }

    // 2) Проверяем запись в daily_rewards
    const { data: daily, error: dailyError } = await supabase
      .from("daily_rewards")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (dailyError && dailyError.code === NO_ROWS_CODE) {
      // ещё не забирал ни разу
      return NextResponse.json({
        exists: true,
        canClaim: true,
        remainingSeconds: 0,
        streak: 0,
        amount: DAILY_REWARD_AMOUNT,
      });
    } else if (dailyError) {
      return NextResponse.json(
        { error: "Failed to fetch daily_rewards", details: dailyError },
        { status: 500 }
      );
    }

    const lastClaimAt = new Date(daily.last_claim_at);
    const now = new Date();
    const diffMs = now.getTime() - lastClaimAt.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffHours >= DAILY_COOLDOWN_HOURS) {
      return NextResponse.json({
        exists: true,
        canClaim: true,
        remainingSeconds: 0,
        streak: daily.streak ?? 1,
        amount: DAILY_REWARD_AMOUNT,
      });
    }

    const remainingMs = DAILY_COOLDOWN_HOURS * 3600 * 1000 - diffMs;
    const remainingSeconds = Math.ceil(remainingMs / 1000);

    return NextResponse.json({
      exists: true,
      canClaim: false,
      remainingSeconds,
      streak: daily.streak ?? 1,
      amount: DAILY_REWARD_AMOUNT,
    });
  } catch (err: any) {
    console.error("GET /api/daily/status error:", err);
    return NextResponse.json(
      { error: "Unexpected error", details: String(err) },
      { status: 500 }
    );
  }
}
