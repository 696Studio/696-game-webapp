'use client';

/**
 * page.minimal.tsx
 *
 * RADICAL STABILITY CHECK
 * ----------------------
 * Purpose:
 * - Prove whether /pvp crashes because of page.tsx logic/render tree
 * - NO FX
 * - NO timeline
 * - NO hooks chaos
 *
 * If this page DOES NOT crash:
 * -> the problem is 100% inside the old page.tsx render logic / hooks
 */

export default function PvpMinimalPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0b0b0f',
        color: '#fff',
        fontSize: 18,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      ✅ PVP MINIMAL PAGE — NO FX, NO LOGIC
    </div>
  );
}
