"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
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

  // 2) fallback: initDataUnsafe.user.id
  const unsafeId = webApp?.initDataUnsafe?.user?.id;
  if (unsafeId) return String(unsafeId);

  return null;
}

function getWindowWebApp(): any | null {
  if (typeof window === "undefined") return null;
  return (window as any)?.Telegram?.WebApp ?? null;
}

export function GameSessionProvider({ children }: { children: ReactNode }) {
  const {
    webApp: hookWebApp,
    initData: hookInitData,
    telegramUser,
    authLoading,
    authError,
    authData,
  } = useTelegramWebApp() as any;

  // --------------------------
  // ✅ STABLE ENV LOCK
  // --------------------------
  const stableWebAppRef = useRef<any | null>(null);
  const stableInitDataRef = useRef<string>("");
  const envLockedRef = useRef<boolean>(false);

  // state only to trigger re-render when we first "lock"
  const [envLocked, setEnvLocked] = useState(false);

  // take best available webApp each render
  const windowWebApp = getWindowWebApp();
  const effectiveWebApp = hookWebApp || windowWebApp || stableWebAppRef.current;

  // initDataRaw
  const hookInitRaw = typeof hookInitData === "string" ? hookInitData : hookInitData || "";
  const effectiveInitRaw = hookInitRaw || stableInitDataRef.current || "";

  // lock if we saw Telegram WebApp at least once
  useEffect(() => {
    const seen = !!effectiveWebApp;
    if (seen) {
      stableWebAppRef.current = effectiveWebApp;
      stableInitDataRef.current = effectiveInitRaw || stableInitDataRef.current;

      if (!envLockedRef.current) {
        envLockedRef.current = true;
        setEnvLocked(true);
      }
    } else {
      // even if not seen now, keep previously stable values (do nothing)
      // IMPORTANT: do NOT unlock env once locked
      if (stableInitDataRef.current && !stableWebAppRef.current && windowWebApp) {
        stableWebAppRef.current = windowWebApp;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!effectiveWebApp, effectiveInitRaw]);

  // ✅ for consumers: once locked, always true
  const isTelegramEnv = envLockedRef.current || envLocked;

  const initDataRaw = useMemo(() => {
    // if locked, always return stable initData (doesn't drop to "")
    if (isTelegramEnv) return stableInitDataRef.current || effectiveInitRaw || "";
    return effectiveInitRaw || "";
  }, [isTelegramEnv, effectiveInitRaw]);

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

        // ✅ DO NOT flip to error if we simply haven't locked yet.
        // Wait for Telegram env to appear, otherwise just idle with a friendly error for UI.
        if (!isTelegramEnv) {
          setTelegramId(null);
          setBootstrap(null);
          setBootstrapError("Telegram WebApp environment required");
          return;
        }

        const wa = stableWebAppRef.current || effectiveWebApp;
        if (!wa) {
          setTelegramId(null);
          setBootstrap(null);
          setBootstrapError("Telegram WebApp not ready");
          return;
        }

        const effectiveTelegramId = pickTelegramId(wa, telegramUser);
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
            initData: initDataRaw,
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

        const isAbort =
          err?.name === "AbortError" ||
          String(err?.message || "").toLowerCase().includes("aborted");

        if (isAbort) {
          setBootstrap(null);
          setBootstrapTimedOut(true);
          setBootstrapError("Session sync timed out. Please tap Re-sync and try again.");
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
    // IMPORTANT: do not depend on hookWebApp directly (it can be transient null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTelegramEnv, telegramUser?.id, initDataRaw, refreshNonce]);

  const loading = authLoading || bootstrapLoading;

  const error = useMemo(() => {
    if (!isTelegramEnv) return "Telegram WebApp environment required";
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
    throw new Error("useGameSessionContext must be used within GameSessionProvider");
  }
  return ctx;
}
