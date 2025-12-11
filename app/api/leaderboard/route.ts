import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limitParam = url.searchParams.get("limit");
    const limit = Math.min(
      Math.max(parseInt(limitParam || "50", 10) || 50, 1),
      200
    ); // максимум 200, по дефолту 50

    // 1) Тянем связку user_items -> users, items
    const { data: rows, error } = await supabase
      .from("user_items")
      .select(
        `
        user_id,
        user:users (
          id,
          telegram_id,
          username,
          avatar_url
        ),
        item:items (
          id,
          name,
          rarity,
          power_value,
          image_url
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
      // никого пока нет — пустой лидерборд
      return NextResponse.json({ leaderboard: [] });
    }

    type RarityStats = Record<string, number>;

    type AccUser = {
      user_id: string;
      telegram_id: string | null;
      username: string | null;
      avatar_url: string | null;
      totalPower: number;
      itemsCount: number;
      rarityStats: RarityStats;
    };

    const byUser = new Map<string, AccUser>();

    // 2) Агрегируем по пользователю
    for (const row of rows as any[]) {
      const user = row.user;
      const item = row.item;

      if (!user || !item) continue;

      const userId: string = user.id;
      const power: number = item.power_value ?? 0;
      const rarity: string = item.rarity ?? "unknown";

      if (!byUser.has(userId)) {
        byUser.set(userId, {
          user_id: userId,
          telegram_id: user.telegram_id ?? null,
          username: user.username ?? null,
          avatar_url: user.avatar_url ?? null,
          totalPower: 0,
          itemsCount: 0,
          rarityStats: {},
        });
      }

      const acc = byUser.get(userId)!;
      acc.totalPower += power;
      acc.itemsCount += 1;
      acc.rarityStats[rarity] = (acc.rarityStats[rarity] || 0) + 1;
    }

    // 3) Превращаем в массив и сортируем по totalPower
    const leaderboardArray = Array.from(byUser.values())
      .filter((u) => u.totalPower > 0) // можно оставить только тех, у кого есть сила
      .sort((a, b) => b.totalPower - a.totalPower)
      .slice(0, limit);

    // 4) Добавляем rank
    const leaderboardWithRank = leaderboardArray.map((u, index) => ({
      rank: index + 1,
      user_id: u.user_id,
      telegram_id: u.telegram_id,
      username: u.username,
      avatar_url: u.avatar_url,
      totalPower: u.totalPower,
      itemsCount: u.itemsCount,
      rarityStats: u.rarityStats,
    }));

    return NextResponse.json({ leaderboard: leaderboardWithRank });
  } catch (err: any) {
    console.error("GET /api/leaderboard error:", err);
    return NextResponse.json(
      { error: "Unexpected error", details: String(err) },
      { status: 500 }
    );
  }
}
