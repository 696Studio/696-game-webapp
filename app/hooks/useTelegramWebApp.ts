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
  const [initData, setInitData] = useState<string>("");

  // ✅ telegramUser теперь НЕ будет null на Desktop,
  // потому что сначала берём initDataUnsafe.user
  // и потом (если auth ок) заменяем на verified telegramUser
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
      tg.expand?.();
    } catch {
      // ignore
    }

    // initData строка нужна для /api/auth/telegram
    const rawInitData: string = typeof tg.initData === "string" ? tg.initData : "";
    setInitData(rawInitData);

    // ✅ Самый надёжный user на Desktop: initDataUnsafe.user
    const unsafeUser = tg.initDataUnsafe?.user;
    if (unsafeUser?.id) {
      setTelegramUser(unsafeUser);
    } else {
      // fallback: пробуем вытащить user из rawInitData
      try {
        const params = new URLSearchParams(rawInitData);
        const userStr = params.get("user");
        if (userStr) {
          const parsed = JSON.parse(userStr);
          if (parsed?.id) setTelegramUser(parsed);
        }
      } catch {
        // ignore
      }
    }

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

        // ✅ verified user (после /api/auth/telegram)
        // перезаписываем telegramUser на подтверждённого
        if (json.telegramUser?.id) {
          setTelegramUser(json.telegramUser);
        }
      } catch (e: any) {
        console.error("Telegram auth error:", e);
        if (!cancelled) {
          setAuthData(null);
          setAuthError(e?.message ? String(e.message) : String(e));

          // ВАЖНО: не обнуляем telegramUser, если он уже есть из initDataUnsafe,
          // иначе GameSessionContext опять останется без telegramId.
          // setTelegramUser(null);
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
