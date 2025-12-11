"use client";

import { useGameSessionContext } from "./context/GameSessionContext";

export default function HomePage() {
  const { loading, error, telegramId, bootstrap } = useGameSessionContext();

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-black text-white">
        <span>Loading 696 Game...</span>
      </main>
    );
  }

  if (error || !bootstrap || !bootstrap.user || !bootstrap.balance) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-black text-white">
        <div>
          <div className="mb-2 text-red-400">Error loading profile</div>
          <pre className="text-xs max-w-sm overflow-auto">
            {JSON.stringify(
              {
                error,
                telegramId,
                bootstrap,
              },
              null,
              2
            )}
          </pre>
        </div>
      </main>
    );
  }

  const { user, balance, totalPower = 0 } = bootstrap;

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-4">
      <h1 className="text-3xl font-bold tracking-[0.3em] uppercase">
        696 Game
      </h1>

      <div className="text-sm text-zinc-400">
        Player:{" "}
        <span className="text-white">
          {user.username || "Unknown"}
        </span>{" "}
        (
        {user.telegram_id || telegramId}
        )
      </div>

      <div className="flex gap-6 mt-4 flex-wrap justify-center">
        <div className="p-4 border border-zinc-700 rounded-xl min-w-[180px]">
          <div className="text-xs text-zinc-500">TOTAL POWER</div>
          <div className="text-2xl font-semibold mt-1">{totalPower}</div>
        </div>
        <div className="p-4 border border-zinc-700 rounded-xl min-w-[180px]">
          <div className="text-xs text-zinc-500 mb-1">BALANCE</div>
          <div>Shards: {balance.soft_balance}</div>
          <div>Crystals: {balance.hard_balance}</div>
        </div>
      </div>

      {/* Кнопка перехода на страницу сундука */}
      <a
        href="/chest"
        className="mt-6 px-4 py-2 rounded-full border border-zinc-700 text-sm text-zinc-200 hover:bg-zinc-900"
      >
        Go to Chest
      </a>
    </main>
  );
}
