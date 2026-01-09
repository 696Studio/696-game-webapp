'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * BattleFxLayer — PORTAL ATTACK FX (CLEAN, OPTION A)
 *
 * OPTION A: FX-клон = ПРОСТАЯ КАРТИНКА КАРТЫ (IMG)
 *
 * ❌ НЕТ dangerouslySetInnerHTML
 * ❌ НЕТ клонирования DOM
 * ❌ НЕТ старых FX / HTML мусора
 *
 * ✔ React-safe
 * ✔ Next.js-safe
 * ✔ Никаких crash #300 / #418
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
  imgSrc: string | null;
};

const ATTACK_DURATION = 520;

export default function BattleFxLayer({ events }: Props) {
  const playedRef = useRef<Set<string>>(new Set());
  const [attackFx, setAttackFx] = useState<AttackFx[]>([]);
  const [mounted, setMounted] = useState(false);

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

      const tryPlay = (tries = 0) => {
        const attackerEl = document.querySelector<HTMLElement>(`[data-unit-id="${e.attackerId}"]`);
        const targetEl = document.querySelector<HTMLElement>(`[data-unit-id="${e.targetId}"]`);

        // If React re-mounted or layout shifted, elements may not be ready on the first frame.
        if (!attackerEl || !targetEl) {
          if (tries < 12) requestAnimationFrame(() => tryPlay(tries + 1));
          return;
        }

        const img = attackerEl.querySelector<HTMLImageElement>('img');
        const fromRect = attackerEl.getBoundingClientRect();
        const toRect = targetEl.getBoundingClientRect();

        setAttackFx((prev) => [
          ...prev,
          {
            key,
            fromRect,
            toRect,
            imgSrc: img?.src ?? null,
          },
        ]);

        setTimeout(() => {
          setAttackFx((prev) => prev.filter((fx) => fx.key !== key));
        }, ATTACK_DURATION);
      };

      tryPlay();
    }
  }, [events, mounted]);

  if (!mounted) return null;

  return createPortal(
    <>
      <style>{`
        @keyframes bb_fx_lunge_touch_back {
          0%   { transform: translate3d(0px, 0px, 0) scale(1); }
          55%  { transform: translate3d(var(--fx-dx), var(--fx-dy), 0) scale(1.03); }
          70%  { transform: translate3d(calc(var(--fx-dx) * 0.92), calc(var(--fx-dy) * 0.92), 0) scale(1.00); }
          100% { transform: translate3d(0px, 0px, 0) scale(1); }
        }
      `}</style>
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
          <img
            key={fx.key}
            className="bb-fx-card-clone"
            src={fx.imgSrc ?? undefined}
            alt=""
            style={{
              position: 'fixed',
              left: fx.fromRect.left,
              top: fx.fromRect.top,
              width: fx.fromRect.width,
              height: fx.fromRect.height,
              objectFit: 'contain',
              transform: 'translate3d(0,0,0)',
              animation: `bb_fx_lunge_touch_back ${ATTACK_DURATION}ms cubic-bezier(.18,.9,.22,1) both`,
              ['--fx-dx' as any]: `${dx}px`,
              ['--fx-dy' as any]: `${dy}px`,
              zIndex: 9999,
              pointerEvents: 'none',
            }}
          />
        );
      })}
    </>,
    document.body
  );
}