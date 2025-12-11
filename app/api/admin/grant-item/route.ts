import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

const NO_ROWS_CODE = "PGRST116"; // код "no rows" в Supabase

// Тот же токен, что и для /api/admin/grant-currency
const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN;

type GrantItemBody = {
  telegramId: string;
  itemId: string;
  reason?: string;   // пример: "admin_grant", "stream_reward"
  metadata?: any;    // опционально
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

    // 2) Парсим тело
    const body = (await request.json().catch(() => ({}))) as Partial<GrantItemBody>;
    const telegramId = body.telegramId;
    const itemId = body.itemId;
    const reason = body.reason || "admin_grant";
    const extraMetadata = body.metadata || null;

    if (!telegramId || !itemId) {
      return NextResponse.json(
        { error: "telegramId and itemId are required" },
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

    // 4) На всякий случай создаём баланс, если нет
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

    // 5) Проверяем, что предмет существует
    const { data: item, error: itemError } = await supabase
      .from("items")
      .select("*")
      .eq("id", itemId)
      .single();

    if (itemError || !item) {
      return NextResponse.json(
        { error: "Item not found", details: itemError },
        { status: 400 }
      );
    }

    // 6) Создаём user_item
    const { data: userItem, error: userItemError } = await supabase
      .from("user_items")
      .insert({
        user_id: user.id,
        item_id: item.id,
        obtained_from: reason,  // можно потом красиво использовать в UI
        metadata: extraMetadata,
      })
      .select("*")
      .single();

    if (userItemError || !userItem) {
      return NextResponse.json(
        { error: "Failed to create user item", details: userItemError },
        { status: 500 }
      );
    }

    // 7) Увеличиваем total_minted у айтема (best effort)
    await supabase
      .from("items")
      .update({
        total_minted: (item.total_minted || 0) + 1,
      })
      .eq("id", item.id);

    // 8) (опционально) можно было бы логировать в отдельную таблицу item_events —
    // пока не делаем, ты и так можешь видеть user_items по игроку.

    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        telegram_id: user.telegram_id,
        username: user.username,
      },
      balance: {
        soft_balance: balance.soft_balance,
        hard_balance: balance.hard_balance,
      },
      item: {
        id: item.id,
        name: item.name,
        type: item.type,
        rarity: item.rarity,
        power_value: item.power_value,
        image_url: item.image_url,
      },
      user_item: {
        id: userItem.id,
        obtained_from: userItem.obtained_from,
      },
    });
  } catch (err: any) {
    console.error("POST /api/admin/grant-item error:", err);
    return NextResponse.json(
      { error: "Unexpected error", details: String(err) },
      { status: 500 }
    );
  }
}
