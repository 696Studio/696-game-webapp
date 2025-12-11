"use client";

import { useEffect, useState } from "react";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: any;
    };
  }
}

export function useTelegramWebApp() {
  const [webApp, setWebApp] = useState<any | null>(null);
  const [initData, setInitData] = useState<string | null>(null);
  const [telegramUser, setTelegramUser] = useState<any | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const tg = window.Telegram?.WebApp;
    if (!tg) return;

    setWebApp(tg);
    const rawInitData: string = tg.initData || "";
    setInitData(rawInitData);

    try {
      const params = new URLSearchParams(rawInitData);
      const userStr = params.get("user");
      if (userStr) {
        const parsed = JSON.parse(userStr);
        setTelegramUser(parsed);
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  return { webApp, initData, telegramUser };
}
