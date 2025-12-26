"use client";

import React from "react";

type CardArtProps = {
  /** Resolved image URL (already mapped to /cards/art/... if needed). */
  src: string | null | undefined;
  /** Optional alt text for accessibility (generic mode). */
  alt?: string;

  /** Frame image URL. Default: /cards/frame/frame_common.png */
  frameSrc?: string;

  /**
   * Render variant:
   * - "generic": simple <img> art + frame overlay (default, used in inventory/chest).
   * - "pvp": renders PVP card face elements.
   */
  variant?: "generic" | "pvp";

  /** Size of the art inside the frame (generic mode only, %). */
  artScalePct?: number;

  /** PVP stats (pvp mode only). */
  showStats?: boolean;
  atk?: number;
  hp?: number;
  shield?: number;
  showCorner?: boolean;

  /** Optional className for the outer container. */
  className?: string;

  /** Optional className for the frame element. */
  frameClassName?: string;

  /** Optional className for the art element (generic mode). */
  artClassName?: string;
};

const DEFAULT_FRAME = "/cards/frame/frame_common.png";
const DEFAULT_BACK = "/cards/back/card_back.png";

/**
 * CardArt
 *
 * IMPORTANT:
 * - Visual-only component.
 * - In PVP mode we render a CLIPPED inner face (background + art) and an UNCLIPPED frame on top.
 * - PVP HUD outside the card must never be touched here.
 */
export default function CardArt({
  src,
  alt = "",
  frameSrc = DEFAULT_FRAME,
  variant = "generic",
  artScalePct = 58,
  showStats = false,
  atk = 0,
  hp = 0,
  shield = 0,
  showCorner = false,
  className = "",
  frameClassName = "",
  artClassName = "",
}: CardArtProps) {
  if (variant === "pvp") {
    const StatPill = ({
      side,
      value,
      label,
      extra,
    }: {
      side: "left" | "right";
      value: number;
      label: string;
      extra?: React.ReactNode;
    }) => (
      <div
        style={{
          position: "absolute",
          bottom: 4,
          left: side === "left" ? 6 : undefined,
          right: side === "right" ? 6 : undefined,
          zIndex: 20,
          pointerEvents: "none",
          display: "inline-flex",
          alignItems: "center",
          gap: 2,
          padding: "2px 4px",
          borderRadius: 999,
          border: "1px solid rgba(255,255,255,0.18)",
          background: "rgba(0,0,0,0.45)",
          backdropFilter: "blur(8px)",
          fontWeight: 900,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          fontSize: 7,
          lineHeight: 1,
        }}
        aria-label={label}
      >
        <span className="tabular-nums">{Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0}</span>
        {extra}
      </div>
    );

    return (
      <>
        {/* Hide legacy PVP overlay blocks (title/big HP bars) without touching page.tsx */}
        <style jsx global>{`
          .bb-card .bb-overlay { display: none !important; }
        `}</style>

        {/* Inner face (CLIPPED): ONLY a clean background + art (no oval plate, no circular highlights). */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 0,
            overflow: "hidden",
            borderRadius: 18,
            pointerEvents: "none",
          }}
        >
          {/* Clean front face background (NOT card back; back should only appear on flip) */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 0,
              background: "linear-gradient(to bottom, rgba(10,18,24,0.30), rgba(2,6,10,0.86))",
            }}
          />

          {/* Art (contain + center) — do NOT use .bb-art class to avoid any legacy CSS pseudo-elements */}
          {src ? (
            <div
              style={{
                position: "absolute",
                inset: "18%",
                zIndex: 2,
                backgroundImage: `url(${src})`,
                backgroundSize: "contain",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "center",
                transform: "none",
                filter: "saturate(1.05) contrast(1.05)",
              }}
            />
          ) : (
            <div
              style={{
                position: "absolute",
                inset: "18%",
                zIndex: 2,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: 0.6,
                fontSize: 10,
                fontWeight: 800,
              }}
            >
              CARD
            </div>
          )}
        </div>

        {/* Frame overlay (UNCLIPPED): bigger frame, centered, no distortion */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={["bb-frame", frameClassName].join(" ")}
          src={frameSrc}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 10,
            pointerEvents: "none",
            objectFit: "contain",
            objectPosition: "center",
            transform: "scale(1.14)",
            transformOrigin: "50% 50%",
          }}
        />

        {/* Optional bottom-corner stats (HP/ATK) */}
        {showStats ? (
          <div aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: 20, pointerEvents: "none" }}>
            <StatPill side="left" value={atk} label="ATK" />
            <StatPill
              side="right"
              value={hp}
              label="HP"
              extra={
                shield && shield > 0 ? (
                  <span style={{ opacity: 0.9 }}>
                    +<span className="tabular-nums">{Math.max(0, Math.floor(shield))}</span>
                  </span>
                ) : null
              }
            />
          </div>
        ) : null}

        {showCorner ? (
          <div className="bb-corner" style={{ zIndex: 30 }}>
            <span className="bb-corner-dot" />
          </div>
        ) : null}
      </>
    );
  }

  // generic mode (inventory/chest): centered art + frame overlay
  return (
    <div className={["relative w-full h-full", className].join(" ")}>
      {src ? (
        <>
          {/* Background */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={DEFAULT_BACK}
            alt=""
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            draggable={false}
          />

          {/* Art */}
          <div className="absolute inset-0 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={alt}
              className={["object-contain", "transition-transform duration-150", artClassName].join(" ")}
              style={{
                maxWidth: `${artScalePct}%`,
                maxHeight: `${artScalePct}%`,
                objectFit: "contain",
                objectPosition: "50% 50%",
              }}
              loading="lazy"
              draggable={false}
            />
          </div>

          {/* Frame */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={frameSrc}
            alt=""
            className={["absolute inset-0 w-full h-full object-contain pointer-events-none", frameClassName].join(" ")}
            draggable={false}
          />
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-black/10">
          <div className="text-xs opacity-70">No image</div>
        </div>
      )}
    </div>
  );
}
