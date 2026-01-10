'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * BattleFxLayer — ATTACK TOUCH→BACK (HARDENED + DEBUG)
 *
 * Если "ничего не двигается", причина почти всегда одна из:
 * 1) events пустые (fxEvents не приходят)
 * 2) data-unit-id не совпадает / стоит не на том узле
 * 3) мы двигаем не тот контейнер (нет .bb-slot)
 *
 * Этот файл:
 * - двигает "лучший" контейнер вокруг карты (slot/wrapper/сам unit)
 * - делает ретраи, чтобы дождаться DOM после ремоунта
 * - имеет режим debug (?fxdebug=1) — показывает:
 *    • счётчик событий
 *    • подсветку найденных attacker/target
 *    • всплывающий текст, если DOM не найден
 */

export type FxEvent =
  | {
      type: 'attack';
      id: string;
      attackerId: string;
      targetId: string;
    };

const ATTACK_DURATION = 520;
const RETRY_FRAMES = 18;

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function getElByUnitId(unitId: string) {
  return document.querySelector<HTMLElement>(`[data-unit-id="${CSS.escape(String(unitId))}"]`);
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

function hasClassLike(el: HTMLElement, needle: string) {
  const c = (el.className || '').toString();
  return c.includes(needle);
}

function findMoveEl(unitRoot: HTMLElement): HTMLElement {
  // 1) нормальный путь
  const slot = unitRoot.closest('.bb-slot') as HTMLElement | null;
  if (slot) return slot;

  // 2) любые "slot"-подобные контейнеры
  const slotLike = unitRoot.closest('[class*="slot"],[class*="Slot"],[data-slot], [data-slot-id]') as HTMLElement | null;
  if (slotLike) return slotLike;

  // 3) поднимаемся вверх в пределах 5 уровней и берём первый контейнер,
  // который похож на слот/карточный контейнер
  let cur: HTMLElement | null = unitRoot;
  for (let i = 0; i < 5 && cur; i++) {
    if (hasClassLike(cur, 'bb-slot') || hasClassLike(cur, 'slot') || hasClassLike(cur, 'card') || hasClassLike(cur, 'bb-card')) {
      return cur;
    }
    cur = cur.parentElement;
  }

  // 4) fallback: сам root
  return unitRoot;
}

function startAttackMove(moveEl: HTMLElement, dx: number, dy: number) {
  moveEl.style.setProperty('--fx-dx', `${dx}px`);
  moveEl.style.setProperty('--fx-dy', `${dy}px`);

  // перезапуск анимации
  moveEl.classList.remove('bb-attack-move');
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  moveEl.offsetHeight;
  moveEl.classList.add('bb-attack-move');

  window.setTimeout(() => {
    moveEl.classList.remove('bb-attack-move');
    moveEl.style.removeProperty('--fx-dx');
    moveEl.style.removeProperty('--fx-dy');
  }, ATTACK_DURATION + 40);
}

export default function BattleFxLayer({ events }: { events: FxEvent[] }) {
  const seenIdsRef = useRef<Set<string>>(new Set());
  const [debugMsg, setDebugMsg] = useState<string>('');
  const [debugCount, setDebugCount] = useState<number>(0);

  const debugEnabled = useMemo(() => {
    try {
      return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('fxdebug') === '1';
    } catch {
      return false;
    }
  }, []);

  const css = useMemo(
    () => `
      @keyframes bb_attack_touch_back {
        0%   { transform: translate3d(0px, 0px, 0) scale(1); }
        55%  { transform: translate3d(var(--fx-dx), var(--fx-dy), 0) scale(1.03); }
        70%  { transform: translate3d(calc(var(--fx-dx) * 0.92), calc(var(--fx-dy) * 0.92), 0) scale(1.00); }
        100% { transform: translate3d(0px, 0px, 0) scale(1); }
      }
      .bb-attack-move {
        animation: bb_attack_touch_back ${ATTACK_DURATION}ms cubic-bezier(.18,.9,.22,1) both !important;
        will-change: transform;
        z-index: 60;
      }

      /* Debug helpers */
      .bb-fx-debug-outline-attacker { outline: 2px solid rgba(0,255,255,.85) !important; }
      .bb-fx-debug-outline-target   { outline: 2px solid rgba(255,0,255,.85) !important; }

      .bb-fx-debug-hud {
        position: fixed;
        right: 10px;
        bottom: 10px;
        z-index: 10000;
        pointer-events: none;
        font: 12px/1.2 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
        color: rgba(255,255,255,.92);
        background: rgba(0,0,0,.55);
        padding: 8px 10px;
        border-radius: 10px;
        backdrop-filter: blur(6px);
        max-width: 60vw;
        white-space: pre-wrap;
      }
    `,
    []
  );

  useEffect(() => {
    const timers: any[] = [];
    const rafs: number[] = [];

    if (debugEnabled) {
      setDebugCount((events || []).length);
    }

    const tryOnce = (attackerId: string, targetId: string) => {
      const attackerRoot = getElByUnitId(attackerId);
      const targetRoot = getElByUnitId(targetId);

      if (!attackerRoot || !targetRoot) return false;

      const ar = attackerRoot.getBoundingClientRect();
      const tr = targetRoot.getBoundingClientRect();
      if (!ar.width || !ar.height || !tr.width || !tr.height) return false;

      const { dx, dy } = computeTouchDelta(ar, tr);
      const moveEl = findMoveEl(attackerRoot);

      if (debugEnabled) {
        attackerRoot.classList.add('bb-fx-debug-outline-attacker');
        targetRoot.classList.add('bb-fx-debug-outline-target');
        timers.push(
          window.setTimeout(() => {
            attackerRoot.classList.remove('bb-fx-debug-outline-attacker');
            targetRoot.classList.remove('bb-fx-debug-outline-target');
          }, 500)
        );
      }

      startAttackMove(moveEl, dx, dy);
      return true;
    };

    const runWithRetry = (attackerId: string, targetId: string) => {
      let frame = 0;
      const tick = () => {
        frame += 1;
        const ok = tryOnce(attackerId, targetId);
        if (ok) return;

        if (frame < RETRY_FRAMES) {
          rafs.push(requestAnimationFrame(tick));
        } else if (debugEnabled) {
          setDebugMsg(`FX: DOM not found for\nattackerId=${attackerId}\ntargetId=${targetId}\n(data-unit-id mismatch?)`);
          timers.push(window.setTimeout(() => setDebugMsg(''), 1200));
        }
      };
      rafs.push(requestAnimationFrame(tick));
    };

    for (const e of events || []) {
      if (e.type !== 'attack') continue;
      if (!e.id || !e.attackerId || !e.targetId) continue;
      if (seenIdsRef.current.has(e.id)) continue;

      seenIdsRef.current.add(e.id);
      timers.push(window.setTimeout(() => seenIdsRef.current.delete(e.id), ATTACK_DURATION + 800));

      runWithRetry(String(e.attackerId), String(e.targetId));
    }

    return () => {
      for (const t of timers) clearTimeout(t);
      for (const r of rafs) cancelAnimationFrame(r);
    };
  }, [events, debugEnabled]);

  return createPortal(
    <>
      <style>{css}</style>
      {debugEnabled ? (
        <div className="bb-fx-debug-hud">{`FX events: ${debugCount}\n${debugMsg}`}</div>
      ) : null}
    </>,
    document.body
  );
}
