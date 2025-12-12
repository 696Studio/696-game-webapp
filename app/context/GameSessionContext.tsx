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

  // ✅ UX stability controls
  timedOut: boolean;
  refreshSession: () => void;

  // optional debug
  authLoading: boolean;
  authError: string | null;
  authData: any | null;
};

const GameSessionContext = createContext<GameSessionContextValue | undefined>(
  undefined
);

const BOOTSTRAP_TIMEOUT_MS = 12_000;

function pickTelegramId(webApp: any, telegramUser: any): string | null {
  // 1) verified user (после /api/auth/telegram)
  if (telegramUser?.id) return String(telegramUser.id);

  // 2) fallback (самое надёжное на Desktop): initDataUnsafe.user.id
  const unsafeId = webApp?.initDataUnsafe?.user?.id;
  if (unsafeId) return String(unsafeId);

  return null;
}

export function GameSessionProvider({ children }: { children: ReactNode }) {
  const {
    webApp,
    initData,
    telegramUser,
    authLoading,
    authError,
    authData,
  } = useTelegramWebApp() as any;

  const isTelegramEnv = !!webApp;
  const initDataRaw = typeof initData === "string" ? initData : initData || "";

  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapTimedOut, setBootstrapTimedOut] = useState(false);
  const [telegramId, setTelegramId] = useState<string | null>(null);

  // ✅ manual re-sync trigger
  const [refreshNonce, setRefreshNonce] = useState(0);
  const refreshSession = () => setRefreshNonce((n) => n + 1);

  useEffect(() => {
    let cancelled = false;

    async function runBootstrap() {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, BOOTSTRAP_TIMEOUT_MS);

      try {
        setBootstrapLoading(true);
        setBootstrapError(null);
        setBootstrapTimedOut(false);

        if (!isTelegramEnv) {
          setTelegramId(null);
          setBootstrap(null);
          setBootstrapError("Telegram WebApp environment required");
          return;
        }

        const effectiveTelegramId = pickTelegramId(webApp, telegramUser);
        setTelegramId(effectiveTelegramId);

        if (!effectiveTelegramId) {
          setBootstrap(null);
          setBootstrapError("Telegram user not found");
          return;
        }

        const res = await fetch("/api/bootstrap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            telegramId: effectiveTelegramId,
            initData: initDataRaw, // пусть уходит, даже если сервер пока не использует
          }),
          signal: controller.signal,
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(data?.error || "Bootstrap failed");
        }

        if (cancelled) return;

        setBootstrap(data);
        setBootstrapError(null);
      } catch (err: any) {
        if (cancelled) return;

        // timeout / abort
        const isAbort =
          err?.name === "AbortError" ||
          String(err?.message || "").toLowerCase().includes("aborted");

        if (isAbort) {
          setBootstrap(null);
          setBootstrapTimedOut(true);
          setBootstrapError(
            "Session sync timed out. Please tap Re-sync and try again."
          );
          return;
        }

        console.error("Bootstrap error:", err);
        setBootstrap(null);
        setBootstrapError(err?.message ? String(err.message) : String(err));
      } finally {
        clearTimeout(timeoutId);
        if (!cancelled) setBootstrapLoading(false);
      }
    }

    runBootstrap();

    return () => {
      cancelled = true;
    };
  }, [isTelegramEnv, webApp, telegramUser?.id, initDataRaw, refreshNonce]);

  // единое состояние для UI
  const loading = authLoading || bootstrapLoading;

  const error = useMemo(() => {
    if (!isTelegramEnv) return "Telegram WebApp environment required";

    // показываем bootstrap ошибку как основную (она важнее для игрока)
    // authError оставим как debug, но не блокируем игру из-за него
    return bootstrapError || null;
  }, [isTelegramEnv, bootstrapError]);

  const value: GameSessionContextValue = useMemo(
    () => ({
      loading,
      error,
      telegramId,
      initDataRaw,
      bootstrap,
      isTelegramEnv,

      timedOut: bootstrapTimedOut,
      refreshSession,

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
      bootstrapTimedOut,
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
