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

const DURATION = 360; // туда
const RETURN_DURATION = 220; // обратно
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

  // ограничим движение, чтобы "касалась" цели, но не улетала
  const maxMove = Math.max(a.width, a.height) * 1.05;
  const len = Math.hypot(dx, dy) || 1;
  const k = clamp(maxMove / len, 0.45, 0.95);

  return { dx: dx * k, dy: dy * k };
}

function safeEscape(v: string) {
  try {
    const cssAny = CSS as unknown as { escape?: (s: string) => string };
    return typeof cssAny !== 'undefined' && typeof cssAny.escape === 'function'
      ? cssAny.escape(v)
      : v.replace(/"/g, '\\"');
  } catch {
    return v.replace(/"/g, '\\"');
  }
}

/**
 * В DOM 2 узла с одинаковым data-unit-id (.bb-slot и .bb-card).
 * querySelector может вернуть не то. Берём ВСЕ и выбираем .bb-slot.
 */
function getBestUnitRootById(unitId: string) {
  const list = Array.from(document.querySelectorAll<HTMLElement>(`[data-unit-id="${safeEscape(String(unitId))}"]`));
  if (!list.length) return null;

  const slot = list.find((el) => el.classList.contains('bb-slot'));
  if (slot) return slot;

  for (const el of list) {
    const up = el.closest('.bb-slot') as HTMLElement | null;
    if (up) return up;
  }

  return list[0];
}

function findMotionLayer(root: HTMLElement): HTMLElement | null {
  const slot = root.classList.contains('bb-slot') ? root : (root.closest('.bb-slot') as HTMLElement | null);
  if (slot) return slot.querySelector<HTMLElement>('.bb-motion-layer') || null;
  return root.querySelector<HTMLElement>('.bb-motion-layer') || null;
}

function findCardEl(root: HTMLElement): HTMLElement | null {
  if (root.classList.contains('bb-card')) return root;
  return root.querySelector<HTMLElement>('.bb-card') || null;
}

type ActiveState = {
  el: HTMLElement;
  restoreTransform: string;
  restoreTransition: string;
  restoreWillChange: string;
  restoreZ: string;
  t1: number | null;
  t2: number | null;
};

export default function BattleFxLayer({ events }: { events: FxEvent[] }) {
  const seenIdsRef = useRef<Set<string>>(new Set());
  const activeRef = useRef<WeakMap<HTMLElement, ActiveState>>(new WeakMap());

  const [mounted, setMounted] = useState(false);
  const [hud, setHud] = useState<string>('');
  const [cnt, setCnt] = useState<number>(0);

  const debug = useMemo(() => {
    try {
      return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('fxdebug') === '1';
    } catch {
      return false;
    }
  }, []);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;

    const rafs: number[] = [];
    const timers: any[] = [];

    if (debug) setCnt((events || []).length);

    const stop = (el: HTMLElement) => {
      const st = activeRef.current.get(el);
      if (!st) return;

      try {
        if (st.t1) window.clearTimeout(st.t1);
        if (st.t2) window.clearTimeout(st.t2);
      } catch {}

      try {
        el.style.transform = st.restoreTransform;
        el.style.transition = st.restoreTransition;
        el.style.willChange = st.restoreWillChange;
        el.style.zIndex = st.restoreZ;
      } catch {}

      activeRef.current.delete(el);
    };

    const kick = (el: HTMLElement, dx: number, dy: number) => {
      if (activeRef.current.has(el)) return;

      const st: ActiveState = {
        el,
        restoreTransform: el.style.transform || '',
        restoreTransition: el.style.transition || '',
        restoreWillChange: el.style.willChange || '',
        restoreZ: el.style.zIndex || '',
        t1: null,
        t2: null,
      };

      activeRef.current.set(el, st);

      // ВАЖНО: никакого re-parent, только inline style.
      el.style.willChange = 'transform';
      el.style.zIndex = '60';

      // 1) reset transition, force reflow
      el.style.transition = 'none';
      el.style.transform = 'translate3d(0px, 0px, 0px)';
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      el.offsetHeight;

      // 2) fly to target
      el.style.transition = `transform ${DURATION}ms cubic-bezier(.18,.9,.22,1)`;
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0px)`;

      st.t1 = window.setTimeout(() => {
        // 3) return back
        el.style.transition = `transform ${RETURN_DURATION}ms cubic-bezier(.2,.8,.2,1)`;
        el.style.transform = 'translate3d(0px, 0px, 0px)';

        st.t2 = window.setTimeout(() => stop(el), RETURN_DURATION + 40);
      }, DURATION + 10);
    };

    const tryOnce = (attackerId: string, targetId: string) => {
      const aRoot = getBestUnitRootById(attackerId);
      const tRoot = getBestUnitRootById(targetId);
      if (!aRoot || !tRoot) return false;

      const motion = findMotionLayer(aRoot);
      const aCard = findCardEl(aRoot);
      const tCard = findCardEl(tRoot);

      // если motion-layer почему-то нет — двигаем bb-card напрямую (последний шанс)
      const moveEl = motion || aCard;
      if (!moveEl || !aCard || !tCard) return false;

      const ar = aCard.getBoundingClientRect();
      const tr = tCard.getBoundingClientRect();
      if (!ar.width || !ar.height || !tr.width || !tr.height) return false;

      const { dx, dy } = computeTouchDelta(ar, tr);

      if (debug) {
        setHud(
          `FX: OK\nroot=${aRoot.classList.contains('bb-slot') ? 'bb-slot' : aRoot.tagName}\nmove=${motion ? 'motion-layer' : 'bb-card'}\ndx=${Math.round(
            dx
          )} dy=${Math.round(dy)}`
        );
        timers.push(window.setTimeout(() => setHud(''), 900));

        aCard.classList.add('bb-fx-debug-outline-attacker');
        tCard.classList.add('bb-fx-debug-outline-target');
        timers.push(
          window.setTimeout(() => {
            aCard.classList.remove('bb-fx-debug-outline-attacker');
            tCard.classList.remove('bb-fx-debug-outline-target');
          }, 450)
        );
      }

      kick(moveEl, dx, dy);
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
        } else if (debug) {
          setHud(`FX: failed (DOM/rect)\nattacker=${attackerId}\ntarget=${targetId}`);
          timers.push(window.setTimeout(() => setHud(''), 1200));
        }
      };
      rafs.push(requestAnimationFrame(tick));
    };

    for (const e of events || []) {
      if (e.type !== 'attack') continue;
      if (!e.id || !e.attackerId || !e.targetId) continue;
      if (seenIdsRef.current.has(e.id)) continue;

      seenIdsRef.current.add(e.id);
      timers.push(window.setTimeout(() => seenIdsRef.current.delete(e.id), DURATION + RETURN_DURATION + 900));

      runWithRetry(String(e.attackerId), String(e.targetId));
    }

    return () => {
      for (const r of rafs) cancelAnimationFrame(r);
      for (const t of timers) clearTimeout(t);
      // restore any active animations
      try {
        activeRef.current = new WeakMap();
      } catch {}
    };
  }, [events, debug, mounted]);

  if (!mounted) return null;

  const css = `
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
      max-width: 70vw;
      white-space: pre-wrap;
    }
  `;

  return createPortal(
    <>
      {debug ? <style>{css}</style> : null}
      {debug ? <div className="bb-fx-debug-hud">{`FX events: ${cnt}\n${hud}`}</div> : null}
    </>,
    document.body
  );
}
