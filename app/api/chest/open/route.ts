import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));

    const telegramId =
      typeof body.telegramId === "string" ? body.telegramId.trim() : "";

    const chestCode =
      typeof body.chestCode === "string" && body.chestCode.trim()
        ? body.chestCode.trim()
        : "soft_basic";

    // ✅ idempotency key: можно прислать с клиента, иначе сгенерим
    const requestIdRaw =
      typeof body.requestId === "string" ? body.requestId.trim() : "";
    const requestId =
      requestIdRaw ||
      (globalThis.crypto?.randomUUID?.() ??
        `req_${Date.now()}_${Math.random()}`);

    if (!telegramId) {
      return NextResponse.json(
        { error: "telegramId is required" },
        { status: 400 }
      );
    }

    if (!/^\d+$/.test(telegramId)) {
      return NextResponse.json({ error: "Invalid telegramId" }, { status: 400 });
    }

    // ✅ SECURITY: user должен уже существовать (создаётся через /api/auth/telegram)
    const { data: user, error: userSelectError } = await supabase
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

    if (!user) {
      return NextResponse.json(
        { error: "User not found (auth required)" },
        { status: 401 }
      );
    }

    // Баланс: можно создать
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
      const { data: newBalance, error: createBalError } = await supabaseAdmin
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

    // сундук
    const { data: chest, error: chestError } = await supabase
      .from("chests")
      .select("*")
      .eq("code", chestCode)
      .maybeSingle();

    if (chestError || !chest) {
      return NextResponse.json(
        { error: "Chest not found", details: chestError },
        { status: 400 }
      );
    }

    const priceSoft: number = chest.price_soft ?? 0;
    const priceHard: number = chest.price_hard ?? 0;

    if (priceSoft <= 0) {
      return NextResponse.json(
        { error: "Chest price not configured (soft)" },
        { status: 400 }
      );
    }

    const softBalance =
      typeof balance.soft_balance === "number" ? balance.soft_balance : 0;

    if (softBalance < priceSoft) {
      return NextResponse.json(
        { error: "Not enough Shards", code: "INSUFFICIENT_FUNDS" },
        { status: 400 }
      );
    }

    // пул предметов
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

    const availableChestItems = chestItems.filter((ci: any) => {
      const item = ci.item;
      if (!item) return false;

      if (item.is_limited && item.max_mint != null) {
        const totalMinted = item.total_minted ?? 0;
        return totalMinted < item.max_mint;
      }
      return true;
    });

    const finalPool =
      availableChestItems.length > 0 ? availableChestItems : chestItems;

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

    const selectedItem = (selectedChestItem.item as any) || null;

    if (!selectedItem) {
      return NextResponse.json(
        { error: "Selected item not found" },
        { status: 500 }
      );
    }

    // списание
    const newSoftBalance = softBalance - priceSoft;
    const nowIso = new Date().toISOString();

    const { error: updateBalanceError } = await supabaseAdmin
      .from("balances")
      .update({
        soft_balance: newSoftBalance,
        updated_at: nowIso,
      })
      .eq("user_id", user.id);

    if (updateBalanceError) {
      return NextResponse.json(
        { error: "Failed to update balance", details: updateBalanceError },
        { status: 500 }
      );
    }

    const { error: currencyEventError } = await supabaseAdmin
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

    // user_item
    const { data: newUserItem, error: userItemError } = await supabaseAdmin
      .from("user_items")
      .insert({
        user_id: user.id,
        item_id: selectedItem.id,
        obtained_from: "chest",
      })
      .select("*")
      .maybeSingle();

    if (userItemError || !newUserItem) {
      return NextResponse.json(
        { error: "Failed to create user item", details: userItemError },
        { status: 500 }
      );
    }

    // ✅ PVP FIX: если item является картой (cards.item_id == selectedItem.id),
    // то пишем владение в user_cards через item_id (uuid) + copies
    try {
      const { data: maybeCard } = await supabaseAdmin
        .from("cards")
        .select("id")
        .eq("item_id", selectedItem.id)
        .maybeSingle();

      if (maybeCard?.id) {
        // upsert copies по (user_id, item_id)
        const { data: existing } = await supabaseAdmin
          .from("user_cards")
          .select("id,copies")
          .eq("user_id", user.id)
          .eq("item_id", selectedItem.id)
          .maybeSingle();

        if (existing?.id) {
          const curr = Number(existing.copies || 0);
          await supabaseAdmin
            .from("user_cards")
            .update({ copies: curr + 1 })
            .eq("id", existing.id);
        } else {
          await supabaseAdmin.from("user_cards").insert({
            user_id: user.id,
            item_id: selectedItem.id,
            copies: 1,
          });
        }
      }
    } catch (e) {
      console.error("PVP FIX user_cards error:", e);
    }

    // total_minted best effort (admin)
    await supabaseAdmin
      .from("items")
      .update({ total_minted: (selectedItem.total_minted || 0) + 1 })
      .eq("id", selectedItem.id);

    // spins log (admin)
    const { error: spinError } = await supabaseAdmin.from("chest_spins").insert({
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

    // totalPower after
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

    const powerDelta = Number(selectedItem.power_value ?? 0) || 0;

    // ✅ chest_open_events log (admin, idempotent)
    const { error: chestOpenEventError } = await supabaseAdmin
      .from("chest_open_events")
      .insert({
        user_id: user.id,
        telegram_id: telegramId,
        chest_code: chestCode,
        spent_soft: priceSoft,
        spent_hard: priceHard ?? 0,
        dropped_item_id: selectedItem.id,
        dropped_inventory_id: newUserItem.id,
        power_delta: powerDelta,
        total_power_after: totalPowerAfter,
        request_id: requestId,
      });

    if (chestOpenEventError) {
      const msg =
        (chestOpenEventError as any)?.message ||
        (chestOpenEventError as any)?.details ||
        "";
      const code = (chestOpenEventError as any)?.code;

      const isDuplicate =
        code === "23505" ||
        String(msg).toLowerCase().includes("duplicate") ||
        String(msg).toLowerCase().includes("unique");

      if (!isDuplicate) {
        return NextResponse.json(
          {
            error: "Failed to log chest open event",
            details: chestOpenEventError,
          },
          { status: 500 }
        );
      }
    }

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
        hard_balance: balance.hard_balance ?? 0,
      },
      totalPowerAfter,
      requestId,
    });
  } catch (err: any) {
    console.error("Chest open error:", err);
    return NextResponse.json(
      { error: "Unexpected error", details: String(err) },
      { status: 500 }
    );
  }
}
