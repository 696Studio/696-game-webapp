"use client";

import React, { createContext, useEffect, useMemo, useState } from "react";
import { Lang, messages } from "./messages";

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

export const I18nContext = createContext<Ctx | null>(null);

function getTelegramLang(): Lang | null {
  try {
    const tg = (window as any)?.Telegram?.WebApp;
    const code =
      tg?.initDataUnsafe?.user?.language_code ||
      tg?.initDataUnsafe?.user?.languageCode ||
      null;

    if (!code) return null;
    const c = String(code).toLowerCase();
    if (c.startsWith("ru") || c.startsWith("uk") || c.startsWith("be")) return "ru";
    return "en";
  } catch {
    return null;
  }
}

function getBrowserLang(): Lang {
  const l = (navigator.language || "en").toLowerCase();
  if (l.startsWith("ru") || l.startsWith("uk") || l.startsWith("be")) return "ru";
  return "en";
}

function deepGet(obj: any, path: string): any {
  return path.split(".").reduce((acc, k) => (acc && k in acc ? acc[k] : undefined), obj);
}

function interpolate(s: string, vars?: Record<string, string | number>) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>("ru");

  useEffect(() => {
    const tg = getTelegramLang();
    setLang(tg ?? getBrowserLang());
  }, []);

  const t = useMemo(() => {
    return (key: string, vars?: Record<string, string | number>) => {
      const dict = (messages as any)[lang] || messages.ru;
      const val = deepGet(dict, key);

      if (typeof val === "string") return interpolate(val, vars);

      // fallback to RU if key missing in EN
      const fallback = deepGet(messages.ru as any, key);
      if (typeof fallback === "string") return interpolate(fallback, vars);

      // if still missing, return key (so we see what to fix)
      return key;
    };
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
