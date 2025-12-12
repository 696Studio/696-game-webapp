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

  const [telegramUser, setTelegramUser] = useState<any | null>(null);

  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authData, setAuthData] = useState<AuthTelegramResponse | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;
    let attempts = 0;

    const interval = setInterval(() => {
      const tg = window.Telegram?.WebApp;
      attempts++;

      // ❗ ЖДЁМ, пока Telegram реально появится
      if (!tg) {
        if (attempts > 40) {
          clearInterval(interval);
        }
        return;
      }

      clearInterval(interval);

      setWebApp(tg);

      try {
        tg.ready?.();
        tg.expand?.();
      } catch {
        // ignore
      }

      const rawInitData =
        typeof tg.initData === "string" ? tg.initData : "";
      setInitData(rawInitData);

      // ✅ Desktop-safe user (initDataUnsafe)
      const unsafeUser = tg.initDataUnsafe?.user;
      if (unsafeUser?.id) {
        setTelegramUser(unsafeUser);
      } else {
        // fallback: парсим user из initData
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

      // если нет initData — auth невозможен
      if (!rawInitData) return;

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

          // ✅ verified user с сервера
          if (json.telegramUser?.id) {
            setTelegramUser(json.telegramUser);
          }
        } catch (e: any) {
          console.error("Telegram auth error:", e);
          if (!cancelled) {
            setAuthError(
              e?.message ? String(e.message) : String(e)
            );
            // ❗ НЕ обнуляем telegramUser,
            // иначе bootstrap опять останется без telegramId
          }
        } finally {
          if (!cancelled) setAuthLoading(false);
        }
      }

      auth();
    }, 100);

    return () => {
      cancelled = true;
      clearInterval(interval);
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
