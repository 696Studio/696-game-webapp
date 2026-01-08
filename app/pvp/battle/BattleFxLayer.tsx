'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * BattleFxLayer — FINAL
 * Поддерживает:
 * - death FX (GIF, one-shot)
 * - attack FX (CSS + DOM, one-shot)
 *
 * FX живут ТОЛЬКО тут
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
  | (Extract<FxEvent, { type: 'attack' }> & { key: string });

export default function BattleFxLayer({ events }: Props) {
  const playedRef = useRef<Set<string>>(new Set());
  const [activeFx, setActiveFx] = useState<ActiveFx[]>([]);

  useEffect(() => {
    for (const e of events) {
      const key =
        e.type === 'death'
          ? `death:${e.id}`
          : `attack:${e.id}:${e.attackerId}:${e.targetId}`;

      if (playedRef.current.has(key)) continue;

      playedRef.current.add(key);
      setActiveFx((prev) => [...prev, { ...e, key } as ActiveFx]);

      const duration =
        e.type === 'death' ? DEATH_GIF_DURATION : ATTACK_DURATION;

      setTimeout(() => {
        setActiveFx((prev) => prev.filter((fx) => fx.key !== key));
      }, duration);
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
              className={`bb-attack-fx bb-attack-${fx.direction}`}
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
