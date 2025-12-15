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

  /**
   * Base tab style
   * Fortnite-like: pill, lift on hover, soft glass
   */
  const tabBase =
    "relative ui-pill px-4 py-2 text-sm font-extrabold uppercase " +
    "tracking-[0.18em] text-[color:var(--text)] bg-transparent " +
    "transition-all duration-150 ease-out " +
    "hover:-translate-y-[1px] active:translate-y-[1px]";

  /**
   * Active tab
   * Glow + rim light + slight scale
   */
  const tabActive =
    "border-[rgba(88,240,255,0.55)] " +
    "bg-[linear-gradient(180deg,rgba(255,255,255,0.16),rgba(255,255,255,0.06))] " +
    "shadow-[0_0_0_1px_rgba(88,240,255,0.18),0_12px_48px_rgba(88,240,255,0.18)] " +
    "scale-[1.04]";

  /**
   * Idle tab
   */
  const tabIdle =
    "border-[color:var(--border)] opacity-85 " +
    "hover:bg-[rgba(255,255,255,0.06)]";

  return (
    <nav className="fixed left-0 right-0 bottom-0 z-50 px-4 pb-4">
      <div className="max-w-md mx-auto">
        {/* Floating capsule */}
        <div className="ui-card ui-glow-cyan px-2 py-2 rounded-full">
          <div className="flex gap-2 justify-center">
            <a
              href="/"
              className={`${tabBase} ${
                active === "home" ? tabActive : tabIdle
              }`}
              aria-current={active === "home" ? "page" : undefined}
            >
              Home
            </a>

            <a
              href="/chest"
              className={`${tabBase} ${
                active === "chest" ? tabActive : tabIdle
              }`}
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

        {/* iOS safe-area */}
        <div className="h-[env(safe-area-inset-bottom)]" />
      </div>
    </nav>
  );
}
