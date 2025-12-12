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

  const base =
    "px-4 py-2 rounded-full border border-zinc-700 text-sm text-zinc-200 hover:bg-zinc-900";
  const activeCls = "bg-zinc-900 border-zinc-500";

  return (
    <nav className="fixed left-0 right-0 bottom-0 z-50 px-4 pb-4">
      <div className="max-w-md mx-auto flex gap-2 justify-center bg-black/30 backdrop-blur border border-zinc-800 rounded-full p-2">
        <a href="/" className={`${base} ${active === "home" ? activeCls : ""}`}>
          Home
        </a>
        <a
          href="/chest"
          className={`${base} ${active === "chest" ? activeCls : ""}`}
        >
          Chest
        </a>
        <a
          href="/inventory"
          className={`${base} ${active === "inventory" ? activeCls : ""}`}
        >
          Inventory
        </a>
        <a
          href="/profile"
          className={`${base} ${active === "profile" ? activeCls : ""}`}
        >
          Profile
        </a>
      </div>
    </nav>
  );
}
