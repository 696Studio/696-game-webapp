"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { useTelegramWebApp } from "../hooks/useTelegramWebApp";

type BootstrapResponse = any;

type GameSessionContextValue = {
  loading: boolean;
  error: string | null;
  telegramId: string | null;
  initDataRaw: string;
  bootstrap: BootstrapResponse | null;
};

const GameSessionContext = createContext<GameSessionContextValue | undefined>(
  undefined
);

export function GameSessionProvider({ children }: { children: ReactNode }) {
  // Твой текущий хук: webApp / initData / telegramUser
  const { webApp, initData, telegramUser } = useTelegramWebApp() as any;

  const isTelegramEnv = !!webApp;
  const user = telegramUser || null;
  const initDataRaw = initData || "";

  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [telegramId, setTelegramId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function runBootstrap() {
      try {
        setLoading(true);

        let effectiveTelegramId: string;
        const payload: Record<string, unknown> = {};

        if (isTelegramEnv && user?.id) {
          // Реальный Telegram WebApp
          effectiveTelegramId = String(user.id);
          payload.initData = initDataRaw;
        } else {
          // Фоллбек — обычный веб, без телеги: тестовый юзер
          effectiveTelegramId = "123456789";
        }

        setTelegramId(effectiveTelegramId);

        const res = await fetch("/api/bootstrap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            telegramId: effectiveTelegramId,
            ...payload,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data?.error || "Bootstrap failed");
        }

        if (cancelled) return;

        setBootstrap(data);
        setError(null);
      } catch (err: any) {
        console.error("Bootstrap error:", err);
        if (!cancelled) {
          setError(err?.message ? String(err.message) : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    runBootstrap();

    return () => {
      cancelled = true;
    };
  }, [isTelegramEnv, user, initDataRaw]);

  const value: GameSessionContextValue = {
    loading,
    error,
    telegramId,
    initDataRaw,
    bootstrap,
  };

  return (
    <GameSessionContext.Provider value={value}>
      {children}
    </GameSessionContext.Provider>
  );
}

export function useGameSessionContext(): GameSessionContextValue {
  const ctx = useContext(GameSessionContext);
  if (!ctx) {
    throw new Error(
      "useGameSessionContext must be used within GameSessionProvider"
    );
  }
  return ctx;
}
