'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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

function rectCenter(r: DOMRect) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function computeTouchDelta(a: DOMRect, b: DOMRect) {
  const ac = rectCenter(a);
  const bc = rectCenter(b);
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;

  // чтобы не улетало слишком далеко
  const k = 0.9;
  const maxMove = Math.max(a.width, a.height) * 1.15;
  const len = Math.hypot(dx, dy) || 1;
  const safeK = clamp((maxMove / len) * k, 0.55, 0.92);

  return { dx: dx * safeK, dy: dy * safeK };
}

function safeEscape(v: string) {
  // CSS.escape может отсутствовать в старых вебвью
  // fallback: минимальная экранировка кавычек
  try {
    const cssAny = CSS as unknown as { escape?: (s: string) => string };
    return typeof cssAny !== 'undefined' && typeof cssAny.escape === 'function'
      ? cssAny.escape(v)
      : v.replace(/"/g, '\\"');
  } catch {
    return v.replace(/"/g, '\\"');
  }
}

function getElByUnitId(unitId: string) {
  return document.querySelector<HTMLElement>(`[data-unit-id="${safeEscape(String(unitId))}"]`);
}

function hasClassLike(el: HTMLElement, needle: string) {
  const c = (el.className || '').toString();
  return c.includes(needle);
}

function findVisualCardEl(unitRoot: HTMLElement): HTMLElement {
  // 1) если unitRoot уже выглядит как карта
  if (hasClassLike(unitRoot, 'bb-card') || hasClassLike(unitRoot, 'card')) return unitRoot;

  // 2) ищем явную карточку внутри
  const inner = unitRoot.querySelector<HTMLElement>('.bb-card, [class*="bb-card"], [class*="Card"], [class*="card"]');
  if (inner) return inner;

  // 3) поднимаемся вверх: иногда data-unit-id стоит на внутренности
  let cur: HTMLElement | null = unitRoot;
  for (let i = 0; i < 6 && cur; i++) {
    if (hasClassLike(cur, 'bb-card') || hasClassLike(cur, 'card')) return cur;
    cur = cur.parentElement;
  }

  // 4) fallback
  return unitRoot;
}

function isDisplayContents(el: HTMLElement) {
  try {
    return window.getComputedStyle(el).display === 'contents';
  } catch {
    return false;
  }
}

type LiftState = {
  placeholder: HTMLDivElement;
  parent: Node;
  nextSibling: Node | null;
  originalStyle: Partial<CSSStyleDeclaration>;
  originalClass: string;
};

export default function BattleFxLayer({ events }: { events: FxEvent[] }) {
  const seenIdsRef = useRef<Set<string>>(new Set());

  const [mounted, setMounted] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const [debugMsg, setDebugMsg] = useState<string>('');
  const [debugCount, setDebugCount] = useState<number>(0);

  const debugEnabled = useMemo(() => {
    try {
      return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('fxdebug') === '1';
    } catch {
      return false;
    }
  }, []);

  // чтобы не "таскать" один и тот же элемент параллельно
  const activeLiftRef = useRef<WeakMap<HTMLElement, LiftState>>(new WeakMap());

  const css = useMemo(
    () => `
      .bb-fx-overlay-root {
        position: fixed;
        left: 0;
        top: 0;
        width: 100vw;
        height: 100vh;
        pointer-events: none;
        z-index: 9999;
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

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;

    const timers: any[] = [];
    const rafs: number[] = [];

    if (debugEnabled) {
      setDebugCount((events || []).length);
    }

    const overlayRoot = overlayRef.current;
    if (!overlayRoot) return;

    const cleanupLift = (moveEl: HTMLElement) => {
      const st = activeLiftRef.current.get(moveEl);
      if (!st) return;

      try {
        // вернуть элемент в DOM
        if (st.nextSibling && st.nextSibling.parentNode === st.parent) {
          st.parent.insertBefore(moveEl, st.nextSibling);
        } else {
          st.parent.appendChild(moveEl);
        }
      } catch {
        // если не удалось, просто попробуем вставить рядом с placeholder
        try {
          st.placeholder.parentNode?.insertBefore(moveEl, st.placeholder);
        } catch {
          // ignore
        }
      }

      try {
        st.placeholder.remove();
      } catch {
        // ignore
      }

      // восстановить стиль
      try {
        moveEl.style.position = st.originalStyle.position || '';
        moveEl.style.left = st.originalStyle.left || '';
        moveEl.style.top = st.originalStyle.top || '';
        moveEl.style.width = st.originalStyle.width || '';
        moveEl.style.height = st.originalStyle.height || '';
        moveEl.style.margin = st.originalStyle.margin || '';
        moveEl.style.transform = st.originalStyle.transform || '';
        moveEl.style.zIndex = st.originalStyle.zIndex || '';
        moveEl.style.pointerEvents = st.originalStyle.pointerEvents || '';
        moveEl.style.willChange = st.originalStyle.willChange || '';
      } catch {
        // ignore
      }

      try {
        moveEl.className = st.originalClass;
      } catch {
        // ignore
      }

      activeLiftRef.current.delete(moveEl);
    };

    const startLiftAttack = (moveEl: HTMLElement, dx: number, dy: number) => {
      // уже "таскаем" — не дёргаем снова
      if (activeLiftRef.current.has(moveEl)) return;

      const rect = moveEl.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      // display:contents контейнеры не двигаются — но мы двигаем visual card.
      // если вдруг сюда попал contents, пробуем взять ребёнка.
      if (isDisplayContents(moveEl)) {
        const child = moveEl.querySelector<HTMLElement>(':scope > *');
        if (child) moveEl = child;
      }

      const parent = moveEl.parentNode;
      if (!parent) return;

      const placeholder = document.createElement('div');
      placeholder.style.width = `${rect.width}px`;
      placeholder.style.height = `${rect.height}px`;
      placeholder.style.visibility = 'hidden';
      placeholder.style.pointerEvents = 'none';

      const nextSibling = moveEl.nextSibling;
      parent.insertBefore(placeholder, nextSibling);

      const originalClass = moveEl.className;
      const originalStyle: Partial<CSSStyleDeclaration> = {
        position: moveEl.style.position,
        left: moveEl.style.left,
        top: moveEl.style.top,
        width: moveEl.style.width,
        height: moveEl.style.height,
        margin: moveEl.style.margin,
        transform: moveEl.style.transform,
        zIndex: moveEl.style.zIndex,
        pointerEvents: moveEl.style.pointerEvents,
        willChange: moveEl.style.willChange,
      };

      activeLiftRef.current.set(moveEl, { placeholder, parent, nextSibling, originalStyle, originalClass });

      // переносим ОРИГИНАЛ в overlay
      overlayRoot.appendChild(moveEl);

      // фиксируем позицию (в пикселях) на экране
      moveEl.style.position = 'fixed';
      moveEl.style.left = `${rect.left}px`;
      moveEl.style.top = `${rect.top}px`;
      moveEl.style.width = `${rect.width}px`;
      moveEl.style.height = `${rect.height}px`;
      moveEl.style.margin = '0';
      moveEl.style.zIndex = '10000';
      moveEl.style.pointerEvents = 'none';
      moveEl.style.willChange = 'transform';

      // WAAPI анимация — не зависит от CSS keyframes
      const anim = moveEl.animate(
        [
          { transform: 'translate3d(0px, 0px, 0) scale(1)' },
          { transform: `translate3d(${dx}px, ${dy}px, 0) scale(1.03)` },
          { transform: `translate3d(${dx * 0.92}px, ${dy * 0.92}px, 0) scale(1.0)` },
          { transform: 'translate3d(0px, 0px, 0) scale(1)' },
        ],
        {
          duration: ATTACK_DURATION,
          easing: 'cubic-bezier(.18,.9,.22,1)',
          fill: 'forwards',
        }
      );

      const finish = () => {
        try {
          anim.cancel();
        } catch {
          // ignore
        }
        cleanupLift(moveEl);
      };

      anim.onfinish = finish;
      anim.oncancel = finish;

      // страховка: если вдруг onfinish не сработал
      timers.push(window.setTimeout(() => cleanupLift(moveEl), ATTACK_DURATION + 80));
    };

    const tryOnce = (attackerId: string, targetId: string) => {
      const attackerRoot = getElByUnitId(attackerId);
      const targetRoot = getElByUnitId(targetId);
      if (!attackerRoot || !targetRoot) return false;

      const attackerVisual = findVisualCardEl(attackerRoot);
      const targetVisual = findVisualCardEl(targetRoot);

      const ar = attackerVisual.getBoundingClientRect();
      const tr = targetVisual.getBoundingClientRect();
      if (!ar.width || !ar.height || !tr.width || !tr.height) return false;

      const { dx, dy } = computeTouchDelta(ar, tr);

      if (debugEnabled) {
        attackerVisual.classList.add('bb-fx-debug-outline-attacker');
        targetVisual.classList.add('bb-fx-debug-outline-target');
        timers.push(
          window.setTimeout(() => {
            attackerVisual.classList.remove('bb-fx-debug-outline-attacker');
            targetVisual.classList.remove('bb-fx-debug-outline-target');
          }, 500)
        );
      }

      startLiftAttack(attackerVisual, dx, dy);
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

      // если размонтировали во время lift — постараемся вернуть элементы
      try {
        activeLiftRef.current = new WeakMap();
      } catch {
        // ignore
      }
    };
  }, [events, debugEnabled, mounted]);

  if (!mounted) return null;

  return createPortal(
    <>
      <style>{css}</style>
      <div ref={overlayRef} className="bb-fx-overlay-root" />
      {debugEnabled ? <div className="bb-fx-debug-hud">{`FX events: ${(events || []).length}\n${debugMsg}`}</div> : null}
    </>,
    document.body
  );
}
