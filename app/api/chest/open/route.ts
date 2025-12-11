import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

const NO_ROWS_CODE = "PGRST116";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const telegramId: string = body.telegramId || "123456789"; // пока тест
    const chestCode: string = body.chestCode || "soft_basic";

    // 1) Находим или создаём пользователя
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

    // 2) Находим или создаём баланс
    let { data: balance, error: balanceError } = await supabase
      .from("balances")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (balanceError && balanceError.code === NO_ROWS_CODE) {
      const { data: newBalance, error: createBalError } = await supabase
        .from("balances")
        .insert({ user_id: user.id })
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

    // 3) Находим сундук по коду
    const { data: chest, error: chestError } = await supabase
      .from("chests")
      .select("*")
      .eq("code", chestCode)
      .single();

    if (chestError || !chest) {
      return NextResponse.json(
        { error: "Chest not found", details: chestError },
        { status: 400 }
      );
    }

    const priceSoft: number = chest.price_soft ?? 0;
    const priceHard: number = chest.price_hard ?? 0;

    // На MVP используем только soft-валюту
    if (priceSoft <= 0) {
      return NextResponse.json(
        { error: "Chest price not configured (soft)" },
        { status: 400 }
      );
    }

    if (balance.soft_balance < priceSoft) {
      return NextResponse.json(
        { error: "Not enough Shards", code: "INSUFFICIENT_FUNDS" },
        { status: 400 }
      );
    }

    // 4) Тянем пул предметов ИМЕННО для этого сундука через chest_items
    const { data: chestItems, error: chestItemsError } = await supabase
      .from("chest_items")
      .select(
        `
        id,
        drop_weight,
        item:items (
          id,
          name,
          rarity,
          power_value,
          image_url,
          total_minted,
          is_limited,
          max_mint
        )
      `
      )
      .eq("chest_id", chest.id);

    if (chestItemsError) {
      return NextResponse.json(
        { error: "Failed to fetch chest items", details: chestItemsError },
        { status: 500 }
      );
    }

    if (!chestItems || chestItems.length === 0) {
      return NextResponse.json(
        { error: "Chest has no items configured" },
        { status: 500 }
      );
    }

    // 5) Фильтрация по лимитам (если is_limited + max_mint)
    const availableChestItems = chestItems.filter((ci: any) => {
      const item = ci.item;
      if (!item) return false;

      if (item.is_limited && item.max_mint != null) {
        const totalMinted = item.total_minted ?? 0;
        return totalMinted < item.max_mint;
      }

      return true;
    });

    const finalPool = availableChestItems.length > 0 ? availableChestItems : chestItems;

    // 6) Выбираем предмет по весам chest_items.drop_weight
    const totalWeight = finalPool.reduce(
      (sum: number, ci: any) => sum + (ci.drop_weight || 0),
      0
    );

    if (totalWeight <= 0) {
      return NextResponse.json(
        { error: "Invalid drop weights configuration" },
        { status: 500 }
      );
    }

    let rand = Math.random() * totalWeight;
    let selectedChestItem = finalPool[finalPool.length - 1];

    for (const ci of finalPool) {
      const weight = ci.drop_weight || 0;
      if (rand < weight) {
        selectedChestItem = ci;
        break;
      }
      rand -= weight;
    }

    const selectedItem = selectedChestItem.item;

    if (!selectedItem) {
      return NextResponse.json(
        { error: "Selected item not found" },
        { status: 500 }
      );
    }

    // 7) Списываем Shards и пишем currency_event
    const newSoftBalance = balance.soft_balance - priceSoft;

    const { error: updateBalanceError } = await supabase
      .from("balances")
      .update({
        soft_balance: newSoftBalance,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);

    if (updateBalanceError) {
      return NextResponse.json(
        { error: "Failed to update balance", details: updateBalanceError },
        { status: 500 }
      );
    }

    const { error: currencyEventError } = await supabase
      .from("currency_events")
      .insert({
        user_id: user.id,
        type: "spend",
        source: "chest",
        currency: "soft",
        amount: -priceSoft,
        balance_after: newSoftBalance,
      });

    if (currencyEventError) {
      return NextResponse.json(
        { error: "Failed to log currency event", details: currencyEventError },
        { status: 500 }
      );
    }

    // 8) Создаём user_item
    const { data: newUserItem, error: userItemError } = await supabase
      .from("user_items")
      .insert({
        user_id: user.id,
        item_id: selectedItem.id,
        obtained_from: "chest",
      })
      .select("*")
      .single();

    if (userItemError || !newUserItem) {
      return NextResponse.json(
        { error: "Failed to create user item", details: userItemError },
        { status: 500 }
      );
    }

    // 9) Увеличиваем total_minted у предмета (best effort)
    await supabase
      .from("items")
      .update({ total_minted: (selectedItem.total_minted || 0) + 1 })
      .eq("id", selectedItem.id);

    // 10) Логируем крутку сундука
    const { error: spinError } = await supabase.from("chest_spins").insert({
      user_id: user.id,
      chest_id: chest.id,
      cost_soft: priceSoft,
      cost_hard: priceHard ?? 0,
      user_item_id: newUserItem.id,
    });

    if (spinError) {
      return NextResponse.json(
        { error: "Failed to log chest spin", details: spinError },
        { status: 500 }
      );
    }

    // 11) Пересчитываем totalPower
    const { data: userItems, error: itemsPowerError } = await supabase
      .from("user_items")
      .select("id, item:items(power_value)")
      .eq("user_id", user.id);

    if (itemsPowerError) {
      return NextResponse.json(
        {
          error: "Failed to fetch user items for power",
          details: itemsPowerError,
        },
        { status: 500 }
      );
    }

    const totalPowerAfter =
      userItems?.reduce(
        (sum: number, ui: any) => sum + (ui.item?.power_value || 0),
        0
      ) ?? 0;

    return NextResponse.json({
      drop: {
        id: selectedItem.id,
        name: selectedItem.name,
        rarity: selectedItem.rarity,
        power_value: selectedItem.power_value,
        image_url: selectedItem.image_url,
      },
      newBalance: {
        soft_balance: newSoftBalance,
        hard_balance: balance.hard_balance,
      },
      totalPowerAfter,
    });
  } catch (err: any) {
    console.error("Chest open error:", err);
    return NextResponse.json(
      { error: "Unexpected error", details: String(err) },
      { status: 500 }
    );
  }
}
