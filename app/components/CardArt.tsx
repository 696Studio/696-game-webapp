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

// INNER GLOW color map (for inside card face, behind art, above bg)
const rarityInnerGlow = {
  common: {
    STRONG: "rgba(0,255,255,0.22)",
    MID: "rgba(0,255,255,0.14)",
    WEAK: "rgba(0,255,255,0.08)",
    opacity: 0.55,
  },
  rare: {
    STRONG: "rgba(0,255,255,0.34)",
    MID: "rgba(0,255,255,0.20)",
    WEAK: "rgba(0,255,255,0.10)",
    opacity: 0.70,
  },
  epic: {
    STRONG: "rgba(200,80,255,0.32)",
    MID: "rgba(200,80,255,0.20)",
    WEAK: "rgba(200,80,255,0.10)",
    opacity: 0.72,
  },
  legend: {
    STRONG: "rgba(255,190,60,0.32)",
    MID: "rgba(255,190,60,0.20)",
    WEAK: "rgba(255,190,60,0.10)",
    opacity: 0.75,
  },
};

// OUTER NEON GLOW MAP for rarity
const rarityOuterGlow = {
  common: "rgba(0,255,255,0.35)",
  rare: "rgba(0,255,255,0.55)",
  epic: "rgba(180,90,255,0.55)",
  legend: "rgba(255,190,80,0.60)",
};

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
    // Infer rarity from frameSrc
    const rarity = inferRarity(frameSrc);

    const neonGlowColor = rarityOuterGlow[rarity];
    const innerGlowColors = rarityInnerGlow[rarity];
    const { STRONG, MID, WEAK, opacity } = innerGlowColors;

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

    // MAIN CARD CONTAINER
    // We'll need to wrap the card in an outer div (for positioning stats bar absolutely relative to root)
    // Do NOT change card visuals or styles!
    // StatsBar will be a separate sibling absolutely positioned, not inside card

    // Compute clamped numbers for display
    const shownAtk = Number.isFinite(atk) ? Math.max(0, Math.floor(atk as number)) : 0;
    const shownHp = Number.isFinite(hp) ? Math.max(0, Math.floor(hp as number)) : 0;

    return (
      <div style={{position:"relative", width:"100%", height:"100%"}}>
        {/* The card body */}
        <div
          className={["relative w-full h-full", className].join(" ")}
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            overflow: "hidden",
            borderRadius: 18,
          }}
        >
          {/* Hide legacy PVP overlay blocks (title/big HP bars) without touching page.tsx */}
          <style jsx global>{`

            /* CardArt safety overrides for legacy battle markup */
            /* 1) Remove any "glass" / highlight layers coming from wrapper styles */
            .bb-card,
            .bb-face,
            .bb-front,
            .bb-card .bb-face,
            .bb-card .bb-front,
            .bb-card .bb-face-front {
              background: transparent !important;
              box-shadow: none !important;
              outline: none !important;
              border: none !important;
              backdrop-filter: none !important;
              -webkit-backdrop-filter: none !important;
              filter: none !important;
            }

            /* Kill pseudo-elements that often draw rounded translucent plates */
            .bb-card::before,
            .bb-card::after,
            .bb-face::before,
            .bb-face::after,
            .bb-front::before,
            .bb-front::after,
            .bb-card .bb-face::before,
            .bb-card .bb-face::after,
            .bb-card .bb-front::before,
            .bb-card .bb-front::after {
              content: none !important;
              display: none !important;
            }

            /* Keep our component clipping; don't force overflow visible */
            .bb-card,
            .bb-card .bb-face,
            .bb-card .bb-front,
            .bb-card .bb-face-front,
            .bb-face,
            .bb-front {
              overflow: hidden !important;
              border-radius: 18px !important;
            }

            /* Remove any legacy overlay containers */
            .bb-card .bb-overlay {
              display: none !important;
            }

          `}</style>

          {/* Inner face (CLIPPED) */}
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
            {/* Solid card background (RED theme) */}
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: "6%",
                borderRadius: 14,
                zIndex: 1,
                background: "linear-gradient(to bottom, #3b0a0a, #140405)",
              }}
            />

            {/* INNER NEON GLOW LAYER (between bg and art, behind art) */}
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: "6%",
                borderRadius: 14,
                pointerEvents: "none",
                zIndex: 2,
                background: `radial-gradient(circle at 50% 18%, ${STRONG} 0%, rgba(0,0,0,0) 58%)`,
                boxShadow: `inset 0 0 28px ${MID}, inset 0 0 70px ${WEAK}, 0 0 16px ${neonGlowColor}`,
                opacity: Math.min(0.95, (opacity ?? 0.7) + 0.20),
              }}
            />

            {/* Art (contain + center) */}
            {src ? (
              <div
                style={{
                  position: "absolute",
                  inset: "18%",
                  zIndex: 3,
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
                  zIndex: 3,
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

          {/* Frame overlay (CLIPPED): bigger frame, centered, but clipped to card bounds */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 10,
              overflow: "hidden",
              borderRadius: 18,
              pointerEvents: "none",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className={["bb-frame", frameClassName].join(" ")}
              src={frameSrc}
              alt=""
              draggable={false}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                objectPosition: "center",
                transform: "scale(1.14)",
                transformOrigin: "50% 50%",
              }}
            />
          </div>
          {/* Attack Pop below the card */}
          {AttackPop}

        </div>

        {/* --- STATS BAR BELOW CARD --- */}
        {showStats && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              top: "100%",
              left: "50%",
              transform: "translateX(-50%)",
              marginTop: 6,
              zIndex: 5,
              pointerEvents: "none",
              fontSize: 11,
              fontWeight: 600,
              color: "rgba(255,255,255,0.9)",
              letterSpacing: 0.2,
              whiteSpace: "nowrap",
              // No background, no border, no blur, no boxShadow
            }}
          >
            <span role="img" aria-label="Attack" style={{fontStyle:"normal"}}>⚔</span> {shownAtk} &nbsp; &bull; &nbsp; <span role="img" aria-label="Health" style={{fontStyle:"normal"}}>❤</span> {shownHp}
          </div>
        )}
      </div>
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
            style={{
              zIndex: 1
            }}
          />

          {/* Art */}
          <div className="absolute inset-0 flex items-center justify-center" style={{zIndex: 3}}>
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
            style={{
              zIndex: 10
            }}
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