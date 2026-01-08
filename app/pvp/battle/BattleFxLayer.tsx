'use client';

import { useEffect, useRef } from 'react';

/**
 * Battle FX Layer
 * All FX live ONLY here.
 * Death FX is ONE-SHOT and removes itself from DOM.
 */

export type FxEvent =
  | {
      type: 'death';
      id: string;
      x: number;
      y: number;
      size?: number;
    };

type Props = {
  events: FxEvent[];
};

const DEATH_GIF_DURATION = 900; // ms — length of death_smoke.gif

export default function BattleFxLayer({ events }: Props) {
  const playedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const e of events) {
      const key = `${e.type}:${e.id}`;
      if (playedRef.current.has(key)) continue;
      playedRef.current.add(key);

      if (e.type === 'death') {
        spawnDeathFx(e);
      }
    }
  }, [events]);

  function spawnDeathFx(e: Extract<FxEvent, { type: 'death' }>) {
    const container = document.createElement('div');
    container.className = 'bb-fx bb-fx-death';

    const size = e.size ?? 200;

    Object.assign(container.style, {
      position: 'absolute',
      left: `${e.x - size / 2}px`,
      top: `${e.y - size / 2}px`,
      width: `${size}px`,
      height: `${size}px`,
      pointerEvents: 'none',
      zIndex: '9999',
    });

    const img = document.createElement('img');
    img.src = '/fx/death_smoke.gif';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'contain';

    container.appendChild(img);
    document.body.appendChild(container);

    // Remove after one play
    setTimeout(() => {
      container.remove();
    }, DEATH_GIF_DURATION);
  }

  return null;
}
