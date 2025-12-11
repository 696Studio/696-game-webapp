"use client";

import { useEffect, useState } from "react";

type DropItem = {
  id: string;
  name: string;
  rarity: string;
  power_value: number;
  image_url: string | null;
};

type ChestResponse = {
  drop?: DropItem;
  newBalance?: {
    soft_balance: number;
    hard_balance: number;
  };
  totalPowerAfter?: number;
  error?: string;
  code?: string;
};

type ProfileState = {
  balance: {
    soft_balance: number;
    hard_balance: number;
  };
  totalPower: number;
};

const TEST_TELEGRAM_ID = "123456789";

export default function ChestPage() {
  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [result, setResult] = useState<ChestResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // Подтягиваем баланс и power с /api/profile
  useEffect(() => {
    fetch(`/api/profile?telegram_id=${TEST_TELEGRAM_ID}`)
      .then((res) => res.json())
      .then((data) => {
        // Нормализуем ответ в строгий ProfileState
        if (data?.balance) {
          setProfile({
            balance: {
              soft_balance: data.balance.soft_balance ?? 0,
              hard_balance: data.balance.hard_balance ?? 0,
            },
            totalPower: data.totalPower ?? 0,
          });
        } else {
          setProfile({
            balance: {
              soft_balance: 0,
              hard_balance: 0,
            },
            totalPower: 0,
          });
        }
      })
      .catch((err) => {
        console.error(err);
        setProfile({
          balance: { soft_balance: 0, hard_balance: 0 },
          totalPower: 0,
        });
      });
  }, []);

  const handleOpenChest = async () => {
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/chest/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegramId: TEST_TELEGRAM_ID,
          chestCode: "soft_basic",
        }),
      });

      const data: ChestResponse = await res.json();
      setResult(data);

      // Обновляем локальный баланс и power, если сервер их вернул
      if (data.newBalance && typeof data.totalPowerAfter === "number") {
        setProfile({
          balance: {
            soft_balance: data.newBalance.soft_balance,
            hard_balance: data.newBalance.hard_balance,
          },
          totalPower: data.totalPowerAfter,
        });
      }
    } catch (e) {
      console.error(e);
      setResult({ error: "Request failed" });
    } finally {
      setLoading(false);
    }
  };

  const soft = profile?.balance.soft_balance ?? 0;
  const hard = profile?.balance.hard_balance ?? 0;
  const totalPower = profile?.totalPower ?? 0;

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center pt-16 px-4">
      <h1 className="text-3xl font-bold tracking-[0.3em] uppercase mb-6">
        696 Chest
      </h1>

      <div className="flex gap-4 mb-6 flex-wrap justify-center">
        <div className="p-4 border border-zinc-700 rounded-xl min-w-[160px]">
          <div className="text-xs text-zinc-500 mb-1">BALANCE</div>
          <div>Shards: {soft}</div>
          <div>Crystals: {hard}</div>
        </div>
        <div className="p-4 border border-zinc-700 rounded-xl min-w-[160px]">
          <div className="text-xs text-zinc-500 mb-1">TOTAL POWER</div>
          <div className="text-xl font-semibold">{totalPower}</div>
        </div>
      </div>

      <div className="mt-4 flex flex-col items-center gap-4">
        <div className="w-48 h-32 border border-zinc-700 rounded-2xl flex items-center justify-center bg-zinc-900">
          <span className="text-zinc-400 text-sm">
            Basic Chest (50 Shards)
          </span>
        </div>

        <button
          onClick={handleOpenChest}
          disabled={loading}
          className="mt-2 px-6 py-2 rounded-full border border-zinc-600 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50"
        >
          {loading ? "Opening..." : "Open Chest"}
        </button>
      </div>

      {result && (
        <div className="mt-8 max-w-sm text-center">
          {result.error ? (
            <div className="text-red-400">
              {result.code === "INSUFFICIENT_FUNDS"
                ? "Недостаточно Shards для открытия сундука."
                : `Ошибка: ${result.error}`}
            </div>
          ) : result.drop ? (
            <div className="border border-zinc-700 rounded-xl p-4">
              <div className="text-xs text-zinc-500 mb-1">DROP</div>
              <div className="text-lg font-semibold mb-1">
                {result.drop.name}
              </div>
              <div className="text-sm text-zinc-400">
                Rarity: {result.drop.rarity.toUpperCase()}
              </div>
              <div className="text-sm text-zinc-400">
                Power: {result.drop.power_value}
              </div>
              <div className="text-xs text-zinc-500 mt-2">
                Total Power after drop: {result.totalPowerAfter ?? totalPower}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </main>
  );
}
