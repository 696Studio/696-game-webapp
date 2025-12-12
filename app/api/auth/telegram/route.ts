import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import crypto from "crypto";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN_696;

// можно ограничить "свежесть" initData (например 10 минут)
const MAX_INITDATA_AGE_SECONDS = 10 * 60;

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

// Telegram WebApp initData validation (корректная схема)
function validateTelegramInitData(
  initData: string,
  botToken: string
): { ok: boolean; user?: TelegramWebAppUser } {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return { ok: false };

    // OPTIONAL: проверка auth_date (защита от reuse старых initData)
    const authDateStr = params.get("auth_date");
    if (!authDateStr) return { ok: false };

    const authDate = parseInt(authDateStr, 10);
    if (!Number.isFinite(authDate)) return { ok: false };

    const nowSec = Math.floor(Date.now() / 1000);
    const age = nowSec - authDate;
    if (age < 0 || age > MAX_INITDATA_AGE_SECONDS) {
      return { ok: false };
    }

    // data_check_string: сортируем key=value (кроме hash) по key и соединяем \n
    const pairs: string[] = [];
    params.forEach((value, key) => {
      if (key === "hash") return;
      pairs.push(`${key}=${value}`);
    });

    pairs.sort((a, b) => {
      const ak = a.split("=")[0];
      const bk = b.split("=")[0];
      return ak.localeCompare(bk);
    });

    const dataCheckString = pairs.join("\n");

    // secretKey = HMAC_SHA256(key="WebAppData", message=bot_token)
    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(botToken)
      .digest();

    // computedHash = HMAC_SHA256(key=secretKey, message=dataCheckString).hex
    const computedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    // timing-safe compare
    const a = Buffer.from(computedHash, "hex");
    const b = Buffer.from(hash, "hex");
    if (a.length !== b.length) return { ok: false };
    if (!crypto.timingSafeEqual(a, b)) return { ok: false };

    // user обязателен для нас
    const userStr = params.get("user");
    if (!userStr) return { ok: false };

    const user = JSON.parse(userStr) as TelegramWebAppUser;
    if (!user?.id) return { ok: false };

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
    const initData =
      typeof body.initData === "string" ? body.initData.trim() : "";

    if (!initData) {
      return NextResponse.json({ error: "initData is required" }, { status: 400 });
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

    // 2) Находим или создаём пользователя (без .single + PGRST116)
    const { data: userRow, error: userSelectError } = await supabase
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

    let user = userRow;

    if (!user) {
      const { data: newUser, error: createError } = await supabase
        .from("users")
        .insert({
          telegram_id: telegramId,
          username: tgUser.username || `user_${telegramId.slice(-4)}`,
          avatar_url: tgUser.photo_url || null,
          first_name: tgUser.first_name || null,
        })
        .select("*")
        .maybeSingle();

      if (createError || !newUser) {
        return NextResponse.json(
          { error: "Failed to create user", details: createError },
          { status: 500 }
        );
      }

      user = newUser;
    }

    // 3) Находим или создаём баланс
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

    // 4) totalPower (best effort)
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
