"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";

type Tab = "home" | "chest" | "inventory" | "profile";

function getActiveTab(pathname: string): Tab {
  if (pathname.startsWith("/chest")) return "chest";
  if (pathname.startsWith("/inventory")) return "inventory";
  if (pathname.startsWith("/profile")) return "profile";
  return "home";
}

export default function BottomNav() {
  const pathname = usePathname();
  const active = useMemo(() => getActiveTab(pathname || "/"), [pathname]);

  const tabBase =
    "ui-pill px-4 py-2 text-sm text-[color:var(--text)] bg-transparent " +
    "transition-transform duration-150 active:translate-y-[1px] " +
    "hover:bg-[rgba(255,255,255,0.06)]";

  const tabActive =
    "border-[rgba(255,255,255,0.38)] bg-[rgba(255,255,255,0.08)] " +
    "shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_12px_40px_rgba(255,255,255,0.04)]";

  const tabIdle = "border-[color:var(--border)] opacity-90";

  return (
    <nav className="fixed left-0 right-0 bottom-0 z-50 px-4 pb-4">
      <div className="max-w-md mx-auto">
        <div className="ui-card px-2 py-2 rounded-full">
          <div className="flex gap-2 justify-center">
            <a
              href="/"
              className={`${tabBase} ${active === "home" ? tabActive : tabIdle}`}
              aria-current={active === "home" ? "page" : undefined}
            >
              Home
            </a>

            <a
              href="/chest"
              className={`${tabBase} ${active === "chest" ? tabActive : tabIdle}`}
              aria-current={active === "chest" ? "page" : undefined}
            >
              Chest
            </a>

            <a
              href="/inventory"
              className={`${tabBase} ${
                active === "inventory" ? tabActive : tabIdle
              }`}
              aria-current={active === "inventory" ? "page" : undefined}
            >
              Inventory
            </a>

            <a
              href="/profile"
              className={`${tabBase} ${
                active === "profile" ? tabActive : tabIdle
              }`}
              aria-current={active === "profile" ? "page" : undefined}
            >
              Profile
            </a>
          </div>
        </div>

        {/* safe area padding for iOS home indicator */}
        <div className="h-[env(safe-area-inset-bottom)]" />
      </div>
    </nav>
  );
}
