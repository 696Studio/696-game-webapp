"use client";

import React, { useMemo, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";

type Tab = "home" | "chest" | "inventory" | "pvp" | "profile";

function getActiveTab(pathname: string): Tab {
  if (pathname.startsWith("/chest")) return "chest";
  if (pathname.startsWith("/inventory")) return "inventory";
  if (pathname.startsWith("/pvp")) return "pvp";
  if (pathname.startsWith("/profile")) return "profile";
  return "home";
}

export default function BottomNav() {
  const pathname = usePathname() || "/";
  const router = useRouter();

  const active = useMemo(() => getActiveTab(pathname), [pathname]);

  const tabBase =
    "relative ui-pill px-4 py-2 text-sm font-extrabold uppercase " +
    "tracking-[0.18em] text-[color:var(--text)] bg-transparent " +
    "transition-all duration-150 ease-out " +
    "hover:-translate-y-[1px] active:translate-y-[1px]";

  const tabActive =
    "border-[rgba(88,240,255,0.55)] " +
    "bg-[linear-gradient(180deg,rgba(255,255,255,0.16),rgba(255,255,255,0.06))] " +
    "shadow-[0_0_0_1px_rgba(88,240,255,0.18),0_12px_48px_rgba(88,240,255,0.18)] " +
    "scale-[1.04]";

  const tabIdle =
    "border-[color:var(--border)] opacity-85 " +
    "hover:bg-[rgba(255,255,255,0.06)]";

  const go = useCallback(
    (to: string) => {
      // если уже на этой вкладке — не дергаем навигацию
      if (to === "/" && active === "home") return;
      if (to.startsWith("/chest") && active === "chest") return;
      if (to.startsWith("/inventory") && active === "inventory") return;
      if (to.startsWith("/pvp") && active === "pvp") return;
      if (to.startsWith("/profile") && active === "profile") return;

      router.push(to);
    },
    [router, active]
  );

  const onTabClick = useCallback(
    (to: string) => (e: React.MouseEvent<HTMLButtonElement>) => {
      // Telegram WebView / iOS: глушим любые "побочные" клики/навигации
      e.preventDefault();
      e.stopPropagation();
      go(to);
    },
    [go]
  );

  return (
    <nav className="fixed left-0 right-0 bottom-0 z-50 px-4 pb-4 pointer-events-none">
      <div className="max-w-md mx-auto">
        <div className="ui-card ui-glow-cyan px-2 py-2 rounded-full pointer-events-auto">
          <div className="flex gap-2 justify-center">
            <button
              type="button"
              onClick={onTabClick("/")}
              className={`${tabBase} ${active === "home" ? tabActive : tabIdle}`}
              aria-current={active === "home" ? "page" : undefined}
            >
              Home
            </button>

            <button
              type="button"
              onClick={onTabClick("/chest")}
              className={`${tabBase} ${active === "chest" ? tabActive : tabIdle}`}
              aria-current={active === "chest" ? "page" : undefined}
            >
              Chest
            </button>

            <button
              type="button"
              onClick={onTabClick("/inventory")}
              className={`${tabBase} ${active === "inventory" ? tabActive : tabIdle}`}
              aria-current={active === "inventory" ? "page" : undefined}
            >
              Inventory
            </button>

            <button
              type="button"
              onClick={onTabClick("/pvp")}
              className={`${tabBase} ${active === "pvp" ? tabActive : tabIdle}`}
              aria-current={active === "pvp" ? "page" : undefined}
            >
              PVP
            </button>

            <button
              type="button"
              onClick={onTabClick("/profile")}
              className={`${tabBase} ${active === "profile" ? tabActive : tabIdle}`}
              aria-current={active === "profile" ? "page" : undefined}
            >
              Profile
            </button>
          </div>
        </div>

        <div className="h-[env(safe-area-inset-bottom)]" />
      </div>
    </nav>
  );
}
