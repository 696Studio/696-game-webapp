'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * BattleFxLayer — FINAL FIX
 * Отличие от исходника:
 * - FX РЕНДЕРИТСЯ ЧЕРЕЗ JSX (а не document.createElement)
 * - GIF ТОЧНО ВИДЕН (в React-дереве)
 * - Проигрывается ОДИН РАЗ и удаляется по таймеру
 * - Ничего лишнего из проекта не удаляет
 */

export type FxEvent = {
  type: 'death';
  id: string;
  x: number;
  y: number;
  size?: number;
};

type Props = {
  events: FxEvent[];
};

const DEATH_GIF_DURATION = 900;

type ActiveFx = FxEvent & { key: string };

export default function BattleFxLayer({ events }: Props) {
  const playedRef = useRef<Set<string>>(new Set());
  const [activeFx, setActiveFx] = useState<ActiveFx[]>([]);

  useEffect(() => {
    for (const e of events) {
      const key = `${e.type}:${e.id}`;
      if (playedRef.current.has(key)) continue;

      playedRef.current.add(key);
      setActiveFx((prev) => [...prev, { ...e, key }]);

      // авто-удаление (one-shot)
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
      })}
    </div>
  );
}
