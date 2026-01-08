'use client';

import { useEffect, useRef } from 'react';

/**
 * Универсальный FX-слой боя.
 * Все FX живут ТОЛЬКО здесь.
 * Смерть — one-shot, сам удаляется из DOM.
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
    const el = document.createElement('div');
    el.className = 'bb-fx bb-fx-death';

    const size = e.size ?? 180;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.left = `${e.x}px`;
    el.style.top = `${e.y}px`;

    document.body.appendChild(el);

    // ⏱ длительность GIF (можешь менять)
    setTimeout(() => {
      el.remove();
    }, 900);
  }

  return null;
}
