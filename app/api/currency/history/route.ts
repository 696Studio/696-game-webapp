import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

const NO_ROWS_CODE = "PGRST116";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const telegramId =
      url.searchParams.get("telegramId") || "123456789"; // пока тест
    const limitParam = url.searchParams.get("limit");
    const currencyFilter = url.searchParams.get("currency"); // "soft" | "hard" | null

    const limit = Math.min(
      Math.max(parseInt(limitParam || "100", 10) || 100, 1),
      300
    );

    if (!telegramId) {
      return NextResponse.json(
        { error: "telegramId is required" },
        { status: 400 }
      );
    }

    // 1) Находим пользователя по telegram_id
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, telegram_id, username, avatar_url")
      .eq("telegram_id", telegramId)
      .single();

    if (userError && userError.code === NO_ROWS_CODE) {
      // у юзера ещё нет записи → пустая история
      return NextResponse.json({ events: [] });
    } else if (userError) {
      return NextResponse.json(
        { error: "Failed to fetch user", details: userError },
        { status: 500 }
      );
    }

    // 2) Тянем currency_events этого пользователя
    let query = supabase
      .from("currency_events")
      .select(
        `
        id,
        created_at,
        type,
        currency,
        amount,
        balance_after,
        source,
        metadata
      `
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (currencyFilter === "soft" || currencyFilter === "hard") {
      query = query.eq("currency", currencyFilter);
    }

    const { data: events, error: eventsError } = await query;

    if (eventsError) {
      console.error("currency history error:", eventsError);
      return NextResponse.json(
        { error: "Failed to fetch currency events", details: eventsError },
        { status: 500 }
      );
    }

    if (!events || events.length === 0) {
      return NextResponse.json({ events: [] });
    }

    // 3) Приводим к аккуратному формату
    const result = (events as any[]).map((ev) => ({
      id: ev.id,
      created_at: ev.created_at,
      type: ev.type, // "earn" | "spend" | любое твое значение
      currency: ev.currency, // "soft" | "hard"
      amount: ev.amount, // может быть отрицательным для spend
      balance_after: ev.balance_after,
      source: ev.source, // "chest", "admin_grant", "daily_reward" и т.п.
      metadata: ev.metadata || null, // JSON, можно использовать для деталей
    }));

    return NextResponse.json({ events: result });
  } catch (err: any) {
    console.error("GET /api/currency/history error:", err);
    return NextResponse.json(
      { error: "Unexpected error", details: String(err) },
      { status: 500 }
    );
  }
}
