'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * BattleFxLayer — MOVE REAL CARD VIA CSS `translate` (NOT `transform`)
 *
 * Почему прошлый вариант мог "не двигать":
 * - у карты уже есть transform (hover/flip/scale), и animation по transform его перебивает/конфликтует.
 *
 * Решение: анимируем CSS-свойство `translate` (individual transform) — оно
 * добавляет смещение поверх существующего transform и не ломает его.
 *
 * Требование: на DOM карты/юнита есть data-unit-id="<id>" (на том элементе, который виден как "карта").
 */

export type FxEvent =
  | {
      type: 'attack';
      id: string;
      attackerId: string;
      targetId: string;
    };

const ATTACK_DURATION = 520;

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function getElByUnitId(unitId: string) {
  return document.querySelector<HTMLElement>(`[data-unit-id="${CSS.escape(unitId)}"]`);
}

function rectCenter(r: DOMRect) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function computeTouchDelta(a: DOMRect, b: DOMRect) {
  const ac = rectCenter(a);
  const bc = rectCenter(b);
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;

  const k = 0.9;
  const maxMove = Math.max(a.width, a.height) * 1.2;
  const len = Math.hypot(dx, dy) || 1;
  const safeK = clamp((maxMove / len) * k, 0.55, 0.92);

  return { dx: dx * safeK, dy: dy * safeK };
}

export default function BattleFxLayer({ events }: { events: FxEvent[] }) {
  const seenIdsRef = useRef<Set<string>>(new Set());

  const css = useMemo(
    () => `
      @keyframes bb_realcard_lunge_touch_back_translate {
        0%   { translate: 0px 0px; }
        55%  { translate: var(--fx-dx) var(--fx-dy); }
        70%  { translate: calc(var(--fx-dx) * 0.92) calc(var(--fx-dy) * 0.92); }
        100% { translate: 0px 0px; }
      }

      .bb-realcard-attack {
        animation: bb_realcard_lunge_touch_back_translate ${ATTACK_DURATION}ms cubic-bezier(.18,.9,.22,1) both !important;
        will-change: translate;
        z-index: 50;
      }
    `,
    []
  );

  useEffect(() => {
    const timers: any[] = [];

    for (const e of events || []) {
      if (e.type !== 'attack') continue;
      if (!e.id || !e.attackerId || !e.targetId) continue;
      if (seenIdsRef.current.has(e.id)) continue;

      seenIdsRef.current.add(e.id);

      const attackerEl = getElByUnitId(e.attackerId);
      const targetEl = getElByUnitId(e.targetId);
      if (!attackerEl || !targetEl) continue;

      const ar = attackerEl.getBoundingClientRect();
      const tr = targetEl.getBoundingClientRect();
      const { dx, dy } = computeTouchDelta(ar, tr);

      attackerEl.style.setProperty('--fx-dx', `${dx}px`);
      attackerEl.style.setProperty('--fx-dy', `${dy}px`);

      attackerEl.classList.remove('bb-realcard-attack');
      // forced reflow to restart animation
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      attackerEl.offsetHeight;
      attackerEl.classList.add('bb-realcard-attack');

      const t = setTimeout(() => {
        attackerEl.classList.remove('bb-realcard-attack');
        attackerEl.style.removeProperty('--fx-dx');
        attackerEl.style.removeProperty('--fx-dy');
      }, ATTACK_DURATION + 30);

      timers.push(t);
    }

    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [events]);

  return createPortal(<style>{css}</style>, document.body);
}
