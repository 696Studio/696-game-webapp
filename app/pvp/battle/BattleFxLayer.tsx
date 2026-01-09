'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * BattleFxLayer — MOVE REAL CARD VIA TRANSFORM (NO CLONE)
 *
 * Что ты хочешь: чтобы двигалась САМА карта, а не её копия.
 * Как делаем безопасно: НЕ меняем layout (никаких top/left), а даём
 * реальной DOM-карте временный transform: translate(...) и потом снимаем.
 *
 * ✔ выглядит как "карта атакует"
 * ✔ карта остаётся в своём слоте (transform не влияет на поток)
 * ✔ никаких дубликатов
 *
 * Требование: на корневом DOM карты/юнита есть data-unit-id="<id>"
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

  const k = 0.9; // "касание"
  const maxMove = Math.max(a.width, a.height) * 1.2;
  const len = Math.hypot(dx, dy) || 1;
  const safeK = clamp((maxMove / len) * k, 0.55, 0.92);

  return { dx: dx * safeK, dy: dy * safeK };
}

export default function BattleFxLayer({ events }: { events: FxEvent[] }) {
  const seenIdsRef = useRef<Set<string>>(new Set());

  // CSS для анимации — кладём в portal, чтобы не трогать твой layout/css
  const css = useMemo(
    () => `
      @keyframes bb_realcard_lunge_touch_back {
        0%   { transform: translate3d(0px, 0px, 0) scale(1); }
        55%  { transform: translate3d(var(--fx-dx), var(--fx-dy), 0) scale(1.03); }
        70%  { transform: translate3d(calc(var(--fx-dx) * 0.92), calc(var(--fx-dy) * 0.92), 0) scale(1.00); }
        100% { transform: translate3d(0px, 0px, 0) scale(1); }
      }

      /* ВАЖНО: transform применяется к САМОЙ карте. */
      .bb-realcard-attack {
        animation: bb_realcard_lunge_touch_back ${ATTACK_DURATION}ms cubic-bezier(.18,.9,.22,1) both !important;
        will-change: transform;
        z-index: 50; /* чтобы проходила поверх соседей, но не ломала слои */
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

      // Ставим CSS vars на реальный элемент и запускаем анимацию классом
      attackerEl.style.setProperty('--fx-dx', `${dx}px`);
      attackerEl.style.setProperty('--fx-dy', `${dy}px`);

      // Перезапуск анимации, если класс уже был (редкий кейс быстрых событий)
      attackerEl.classList.remove('bb-realcard-attack');
      // forced reflow
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

  // Нам не нужно рисовать DOM FX, только style. Portal — чтобы гарантированно в клиенте.
  return createPortal(<style>{css}</style>, document.body);
}
