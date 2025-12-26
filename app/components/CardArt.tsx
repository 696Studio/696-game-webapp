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
  artScalePct?: number; // e.g. 58 means maxWidth/maxHeight 58%

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
 * - This component is intentionally visual-only.
 * - In PVP mode it stays self-contained: background + art + frame + (optional) stats.
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
    // NOTE: This component is rendered INSIDE .bb-face (which is positioned),
    // so absolute layers below will be anchored correctly.

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
        className={`bb-stat bb-stat-${label.toLowerCase()}`}
        style={{
          position: "absolute",
          bottom: 6,
          left: side === "left" ? 6 : undefined,
          right: side === "right" ? 6 : undefined,
          zIndex: 8,
          pointerEvents: "none",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "4px 6px",
          borderRadius: 999,
          border: "1px solid rgba(255,255,255,0.20)",
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(8px)",
          fontWeight: 900,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          fontSize: 9,
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

        {/* Background (solid card back) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={DEFAULT_BACK}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "center",
            zIndex: 0,
            pointerEvents: "none",
          }}
        /> 

        {/* Inner matte (between back and frame) */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: "6%",
            borderRadius: 14,
            zIndex: 1,
            pointerEvents: "none",
            background:
              "radial-gradient(140px 120px at 50% 20%, rgba(255,255,255,0.14) 0%, rgba(0,0,0,0.0) 55%), linear-gradient(to bottom, rgba(0,0,0,0.20), rgba(0,0,0,0.55))",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)",
          }}
        />

        {/* Art (contain + center + bigger inset) */}
        {src ? (
          <div
            className="bb-art"
            style={{
              backgroundImage: `url(${src})`,
              // override .bb-art inset (was 18%) to give more breathing room inside the frame
              inset: "18%",
              backgroundSize: "contain",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "center",
              zIndex: 2,
              transform: "none",
              filter: "saturate(1.05) contrast(1.05)",
            }}
          />
        ) : (
          <div
            className="bb-art bb-art--ph"
            style={{
              inset: "18%",
              zIndex: 2,
            }}
          >
            <div className="bb-mark-sm">CARD</div>
          </div>
        )}

        {/* Frame overlay (always on top of art) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={["bb-frame", frameClassName].join(" ")}
          src={frameSrc}
          alt=""
          draggable={false}
          style={{
            // ensure top-most among the base layers
            zIndex: 6,
          }}
        />

        {/* Optional bottom-corner stats (HP/ATK) */}
        {showStats ? (
          <div
            className="bb-stats"
            aria-hidden="true"
            style={{ position: "absolute", inset: 0, zIndex: 8, pointerEvents: "none" }}
          >
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
          <div className="bb-corner" style={{ zIndex: 9 }}>
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
