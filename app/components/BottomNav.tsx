"use client";

import { usePathname, useRouter } from "next/navigation";
import { useMemo } from "react";

type Item = { label: string; href: string };

export default function BottomNav() {
  const router = useRouter();
  const pathname = usePathname();

  const items: Item[] = useMemo(
    () => [
      { label: "Главная", href: "/" },
      { label: "Кейсы", href: "/chest" },
      { label: "Инвентарь", href: "/inventory" },
      { label: "PVP", href: "/pvp" },
      { label: "Профиль", href: "/profile" },
    ],
    []
  );

  function go(href: string) {
    // никакой <a>, никакой default navigation
    if (pathname === href) return;
    router.push(href);
  }

  return (
    <nav
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        bottom: 12,
        zIndex: 50,
        pointerEvents: "auto",
      }}
    >
      <div
        className="ui-card"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${items.length}, 1fr)`,
          gap: 6,
          padding: 10,
          borderRadius: 18,
        }}
      >
        {items.map((it) => {
          const active = pathname === it.href;
          return (
            <button
              key={it.href}
              type="button"
              onClick={() => go(it.href)}
              className={["ui-btn", active ? "ui-btn-primary" : "ui-btn-ghost"].join(" ")}
              style={{
                padding: "10px 8px",
                fontSize: 11,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              {it.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
