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

  timedOut: boolean;
  refreshSession: () => void;

  authLoading: boolean;
  authError: string | null;
  authData: any | null;
};

const GameSessionContext = createContext<GameSessionContextValue | undefined>(
  undefined
);

const BOOTSTRAP_TIMEOUT_MS = 12_000;
const TG_WAIT_MS = 1800;
const TG_ID_KEY = "__tg_id_v1__";

function getWindowWebApp(): any | null {
  if (typeof window === "undefined") return null;
  return (window as any)?.Telegram?.WebApp || null;
}

function pickTelegramId(webApp: any, telegramUser: any): string | null {
  // 1) verified user (после /api/auth/telegram)
  if (telegramUser?.id) return String(telegramUser.id);

  // 2) fallback: initDataUnsafe.user.id
  const unsafeId = webApp?.initDataUnsafe?.user?.id;
  if (unsafeId) return String(unsafeId);

  // 3) cached (на случай "мигания" env на iOS)
  try {
    const cached = sessionStorage.getItem(TG_ID_KEY);
    if (cached) return String(cached);
  } catch {}

  return null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function GameSessionProvider({ children }: { children: ReactNode }) {
  const hook = useTelegramWebApp() as any;

  // hook values (may be null on iOS for a moment)
  const hookWebApp = hook?.webApp;
  const hookInitData = hook?.initData;
  const hookTelegramUser = hook?.telegramUser;

  const authLoading = hook?.authLoading ?? false;
  const authError = hook?.authError ?? null;
  const authData = hook?.authData ?? null;

  // fallback values (source of truth when hook "misses" Telegram on iOS)
  const fallbackWebApp = getWindowWebApp();
  const effectiveWebApp = hookWebApp || fallbackWebApp;

  const isTelegramEnv = !!effectiveWebApp;

  const initDataRaw = useMemo(() => {
    // prefer hook initData if provided
    if (typeof hookInitData === "string" && hookInitData) return hookInitData;
    if (hookInitData) return String(hookInitData);

    // fallback from WebApp
    const raw = effectiveWebApp?.initData;
    return typeof raw === "string" ? raw : raw ? String(raw) : "";
  }, [hookInitData, effectiveWebApp]);

  const effectiveTelegramUser =
    hookTelegramUser || effectiveWebApp?.initDataUnsafe?.user || null;

  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapTimedOut, setBootstrapTimedOut] = useState(false);
  const [telegramId, setTelegramId] = useState<string | null>(null);

  const [refreshNonce, setRefreshNonce] = useState(0);
  const refreshSession = () => setRefreshNonce((n) => n + 1);

  // prevent overlapping bootstraps on iOS flaps
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function runBootstrap() {
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, BOOTSTRAP_TIMEOUT_MS);

      try {
        setBootstrapLoading(true);
        setBootstrapError(null);
        setBootstrapTimedOut(false);

        // --- wait a bit for Telegram to inject on iOS ---
        let wa = effectiveWebApp || getWindowWebApp();
        if (!wa) {
          const start = Date.now();
          while (!wa && Date.now() - start < TG_WAIT_MS) {
            if (cancelled) return;
            await sleep(60);
            wa = getWindowWebApp();
          }
        }

        const envOk = !!wa;
        if (!envOk) {
          setTelegramId(null);
          setBootstrap(null);
          setBootstrapError("Telegram WebApp environment required");
          return;
        }

        const effectiveTelegramId = pickTelegramId(wa, effectiveTelegramUser);
        setTelegramId(effectiveTelegramId);

        if (effectiveTelegramId) {
          try {
            sessionStorage.setItem(TG_ID_KEY, effectiveTelegramId);
          } catch {}
        }

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
        if (!res.ok) throw new Error(data?.error || "Bootstrap failed");
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
        inFlightRef.current = false;
      }
    }

    runBootstrap();

    return () => {
      cancelled = true;
    };
    // важно: не зависим от hookWebApp напрямую, иначе на iOS будет дергать эффект при "мигании"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    initDataRaw,
    effectiveTelegramUser?.id,
    refreshNonce,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]);

  const loading = authLoading || bootstrapLoading;

  const error = useMemo(() => {
    // если env "мигает", пусть решает bootstrapError
    return bootstrapError || null;
  }, [bootstrapError]);

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
