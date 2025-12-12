"use client";

import { useEffect, useState } from "react";
import { useGameSessionContext } from "../context/GameSessionContext";

type LeaderboardRow = {
  rank: number;
  username: string | null;
  level: number;
  totalPower: number;
  spinsCount: number;
};

type LeaderboardResponse = {
  leaderboard?: LeaderboardRow[];
  error?: string;
};

export default function LeaderboardPage() {
  const { isTelegramEnv } = useGameSessionContext() as any;

  const [data, setData] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setErr(null);

        const res = await fetch("/api/leaderboard?limit=50");
        const json: LeaderboardResponse = await res.json();

        if (!res.ok) {
          throw new Error(json?.error || "Failed to load leaderboard");
        }

        if (cancelled) return;
        setData(json.leaderboard || []);
      } catch (e: any) {
        console.error(e);
        if (!cancelled) setErr(e?.message ? String(e.message) : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // честно: только Telegram
  if (!isTelegramEnv) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <div className="text-lg font-semibold mb-2">Open in Telegram</div>
          <div className="text-sm text-zinc-400">
            This page works only inside Telegram WebApp.
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center pt-16 px-4">
      <h1 className="text-3xl font-bold tracking-[0.3em] uppercase mb-6">
        Leaderboard
      </h1>

      {loading && (
        <div className="text-sm text-zinc-400 mb-4">Loading leaderboard...</div>
      )}

      {err && (
        <div className="text-sm text-red-400 mb-4">Error: {err}</div>
      )}

      {!loading && !err && data.length === 0 && (
        <div className="text-sm text-zinc-500">
          No players yet. Open some chests 😈
        </div>
      )}

      <div className="w-full max-w-2xl">
        <div className="border border-zinc-700 rounded-xl overflow-hidden">
          <div className="grid grid-cols-4 gap-2 px-3 py-2 bg-zinc-900/60 text-[10px] text-zinc-400 uppercase">
            <div>#</div>
            <div>Username</div>
            <div className="text-right">Level</div>
            <div className="text-right">Power / Spins</div>
          </div>

          {data.map((row) => (
            <div
              key={row.rank}
              className="grid grid-cols-4 gap-2 px-3 py-3 border-t border-zinc-800 text-sm"
            >
              <div className="text-zinc-300">{row.rank}</div>
              <div className="font-semibold truncate">
                {row.username || "Unknown"}
              </div>
              <div className="text-right text-zinc-300">{row.level}</div>
              <div className="text-right text-zinc-300">
                {row.totalPower}{" "}
                <span className="text-zinc-500">/ {row.spinsCount}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 flex gap-4 justify-center">
          <a
            href="/"
            className="px-4 py-2 rounded-full border border-zinc-700 text-sm text-zinc-200 hover:bg-zinc-900"
          >
            Home
          </a>
          <a
            href="/chest"
            className="px-4 py-2 rounded-full border border-zinc-700 text-sm text-zinc-200 hover:bg-zinc-900"
          >
            Chest
          </a>
          <a
            href="/inventory"
            className="px-4 py-2 rounded-full border border-zinc-700 text-sm text-zinc-200 hover:bg-zinc-900"
          >
            Inventory
          </a>
        </div>
      </div>
    </main>
  );
}
