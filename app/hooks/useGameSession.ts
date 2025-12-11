"use client";

import { useEffect, useMemo, useState } from "react";
import { useTelegramWebApp } from "./useTelegramWebApp";

type GameBootstrap = {
  user: any;
  balance: {
    soft_balance: number;
    hard_balance: number;
  };
  totalPower: number;
  itemsCount: number;
  level: number;
  currentLevelPower: number;
  nextLevelPower: number;
  progress: number;
  spinsCount: number;
  lastSpinAt: string | null;
  totalShardsSpent: number;
  daily: {
    canClaim: boolean;
    remainingSeconds: number;
    streak: number;
    amount: number;
  };
};

type GameSessionState = {
  loading: boolean;
  error: string | null;
  telegramUser: any | null;
  telegramId: string | null;
  bootstrap: GameBootstrap | null;
};

export function useGameSession(): GameSessionState {
  const { webApp, initData, telegramUser } = useTelegramWebApp();
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [telegramId, setTelegramId] = useState<string | null>(null);
  const [bootstrap, setBootstrap] = useState<GameBootstrap | null>(null);

  useEffect(() => {
    // ждём, пока появится initData
    if (!initData) return;
    if (!webApp) return;

    let cancelled = false;

    async function run() {
      try {
        setLoading(true);
        setError(null);

        // 1) валидируем initData на бэке и создаём user/balance
        const authRes = await fetch("/api/auth/telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData }),
        });

        if (!authRes.ok) {
          const errJson = await authRes.json().catch(() => ({}));
          throw new Error(
            errJson?.error || "Failed to auth via Telegram WebApp"
          );
        }

        const authData = await authRes.json();
        const tgUser = authData.telegramUser;
        const tId: string =
          tgUser?.id != null
            ? String(tgUser.id)
            : authData.user?.telegram_id ?? null;

        if (!tId) {
          throw new Error("No telegramId in auth response");
        }

        if (cancelled) return;

        setTelegramId(tId);

        // 2) грузим bootstrap данные
        const bootRes = await fetch(
          `/api/bootstrap?telegram_id=${encodeURIComponent(tId)}`
        );

        if (!bootRes.ok) {
          const errJson = await bootRes.json().catch(() => ({}));
          throw new Error(
            errJson?.error || "Failed to fetch bootstrap data"
          );
        }

        const bootJson = await bootRes.json();

        if (cancelled) return;

        setBootstrap(bootJson as GameBootstrap);
        setLoading(false);
      } catch (e: any) {
        if (cancelled) return;
        console.error("useGameSession error:", e);
        setError(e?.message || "Unknown error");
        setLoading(false);
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [initData, webApp]);

  const memoState = useMemo(
    () => ({
      loading,
      error,
      telegramUser,
      telegramId,
      bootstrap,
    }),
    [loading, error, telegramUser, telegramId, bootstrap]
  );

  return memoState;
}
