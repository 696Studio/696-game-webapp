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

  const hookWebApp = hook?.webApp;
  const hookInitData = hook?.initData;
  const hookTelegramUser = hook?.telegramUser;

  const authLoading = hook?.authLoading ?? false;
  const authError = hook?.authError ?? null;
  const authData = hook?.authData ?? null;

  // --- STICKY refs (anti iOS Telegram flaps) ---
  const stableWebAppRef = useRef<any | null>(null);
  const stableInitDataRef = useRef<string>("");
  const stableUserRef = useRef<any | null>(null);
  const stableTelegramIdRef = useRef<string | null>(null);

  // Current (volatile) sources
  const fallbackWebApp = getWindowWebApp();
  const volatileWebApp = hookWebApp || fallbackWebApp;

  // Once Telegram WebApp was seen -> keep forever in this session
  if (volatileWebApp && !stableWebAppRef.current) {
    stableWebAppRef.current = volatileWebApp;
  }

  // Sticky env: once true, stays true (iOS fix)
  const isTelegramEnv = !!stableWebAppRef.current;

  // Sticky user: keep last known valid user.id
  const volatileUser =
    hookTelegramUser || volatileWebApp?.initDataUnsafe?.user || null;
  if (volatileUser?.id) {
    stableUserRef.current = volatileUser;
  }

  // Compute initData (may be empty during flaps). Never drop sticky value to ""
  const computedInitDataRaw = useMemo(() => {
    if (typeof hookInitData === "string" && hookInitData) return hookInitData;
    if (hookInitData) return String(hookInitData);

    const raw = volatileWebApp?.initData;
    return typeof raw === "string" ? raw : raw ? String(raw) : "";
  }, [hookInitData, volatileWebApp]);

  if (computedInitDataRaw) {
    stableInitDataRef.current = computedInitDataRaw;
  }

  const initDataRaw = stableInitDataRef.current;
  const effectiveTelegramUser = stableUserRef.current;

  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapTimedOut, setBootstrapTimedOut] = useState(false);
  const [telegramId, setTelegramId] = useState<string | null>(null);

  const [refreshNonce, setRefreshNonce] = useState(0);
  const refreshSession = () => setRefreshNonce((n) => n + 1);

  // prevent overlapping bootstraps
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function runBootstrap() {
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), BOOTSTRAP_TIMEOUT_MS);

      try {
        setBootstrapLoading(true);
        setBootstrapTimedOut(false);
        // IMPORTANT: не сносим bootstrapError заранее, чтобы не мигало UI
        // но если всё успешно — обнулим ниже

        // Wait a bit for Telegram injection (but prefer sticky WA)
        let wa = stableWebAppRef.current || getWindowWebApp();
        if (!wa) {
          const start = Date.now();
          while (!wa && Date.now() - start < TG_WAIT_MS) {
            if (cancelled) return;
            await sleep(60);
            wa = getWindowWebApp();
            if (wa && !stableWebAppRef.current) stableWebAppRef.current = wa;
          }
        }

        // If still no WebApp:
        // If we already have telegramId/bootstrap -> DO NOTHING (it's just an iOS flap)
        if (!wa) {
          const alreadyOk = !!stableTelegramIdRef.current && !!bootstrap;
          if (!alreadyOk) {
            setBootstrapError("Telegram WebApp environment required");
          }
          return;
        }

        // TelegramId (sticky)
        const picked = pickTelegramId(wa, effectiveTelegramUser);
        const effectiveTelegramId = picked || stableTelegramIdRef.current;

        if (!effectiveTelegramId) {
          const alreadyOk = !!stableTelegramIdRef.current && !!bootstrap;
          if (!alreadyOk) {
            setBootstrapError("Telegram user not found");
          }
          return;
        }

        stableTelegramIdRef.current = effectiveTelegramId;
        setTelegramId(effectiveTelegramId);

        try {
          sessionStorage.setItem(TG_ID_KEY, effectiveTelegramId);
        } catch {}

        // Build payload: allow initData to be absent (server should accept telegramId-only)
        const payload: any = { telegramId: effectiveTelegramId };
        if (initDataRaw) payload.initData = initDataRaw;

        const res = await fetch("/api/bootstrap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Bootstrap failed");
        if (cancelled) return;

        setBootstrap(data);
        setBootstrapError(null); // ✅ success -> clear errors
      } catch (err: any) {
        if (cancelled) return;

        const isAbort =
          err?.name === "AbortError" ||
          String(err?.message || "").toLowerCase().includes("aborted");

        if (isAbort) {
          setBootstrapTimedOut(true);
          setBootstrapError(
            "Session sync timed out. Please tap Re-sync and try again."
          );
          return;
        }

        console.error("Bootstrap error:", err);
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
    // не зависим от volatileWebApp/initData чтобы iOS-flap не дёргал эффект
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTelegramUser?.id, refreshNonce]);

  const loading = authLoading || bootstrapLoading;

  const error = useMemo(() => bootstrapError || null, [bootstrapError]);

  const value: GameSessionContextValue = useMemo(
    () => ({
      loading,
      error,
      telegramId: telegramId || stableTelegramIdRef.current,
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
