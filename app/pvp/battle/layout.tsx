import type { ReactNode } from "react";
import "./battle.animations.css";

export default function BattleLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* BUILD STAMP (remove later) */}
      <div
        className="bb-fx-build-stamp"
        style={{
          position: "fixed",
          left: 10,
          top: 10,
          zIndex: 99999,
          background: "rgba(255,0,0,0.75)",
          color: "#fff",
          font: "12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial",
          padding: "6px 10px",
          borderRadius: 10,
          pointerEvents: "none",
        }}
      >
        FXDBG_LAYOUT_v1
      </div>

      {children}
    </>
  );
}
