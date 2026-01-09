'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * BattleFxLayer — TOUCH → CONTACT → BACK (DOM CLONE)
 *
 * Цель: при атаке "двигается вся карта", а не только рамка/арт.
 * Решение: клонируем DOM атакующей карты (cloneNode(true)) и анимируем клон поверх сцены (portal fixed).
 *
 * ✔ не двигаем реальные карты (layout не ломаем)
 * ✔ portal поверх (не влияет на DOM-порядок арены)
 * ✔ ретраи через rAF (если React перемонтировал DOM — FX всё равно стартует)
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
  // IMPORTANT: ожидаем что data-unit-id стоит на корневом DOM карты/юнита
  return document.querySelector<HTMLElement>(`[data-unit-id="${CSS.escape(unitId)}"]`);
}

function rectCenter(r: DOMRect) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function computeTouchDelta(a: DOMRect, b: DOMRect) {
  // Двигаем не "центр-в-центр", а ближе к касанию.
  // Для простоты: берём вектор центров и уменьшаем, чтобы выглядело как контакт, а не влет.
  const ac = rectCenter(a);
  const bc = rectCenter(b);
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;

  // Сжимаем вектор так, чтобы "касание" было визуально приятным.
  // 0.85–0.92 обычно выглядит как контакт.
  const k = 0.9;

  // Доп. уменьшение, если карты большие (чтобы не перелетать)
  const maxMove = Math.max(a.width, a.height) * 1.2;
  const len = Math.hypot(dx, dy) || 1;
  const safeK = clamp((maxMove / len) * k, 0.55, 0.92);

  return { dx: dx * safeK, dy: dy * safeK };
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

      const attackerEl = getElByUnitId(fx.attackerId);
      const targetEl = getElByUnitId(fx.targetId);
      const host = hostRef.current;

      if (attackerEl && targetEl && host) {
        const ar = attackerEl.getBoundingClientRect();
        const tr = targetEl.getBoundingClientRect();

        // позиционируем хост под атакующей картой
        host.style.left = `${ar.left}px`;
        host.style.top = `${ar.top}px`;
        host.style.width = `${ar.width}px`;
        host.style.height = `${ar.height}px`;

        // вычисляем дельту "касания"
        const { dx, dy } = computeTouchDelta(ar, tr);
        host.style.setProperty('--fx-dx', `${dx}px`);
        host.style.setProperty('--fx-dy', `${dy}px`);

        // чистим предыдущий клон (на всякий)
        host.innerHTML = '';

        // Клонируем ВЕСЬ DOM карты, чтобы двигалась именно "карта", а не отдельная рамка/арт
        const clone = attackerEl.cloneNode(true) as HTMLElement;

        // Изоляция от внешних кликов/событий
        clone.style.pointerEvents = 'none';

        // Важно: клон должен занимать 100% контейнера
        clone.style.width = '100%';
        clone.style.height = '100%';

        // Убираем возможные "position: absolute" на корне (если есть), чтобы не ломало
        clone.style.position = 'relative';
        clone.style.left = '0';
        clone.style.top = '0';
        clone.style.transform = 'none';

        host.appendChild(clone);

        // стартуем анимацию
        host.style.animation = `bb_fx_lunge_touch_back ${ATTACK_DURATION}ms cubic-bezier(.18,.9,.22,1) both`;

        cleanupTimer = setTimeout(() => {
          onDone(fx.id);
        }, ATTACK_DURATION + 20);

        return;
      }

      if (frame < RETRY_FRAMES) {
        raf = requestAnimationFrame(tryMount);
      } else {
        // не нашли DOM — просто завершаем FX, чтобы не копить мусор
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
  const [attackFx, setAttackFx] = useState<AttackFx[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());

  // добавляем только новые атаки
  useEffect(() => {
    for (const e of events || []) {
      if (e.type !== 'attack') continue;
      if (!e.id || !e.attackerId || !e.targetId) continue;

      if (!seenIdsRef.current.has(e.id)) {
        seenIdsRef.current.add(e.id);
        setAttackFx((prev) => [...prev, { id: e.id, attackerId: e.attackerId, targetId: e.targetId }]);
      }
    }
  }, [events]);

  const onDone = (id: string) => {
    setAttackFx((prev) => prev.filter((x) => x.id !== id));
  };

  // keyframes живут прямо здесь — без зависимости от внешних css
  const css = useMemo(
    () => `
      @keyframes bb_fx_lunge_touch_back {
        0%   { transform: translate3d(0px, 0px, 0) scale(1); }
        55%  { transform: translate3d(var(--fx-dx), var(--fx-dy), 0) scale(1.03); }
        70%  { transform: translate3d(calc(var(--fx-dx) * 0.92), calc(var(--fx-dy) * 0.92), 0) scale(1.00); }
        100% { transform: translate3d(0px, 0px, 0) scale(1); }
      }
    `,
    []
  );

  return createPortal(
    <>
      <style>{css}</style>
      {attackFx.map((fx) => (
        <AttackClone key={fx.id} fx={fx} onDone={onDone} />
      ))}
    </>,
    document.body
  );
}
