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
  try {
    const cssAny = CSS as unknown as { escape?: (s: string) => string };
    return typeof cssAny !== 'undefined' && typeof cssAny.escape === 'function' ? cssAny.escape(v) : v.replace(/"/g, '\\"');
  } catch {
    return v.replace(/"/g, '\\"');
  }
}

function getUnitRootById(unitId: string) {
  return document.querySelector<HTMLElement>(`[data-unit-id="${safeEscape(String(unitId))}"]`);
}

function hasClassLike(el: HTMLElement, needle: string) {
  const c = (el.className || '').toString();
  return c.includes(needle);
}

function findVisualCardEl(unitRoot: HTMLElement): HTMLElement {
  if (hasClassLike(unitRoot, 'bb-card') || hasClassLike(unitRoot, 'card')) return unitRoot;
  const inner = unitRoot.querySelector<HTMLElement>('.bb-card, [class*="bb-card"], [class*="Card"], [class*="card"]');
  if (inner) return inner;

  let cur: HTMLElement | null = unitRoot;
  for (let i = 0; i < 6 && cur; i++) {
    if (hasClassLike(cur, 'bb-card') || hasClassLike(cur, 'card')) return cur;
    cur = cur.parentElement;
  }
  return unitRoot;
}

function isDisplayContents(el: HTMLElement) {
  try {
    return window.getComputedStyle(el).display === 'contents';
  } catch {
    return false;
  }
}

type ActiveAnimState = {
  anim: Animation;
  restore: {
    translate?: string;
    transform: string;
    transition: string;
    animation: string;
    willChange: string;
  };
};

export default function BattleFxLayer({ events }: { events: FxEvent[] }) {
  const seenIdsRef = useRef<Set<string>>(new Set());

  const [mounted, setMounted] = useState(false);

  const [debugMsg, setDebugMsg] = useState<string>('');
  const [debugCount, setDebugCount] = useState<number>(0);

  const debugEnabled = useMemo(() => {
    try {
      return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('fxdebug') === '1';
    } catch {
      return false;
    }
  }, []);

  const activeAnimRef = useRef<WeakMap<HTMLElement, ActiveAnimState>>(new WeakMap());

  const css = useMemo(
    () => `
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

    if (debugEnabled) setDebugCount((events || []).length);

    const stopActive = (el: HTMLElement) => {
      const st = activeAnimRef.current.get(el);
      if (!st) return;

      try {
        st.anim.cancel();
      } catch {
        // ignore
      }

      try {
        // restore translate if supported
        if (st.restore.translate !== undefined) {
          (el.style as any).translate = st.restore.translate;
        }
        el.style.transform = st.restore.transform;
        el.style.transition = st.restore.transition;
        el.style.animation = st.restore.animation;
        el.style.willChange = st.restore.willChange;
      } catch {
        // ignore
      }

      activeAnimRef.current.delete(el);
    };

    const startAttack = (moveEl: HTMLElement, dx: number, dy: number) => {
      if (activeAnimRef.current.has(moveEl)) return;

      const restore = {
        translate: (moveEl.style as any).translate as string | undefined,
        transform: moveEl.style.transform || '',
        transition: moveEl.style.transition || '',
        animation: moveEl.style.animation || '',
        willChange: moveEl.style.willChange || '',
      };

      // IMPORTANT:
      // Не трогаем DOM дерево. Не трогаем top/left.
      // Главный хак: анимируем CSS свойство `translate`, которое НЕ конфликтует с transform-анимациями.
      moveEl.style.willChange = 'transform, translate';
      // Не отключаем animation/transition глобально — это часто ломает ваши старые FX.
      // Но если элемент прямо сейчас под CSS-анимацией transform, `translate` всё равно сработает.

      let anim: Animation | null = null;

      const canTranslate = (() => {
        try {
          return 'translate' in (moveEl.style as any);
        } catch {
          return false;
        }
      })();

      if (canTranslate) {
        anim = moveEl.animate(
          [
            { translate: '0px 0px' } as any,
            { translate: `${dx}px ${dy}px` } as any,
            { translate: `${dx * 0.92}px ${dy * 0.92}px` } as any,
            { translate: '0px 0px' } as any,
          ],
          {
            duration: ATTACK_DURATION,
            easing: 'cubic-bezier(.18,.9,.22,1)',
            fill: 'forwards',
          } as any
        );
      } else {
        // Fallback: transform (может конфликтовать, но лучше чем ничего)
        const cs = window.getComputedStyle(moveEl);
        const base = cs.transform && cs.transform !== 'none' ? cs.transform : '';
        const t0 = base || 'none';
        const t1 = base ? `${base} translate3d(${dx}px, ${dy}px, 0) scale(1.03)` : `translate3d(${dx}px, ${dy}px, 0) scale(1.03)`;
        const t2 = base ? `${base} translate3d(${dx * 0.92}px, ${dy * 0.92}px, 0) scale(1.0)` : `translate3d(${dx * 0.92}px, ${dy * 0.92}px, 0) scale(1.0)`;
        const t3 = base || 'none';

        anim = moveEl.animate(
          [{ transform: t0 }, { transform: t1 }, { transform: t2 }, { transform: t3 }],
          {
            duration: ATTACK_DURATION,
            easing: 'cubic-bezier(.18,.9,.22,1)',
            fill: 'forwards',
          }
        );
      }

      if (!anim) return;

      const finish = () => stopActive(moveEl);
      anim.onfinish = finish;
      anim.oncancel = finish;

      activeAnimRef.current.set(moveEl, { anim, restore });
      timers.push(window.setTimeout(() => stopActive(moveEl), ATTACK_DURATION + 140));
    };

    const tryOnce = (attackerId: string, targetId: string) => {
      const attackerRoot = getUnitRootById(attackerId);
      const targetRoot = getUnitRootById(targetId);
      if (!attackerRoot || !targetRoot) return false;

      const targetVisual = findVisualCardEl(targetRoot);

      const slot = attackerRoot.closest('.bb-slot') as HTMLElement | null;
      const attackerVisual = findVisualCardEl(attackerRoot);

      let moveEl: HTMLElement = slot || attackerRoot;
      let ar = moveEl.getBoundingClientRect();

      if (!ar.width || !ar.height || isDisplayContents(moveEl)) {
        moveEl = attackerVisual;
        ar = moveEl.getBoundingClientRect();
      }

      const tr = targetVisual.getBoundingClientRect();
      if (!ar.width || !ar.height || !tr.width || !tr.height) return false;

      const { dx, dy } = computeTouchDelta(ar, tr);

      if (debugEnabled) {
        moveEl.classList.add('bb-fx-debug-outline-attacker');
        targetVisual.classList.add('bb-fx-debug-outline-target');
        timers.push(
          window.setTimeout(() => {
            moveEl.classList.remove('bb-fx-debug-outline-attacker');
            targetVisual.classList.remove('bb-fx-debug-outline-target');
          }, 500)
        );
      }

      startAttack(moveEl, dx, dy);
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
          setDebugMsg(`FX: DOM not found / rect=0\nattackerId=${attackerId}\ntargetId=${targetId}`);
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
      try {
        activeAnimRef.current = new WeakMap();
      } catch {
        // ignore
      }
    };
  }, [events, debugEnabled, mounted]);

  if (!mounted) return null;

  return createPortal(
    <>
      {debugEnabled ? <style>{css}</style> : null}
      {debugEnabled ? <div className="bb-fx-debug-hud">{`FX events: ${debugCount}\n${debugMsg}`}</div> : null}
    </>,
    document.body
  );
}
