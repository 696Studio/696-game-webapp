"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
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
  isTelegramEnv: boolean;

  // optional: удобно дебажить, но не обязателен
  authLoading: boolean;
  authError: string | null;
  authData: any | null;
};

const GameSessionContext = createContext<GameSessionContextValue | undefined>(
  undefined
);

export function GameSessionProvider({ children }: { children: ReactNode }) {
  // ✅ новый хук теперь делает server-side auth
  const {
    webApp,
    initData,
    telegramUser,
    authLoading,
    authError,
    authData,
  } = useTelegramWebApp() as any;

  const isTelegramEnv = !!webApp;
  const user = telegramUser || null;
  const initDataRaw = initData || "";

  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [telegramId, setTelegramId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function runBootstrap() {
      try {
        setBootstrapLoading(true);
        setBootstrapError(null);

        // 1) Не Telegram среда — ничего не делаем
        if (!isTelegramEnv) {
          setTelegramId(null);
          setBootstrap(null);
          setBootstrapError("Telegram WebApp environment required");
          return;
        }

        // 2) Ждём auth
        if (authLoading) {
          return; // просто ждём
        }

        // 3) Auth упал — bootstrap запрещён
        if (authError) {
          setTelegramId(null);
          setBootstrap(null);
          setBootstrapError(authError);
          return;
        }

        // 4) Нет verified user — bootstrap запрещён
        if (!user?.id) {
          setTelegramId(null);
          setBootstrap(null);
          setBootstrapError("Telegram auth required");
          return;
        }

        const effectiveTelegramId = String(user.id);
        setTelegramId(effectiveTelegramId);

        const res = await fetch("/api/bootstrap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            telegramId: effectiveTelegramId,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data?.error || "Bootstrap failed");
        }

        if (cancelled) return;

        setBootstrap(data);
        setBootstrapError(null);
      } catch (err: any) {
        console.error("Bootstrap error:", err);
        if (!cancelled) {
          setBootstrap(null);
          setBootstrapError(err?.message ? String(err.message) : String(err));
        }
      } finally {
        if (!cancelled) {
          setBootstrapLoading(false);
        }
      }
    }

    runBootstrap();

    return () => {
      cancelled = true;
    };
  }, [isTelegramEnv, authLoading, authError, user?.id]);

  // единое состояние для UI
  const loading = authLoading || bootstrapLoading;

  const error = useMemo(() => {
    // приоритет: authError -> bootstrapError
    if (!isTelegramEnv) return "Telegram WebApp environment required";
    return authError || bootstrapError || null;
  }, [isTelegramEnv, authError, bootstrapError]);

  const value: GameSessionContextValue = useMemo(
    () => ({
      loading,
      error,
      telegramId,
      initDataRaw,
      bootstrap,
      isTelegramEnv,

      authLoading,
      authError,
      authData,
    }),
    [
      loading,
      error,
      telegramId,
      initDataRaw,
      bootstrap,
      isTelegramEnv,
      authLoading,
      authError,
      authData,
    ]
  );

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
