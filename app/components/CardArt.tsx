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

  /** PVP: Optional pop-up label below the card ("Attack Pop"). */
  popText?: string;
  popType?: "atk" | "hp";
  showPop?: boolean;
};

const DEFAULT_FRAME = "/cards/frame/frame_common.png";
const DEFAULT_BACK = "/cards/back/card_back.png";

// SVG sword icon for ATK
function IconSword() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" stroke="rgba(255,255,255,0.9)" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round">
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
    <svg width="10" height="10" viewBox="0 0 24 24" stroke="rgba(255,255,255,0.9)" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s-6.08-4.35-8.3-7.05C2.07 12.67 2 10.7 3.5 9.18A5.013 5.013 0 0 1 8 7.5c1.6 0 2.98.77 4 2 1.02-1.23 2.4-2 4-2 2.81 0 5.36 3.15 3.8 4.77C18.08 16.65 12 21 12 21z" />
    </svg>
  );
}

/* Small background icon circle for pill icons */
function StatIconCircle({ children, bg = "rgba(30,255,255,0.22)" }: { children: React.ReactNode; bg?: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 14,
        height: 14,
        minWidth: 14,
        minHeight: 14,
        borderRadius: '50%',
        background: bg,
        boxShadow: "0 1px 3px 0 rgba(0,255,255,0.06)",
        marginRight: 0,
      }}
    >
      {children}
    </span>
  );
}

// Helper function to infer rarity from frameSrc string
function inferRarity(frameSrc: string | undefined): "legend" | "epic" | "rare" | "common" {
  if (frameSrc && frameSrc.toLowerCase().includes("legend")) {
    return "legend";
  }
  if (frameSrc && frameSrc.toLowerCase().includes("epic")) {
    return "epic";
  }
  if (frameSrc && frameSrc.toLowerCase().includes("rare")) {
    return "rare";
  }
  return "common";
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
  popText = "",
  popType = "atk",
  showPop = false,
}: CardArtProps) {
  if (variant === "pvp") {
    // Glow visual settings per rarity
    const rarity = inferRarity(frameSrc);
    let glowBoxShadow = "";
    let glowOpacity = 0.7;

    if (rarity === "legend") {
      glowBoxShadow = "0 0 26px rgba(255,190,60,0.38), 0 0 74px rgba(255,190,60,0.22)";
      glowOpacity = 0.86;
    } else if (rarity === "epic") {
      glowBoxShadow = "0 0 22px rgba(200,80,255,0.34), 0 0 62px rgba(200,80,255,0.20)";
      glowOpacity = 0.76;
    } else if (rarity === "rare") {
      glowBoxShadow = "0 0 20px rgba(0,255,255,0.34), 0 0 56px rgba(0,255,255,0.18)";
      glowOpacity = 0.72;
    } else {
      // common
      glowBoxShadow = "0 0 18px rgba(0,255,255,0.22), 0 0 44px rgba(0,255,255,0.14)";
      glowOpacity = 0.60;
    }

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
              transform: "translateX(-50%) scale(0.8)",
              transformOrigin: "50% 0%",
              marginTop: 2,
              display: "flex",
              gap: 5,
              zIndex: 51,
              pointerEvents: "none",
              fontFamily: "inherit",
            }}
          >
            {/* ATK pill */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 3,
                padding: "1px 6px 1px 4px",
                borderRadius: 999,
                background: "rgba(0,10,15,0.75)",
                border: "1px solid rgba(0,255,255,0.13)",
                fontSize: 8,
                fontWeight: 900,
                lineHeight: 1,
                color: "rgba(255,255,255,0.97)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.14)",
                minWidth: 28,
                minHeight: 14,
              }}
            >
              <StatIconCircle bg="rgba(3,200,255,0.27)">
                <IconSword />
              </StatIconCircle>
              <span className="tabular-nums">{Number.isFinite(atk) ? Math.max(0, Math.floor(atk)) : 0}</span>
            </div>
            {/* HP pill */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 3,
                padding: "1px 6px 1px 4px",
                borderRadius: 999,
                background: "rgba(0,10,15,0.75)",
                border: "1px solid rgba(0,255,255,0.10)",
                fontSize: 8,
                fontWeight: 900,
                lineHeight: 1,
                color: "rgba(255,255,255,0.97)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.14)",
                minWidth: 28,
                minHeight: 14,
              }}
            >
              <StatIconCircle bg="rgba(30,255,180,0.18)">
                <IconHeart />
              </StatIconCircle>
              <span className="tabular-nums">{Number.isFinite(hp) ? Math.max(0, Math.floor(hp)) : 0}</span>
              {shield && shield > 0 ? (
                <span style={{
                  opacity: 0.9,
                  marginLeft: 2,
                  color: "#8df9f6",
                  fontWeight: 700,
                  fontSize: 8
                }}>
                  +<span className="tabular-nums">{Math.max(0, Math.floor(shield))}</span>
                </span>
              ) : null}
            </div>
          </div>
        ) : null;

    // Attack Pop-out
    const AttackPop = showPop && !!popText ? (
      <>
        <style jsx>{`
        @keyframes cardart-pop-fade {
          from {
            opacity: 0;
            transform: translateY(15px) scale(0.92);
          }
          60% {
            opacity: 1;
            transform: translateY(-2px) scale(1.04);
          }
          to {
            opacity: 1;
            transform: translateY(-7px) scale(1);
          }
        }
        `}
        </style>
        <div
          aria-live="polite"
          aria-atomic="true"
          style={{
            position: 'absolute',
            left: '50%',
            top: '100%',
            transform: 'translate(-50%, 0)',
            marginTop: 10,
            zIndex: 53,
            pointerEvents: 'none',
            display: 'flex',
            justifyContent: 'center',
            animation: "cardart-pop-fade 620ms cubic-bezier(0.40,0.50,0.28,1) both",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "4px 12px 4px 8px",
              borderRadius: 999,
              background: "linear-gradient(90deg,rgba(40,225,255,0.97) 2%,rgba(10,80,180,0.72) 100%)",
              border: "2px solid rgba(0,255,255,0.38)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 900,
              lineHeight: 1,
              boxShadow: "0 2px 20px 0 rgba(0,255,255,0.18),0 1.5px 5px 0 rgba(0,60,130,0.11)",
              textShadow: "0 1px 2px rgba(9,80,160,0.16)",
              letterSpacing: "0.01em",
              opacity: 0.99,
              filter: "drop-shadow(0 2px 7px rgba(0,255,255,0.20))",
              userSelect: "none",
            }}
          >
            <StatIconCircle bg={popType === "atk" ? "rgba(10,225,255,0.37)" : "rgba(70,255,180,0.33)"}>
              {popType === "atk" ? <IconSword /> : <IconHeart />}
            </StatIconCircle>
            <span>{popText}</span>
          </div>
        </div>
      </>
    ) : null;

    return (
      <>
        {/* Hide legacy PVP overlay blocks (title/big HP bars) without touching page.tsx */}
        <style jsx global>{`
          /* Ensure glow + below-card stats are not clipped by legacy containers */
          .bb-card,
          .bb-card .bb-face,
          .bb-card .bb-front,
          .bb-card .bb-face-front,
          .bb-face,
          .bb-front {
            overflow: visible !important;
          }

          /* Hide legacy PVP overlay blocks (big bars/text) */
          .bb-card .bb-overlay {
            display: none !important;
          }
`}</style>
        {/* Card Glow Effect (PREMIUM NEON GLOW by RARITY) — behind art & frame */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1,
            pointerEvents: "none",
            borderRadius: 20,
            boxShadow: glowBoxShadow,
            filter: "blur(14px)",
            opacity: glowOpacity,
            mixBlendMode: "screen",
            background: "none",
          }}
        />
        {/* Inner face (CLIPPED): ONLY a clean background + art (no oval plate, no circular highlights). */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 2,
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
                fontSize: 8,
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

        {/* Attack Pop below the card, above StatsBar */}
        {AttackPop}

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
