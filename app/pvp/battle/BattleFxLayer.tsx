'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * BattleFxLayer — ATTACK TOUCH → BACK (ROBUST)
 *
 * Проблема: когда мы пытались двигать "реальную карту", анимация пропала,
 * потому что:
 * - у карты уже есть transform/animation (hover/flip/scale) и transform-анимация конфликтует
 * - data-unit-id может стоять на элементе, который не двигается визуально (внутри есть wrapper)
 *
 * Решение:
 * 1) Пытаемся двигать РЕАЛЬНУЮ карту через CSS `translate` (individual transform) + vars.
 *    Это добавляется поверх существующего transform и не ломает layout.
 * 2) Если не получается (не нашли элемент / не двигается wrapper) — fallback:
 *    рисуем клон DOM карты поверх (как раньше), чтобы атака ВСЕГДА была видна.
 *
 * Важно: Мы НЕ меняем layout, только временно добавляем class/vars, потом снимаем.
 */

export type FxEvent =
  | {
      type: 'attack';
      id: string;
      attackerId: string;
      targetId: string;
    };

type AttackFx = {
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

  // "касание"
  const k = 0.9;
  const maxMove = Math.max(a.width, a.height) * 1.2;
  const len = Math.hypot(dx, dy) || 1;
  const safeK = clamp((maxMove / len) * k, 0.55, 0.92);

  return { dx: dx * safeK, dy: dy * safeK };
}

/**
 * Иногда data-unit-id стоит на контейнере, а визуальная "карта" — на ребенке.
 * Ищем лучший кандидат внутри.
 */
function pickVisualCardEl(root: HTMLElement): HTMLElement {
  // пробуем очевидные классы
  const preferred =
    root.querySelector<HTMLElement>('.bb-card') ||
    root.querySelector<HTMLElement>('[class*="card"]') ||
    root.querySelector<HTMLElement>('article') ||
    root;
  return preferred;
}

function startRealCardAttack(attackerRoot: HTMLElement, targetRoot: HTMLElement): boolean {
  const attackerEl = pickVisualCardEl(attackerRoot);
  const targetEl = pickVisualCardEl(targetRoot);

  const ar = attackerEl.getBoundingClientRect();
  const tr = targetEl.getBoundingClientRect();
  if (!ar.width || !ar.height || !tr.width || !tr.height) return false;

  const { dx, dy } = computeTouchDelta(ar, tr);

  // выставляем vars на КОРНЕВУЮ ноду unit-а, чтобы не спорить с вложенными стилями
  attackerRoot.style.setProperty('--fx-dx', `${dx}px`);
  attackerRoot.style.setProperty('--fx-dy', `${dy}px`);

  attackerRoot.classList.remove('bb-realcard-attack');
  // forced reflow (restart animation)
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  attackerRoot.offsetHeight;
  attackerRoot.classList.add('bb-realcard-attack');

  window.setTimeout(() => {
    attackerRoot.classList.remove('bb-realcard-attack');
    attackerRoot.style.removeProperty('--fx-dx');
    attackerRoot.style.removeProperty('--fx-dy');
  }, ATTACK_DURATION + 40);

  return true;
}

function AttackClone({
  fx,
  onDone,
}: {
  fx: AttackFx;
  onDone: (id: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let raf = 0;
    let frame = 0;
    let cleanupTimer: any = null;

    const tryMount = () => {
      frame += 1;

      const attackerRoot = getElByUnitId(fx.attackerId);
      const targetRoot = getElByUnitId(fx.targetId);
      const host = hostRef.current;

      if (attackerRoot && targetRoot && host) {
        const attackerEl = pickVisualCardEl(attackerRoot);
        const targetEl = pickVisualCardEl(targetRoot);

        const ar = attackerEl.getBoundingClientRect();
        const tr = targetEl.getBoundingClientRect();

        host.style.left = `${ar.left}px`;
        host.style.top = `${ar.top}px`;
        host.style.width = `${ar.width}px`;
        host.style.height = `${ar.height}px`;

        const { dx, dy } = computeTouchDelta(ar, tr);
        host.style.setProperty('--fx-dx', `${dx}px`);
        host.style.setProperty('--fx-dy', `${dy}px`);

        host.innerHTML = '';
        const clone = attackerEl.cloneNode(true) as HTMLElement;
        clone.style.pointerEvents = 'none';
        clone.style.width = '100%';
        clone.style.height = '100%';
        // не спорим с позиционированием клона, держим как "контент"
        clone.style.position = 'relative';
        clone.style.left = '0';
        clone.style.top = '0';
        host.appendChild(clone);

        host.style.animation = `bb_fx_lunge_touch_back ${ATTACK_DURATION}ms cubic-bezier(.18,.9,.22,1) both`;

        cleanupTimer = window.setTimeout(() => {
          onDone(fx.id);
        }, ATTACK_DURATION + 30);

        return;
      }

      if (frame < RETRY_FRAMES) {
        raf = requestAnimationFrame(tryMount);
      } else {
        onDone(fx.id);
      }
    };

    raf = requestAnimationFrame(tryMount);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (cleanupTimer) clearTimeout(cleanupTimer);
    };
  }, [fx.attackerId, fx.id, fx.targetId, onDone]);

  return (
    <div
      ref={hostRef}
      className="bb-fx-attack-clone"
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        zIndex: 9999,
        pointerEvents: 'none',
        transform: 'translate3d(0,0,0)',
        willChange: 'transform',
      }}
    />
  );
}

export default function BattleFxLayer({ events }: { events: FxEvent[] }) {
  const seenIdsRef = useRef<Set<string>>(new Set());
  const [fallbackFx, setFallbackFx] = useState<AttackFx[]>([]);

  const css = useMemo(
    () => `
      /* Реальная карта: добавочное смещение поверх существующих transform'ов */
      @keyframes bb_realcard_lunge_touch_back_translate {
        0%   { translate: 0px 0px; }
        55%  { translate: var(--fx-dx) var(--fx-dy); }
        70%  { translate: calc(var(--fx-dx) * 0.92) calc(var(--fx-dy) * 0.92); }
        100% { translate: 0px 0px; }
      }
      [data-unit-id].bb-realcard-attack {
        animation: bb_realcard_lunge_touch_back_translate ${ATTACK_DURATION}ms cubic-bezier(.18,.9,.22,1) both !important;
        will-change: translate;
        z-index: 50; /* поверх соседей */
      }

      /* Fallback clone */
      @keyframes bb_fx_lunge_touch_back {
        0%   { transform: translate3d(0px, 0px, 0) scale(1); }
        55%  { transform: translate3d(var(--fx-dx), var(--fx-dy), 0) scale(1.03); }
        70%  { transform: translate3d(calc(var(--fx-dx) * 0.92), calc(var(--fx-dy) * 0.92), 0) scale(1.00); }
        100% { transform: translate3d(0px, 0px, 0) scale(1); }
      }
    `,
    []
  );

  useEffect(() => {
    const cleanupTimers: any[] = [];

    for (const e of events || []) {
      if (e.type !== 'attack') continue;
      if (!e.id || !e.attackerId || !e.targetId) continue;
      if (seenIdsRef.current.has(e.id)) continue;

      seenIdsRef.current.add(e.id);

      // Важно: не держим seenIds навсегда — иначе новые атаки с тем же id не проиграются.
      const freeIdTimer = window.setTimeout(() => {
        seenIdsRef.current.delete(e.id);
      }, ATTACK_DURATION + 400);
      cleanupTimers.push(freeIdTimer);

      const attackerRoot = getElByUnitId(e.attackerId);
      const targetRoot = getElByUnitId(e.targetId);

      // 1) пробуем реальную карту
      let ok = false;
      if (attackerRoot && targetRoot) {
        ok = startRealCardAttack(attackerRoot, targetRoot);
      }

      // 2) fallback clone, если реальная не стартанула
      if (!ok) {
        setFallbackFx((prev) => [...prev, { id: e.id, attackerId: e.attackerId, targetId: e.targetId }]);
      }
    }

    return () => {
      for (const t of cleanupTimers) clearTimeout(t);
    };
  }, [events]);

  const onDoneFallback = (id: string) => {
    setFallbackFx((prev) => prev.filter((x) => x.id !== id));
  };

  return createPortal(
    <>
      <style>{css}</style>
      {fallbackFx.map((fx) => (
        <AttackClone key={fx.id} fx={fx} onDone={onDoneFallback} />
      ))}
    </>,
    document.body
  );
}
