"use client";

import { useEffect, useState } from "react";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: any;
    };
  }
}

type AuthTelegramResponse = {
  ok: boolean;
  telegramUser?: any;
  user?: any;
  balance?: any;
  totalPower?: number;
  error?: string;
};

export function useTelegramWebApp() {
  const [webApp, setWebApp] = useState<any | null>(null);
  const [initData, setInitData] = useState<string | null>(null);

  // ✅ verified user (после /api/auth/telegram)
  const [telegramUser, setTelegramUser] = useState<any | null>(null);

  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authData, setAuthData] = useState<AuthTelegramResponse | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const tg = window.Telegram?.WebApp;
    if (!tg) return;

    setWebApp(tg);

    // Telegram рекомендует вызывать ready()
    try {
      tg.ready?.();
    } catch {
      // ignore
    }

    const rawInitData: string = tg.initData || "";
    setInitData(rawInitData);

    // если нет initData — смысла в auth нет
    if (!rawInitData) return;

    let cancelled = false;

    async function auth() {
      try {
        setAuthLoading(true);
        setAuthError(null);

        const res = await fetch("/api/auth/telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData: rawInitData }),
        });

        const json: AuthTelegramResponse = await res.json();

        if (!res.ok || !json?.ok) {
          throw new Error(json?.error || "Telegram auth failed");
        }

        if (cancelled) return;

        setAuthData(json);
        setTelegramUser(json.telegramUser || null);
      } catch (e: any) {
        console.error("Telegram auth error:", e);
        if (!cancelled) {
          setAuthData(null);
          setTelegramUser(null);
          setAuthError(e?.message ? String(e.message) : String(e));
        }
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    }

    auth();

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    webApp,
    initData,
    telegramUser,

    authLoading,
    authError,
    authData,
  };
}
