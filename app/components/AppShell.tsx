"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { GameSessionProvider } from "../context/GameSessionContext";
import BottomNav from "./BottomNav";

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "";

  // Временно выключаем BottomNav на PVP страницах, чтобы проверить диагноз.
  // Если после этого тап НЕ делает PVP_MOUNT заново — 100% виноват BottomNav.
  const hideBottomNav =
    pathname === "/pvp" ||
    pathname.startsWith("/pvp/");

  return (
    <GameSessionProvider>
      {children}
      {!hideBottomNav && <BottomNav />}
    </GameSessionProvider>
  );
}
