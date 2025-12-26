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
   * - "pvp": renders PVP card face elements using existing classNames (bb-art/bb-frame/bb-stats),
   *          so battle layout/animations stay untouched.
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

/**
 * CardArt
 *
 * IMPORTANT:
 * - This component is intentionally visual-only.
 * - In PVP mode it preserves the exact classNames used by battle CSS/animations.
 * - Do NOT move/resize battle UI outside the card container.
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
    return (
      <>
        {src ? (
          <div className="bb-art" style={{ backgroundImage: `url(${src})` }} />
        ) : (
          <div className="bb-art bb-art--ph">
            <div className="bb-mark-sm">CARD</div>
          </div>
        )}

        {/* Frame overlay (must stay on top of art) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={["bb-frame", frameClassName].join(" ")} src={frameSrc} alt="" draggable={false} />

        {showStats ? (
          <div className="bb-stats" aria-hidden="true">
            <div className="bb-stat bb-atk" title="Attack">
              <span className="bb-stat-icon">
                <svg className="bb-stat-svg" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M21 3l-6.8 6.8 1.4 1.4L22.4 4.4 21 3zM3 21l6.8-6.8-1.4-1.4L1.6 19.6 3 21zM14.2 9.8l3.7-.4-.9-.9-2 .2-.2-2-.9-.9-.4 3.7c-.1.8.6 1.5 1.5 1.3z" />
                </svg>
              </span>
              <span className="bb-stat-num tabular-nums">{atk}</span>
            </div>

            <div className="bb-stat bb-hp" title="HP">
              <span className="bb-stat-icon">
                <svg className="bb-stat-svg" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 2s4 5.1 4 8.3C16 14 14 16 12 16s-4-2-4-5.7C8 7.1 12 2 12 2z" />
                  <path d="M7 14.5C7 18 9.5 21 12 21s5-3 5-6.4c0-1.9 0-3.8-2.6-6.4C7.5 11.7 7 13.1 7 14.5z" opacity="0.6" />
                </svg>
              </span>
              <span className="bb-stat-num tabular-nums">{hp}</span>

              {shield && shield > 0 ? (
                <span className="bb-shield" title="Shield">
                  +<span className="tabular-nums">{shield}</span>
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {showCorner ? (
          <div className="bb-corner">
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

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={frameSrc}
            alt=""
            className={[
              "absolute inset-0 w-full h-full object-contain pointer-events-none",
              frameClassName,
            ].join(" ")}
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
