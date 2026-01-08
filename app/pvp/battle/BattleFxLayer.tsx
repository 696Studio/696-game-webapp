'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * BattleFxLayer — PORTAL ATTACK FX (FIXED)
 *
 * Fixes React error #300 by:
 * - Rendering portal ONLY after mount
 * - Never touching document during render
 * - Keeping hooks unconditional
 *
 * ✔ Creates FX-clone of attacking card
 * ✔ Moves clone to target
 * ✔ Original cards NEVER move
 */

export type FxEvent =
  | {
      type: 'death';
      id: string;
      x: number;
      y: number;
      size?: number;
    }
  | {
      type: 'attack';
      id: string;
      attackerId: string;
      targetId: string;
    };

type Props = {
  events: FxEvent[];
};

type AttackFx = {
  key: string;
  fromRect: DOMRect;
  toRect: DOMRect;
  html: string;
};

const ATTACK_DURATION = 420;

export default function BattleFxLayer({ events }: Props) {
  const playedRef = useRef<Set<string>>(new Set());
  const [attackFx, setAttackFx] = useState<AttackFx[]>([]);
  const [mounted, setMounted] = useState(false);

  // Mount guard (CRITICAL for Next.js)
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    for (const e of events) {
      if (e.type !== 'attack') continue;

      const key = `attack:${e.id}:${e.attackerId}:${e.targetId}`;
      if (playedRef.current.has(key)) continue;
      playedRef.current.add(key);

      const attackerEl = document.querySelector<HTMLElement>(
        `[data-unit-id="${e.attackerId}"]`
      );
      const targetEl = document.querySelector<HTMLElement>(
        `[data-unit-id="${e.targetId}"]`
      );

      if (!attackerEl || !targetEl) continue;

      const fromRect = attackerEl.getBoundingClientRect();
      const toRect = targetEl.getBoundingClientRect();

      setAttackFx((prev) => [
        ...prev,
        {
          key,
          fromRect,
          toRect,
          html: attackerEl.innerHTML,
        },
      ]);

      setTimeout(() => {
        setAttackFx((prev) => prev.filter((fx) => fx.key !== key));
      }, ATTACK_DURATION);
    }
  }, [events, mounted]);

  if (!mounted) return null;

  return createPortal(
    <>
      {attackFx.map((fx) => {
        const dx =
          fx.toRect.left +
          fx.toRect.width / 2 -
          (fx.fromRect.left + fx.fromRect.width / 2);
        const dy =
          fx.toRect.top +
          fx.toRect.height / 2 -
          (fx.fromRect.top + fx.fromRect.height / 2);

        return (
          <div
            key={fx.key}
            className="bb-fx-card-clone"
            style={{
              position: 'fixed',
              left: fx.fromRect.left,
              top: fx.fromRect.top,
              width: fx.fromRect.width,
              height: fx.fromRect.height,
              transform: 'translate3d(0,0,0)',
              animation: `bb_fx_lunge ${ATTACK_DURATION}ms cubic-bezier(.18,.9,.22,1) both`,
              ['--fx-dx' as any]: `${dx}px`,
              ['--fx-dy' as any]: `${dy}px`,
              zIndex: 9999,
              pointerEvents: 'none',
            }}
            dangerouslySetInnerHTML={{ __html: fx.html }}
          />
        );
      })}
    </>,
    document.body
  );
}
