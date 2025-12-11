import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import crypto from "crypto";

const NO_ROWS_CODE = "PGRST116";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN_696;

if (!BOT_TOKEN) {
  console.warn(
    "[WARN] TELEGRAM_BOT_TOKEN_696 is not set. /api/auth/telegram will always fail."
  );
}

type TelegramWebAppUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
};

type AuthTelegramBody = {
  initData?: string;
};

// Валидация initData по документации Telegram WebApp
function validateTelegramInitData(initData: string, botToken: string): {
  ok: boolean;
  user?: TelegramWebAppUser;
} {
  try {
    const urlSearchParams = new URLSearchParams(initData);
    const hash = urlSearchParams.get("hash");
    if (!hash) {
      return { ok: false };
    }

    // Собираем все пары key=value кроме hash
    const data: string[] = [];
    urlSearchParams.forEach((value, key) => {
      if (key === "hash") return;
      data.push(`${key}=${value}`);
    });

    // Сортируем по key
    data.sort((a, b) => {
      const ak = a.split("=")[0];
      const bk = b.split("=")[0];
      return ak.localeCompare(bk);
    });

    const dataCheckString = data.join("\n");

    // Создаём секрет по правилу:
    // secretKey = sha256("WebAppData" + bot_token)
    const secretKey = crypto
      .createHash("sha256")
      .update("WebAppData" + botToken)
      .digest();

    const hmac = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    if (hmac !== hash) {
      return { ok: false };
    }

    // Если подпись ок — достаём user (в JSON внутри поля "user")
    const userStr = urlSearchParams.get("user");
    if (!userStr) {
      // user обязателен для нас
      return { ok: false };
    }

    const user = JSON.parse(userStr) as TelegramWebAppUser;
    if (!user.id) {
      return { ok: false };
    }

    return { ok: true, user };
  } catch (e) {
    console.error("validateTelegramInitData error:", e);
    return { ok: false };
  }
}

export async function POST(request: Request) {
  try {
    if (!BOT_TOKEN) {
      return NextResponse.json(
        { error: "Server auth not configured" },
        { status: 500 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as AuthTelegramBody;
    const initData = body.initData;

    if (!initData) {
      return NextResponse.json(
        { error: "initData is required" },
        { status: 400 }
      );
    }

    // 1) Проверяем подпись
    const validation = validateTelegramInitData(initData, BOT_TOKEN);

    if (!validation.ok || !validation.user) {
      return NextResponse.json(
        { error: "Invalid Telegram initData" },
        { status: 401 }
      );
    }

    const tgUser = validation.user;
    const telegramId = String(tgUser.id);

    // 2) Находим или создаём пользователя
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
          username: tgUser.username || `user_${telegramId.slice(-4)}`,
          avatar_url: tgUser.photo_url || null,
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

    // 3) Находим или создаём баланс
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

    // 4) Можно сразу посчитать базовый totalPower (по желанию)
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

    return NextResponse.json({
      ok: true,
      telegramUser: tgUser,
      user,
      balance,
      totalPower,
    });
  } catch (err: any) {
    console.error("POST /api/auth/telegram error:", err);
    return NextResponse.json(
      { error: "Unexpected error", details: String(err) },
      { status: 500 }
    );
  }
}
