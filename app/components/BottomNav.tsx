"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = "home" | "chest" | "inventory" | "pvp" | "profile";

function getActiveTab(pathname: string): Tab {
  if (pathname.startsWith("/chest")) return "chest";
  if (pathname.startsWith("/inventory")) return "inventory";
  if (pathname.startsWith("/pvp")) return "pvp";
  if (pathname.startsWith("/profile")) return "profile";
  return "home";
}

export default function BottomNav() {
  const pathname = usePathname();
  const active = useMemo(() => getActiveTab(pathname || "/"), [pathname]);

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

  const mk = (href: string, tab: Tab) =>
    `${tabBase} ${active === tab ? tabActive : tabIdle}`;

  return (
    <nav className="fixed left-0 right-0 bottom-0 z-50 px-4 pb-4">
      <div className="max-w-md mx-auto">
        <div className="ui-card ui-glow-cyan px-2 py-2 rounded-full">
          <div className="flex gap-2 justify-center">
            <Link href="/" prefetch={false} className={mk("/", "home")} aria-current={active === "home" ? "page" : undefined}>
              Home
            </Link>

            <Link href="/chest" prefetch={false} className={mk("/chest", "chest")} aria-current={active === "chest" ? "page" : undefined}>
              Chest
            </Link>

            <Link href="/inventory" prefetch={false} className={mk("/inventory", "inventory")} aria-current={active === "inventory" ? "page" : undefined}>
              Inventory
            </Link>

            <Link href="/pvp" prefetch={false} className={mk("/pvp", "pvp")} aria-current={active === "pvp" ? "page" : undefined}>
              PVP
            </Link>

            <Link href="/profile" prefetch={false} className={mk("/profile", "profile")} aria-current={active === "profile" ? "page" : undefined}>
              Profile
            </Link>
          </div>
        </div>

        <div className="h-[env(safe-area-inset-bottom)]" />
      </div>
    </nav>
  );
}
