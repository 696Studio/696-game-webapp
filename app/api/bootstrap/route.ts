import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Body = { telegramId?: string };

function calcLevel(totalPower: number) {
  const level = Math.max(1, Math.floor(totalPower / 100) + 1);
  const currentLevelPower = (level - 1) * 100;
  const nextLevelPower = level * 100;
  const progress =
    nextLevelPower === currentLevelPower
      ? 0
      : (totalPower - currentLevelPower) /
        (nextLevelPower - currentLevelPower);

  return {
    level,
    currentLevelPower,
    nextLevelPower,
    progress: Math.max(0, Math.min(1, progress)),
  };
}

function computeDaily(dailyRow: any | null) {
  const DAILY_COOLDOWN_HOURS = 24;
  const amount = 50;

  if (!dailyRow?.last_claim_at) {
    return {
      canClaim: true,
      remainingSeconds: 0,
      streak: dailyRow?.streak ?? 0,
      amount,
    };
  }

  const now = new Date();
  const last = new Date(dailyRow.last_claim_at);
  const diffMs = now.getTime() - last.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours >= DAILY_COOLDOWN_HOURS) {
    return {
      canClaim: true,
      remainingSeconds: 0,
      streak: dailyRow?.streak ?? 1,
      amount,
    };
  }

  const remainingMs = DAILY_COOLDOWN_HOURS * 3600 * 1000 - diffMs;
  const remainingSeconds = Math.max(
    0,
    Math.ceil(remainingMs / 1000)
  );

  return {
    canClaim: false,
    remainingSeconds,
    streak: dailyRow?.streak ?? 1,
    amount,
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const telegramId =
      typeof body.telegramId === "string"
        ? body.telegramId.trim()
        : "";

    if (!telegramId) {
      return NextResponse.json(
        { error: "telegramId is required" },
        { status: 400 }
      );
    }

    /* -------------------------------------------------
       1) USER — ATOMIC UPSERT (CRITICAL FIX)
    -------------------------------------------------- */
    const { data: user, error: userErr } =
      await supabaseAdmin
        .from("users")
        .upsert(
          {
            telegram_id: telegramId,
            username: `user_${telegramId.slice(-4)}`,
          },
          { onConflict: "telegram_id" }
        )
        .select("*")
        .single();

    if (userErr || !user) {
      return NextResponse.json(
        { error: "Failed to upsert user", details: userErr },
        { status: 500 }
      );
    }

    /* -------------------------------------------------
       2) BALANCE
    -------------------------------------------------- */
    const { data: balRow, error: balErr } =
      await supabaseAdmin
        .from("balances")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

    if (balErr) {
      return NextResponse.json(
        { error: "Failed to fetch balance", details: balErr },
        { status: 500 }
      );
    }

    let balance = balRow;

    if (!balance) {
      const { data: newBal, error: newBalErr } =
        await supabaseAdmin
          .from("balances")
          .insert({
            user_id: user.id,
            soft_balance: 0,
            hard_balance: 0,
          })
          .select("*")
          .single();

      if (newBalErr || !newBal) {
        return NextResponse.json(
          {
            error: "Failed to create balance",
            details: newBalErr,
          },
          { status: 500 }
        );
      }

      balance = newBal;
    }

    /* -------------------------------------------------
       3) ITEMS / POWER
    -------------------------------------------------- */
    const { data: userItems, error: itemsErr } =
      await supabaseAdmin
        .from("user_items")
        .select("id, item:items(power_value)")
        .eq("user_id", user.id);

    if (itemsErr) {
      return NextResponse.json(
        { error: "Failed to fetch items", details: itemsErr },
        { status: 500 }
      );
    }

    const itemsCount = userItems?.length ?? 0;
    const totalPower =
      userItems?.reduce(
        (sum: number, ui: any) =>
          sum + (ui.item?.power_value || 0),
        0
      ) ?? 0;

    const levelInfo = calcLevel(totalPower);

    /* -------------------------------------------------
       4) SPINS
    -------------------------------------------------- */
    const { count: spinsCount, error: spinsErr } =
      await supabaseAdmin
        .from("chest_spins")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);

    if (spinsErr) {
      return NextResponse.json(
        { error: "Failed to fetch spins", details: spinsErr },
        { status: 500 }
      );
    }

    const { data: lastSpinRow } =
      await supabaseAdmin
        .from("chest_spins")
        .select("created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    /* -------------------------------------------------
       5) SHARDS SPENT
    -------------------------------------------------- */
    const { data: spentRows, error: spentErr } =
      await supabaseAdmin
        .from("currency_events")
        .select("amount")
        .eq("user_id", user.id)
        .eq("currency", "soft")
        .eq("type", "spend");

    if (spentErr) {
      return NextResponse.json(
        {
          error: "Failed to fetch currency history",
          details: spentErr,
        },
        { status: 500 }
      );
    }

    const totalShardsSpent =
      spentRows?.reduce(
        (sum: number, r: any) =>
          sum + Math.abs(r.amount || 0),
        0
      ) ?? 0;

    /* -------------------------------------------------
       6) DAILY
    -------------------------------------------------- */
    const { data: dailyRow, error: dailyErr } =
      await supabaseAdmin
        .from("daily_rewards")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

    if (dailyErr) {
      return NextResponse.json(
        {
          error: "Failed to fetch daily_rewards",
          details: dailyErr,
        },
        { status: 500 }
      );
    }

    const daily = computeDaily(dailyRow);

    /* -------------------------------------------------
       RESPONSE
    -------------------------------------------------- */
    return NextResponse.json({
      telegramId,
      bootstrap: {
        user: {
          id: user.id,
          telegram_id: user.telegram_id,
          username: user.username ?? null,
          first_name: user.first_name ?? null,
          avatar_url: user.avatar_url ?? null,
        },
        balance: {
          user_id: user.id,
          soft_balance: balance.soft_balance ?? 0,
          hard_balance: balance.hard_balance ?? 0,
        },
        totalPower,
        itemsCount,
        level: levelInfo.level,
        currentLevelPower: levelInfo.currentLevelPower,
        nextLevelPower: levelInfo.nextLevelPower,
        progress: levelInfo.progress,
        spinsCount: spinsCount ?? 0,
        lastSpinAt: lastSpinRow?.created_at ?? null,
        totalShardsSpent,
        daily,
      },
    });
  } catch (e: any) {
    console.error("POST /api/bootstrap error:", e);
    return NextResponse.json(
      {
        error: "Unexpected error",
        details: String(e?.message || e),
      },
      { status: 500 }
    );
  }
}
