// app/api/chests/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export async function GET() {
  try {
    // 1) Тянем сундуки
    const { data: chests, error: chestsError } = await supabase
      .from("chests")
      .select(
        `
        id,
        code,
        name,
        description,
        price_soft,
        price_hard,
        chest_items:chest_items (
          drop_weight,
          item:items (
            id,
            name,
            rarity,
            power_value,
            image_url
          )
        )
      `
      )
      .order("price_soft", { ascending: true });

    if (chestsError) {
      return NextResponse.json(
        { error: "Failed to fetch chests", details: chestsError },
        { status: 500 }
      );
    }

    if (!chests || chests.length === 0) {
      return NextResponse.json({ chests: [] });
    }

    // 2) Приводим к удобному формату (без жёсткого UI, чисто данные)
    const result = chests.map((chest: any) => {
      const loot = (chest.chest_items || [])
        .map((ci: any) => ({
          drop_weight: ci.drop_weight,
          id: ci.item?.id,
          name: ci.item?.name,
          rarity: ci.item?.rarity,
          power_value: ci.item?.power_value,
          image_url: ci.item?.image_url,
        }))
        .filter((i: any) => i.id);

      // Быстрый подсчёт шансов по редкости (суммарные веса)
      const rarityWeights: Record<string, number> = {};
      for (const l of loot) {
        const r = l.rarity || "unknown";
        rarityWeights[r] = (rarityWeights[r] || 0) + (l.drop_weight || 0);
      }

      const totalWeight = Object.values(rarityWeights).reduce(
        (sum, w) => sum + w,
        0
      );

      const rarityChances = Object.fromEntries(
        Object.entries(rarityWeights).map(([rarity, w]) => [
          rarity,
          totalWeight > 0 ? w / totalWeight : 0,
        ])
      );

      return {
        id: chest.id,
        code: chest.code,
        name: chest.name,
        description: chest.description,
        price_soft: chest.price_soft,
        price_hard: chest.price_hard,
        loot,
        rarityChances,
      };
    });

    return NextResponse.json({ chests: result });
  } catch (err: any) {
    console.error("GET /api/chests error:", err);
    return NextResponse.json(
      { error: "Unexpected error", details: String(err) },
      { status: 500 }
    );
  }
}
