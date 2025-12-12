import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

// та же формула уровней, что в /api/bootstrap
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

  let progress = 0;
  const span = nextLevelPower - currentLevelPower;
  if (span > 0) {
    progress = Math.min(
      1,
      Math.max(0, (totalPower - currentLevelPower) / span)
    );
  }

  return {
    level,
    currentLevelPower,
    nextLevelPower,
    progress,
  };
}

type AccUser = {
  user_id: string;
  username: string | null;
  totalPower: number;
  itemsCount: number;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limitParam = url.searchParams.get("limit");
    const limit = Math.min(
      Math.max(parseInt(limitParam || "50", 10) || 50, 1),
      200
    );

    // 1) Берём все user_items с join на users + items(power_value)
    // (MVP способ — дальше оптимизируем через SQL view/rpc)
    const { data: rows, error } = await supabase.from("user_items").select(
      `
        user_id,
        user:users (
          id,
          username
        ),
        item:items (
          power_value
        )
      `
    );

    if (error) {
      console.error("leaderboard user_items error:", error);
      return NextResponse.json(
        { error: "Failed to fetch user_items", details: error },
        { status: 500 }
      );
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json({ leaderboard: [] });
    }

    // 2) Агрегируем totalPower/itemsCount по user_id
    const byUser = new Map<string, AccUser>();

    for (const row of rows as any[]) {
      const user = row.user;
      const item = row.item;
      if (!user) continue;

      const userId: string = row.user_id || user.id;
      const power: number = item?.power_value ?? 0;

      if (!byUser.has(userId)) {
        byUser.set(userId, {
          user_id: userId,
          username: user.username ?? null,
          totalPower: 0,
          itemsCount: 0,
        });
      }

      const acc = byUser.get(userId)!;
      acc.totalPower += power;
      acc.itemsCount += 1;
    }

    // 3) Берём spinsCount по каждому юзеру
    const userIds = Array.from(byUser.keys());
    const { data: spinRows, error: spinsError } = await supabase
      .from("chest_spins")
      .select("user_id");

    if (spinsError) {
      console.error("leaderboard chest_spins error:", spinsError);
      return NextResponse.json(
        { error: "Failed to fetch chest_spins", details: spinsError },
        { status: 500 }
      );
    }

    const spinsByUser = new Map<string, number>();
    for (const r of (spinRows || []) as any[]) {
      const uid = r.user_id as string;
      spinsByUser.set(uid, (spinsByUser.get(uid) || 0) + 1);
    }

    // 4) Сортируем по totalPower и формируем ответ
    const leaderboardArray = Array.from(byUser.values())
      .sort((a, b) => b.totalPower - a.totalPower)
      .slice(0, limit)
      .map((u, idx) => {
        const levelData = calcLevel(u.totalPower);
        return {
          rank: idx + 1,
          username: u.username,
          level: levelData.level,
          totalPower: u.totalPower,
          spinsCount: spinsByUser.get(u.user_id) || 0,
        };
      });

    return NextResponse.json({ leaderboard: leaderboardArray });
  } catch (err: any) {
    console.error("GET /api/leaderboard error:", err);
    return NextResponse.json(
      { error: "Unexpected error", details: String(err) },
      { status: 500 }
    );
  }
}
