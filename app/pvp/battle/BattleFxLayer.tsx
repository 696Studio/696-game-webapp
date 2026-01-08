'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * BattleFxLayer — ATTACK LUNGE (STEP 1)
 * - Calculates attacker → target vector
 * - Exposes CSS variables (--atk-dx / --atk-dy)
 * - Does NOT animate cards directly (CSS handles it)
 *
 * FX live ONLY here.
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
      direction: 'left' | 'right';
    };

type Props = {
  events: FxEvent[];
};

const DEATH_GIF_DURATION = 900;
const ATTACK_DURATION = 420;

type ActiveFx =
  | (Extract<FxEvent, { type: 'death' }> & { key: string })
  | (Extract<FxEvent, { type: 'attack' }> & {
      key: string;
      dx: number;
      dy: number;
    });

export default function BattleFxLayer({ events }: Props) {
  const playedRef = useRef<Set<string>>(new Set());
  const [activeFx, setActiveFx] = useState<ActiveFx[]>([]);

  const arenaRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    arenaRef.current = document.querySelector('.arena');
  }, []);

  useEffect(() => {
    const arena = arenaRef.current;

    for (const e of events) {
      const key =
        e.type === 'death'
          ? `death:${e.id}`
          : `attack:${e.id}:${e.attackerId}:${e.targetId}`;

      if (playedRef.current.has(key)) continue;

      playedRef.current.add(key);

      if (e.type === 'attack') {
        const attackerEl = document.querySelector<HTMLElement>(
          `[data-unit-id="${e.attackerId}"]`
        );
        const targetEl = document.querySelector<HTMLElement>(
          `[data-unit-id="${e.targetId}"]`
        );

        if (!arena || !attackerEl || !targetEl) continue;

        const aRect = arena.getBoundingClientRect();
        const r1 = attackerEl.getBoundingClientRect();
        const r2 = targetEl.getBoundingClientRect();

        const dx = r2.left + r2.width / 2 - (r1.left + r1.width / 2);
        const dy = r2.top + r2.height / 2 - (r1.top + r1.height / 2);

        setActiveFx((prev) => [
          ...prev,
          {
            ...e,
            key,
            dx,
            dy,
          } as ActiveFx,
        ]);

        setTimeout(() => {
          setActiveFx((prev) => prev.filter((fx) => fx.key !== key));
        }, ATTACK_DURATION);

        continue;
      }

      // death
      setActiveFx((prev) => [...prev, { ...e, key } as ActiveFx]);

      setTimeout(() => {
        setActiveFx((prev) => prev.filter((fx) => fx.key !== key));
      }, DEATH_GIF_DURATION);
    }
  }, [events]);

  return (
    <div
      className="bb-fx-layer"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    >
      {activeFx.map((fx) => {
        if (fx.type === 'death') {
          const size = fx.size ?? 200;
          return (
            <img
              key={fx.key}
              src="/fx/death_smoke.gif"
              alt=""
              style={{
                position: 'absolute',
                left: fx.x - size / 2,
                top: fx.y - size / 2,
                width: size,
                height: size,
                objectFit: 'contain',
                pointerEvents: 'none',
              }}
            />
          );
        }

        if (fx.type === 'attack') {
          return (
            <div
              key={fx.key}
              className="bb-attack-lunge"
              style={{
                ['--atk-dx' as any]: `${fx.dx}px`,
                ['--atk-dy' as any]: `${fx.dy}px`,
              }}
              data-attacker={fx.attackerId}
              data-target={fx.targetId}
            />
          );
        }

        return null;
      })}
    </div>
  );
}
