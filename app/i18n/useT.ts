"use client";

import { useContext } from "react";
import { I18nContext } from "./I18nProvider";

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    return {
      lang: "ru" as const,
      setLang: (_: any) => {},
      t: (k: string) => k,
    };
  }
  return ctx;
}
