'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * BattleFxLayer — TOUCH → BACK (MOVE SLOT, NOT CARD)
 *
 * Почему раньше могло "не двигаться":
 * - реальная .bb-card уже анимируется по transform (flipIn / reveal), и transform-анимации конфликтуют.
 *
 * Решение:
 * - двигаем ближайший контейнер слота: attackerRoot.closest('.bb-slot')
 *   У .bb-slot обычно нет transform-анимаций, поэтому движение 100% видно.
 *
 * Это НЕ меняет layout (transform не влияет на поток), и НЕ трогает координаты аватарок/HP/HUD.
 */

export type FxEvent =
  | {
      type: 'attack';
      id: string;
      attackerId: string;
      targetId: string;
    };

const ATTACK_DURATION = 520;
const RETRY_FRAMES = 12;

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
  const maxMove = Math.max(a.width, a.height) * 1.15;
  const len = Math.hypot(dx, dy) || 1;
  const safeK = clamp((maxMove / len) * k, 0.55, 0.92);

  return { dx: dx * safeK, dy: dy * safeK };
}

export default function BattleFxLayer({ events }: { events: FxEvent[] }) {
  const seenIdsRef = useRef<Set<string>>(new Set());

  const css = useMemo(
    () => `
      @keyframes bb_slot_lunge_touch_back {
        0%   { transform: translate3d(0px, 0px, 0) scale(1); }
        55%  { transform: translate3d(var(--fx-dx), var(--fx-dy), 0) scale(1.03); }
        70%  { transform: translate3d(calc(var(--fx-dx) * 0.92), calc(var(--fx-dy) * 0.92), 0) scale(1.00); }
        100% { transform: translate3d(0px, 0px, 0) scale(1); }
      }

      .bb-slot.bb-slot-attack {
        animation: bb_slot_lunge_touch_back ${ATTACK_DURATION}ms cubic-bezier(.18,.9,.22,1) both !important;
        will-change: transform;
        z-index: 60; /* поверх соседних слотов */
      }
    `,
    []
  );

  useEffect(() => {
    const timers: any[] = [];
    const rafs: number[] = [];

    const runWithRetry = (attackerId: string, targetId: string, fn: (a: HTMLElement, b: HTMLElement) => void) => {
      let frame = 0;
      const tick = () => {
        frame += 1;
        const attackerRoot = getElByUnitId(attackerId);
        const targetRoot = getElByUnitId(targetId);

        if (attackerRoot && targetRoot) {
          fn(attackerRoot, targetRoot);
          return;
        }

        if (frame < RETRY_FRAMES) {
          rafs.push(requestAnimationFrame(tick));
        }
      };

      rafs.push(requestAnimationFrame(tick));
    };

    for (const e of events || []) {
      if (e.type !== 'attack') continue;
      if (!e.id || !e.attackerId || !e.targetId) continue;
      if (seenIdsRef.current.has(e.id)) continue;

      seenIdsRef.current.add(e.id);

      // освобождаем id позже, чтобы не залипало навсегда
      timers.push(
        window.setTimeout(() => {
          seenIdsRef.current.delete(e.id);
        }, ATTACK_DURATION + 600)
      );

      runWithRetry(e.attackerId, e.targetId, (attackerRoot, targetRoot) => {
        const moveEl = (attackerRoot.closest('.bb-slot') as HTMLElement) || attackerRoot;
        const targetEl = (targetRoot.closest('.bb-slot') as HTMLElement) || targetRoot;

        const ar = attackerRoot.getBoundingClientRect();
        const tr = targetRoot.getBoundingClientRect();
        const { dx, dy } = computeTouchDelta(ar, tr);

        moveEl.style.setProperty('--fx-dx', `${dx}px`);
        moveEl.style.setProperty('--fx-dy', `${dy}px`);

        moveEl.classList.remove('bb-slot-attack');
        // forced reflow to restart animation
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        moveEl.offsetHeight;
        moveEl.classList.add('bb-slot-attack');

        timers.push(
          window.setTimeout(() => {
            moveEl.classList.remove('bb-slot-attack');
            moveEl.style.removeProperty('--fx-dx');
            moveEl.style.removeProperty('--fx-dy');
          }, ATTACK_DURATION + 40)
        );
      });
    }

    return () => {
      for (const t of timers) clearTimeout(t);
      for (const r of rafs) cancelAnimationFrame(r);
    };
  }, [events]);

  return createPortal(<style>{css}</style>, document.body);
}
