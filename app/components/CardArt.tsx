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

// SVG sword icon for ATK
function IconSword() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" stroke="rgba(255,255,255,0.9)" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20l9-9-3-3-9 9v3h3z" />
      <path d="M16 5l3 3" />
      <path d="M6.5 11.5l6 6" />
      <path d="M7 17l-4 4" />
    </svg>
  );
}

// SVG heart icon for HP
function IconHeart() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" stroke="rgba(255,255,255,0.9)" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s-6.08-4.35-8.3-7.05C2.07 12.67 2 10.7 3.5 9.18A5.013 5.013 0 0 1 8 7.5c1.6 0 2.98.77 4 2 1.02-1.23 2.4-2 4-2 2.81 0 5.36 3.15 3.8 4.77C18.08 16.65 12 21 12 21z" />
    </svg>
  );
}

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
    // Badge pill for ATK and HP
    const StatsBar =
      showStats
        ? (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: "50%",
              top: "100%",
              transform: "translateX(-50%)",
              marginTop: 6,
              display: "flex",
              gap: 8,
              zIndex: 50,
              pointerEvents: "none",
            }}
          >
            {/* ATK pill */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 8px",
                borderRadius: 999,
                background: "rgba(0,0,0,0.55)",
                border: "1px solid rgba(255,255,255,0.18)",
                fontSize: 11,
                fontWeight: 900,
                lineHeight: 1,
                color: "rgba(255,255,255,0.95)",
              }}
            >
              <IconSword />
              <span className="tabular-nums">{Number.isFinite(atk) ? Math.max(0, Math.floor(atk)) : 0}</span>
            </div>
            {/* HP pill */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 8px",
                borderRadius: 999,
                background: "rgba(0,0,0,0.55)",
                border: "1px solid rgba(255,255,255,0.18)",
                fontSize: 11,
                fontWeight: 900,
                lineHeight: 1,
                color: "rgba(255,255,255,0.95)",
              }}
            >
              <IconHeart />
              <span className="tabular-nums">{Number.isFinite(hp) ? Math.max(0, Math.floor(hp)) : 0}</span>
              {shield && shield > 0 ? (
                <span style={{ opacity: 0.9 }}>
                  +<span className="tabular-nums">{Math.max(0, Math.floor(shield))}</span>
                </span>
              ) : null}
            </div>
          </div>
        ) : null;

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

        {/* StatsBar now rendered below the card, not overlaid */}
        {StatsBar}

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
