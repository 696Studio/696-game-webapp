import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

const NO_ROWS_CODE = "PGRST116"; // код "no rows" в Supabase

// Этот токен должен быть одинаковым в .env у веб-прилы и у Telegram-бота
// Например: ADMIN_BOT_TOKEN="super_secret_token_696"
const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN;

type GrantCurrencyBody = {
  telegramId: string;
  currency: "soft" | "hard";
  amount: number; // может быть и отрицательным, но чаще > 0
  reason?: string; // например "admin_grant", "stream_reward"
  metadata?: any; // опционально: откуда именно
};

export async function POST(request: Request) {
  try {
    if (!ADMIN_BOT_TOKEN) {
      return NextResponse.json(
        { error: "ADMIN_BOT_TOKEN is not configured on server" },
        { status: 500 }
      );
    }

    // 1) Проверка авторизации (вызывает только бот)
    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : null;

    if (!token || token !== ADMIN_BOT_TOKEN) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // 2) Парсим тело запроса
    const body = (await request.json().catch(() => ({}))) as Partial<GrantCurrencyBody>;
    const telegramId = body.telegramId;
    const currency = body.currency;
    const amount = body.amount;
    const reason = body.reason || "admin_grant";
    const extraMetadata = body.metadata || null;

    if (!telegramId || !currency || typeof amount !== "number") {
      return NextResponse.json(
        {
          error: "telegramId, currency ('soft' | 'hard') and amount (number) are required",
        },
        { status: 400 }
      );
    }

    if (currency !== "soft" && currency !== "hard") {
      return NextResponse.json(
        { error: "currency must be 'soft' or 'hard'" },
        { status: 400 }
      );
    }

    // 3) Находим или создаём пользователя
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

    // 4) Находим или создаём баланс
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

    // 5) Считаем новый баланс
    let newSoft = balance.soft_balance ?? 0;
    let newHard = balance.hard_balance ?? 0;

    if (currency === "soft") {
      newSoft = newSoft + amount;
      if (newSoft < 0) newSoft = 0; // на всякий случай
    } else if (currency === "hard") {
      newHard = newHard + amount;
      if (newHard < 0) newHard = 0;
    }

    // 6) Обновляем баланс
    const { data: updatedBalance, error: updateBalanceError } = await supabase
      .from("balances")
      .update({
        soft_balance: newSoft,
        hard_balance: newHard,
        updated_at: new Date().toISOString(),
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

    // 7) Создаём запись в currency_events
    const type = amount >= 0 ? "earn" : "spend";
    const balanceAfter =
      currency === "soft" ? updatedBalance.soft_balance : updatedBalance.hard_balance;

    const { error: currencyEventError } = await supabase
      .from("currency_events")
      .insert({
        user_id: user.id,
        type,
        currency,
        amount,
        balance_after: balanceAfter,
        source: reason, // "admin_grant" или что передал бот
        metadata: extraMetadata,
      });

    if (currencyEventError) {
      return NextResponse.json(
        { error: "Failed to log currency event", details: currencyEventError },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        telegram_id: user.telegram_id,
        username: user.username,
      },
      balance: {
        soft_balance: updatedBalance.soft_balance,
        hard_balance: updatedBalance.hard_balance,
      },
      op: {
        currency,
        amount,
        type,
        source: reason,
      },
    });
  } catch (err: any) {
    console.error("POST /api/admin/grant-currency error:", err);
    return NextResponse.json(
      { error: "Unexpected error", details: String(err) },
      { status: 500 }
    );
  }
}
